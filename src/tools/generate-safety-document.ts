// ─────────────────────────────────────────────────────────────────────────────
// generate-safety-document.ts (P-PAPER-2a — Generic Renderer v0.7)
//
// 안전관리 법정문서 *완성 본문* 생성 도구. 54종 모든 의무 문서 cover.
//
// review_safety_document(검수)와 직교: review는 *입력 검증*, generate는 *출력 합성*.
//
// 본 OSS 비전: 현장 실무자(50억 미만 현장 현장소장 + 안전관리자)의
//             54종 법정문서 작성을 *수기 → 페이퍼리스* 단계로 도약.
//
// v0.7 변경:
//   - work_plan_excavation 전용 renderer → Document.sections 기반 generic renderer
//   - 모든 docId 자동 처리 (sections 메타가 정의된 모든 Document)
//
// 환각 차단:
//   - 모든 KOSHA·법령·처벌 인용은 그래프 노드 IRI 통해 결정론적
//   - LLM 추론이 아닌 그래프 탐색 결과
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  getDocument,
  getNode,
  neighborsByEdge,
  listDocuments,
  type DocumentNode,
  type DocumentSection,
  type AnyNode,
  type NodeWithFacets,
} from "../lib/graph-nodes-loader.js";
import { renderIri } from "../lib/iri-renderer.js";
import { extractArticleBody, extractAnnexBody } from "../lib/law-body-extractor.js";
import { validateDocumentInput, type ValidationReport } from "../lib/input-validator.js";
import { COMMON_RESPONSE_META } from "../config/constants.js";
// Issue #5 lateral (2026-05-22) — KST 기준 작성일 fallback
import { kstToday } from "../lib/datetime-kst.js";
import { serializeSafetyDocumentToDoclang, type SafetyDocumentDoclangInput } from "../lib/doclang-serializer.js";

const inputSchema = z.object({
  docId: z.string().describe("작성할 법정문서 docId — listDocuments / getSafetyDocumentGuide 로 확인"),
  draft: z
    .record(z.unknown())
    .optional()
    .default({})
    .describe("작업 조건 + 사용자 작성 본문 (key·value 자유 형식). useProfile=true 시 사업장·결재선 등은 SSoT 자동 채움."),
  useProfile: z
    .boolean()
    .optional()
    .default(true)
    .describe("SSoT 사이트 프로파일 자동 채움 사용 여부 (기본 true). register_site 등으로 등록한 사업장·직원·장비·결재선 정보가 자동 적용됨."),
  siteId: z
    .string()
    .optional()
    .describe("자동 채움에 사용할 사업장 ID. 미지정 시 첫 등록 사업장 사용."),
  projectId: z
    .string()
    .optional()
    .describe("자동 채움에 사용할 현장 ID. 미지정 시 사업장의 첫 현장 사용."),
  format: z
    .enum(["md", "doclang"])
    .default("md")
    .describe("출력 포맷. md=기존 Markdown, doclang=DocLang v0.6 XML (experimental)."),
  scale: z
    .object({
      workforce: z.number().optional(),
      constructionValue: z.number().optional(),
      industry: z.string().optional(),
    })
    .optional()
    .describe("현장 규모 — 적용성 추론용 (profile 미사용 시)"),
});

type Input = z.infer<typeof inputSchema>;
type OutputFormat = Input["format"];

interface KoshaGuideInfo {
  iri: string;
  guideNo: string;
  title: string;
}

async function loadKoshaGuides(iris: string[]): Promise<KoshaGuideInfo[]> {
  const out: KoshaGuideInfo[] = [];
  for (const iri of iris) {
    const node = (await getNode(iri)) as
      | (AnyNode & { _meta?: { guideNo?: string }; title?: string; label?: string })
      | undefined;
    if (!node) continue;
    out.push({
      iri,
      guideNo: String(node._meta?.guideNo ?? iri.split("/").pop() ?? ""),
      title: String(node.title ?? node.label ?? renderIri(iri) ?? iri),
    });
  }
  return out;
}

interface ControlInfo {
  iri: string;
  slug: string;
  label: string;
  ericLevel: number;
}

async function appendControl(
  controlIri: string,
  seen: Set<string>,
  out: ControlInfo[],
): Promise<void> {
  if (seen.has(controlIri)) return;
  seen.add(controlIri);
  const node = (await getNode(controlIri)) as
    | (AnyNode & { slug?: string; label?: string; title?: string; ericLevel?: number })
    | undefined;
  if (!node) return;
  out.push({
    iri: controlIri,
    slug: String(node.slug ?? ""),
    label: String(node.label ?? node.title ?? controlIri),
    ericLevel: Number(node.ericLevel ?? 4),
  });
}

async function loadControls(
  guideIris: string[],
  directControlIris: string[] = [],
): Promise<ControlInfo[]> {
  const seen = new Set<string>();
  const out: ControlInfo[] = [];
  for (const cIri of directControlIris) {
    await appendControl(cIri, seen, out);
  }
  for (const gIri of guideIris) {
    const mitigated = await neighborsByEdge(gIri, "mitigatedBy");
    for (const cIri of mitigated) {
      await appendControl(cIri, seen, out);
    }
  }
  out.sort((a, b) => a.ericLevel - b.ericLevel);
  return out;
}

interface HazardInfo {
  iri: string;
  slug: string;
  label: string;
  category: string;
  mitigatedBy: string[];  // 직접 매핑된 control IRIs
  koshaArchiveFacets: string[];  // KOSHA 자료실 facet IRIs (Phase A-2)
}

type HazardRawNode = NodeWithFacets & {
  slug?: string;
  label?: string;
  category?: string;
  description?: string;
};

function hazardFromNode(iri: string, node: HazardRawNode): HazardInfo {
  return {
    iri,
    slug: String(node.slug ?? ""),
    label: String(node.label ?? ""),
    category: String(node.category ?? ""),
    mitigatedBy: node.mitigatedBy ?? [],
    koshaArchiveFacets: node.koshaArchiveFacets ?? [],
  };
}

// decision 006 — 위험요인 환각 차단: 행정성 문서는 guidedBy→causedBy 위험 폴백을 금지한다.
// 위험요인이 본질적으로 불필요한 문서(선임·게시·대장·신청·교육·보고·협의체)에
// 근거 없는 위험을 그래프 추론인 양 출처 달아 제시 = over-dump = 환각.
// 작업성 문서(작업계획서·점검표·인허가·위험성평가)는 특정 작업 위험을 다루므로 폴백 유지.
const ADMINISTRATIVE_HAZARD_CATEGORIES = new Set<string>([
  "administrative", // 행정 일반 (관리규정·정책·게시물 등)
  "register",       // 대장·게시물 (선임 게시·관리대장)
  "report",         // 보고·진단보고
  "appointment",    // 선임서 (안전관리자·명예감독관·조정자 등)
  "application",    // 신청서 (인증·검사 신청)
  "education",      // 교육일지
  "council",        // 협의체·심의위원회
]);

