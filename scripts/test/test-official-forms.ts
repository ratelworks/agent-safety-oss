#!/usr/bin/env tsx
/**
 * test-official-forms.ts — 법정 서식 원본에 값을 채운 한글 파일의 회귀 시험
 *
 *   1) 서식 원본 — 칸 지도의 파일·문서 종류가 있고, 출처(법령·서식·주소·받은 날·해시)가 적혀 있고, 칸 지도가 가리키는 칸 이름이 그 문서의 칸이다
 *   2) 빈 입력 — 서식이 원본 그대로다(줄 배치 캐시만 빠진다), 본문 밖의 항목은 같은 순서·같은 바이트, 알림 없음
 *   3) 짜임 — 채운 뒤에도 본문 XML 이 맞고, 용지 방향·표 수·열 수가 그대로이고, 모든 표의 칸이 행×열 격자를 빈틈·겹침 없이 덮는다
 *   4) 자리 — 값이 서식의 정해진 칸에 들어가고, 체크 칸은 고른 것만 표시되고, 서명 칸은 입력이 없으면 비어 있다
 *   5) 잃지 않음 — 모든 입력값이 한글 파일에 있거나 notInForm 으로 알린다
 *   6) 정본 — 생성 때 만든 한글 파일이 저장된 정본(.dclx)에서 다시 만든 것과 같다. 서식이 없는 문서는 정본 블록으로 만든다
 *
 * 한글 프로그램에서 실제로 열리는지는 이 시험이 확인하지 않는다(프로그램이 있어야 한다).
 * 표 읽기는 엔진과 따로 짠 작은 읽개로 한다 — 엔진의 표 훑기를 그대로 믿지 않는다.
 *
 * 사용: tsx scripts/test/test-official-forms.ts
 */
import "./isolated-storage.js"; // 저장 폴더를 임시 폴더로 — 사용자 문서 폴더에 파일을 남기지 않는다
import { existsSync, readFileSync } from "node:fs";
import { unzip } from "../../src/lib/zip.js";
import { unpackDclx } from "../../src/lib/dclx.js";
import { getDocument, getDocumentSync } from "../../src/lib/graph-nodes-loader.js";
import { fillOfficialForm, formValuesFromDoclang, officialFormFromDoclang, type FormValues } from "../../src/lib/official-form.js";
import { officialFormDocIds, officialFormMaps, officialFormPath, type FormMap } from "../../src/lib/official-form-map.js";
import { generateSafetyDocumentTool } from "../../src/tools/generate-safety-document.js";

// ── 상수 ────────────────────────────────────────────────────────────
const SECTION = "Contents/section0.xml";
const LINESEG = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;
const XML_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
const PLACEHOLDER = /\{([^{}|]+)(?:\|([^{}]+))?\}/g;
/** 서식이 있는 문서 종류 수 — 서식을 더하거나 빼면 함께 고친다 */
const FORM_DOC_COUNT = 1;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 작은 표 읽개 (엔진과 별도) ───────────────────────────────────────
interface Cell { row: number; col: number; rowSpan: number; colSpan: number; text: string }
interface Table { rowCnt: number; colCnt: number; cells: Cell[] }
const unescape = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** 본문 XML 의 모든 표(중첩 포함, 문서 순서) — 칸의 글자는 그 칸 자신의 글자(안쪽 표의 글자 제외) */
function readTables(xml: string): Table[] {
  const tables: Table[] = [];
  const stack: Array<{ table: Table; cell: Cell | null }> = [];
  const token = /<hp:tbl\b([^>]*)>|<\/hp:tbl>|<hp:tc\b[^>]*>|<\/hp:tc>|<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>|<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"\/>|<hp:t>([\s\S]*?)<\/hp:t>/g;
  for (const m of xml.matchAll(token)) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith("<hp:tbl")) {
      const attrs = m[1] ?? "";
      const table: Table = { rowCnt: Number(/rowCnt="(\d+)"/.exec(attrs)?.[1]), colCnt: Number(/colCnt="(\d+)"/.exec(attrs)?.[1]), cells: [] };
      tables.push(table);
      stack.push({ table, cell: null });
    } else if (m[0] === "</hp:tbl>") stack.pop();
    else if (!top) continue;
    else if (m[0].startsWith("<hp:tc")) {
      top.cell = { row: -1, col: -1, rowSpan: 1, colSpan: 1, text: "" };
      top.table.cells.push(top.cell);
    } else if (m[0] === "</hp:tc>") top.cell = null;
    else if (m[2] !== undefined && top.cell) {
      top.cell.col = Number(m[2]);
      top.cell.row = Number(m[3]);
    } else if (m[4] !== undefined && top.cell) {
      top.cell.colSpan = Number(m[4]);
      top.cell.rowSpan = Number(m[5]);
    } else if (m[6] !== undefined && top.cell) top.cell.text += unescape(m[6].replace(/<hp:lineBreak\/>/g, "\n").replace(/<[^>]+>/g, ""));
  }
  return tables;
}

