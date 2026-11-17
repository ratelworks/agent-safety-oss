/**
 * official-form.ts — 법정 서식 원본(한글 HWPX)의 칸 배치를 그대로 두고 칸에 입력값만 채운다
 *
 * 서식 원본과 칸 지도는 official-form-map.ts. 값은 정본(.dclx 의 DocLang 문서)에서 되읽는다 — 문서를 만들 때와
 * 저장해 둔 정본에서 다시 만들 때 같은 한글 파일이 나온다.
 *   - 한 줄 값: 정본 끝의 칸 목록(<field_item> 의 이름·값) — 같은 이름이 둘이면 문서 칸 순서대로 짝짓는다
 *   - 표 값(기계 목록 등): 정본의 "{칸 이름} 상세" 표 — 머리 줄 이름을 칸 열 이름으로 되짚는다
 *
 * 지키는 것
 *   - 서식의 다른 항목(글꼴·그림·설정)은 바이트 그대로 옮기고 본문 XML 의 칸 글자만 바꾼다. 칸 배치·병합·용지 방향은 그대로다
 *   - 입력하지 않은 칸·서명 칸은 비워 두거나 서식의 틀 글자를 그대로 둔다(값을 지어내지 않는다)
 *   - 서식에 칸이 없는 입력값(문서번호 같은 실무 항목)은 notInForm 으로 알린다 — 정본에는 남아 있다
 *   - 줄 배치 정보(linesegarray)는 한글이 문서를 열 때 다시 계산하는 캐시라 모두 지운다(낡은 캐시로 그리지 않게)
 */

import { readFileSync } from "node:fs";
import { DETAIL_COLUMN_LABELS } from "./field-detail.js";
import { parseXml } from "./doclang-reader.js";
import { getDocument } from "./graph-nodes-loader.js";
import { type CheckSpec, type FormMap, type FormSource, type RowCell, type When, officialFormMaps, officialFormPath } from "./official-form-map.js";
import { unzip, zip } from "./zip.js";

// ── 상수 ────────────────────────────────────────────────────────────
const SECTION_RE = /^Contents\/section\d+\.xml$/u;
const MIMETYPE = "mimetype";
const CHECK_OFF = "□";
const CHECK_ON = "■";
const TICK = "√";
/** 비어 있는 자리 — 손으로 적을 수 있게 틀 사이를 띄운다 */
const BLANK = "    ";
const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/gu;
const PLACEHOLDER = /\{([^{}|]+)(?:\|([^{}]+))?\}/gu;
const DATE_PARTS = /^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})(?:일)?(?:\s*\([^)]*\))?(?:[ T]+(\d{1,2})[:시]\s*(\d{2}))?/u;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
/** 단위 없이 이보다 큰 금액은 원 단위로 본다 — 백만원 단위로 1천만(=10조 원)을 넘는 공사는 없다 */
const WON_THRESHOLD = 10_000_000;
const MILLION = 1_000_000;
/** 체크 칸 값에서 떼는 표시 — "[√] 일용" → "일용" */
const TICK_MARKS = /\[\s*[√✓v■xX]?\s*\]|[√✓■□]/gu;
/**
 * 부정·긍정은 낱말로 가린다 — 첫 글자로 가리면 나라 이름(미국·부탄)이나 "부상" 같은 말을 잘못 읽는다.
 * 부정: 낱말 하나가 NEGATIVE_WORDS 이거나, 띄어쓰기를 뗀 값 어디에든 NEGATIVE_PARTS 가 있음 — 부정은 긍정 낱말 뒤에도 온다("사망 아님", "동의 안 합니다").
 */
const NEGATIVE_WORDS = new Set(["no", "n", "not", "false", "x", "0", "-", "안", "못", "미해당", "비해당"]);
const NEGATIVE_PARTS = ["아님", "아니", "않", "안함", "안합", "안해", "안할", "안됨", "안 됨", "없음", "없다", "없습", "미사망", "미요청", "미동의", "미신청", "부동의", "비동의", "해당없", "불필요", "거부", "원치"];
/** 표시가 하나뿐인 체크 칸을 고르는 긍정 낱말 (칸 지도의 yesWords 를 더한다) */
const AFFIRMATIVE = ["예", "네", "y", "yes", "true", "o", "해당", "있음"];
/** 이름 비교에서 같게 보는 글자 — 가운뎃점 여러 꼴·띄어쓰기 */
const FLAT = /[\sㆍ·‧・.,()]/gu;
/** 정본 표의 상세 표 제목 */
const DETAIL_SUFFIX = " 상세";

export interface FilledForm {
  data: Buffer;
  /** 서식 이름 (예: 산업안전보건법 시행규칙 별지 제30호서식(산업재해조사표)) */
  form: string;
  source: FormSource;
  /** 서식에 칸이 없어 한글 파일에 넣지 못한 입력값 — "항목: 값" */
  notInForm: string[];
}

// ── 값 ──────────────────────────────────────────────────────────────

export interface FormValues {
  scalar: Map<string, string>;
  rows: Map<string, Array<Record<string, string>>>;
  /** 칸 이름 → 사람이 읽는 이름 (알림 문구용) */
  labels: Map<string, string>;
}

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: Array<Node | string>;
}
const textOf = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const c of node.children) if (typeof c !== "string") walk(c, visit);
}
const childByTag = (n: Node, tag: string): Node | undefined => n.children.find((c): c is Node => typeof c !== "string" && c.tag === tag);
const tidy = (s: string): string => s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
const flat = (s: string): string => s.replace(FLAT, "").toLowerCase();