// docId 패턴 → 행정성 위험 폴백 차단 여부 (documentCategory 메타 없는 fallback 노드용).
// inferCategoryFromDocId(양식 스타일용)와 분리 — 여기서는 *위험 폴백* 결정만 한다.
// 보수적 원칙(decision 006): 확실한 행정문서만 차단, 애매하면 작업성으로 두어 폴백 허용.
function isAdministrativeDocIdForHazard(docId: string): boolean {
  // (1) 최우선 — docId 의 *말미 토큰*이 문서 종류를 결정한다.
  //     예: safety_inspection_application 은 중간에 "inspection"이 있어도 본질은 신청서(application).
  //     선임(appointment)·신청(application)·접수(filing)·게시(posting)·정보제공(provision)·
  //     보고(report)·대장(register) 으로 끝나면 행정문서 → 위험 폴백 차단.
  if (/(_appointment|_application|_filing|_posting|_provision|_report|_register)$/.test(docId)) {
    return true;
  }
  // (2) 작업성 신호 — 점검(inspection/check/checklist)·작업계획·인허가·위험성평가는 폴백 허용.
  //     weekly_joint_inspection 등 합동점검도 작업성으로 둔다(decision 006 — 애매 문서는 작업성).
  if (/(^|_)(work_plan|work_permit|inspection|check|checklist|risk_assessment|hazardous_risk)/.test(docId)) {
    return false;
  }
  // (3) 기타 확실한 행정 신호 — 정책·규정·진단(보고서가 아닌 형태) 등.
  if (/(^|_)(policy|regulation|diagnosis)(_|$)/.test(docId)) {
    return true;
  }
  return false;
}

// 문서 성격(category) + docId 로 위험 폴백 허용 여부 판정 (decision 006).
// documentCategory 메타가 있으면 그것을 우선, 없으면 docId 패턴으로 추론.
function allowGuideFallback(category: string | undefined, docId: string): boolean {
  // decision 006: category 정규화(trim·소문자) — JSON 저작 시 대소문자/공백 드리프트로
  // 행정문서 위험 억제가 우회(over-dump 환각)되는 것을 방지.
  const c = category?.trim().toLowerCase();
  if (c) {
    return !ADMINISTRATIVE_HAZARD_CATEGORIES.has(c);
  }
  return !isAdministrativeDocIdForHazard(docId);
}

// docHazardIris(doc.hasHazard) 가 있으면 화이트리스트 모드 — KOSHA Guide causedBy 확장 안 함.
// 비어 있을 때만 KOSHA Guide의 causedBy로 추론 (over-dump 방지).
// allowFallback=false(행정성 문서, decision 006): 화이트리스트가 없으면 위험 0 — 폴백 금지.
async function loadHazards(
  guideIris: string[],
  docHazardIris: string[] = [],
  allowFallback: boolean = true,
): Promise<HazardInfo[]> {
  const seen = new Set<string>();
  const out: HazardInfo[] = [];
  const whitelist = docHazardIris.length > 0;
  for (const hIri of docHazardIris) {
    if (seen.has(hIri)) continue;
    seen.add(hIri);
    const node = (await getNode(hIri)) as HazardRawNode | undefined;
    if (node) out.push(hazardFromNode(hIri, node));
  }
  if (whitelist) return out;
  // decision 006 — 행정성 문서는 화이트리스트가 없으면 위험 0 (guidedBy→causedBy 폴백 차단).
  if (!allowFallback) return out;
  for (const gIri of guideIris) {
    const causedBy = await neighborsByEdge(gIri, "causedBy");
    for (const hIri of causedBy) {
      if (seen.has(hIri)) continue;
      seen.add(hIri);
      const node = (await getNode(hIri)) as HazardRawNode | undefined;
      if (node) out.push(hazardFromNode(hIri, node));
    }
  }
  return out;
}

// ─── Generic renderer ───
function buildSectionsFromRequiredFields(doc: DocumentNode): DocumentSection[] {
  // sections 메타 미정의 시 requiredFields 로 단일 섹션 합성 (호환 fallback)
  // legalSource·label에 IRI가 있으면 renderIri 적용 (가독성)
  const sourceText = (doc.legalBasis ?? []).map(renderIri).join(" · ");
  return [
    {
      title: "본문",
      legalSource: sourceText,
      fields: doc.requiredFields.map((f) => ({
        key: f.key,
        label: f.label,
        required: true,
        // requiredFields[].source 는 IRI 일 수 있음 → 가독 변환
        // 단 일반 텍스트(예: "별표 4 6호 사전조사 가")는 그대로
      })),
    },
  ];
}

// docId 패턴 → category 자동 추론 (fallback 노드용)
function inferCategoryFromDocId(docId: string): string {
  if (docId.startsWith("work_plan_")) return "construction_work";
  if (docId.startsWith("work_permit_")) return "permit";
  if (docId.startsWith("hazardous_risk_prevention")) return "construction_work";
  if (docId.endsWith("_register")) return "register";
  if (docId.endsWith("_report")) return "report";
  if (
    docId.startsWith("safety_health_") ||
    docId === "severe_accident_compliance" ||
    docId === "industrial_accident_report" ||
    docId === "health_safety_committee" ||
    docId === "contractor_safety_council" ||
    docId === "weekly_joint_inspection" ||
    docId === "monthly_education_log" ||
    docId === "health_examination_records" ||
    docId === "work_environment_measurement"
  ) {
    return "administrative";
  }
  return "construction_work";
}

const COMMON_META_KEYS = new Set([
  "documentNumber",
  "siteName",
  "compileDate",
  "compiler",
]);

const COMMON_APPROVAL_KEYS = new Set([
  "compiler_sign",
  "compilerSign",
  "supervisor_sign",
  "supervisorSign",
  "principal_sign",
  "principalSign",
  "approver_name",
]);

const DETAIL_COLUMN_ORDER: Record<string, string[]> = {
  victimList: [
    "name",
    "birthDate",
    "nationality",
    "employer",
    "occupation",
    "employmentType",
    "accidentType",
    "injurySeverity",
    "hospital",
  ],
  chemicalList: [
    "productName",
    "casNumber",
    "manufacturer",
    "monthlyVolume",
    "storageLocation",
    "msdsValidUntil",
    "exposureLimit",
    "mainHazard",
    "requiredPPE",
    "note",
  ],
  riskRows: [
    "task",
    "hazard",
    "currentRisk",
    "control",
    "residualRisk",
    "owner",
    "due",
  ],
};

const DETAIL_COLUMN_LABELS: Record<string, string> = {
  name: "성명",
  birthDate: "생년월일",
  nationality: "국적",
  employer: "소속",
  occupation: "직종",
  employmentType: "고용형태",
  accidentType: "재해유형",
  injurySeverity: "상해정도",
  hospital: "병원",
  productName: "제품명",
  casNumber: "CAS/구성",
  manufacturer: "제조사",
  monthlyVolume: "취급량",
  storageLocation: "비치위치",
  msdsValidUntil: "MSDS 유효기한",
  exposureLimit: "노출기준",
  mainHazard: "주요 유해성",
  requiredPPE: "필수 보호구",
  note: "비고",
  task: "작업",
  hazard: "위험요인",
  currentRisk: "현재위험도",
  control: "감소대책",
  residualRisk: "잔여위험도",
  owner: "책임자",
  due: "기한",
};

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function setIfEmpty(draft: Record<string, any>, key: string, value: unknown): void {
  if (!isEmptyValue(value) && isEmptyValue(draft[key])) draft[key] = value;
}

function formatCellValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    return `${value.length}건 (아래 상세표 참조)`;
  }
  try {
    // decision 005/결함정정: 파이프 이스케이프는 formatMarkdownCell 이 단일 책임으로 처리한다.
    // 여기서 미리 이스케이프하면 formatMarkdownCell 과 이중 이스케이프(\\\|)되어 셀이 깨진다.
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatExampleValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderExampleLines(example: unknown): string[] {
  const text = formatExampleValue(example);
  if (!text.includes("\n") && text.length <= 160) return [`  - ${text}`];
  return [
    "  - 예시 JSON:",
    "    ```json",
    ...text.split(/\r?\n/).map((line) => `    ${line}`),
    "    ```",
  ];
}

function formatMarkdownCell(value: unknown): string {
  const text = formatCellValue(value) ?? "";
  return text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function getRawFieldValue(input: Input, fieldKey: string, fieldLabel?: string): unknown {
  const d = (input.draft ?? {}) as Record<string, any>;
  const sections = (d.sections ?? {}) as Record<string, Record<string, unknown>>;
  for (const sec of Object.values(sections)) {
    if (fieldKey in sec) return sec[fieldKey];
    if (fieldLabel && fieldLabel in sec) return sec[fieldLabel];
  }
  if (fieldKey.includes(".")) {
    const [outer, inner] = fieldKey.split(".", 2);
    const o = (d as Record<string, unknown>)[outer];
    if (o && typeof o === "object" && inner in (o as Record<string, unknown>)) {
      return (o as Record<string, unknown>)[inner];
    }
  }
  if (fieldKey in d) return d[fieldKey];
  if (fieldLabel && fieldLabel in d) return d[fieldLabel];
  if (d.raw && fieldKey in d.raw) return d.raw[fieldKey];
  if (fieldLabel && d.raw && fieldLabel in d.raw) return d.raw[fieldLabel];
  return undefined;
}

function renderFieldDetailTable(field: { key: string; label: string }, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  if (!value.every((item) => item && typeof item === "object" && !Array.isArray(item))) return [];

  const objectRows = value as Array<Record<string, unknown>>;
  const preferred = DETAIL_COLUMN_ORDER[field.key] ?? [];
  const discovered = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));
  const columns = [
    ...preferred.filter((key) => discovered.includes(key)),
    ...discovered.filter((key) => !preferred.includes(key)),
  ];
  if (columns.length === 0) return [];

  const lines: string[] = [];
  lines.push("");
  lines.push(`### ${field.label} 상세`);
  lines.push("");
  lines.push(`| ${columns.map((key) => DETAIL_COLUMN_LABELS[key] ?? key).join(" | ")} |`);
  lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of objectRows) {
    lines.push(`| ${columns.map((key) => formatMarkdownCell(row[key])).join(" | ")} |`);
  }
  return lines;
}

function normalizeDraftAliases(input: Input): void {
  const draft = (input.draft ?? {}) as Record<string, any>;
  const metadata = (draft.metadata ?? {}) as Record<string, any>;

  setIfEmpty(draft, "documentNumber", metadata.documentNumber ?? draft.documentId);
  setIfEmpty(draft, "siteName", metadata.siteName ?? metadata.projectName);
  setIfEmpty(draft, "projectName", metadata.projectName ?? metadata.siteName);
  setIfEmpty(draft, "compileDate", metadata.compileDate ?? metadata.planDate ?? metadata.assessmentDate ?? metadata.date);
  setIfEmpty(draft, "planDate", metadata.planDate ?? metadata.assessmentDate ?? metadata.date);
  setIfEmpty(draft, "compiler", metadata.compiler ?? metadata.author ?? metadata.supervisor);
  setIfEmpty(draft, "supervisor", metadata.supervisor);

  // 사용자 metadata 가 autoFillFromProfile 의 profile stale 데이터를
  // 우선하도록 normalize 단계에서 draft 평면 키로 미리 옮긴다.
  setIfEmpty(draft, "businessNumber", metadata.businessNumber);
  setIfEmpty(draft, "address", metadata.address);
  setIfEmpty(draft, "siteAddress", metadata.siteAddress ?? metadata.address);
  setIfEmpty(draft, "contractAmount", metadata.contractAmount);
  setIfEmpty(draft, "contractPeriod", metadata.contractPeriod);
  setIfEmpty(draft, "constructionType", metadata.constructionType);
  setIfEmpty(draft, "constructionScale", metadata.constructionScale ?? metadata.scale);
  setIfEmpty(draft, "projectInfo", metadata.projectInfo);
  setIfEmpty(draft, "department", metadata.department);
  setIfEmpty(draft, "principalName", metadata.principalName ?? metadata.ownerName);
  setIfEmpty(draft, "ownerName", metadata.ownerName ?? metadata.principalName);
  setIfEmpty(draft, "workerCount", metadata.workerCount);
  setIfEmpty(draft, "industryCode", metadata.industryCode);

  const approvalChain = Array.isArray(draft.approvalChain) ? draft.approvalChain : [];
  const findApprover = (...keywords: string[]) =>
    approvalChain.find((a: any) => keywords.some((kw) => String(a?.role ?? "").includes(kw)));
  const formatSign = (a: any): string | undefined =>
    a?.name ? `${a.name}${a.title || a.role ? ` (${a.title ?? a.role}, 서명)` : " (서명)"}` : undefined;

  const compiler = findApprover("작성자", "보고자", "안전관리자", "보건관리자");
  const supervisor = findApprover("관리감독자", "감독자");
  const principal = findApprover("사업주", "대표", "현장소장", "안전보건관리책임자");

  setIfEmpty(draft, "compiler_sign", formatSign(compiler));
  setIfEmpty(draft, "reporterSign", formatSign(compiler));
  setIfEmpty(draft, "supervisor_sign", formatSign(supervisor));
  setIfEmpty(draft, "principal_sign", formatSign(principal));
  setIfEmpty(draft, "principalSign", formatSign(principal));
  setIfEmpty(draft, "principalName", principal?.name);
}

function listDocInputFields(doc: DocumentNode): Array<{ key: string; label?: string }> {
  const sectionFields = (doc.sections ?? [])
    .flatMap((sec) => sec.fields ?? [])
    .filter((f) => typeof f?.key === "string")
    .map((f) => ({ key: f.key, label: f.label }));
  if (sectionFields.length > 0) return sectionFields;
  return (doc.requiredFields ?? [])
    .filter((f) => typeof f?.key === "string")
    .map((f) => ({ key: f.key, label: f.label }));
}

