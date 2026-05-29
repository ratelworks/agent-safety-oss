import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { EvidenceItemSchema } from "../evidence/evidence.schema.js";
import { getArticle, listLaws } from "../lib/safety-laws-loader.js";
import { getDocument, getNode, type DocumentNode } from "../lib/graph-nodes-loader.js";
import { legalRefToIri } from "../lib/article-iri-map.js";

// ─── 인라인 법령 인용 환각 스캔 ───
// draft 의 모든 문자열 값에서 법령 인용 패턴을 추출해 그래프 노드 + 번들 법령 DB 와 대조.
// citations 필드를 통하지 않고도 본문(sections, controls.description 등)에 들어간
// "산안기준규칙 §999" 같은 가짜 조문을 검출한다.
// ADR 005: 시행령/시행규칙·건진법 변형도 ref 로 추출되도록 패턴 보강
// (본문에 박힌 "중대재해처벌법 시행령 §4" 같은 인용도 그래프 대조 대상이 되게).
// ADR 005: 조문 표지(§·제·조) 중 최소 하나가 있어야 매칭 — 표지 없이 법령명 뒤
// 맨숫자만 있는 산문("산업안전보건법 2024년"·"산안법 50인 이상")이 가짜 조문으로
// 추출돼 정상 문서가 환각으로 반려되던 false-positive 차단. "제62조"/"§62"/"§62조"/
// "62조" 는 매칭, 표지 없는 "2024"·"50"은 거부. 캡처그룹은 m[2]/m[3]/m[4] 중 하나.
const LAW_PATTERN = /(산업안전보건기준에\s*관한\s*규칙|산업안전보건법\s*시행규칙|산업안전보건법\s*시행령|산업안전보건법|산안기준규칙|산안법\s*시행규칙|산안법\s*시행령|산안법시행규칙|산안법시행령|산안법|기준규칙|중대재해\s*처벌\s*등에\s*관한\s*법률\s*시행령|중대재해\s*처벌\s*등에\s*관한\s*법률|중대재해처벌법\s*시행령|중대재해처벌법|중처법\s*시행령|중처법시행령|중처법|건설기술\s*진흥법\s*시행규칙|건설기술\s*진흥법\s*시행령|건설기술\s*진흥법|건진법\s*시행규칙|건진법\s*시행령|건진법시행규칙|건진법시행령|건진법|위험성평가\s*고시|위험성평가고시)\s*(?:제\s*(\d+)\s*조|§\s*(\d+)\s*조?|(\d+)\s*조)/g;

// ─── 법령 ref 실존성 판정 (ADR 005 단일 SSoT 함수) ───
// 순서: 텍스트 ref → IRI 정규화 → 그래프 getNode(우선 SSoT) → getArticle(MD, 본문 표시 보조).
// 그래프에 노드가 존재하면 환각이 아니다. 노드도 없고 IRI 정규화도 실패할 때만 환각 후보.
// review 의 inline 스캔 / risk_assessment citations / generic citations 3경로가 공유한다.
interface RefExistence {
  reference: string;
  exists: boolean;
  matched?: string;
  reason?: string;
}

// "산안법 §36", "중처법 시행령 §4", "기준규칙 §38 ②" 등에서 (lawPart, "§N") 분리.
// 마지막 §숫자 토큰을 기준으로 법령명과 조문 부분을 가른다.
function splitLawAndArticle(ref: string): { lawPart: string; articlePart: string } | null {
  // ADR 005: §조문뿐 아니라 "별표 N" 인용도 분리 — 별표 노드(106개) 실재하므로 그래프
  // 조회 경로를 타야 한다(legalRefToIri 가 "별표 N"을 annex IRI 로 변환). 별표를 못 가르면
  // 실재 별표 인용이 환각으로 오판됨.
  const m = ref.match(/^(.*?)\s*((?:§\s*\d+|별표\s*\d+).*)$/);
  if (m) {
    return { lawPart: m[1].trim(), articlePart: m[2].trim() };
  }
  return null;
}

async function resolveLegalRefExistence(
  ref: string,
  lawShortNames: string,
): Promise<RefExistence> {
  const cleanRef = (ref ?? "").trim();
  if (!cleanRef) {
    return { reference: "(없음)", exists: false, reason: "reference 비어있음" };
  }
  try {
    // 1차 SSoT — 그래프 노드 getNode. 텍스트 ref → IRI 정규화 후 조회.
    const parts = splitLawAndArticle(cleanRef);
    if (parts && parts.lawPart) {
      const iriRes = legalRefToIri(parts.lawPart, parts.articlePart);
      if (iriRes.iri) {
        const node = await getNode(iriRes.iri);
        if (node) {
          const title =
            (node as { title?: string }).title ??
            (node as { label?: string }).label ??
            iriRes.iri;
          return {
            reference: cleanRef,
            exists: true,
            matched: `${iriRes.iri} ${title} (graph node)`,
          };
        }
        // ADR 005: 건진법 시행령/시행규칙은 그래프 노드가 유일 SSoT.
        // 본문이 병합 MD(ctpa-art62)에 본법(§62 등)과 섞여 저장돼 있어, 아래 MD getArticle
        // 폴백이 본법 조문을 시행령/시행규칙 조문으로 오매칭한다(가짜 "건진법 시행령 §62"가
        // 본법 §62 에 매칭돼 false-pass). 따라서 노드 미발견 시 MD 폴백으로 내려가지 않고
        // 즉시 환각 판정한다. 실재 노드(시행령 §98·시행규칙 §58 등)는 위 getNode 에서
        // 이미 통과하므로 영향 없음 — 노드 없는 가짜 조항만 차단.
        if (iriRes.canonical === "건진법시행령" || iriRes.canonical === "건진법시행규칙") {
          return {
            reference: cleanRef,
            exists: false,
            reason: `그래프 노드 미발견(${iriRes.iri}) — 환각 가능성 (건진법 시행령/시행규칙은 그래프 SSoT)`,
          };
        }
      }
    }
    // 2차 — MD 번들 getArticle (본문 표시 보조). 그래프 미커버 조문 보강.
    const article = await getArticle(cleanRef);
    if (article) {
      return {
        reference: cleanRef,
        exists: true,
        matched: `${article.lawShortName} ${article.ref} ${article.title}`,
      };
    }
    // 그래프 노드 부재 + IRI 정규화 실패 + MD 미수록 → 환각 후보
    return {
      reference: cleanRef,
      exists: false,
      reason: `graph node + 번들 법령(${lawShortNames}) 모두 미발견 — 환각 가능성`,
    };
  } catch (err) {
    return { reference: cleanRef, exists: false, reason: `검증 오류: ${(err as Error).message}` };
  }
}