/** OTSL 표(<otsl>)를 행 목록으로 — 칸은 <fcel>/<ecel> 뒤의 글, 줄은 <nl/> */
function otslRows(table: Node): string[][] {
  const otsl = childByTag(table, "otsl") ?? table;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell: string[] | null = null;
  const flush = (): void => {
    if (cell) row.push(tidy(cell.join("")));
    cell = null;
  };
  for (const c of otsl.children) {
    if (typeof c === "string") {
      cell?.push(c);
      continue;
    }
    if (c.tag === "fcel" || c.tag === "ecel" || c.tag === "ched" || c.tag === "rhed" || c.tag === "srow") {
      flush();
      cell = [];
    } else if (c.tag === "nl") {
      flush();
      rows.push(row);
      row = [];
    } else if (c.tag !== "caption") cell?.push(textOf(c));
  }
  flush();
  if (row.length) rows.push(row);
  return rows;
}

/** 문서의 칸 — 이름(key)과 사람이 읽는 이름(label) */
export interface FormField {
  key: string;
  label?: string;
}

/** 정본(DocLang 문서)에서 문서 칸의 값을 되읽는다 — fields 는 문서 노드의 칸(절 순서대로) */
export function formValuesFromDoclang(fields: FormField[], documentXml: string): FormValues {
  const labels = new Map(fields.map((f) => [f.key, f.label || f.key]));
  const scalar = new Map<string, string>();
  const rows = new Map<string, Array<Record<string, string>>>();
  const root = parseXml(documentXml) as Node;

  // 한 줄 값 — 같은 이름이 둘 이상이면(사내 수급인·파견 사업장의 산재관리번호) 문서 칸 순서대로 짝짓는다
  const used = new Set<number>();
  walk(root, (n) => {
    if (n.tag !== "field_item") return;
    const key = childByTag(n, "key");
    const value = childByTag(n, "value");
    if (!key || !value) return;
    const name = tidy(textOf(key));
    const index = fields.findIndex((f, i) => !used.has(i) && (f.label || f.key) === name);
    if (index < 0) return;
    used.add(index);
    const text = tidy(textOf(value));
    if (text) scalar.set(fields[index].key, text);
  });

  // 표 값 — "{칸 이름} 상세" 표, 머리 줄은 열 이름(field-detail 의 열 이름표 또는 열 키)
  const keyOfHeader = new Map<string, string>(Object.entries(DETAIL_COLUMN_LABELS).map(([k, v]) => [v, k]));
  walk(root, (n) => {
    if (n.tag !== "table") return;
    const caption = tidy(textOf(childByTag(n, "caption") ?? { tag: "", attrs: {}, children: [] }));
    if (!caption.endsWith(DETAIL_SUFFIX)) return;
    const field = fields.find((f) => `${f.label || f.key}${DETAIL_SUFFIX}` === caption);
    if (!field) return;
    const [header = [], ...body] = otslRows(n);
    const keys = header.map((h) => keyOfHeader.get(h) ?? h);
    const list = body
      .map((cells) => Object.fromEntries(cells.map((v, i) => [keys[i] ?? `col${i}`, v]).filter(([, v]) => v !== "")))
      .filter((r) => Object.keys(r).length > 0);
    if (list.length) rows.set(field.key, list);
  });
  return { scalar, rows, labels };
}

// ── 값 꼴 ───────────────────────────────────────────────────────────

/** 값의 한 부분 — 날짜(연·월·일·요일·시·분), 숫자 N번째 글자 */
function valuePart(value: string, part: string): string {
  if (part.startsWith("after:")) {
    const label = part.slice("after:".length).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`${label}\\s*[:：]?\\s*([^/\\],;]+)`, "u").exec(value)?.[1]?.trim() ?? "";
  }
  if (part === "num") return /\d[\d,]*(?:\.\d+)?/u.exec(value)?.[0] ?? "";
  if (part === "million") return toMillionWon(value);
  if (part === "bare") return value.trim().replace(/^[([{（]\s*/u, "").replace(/\s*[)\]}）]$/u, "").trim();
  const digit = /^d(\d+)$/u.exec(part);
  if (digit) return value.replace(/\D/gu, "")[Number(digit[1]) - 1] ?? "";
  const m = DATE_PARTS.exec(value.trim());
  // 날짜로 읽지 못하면 네 자리 해만 연도로 — 나머지는 비우고 render 가 알린다("미정" 을 연도 칸에 적지 않는다)
  if (!m) return part === "Y" ? (/(?:^|\D)(\d{4})(?:\D|$)/u.exec(value)?.[1] ?? "") : "";
  const [, y, mo, d, hh, mm] = m as unknown as [string, string, string, string, string | undefined, string | undefined];
  switch (part) {
    case "Y": return y;
    case "M": return String(Number(mo));
    case "D": return String(Number(d));
    case "dow": return WEEKDAYS[new Date(Number(y), Number(mo) - 1, Number(d)).getDay()] ?? "";
    case "h": return hh !== undefined ? String(Number(hh)) : "";
    case "min": return mm ?? "";
    case "time": return hh !== undefined ? `${hh.padStart(2, "0")}:${mm}` : "";
    case "date": return `${y}. ${Number(mo)}. ${Number(d)}.`;
    default: return value;
  }
}