function normalizeA2UIDraftAliases(input: Input, doc: DocumentNode): void {
  const draft = (input.draft ?? {}) as Record<string, any>;
  const fields = listDocInputFields(doc);
  const fieldPathMap = (draft.fieldPathMap ?? draft._a2uiFieldPathMap ?? {}) as Record<string, unknown>;
  const aliases: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 1) {
    aliases[`field-${i}-input`] = fields[i].key;
  }
  for (const [from, to] of Object.entries(fieldPathMap)) {
    if (typeof to === "string" && to) aliases[from] = to;
  }
  for (const [from, to] of Object.entries(aliases)) {
    if (from in draft) setIfEmpty(draft, to, draft[from]);
    if (draft.raw && typeof draft.raw === "object" && from in draft.raw) setIfEmpty(draft, to, draft.raw[from]);
  }
  for (const f of fields) {
    if (f.label && f.label in draft) setIfEmpty(draft, f.key, draft[f.label]);
  }
}

function getFieldValue(input: Input, fieldKey: string, fieldLabel?: string): string | undefined {
  return formatCellValue(getRawFieldValue(input, fieldKey, fieldLabel));
}

function renderApprovalChain(chain: any): string {
  if (!chain || !Array.isArray(chain) || chain.length === 0) return "(미작성 — 사업주·관리감독자·근로자대표 서명 필수)";
  return chain
    .map(
      (a: any) =>
        `| ${a.role} | ${a.name} | ${a.signed ? "✓" : "(미서명)"} | ${a.date ?? "(미기재)"} |`,
    )
    .join("\n");
}

function renderEmergencyContacts(c: any): string {
  const e = (c ?? {}) as { fire?: string; labor?: string; hospital?: string; owner?: string };
  return [
    `- 119 (소방): ${e.fire ?? "119"}`,
    `- 관할 지방고용노동청: ${e.labor ?? "(미기재 — 작성 필수)"}`,
    `- 응급의료기관: ${e.hospital ?? "(미기재 — 작성 필수)"}`,
    `- 사업주 비상연락: ${e.owner ?? "(미기재 — 작성 필수)"}`,
  ].join("\n");
}

function shouldSkipGenericSection(sec: DocumentSection): boolean {
  const keys = (sec.fields ?? []).map((f) => f.key);
  if (keys.length === 0) return false;
  const metaOnly = keys.every((key) => COMMON_META_KEYS.has(key));
  if (metaOnly && /문서\s*메타|사업장\s*정보/.test(sec.title)) return true;

  const approvalOnly = keys.every((key) => COMMON_APPROVAL_KEYS.has(key));
  if (approvalOnly && /결재선/.test(sec.title)) return true;

  return false;
}