function walkStrings(node: unknown, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) walkStrings(v, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) walkStrings(v, out);
  }
}

async function scanInlineCitations(
  draft: Record<string, unknown>,
): Promise<Array<{ reference: string; exists: boolean; matched?: string; reason?: string }>> {
  const strings: string[] = [];
  walkStrings(draft, strings);
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const s of strings) {
    LAW_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LAW_PATTERN.exec(s)) !== null) {
      // ADR 005: 조문 번호는 "제N조"(m[2]) / "§N"(m[3]) / "N조"(m[4]) 세 분기 중 하나에 잡힌다.
      const num = m[2] ?? m[3] ?? m[4];
      const ref = `${m[1].replace(/\s+/g, "")} §${num}`;
      if (!seen.has(ref)) {
        seen.add(ref);
        refs.push(ref);
      }
    }
  }
  // ADR 005: 그래프 getNode 우선 → MD getArticle 보조. resolveLegalRefExistence 단일 SSoT 사용.
  const lawShortNames = listLaws().map((l) => l.shortName).join(", ");
  return Promise.all(refs.map((ref) => resolveLegalRefExistence(ref, lawShortNames)));
}

// ─── 결재선 정합성 검증 (문서 유형별) ───
// 위험성평가는 근로자 참여·서명이 핵심이지만, MSDS·중대재해 즉시보고까지
// 근로자대표 서명을 공통 강제하면 정상 문서를 오판한다.
interface ApprovalRoleRequirement {
  canonical: string;
  aliases: string[];
  fallbackFields: string[];
}

const APPROVAL_AUTHOR: ApprovalRoleRequirement = {
  canonical: "작성자/보고자",
  aliases: ["작성자", "보고자", "안전관리자", "보건관리자"],
  fallbackFields: ["compiler_sign", "compilerSign", "reporterSign"],
};

const APPROVAL_SUPERVISOR: ApprovalRoleRequirement = {
  canonical: "관리감독자",
  aliases: ["관리감독자", "감독자", "작업지휘자", "직장"],
  fallbackFields: ["supervisor_sign", "supervisorSign"],
};

const APPROVAL_PRINCIPAL: ApprovalRoleRequirement = {
  canonical: "사업주/현장소장",
  aliases: ["사업주", "대표", "대표이사", "대표자", "현장소장", "안전보건관리책임자"],
  fallbackFields: ["principal_sign", "principalSign", "ownerSignature"],
};

const APPROVAL_WORKER_REP: ApprovalRoleRequirement = {
  canonical: "근로자대표",
  aliases: ["근로자대표", "근로자 대표", "노동자대표"],
  fallbackFields: ["workerRepSignature", "workerRep_sign", "workerRepresentativeSign"],
};

function getApprovalRequirements(docId: string): ApprovalRoleRequirement[] {
  if (docId === "risk_assessment" || docId.includes("risk_assessment")) {
    return [APPROVAL_SUPERVISOR, APPROVAL_PRINCIPAL, APPROVAL_WORKER_REP];
  }
  return [APPROVAL_AUTHOR, APPROVAL_PRINCIPAL];
}

function evaluateApprovalChain(
  chain: Array<{ role?: string; name?: string; signed?: boolean; date?: string }> | undefined,
  requiredRoles: ApprovalRoleRequirement[],
  draft: Record<string, unknown>,
): { complete: boolean; missing: string[]; unsigned: string[] } {
  const missing: string[] = [];
  const unsigned: string[] = [];
  const rows = chain ?? [];
  for (const need of requiredRoles) {
    const match = rows.find((c) =>
      need.aliases.some((a) => (c.role ?? "").includes(a)),
    );
    const fallbackSigned = need.fallbackFields.some((field) => isFieldFilled(getDeep(draft, field)));
    if (!match && !fallbackSigned) {
      missing.push(need.canonical);
    } else if (match && !match.signed && !fallbackSigned) {
      unsigned.push(need.canonical);
    }
  }
  return { complete: missing.length === 0 && unsigned.length === 0, missing, unsigned };
}

// 파일 최상단 상수 — 안전관리 법정문서 초안 검토 Tool
//
// 검수 깊이 3단계 (교차 검증 2026-04-30 P0-2 권고에 따라 명시):
//   L0 (노드 존재)        — getDocument(docId) 가 그래프 노드를 찾으면 통과. 모든 docId 지원.
//   L1 (필수 필드/양식)   — requiredFields + sections.fields[required:true] + reviewRules.checkFields
//                          존재 여부 자동 검증. 모든 docId 자동 대응 (그래프 노드 메타 기반).
//                          + 결재선 정합성(사업주·관리감독자·근로자대표 + signed) 강제.
//                          + 본문 인라인 법령 인용 환각 스캔.
//   L2 (의미 검수)        — risk_assessment 전용 풍부 로직(§6 근로자 참여 / ERIC-PP 우선순위 /
//                          시나리오 구체성 / 책임자·기한 / 인용 ref 실존). 다른 docId 는 그래프
//                          노드의 reviewRules 충실도에 따라 부분 자동화. 노드별 reviewRules 보강
//                          시 추가 docId 가 L2 로 승격.
//
// 모든 docId 는 최소 L0+L1 자동 검수. citations 인용 환각 스캔과 결재선 정합성은 모든
// docId 공통. `metadata.notifiedToWorkers` 같은 도메인 특수 규칙은 노드의 reviewRules 명시
// 또는 본 파일의 명시 매핑 (work_plan_excavation §38 ②) 으로 처리.
//
// 검수 동작:
//  · 환각 ref 검출 → [HALLUCINATION_DETECTED] 마커 + isError
//    (npm 번들 6 법령 본문 + 중처법시행령 article 그래프 노드까지 7 출처 양방향 대조)
//  · 필수 필드 누락 → 감독관 시각의 사전 점검
//  · 적용성 (50인/50억 + 작업조건 임계값) → 면제·의무 안내