const cellAt = (t: Table | undefined, row: number, col: number): string => (t?.cells.find((c) => c.row === row && c.col === col)?.text ?? "∅").trim();
const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

/** 표의 칸이 행×열 격자를 빈틈·겹침 없이 덮는가 — 문제가 있으면 설명 */
function gridProblem(t: Table): string | null {
  const grid = Array.from({ length: t.rowCnt }, () => new Array<number>(t.colCnt).fill(0));
  for (const c of t.cells) {
    for (let r = c.row; r < c.row + c.rowSpan; r += 1) {
      for (let k = c.col; k < c.col + c.colSpan; k += 1) {
        if (r >= t.rowCnt || k >= t.colCnt) return `(${c.row},${c.col}) 칸이 표 밖으로 나감`;
        grid[r][k] += 1;
      }
    }
  }
  for (let r = 0; r < t.rowCnt; r += 1) for (let k = 0; k < t.colCnt; k += 1) if (grid[r][k] !== 1) return `(${r},${k}) 를 덮는 칸 ${grid[r][k]}개`;
  return null;
}

const visibleText = (xml: string): string =>
  [...xml.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((m) => unescape((m[1] ?? "").replace(/<hp:lineBreak\/>/g, "\n").replace(/<[^>]+>/g, ""))).join("\n");

/** XML 짜임 — 여닫는 요소가 맞고, 글자에 날것의 & 가 없다 */
function wellFormed(xml: string): string | null {
  const stack: string[] = [];
  let last = 0;
  for (const m of xml.matchAll(/<([^>]*)>/g)) {
    const between = xml.slice(last, m.index);
    if (XML_ENTITY.test(between) || between.includes(">")) return `바꾸지 않은 글자 — ${between.slice(0, 40)}`;
    last = (m.index ?? 0) + m[0].length;
    const inner = m[1] ?? "";
    if (inner.startsWith("?") || inner.startsWith("!")) continue;
    if (inner.startsWith("/")) {
      if (stack.pop() !== inner.slice(1).trim()) return `닫는 요소가 맞지 않음: ${inner}`;
      continue;
    }
    if (inner.endsWith("/")) continue;
    stack.push(inner.split(/\s/)[0] ?? "");
  }
  return stack.length === 0 ? null : `닫히지 않은 요소: ${stack.slice(-3).join(" > ")}`;
}

const landscape = (xml: string): string => /<hp:pagePr [^>]*landscape="(\w+)"/.exec(xml)?.[1] ?? "";

// ── 값 ──────────────────────────────────────────────────────────────
const fieldsOf = (docId: string): Array<{ key: string; label: string }> =>
  (getDocumentSync(docId)?.sections ?? []).flatMap((s) => (s.fields ?? []).map((f) => ({ key: f.key, label: f.label || f.key })));

function values(docId: string, scalar: Record<string, string>, rows: Record<string, Array<Record<string, string>>> = {}): FormValues {
  return { scalar: new Map(Object.entries(scalar)), rows: new Map(Object.entries(rows)), labels: new Map(fieldsOf(docId).map((f) => [f.key, f.label])) };
}

/** 칸 지도에서 이 칸이 어떤 꼴로 쓰이는지 — 날짜·숫자·체크 칸은 맞는 견본 값을 준다 */
function usage(map: FormMap): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (k: string, how: string): void => {
    if (!out.has(k)) out.set(k, new Set());
    out.get(k)?.add(how);
  };
  for (const c of map.cells ?? []) {
    for (const m of c.template.matchAll(PLACEHOLDER)) add(m[1], m[2] ?? "plain");
    if (c.when) add(c.when.key, "when");
  }
  for (const c of map.checks ?? []) add(c.field, c.mode === "yes" ? "yes" : "check");
  return out;
}