async function renderGeneric(
  doc: DocumentNode,
  input: Input,
  kosha: KoshaGuideInfo[],
  hazards: HazardInfo[],
  controls: ControlInfo[],
  directControlIris: Set<string>,
  legalBodyByIri: Map<string, string | undefined>,
  // decision 006 — 행정성 문서로 위험 폴백이 차단됐는지 (hazards 비었을 때 메시지 결정용)
  hazardFallbackSuppressed: boolean = false,
): Promise<string> {
  const d = (input.draft ?? {}) as Record<string, any>;
  const metadata = (d.metadata ?? {}) as Record<string, any>;
  const meta = {
    siteName: d.siteName ?? d.projectName ?? metadata.siteName ?? metadata.projectName ?? "(미작성)",
    planDate: d.compileDate ?? d.planDate ?? metadata.planDate ?? metadata.assessmentDate ?? kstToday(),
    supervisor: d.supervisor ?? d.compiler ?? d.principal_sign ?? metadata.supervisor,
  } as { siteName: string; planDate: string; supervisor?: string };
  const sections = doc.sections && doc.sections.length > 0 ? doc.sections : buildSectionsFromRequiredFields(doc);

  // Document category — 양식 일관성 (행정 문서 vs 작업 문서) — v0.8 결함 #3 정정 + v0.9 fallback 추론
  const metaCat = (doc._meta as { documentCategory?: string } | undefined)?.documentCategory;
  const category = metaCat ?? inferCategoryFromDocId(doc.docId);
  // decision 006: 라벨(행정/작업) 판정을 위험 폴백 분류기 allowGuideFallback 과 일원화한다.
  // 이전엔 3값(administrative/report/register)만 행정 처리해, 위험 억제 집합(7값)에는 있으나
  // 여기 없는 appointment/application/education/council(및 meta 없는 선임·교육 docId) 문서가
  // "작업기간" 라벨 + "위험요인 미해당" 을 동시 출력하는 모순이 있었다. allowGuideFallback 으로 통일.
  const isAdmin = !allowGuideFallback(metaCat, doc.docId);
  const siteLabel = isAdmin ? "사업장명/소재지" : "현장명";
  const supervisorLabel = isAdmin ? "작성책임자" : "작업지휘자/책임자";
  const periodLabel = isAdmin ? "유효 기간" : "작업기간";
  const periodValue =
    d.workPeriod ??
    d.validPeriod ??
    d.effectivePeriod ??
    metadata.workPeriod ??
    metadata.validPeriod ??
    metadata.effectivePeriod;
  const shouldRenderPeriod = !isAdmin || !isEmptyValue(periodValue);

  const lines: string[] = [];
  lines.push(`# ${doc.title}`);
  lines.push("");
  if (doc.legalBasis && doc.legalBasis.length > 0) {
    // v0.8: IRI 사람 가독 변환
    lines.push(`> 법적 근거: ${doc.legalBasis.map(renderIri).join(" · ")}`);
    lines.push("");
  }
  if (doc.description) {
    lines.push(`> ${doc.description}`);
    lines.push("");
  }

  // 행정 메타·결재선·작업조건은 번호 없이 표기 — sections 가 자체 번호(별지 ①~⑤·GHS 16항 등)를
  // 가질 수 있어 충돌 방지 (BLOCKER cosmetic 정정 2026-04-29). sections 본문은 자체 번호 또는
  // 자동 번호(secNo) 중 하나로 일관 처리.
  // decision 005 / 결함 정정: 문서메타 표의 모든 셀을 formatMarkdownCell 로 일원화.
  // siteName="A | 사망 | 50세" 같은 파이프 포함 값이 2열표를 4열로 붕괴시키거나,
  // supervisor 줄바꿈이 행을 누출시키는 것을 방지 (파이프 \| 이스케이프, 줄바꿈 <br>).
  const docNumber =
    d.documentNumber ?? d.documentId ?? "(자동) DOC-" + (meta.planDate ?? "YYYYMMDD").replace(/-/g, "") + "-001";
  lines.push(`## 문서 메타`);
  lines.push("");
  lines.push(`| 항목 | 내용 |`);
  lines.push(`|---|---|`);
  lines.push(`| 문서번호 | ${formatMarkdownCell(docNumber)} |`);
  lines.push(`| ${siteLabel} | ${formatMarkdownCell(meta.siteName)} |`);
  lines.push(`| 작성일 | ${formatMarkdownCell(meta.planDate)} |`);
  if (shouldRenderPeriod) {
    lines.push(`| ${periodLabel} | ${formatMarkdownCell(periodValue) || "(미기재 — 작성 필수)"} |`);
  }
  if (meta.supervisor) lines.push(`| ${supervisorLabel} | ${formatMarkdownCell(meta.supervisor)} |`);
  lines.push("");

  // 결재선
  lines.push(`## 결재선`);
  lines.push("");
  lines.push(`| 역할 | 성명 | 서명 | 일자 |`);
  lines.push(`|---|---|---|---|`);
  if (d.approvalChain && d.approvalChain.length > 0) {
    lines.push(renderApprovalChain(d.approvalChain));
  } else {
    lines.push(`| 사업주 | (미작성) | (미서명) | (미기재) |`);
    lines.push(`| 관리감독자 | (미작성) | (미서명) | (미기재) |`);
    lines.push(`| 근로자대표 | (미작성) | (미서명) | (미기재) |`);
  }
  lines.push("");

  // 작업 조건 — workConditions 입력 있을 때 자동 노출
  let secNo = 1;
  // workConditions 키 → 한국어 라벨 변환 (v0.13 결함 #1 정정)
  const WORK_COND_LABELS: Record<string, string> = {
    depthM: "굴착 깊이 (m)",
    heightM: "작업 높이 (m)",
    voltageV: "전압 (V)",
    workforce: "작업 인원 (명)",
    location: "작업 위치·상세",
    locationDetail: "작업 위치·상세",
    weather: "기상 조건",
    duration: "작업 시간",
    chemicalName: "취급 화학물질",
    spanM: "지간 길이 (m)",
  };
  if (d.workConditions && Object.keys(d.workConditions).length > 0) {
    lines.push(`## 작업 조건`);
    lines.push("");
    lines.push(`| 항목 | 값 |`);
    lines.push(`|---|---|`);
    for (const [k, v] of Object.entries(d.workConditions)) {
      const label = WORK_COND_LABELS[k] ?? k;
      // formatMarkdownCell 로 일원화 — 파이프·줄바꿈 이스케이프 (표 무결)
      lines.push(`| ${formatMarkdownCell(label)} | ${formatMarkdownCell(v)} |`);
    }
    lines.push("");
  }

  // 4+. 양식 섹션 자동 렌더 (inputGuide 포함 — LLM 빈칸 작성 보조)
  for (const sec of sections) {
    if (shouldSkipGenericSection(sec)) continue;
    // sec.title 이 이미 "1.", "1)", "①", "Ⅰ.", "가." 등으로 시작하면 renderer 자동 번호 생략 (별지 호 양식 충돌 방지)
    const titleHasOwnNumber = /^\s*(\d+[\.\-)]|[①-⑳]|\([0-9]+\)|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ][\s.\-]|[가나다라마바사아자차]\.\s)/.test(sec.title);
    const heading = titleHasOwnNumber
      ? `## ${sec.title}${sec.legalSource ? ` (${sec.legalSource})` : ""}`
      : `## ${secNo}. ${sec.title}${sec.legalSource ? ` (${sec.legalSource})` : ""}`;
    lines.push(heading);
    lines.push("");

    const fieldsWithGuide = (sec.fields ?? []).filter((f) => {
      const v = getFieldValue(input, f.key, f.label);
      return (!v || v === "") && f.inputGuide;
    });

    if (sec.fields.length > 0) {
      lines.push(`| 항목 | 내용 |`);
      lines.push(`|---|---|`);
      for (const f of sec.fields) {
        // 값 셀을 formatMarkdownCell 로 일원화 — 파이프·줄바꿈 이스케이프 (표 무결).
        // 미작성 placeholder 는 이스케이프 불필요하나 라벨/값 모두 일관 처리.
        const v = getFieldValue(input, f.key, f.label);
        const cell =
          v !== undefined && v !== ""
            ? formatMarkdownCell(v)
            : (f.placeholder ?? (f.required ? "(미작성 — 필수)" : "(미작성)"));
        lines.push(`| ${formatMarkdownCell(f.label)} | ${cell} |`);
      }
      for (const f of sec.fields) {
        const rawValue = getRawFieldValue(input, f.key, f.label);
        lines.push(...renderFieldDetailTable({ key: f.key, label: f.label }, rawValue));
      }
    }

    if (fieldsWithGuide.length > 0) {
      lines.push("");
      lines.push(`> 📝 **빈칸 작성 가이드** (LLM이 사용자 input + 그래프 컨텍스트로 채울 수 있도록):`);
      lines.push("");
      for (const f of fieldsWithGuide) {
        lines.push(`**[${f.label}]**`);
        if (f.inputGuide) lines.push(`- 작성 방법: ${f.inputGuide}`);
        if (f.standardFormat) lines.push(`- 표준 형식: \`${f.standardFormat}\``);
        if (f.examples && f.examples.length > 0) {
          lines.push(`- 예시:`);
          for (const ex of f.examples as unknown[]) lines.push(...renderExampleLines(ex));
        }
        if (f.checkPoints && f.checkPoints.length > 0) {
          lines.push(`- 체크포인트: ${f.checkPoints.join(" / ")}`);
        }
        lines.push("");
      }
    }

    if (sec.notes && sec.notes.length > 0) {
      lines.push("");
      for (const n of sec.notes) lines.push(`> ${n}`);
    }
    lines.push("");
    secNo += 1;
  }

  // 부속 정보(위험요소·통제·KOSHA·법령·비상·통지)는 모두 라벨로 표기 — 양식 본문 번호와 충돌 방지.
  // 위험 요소 — 화이트리스트(hasHazard)는 그래프 직접 매핑, 그 외엔 KOSHA Guide causedBy 추론.
  // decision 006 — 행정성 문서는 위험 폴백을 차단하므로 hazards 가 비면 "위험요인 미해당"으로 표기
  // (근거 없는 위험을 그래프 추론인 양 제시하는 환각 방지).
  const hazardHeader =
    hazards.length === 0 && hazardFallbackSuppressed
      ? `## 식별된 위험 요소`
      : `## 식별된 위험 요소 (그래프 추론 — KOSHA Guide ${kosha.length}건 기반)`;
  lines.push(hazardHeader);
  lines.push("");
  if (hazards.length === 0) {
    lines.push(
      hazardFallbackSuppressed
        ? `> 본 문서는 행정·선임·게시·보고 성격으로 특정 작업 위험요인을 다루지 않습니다 (위험요인 미해당).`
        : `> (그래프 매핑된 Hazard 없음)`,
    );
  } else {
    lines.push(`| 위험 분류 | 카테고리 |`);
    lines.push(`|---|---|`);
    for (const h of hazards) lines.push(`| ${h.label} | ${h.category} |`);
  }
  lines.push("");

  // 권장 안전대책 (ERIC-PP) — 위험요소와 직접 연관된 control만 우선 표시
  lines.push(`## 권장 안전대책 (ERIC-PP 위계 — 그래프 추론)`);
  lines.push(
    `> **ERIC-PP 5계층** — 1. 제거 (Elimination) > 2. 대체 (Substitution) > 3. 공학적 (Engineering) > 4. 관리적 (Administrative) > 5. 보호구 (PPE). 위계가 높을수록 효과적이며, 가능한 한 상위 계층 통제부터 적용한다 (ISO 45001:2018 § 8.1.2).`,
  );
  lines.push("");
  if (controls.length === 0) {
    lines.push(`> (그래프 매핑된 Control 없음)`);
  } else {
    // 문서·위험요소에 직접 연결된 control만 우선 표시
    const directlyMapped = new Set<string>(directControlIris);
    for (const h of hazards) {
      for (const c of (h as any).mitigatedBy ?? []) {
        if (typeof c === "string") directlyMapped.add(c);
      }
    }
    // 직접 연결 + 미연결로 분리, 위계 순으로 정렬
    const direct = controls.filter((c) => directlyMapped.has(c.iri));
    const indirect = controls.filter((c) => !directlyMapped.has(c.iri));
    // 위계별 카운트 캡 (관리적·공학적은 4개씩, 제거/대체/PPE는 2개씩)
    const TIER_CAP: Record<number, number> = { 1: 2, 2: 2, 3: 4, 4: 4, 5: 2 };
    const labelMap: Record<number, string> = {
      1: "1. 제거 (Elimination)",
      2: "2. 대체 (Substitution)",
      3: "3. 공학적 (Engineering)",
      4: "4. 관리적 (Administrative)",
      5: "5. 보호구 (PPE)",
    };
    const sortedDirect = [...direct].sort((a, b) => a.ericLevel - b.ericLevel);
    const tierUsed: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const selected: typeof controls = [];
    for (const c of sortedDirect) {
      const cap = TIER_CAP[c.ericLevel] ?? 3;
      if ((tierUsed[c.ericLevel] ?? 0) < cap) {
        selected.push(c);
        tierUsed[c.ericLevel] = (tierUsed[c.ericLevel] ?? 0) + 1;
      }
    }
    // 위계별로 직접 매핑 부족 시 indirect로 보충 (총 15개 cap)
    if (selected.length < 15) {
      for (const c of indirect.sort((a, b) => a.ericLevel - b.ericLevel)) {
        if (selected.length >= 15) break;
        const cap = TIER_CAP[c.ericLevel] ?? 3;
        if ((tierUsed[c.ericLevel] ?? 0) < cap) {
          selected.push(c);
          tierUsed[c.ericLevel] = (tierUsed[c.ericLevel] ?? 0) + 1;
        }
      }
    }

    lines.push(`> 직접 매핑 ${direct.length}개 + 일반 ${indirect.length}개 중 위계별 선별 ${selected.length}개 표시`);
    lines.push("");
    lines.push(`| 위계 | 대책 | 매핑 |`);
    lines.push(`|---|---|:---:|`);
    for (const c of selected) {
      const directMark = directlyMapped.has(c.iri) ? "직접" : "—";
      lines.push(`| ${labelMap[c.ericLevel] ?? c.ericLevel} | ${c.label} | ${directMark} |`);
    }
  }
  lines.push("");

  // 적용 KOSHA Guide
  lines.push(`## 적용 KOSHA Guide (${kosha.length}건)`);
  lines.push("");
  if (kosha.length === 0) {
    lines.push(`> (매핑된 KOSHA Guide 없음)`);
  } else {
    lines.push(`| 번호 | 제목 |`);
    lines.push(`|---|---|`);
    for (const g of kosha.slice(0, 30)) lines.push(`| ${g.guideNo} | ${g.title} |`);
    if (kosha.length > 30) lines.push(`| ... | (외 ${kosha.length - 30}건) |`);
  }
  lines.push("");

  // 법령 근거 — v0.8: IRI 가독 변환 + 본문 발췌
  if (doc.legalBasis && doc.legalBasis.length > 0) {
    lines.push(`## 법령 근거`);
    lines.push("");
    for (const l of doc.legalBasis) {
      lines.push(`### ${renderIri(l)}`);
      // 결재본 인쇄 면적 절약 — 200자 발췌 (handler 가 400자로 한 번 읽어서 전달)
      const fullBody = legalBodyByIri.get(l);
      const body = fullBody ? fullBody.slice(0, 200) : undefined;
      if (body) {
        lines.push("");
        lines.push("```");
        lines.push(body.length >= 200 ? body + " ⋯ (전문은 별첨)" : body);
        lines.push("```");
      }
      lines.push("");
    }
    if (doc.penaltyOnMissing) {
      const penalties = Array.isArray(doc.penaltyOnMissing) ? doc.penaltyOnMissing : [doc.penaltyOnMissing];
      lines.push(`### 위반 시 처벌`);
      for (const p of penalties) lines.push(`- ${renderIri(p)}`);
      lines.push("");
    }
  }

  // 비상연락망
  lines.push(`## 비상연락망`);
  lines.push("");
  lines.push(renderEmergencyContacts(d.emergencyContacts ?? {}));
  lines.push("");

  // 근로자 통지 (적용 시)
  if (d.workerNotification) {
    lines.push(`## 근로자 통지`);
    lines.push("");
    const wn = (d.workerNotification ?? {}) as Record<string, unknown>;
    lines.push(`- 통지 방법: ${wn["method"] ?? "(미기재 — TBM·게시·서명 권장)"}`);
    lines.push(`- 통지 일자: ${wn["date"] ?? "(미기재)"}`);
    lines.push(`- 통지 증빙: ${wn["evidence"] ?? "(미기재)"}`);
    lines.push("");
  }

  return lines.join("\n");
}