const MARKER_HALLUCINATION = "[HALLUCINATION_DETECTED]";
const MARKER_REVISION = "[REVISION_NEEDED]";

// 지원되는 docId — Phase A 풍부 로직(risk_assessment) + Phase B 그래프 generic (모든 19종)
// risk_assessment 는 위험성평가 4종(최초·정기·수시·상시) 모두 처리하는 합성 docId 로 보존.
// 나머지는 src/ontology/graph/nodes/documents/*.jsonld 의 19종 docId 직접 지원.
// 모든 docId 수용 (그래프 노드 기반 generic review). 노드 부재 시 reviewByGraphNode 가 fail 처리.
const SupportedDocId = z.string().min(1).describe("docId — getSafetyDocumentGuide / listSafetyDocumentsByCycle 참조");

// 위험성평가서 초안 스키마 — 사용자/LLM 이 작성한 본문 형태
const RiskAssessmentDraftSchema = z.object({
  metadata: z
    .object({
      siteName: z.string().optional().describe("사업장명"),
      assessmentDate: z.string().optional().describe("평가 실시일 YYYY-MM-DD"),
      assessmentType: z
        .enum(["initial", "regular", "ad_hoc", "ongoing"])
        .optional()
        .describe("평가 유형 — initial(최초)/regular(정기)/ad_hoc(수시)/ongoing(상시)"),
      assessmentMethod: z
        .string()
        .optional()
        .describe("평가 방법 (3단계 판단 / 체크리스트 / 빈도·강도 등 KRAS 7방법)"),
      participants: z
        .array(
          z.object({
            role: z.string().describe("역할 — 사업주/안전관리자/관리감독자/근로자대표 등"),
            name: z.string().optional(),
            signed: z.boolean().optional().default(false),
          }),
        )
        .optional(),
    })
    .optional(),
  hazards: z
    .array(
      z.object({
        description: z.string(),
        category: z.string().optional(),
        riskLevel: z.string().optional().describe("위험성 등급 (상/중/하 또는 숫자)"),
        scenario: z.string().optional().describe("발생 가능 시나리오"),
      }),
    )
    .optional(),
  controls: z
    .array(
      z.object({
        description: z.string(),
        type: z
          .enum(["eliminate", "replace", "engineering", "administrative", "ppe"])
          .optional()
          .describe("ERIC-PP 분류"),
        responsible: z.string().optional(),
        deadline: z.string().optional(),
      }),
    )
    .optional(),
  citations: z.array(EvidenceItemSchema).optional(),
});

const ScaleSchema = z
  .object({
    workforce: z.number().int().min(0).optional().describe("상시 근로자 수"),
    constructionValue: z
      .number()
      .min(0)
      .optional()
      .describe("총 공사금액 (단위: 억원)"),
    industry: z
      .enum(["construction", "manufacturing", "service", "other"])
      .optional()
      .describe("업종"),
    // v1.3.x — 작업 조건 (결정론 룰 trigger 용). 입력 시 추락방호·굴착·밀폐·화기 룰 자동 평가
    workHeight: z.number().min(0).optional().describe("작업 높이(m). 2m 이상 + 개구부 시 추락방호 룰 발동"),
    workDepth: z.number().min(0).optional().describe("굴착 깊이(m). 2m 이상 시 작업계획서·붕괴방호 룰 발동"),
    edgeOpen: z.boolean().optional().describe("개구부·단부 노출 여부. 안전난간·덮개 룰 발동"),
    confinedSpace: z.boolean().optional().describe("밀폐공간 작업 여부. 송기마스크·산소측정 룰 발동"),
    hotWork: z.boolean().optional().describe("화기작업 (용접·용단·연마) 여부. 화기허가서·소화기 룰 발동"),
    hazardousChemical: z.boolean().optional().describe("화학물질 취급 여부. MSDS·작업환경측정 룰 발동"),
    contractor: z.boolean().optional().describe("도급 사업장 여부. 도급 안전관리 룰 발동"),
    machineType: z.string().optional().describe("기계·기구 종류 (프레스, 크레인 등). 안전인증·검사 룰 발동"),
  })
  .optional();

// 굴착 작업계획서 초안 스키마
const WorkPlanExcavationDraftSchema = z.object({
  metadata: z
    .object({
      siteName: z.string().optional(),
      planDate: z.string().optional().describe("계획서 작성일 YYYY-MM-DD"),
      supervisor: z.string().optional().describe("작업지휘자"),
      notifiedToWorkers: z
        .boolean()
        .optional()
        .describe("작업계획서를 근로자에게 알렸는가 (§38 ②)"),
    })
    .optional(),
  workConditions: z
    .object({
      depthM: z
        .number()
        .min(0)
        .optional()
        .describe("굴착면 높이(m). 2m 미만이면 §38 미적용"),
      groundType: z.string().optional(),
    })
    .optional(),
  preSurvey: z
    .object({
      shape: z.string().optional().describe("형상·지질·지층 상태"),
      crackWater: z.string().optional().describe("균열·함수·용수·동결 상태"),
      buriedObj: z.string().optional().describe("매설물 유무·상태"),
      groundwater: z.string().optional().describe("지반 지하수위 상태"),
    })
    .optional(),
  plan: z
    .object({
      method: z.string().optional().describe("굴착방법·순서·토사 반출"),
      resources: z.string().optional().describe("인원·장비"),
      protectBuried: z.string().optional().describe("매설물 이설·보호"),
      signal: z.string().optional().describe("연락방법·신호방법"),
      shoring: z.string().optional().describe("흙막이 지보공·계측"),
      supervisor: z.string().optional().describe("작업지휘자 배치"),
      other: z.string().optional().describe("그 밖에 안전·보건 사항"),
    })
    .optional(),
  citations: z.array(EvidenceItemSchema).optional(),
});

// docId 별 draft schema 가 다르므로 input 단계에서는 unknown 으로 받고 handler 에서 분기.
const inputSchema = z.object({
  docId: SupportedDocId.describe(
    "검토 대상 문서 docId. 모든 docId 가 L0(그래프 노드 존재) + L1(requiredFields·reviewRules·결재선·인라인 환각 스캔) 자동 검수 대상. risk_assessment 는 L2(§6 근로자 참여·ERIC-PP 우선순위·시나리오 구체성·인용 ref 실존) 풍부 로직. work_plan_excavation 은 §38 ② notifiedToWorkers 명시 매핑. 그 외 docId 의 L2 충실도는 그래프 노드의 reviewRules 보강 진행에 따라 점진 확대.",
  ),
  draft: z
    .unknown()
    .describe(
      "검토할 초안 본문. docId 에 따라 schema 가 다름 — risk_assessment: {metadata, hazards, controls, citations}, work_plan_excavation: {metadata, workConditions:{depthM}, preSurvey, plan, citations}.",
    ),
  scale: ScaleSchema,
});

