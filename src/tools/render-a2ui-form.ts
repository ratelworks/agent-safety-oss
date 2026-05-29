/**
 * render_a2ui_form
 *
 * docId 를 받아 그래프의 requiredFields/sections.fields 를 A2UI v0.9 JSONL 폼 정의로 변환.
 * Claude Desktop·MCP Inspector·기타 A2UI 호환 클라이언트가 직접 렌더링.
 *
 * 동작:
 *   1. 노드 로드 → requiredFields 추출
 *   2. profile.jsonld 로드 → 자동 채움 가능한 값 prefill
 *   3. A2UI v0.9 JSONL 메시지 생성 (createSurface + updateComponents)
 *   4. 사용자 입력 흐름:
 *      - 클라이언트가 폼 렌더 → 사용자 입력
 *      - 패키지 내장 viewer (scripts/dev/viewer-server.ts) 는 자체적으로 generate_safety_document 호출 + archive + MD 다운로드까지 수행
 *      - 또는 LLM 이 generate_safety_document({docId, draft: 입력값}) 호출 → 본문 생성
 *      - 또는 register_* 도구로 profile 갱신
 *
 * A2UI 한계 준수:
 *   - 동적 추가/삭제 없음 (고정 필드 N개)
 *   - action.name 만 노출 — 실제 백엔드 동작은 viewer/LLM/MCP 가 처리
 *   - 클라이언트 측 유효성 검사 없음 (review_safety_document 가 후속 검증)
 */
import { z } from "zod";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { findDoc } from "../lib/master-loader.js";
import { loadProfile, autoFillFromProfile } from "../lib/site-profile.js";
import { graphRepository } from "../lib/graph-repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = (() => {
  const candidates = [
    resolve(__dirname, "../ontology/graph/nodes/documents"),
    resolve(__dirname, "../../src/ontology/graph/nodes/documents"),
  ];
  for (const p of candidates) try { readdirSync(p); return p; } catch {}
  throw new Error("documents dir not found");
})();

const inputSchema = z.object({
  docId: z.string().describe("법정문서 docId (예: daily_tbm, work_permit_hot_work)"),
  surfaceId: z.string().default("safety-form").describe("A2UI surface ID"),
  useProfile: z.boolean().default(true).describe("profile.jsonld 자동 채움"),
  format: z.enum(["jsonl", "json"]).default("jsonl").describe("jsonl=A2UI 표준 / json=단일 객체"),
});


interface A2UIComponent {
  id: string;
  component: string;
  [key: string]: unknown;
}

interface A2UIMessage {
  createSurface?: { surfaceId: string; catalogId: string };
  updateComponents?: { surfaceId: string; root: string; components: A2UIComponent[] };
  updateDataModel?: { surfaceId: string; op: string; path: string; value: unknown };
}