/** 값 꼴의 이름 (알림 문구) */
function partLabel(part: string): string {
  const names: Record<string, string> = { Y: "연", M: "월", D: "일", dow: "요일", h: "시", min: "분", time: "시각", date: "날짜", num: "숫자", million: "백만원 금액", bare: "글" };
  if (part.startsWith("after:")) return part.slice("after:".length);
  const digit = /^d(\d+)$/u.exec(part);
  return digit ? `${digit[1]}번째 숫자` : (names[part] ?? part);
}

/** 숫자에 세 자리마다 쉼표 */
const withCommas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");

const BIG_UNITS: Record<string, number> = { 조: 1e12, 억: 1e8, 만: 1e4 };
const SMALL_UNITS: Record<string, number> = { 천: 1e3, 백: 1e2, 십: 10 };

/**
 * 한국어 금액 표기를 원으로 — "1억 5천만원" · "15억3천만" · "3.2억" · "32,000,000,000원" · "1,250만원". 단위가 하나라도 있으면 hasUnit.
 * 숫자·단위·"원"·"약" 말고 다른 글이 남으면 null(읽지 못함) — 아는 만큼만 읽고 나머지를 버리지 않는다.
 */
function parseKoreanWon(text: string): { won: number; hasUnit: boolean } | null {
  const s = text.replace(/[\s,]/gu, "").replace(/^약/u, "").replace(/원$/u, "");
  if (!/\d/u.test(s)) return null;
  let total = 0;
  let section = 0;
  let hasUnit = false;
  let pending: number | null = null;
  const re = /(\d+(?:\.\d+)?)|([천백십])|([조억만])/gy;
  let at = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    at = re.lastIndex;
    if (m[1] !== undefined) {
      if (pending !== null) section += pending;
      pending = Number(m[1]);
    } else if (m[2] !== undefined) {
      section += (pending ?? 1) * (SMALL_UNITS[m[2]] as number);
      pending = null;
      hasUnit = true;
    } else if (m[3] !== undefined) {
      total += (section + (pending ?? (section === 0 ? 1 : 0))) * (BIG_UNITS[m[3]] as number);
      section = 0;
      pending = null;
      hasUnit = true;
    }
  }
  if (at !== s.length) return null;
  return { won: total + section + (pending ?? 0), hasUnit };
}

/**
 * 금액을 백만원 단위로 — "32,000,000,000"(원) · "1억 5천만원" · "320억원" · "4,500백만원" · "4500"(백만원) · "4500 (45억)".
 * 괄호 뒤의 덧붙인 말은 읽지 않는다. 단위가 없는 숫자는 크기로 가린다(WON_THRESHOLD 이상은 원, 미만은 백만원).
 * 읽지 못하면 빈 글 — render 가 알림으로 올린다.
 */