/** 서식이 쓰는 모든 칸의 견본 값 — 특수 문자를 일부러 넣는다 */
function sampleScalar(docId: string, map: FormMap): Record<string, string> {
  const out: Record<string, string> = {};
  const use = usage(map);
  for (const f of fieldsOf(docId)) {
    const how = use.get(f.key) ?? new Set(["plain"]);
    if ([...how].some((h) => /^(Y|M|D|dow|h|min|date|time)$/.test(h))) out[f.key] = "2026-03-15 09:30";
    else if ([...how].some((h) => /^d\d+$/.test(h))) out[f.key] = "830101-1";
    else if (how.has("num") || how.has("million")) out[f.key] = "45";
    else if ([...how].some((h) => h.startsWith("after:"))) out[f.key] = `[√] 외국인 [${[...how].find((h) => h.startsWith("after:"))?.slice(6)}: 견본국]`;
    else if (how.has("yes")) out[f.key] = "[√] 예";
    else if (how.has("check")) out[f.key] = "[√] 견본 아님";
    else out[f.key] = `${f.label} 값 <A&B>`;
  }
  return out;
}

function sectionOf(data: Buffer): string {
  return (unzip(data).get(SECTION) ?? Buffer.alloc(0)).toString("utf8");
}

// ── 1. 서식 원본 ─────────────────────────────────────────────────────
function testSources(): void {
  const ids = officialFormDocIds();
  check(`서식 원본: ${FORM_DOC_COUNT}종 문서에 칸 지도가 있다`, ids.length === FORM_DOC_COUNT, ids.join(","));
  for (const docId of ids) {
    const keys = new Set(fieldsOf(docId).map((f) => f.key));
    for (const map of officialFormMaps(docId)) {
      check(`서식 원본: ${docId} 파일과 문서 종류가 있다`, existsSync(officialFormPath(map)) && getDocumentSync(docId) !== undefined, map.file);
      const s = map.source;
      check(`서식 원본: ${docId} 출처(법령·서식·법제처 주소·받은 날·해시·변환 기록)`, Boolean(s.law && s.form && s.url.startsWith("https://www.law.go.kr/") && /^\d{4}-\d{2}-\d{2}$/.test(s.fetched) && /^[0-9a-f]{64}$/.test(s.sha256) && s.converted));
      const unknown = [...usage(map).keys()].filter((k) => !keys.has(k));
      check(`서식 원본: ${docId} 칸 지도의 칸 이름이 모두 문서의 칸이다`, unknown.length === 0, unknown.join(", "));
    }
  }
}