interface DocumentRenderContext {
  doc: DocumentNode;
  input: Input;
  sections: DocumentSection[];
  kosha: KoshaGuideInfo[];
  hazards: HazardInfo[];
  controls: ControlInfo[];
  directControlIris: Set<string>;
  legalBodyByIri: Map<string, string | undefined>;
  hazardFallbackSuppressed: boolean;
  documentCategory: string;
  missingRequiredCount: number;
}

const SAFETY_DISCLAIMER = `본 문서는 agent-safety-oss 가 생성한 초안입니다. 결재·제출 전에 안전관리자 본인이 본문·법령 인용·필수 항목을 직접 검토하고, review_safety_document 도구로 환각·누락 확인, 중대재해·산업재해 관련 사항은 법무·노무 협의가 필요합니다. 작성 주체는 안전관리자이며 본 OSS 는 작성 보조만 수행합니다.`;
const MARKDOWN_SAFETY_DISCLAIMER = `\n\n---\n\n> ℹ️ **본 문서는 agent-safety-oss 가 생성한 초안입니다.** 결재·제출 전에 (1) 안전관리자 본인이 본문·법령 인용·필수 항목을 직접 검토하고, (2) \`review_safety_document\` 도구로 환각·누락 확인, (3) 중대재해·산업재해 관련 사항은 법무·노무 협의가 필요합니다. **작성 주체는 안전관리자이며 본 OSS 는 작성 보조만 수행합니다.**\n`;