type Input = z.infer<typeof inputSchema>;

// 체크 결과 항목
// status:
//   pass         — 자동 검증 통과
//   warn         — 자동 검증 발견된 경미한 문제 (수정 권장)
//   manual_review — 자동 정량 검증 불가, 사람 검토 권장 (정상 케이스에서도 항상 등장)
//   fail         — blocker 위반 (필수 누락·환각·통지 미이행 등)
interface CheckResult {
  rule: string;
  status: "pass" | "warn" | "manual_review" | "fail";
  legalBasis?: string;
  reason?: string;
  details?: unknown;
}

interface ApplicabilityResult {
  workforce?: number;
  constructionValue?: number;
  industry?: string;
  appliesTo: string[];
  exemptedFrom: string[];
  notes: string[];
}

// ─── 적용성 판정 — v1.3.x 결정론적 추론 룰 (graph Applicability 노드 + JSON Logic)
// 이전: 5인/50인/50억 하드코딩 분기. LLM 버전마다 결과 차이 위험.
// 이후: src/ontology/graph/nodes/applicabilities/*.jsonld condition 평가 — 결정론적.
// 외부 평가 (2026-05-20): 결정론적 추론 규칙 레이어 부재 해소.
import { evaluateAllApplicabilities, type ApplicabilityNode, type ApplicabilityContext } from "../lib/applicability-rule.js";
import { graphRepository as appRepo } from "../lib/graph-repository.js";

const APPLICABILITY_SLUGS = [
  "all_workplace", "5_workers_or_more", "fifty_persons_or_more",
  "50_workers_or_construction", "construction_all", "construction_50bn_plus",
  "construction_under_50bn", "all_workplace_with_excavation",
  "chemicals_handling", "contractor",
  "fall_protection_2m", "excavation_2m_plus", "confined_space", "hot_work", "edge_work",
  "hazard_factor_exposed", "safety_certification_13", "safety_inspection_11",
  "voluntary_safety_confirmation_21", "ongoing_assessment_selected",
];

async function judgeApplicability(scale: Input["scale"]): Promise<ApplicabilityResult> {
  const result: ApplicabilityResult = {
    workforce: scale?.workforce,
    constructionValue: scale?.constructionValue,
    industry: scale?.industry,
    appliesTo: [],
    exemptedFrom: [],
    notes: [],
  };

  await appRepo.ensureBuilt();
  const allNodes: ApplicabilityNode[] = [];
  for (const slug of APPLICABILITY_SLUGS) {
    const node = appRepo.getNode(`applic:${slug}`);
    if (node && (node as ApplicabilityNode).condition) {
      allNodes.push(node as ApplicabilityNode);
    }
  }

  const ctx: ApplicabilityContext = {
    workforce: scale?.workforce,
    constructionValue: scale?.constructionValue,
    industry: scale?.industry,
    workHeight: scale?.workHeight,
    workDepth: scale?.workDepth,
    edgeOpen: scale?.edgeOpen,
    confinedSpace: scale?.confinedSpace,
    hotWork: scale?.hotWork,
    hazardousChemical: scale?.hazardousChemical,
    contractor: scale?.contractor,
    machineType: scale?.machineType,
  };

  const enforcedSet = new Set<string>();
  const evals = evaluateAllApplicabilities(allNodes, ctx);
  for (const r of evals) {
    const label = `${r.label} [${r.legalWeight}]${r.legalBasis.length > 0 ? ` (${r.legalBasis.join(", ")})` : ""}`;
    if (r.applies) {
      result.appliesTo.push(label);
      r.enforces.forEach((c) => enforcedSet.add(c));
    } else if (r.reason) {
      result.exemptedFrom.push(`${r.label}: ${r.reason}`);
    }
  }
  if (enforcedSet.size > 0) {
    result.notes.push(`강제 통제수단 (적용 룰에서 자동 도출): ${Array.from(enforcedSet).join(", ")}`);
  }

  // 건설업 전체 의무 — Applicability 노드 외 추가 fallback (산안비·TBM 등)
  if (scale?.industry === "construction") {
    result.appliesTo.push("산업안전보건관리비 계상·사용 (산안법 §72) — 모든 건설공사 의무");
    result.appliesTo.push("TBM 일단위 + 합동점검 주단위 + 위험요인 발굴 월단위 (위험성평가 고시 §15 ④ 상시평가)");
  }

  return result;
}