// ── 2. 빈 입력 · 3. 짜임 ─────────────────────────────────────────────
function testUntouchedAndStructure(): void {
  for (const docId of officialFormDocIds()) {
    for (const map of officialFormMaps(docId)) {
      const orig = unzip(readFileSync(officialFormPath(map)));
      const origSection = (orig.get(SECTION) ?? Buffer.alloc(0)).toString("utf8");
      const empty = fillOfficialForm(docId, values(docId, map.when ? { [map.when.key]: map.when.in?.[0] ?? map.when.has?.[0] ?? "" } : {}));
      if (!empty) {
        check(`빈 입력: ${docId} 서식을 만든다`, false);
        continue;
      }
      const emptyEntries = unzip(empty.data);
      if (!map.when) {
        check(`빈 입력: ${docId} 서식이 원본 그대로(줄 배치 캐시만 빠짐)`, sectionOf(empty.data) === origSection.replace(LINESEG, ""));
        check(`빈 입력: ${docId} 서식에 칸이 없다는 알림 없음`, empty.notInForm.length === 0, empty.notInForm.join(" / "));
      }
      const others = [...orig.keys()].filter((k) => k !== SECTION);
      check(
        `빈 입력: ${docId} 본문 밖 항목은 같은 순서·같은 바이트, mimetype 이 맨 앞`,
        JSON.stringify([...emptyEntries.keys()]) === JSON.stringify([...orig.keys()]) && others.every((k) => emptyEntries.get(k)?.equals(orig.get(k) as Buffer)) && [...emptyEntries.keys()][0] === "mimetype",
      );

      const filled = fillOfficialForm(docId, values(docId, sampleScalar(docId, map)));
      const section = filled ? sectionOf(filled.data) : "";
      check(`짜임: ${docId} 본문 XML`, wellFormed(section) === null, wellFormed(section) ?? "");
      check(`짜임: ${docId} 용지 방향 그대로`, landscape(section) === landscape(origSection) && landscape(origSection) !== "");
      const before = readTables(origSection);
      const after = readTables(section);
      check(`짜임: ${docId} 표 수·열 수 그대로`, before.length === after.length && before.every((t, i) => t.colCnt === after[i]?.colCnt));
      const problems = after.map((t, i) => (gridProblem(t) ? `표${i} ${gridProblem(t)}` : null)).filter(Boolean);
      check(`짜임: ${docId} 모든 표의 칸이 격자를 빈틈·겹침 없이 덮는다`, problems.length === 0, problems.join(" / "));
      check(`짜임: ${docId} 특수 문자를 바꿔 넣는다`, !section.includes("<A&B>") && section.includes("&lt;A&amp;B&gt;"));
    }
  }
}

// ── 4. 자리 ─────────────────────────────────────────────────────────
const ACCIDENT = {
  industryCode: "11-1234567-1-001", businessRegNo: "123-45-67890", siteName: "황룡건설(주)", totalWorkforce: "85명", industry: "아파트건설업(41221)",
  address: "서울특별시 강남구 테헤란로 123", developerType: "[√] 국가·지방자치단체 — 서울시", primaryContractorName: "황룡건설(주)", primaryContractorCode: "11-1234567-1-001",
  constructionSiteName: "○○아파트 신축공사", constructionType: "아파트", constructionProgress: "45%", constructionAmount: "4500 (45억)",
  injuredName: "응우옌 반 안", injuredId: "830101-5", injuredAddress: "경기도 수원시 팔달구 ○○로 12", injuredMobile: "010-1234-5678",
  injuredNationality: "[√] 외국인 [국적: 베트남 / 체류자격: E-9]", residenceStatus: "E-9", injuredOccupation: "철근공", hireDate: "2025-03-02",
  sameWorkTenure: "8년 3월", employmentType: "[√] 일용", workForm: "[√] 그 밖의 사항 [고정 야간근무]", injuryType: "골절", injuryPart: "왼쪽 다리",
  leaveDays: "휴업 30일", fatalFlag: "(미사망 — 휴업만)", occurrenceDate: "2026-04-24 14:30", occurrenceLocation: "지상 5층 슬래브 단부",
  workTypeAtAccident: "5층 슬래브 단부에서 철근을 배근하던 중", circumstancesAtAccident: "안전난간이 해체된 단부에서 균형을 잃고 떨어짐",
  accidentCause: "안전난간 해체 후 복구 미흡", preventionPlan: "단부 안전난간 상시 유지", freeTechnicalSupportRequest: "[√] 요청", benefitGuidanceConsent: "동의",
  preparedByName: "김안전", preparedByPhone: "02-123-4567", preparedDate: "2026-04-28", submitTo: "(서울지방고용노동청 강남지청)",
};