function renderUsabilityHeader(missingRequiredCount: number): string {
  return missingRequiredCount > 0
    ? `> 🚫 **결재 사용 불가** — 필수 항목 ${missingRequiredCount}건 미작성. 미작성 항목은 \`structuredContent.validation.issues\` 참조. 결재 전 반드시 보강.\n\n`
    : `> ✅ **필수 항목 모두 작성됨** — 결재 가능 (단 결재선 서명·날짜 별도 확인).\n\n`;
}

async function renderMarkdownOutput(context: DocumentRenderContext): Promise<string> {
  const body = await renderGeneric(
    context.doc,
    context.input,
    context.kosha,
    context.hazards,
    context.controls,
    context.directControlIris,
    context.legalBodyByIri,
    context.hazardFallbackSuppressed,
  );
  return (
    renderUsabilityHeader(context.missingRequiredCount) +
    body +
    (context.doc.retention ? `\n---\n*보존: ${context.doc.retention}*` : "") +
    MARKDOWN_SAFETY_DISCLAIMER
  );
}

function renderDoclangOutput(context: DocumentRenderContext): string {
  const draft = (context.input.draft ?? {}) as Record<string, unknown>;
  const statusText = context.missingRequiredCount > 0
    ? `결재 사용 불가 — 필수 항목 ${context.missingRequiredCount}건 미작성. 결재 전 반드시 보강.`
    : "필수 항목 모두 작성됨 — 결재 가능 (단 결재선 서명·날짜 별도 확인).";
  const serializerInput: SafetyDocumentDoclangInput = {
    document: context.doc,
    draft,
    sections: context.sections,
    kosha: context.kosha,
    hazards: context.hazards,
    controls: context.controls,
    directControlIris: context.directControlIris,
    legalBodyByIri: context.legalBodyByIri,
    hazardFallbackSuppressed: context.hazardFallbackSuppressed,
    documentCategory: context.documentCategory,
    missingRequiredCount: context.missingRequiredCount,
    statusText,
    safetyDisclaimer: SAFETY_DISCLAIMER,
  };
  return serializeSafetyDocumentToDoclang(serializerInput);
}

const DOCUMENT_RENDERERS: Record<OutputFormat, (context: DocumentRenderContext) => Promise<string> | string> = {
  md: renderMarkdownOutput,
  doclang: renderDoclangOutput,
};