// ─── 위험성평가 초안 체크 ───
async function reviewRiskAssessment(
  draft: z.infer<typeof RiskAssessmentDraftSchema>,
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  // 1. 필수 메타데이터 필드
  const meta = draft.metadata ?? {};

  checks.push({
    rule: "필수 — 사업장명",
    status: meta.siteName ? "pass" : "fail",
    legalBasis: "위험성평가 고시 §14 ① (기록 항목)",
    reason: meta.siteName ? undefined : "사업장명 누락",
  });

  checks.push({
    rule: "필수 — 평가 실시일",
    status: meta.assessmentDate ? "pass" : "fail",
    legalBasis: "위험성평가 고시 §14 ①",
    reason: meta.assessmentDate ? undefined : "평가일 누락",
  });

  checks.push({
    rule: "필수 — 평가 유형 (최초/정기/수시/상시)",
    status: meta.assessmentType ? "pass" : "fail",
    legalBasis: "위험성평가 고시 §15 (실시 시기)",
    reason: meta.assessmentType ? undefined : "평가 유형 미선택",
  });

  // 참여자 + 근로자 대표 필수
  const participants = meta.participants ?? [];
  const workerRep = participants.find(
    (p) => p.role.includes("근로자") || p.role.includes("worker"),
  );
  if (participants.length === 0) {
    checks.push({
      rule: "필수 — 참여자 명단",
      status: "fail",
      legalBasis: "위험성평가 고시 §6 (근로자 참여 의무)",
      reason: "참여자 명단 누락. 근로자 참여 미실시 = 과태료 대상.",
    });
  } else if (!workerRep) {
    checks.push({
      rule: "필수 — 근로자 대표 참여",
      status: "fail",
      legalBasis: "위험성평가 고시 §6",
      reason:
        "참여자에 '근로자 대표' 역할이 없음. 사업주·관리자만 참여 시 §6 위반 소지.",
    });
  } else if (!workerRep.signed) {
    checks.push({
      rule: "필수 — 근로자 대표 서명",
      status: "warn",
      legalBasis: "위험성평가 고시 §6",
      reason: "근로자 대표 서명(signed=true) 미확인. 인쇄본 서명 확인 필요.",
    });
  } else {
    checks.push({
      rule: "필수 — 참여자·근로자 대표 서명",
      status: "pass",
      legalBasis: "위험성평가 고시 §6",
    });
  }

  // 2. 유해·위험요인 파악
  const hazards = draft.hazards ?? [];
  if (hazards.length === 0) {
    checks.push({
      rule: "필수 — 유해·위험요인 목록",
      status: "fail",
      legalBasis: "산안법 §36 ① · 고시 §10",
      reason: "위험요인 0건. 모든 사업장은 최소 1건 이상 파악·기재해야 함.",
    });
  } else {
    const hasRiskLevel = hazards.every((h) => h.riskLevel);
    checks.push({
      rule: "필수 — 위험요인별 위험성 등급",
      status: hasRiskLevel ? "pass" : "warn",
      legalBasis: "고시 §11 (위험성 결정)",
      reason: hasRiskLevel
        ? undefined
        : `${hazards.length}건 중 일부 hazards 에 riskLevel 미기재.`,
    });
    const hasScenario = hazards.filter((h) => h.scenario).length;
    if (hasScenario < hazards.length / 2) {
      checks.push({
        rule: "권장 — 위험요인 구체적 시나리오",
        status: "warn",
        reason: `'추락' '맞음' 같은 추상 명사만 적지 말고 발생 시나리오 구체화 권장 (예: "사다리 3m 작업 중 균형 상실 → 추락"). ${hasScenario}/${hazards.length}건만 시나리오 있음.`,
      });
    }
  }

  // 3. 감소대책 ERIC-PP 우선순위
  const controls = draft.controls ?? [];
  if (controls.length === 0) {
    checks.push({
      rule: "필수 — 감소대책",
      status: "fail",
      legalBasis: "고시 §12 (위험성 감소대책 수립 및 실행)",
      reason: "감소대책 0건.",
    });
  } else {
    const types = new Set(controls.map((c) => c.type).filter(Boolean));
    const hasNonPpe =
      types.has("eliminate") ||
      types.has("replace") ||
      types.has("engineering") ||
      types.has("administrative");
    const onlyPpe = types.has("ppe") && !hasNonPpe;
    checks.push({
      rule: "권장 — ERIC-PP 우선순위",
      status: onlyPpe ? "warn" : "pass",
      reason: onlyPpe
        ? "감소대책에 PPE(보호구) 만 있고 공학적·관리적 통제가 없음. 제거→대체→공학→관리→PPE 순서 고려 권장."
        : undefined,
    });
    // 책임자·기한
    const missingResp = controls.filter((c) => !c.responsible).length;
    const missingDeadline = controls.filter((c) => !c.deadline).length;
    if (missingResp > 0) {
      checks.push({
        rule: "필수 — 감소대책 이행 책임자",
        status: "fail",
        legalBasis: "고시 §12",
        reason: `${missingResp}건 책임자 미지정.`,
      });
    }
    if (missingDeadline > 0) {
      checks.push({
        rule: "필수 — 감소대책 이행 기한",
        status: "warn",
        reason: `${missingDeadline}건 기한 미지정.`,
      });
    }
  }

  // 4. 인용 법령 ref 실존성 (verify_safety_basis 와 동일 로직 인라인)
  // 동일 사업장에서 reference 5+ 개 검증 시 순차 → 병렬 (5배 개선)
  const citations = draft.citations ?? [];
  if (citations.length === 0) {
    checks.push({
      rule: "권장 — 법령 근거 인용",
      status: "warn",
      reason:
        "감독관 대응을 위해 평가 근거 법령(산안법 §36, 기준규칙 §38 등) 1건 이상 인용 권장.",
    });
  } else {
    // ADR 005: 그래프 getNode 우선 → MD getArticle 보조. resolveLegalRefExistence 단일 SSoT 사용.
    const lawShortNames = listLaws().map((l) => l.shortName).join(", ");
    type RefDetail = { reference: string; exists: boolean; matched?: string; reason?: string };
    const refDetails: RefDetail[] = await Promise.all(
      citations.map(async (ev): Promise<RefDetail> => {
        if (ev.basisType !== "law" && ev.basisType !== "regulation") {
          return {
            reference: ev.reference ?? "",
            exists: true,
            matched: `(검증 대상 외 — basisType=${ev.basisType})`,
          };
        }
        return resolveLegalRefExistence(ev.reference ?? "", lawShortNames);
      }),
    );
    const hallucination = refDetails.filter((d) => !d.exists).length;
    checks.push({
      rule: "필수 — 법령 인용 실존성",
      status: hallucination > 0 ? "fail" : "pass",
      reason:
        hallucination > 0
          ? `${hallucination}건 환각 ref 검출. search_safety_laws 로 정확한 조문 재확인 필요.`
          : undefined,
      details: { hallucinationCount: hallucination, refChecks: refDetails },
    });
  }

  return checks;
}

// ─── 다음 행동 추천 ───
function buildNextActions(
  checks: CheckResult[],
  applicability: ApplicabilityResult,
  workType?: string,
): string[] {
  const actions: string[] = [];
  const hasHallucination = checks.some(
    (c) =>
      c.status === "fail" &&
      c.rule.includes("법령 인용 실존성"),
  );
  if (hasHallucination) {
    actions.push(
      "search_safety_laws({keyword: '관련 키워드'}) — 환각 조문 대신 정확한 조문 재검색",
    );
    actions.push(
      "list_core_safety_laws() — 번들된 6개 법령·55조문 목록 확인",
    );
  }
  const hasMissingFields = checks.some(
    (c) =>
      c.status === "fail" &&
      c.rule.startsWith("필수"),
  );
  if (hasMissingFields) {
    actions.push(
      "get_risk_assessment_schema({type: 'ongoing', kras_method: 'construction_continuous'}) — 표준 양식의 모든 필수 필드 재확인",
    );
  }
  const hasOnlyPpe = checks.some(
    (c) => c.rule.includes("ERIC-PP") && c.status === "warn",
  );
  if (hasOnlyPpe) {
    actions.push(
      "compile_safety_references({workType, docType: 'risk_assessment'}) — 공학적·관리적 통제 사례 모음",
    );
  }
  if (workType) {
    actions.push(
      `compile_safety_references({workType: '${workType}', docType: 'risk_assessment'}) — 해당 공종 법령·KOSHA·재해사례 자동 묶음`,
    );
  }
  return actions;
}