function testPlacement(): void {
  const filled = fillOfficialForm("industrial_accident_report", values("industrial_accident_report", ACCIDENT));
  const t = readTables(filled ? sectionOf(filled.data) : "");
  const [form, rrn] = [t[0], t[1]];
  check("별지30: 사업장 정보 칸", cellAt(form, 4, 9) === "11-1234567-1-001" && cellAt(form, 5, 9) === "황룡건설(주)" && cellAt(form, 5, 26) === "85명" && squash(cellAt(form, 6, 26)) === "( - ) 서울특별시 강남구 테헤란로 123");
  check("별지30: 발주자 — 고른 것만 √", squash(cellAt(form, 9, 24)) === "[ ]민간 [√ ]국가ㆍ지방자치단체 [ ]공공기관", cellAt(form, 9, 24));
  check("별지30: 공정률은 숫자만, 공사금액은 백만원으로 — 서식의 단위 그대로", cellAt(form, 12, 33) === "45 %" && squash(cellAt(form, 12, 38)) === "공사금액 4,500 백만원", `${cellAt(form, 12, 33)} / ${cellAt(form, 12, 38)}`);
  // 공사금액은 원·억·백만원 어느 표기로 와도 서식의 백만원 칸에 맞게 (문서 안내 예시는 원 단위)
  for (const [input, want] of [["32,000,000,000", "32,000"], ["320억원", "32,000"], ["1억 5천만원", "150"], ["15억3천만", "1,530"], ["3.2억", "320"], ["4,500백만원", "4,500"], ["1,250만원", "12.5"], ["4500", "4,500"], ["4500 (45억)", "4,500"]] as const) {
    const amount = fillOfficialForm("industrial_accident_report", values("industrial_accident_report", { constructionAmount: input }));
    const got = squash(cellAt(readTables(amount ? sectionOf(amount.data) : "")[0], 12, 38));
    check(`별지30: 공사금액 "${input}" → 백만원 ${want}`, got === `공사금액 ${want} 백만원`, got);
  }
  // 국적 칸에 나라 이름만 적어도 외국인 √ 와 국적, "한국" 은 내국인
  for (const [input, want] of [
    ["베트남", "[ ]내국인 [√ ]외국인 [국적: 베트남 ⑩체류자격: ]"],
    ["미국", "[ ]내국인 [√ ]외국인 [국적: 미국 ⑩체류자격: ]"],
    ["부탄", "[ ]내국인 [√ ]외국인 [국적: 부탄 ⑩체류자격: ]"],
    ["한국", "[√ ]내국인 [ ]외국인 [국적: ⑩체류자격: ]"],
    ["대한민국", "[√ ]내국인 [ ]외국인 [국적: ⑩체류자격: ]"],
  ] as const) {
    const nat = fillOfficialForm("industrial_accident_report", values("industrial_accident_report", { injuredNationality: input }));
    const got = squash(cellAt(readTables(nat ? sectionOf(nat.data) : "")[0], 16, 7));
    check(`별지30: 국적 "${input}"`, got === want && nat?.notInForm.length === 0, `${got} / ${nat?.notInForm.join(" / ")}`);
  }
  check("별지30: 주민등록번호 앞 7자리는 칸마다 한 자, 뒤 6자리는 * 그대로", [0, 1, 2, 3, 4, 5].map((c) => cellAt(rrn, 0, c)).join("") === "830101" && cellAt(rrn, 0, 7) === "5" && cellAt(rrn, 0, 8) === "*");
  check("별지30: 국적 — 외국인 √, 국적·체류자격은 서식 괄호 안", squash(cellAt(form, 16, 7)) === "[ ]내국인 [√ ]외국인 [국적: 베트남 ⑩체류자격: E-9 ]", cellAt(form, 16, 7));
  check("별지30: 고용형태 — 고른 것만 √", squash(cellAt(form, 18, 7)).startsWith("[ ]상용 [ ]임시 [√ ]일용 [ ]무급가족종사자"), cellAt(form, 18, 7));
  check("별지30: 근무형태 — 그 밖의 사항 √ 와 괄호 안 내용", squash(cellAt(form, 19, 7)).endsWith("[√ ]그 밖의 사항 [고정 야간근무 ]"), cellAt(form, 19, 7));
  check("별지30: 미사망이면 사망 칸 비움, 휴업일수는 서식 괄호 안", squash(cellAt(form, 21, 39)) === "[ ] 사망" && squash(cellAt(form, 20, 39)) === "휴업 [ 30 ]일");
  check("별지30: 발생일시 — 연·월·일·요일·시·분", squash(cellAt(form, 22, 13)) === "[ 2026 ]년 [ 4 ]월 [ 24 ]일 [ 금 ]요일 [ 14 ]시 [ 30 ]분", cellAt(form, 22, 13));
  check("별지30: 개요·원인·재발방지 계획 칸", cellAt(form, 23, 13) === "지상 5층 슬래브 단부" && cellAt(form, 26, 13) === "안전난간 해체 후 복구 미흡" && cellAt(form, 27, 2) === "단부 안전난간 상시 유지");
  check("별지30: 기술지원 요청·개인정보 활용 동의 √", squash(cellAt(form, 28, 28)) === "즉시 기술지원 서비스 요청 [√ ]" && cellAt(form, 29, 28).replace(/\s/g, "").endsWith("[√]"));
  check("별지30: 작성자·작성일", cellAt(form, 30, 8) === "김안전" && squash(cellAt(form, 31, 20)) === "작성일 2026년 4월 28일");
  check("별지30: 사업주·근로자대표 서명 칸은 입력이 없으면 서식 그대로", squash(cellAt(form, 32, 0)) === "사업주" && squash(cellAt(form, 33, 0)) === "근로자대표(재해자)" && squash(cellAt(form, 32, 26)) === "(서명 또는 인)");
  check("별지30: 제출처 — 관서 이름이 온전히 오면 그대로", squash(cellAt(form, 34, 0)) === "서울지방고용노동청 강남지청장 귀하", cellAt(form, 34, 0));
  const short = fillOfficialForm("industrial_accident_report", values("industrial_accident_report", { submitTo: "중부", fatalFlag: "[√] 사망", injuredNationality: "내국인" }));
  const st = readTables(short ? sectionOf(short.data) : "")[0];
  check("별지30: 제출처가 지역 이름뿐이면 서식 괄호 안에", squash(cellAt(st, 34, 0)) === "( 중부 )지방고용노동청장(지청장) 귀하", cellAt(st, 34, 0));
  check("별지30: 사망이면 사망 칸 √, 내국인이면 국적 괄호는 비움", squash(cellAt(st, 21, 39)) === "[√ ] 사망" && squash(cellAt(st, 16, 7)) === "[√ ]내국인 [ ]외국인 [국적: ⑩체류자격: ]", `${cellAt(st, 21, 39)} / ${cellAt(st, 16, 7)}`);
  check("별지30: 넣은 입력은 모두 자리를 찾았다", filled?.notInForm.length === 0, filled?.notInForm.join(" / "));
  // 표시가 하나뿐인 칸은 긍정 낱말일 때만 고르고, 정하지 못하면 알린다
  for (const [input, ticked, noted] of [["사망", true, false], ["예", true, false], ["(미사망 — 휴업만)", false, false], ["해당 없음", false, false], ["부상", false, true]] as const) {
    const fatal = fillOfficialForm("industrial_accident_report", values("industrial_accident_report", { fatalFlag: input }));
    const got = squash(cellAt(readTables(fatal ? sectionOf(fatal.data) : "")[0], 21, 39));
    check(`별지30: 사망 여부 "${input}" → ${ticked ? "√" : "비움"}${noted ? " + 알림" : ""}`, got === (ticked ? "[√ ] 사망" : "[ ] 사망") && (fatal?.notInForm.length ?? 0) > 0 === noted, `${got} / ${fatal?.notInForm.join(" / ")}`);
  }
  // 값은 있는데 칸 꼴로 읽지 못하면 칸을 비우고 알린다 (조용히 버리지 않는다)
  const unread = fillOfficialForm("industrial_accident_report", values("industrial_accident_report", { constructionAmount: "사억", occurrenceDate: "2026-04-24" }));
  const ut = readTables(unread ? sectionOf(unread.data) : "")[0];
  check(
    "별지30: 읽지 못한 금액·시각은 칸을 비우고 알린다",
    squash(cellAt(ut, 12, 38)) === "공사금액 백만원" &&
      squash(cellAt(ut, 22, 13)) === "[ 2026 ]년 [ 4 ]월 [ 24 ]일 [ 금 ]요일 [ ]시 [ ]분" &&
      (unread?.notInForm ?? []).some((n) => n.includes("사억") && n.includes("백만원 금액")) &&
      (unread?.notInForm ?? []).some((n) => n.includes("2026-04-24") && n.includes("시·분")),
    unread?.notInForm.join(" / "),
  );
  const odd = fillOfficialForm("industrial_accident_report", values("industrial_accident_report", { employmentType: "파견" }));
  const oddCell = cellAt(readTables(odd ? sectionOf(odd.data) : "")[0], 18, 7);
  check("별지30: 서식 칸에 없는 고용형태는 그 밖의 사항 괄호 안에", squash(oddCell).endsWith("[√ ]그 밖의 사항 [파견 ]"), oddCell);
}