// 검증 결과 푸터 (v0.14 — 사용자 입력 사실성 검증)
// 향후 검증 UI 보강 시 호출 예정 (P-PAPER-2b). 현재 inactive — 함수 보존.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _renderValidation(report: ValidationReport, retention?: string): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`---`);
  lines.push(`## 입력 검증 결과 (v0.14)`);
  lines.push("");
  if (report.summary.errors === 0 && report.summary.warnings === 0) {
    lines.push(`✓ 입력 형식 검증 통과 (CAS·H-code·날짜·결재선 모두 정상)`);
  } else {
    if (report.errors.length > 0) {
      lines.push(`### ✗ 오류 (${report.errors.length}건) — 정정 후 재제출 권장`);
      for (const e of report.errors) {
        lines.push(`- **${e.field}**: ${e.message}${e.suggested ? ` → ${e.suggested}` : ""}`);
      }
    }
    if (report.warnings.length > 0) {
      lines.push("");
      lines.push(`### ⚠ 경고 (${report.warnings.length}건) — 검토 권장`);
      for (const w of report.warnings) {
        lines.push(`- ${w.field}: ${w.message}`);
      }
    }
  }
  lines.push("");
  lines.push(`---`);
  lines.push(`> 본 문서는 agent-safety-oss \`generate_safety_document\` 도구로 *결정론적*으로 생성되었습니다.`);
  lines.push(`> KOSHA Guide·법령 인용은 모두 그래프 IRI 매핑 기반 — 환각 통로 0.`);
  lines.push(`> ⚠ **본 OSS는 *초안 도구*입니다. 최종본은 안전관리자 검토 후 인쇄·서명·제출하세요.**`);
  lines.push(`> 입력 *내용 사실성* (수치·법규 분류·도메인 지식)은 사용자 책임. 본 도구는 *형식 검증*만.`);
  if (retention) lines.push(`> 보존: ${retention}`);
  return lines.join("\n");
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  // A2UI 경로 보강: doc + A2UI alias normalize 를 profile 이전 실행.
  // 교차 검증 가 짚은 P0-1 잔여 위험 — A2UI field-N-input 으로
  // 들어온 사용자 값이 profile 자동채움 이후 setIfEmpty 에 막혀 profile 값을 이기지
  // 못하던 회귀를 해소. 순서: parse → doc → flat normalize → A2UI flat → profile fill.
  const doc = await getDocument(input.docId);
  if (!doc) {
    const available = (await listDocuments())
      .filter((d) => !d["@id"].startsWith("doc:kosha_guide"))
      .map((d) => d.docId)
      .slice(0, 50);
    return {
      content: [{
        type: "text",
        text: `[NOT_FOUND] docId='${input.docId}' Document 노드 미발견.\n\n사용 가능 docId:\n${available.map((s) => `  - ${s}`).join("\n")}`,
      }],
      structuredContent: { error: "doc_not_found", docId: input.docId, availableDocIds: available },
      isError: true,
    } as McpToolResult;
  }

  normalizeDraftAliases(input);
  normalizeA2UIDraftAliases(input, doc);

  // v0.4 — SSoT 사이트 프로파일 자동 채움 (사용자 input + A2UI alias 평탄화 이후)
  if (input.useProfile !== false) {
    try {
      const { loadProfile, autoFillFromProfile } = await import("../lib/site-profile.js");
      const profile = await loadProfile();
      if (profile.sites.length > 0 || profile.projects.length > 0) {
        const result = autoFillFromProfile(input.draft as Record<string, unknown>, {
          siteId: input.siteId,
          projectId: input.projectId,
          profile,
          docId: input.docId,
        });
        (input as any).draft = result.draft;
        normalizeDraftAliases(input);
        result.appliedFields;
      }
    } catch (e) {
      // 프로파일 미등록 또는 오류 — 자동 채움 skip, 사용자 입력만 사용
    }
  }

  // 그래프 추론 — 독립 호출 병렬화
  const guidedByIris = doc.guidedBy ?? [];
  // decision 006 — 문서 성격 판정: 행정성 문서는 위험 폴백 차단(화이트리스트만).
  // 주의: 위험 폴백 결정은 *원본 documentCategory 메타* + docId 패턴만 사용한다.
  // inferCategoryFromDocId(양식 스타일용)는 weekly_joint_inspection 등을 administrative 로
  // 분류해 위험 폴백을 잘못 차단하므로 hazard 결정에 쓰지 않는다.
  const documentCategoryMeta = (doc._meta as { documentCategory?: string } | undefined)?.documentCategory;
  const documentCategory = documentCategoryMeta ?? inferCategoryFromDocId(doc.docId);
  const hazardFallbackAllowed = allowGuideFallback(documentCategoryMeta, doc.docId);
  const [kosha, hazards] = await Promise.all([
    loadKoshaGuides(guidedByIris),
    loadHazards(
      guidedByIris,
      (doc as DocumentNode & { hasHazard?: string[] }).hasHazard ?? [],
      hazardFallbackAllowed,
    ),
  ]);
  const docControlIris = ((doc as DocumentNode & { mitigatedBy?: string[] }).mitigatedBy ?? []);
  const directControlIris = new Set<string>(docControlIris);
  const controls = await loadControls(guidedByIris, Array.from(directControlIris));

  // decision 006 — 위험 폴백이 차단됐고 화이트리스트도 없어 위험이 비워진 경우 (렌더 메시지용)
  const hasWhitelist = ((doc as DocumentNode & { hasHazard?: string[] }).hasHazard ?? []).length > 0;
  const hazardFallbackSuppressed = !hazardFallbackAllowed && !hasWhitelist;

  // 법령 본문 발췌 — IRI당 1회 (400자) → 결재본은 200자 slice, structuredContent는 400자
  const legalBodyByIri = new Map<string, string | undefined>();
  await Promise.all((doc.legalBasis ?? []).map(async (l) => {
    let body: string | undefined;
    if (l.startsWith("art:")) body = await extractArticleBody(l, 400);
    else if (l.startsWith("annex:")) body = await extractAnnexBody(l, 400);
    legalBodyByIri.set(l, body);
  }));

  // v0.14 — 사용자 입력 사실성 검증 (구조화 데이터로만 노출, 결재본에는 미포함)
  const validation = validateDocumentInput(
    input.docId,
    input.draft as Parameters<typeof validateDocumentInput>[1],
    {
      requiredFields: doc.requiredFields as Array<{ key: string; label: string; source?: string }> | undefined,
      sections: doc.sections as Array<{ title?: string; fields?: Array<{ key: string; label?: string; required?: boolean }> }> | undefined,
    },
  );
  // v0.15: 결재본 본문은 깨끗이 — 보존 한 줄만 푸터로
  // 필수 항목 미작성 검증 (validation.errors 中 sections. prefix)
  const missingRequiredCount = validation.errors.filter(
    (i) => i.field.startsWith("sections."),
  ).length;
  const sections = doc.sections && doc.sections.length > 0 ? doc.sections : buildSectionsFromRequiredFields(doc);
  const renderContext: DocumentRenderContext = {
    doc,
    input,
    sections,
    kosha,
    hazards,
    controls,
    directControlIris,
    legalBodyByIri,
    hazardFallbackSuppressed,
    documentCategory,
    missingRequiredCount,
  };
  const markdownBody = await DOCUMENT_RENDERERS.md(renderContext);
  const fullBody = input.format === "md" ? markdownBody : await DOCUMENT_RENDERERS[input.format](renderContext);

  // 폼 UI 자동 채움 카드 — handler 시작에서 캐시한 400자 본문 재사용
  const legalArticles = (doc.legalBasis ?? []).map((l) => ({
    iri: l,
    name: renderIri(l),
    bodyExcerpt: legalBodyByIri.get(l),
  }));

  const docNode = doc as Record<string, any>;

  // hazard·activity·equipment 노드의 koshaArchiveFacets 합집합 — 자료실 트리 대신 IRI traversal
  const activityIris = (docNode.appliesToActivities ?? []) as string[];
  const equipmentIris = (docNode.involves ?? []) as string[];
  const traversed = (await Promise.all([...activityIris, ...equipmentIris].map((i) => getNode(i)))) as Array<NodeWithFacets | undefined>;
  const facetSet = new Set<string>([
    ...hazards.flatMap((h) => h.koshaArchiveFacets),
    ...traversed.flatMap((n) => n?.koshaArchiveFacets ?? []),
  ]);

  const graphContext = {
    documentNode: docNode["@id"] ?? `doc:?/${input.docId}`,
    legalBasis: (doc.legalBasis ?? []) as string[],
    appliesToActivities: (docNode.appliesToActivities ?? []) as string[],
    cycle: docNode.cycle ?? null,
    relatedHazards: hazards.map((h) => h.iri),
    relatedControls: controls.map((c) => c.iri),
    relatedKoshaGuides: kosha.map((g) => g.iri),
    koshaArchiveFacets: Array.from(facetSet),
    references: (docNode.references ?? []) as string[],
    informedBy: (docNode.informedBy ?? []) as string[],
    citedIn: (docNode.cited_in ?? []) as string[],
    evaluatedBy: (docNode.evaluatedBy ?? []) as string[],
    involves: (docNode.involves ?? []) as string[],
    sources: ["src:law_go_kr", "src:kosha_portal"],
    relatedAssessmentMethod: (docNode.evaluatedBy ?? []).find((id: string) =>
      id.startsWith("method:") && !id.startsWith("method:kras_step_") && !id.includes("risk_matrix")
    ) ?? null,
    suggestedNextTools: [
      ...(input.docId.includes("risk_assessment") ? ["choose_assessment_method", "get_risk_assessment_schema"] : []),
      ...((doc.legalBasis ?? []).length > 0 ? ["get_safety_law_article"] : []),
      ...(kosha.length > 0 ? ["get_kosha_guide_md"] : []),
      ...(facetSet.size > 0 ? ["search_kosha_archive", "list_kosha_archive_facets"] : []),
      "review_safety_document",
    ],
  };

  return {
    content: [{ type: "text", text: fullBody }],
    structuredContent: {
      docId: input.docId,
      title: doc.title,
      koshaGuideCount: kosha.length,
      hazardCount: hazards.length,
      controlCount: controls.length,
      sectionsCount: (doc.sections ?? []).length,
      legalBasisCount: (doc.legalBasis ?? []).length,
      bodyMarkdownLength: markdownBody.length,
      // decision 006 — 위험 출처/폴백 차단 여부 (환각 차단 관찰용)
      documentCategory,
      hazardSource: hasWhitelist ? "whitelist" : hazardFallbackAllowed ? "guide_fallback" : "suppressed_administrative",
      inferred: {
        hazards,
        controls,
        kosha,
        legalArticles,
      },
      validation: {
        errors: validation.summary.errors,
        warnings: validation.summary.warnings,
        issues: [...validation.errors, ...validation.warnings].slice(0, 10),
      },
      graphContext,
      _meta: COMMON_RESPONSE_META,
    },
  };
}

export const generateSafetyDocumentTool: ToolDefinition = {
  name: "generate_safety_document",
  description:
    "법정 안전관리 문서의 **초안 본문**을 결정론적으로 생성한다. v0.7 — Document.sections 기반 generic renderer로 모든 docId 자동 처리. 그래프 추론(KOSHA·Hazard·Control·법령) + 작업 조건 합성 → Markdown. `format=doclang` 은 DocLang v0.6 XML experimental 출력. PDF·docx 변환은 클라이언트. **⚠️ 작성 보조: 본 도구 단독 결과는 초안일 뿐, 결재 가능 여부 확인은 `review_safety_document` 호출 필수. 작성 주체는 안전관리자이며 MCP는 보조. 중대재해·산업재해 관련 문서는 법무·노무 검토 필요.**",
  inputSchema,
  handler,
};