// ─── 그래프 노드 기반 Document 검수 (work_plan_excavation 등 Phase B-α 패턴) ───
function getDeep(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  // 1) dot-path 우선 (예: "metadata.notifiedToWorkers")
  const parts = key.split(".");
  let cur: unknown = obj;
  let dotOk = true;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      dotOk = false;
      break;
    }
  }
  if (dotOk) return cur;
  // 2) draft.sections[*][key] 검색 (generate-safety-document 의 getFieldValue 와 동일 우선순위)
  const root = obj as Record<string, unknown>;
  const sections = (root.sections ?? {}) as Record<string, Record<string, unknown>>;
  for (const sec of Object.values(sections)) {
    if (sec && typeof sec === "object" && key in sec) {
      const v = sec[key];
      if (v !== undefined) return v;
    }
  }
  // 3) raw[key]
  const raw = (root.raw ?? {}) as Record<string, unknown>;
  if (key in raw) return raw[key];
  // 4) top-level direct key
  if (key in root) return root[key];
  return undefined;
}

function isFieldFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

const FIELD_ALIASES: Record<string, string[]> = {
  documentNumber: ["documentId", "documentNumber"],
  siteName: ["metadata.siteName"],
  compileDate: ["metadata.compileDate", "metadata.planDate"],
  compiler: ["metadata.compiler"],
  preSurvey_shape: ["preSurvey.shape"],
  preSurvey_crack: ["preSurvey.crack", "preSurvey.crackWater"],
  preSurvey_buried: ["preSurvey.buried", "preSurvey.buriedObj"],
  preSurvey_groundwater: ["preSurvey.groundwater"],
  plan_method: ["plan.method"],
  plan_workers: ["plan.workers", "plan.resources"],
  plan_protection: ["plan.protection", "plan.protectBuried"],
  plan_signal: ["plan.signal"],
  plan_shoring: ["plan.shoring"],
  plan_director: ["plan.director", "plan.supervisor", "metadata.supervisor"],
  notifiedToWorkers: [
    "metadata.notifiedToWorkers",
    "workerNotification",
    "workerNotification.method",
    "workerNotification.evidence",
  ],
  compiler_sign: ["compilerSign", "compiler_sign", "approvalChain"],
  supervisor_sign: ["supervisorSign", "supervisor_sign", "approvalChain"],
  principal_sign: ["principalSign", "principal_sign", "approvalChain"],
};

function getFieldValue(draft: Record<string, unknown>, key: string, label?: string): unknown {
  let value = getDeep(draft, key);
  if (isFieldFilled(value)) return value;
  if (label) {
    value = getDeep(draft, label);
    if (isFieldFilled(value)) return value;
  }
  for (const alias of FIELD_ALIASES[key] ?? []) {
    value = getDeep(draft, alias);
    if (isFieldFilled(value)) return value;
  }
  return value;
}

function evaluateApplicability(
  doc: DocumentNode,
  workConditions: Record<string, unknown> | undefined,
): { applies: boolean; note: string } {
  const cond = doc.applicableWhen ?? {};
  // depthGte 단위 평가 (P0 단순 케이스 — 추후 확장)
  if (typeof cond.depthGte === "number" && workConditions) {
    const depth = workConditions["depthM"];
    if (typeof depth === "number") {
      if (depth < (cond.depthGte as number)) {
        const exemptedNote =
          (doc.exemptedWhen?.note as string | undefined) ??
          `${doc.applicableWhen?.workType ?? "이 문서"} 미적용 (임계값 미달)`;
        return { applies: false, note: exemptedNote };
      }
    } else {
      return {
        applies: true,
        note: `굴착면 높이(workConditions.depthM) 미입력 — 적용성 단정 불가, 작성 권장.`,
      };
    }
  }
  return { applies: true, note: "적용 대상 — 작성 의무" };
}