// ── 5. 잃지 않음 ─────────────────────────────────────────────────────
function testNothingLost(): void {
  for (const docId of officialFormDocIds()) {
    for (const map of officialFormMaps(docId)) {
      const use = usage(map);
      const sample = sampleScalar(docId, map);
      const filled = fillOfficialForm(docId, values(docId, sample));
      const text = visibleText(filled ? sectionOf(filled.data) : "");
      const notes = (filled?.notInForm ?? []).join("\n");
      // 그대로 적는 칸만 본다 — 날짜·숫자·체크 칸은 자리 시험이 본다
      const lost = Object.entries(sample).filter(([k, v]) => [...(use.get(k) ?? new Set(["plain"]))].every((h) => h === "plain") && !text.includes(v) && !notes.includes(v));
      check(`잃지 않음: ${docId} 입력값은 한글 파일에 있거나 notInForm 으로 알린다`, lost.length === 0, lost.slice(0, 5).map(([k]) => k).join(" / "));
    }
  }
}

// ── 6. 정본 ─────────────────────────────────────────────────────────
async function testCanonical(): Promise<void> {
  const r = (await generateSafetyDocumentTool.handler({ docId: "industrial_accident_report", draft: ACCIDENT, format: "hwpx", useProfile: false })) as {
    structuredContent?: { hwpxPath?: string; dclxPath?: string; officialForm?: { form: string; notInForm: string[] } };
  };
  const sc = r.structuredContent ?? {};
  const saved = sc.hwpxPath ? readFileSync(sc.hwpxPath) : Buffer.alloc(0);
  const documentXml = sc.dclxPath ? unpackDclx(readFileSync(sc.dclxPath)).documentXml : "";
  const again = await officialFormFromDoclang("industrial_accident_report", documentXml);
  check("정본: 생성한 한글 파일이 저장된 정본에서 다시 만든 것과 같다", Boolean(again) && sectionOf(saved) === sectionOf(again?.data ?? Buffer.alloc(0)) && saved.length > 0);
  check("정본: 생성 결과가 법정 서식과 알림을 알려 준다", sc.officialForm?.form.includes("별지 제30호서식") === true && Array.isArray(sc.officialForm?.notInForm));
  const back = formValuesFromDoclang(fieldsOf("industrial_accident_report"), documentXml);
  const missing = Object.entries(ACCIDENT).filter(([k, v]) => back.scalar.get(k) !== v);
  check("정본: 정본에서 되읽은 값이 입력과 같다", missing.length === 0, missing.slice(0, 5).map(([k, v]) => `${k}=${back.scalar.get(k)} (입력 ${v})`).join(" / "));
  const plain = (await generateSafetyDocumentTool.handler({ docId: "daily_tbm", draft: { workName: "철근 배근" }, format: "hwpx", useProfile: false })) as { structuredContent?: { hwpxPath?: string; officialForm?: unknown } };
  check("정본: 서식 원본이 없는 문서는 정본 블록으로 만든다", plain.structuredContent?.officialForm === undefined && Boolean(plain.structuredContent?.hwpxPath));
}

async function main(): Promise<void> {
  // 문서 노드 색인을 먼저 만든다 — 이후 칸 목록은 동기 조회로 읽는다
  await getDocument("industrial_accident_report");
  testSources();
  testUntouchedAndStructure();
  testPlacement();
  testNothingLost();
  await testCanonical();
  console.log(`[official-forms] ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

await main();