function toMillionWon(value: string): string {
  const head = value.split(/[(（]/u)[0]?.trim() ?? "";
  const million = /^([\d,]+(?:\.\d+)?)\s*백만\s*원?$/u.exec(head.replace(/^약\s*/u, ""));
  let m: number;
  if (million) m = Number((million[1] as string).replace(/,/gu, ""));
  else {
    const parsed = parseKoreanWon(head);
    if (!parsed) return "";
    m = parsed.hasUnit || parsed.won >= WON_THRESHOLD || /원\s*$/u.test(head) ? parsed.won / MILLION : parsed.won;
  }
  if (!Number.isFinite(m) || m <= 0) return "";
  // 백만원 아래 자리는 소수 한 자리까지 (12.5 백만원)
  const rounded = Math.round(m * 10) / 10;
  const [int, frac] = String(rounded).split(".");
  return withCommas(Number(int)) + (frac ? `.${frac}` : "");
}

/**
 * template 의 {이름} 자리를 값으로 — 모든 자리가 비면 null(칸을 건드리지 않는다).
 * 값은 있는데 그 칸의 꼴(날짜·금액·숫자 자리 등)로 읽지 못하면 unreadable 에 이름·값을 담는다 — 조용히 버리지 않는다.
 */
function render(template: string, lookup: (name: string) => string, used?: Set<string>, unreadable?: Map<string, string>): string | null {
  let any = !new RegExp(PLACEHOLDER.source, "u").test(template);
  const out = template.replace(PLACEHOLDER, (_m, name: string, part?: string) => {
    used?.add(name);
    const raw = lookup(name).trim();
    const value = raw && part ? valuePart(raw, part) : raw;
    if (raw && !value && part) unreadable?.set(`${name}\u0000${part}`, raw);
    if (value) any = true;
    return value || BLANK;
  });
  return any ? out : null;
}

function matches(when: When | undefined, lookup: (name: string) => string, used: Set<string>): boolean {
  if (!when) return true;
  used.add(when.key);
  const v = lookup(when.key).trim();
  if (!v) return false;
  const f = flat(v);
  if (when.in && !when.in.some((x) => flat(x) === f)) return false;
  if (when.has && !when.has.some((x) => f.includes(flat(x)))) return false;
  if (when.notHas && when.notHas.some((x) => f.includes(flat(x)))) return false;
  return true;
}

// ── HWPX 본문 XML ───────────────────────────────────────────────────

interface Range { start: number; end: number }
interface Cell extends Range { row: number; col: number; rowSpan: number; colSpan: number }

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 문서 순서대로 모든 표(중첩 포함)의 범위 */
function scanTables(xml: string): Range[] {
  const out: Range[] = [];
  const stack: number[] = [];
  for (const m of xml.matchAll(/<hp:tbl\b|<\/hp:tbl>/gu)) {
    if (m[0] === "</hp:tbl>") {
      const start = stack.pop();
      if (start === undefined) continue;
      const item = out.find((r) => r.start === start);
      if (item) item.end = (m.index ?? 0) + m[0].length;
    } else {
      stack.push(m.index ?? 0);
      out.push({ start: m.index ?? 0, end: -1 });
    }
  }
  return out.filter((r) => r.end > r.start);
}

/** 표의 직속 요소(tr 또는 tc)의 범위 — 중첩 표 안의 것은 뺀다 */
function directChildren(xml: string, table: Range, tag: "tr" | "tc"): Range[] {
  const out: Range[] = [];
  let depth = 0;
  let open = -1;
  const re = new RegExp(`<hp:tbl\\b|</hp:tbl>|<hp:${tag}\\b|</hp:${tag}>`, "gu");
  re.lastIndex = table.start;
  for (let m = re.exec(xml); m && m.index < table.end; m = re.exec(xml)) {
    const t = m[0];
    if (t.startsWith("<hp:tbl")) depth += 1;
    else if (t === "</hp:tbl>") depth -= 1;
    else if (depth === 1 && t.startsWith(`<hp:${tag}`)) open = m.index;
    else if (depth === 1 && t === `</hp:${tag}>` && open >= 0) {
      out.push({ start: open, end: m.index + t.length });
      open = -1;
    }
  }
  return out;
}

/** 칸 자신의 주소·병합 — 칸 안 중첩 표의 칸이 아니라 마지막에 나오는 자기 것 */
function cellInfo(xml: string, r: Range): Cell {
  const seg = xml.slice(r.start, r.end);
  const addr = [...seg.matchAll(/<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/gu)].pop();
  const span = [...seg.matchAll(/<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"\/>/gu)].pop();
  return { ...r, col: Number(addr?.[1] ?? -1), row: Number(addr?.[2] ?? -1), colSpan: Number(span?.[1] ?? 1), rowSpan: Number(span?.[2] ?? 1) };
}

const cellsOf = (xml: string, table: Range): Cell[] => directChildren(xml, table, "tc").map((r) => cellInfo(xml, r));

/** 글자를 줄바꿈 표시가 있는 <hp:t> 내용으로 */
const textRun = (text: string): string => text.split("\n").map(escapeXml).join("<hp:lineBreak/>");

/** 문단 하나의 글자를 바꾼다 — 문단 모양과 첫 글자 모양은 그대로 */
function rewriteParagraph(p: string, text: string): string {
  const open = /^<hp:p\b[^>]*>/u.exec(p)?.[0];
  if (!open) return p;
  const charPr = /<hp:run charPrIDRef="(\d+)"/u.exec(p)?.[1] ?? "0";
  const body = text === "" ? `<hp:run charPrIDRef="${charPr}"/>` : `<hp:run charPrIDRef="${charPr}"><hp:t>${textRun(text)}</hp:t></hp:run>`;
  return `${open}${body}</hp:p>`;
}

/** 칸 안 글 범위(subList 안쪽) — 칸 안에 표가 있으면 null */
function cellBody(cell: string): { from: number; to: number; inner: string } | null {
  const open = cell.search(/<hp:subList\b/u);
  const close = cell.lastIndexOf("</hp:subList>");
  if (open < 0 || close < 0) return null;
  const from = cell.indexOf(">", open) + 1;
  const inner = cell.slice(from, close);
  return inner.includes("<hp:tbl") ? null : { from, to: close, inner };
}

/** 칸의 글자를 바꾼다 — 첫 문단의 모양으로 한 문단만 남긴다 */
function rewriteCell(cell: string, text: string): string {
  const body = cellBody(cell);
  const firstP = body && /<hp:p\b[\s\S]*?<\/hp:p>/u.exec(body.inner)?.[0];
  if (!body || !firstP) return cell;
  return cell.slice(0, body.from) + rewriteParagraph(firstP, text) + cell.slice(body.to);
}

/** 칸에 인쇄된 항목 이름을 두고 그 아래에 값 문단을 더한다 — 마지막 문단의 모양을 따른다 */
function appendToCell(cell: string, text: string): string {
  const body = cellBody(cell);
  const paragraphs = body ? [...body.inner.matchAll(/<hp:p\b[\s\S]*?<\/hp:p>/gu)].map((m) => m[0]) : [];
  const last = paragraphs[paragraphs.length - 1];
  if (!body || !last) return cell;
  return cell.slice(0, body.to) + rewriteParagraph(last, text) + cell.slice(body.to);
}

/** 칸 안의 보이는 글자와 그 글자의 XML 자리 (글 조각 사이는 띄어 읽는다) */
function visibleMap(cell: string): { text: string; at: number[] } {
  const at: number[] = [];
  let text = "";
  for (const m of cell.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/gu)) {
    if (text) {
      at.push(-1);
      text += " ";
    }
    const base = (m.index ?? 0) + "<hp:t>".length;
    for (const piece of (m[1] ?? "").matchAll(/[^<]+|<[^>]+>/gu)) {
      if (piece[0].startsWith("<")) continue;
      // &amp; 같은 글자 참조는 한 글자로 읽는다(자리는 참조의 첫 글자)
      for (const ch of piece[0].matchAll(/&[a-z#0-9]+;|[\s\S]/gu)) {
        at.push(base + (piece.index ?? 0) + (ch.index ?? 0));
        text += ch[0].length > 1 ? ch[0].replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">") : ch[0];
      }
    }
  }
  return { text, at };
}

/** 칸 안 XML 의 한 글자(자리 at)를 다른 글로 바꾼다 */
const replaceAt = (cell: string, at: number, text: string): string => cell.slice(0, at) + escapeXml(text) + cell.slice(at + 1);

/** 글 너비 — 한글·한자 등 넓은 글자는 2, 나머지는 1 (빈칸을 덜어 낼 만큼을 셈하는 데만 쓴다) */
const width = (s: string): number => [...s].reduce((n, ch) => n + (/[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/u.test(ch) ? 2 : 1), 0);

/**
 * 보이는 글자 i 에서 시작하는 빈칸 줄을 text 로 채운다 — 넣은 글 너비만큼 뒤 빈칸을 덜어 내 줄 길이를 지킨다(빈칸 하나는 남긴다).
 * 빈칸 줄은 XML 에서 이어진 글자까지만 센다(글 조각이 바뀌면 거기서 멈춘다).
 */
function fillBlank(cell: string, visible: string, at: number[], i: number, text: string): string | null {
  const x = at[i];
  if (x === undefined || x < 0 || visible[i] !== " ") return null;
  let run = 1;
  while (visible[i + run] === " " && at[i + run] === x + run) run += 1;
  const keep = Math.min(run, Math.max(1, run - width(text)));
  return cell.slice(0, x) + escapeXml(text) + " ".repeat(keep) + cell.slice(x + run);
}

/** 칸 글자에서 marker 뒤 첫 빈칸 자리에 text 를 넣는다 — marker 가 없으면 null */
function insertAfter(cell: string, marker: string, text: string): string | null {
  const { text: visible, at } = visibleMap(cell);
  const i = visible.indexOf(marker);
  if (i < 0) return null;
  const space = visible.slice(i + marker.length).search(/\s/u);
  if (space >= 0) {
    const filled = fillBlank(cell, visible, at, i + marker.length + space, text);
    if (filled) return filled;
  }
  const last = at[i + marker.length - 1];
  return last === undefined || last < 0 ? null : cell.slice(0, last + 1) + escapeXml(text) + cell.slice(last + 1);
}

interface Box { /** 표시 글자([ 또는 □)의 보이는 글자 자리 */ mark: number; /** 이 표시가 가리키는 이름 */ label: string }

/** 칸의 체크 표시와 이름 */
function boxesOf(text: string, style: NonNullable<CheckSpec["style"]>): Box[] {
  const out: Box[] = [];
  if (style === "box-after") {
    for (const m of text.matchAll(/([^□■\s,·][^□■]*?)\s*□/gu)) out.push({ mark: (m.index ?? 0) + m[0].length - 1, label: m[1].trim() });
  } else if (style === "bracket-before") {
    for (const m of text.matchAll(/\[\s*\]\s*([^[\]]*?)(?=\s*\[|$)/gu)) out.push({ mark: m.index ?? 0, label: m[1].trim() });
  } else {
    for (const m of text.matchAll(/([^[\]]*?)\s*\[\s*\]/gu)) if (m[0].trim()) out.push({ mark: (m.index ?? 0) + m[0].lastIndexOf("["), label: m[1].trim() });
  }
  return out.filter((b) => b.label !== "" || style !== "box-after");
}

/** 체크 칸 하나를 고른다 — 고른 칸을 표시하고, 그 이름 뒤의 [  ] 에 extra 를 적는다 */
function tick(cell: string, box: Box, style: NonNullable<CheckSpec["style"]>, extra = ""): string | null {
  const { text, at } = visibleMap(cell);
  let out = cell;
  if (style === "box-after") {
    const x = at[box.mark];
    if (x === undefined || x < 0 || cell[x] !== CHECK_OFF) return null;
    out = replaceAt(out, x, CHECK_ON + extra);
    return out;
  }
  // "[  ]" 안의 첫 빈칸을 √ 로 — 한 글자만 바꿔 다른 글 조각의 자리를 흔들지 않는다
  const close = text.indexOf("]", box.mark);
  const inside = text.slice(box.mark + 1, close).search(/\s/u);
  const x = inside >= 0 ? at[box.mark + 1 + inside] : undefined;
  if (close < 0 || x === undefined || x < 0) return null;
  // extra 는 이름 뒤 [ ] 안에 (뒤에서부터 바꿔야 앞 자리가 흔들리지 않는다)
  if (extra) {
    const labelEnd = text.indexOf(box.label, close) + box.label.length;
    const open = text.indexOf("[", labelEnd);
    const space = open >= 0 ? text.slice(open + 1, text.indexOf("]", open)).search(/\s/u) : -1;
    const filled = space >= 0 ? fillBlank(out, text, at, open + 1 + space, extra) : null;
    if (!filled) return null;
    out = filled;
  }
  return replaceAt(out, x, TICK);
}

/** 값의 낱말 — 괄호·문장부호·대시로 나눈다 */
const tokens = (s: string): string[] => s.toLowerCase().split(/[\s,.;:/()[\]{}<>—–\-]+/u).filter(Boolean);

/** 부정인 값인가 ("미사망", "아니오", "(해당 없음)", "동의 안 함", "사망 아님", "요청하지 않음") */
function isNegative(words: string): boolean {
  const t = tokens(words);
  const squashed = words.replace(/\s+/gu, "");
  return t.some((w) => NEGATIVE_WORDS.has(w)) || NEGATIVE_PARTS.some((p) => squashed.includes(p.replace(/\s+/gu, "")));
}

/** 표시가 하나뿐인 체크 칸을 고를 값인가 — 표시(√·[√])가 있거나 긍정 낱말이 있고, 부정이 아님 */
function isAffirmative(value: string, yesWords: string[]): boolean {
  if (isNegative(value.replace(TICK_MARKS, " "))) return false;
  if (/\[\s*[√✓v■]\s*\]|[√✓■]/u.test(value)) return true;
  const t = tokens(value);
  return [...AFFIRMATIVE, ...yesWords].some((w) => t.includes(w.toLowerCase()));
}

/** 체크 칸 값 — 표시를 떼고 "그 밖의 사항 [교육·훈련생]" 의 괄호 안 글도 꺼낸다 */
function checkWords(value: string): { words: string; inner: string } {
  const inner = /\[\s*([^\]√✓■]+?)\s*\]/u.exec(value.replace(/\[\s*[√✓v■xX]\s*\]/gu, ""))?.[1]?.trim() ?? "";
  return { words: value.replace(TICK_MARKS, " ").trim(), inner };
}

// ── 행 늘리기 ───────────────────────────────────────────────────────

/**
 * table 번째 표의 afterRow 행 뒤에 [afterRow-step+1 .. afterRow] 행 묶음을 본뜬 빈 행 step 개를 넣는다.
 * 뒤의 칸은 행 주소를 밀고, 위에서 걸쳐 내려오는 칸과 묶음 밖으로 걸치는 칸은 행 수·높이를 늘린다.
 */
function insertRows(xml: string, tableIndex: number, afterRow: number, step: number): string {
  const table = scanTables(xml)[tableIndex];
  if (!table) return xml;
  const trs = directChildren(xml, table, "tr");
  const first = afterRow - step + 1;
  if (first < 0 || afterRow >= trs.length) return xml;
  const shiftCell = (c: string, delta: number): string =>
    c.replace(/(<hp:cellAddr colAddr="\d+" rowAddr=")(\d+)("\/>)(?![\s\S]*<hp:cellAddr)/u, (_m, a: string, r: string, b: string) => `${a}${Number(r) + delta}${b}`);
  const allCells = directChildren(xml, table, "tc");
  const rowHeight = (tr: Range): number => {
    const one = allCells
      .filter((c) => c.start >= tr.start && c.end <= tr.end)
      .map((c) => ({ info: cellInfo(xml, c), seg: xml.slice(c.start, c.end) }))
      .find((c) => c.info.rowSpan === 1);
    return Number(/<hp:cellSz width="\d+" height="(\d+)"\/>(?![\s\S]*<hp:cellSz)/u.exec(one?.seg ?? "")?.[1] ?? 0);
  };
  const blockHeight = trs.slice(first, afterRow + 1).reduce((sum, tr) => sum + rowHeight(tr), 0);
  const growCell = (c: string, delta: number): string =>
    c
      .replace(/(<hp:cellSpan colSpan="\d+" rowSpan=")(\d+)("\/>)(?![\s\S]*<hp:cellSpan)/u, (_m, a: string, r: string, b: string) => `${a}${Number(r) + delta}${b}`)
      .replace(/(<hp:cellSz width="\d+" height=")(\d+)("\/>)(?![\s\S]*<hp:cellSz)/u, (_m, a: string, h: string, b: string) => `${a}${Number(h) + blockHeight}${b}`);

  let addedHeight = 0;
  const pieces: string[] = [];
  let cursor = table.start;
  const clones: string[] = [];
  trs.forEach((tr, index) => {
    pieces.push(xml.slice(cursor, tr.start));
    cursor = tr.end;
    const rel = allCells
      .filter((c) => c.start >= tr.start && c.end <= tr.end)
      .map((c) => cellInfo(xml, c))
      .map((c) => ({ ...c, start: c.start - tr.start, end: c.end - tr.start }));
    let trXml = xml.slice(tr.start, tr.end);
    for (const c of [...rel].reverse()) {
      let seg = trXml.slice(c.start, c.end);
      const last = c.row + c.rowSpan - 1;
      if (index > afterRow) seg = shiftCell(seg, step);
      else if ((c.row < first && last >= first) || (c.row >= first && c.row <= afterRow && last > afterRow)) seg = growCell(seg, step);
      trXml = trXml.slice(0, c.start) + seg + trXml.slice(c.end);
    }
    pieces.push(trXml);
    if (index >= first && index <= afterRow) {
      // 묶음 안에서 시작하고 묶음 안에서 끝나는 칸만 빈 칸으로 본뜬다
      let clone = xml.slice(tr.start, tr.end);
      for (const c of [...rel].reverse()) {
        const last = c.row + c.rowSpan - 1;
        const seg = clone.slice(c.start, c.end);
        const keep = c.row >= first && last <= afterRow;
        clone = clone.slice(0, c.start) + (keep ? shiftCell(rewriteCell(seg, ""), step) : "") + clone.slice(c.end);
      }
      addedHeight += rowHeight(tr);
      clones.push(clone);
    }
    if (index === afterRow) pieces.push(...clones);
  });
  pieces.push(xml.slice(cursor, table.end));
  let tableXml = pieces.join("");
  tableXml = tableXml.replace(/^(<hp:tbl\b[^>]*rowCnt=")(\d+)(")/u, (_m, a: string, n: string, b: string) => `${a}${Number(n) + step}${b}`);
  tableXml = tableXml.replace(/(<hp:sz width="\d+" widthRelTo="\w+" height=")(\d+)(")/u, (_m, a: string, n: string, b: string) => `${a}${Number(n) + addedHeight}${b}`);
  return xml.slice(0, table.start) + tableXml + xml.slice(table.end);
}

/** "쪽에서 나누지 않음" 표도 줄을 늘리면 다음 쪽으로 이어지게 칸 단위로 나눈다 */
function allowPageSplit(xml: string, tableIndex: number): string {
  const t = scanTables(xml)[tableIndex];
  if (!t) return xml;
  const head = /^<hp:tbl\b[^>]*>/u.exec(xml.slice(t.start, t.end))?.[0] ?? "";
  const next = head.replace(/pageBreak="NONE"/u, 'pageBreak="CELL"');
  return next === head ? xml : xml.slice(0, t.start) + next + xml.slice(t.start + head.length);
}

// ── 칸 바꾸기 ───────────────────────────────────────────────────────

function setCell(xml: string, tableIndex: number, row: number, col: number, edit: (cell: string) => string): { xml: string; found: boolean } {
  const table = scanTables(xml)[tableIndex];
  if (!table) return { xml, found: false };
  const cell = cellsOf(xml, table).find((c) => c.row === row && c.col === col);
  if (!cell) return { xml, found: false };
  return { xml: xml.slice(0, cell.start) + edit(xml.slice(cell.start, cell.end)) + xml.slice(cell.end), found: true };
}

/** 입력 한 줄을 칸에 — 넣지 못한 값은 이름을 돌려준다 */
function fillRowCells(xml: string, tableIndex: number, baseRow: number, cells: RowCell[], row: Record<string, string>): { xml: string; leftover: string[] } {
  let out = xml;
  const placed = new Set<string>();
  const lookup = (n: string): string => row[n] ?? "";
  for (const spec of cells) {
    if (!matches(spec.when, lookup, placed)) continue;
    const text = render(spec.template, lookup, placed);
    if (text === null) continue;
    out = setCell(out, tableIndex, baseRow + (spec.offset ?? 0), spec.col, (c) => rewriteCell(c, text)).xml;
  }
  const leftover = Object.entries(row)
    .filter(([k, v]) => (v ?? "").trim() !== "" && !placed.has(k))
    .map(([k, v]) => `${DETAIL_COLUMN_LABELS[k] ?? k} ${v}`);
  return { xml: out, leftover };
}

/** 체크 칸 하나 채우기 — 넣지 못한 값은 notes 에 */
function fillCheck(xml: string, spec: CheckSpec, value: string, label: string, notes: string[]): string {
  const style = spec.style ?? "bracket-before";
  return setCell(xml, spec.table, spec.row, spec.col, (cell) => {
    const boxes = boxesOf(visibleMap(cell).text, style);
    if (spec.mode === "yes") {
      if (isNegative(checkWords(value).words)) return cell;
      // 부정도 긍정도 아니면 고르지 않고 알린다 ("부상" 을 사망 칸에 √ 하지 않는다)
      if (!isAffirmative(value, spec.yesWords ?? [])) {
        notes.push(`${label}: ${value} — 표시 여부를 정하지 못함`);
        return cell;
      }
      const box = boxes[0];
      const out = box ? tick(cell, box, style) : null;
      if (!out) notes.push(`${label}: ${value} — 서식에서 표시 칸을 찾지 못함`);
      return out ?? cell;
    }
    const { words, inner } = checkWords(value);
    const f = flat(words);
    const other = spec.other ? boxes.find((b) => flat(b.label).startsWith(flat(spec.other as string))) : undefined;
    // 값에 칸 이름(또는 칸 지도가 정한 다른 이름)이 들어 있으면 그 칸
    const names = (b: Box): string[] => [b.label, ...(spec.aliases?.[b.label] ?? [])];
    let picked = boxes.filter((b) => b !== other && b.label && names(b).some((n) => f.includes(flat(n))));
    // 어느 칸 이름도 없고 부정어도 아니면 칸 지도가 정한 기본 칸 (국적: "베트남" → 외국인)
    if (picked.length === 0 && spec.fallback && !isNegative(words)) picked = boxes.filter((b) => b.label === spec.fallback);
    let out: string | null = cell;
    // 뒤의 칸부터 표시해야 앞 칸의 자리가 흔들리지 않는다
    for (const box of [...picked].sort((a, b) => b.mark - a.mark)) out = out && tick(out, box, style);
    if (picked.length === 0) {
      const rest = inner || words.replace(new RegExp(spec.other ?? "^$", "u"), "").trim();
      if (other && rest) out = tick(cell, other, style, rest);
      else out = null;
    }
    if (!out) {
      notes.push(`${label}: ${value} — 서식에 맞는 표시 칸이 없음`);
      return cell;
    }
    return out;
  }).xml;
}

/** 서식 본문 XML 하나에 값을 채운다 */
function fillSection(xml: string, map: FormMap, values: FormValues, used: Set<string>, notes: string[]): string {
  let out = xml;
  const lookup = (name: string): string => values.scalar.get(name) ?? "";
  const label = (name: string): string => values.labels.get(name) ?? name;

  const unreadable = new Map<string, string>();
  for (const spec of map.cells ?? []) {
    if (!matches(spec.when, lookup, used)) continue;
    const text = render(spec.template, lookup, used, unreadable);
    if (text === null) continue;
    out = setCell(out, spec.table, spec.row, spec.col, (c) => {
      if (spec.after) {
        const next = insertAfter(c, spec.after, text);
        if (next === null) notes.push(`${text.trim()} — 서식에서 "${spec.after}" 자리를 찾지 못함`);
        return next ?? c;
      }
      return spec.append ? appendToCell(c, text) : rewriteCell(c, text);
    }).xml;
  }

  // 값은 있는데 칸 꼴로 읽지 못한 것 — 칸을 비워 두고 알린다
  const unread = new Map<string, { raw: string; parts: string[] }>();
  for (const [k, raw] of unreadable) {
    const [name, part] = k.split("\u0000") as [string, string];
    const entry = unread.get(name) ?? { raw, parts: [] };
    entry.parts.push(partLabel(part));
    unread.set(name, entry);
  }
  for (const [name, { raw, parts }] of unread) notes.push(`${label(name)}: ${raw} — 서식 칸(${[...new Set(parts)].join("·")})의 꼴로 읽지 못해 비워 둠`);

  for (const spec of map.checks ?? []) {
    used.add(spec.field);
    const value = lookup(spec.field).trim();
    if (value) out = fillCheck(out, spec, value, label(spec.field), notes);
  }

  for (const spec of map.rows ?? []) {
    used.add(spec.field);
    const rows = values.rows.get(spec.field) ?? [];
    const step = spec.step ?? 1;
    const capacity = Math.floor((spec.lastRow - spec.firstRow + 1) / step);
    const extra = Math.max(0, rows.length - capacity);
    // 맨 아래 줄의 굵은 테두리가 표 끝에 남도록, 빈 줄이 둘 이상이면 끝에서 두 번째 묶음을 본떠 그 뒤에 넣는다
    const afterRow = capacity >= 2 ? spec.lastRow - step : spec.lastRow;
    if (rows.length > 0) out = allowPageSplit(out, spec.table);
    for (let i = 0; i < extra; i += 1) out = insertRows(out, spec.table, afterRow, step);
    rows.forEach((row, i) => {
      const r = fillRowCells(out, spec.table, spec.firstRow + i * step, spec.cells, row);
      out = r.xml;
      if (r.leftover.length > 0) notes.push(`${label(spec.field)} ${i + 1}번 줄: ${r.leftover.join(", ")} — 서식에 맞는 칸이 없음`);
    });
  }
  return out;
}

/** 서식에 칸이 없는 입력값 */
function unplacedValues(values: FormValues, used: Set<string>): string[] {
  const out: string[] = [];
  for (const [name, value] of values.scalar) if (!used.has(name)) out.push(`${values.labels.get(name) ?? name}: ${value}`);
  for (const [name, rows] of values.rows) if (!used.has(name)) out.push(`${values.labels.get(name) ?? name}: ${rows.length}건`);
  return out;
}

/** 이 문서에 쓸 서식 — 조건이 맞는 것, 없으면 조건 없는 것 */
export function pickOfficialForm(docId: string, values: FormValues): FormMap | null {
  const all = officialFormMaps(docId);
  const lookup = (name: string): string => values.scalar.get(name) ?? "";
  return all.find((m) => m.when && matches(m.when, lookup, new Set())) ?? all.find((m) => !m.when) ?? null;
}

/**
 * 법정 서식 원본에 입력값을 채운 한글(HWPX) 파일을 만든다. 이 문서 종류에 서식 원본이 없으면 null.
 */
export function fillOfficialForm(docId: string, values: FormValues): FilledForm | null {
  const map = pickOfficialForm(docId, values);
  if (!map) return null;
  const entries = unzip(readFileSync(officialFormPath(map)));
  const used = new Set<string>();
  const notes: string[] = [];
  const out: Array<{ name: string; data: Buffer; store?: boolean }> = [];
  for (const [name, data] of entries) {
    if (SECTION_RE.test(name)) {
      const filled = fillSection(data.toString("utf8"), map, values, used, notes).replace(LINESEG_RE, "");
      out.push({ name, data: Buffer.from(filled, "utf8") });
    } else out.push({ name, data, ...(name === MIMETYPE ? { store: true } : {}) });
  }
  // 한글 파일은 mimetype 이 맨 앞(압축하지 않음)이어야 한다
  out.sort((a, b) => (a.name === MIMETYPE ? -1 : b.name === MIMETYPE ? 1 : 0));
  return {
    data: zip(out),
    form: `${map.source.law} ${map.source.form}`,
    source: map.source,
    notInForm: [...notes, ...unplacedValues(values, used).map((n) => `${n} — 서식에 이 항목의 칸이 없음`)],
  };
}

/** 문서 노드의 칸 (절 순서대로) */
export async function documentFormFields(docId: string): Promise<FormField[]> {
  const doc = await getDocument(docId);
  return (doc?.sections ?? []).flatMap((s) => s.fields ?? []);
}

/** 정본(DocLang 문서)에서 법정 서식 한글 파일을 만든다 — 서식 원본이 없는 문서 종류면 null */
export async function officialFormFromDoclang(docId: string, documentXml: string): Promise<FilledForm | null> {
  if (officialFormMaps(docId).length === 0) return null;
  return fillOfficialForm(docId, formValuesFromDoclang(await documentFormFields(docId), documentXml));
}