async function reviewByGraphNode(
  docId: string,
  draft: Record<string, unknown>,
): Promise<{ checks: CheckResult[]; node: DocumentNode | undefined; applicability: { applies: boolean; note: string } }> {
  const checks: CheckResult[] = [];
  const node = await getDocument(docId);
  if (!node) {
    checks.push({
      rule: "Document 노드 로드",
      status: "fail",
      reason: `docId='${docId}' 의 그래프 노드를 찾을 수 없습니다 (src/ontology/graph/nodes/documents/).`,
    });
    return { checks, node: undefined, applicability: { applies: false, note: "노드 부재" } };
  }

  // 1. 적용성 평가
  const workConditions = draft["workConditions"] as Record<string, unknown> | undefined;
  const applicability = evaluateApplicability(node, workConditions);
  checks.push({
    rule: `적용성 평가 (${node.title})`,
    status: applicability.applies ? "pass" : "warn",
    reason: applicability.note,
    legalBasis: node["@id"],
  });

  // 적용 안 되면 필드 검증 skip (참고용 작성 권장만)
  if (!applicability.applies) {
    return { checks, node, applicability };
  }

  // 2. 필수 필드 누락 검증 — key·label 양방향 매칭
  // (auto-align 으로 슬러그화된 key 와 사용자 입력의 한국어 라벨 둘 다 인식)
  // optional/required:false 표시된 조건부 필드는 skip
  // sections.fields 가 현재 양식의 권위다. 과거 requiredFields 가 남아 있더라도
  // generate_safety_document 와 같은 기준으로 검토해야 false fail 이 나지 않는다.
  const sectionFields = (node.sections ?? []).flatMap((s: any) =>
    (s.fields ?? []).filter((f: any) => f.required !== false && f.optional !== true),
  );
  const sourceFields = sectionFields.length > 0 ? sectionFields : (node.requiredFields ?? []);
  for (const field of sourceFields) {
    if ((field as any).optional === true || (field as any).required === false) continue;
    const value = getFieldValue(draft, field.key, field.label);
    const filled = isFieldFilled(value);
    checks.push({
      rule: `필수 — ${field.label}`,
      status: filled ? "pass" : "fail",
      legalBasis: field.source,
      reason: filled ? undefined : `${field.key} 누락 (${field.source})`,
    });
  }

  // 3. reviewRules 평가 — checkFields 키 또는 라벨 양방향 매칭
  // node.requiredFields + sections.fields 에서 key↔label 매핑 사전 구축
  const keyToLabel = new Map<string, string>();
  for (const f of node.requiredFields ?? []) {
    if (f.key && f.label) keyToLabel.set(f.key, f.label);
  }
  for (const s of node.sections ?? []) {
    for (const f of s.fields ?? []) {
      if (f.key && f.label) keyToLabel.set(f.key, f.label);
    }
  }
  // checkFields 의 키가 노드 fields 에 없으면, 한국어 라벨도 시도하는 헬퍼
  const checkFilled = (k: string): boolean => {
    const v = getFieldValue(draft, k, keyToLabel.get(k));
    return isFieldFilled(v);
  };
  for (const rule of node.reviewRules) {
    if (rule.severity === "blocker" && rule.checkFields && rule.checkFields.length > 0) {
      const allFilled = rule.checkFields.every((k) => checkFilled(k));
      checks.push({
        rule: rule.rule,
        status: allFilled ? "pass" : "fail",
        legalBasis: rule.legalBasis,
        reason: allFilled
          ? undefined
          : `${rule.checkFields.filter((k) => !checkFilled(k)).length}개 필드 누락`,
      });
    } else if (rule.severity === "warning") {
      const checkFields = rule.checkFields ?? [];
      const allFilled = checkFields.every((k) => checkFilled(k));
      if (!allFilled) {
        checks.push({
          rule: `권장 — ${rule.rule}`,
          status: "warn",
          reason: `해당 필드 미작성 — ${rule.rule}`,
        });
      } else {
        checks.push({
          rule: `권장 — ${rule.rule}`,
          status: "pass",
        });
      }
    } else if (rule.severity === "manual_review") {
      // 정성적 — 항상 사람 검토 권장 (정상 케이스에서도 등장. overall 평가 시 영향 없음).
      // ETL(reclassify-unverifiable-blockers) 가 137건의 blocker 를 데이터 차원에서
      // manual_review 로 사전 변환하므로 여기로 흐르는 항목 다수가 legalBasis 를 가진다.
      // 출력에 누락하면 본 OSS 의 핵심 가치(법적 문서 작성 보조 — 근거 노출)와 충돌.
      const checkFields = rule.checkFields ?? [];
      const anyFilled = checkFields.some((k) => checkFilled(k));
      checks.push({
        rule: `사람 검토 — ${rule.rule}`,
        status: "manual_review",
        legalBasis: rule.legalBasis,
        reason: anyFilled
          ? `해당 필드는 작성됐으나 본 규칙의 충족 여부는 정량 검증 불가 → 사람이 직접 확인 필요`
          : `해당 필드 미작성 — ${rule.rule}`,
      });
    } else if (rule.severity === "blocker" && (!rule.checkFields || rule.checkFields.length === 0)) {
      // 안전망 — 정상 흐름에서는 도달 불가. 데이터 차원에서
      // scripts/etl/reclassify-unverifiable-blockers.ts 가 137건을 manual_review 로
      // 사전 변환했고 scripts/audit/audit-blocker-contract.ts 가 release gate 에서
      // checkFields 없는 blocker 를 hard fail 시킨다. 그래도 누군가 게이트를 우회해
      // 새 blocker 를 추가하면 런타임이 안전하게 강등 처리.
      // work_plan_excavation 의 §38 ② 통지 규칙만 별도 도메인 매핑 유지.
      const isWorkPlanNotification =
        docId === "work_plan_excavation" && rule.rule.includes("작업계획서 알림");
      if (isWorkPlanNotification) {
        const value = getFieldValue(draft, "notifiedToWorkers");
        const filled = isFieldFilled(value);
        checks.push({
          rule: rule.rule,
          status: filled ? "pass" : "fail",
          legalBasis: rule.legalBasis,
          reason: filled ? undefined : `notifiedToWorkers 미확인 (산업안전보건기준 §38 ②)`,
        });
      } else {
        checks.push({
          rule: `사람 검토 — ${rule.rule}`,
          status: "manual_review",
          legalBasis: rule.legalBasis,
          reason:
            "이 규칙은 정량 검증 가능한 checkFields 가 없어 자동 검증 불가. 사람이 직접 확인 필요. (audit:blocker-contract release gate 로 사전 차단됨)",
        });
      }
    }
  }

  return { checks, node, applicability };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  let checks: CheckResult[];
  let extraPayload: Record<string, unknown> = {};
  const draftRaw = (input.draft ?? {}) as Record<string, unknown>;

  if (input.docId === "risk_assessment") {
    const draftParsed = RiskAssessmentDraftSchema.parse(input.draft ?? {});
    checks = await reviewRiskAssessment(draftParsed);
  } else {
    // Phase B Generic — 모든 19종 docId + work_plan_excavation 그래프 노드 기반 자동 review
    const result = await reviewByGraphNode(input.docId, draftRaw);
    checks = result.checks;
    extraPayload = {
      graphNode: result.node?.["@id"],
      applicability: result.applicability,
    };

    // 결재선 정합성 — 문서별 필수 결재 역할만 검토
    const chain = draftRaw["approvalChain"] as
      | Array<{ role?: string; name?: string; signed?: boolean; date?: string }>
      | undefined;
    const approvalRequirements = getApprovalRequirements(input.docId);
    const chainEval = evaluateApprovalChain(chain, approvalRequirements, draftRaw);
    const approvalLabel = approvalRequirements.map((r) => r.canonical).join("·");
    if (chainEval.complete) {
      checks.push({
        rule: `필수 — 결재선 정합성 (${approvalLabel})`,
        status: "pass",
        legalBasis: input.docId.includes("risk_assessment") ? "art:위험성평가-고시:6" : extraPayload.graphNode as string | undefined,
      });
    } else {
      const reasons: string[] = [];
      if (chainEval.missing.length > 0) reasons.push(`역할 누락: ${chainEval.missing.join(", ")}`);
      if (chainEval.unsigned.length > 0) reasons.push(`미서명: ${chainEval.unsigned.join(", ")}`);
      checks.push({
        rule: `필수 — 결재선 정합성 (${approvalLabel})`,
        status: "fail",
        legalBasis: input.docId.includes("risk_assessment") ? "art:위험성평가-고시:6" : extraPayload.graphNode as string | undefined,
        reason: reasons.join(" / "),
        details: { missing: chainEval.missing, unsigned: chainEval.unsigned },
      });
    }

    // 환각 검증 — citations 필드 (모든 docId 공통)
    // ADR 005: 그래프 getNode 우선 → MD getArticle 보조. resolveLegalRefExistence 단일 SSoT 사용.
    const citations = (draftRaw["citations"] as Array<{ basisType?: string; reference?: string }> | undefined) ?? [];
    if (citations.length > 0) {
      const lawShortNames = listLaws().map((l) => l.shortName).join(", ");
      const refDetails = await Promise.all(
        citations.map(async (ev) => {
          if (ev.basisType !== "law" && ev.basisType !== "regulation") {
            return {
              reference: ev.reference ?? "",
              exists: true,
              matched: `(검증 대상 외 — basisType=${ev.basisType})`,
            };
          }
          return resolveLegalRefExistence(ev.reference ?? "", lawShortNames);
        }),
      );
      const hallucination = refDetails.filter((d) => !d.exists).length;
      checks.push({
        rule: "필수 — 법령 인용 실존성",
        status: hallucination > 0 ? "fail" : "pass",
        reason:
          hallucination > 0
            ? `${hallucination}건 환각 ref 검출.`
            : undefined,
        details: { hallucinationCount: hallucination, refChecks: refDetails },
      });
    }
  }

  // 인라인 환각 스캔 (BLOCKER 2 정정) — 모든 docId 공통.
  // citations 필드 대신 본문(sections·controls.description·legalCitations 등) 어디든
  // "산안기준규칙 §999" 같은 가짜 조문이 끼어 있으면 잡아낸다. risk_assessment 경로도 포함.
  const inlineRefs = await scanInlineCitations(draftRaw);
  if (inlineRefs.length > 0) {
    const hallucinatedInline = inlineRefs.filter((d) => !d.exists);
    checks.push({
      rule: "필수 — 본문 내 법령 인용 실존성 (인라인 스캔)",
      status: hallucinatedInline.length > 0 ? "fail" : "pass",
      reason:
        hallucinatedInline.length > 0
          ? `${hallucinatedInline.length}건 환각 ref 검출 (${hallucinatedInline.map((d) => d.reference).join(", ")}).`
          : undefined,
      details: { hallucinationCount: hallucinatedInline.length, refChecks: inlineRefs },
    });
  }

  const applicability = await judgeApplicability(input.scale);

  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const manualReviewCount = checks.filter((c) => c.status === "manual_review").length;
  const passCount = checks.filter((c) => c.status === "pass").length;

  let overall: "pass" | "needs_revision" | "fail";
  if (failCount > 0) overall = failCount >= 3 ? "fail" : "needs_revision";
  else if (warnCount > 0) overall = "needs_revision";
  else overall = "pass"; // manual_review 만 있으면 자동 검증 통과로 처리

  const hasHallucination = checks.some(
    (c) =>
      c.status === "fail" &&
      (c.rule.includes("법령 인용 실존성") || c.rule.includes("인라인 스캔")) &&
      ((c.details as { hallucinationCount?: number })?.hallucinationCount ?? 0) > 0,
  );

  // 교차 검증 P0-4 권고: blocker fail 또는 hallucination 은 건수 무관 isError=true
  const isErrorFlag = hasHallucination || failCount > 0;

  const nextActions = buildNextActions(checks, applicability);

  const payload = {
    docId: input.docId,
    overall,
    summary: {
      pass: passCount,
      warn: warnCount,
      manual_review: manualReviewCount,
      fail: failCount,
    },
    checks,
    applicability,
    nextActions,
    ...extraPayload,
  };

  // 응답 텍스트 헤더
  const headerLines: string[] = [];
  if (hasHallucination) {
    headerLines.push(
      `${MARKER_HALLUCINATION} 인용 법령 ref 환각 검출. LLM 은 추측·생성 금지하고 search_safety_laws 로 재검증할 것.`,
    );
  }
  if (overall !== "pass") {
    headerLines.push(
      `${MARKER_REVISION} 법정문서 초안 검토 결과: overall=${overall} (pass=${passCount}, warn=${warnCount}, fail=${failCount})`,
    );
  }
  const text =
    (headerLines.length > 0 ? headerLines.join("\n") + "\n\n" : "") +
    JSON.stringify(payload, null, 2);

  return {
    content: [{ type: "text", text }],
    structuredContent: payload,
    isError: isErrorFlag ? true : undefined,
  } as McpToolResult;
}