function loadNode(docId: string): any | null {
  for (const f of readdirSync(NODES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    try {
      const n = JSON.parse(readFileSync(join(NODES_DIR, f), "utf8"));
      if (n.docId === docId) return n;
    } catch {}
  }
  return null;
}

// 라벨·키를 정밀 분류 → A2UI usageHint 반환.
// 우선순위 — 더 구체적인 패턴 먼저. 미매칭 시 shortText fallback.
function detectUsageHint(label: string, key: string): string {
  const L = (label || "").trim();
  const K = (key || "").trim();
  const lk = `${L}\n${K}`; // 라벨·키를 \n 으로 구분 (단어 경계 보존)
  const klower = K.toLowerCase();

  // ─── 1. 서명·날인 (text) — input 자체는 text 지만 의미적 표지 ───
  if (/서명|날인/.test(L) || /sign(?!ed_in)|seal/.test(klower)) return "signature";

  // ─── 2. 식별자 종류 (text) ───
  if (/사업자\s*등록\s*번호/.test(L) || /business[_-]?(?:reg)?[_-]?(?:number|no)/.test(klower)) return "businessNumber";
  if (/법인\s*등록\s*번호|corp(?:oration)?[_-]?(?:reg)?[_-]?(?:number|no)/.test(lk)) return "corpNumber";
  if (/주민\s*등록\s*번호|생년월일|birth/.test(lk)) return "shortText"; // 개인정보 — text
  if (/면허\s*번호|자격\s*번호|인증\s*번호|등록\s*번호|관리\s*번호|허가\s*번호|문서\s*번호|보고서\s*번호|일련\s*번호|계약\s*번호/.test(L)) return "shortText";

  // ─── 3. 연락 정보 ───
  if (/연락처|전화번호|핸드폰|휴대폰|FAX|팩스/.test(L) || /\b(phone|tel|mobile|fax)\b/.test(klower)) return "phone";
  if (/이메일|전자우편|메일\s*주소/.test(L) || /\bemail\b/.test(klower)) return "email";

  // ─── 4. 시간 ───
  // datetime: "일시" 또는 시점 (date+time 결합)
  if (/일시|시점|datetime|개시\s*시점|종료\s*시점/.test(L) || /datetime|timestamp/.test(klower)) return "datetime";
  // time: "시각" 단독 (시·분만)
  if (/시각$|^시각/.test(L)) return "time";
  // date: 날짜·일자
  if (
    /일자$|날짜$|일자\s*$|날짜\s*$|일자[\s·,(]|날짜[\s·,(]/.test(L + " ") ||
    /(시작|종료|작성|작성\s*된|점검|평가|실시|발생|체결|보고|개시|위촉|만기|만료|승인|등록|배치|채용|선임|발급|준공|기준|기록|결재|마감|회의|훈련|교육|측정|진단|건강진단|사용\s*시작|효력|변경|입고|출고|개최|다음)\s*일/.test(L) ||
    /(평가|점검|실시|작성|기록|보고|회의|훈련|교육)\s*시기/.test(L) ||
    /\bdate\b|_date$/.test(klower)
  ) return "date";
  // time: 시간 (시·분)
  if (
    /시간\s*\(\s*시.*분/.test(L) ||
    /^(시작|종료|예정|개시|마감)\s*시간/.test(L) ||
    /^시각$/.test(L) ||
    /\btime\b/.test(klower)
  ) return "time";

  // ─── 5. 숫자류 ───
  if (
    /금액$|금액[\s(]|예산$|비용$|단가|총액|도급금액|계약금액|공사금액|보상금|연봉|시급|월급|급여/.test(L) ||
    /\b(amount|cost|budget|price|fee)\b/.test(klower) ||
    // "원" 단독 단위 — "(원)", "원만 단독 끝" (인원·전원·수급인·구성원 등 제외)
    /(?:[\s\(])원\)?\s*$/.test(L)
  ) return "currency";
  if (
    /비율$|율$|%|percent|점유율|이행률|준수율/.test(L) ||
    /\b(rate|percent|ratio)\b/.test(klower)
  ) return "percentage";
  if (
    /(근로자|작업자|인원|투입\s*인원|참석자\s*수|이수자\s*수|남성|여성|총원|상시|일용)\s*수/.test(L) ||
    /건수|일수|개수|수량|차수|회차|순번|점수|총점/.test(L) ||
    /\b(count|num|number)\b/.test(klower) ||
    /^인원$|^수$/.test(L)
  ) return "number";

  // ─── 6. 선택지 (예/아니오, 적합/부적합) ───
  if (
    /여부$|예\s*\/\s*아니오|적합\s*\/\s*부적합|동의\s*여부|이행\s*여부|승인\s*여부|확인\s*여부|점검\s*결과$|적부$/.test(L) ||
    /(yes_no|적부)/.test(klower)
  ) return "yesNo";

  // ─── 7. 긴 텍스트 (내용·설명·서술형) ───
  if (
    /(내용|상세|설명|description|note|비고|개요|방침|본문|사유|원인|대책|결과$|조치\s*사항|조치\s*내용|시정\s*사항|결정\s*사항|결의|안건|발견\s*사항|소견|요약|평가\s*의견|의견$|논의\s*사항|개선\s*사항|시정\s*결과|사고\s*경위|발생\s*경위|진행\s*사항)/.test(L) ||
    /(이상\s*·\s*조치|위험.{0,4}요인|감소\s*대책|안전\s*조치|개선\s*대책|점검\s*항목|작업.{0,3}내용|점검\s*결과\s*및\s*조치)/.test(L) ||
    /(?:^|\s)(comment|description|content|note|memo|reason|summary)(?:$|\s)/.test(klower)
  ) return "longText";

  // ─── 8. 주소 ───
  if (/주소$|소재지$|주소[\s·,]|소재지[\s·,]|address|^위치$|작업\s*장소$|작업\s*위치$/.test(L) || /\baddress\b/.test(klower)) return "shortText"; // 주소도 input type=text

  // ─── 9. 짧은 텍스트 (성명·회사명·기관명·작업명 등) — fallback shortText ───
  return "shortText";
}

// 법령 prefix → 풀이름 (humanizePenalty 와 동일 룰)
const LAW_PREFIX_KO: Record<string, string> = {
  "산안법": "산업안전보건법",
  "산안법시행규칙": "산업안전보건법 시행규칙",
  "산안법시행령": "산업안전보건법 시행령",
  "기준규칙": "산업안전보건기준에 관한 규칙",
  "위험성평가-고시": "사업장 위험성평가에 관한 지침",
  "위평고시": "사업장 위험성평가에 관한 지침",
  "중처법": "중대재해 처벌 등에 관한 법률",
  "중처법시행령": "중대재해 처벌 등에 관한 법률 시행령",
  "중대재해처벌등에관한법률": "중대재해 처벌 등에 관한 법률",
  "중대재해처벌등에관한법률시행령": "중대재해 처벌 등에 관한 법률 시행령",
  "건진법": "건설기술진흥법",
  "건진법시행령": "건설기술진흥법 시행령",
  "건진법시행규칙": "건설기술진흥법 시행규칙",
};

function humanizeArticleIri(iri: string): string {
  if (typeof iri !== "string" || !iri.startsWith("art:")) return iri;
  const parts = iri.slice(4).split(":").filter(Boolean);
  if (parts.length === 0) return iri;
  const law = LAW_PREFIX_KO[parts[0]] || parts[0];
  if (parts.length === 1) return law;
  let s = law + " 제" + parts[1] + "조";
  if (parts[2]) s += " 제" + parts[2] + "항";
  if (parts[3]) s += " 제" + parts[3] + "호";
  return s;
}

// 법조 § → 제N조 한국어 변환
const HANG_MAP: Record<string, string> = { "①":"1","②":"2","③":"3","④":"4","⑤":"5","⑥":"6","⑦":"7","⑧":"8","⑨":"9","⑩":"10" };
function convertSectionMarks(s: string): string {
  if (typeof s !== "string") return s;
  return s
    .replace(/§\s*(\d+)\s*([①②③④⑤⑥⑦⑧⑨⑩])/g, (_, art, hang) => `제${art}조 제${HANG_MAP[hang]}항`)
    .replace(/§\s*(\d+)\s*의\s*(\d+)/g, (_, art, sub) => `제${art}조의${sub}`)
    .replace(/§\s*(\d+)/g, (_, art) => `제${art}조`);
}

// examples 항목 — 객체/배열에서 사용자 친화 추출 (영문 key 노출 X)
const PRIMARY_KEYS = ["name", "성명", "이름", "title", "제목", "label"];
const SKIP_VALUES = (v: unknown): boolean => v === null || v === undefined || v === "" || typeof v === "boolean";

function formatExample(x: unknown): string {
  if (x === null || x === undefined) return "";
  if (typeof x === "string") return convertSectionMarks(x);
  if (typeof x === "number") return String(x);
  if (typeof x === "boolean") return ""; // 의미적으로 사용자에게 노출 부적절
  if (Array.isArray(x)) return x.map(formatExample).filter(Boolean).join(" / ");
  if (typeof x === "object") {
    const obj = x as Record<string, unknown>;
    // 1) primary key (name·성명·이름 등) 우선 추출
    let primary = "";
    for (const k of PRIMARY_KEYS) {
      if (obj[k] != null && obj[k] !== "") {
        primary = formatExample(obj[k]);
        break;
      }
    }
    // 2) 나머지 의미값 (string/number만, key 없이 value만)
    const auxValues = Object.entries(obj)
      .filter(([k]) => !PRIMARY_KEYS.includes(k))
      .filter(([, v]) => !SKIP_VALUES(v))
      .map(([, v]) => formatExample(v))
      .filter(Boolean);
    if (primary) {
      return auxValues.length > 0 ? `${primary} (${auxValues.slice(0, 3).join(", ")})` : primary;
    }
    // primary 없음 — 모든 value 결합 (key 노출 X)
    return auxValues.slice(0, 4).join(", ");
  }
  return String(x);
}

function flattenFields(node: any): Array<{ key: string; label: string; inputGuide?: string; examples?: string[] }> {
  const out: Array<{ key: string; label: string; inputGuide?: string; examples?: string[] }> = [];
  function pushField(f: any): void {
    if (!f || typeof f !== "object" || !f.key || !f.label) return;
    const examples = Array.isArray(f.examples) ? f.examples.map(formatExample).filter((s: string) => s !== "") : undefined;
    const inputGuide = typeof f.inputGuide === "string" ? convertSectionMarks(f.inputGuide) : f.inputGuide;
    out.push({ key: f.key, label: convertSectionMarks(f.label), inputGuide, examples });
  }
  if (Array.isArray(node.sections)) {
    for (const sec of node.sections) {
      const fields = Array.isArray(sec?.fields) ? sec.fields : [];
      for (const f of fields) pushField(f);
    }
  }
  if (out.length === 0 && Array.isArray(node.requiredFields)) {
    for (const f of node.requiredFields) pushField(f);
  }
  return out;
}

// decision 002 — Active Graph Authoring Loop: 그래프 컨텍스트 inline 조립
// assemble_doc_context 의 traversal 로직을 폼 렌더 단계에서 직접 호출 (별도 도구 호출 없이)
interface InlineGraphContext {
  hazards: Array<{ iri: string; label: string; category?: string }>;
  controls: Array<{ iri: string; label: string; ericLevel?: number }>;
  relatedDocs: Array<{ iri: string; docId?: string; title?: string }>;
  legalArticles: Array<{ iri: string; name: string }>;
  koshaGuides: Array<{ iri: string; guideNo?: string; title?: string }>;
}

async function loadInlineGraphContext(docNode: Record<string, any>): Promise<InlineGraphContext> {
  await graphRepository.ensureBuilt();
  const hazards: InlineGraphContext["hazards"] = [];
  for (const iri of (docNode.hasHazard ?? []) as string[]) {
    const n = graphRepository.getNode(iri) as Record<string, any> | undefined;
    if (!n) continue;
    hazards.push({ iri, label: String(n.label ?? iri), category: n.category });
  }
  // direct controls + via hazards 합집합 (간단)
  const controlIris = new Set<string>((docNode.mitigatedBy ?? []) as string[]);
  for (const h of hazards) {
    const hNode = graphRepository.getNode(h.iri) as Record<string, any> | undefined;
    for (const c of (hNode?.mitigatedBy ?? []) as string[]) controlIris.add(c);
  }
  const controls: InlineGraphContext["controls"] = [];
  for (const iri of controlIris) {
    const n = graphRepository.getNode(iri) as Record<string, any> | undefined;
    if (!n) continue;
    controls.push({
      iri,
      label: String(n.label ?? n.title ?? iri),
      ericLevel: Number(n.ericLevel ?? 4),
    });
  }
  controls.sort((a, b) => (a.ericLevel ?? 4) - (b.ericLevel ?? 4));

  const relatedDocs: InlineGraphContext["relatedDocs"] = [];
  for (const iri of (docNode.relatedDocs ?? []) as string[]) {
    const n = graphRepository.getNode(iri) as Record<string, any> | undefined;
    if (!n) continue;
    relatedDocs.push({ iri, docId: n.docId, title: n.title });
  }

  const legalArticles: InlineGraphContext["legalArticles"] = (
    (docNode.legalBasis ?? []) as string[]
  ).map((l) => ({ iri: l, name: humanizeArticleIri(l) }));

  const koshaGuides: InlineGraphContext["koshaGuides"] = [];
  for (const iri of (docNode.guidedBy ?? []) as string[]) {
    const n = graphRepository.getNode(iri) as Record<string, any> | undefined;
    if (!n) continue;
    koshaGuides.push({
      iri,
      guideNo: n._meta?.guideNo ?? iri.split("/").pop(),
      title: n.title ?? n.label,
    });
  }
  return { hazards, controls, relatedDocs, legalArticles, koshaGuides };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);

  const node = loadNode(args.docId);
  if (!node) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] docId="${args.docId}"` }],
      isError: true,
      structuredContent: { docId: args.docId, found: false },
    };
  }

  const masterDoc = findDoc(args.docId);
  const fields = flattenFields(node);
  if (fields.length === 0) {
    return {
      content: [{ type: "text", text: `[NO_FIELDS] docId="${args.docId}" 노드에 작성 필드(requiredFields/sections) 부재` }],
      isError: true,
      structuredContent: { docId: args.docId, fields: 0 },
    };
  }

  // decision 002 — _meta.writingGuide 추출 (있을 때만)
  const writingGuide = (node._meta?.writingGuide ?? {}) as {
    fieldHints?: Record<string, string>;
    commonMistakes?: string[];
    bestPractices?: string[];
  };

  // decision 002 — 그래프 컨텍스트 inline 조립 (assemble_doc_context 와 동일 데이터)
  let graphContext: InlineGraphContext = {
    hazards: [],
    controls: [],
    relatedDocs: [],
    legalArticles: [],
    koshaGuides: [],
  };
  try {
    graphContext = await loadInlineGraphContext(node);
  } catch {
    // graph 로드 실패 시 빈 컨텍스트로 진행 (폼은 정상 렌더)
  }

  // sections 의 fields 에 checkPoints 보존 (flattenFields 가 누락) → 별도 맵 구축
  const checkPointsMap: Record<string, string[]> = {};
  if (Array.isArray(node.sections)) {
    for (const sec of node.sections) {
      for (const f of sec.fields ?? []) {
        if (f && typeof f === "object" && f.key && Array.isArray(f.checkPoints)) {
          checkPointsMap[f.key] = f.checkPoints;
        }
      }
    }
  }
  if (Array.isArray(node.requiredFields)) {
    for (const f of node.requiredFields) {
      if (f && typeof f === "object" && f.key && Array.isArray(f.checkPoints) && !checkPointsMap[f.key]) {
        checkPointsMap[f.key] = f.checkPoints;
      }
    }
  }

  // profile 자동 채움 — 사업장명·주소·대표자 등
  let prefill: Record<string, unknown> = {};
  if (args.useProfile) {
    try {
      const profile = await loadProfile();
      const { draft } = autoFillFromProfile({}, { profile, docId: args.docId });
      prefill = draft;
    } catch {
      // profile 없으면 비어있는 채움
    }
  }

  const surface = args.surfaceId;
  const messages: A2UIMessage[] = [];

  // 1. createSurface
  messages.push({ createSurface: { surfaceId: surface, catalogId: "standard" } });

  // 2. components — root Column 안에 [title, info, ...fields, submit]
  const components: A2UIComponent[] = [];

  // decision 002 — guide-card 조건부 표시 (writingGuide 가 있을 때만)
  const hasWritingGuide =
    (writingGuide.commonMistakes && writingGuide.commonMistakes.length > 0) ||
    (writingGuide.bestPractices && writingGuide.bestPractices.length > 0);

  // root
  const rootChildren: string[] = ["header", "info-card"];
  if (hasWritingGuide) rootChildren.push("guide-card");
  rootChildren.push("fields-section", "actions");
  components.push({
    id: "root",
    component: "Column",
    children: rootChildren,
  });

  // header
  components.push({
    id: "header",
    component: "Text",
    text: node.title ?? args.docId,
    usageHint: "h1",
  });

  // info card — decision 002 강화: graph-context + lifecycle 추가
  const infoColChildren: string[] = ["info-purpose", "info-meta", "info-laws"];
  if (
    graphContext.hazards.length > 0 ||
    graphContext.controls.length > 0 ||
    graphContext.relatedDocs.length > 0 ||
    graphContext.koshaGuides.length > 0
  ) {
    infoColChildren.push("info-graph-context");
  }
  if (
    masterDoc?.submitTo ||
    masterDoc?.submitDeadline ||
    masterDoc?.retention ||
    masterDoc?.electronicSubmission?.available
  ) {
    infoColChildren.push("info-lifecycle");
  }
  components.push({ id: "info-card", component: "Card", child: "info-col" });
  components.push({
    id: "info-col",
    component: "Column",
    children: infoColChildren,
  });
  components.push({
    id: "info-purpose",
    component: "Text",
    text: masterDoc?.purpose ?? node.description?.slice(0, 200) ?? "법정 의무 문서 작성",
    usageHint: "body",
  });
  // 카테고리 코드 → 한국어 (B_위평·G_점검 등 raw enum 노출 방지)
  const CATEGORY_KO: Record<string, string> = {
    A_체제: "안전보건관리체제",
    B_위평: "위험성평가",
    C_교육: "안전보건교육",
    D_작업: "작업계획·관리",
    E_작업허가: "작업허가",
    F_작업: "작업안전",
    G_점검: "안전점검·일지",
    H_화학: "화학물질",
    I_측정: "작업환경측정",
    J_건강: "건강관리",
    K_사고: "사고 대응",
    L_진단: "안전보건 진단",
    M_인증: "안전인증",
    N_비용: "안전관리비",
  };
  const catRaw = masterDoc?.category;
  const catKo = catRaw && CATEGORY_KO[catRaw] ? CATEGORY_KO[catRaw] : (catRaw ?? "?");
  const metaText = [
    `📋 카테고리: ${catKo}`,
    `🔄 주기: ${masterDoc?.frequency ?? "?"}`,
    `📤 제출처: ${masterDoc?.submitTo ?? "?"}`,
    `⏰ 마감: ${masterDoc?.submitDeadline ?? "?"}`,
    `🗄 보관: ${masterDoc?.retention ?? "?"}`,
  ].join(" · ");
  components.push({ id: "info-meta", component: "Text", text: metaText, usageHint: "caption" });
  if (Array.isArray(node.legalBasis) && node.legalBasis.length > 0) {
    const human = node.legalBasis.slice(0, 5).map((iri: string) => humanizeArticleIri(iri));
    components.push({
      id: "info-laws",
      component: "Text",
      text: `⚖️ 법령근거: ${human.join(" · ")}${node.legalBasis.length > 5 ? ` 외 ${node.legalBasis.length - 5}건` : ""}`,
      usageHint: "caption",
    });
  } else {
    components.push({ id: "info-laws", component: "Text", text: "", usageHint: "caption" });
  }

  // decision 002 — info-graph-context 인라인 (assemble_doc_context 요약)
  if (infoColChildren.includes("info-graph-context")) {
    const parts: string[] = [];
    if (graphContext.hazards.length > 0) {
      parts.push(
        `⚠️ 위험요인 ${graphContext.hazards.length}건 (${graphContext.hazards
          .slice(0, 3)
          .map((h) => h.label)
          .join(" · ")}${graphContext.hazards.length > 3 ? " 외" : ""})`,
      );
    }
    if (graphContext.controls.length > 0) {
      parts.push(
        `🛡 통제대책 ${graphContext.controls.length}건 (${graphContext.controls
          .slice(0, 3)
          .map((c) => c.label)
          .join(" · ")}${graphContext.controls.length > 3 ? " 외" : ""})`,
      );
    }
    if (graphContext.koshaGuides.length > 0) {
      parts.push(
        `📚 KOSHA Guide ${graphContext.koshaGuides.length}건 (${graphContext.koshaGuides
          .slice(0, 2)
          .map((g) => g.guideNo ?? g.title ?? "")
          .filter(Boolean)
          .join(" · ")})`,
      );
    }
    if (graphContext.relatedDocs.length > 0) {
      parts.push(
        `🔗 연계 문서 ${graphContext.relatedDocs.length}건 (${graphContext.relatedDocs
          .slice(0, 3)
          .map((d) => d.title ?? d.docId ?? "")
          .filter(Boolean)
          .join(" · ")})`,
      );
    }
    components.push({
      id: "info-graph-context",
      component: "Text",
      text: parts.join("\n"),
      usageHint: "caption",
    });
  }

  // decision 002 — info-lifecycle 인라인
  if (infoColChildren.includes("info-lifecycle")) {
    const lifecycleParts: string[] = [];
    if (masterDoc?.submitTo) lifecycleParts.push(`📤 제출: ${masterDoc.submitTo}`);
    if (masterDoc?.submitDeadline) lifecycleParts.push(`⏰ 마감: ${masterDoc.submitDeadline}`);
    if (masterDoc?.electronicSubmission?.available)
      lifecycleParts.push(`💻 전자제출: ${masterDoc.electronicSubmission.url ?? "지원"}`);
    if (masterDoc?.retention) lifecycleParts.push(`🗄 보관: ${masterDoc.retention}`);
    components.push({
      id: "info-lifecycle",
      component: "Text",
      text: lifecycleParts.join(" · "),
      usageHint: "caption",
    });
  }

  // decision 002 — guide-card (writingGuide 노출)
  if (hasWritingGuide) {
    const guideColChildren: string[] = [];
    components.push({ id: "guide-card", component: "Card", child: "guide-col" });
    if (writingGuide.commonMistakes && writingGuide.commonMistakes.length > 0) {
      guideColChildren.push("guide-mistakes-title", "guide-mistakes");
      components.push({
        id: "guide-mistakes-title",
        component: "Text",
        text: "⚠️ 흔한 실수",
        usageHint: "h2",
      });
      components.push({
        id: "guide-mistakes",
        component: "Text",
        text: writingGuide.commonMistakes.map((m) => `• ${m}`).join("\n"),
        usageHint: "body",
      });
    }
    if (writingGuide.bestPractices && writingGuide.bestPractices.length > 0) {
      guideColChildren.push("guide-practices-title", "guide-practices");
      components.push({
        id: "guide-practices-title",
        component: "Text",
        text: "✅ 모범 사례",
        usageHint: "h2",
      });
      components.push({
        id: "guide-practices",
        component: "Text",
        text: writingGuide.bestPractices.map((p) => `• ${p}`).join("\n"),
        usageHint: "body",
      });
    }
    components.push({ id: "guide-col", component: "Column", children: guideColChildren });
  }

  // decision 002 — _meta.writingGuide.fieldHints 라벨 매칭 헬퍼
  // 공백·괄호·번호 마커 정규화 후 양방향 substring 매칭
  function normalizeForMatch(s: string): string {
    return s
      .replace(/\([^)]*\)/g, "") // 괄호 안 제거 ("3건 이상" 등)
      .replace(/[❶❷❸❹❺❻❼❽❾❿①-⑳]/g, "") // 번호 마커 제거
      .replace(/\s+/g, "") // 공백 제거
      .trim();
  }
  function findFieldHint(label: string, key: string): string | undefined {
    if (!writingGuide.fieldHints) return undefined;
    if (writingGuide.fieldHints[label]) return writingGuide.fieldHints[label];
    if (writingGuide.fieldHints[key]) return writingGuide.fieldHints[key];
    const labelNorm = normalizeForMatch(label);
    for (const [hintKey, hintVal] of Object.entries(writingGuide.fieldHints)) {
      const hintKeyNorm = normalizeForMatch(hintKey);
      if (!hintKeyNorm) continue;
      if (labelNorm.includes(hintKeyNorm) || hintKeyNorm.includes(labelNorm)) return hintVal;
    }
    return undefined;
  }

  // fields section
  const fieldGroupChildren: string[] = [];
  const fieldPathMap: Record<string, string> = {};
  const fieldLabelMap: Record<string, string> = {};
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const fieldId = `field-${i}`;
    const labelId = `field-${i}-label`;
    const inputId = `field-${i}-input`;
    const guideId = `field-${i}-guide`;
    const hintId = `field-${i}-hint`;
    fieldPathMap[inputId] = f.key;
    fieldLabelMap[f.key] = f.label;

    const fieldChildren: string[] = [labelId, inputId, guideId];

    components.push({
      id: labelId,
      component: "Text",
      text: f.label || f.key,
      usageHint: "h2",
    });

    const prefillValue = (prefill as Record<string, unknown>)[f.key];
    // examples가 [√]/[v]/[O]/[X]/[×]/[ ] 같은 체크 마크 패턴이면 usageHint='check' 강제
    const isCheckField =
      Array.isArray(f.examples) &&
      f.examples.some((ex) => /^\s*\[\s*(√|v|V|O|o|×|X|x| )\s*\]/.test(String(ex)));
    components.push({
      id: inputId,
      component: "TextField",
      fieldKey: f.key,
      draftPath: f.key,
      label: f.label,
      value: typeof prefillValue === "string" || typeof prefillValue === "number" ? String(prefillValue) : "",
      usageHint: isCheckField ? "check" : detectUsageHint(f.label, f.key),
      ...(f.examples && f.examples.length > 0 ? { placeholder: f.examples[0] } : {}),
    });

    // decision 002 — guide 강화 (inputGuide + examples + checkPoints)
    const guideParts: string[] = [];
    if (f.inputGuide) guideParts.push(`💡 ${f.inputGuide}`);
    if (f.examples && f.examples.length > 0) guideParts.push(`예시: ${f.examples.slice(0, 2).join(" / ")}`);
    const checkPoints = checkPointsMap[f.key];
    if (checkPoints && checkPoints.length > 0) {
      guideParts.push(`☑️ 점검: ${checkPoints.slice(0, 3).join(" / ")}`);
    }
    components.push({
      id: guideId,
      component: "Text",
      text: guideParts.join("  ·  ") || "",
      usageHint: "caption",
    });

    // decision 002 — fieldHint (writingGuide.fieldHints 라벨 매칭) — 있을 때만
    const fieldHint = findFieldHint(f.label, f.key);
    if (fieldHint) {
      fieldChildren.push(hintId);
      components.push({
        id: hintId,
        component: "Text",
        text: `🧠 ${fieldHint}`,
        usageHint: "caption",
      });
    }

    fieldGroupChildren.push(fieldId);
    components.push({ id: fieldId, component: "Column", children: fieldChildren });
  }
  components.push({
    id: "fields-section",
    component: "Column",
    children: fieldGroupChildren,
  });

  // decision 002 — actions Row 강화: 4 신규 능동 호출 액션 + 기존 2개
  components.push({
    id: "actions",
    component: "Row",
    children: [
      "analyze-btn",
      "controls-btn",
      "help-btn",
      "preview-review-btn",
      "preview-btn",
      "submit-btn",
    ],
    distribution: "spaceBetween",
  });

  // decision 002 — analyze-btn: 작업명 → 그래프 종합 컨텍스트
  components.push({
    id: "analyze-btn",
    component: "Button",
    child: "analyze-text",
    action: {
      name: "analyze_work_context",
      payload: { docId: args.docId, surfaceId: surface },
    },
  });
  components.push({
    id: "analyze-text",
    component: "Text",
    text: "🔍 작업 분석",
  });

  // decision 002 — controls-btn: 위험요인 → 통제대책 추천
  components.push({
    id: "controls-btn",
    component: "Button",
    child: "controls-text",
    action: {
      name: "suggest_controls_for_hazard",
      payload: { docId: args.docId, surfaceId: surface },
    },
  });
  components.push({
    id: "controls-text",
    component: "Text",
    text: "🛡 통제대책",
  });

  // decision 002 — help-btn: 필드 단위 동적 도움말
  components.push({
    id: "help-btn",
    component: "Button",
    child: "help-text",
    action: {
      name: "request_field_help",
      payload: { docId: args.docId, surfaceId: surface },
    },
  });
  components.push({
    id: "help-text",
    component: "Text",
    text: "❓ 필드 도움말",
  });

  // decision 002 — preview-review-btn: 작성 중 부분 검토
  components.push({
    id: "preview-review-btn",
    component: "Button",
    child: "preview-review-text",
    action: {
      name: "preview_review",
      payload: { docId: args.docId, surfaceId: surface, scope: "all" },
    },
  });
  components.push({
    id: "preview-review-text",
    component: "Text",
    text: "📝 부분 검토",
  });

  // 기존 — preview-btn: assemble_doc_context (전체 그래프 컨텍스트 미리보기)
  components.push({
    id: "preview-btn",
    component: "Button",
    child: "preview-text",
    action: { name: "assemble_doc_context", payload: { docId: args.docId } },
  });
  components.push({ id: "preview-text", component: "Text", text: "🧭 온톨로지 그래프" });

  // 기존 — submit-btn: 작성 완료 → 본문 생성
  components.push({
    id: "submit-btn",
    component: "Button",
    child: "submit-text",
    action: { name: "submit_safety_document", payload: { docId: args.docId, surfaceId: surface } },
  });
  components.push({ id: "submit-text", component: "Text", text: "📥 작성 완료" });

  messages.push({
    updateComponents: {
      surfaceId: surface,
      root: "root",
      components,
    },
  });

  // 출력 — JSONL (A2UI 표준) 또는 단일 JSON
  const output =
    args.format === "jsonl"
      ? messages.map((m) => JSON.stringify(m)).join("\n")
      : JSON.stringify({ messages }, null, 2);

  return {
    content: [{ type: "text", text: output }],
    structuredContent: {
      docId: args.docId,
      title: node.title,
      surfaceId: surface,
      fieldCount: fields.length,
      prefilledCount: Object.keys(prefill).length,
      componentCount: components.length,
      fieldPathMap,
      fieldLabelMap,
      a2uiVersion: "v0.9",
      format: args.format,
      messages,
      // decision 002 — 그래프 컨텍스트 + writingGuide 노출 (LLM 능동 호출에 활용)
      graphContext: {
        hazards: graphContext.hazards,
        controls: graphContext.controls,
        relatedDocs: graphContext.relatedDocs,
        legalArticles: graphContext.legalArticles,
        koshaGuides: graphContext.koshaGuides,
      },
      writingGuide: {
        hasFieldHints: !!(writingGuide.fieldHints && Object.keys(writingGuide.fieldHints).length > 0),
        commonMistakesCount: writingGuide.commonMistakes?.length ?? 0,
        bestPracticesCount: writingGuide.bestPractices?.length ?? 0,
      },
      activeActions: [
        "analyze_work_context",
        "suggest_controls_for_hazard",
        "request_field_help",
        "preview_review",
        "assemble_doc_context",
        "submit_safety_document",
      ],
      nextActions: [
        "viewer (npm run mcp:viewer → http://localhost:5174) / Claude Desktop / MCP Inspector 등 A2UI 호환 클라이언트가 위 JSONL 을 렌더링",
        "사용자 입력 후 fieldPathMap 기준으로 draft 키를 변환 → generate_safety_document({docId, draft: 입력값}) 호출",
        "decision 002 능동 호출 루프 — 사용자가 작업명 입력 시 analyze_work_context, 위험요인 입력 시 suggest_controls_for_hazard, 필드 도움말 필요 시 request_field_help, 부분 검토 필요 시 preview_review 호출 (LLM 이 사용자 입력 맥락에 따라 자연 체이닝)",
        "또는 register_site/project/person 도구로 profile.jsonld 갱신",
      ],
    },
  };
}

export const renderA2UIFormTool: ToolDefinition = {
  name: "render_a2ui_form",
  title: "A2UI 안전문서 입력 폼 렌더 (Active Graph Authoring Loop)",
  description:
    "docId 를 받아 그래프 노드의 작성 필드를 A2UI v0.9 JSONL 폼 정의로 변환한다. decision 002 강화: (1) info-card 에 그래프 컨텍스트 inline (위험요인·통제대책·KOSHA Guide·연계문서·라이프사이클) (2) _meta.writingGuide.commonMistakes / bestPractices 를 guide-card 로 노출 (3) 필드별 inputGuide·examples·checkPoints + _meta.writingGuide.fieldHints 매칭 (4) actions Row 에 6 개 액션 버튼 — analyze_work_context / suggest_controls_for_hazard / request_field_help / preview_review / assemble_doc_context / submit_safety_document. profile.jsonld 자동 채움. 비-개발자 안전관리자가 브라우저(viewer)/Claude Desktop/Inspector 에서 직접 사용 가능. 동적 입력 협업의 진입점이자 decision 002 Active Graph Authoring Loop 의 1단계.",
  inputSchema,
  handler,
};