export const reviewSafetyDocumentTool: ToolDefinition = {
  name: "review_safety_document",
  title: "안전관리 법정문서 초안 검토 (감독관 시각의 사전 점검)",
  description:
    "안전관리자/현장소장이 작성한 법정문서 초안(draft)을 점검. 모든 docId 가 L0(그래프 노드 존재) + L1(requiredFields·reviewRules·결재선 정합성·본문 인라인 법령 환각 스캔) 자동 검수 대상. **L2 풍부 의미 검수는 risk_assessment(§6 근로자 참여·ERIC-PP 우선순위·시나리오·인용 ref 실존)** 와 **work_plan_excavation(§38 ② notifiedToWorkers)** 만 명시 구현, 그 외 docId 의 L2 깊이는 그래프 노드 reviewRules 보강에 따라 점진 확대. scale.workforce/constructionValue/industry 입력 시 50인·50억 면제·의무 자동 안내. 환각 ref 발견 시 응답 첫 줄에 [HALLUCINATION_DETECTED] 마커 + isError:true 부착. 인용 법령 ref 는 npm 번들 6 본문(산안법/시행령/시행규칙/기준규칙/중처법/위험성평가 고시) + 중처법시행령 article 그래프 노드까지 7 출처와 양방향 대조로 검증.",
  inputSchema,
  handler,
};
