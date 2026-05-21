import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { getDocument, neighborsByEdge } from "../lib/graph-nodes-loader.js";
import { COMMON_RESPONSE_META } from "../config/constants.js";
// Issue #6 lateral (2026-05-22) — industry 자연어 alias
import { aliasedEnum, INDUSTRY_ALIASES } from "../lib/input-aliases.js";

// 파일 최상단 상수 — 사업장 조건 + 작업 조건이 특정 법정문서·조문 적용 대상인지 자동 판정
//
// 입력:
//   docId      — 검사 대상 법정문서
//   scale      — 사업장 규모 (workforce/constructionValue/industry)
//   workConditions — 작업 조건 (depthM, height, ...)
//
// 출력:
//   applies    — 의무 발동 여부
//   reason     — 발동/면제 근거
//   threshold  — 임계값 (있다면)
//   relatedObligations — 동시 발동되는 다른 의무 안내

const ScaleSchema = z
  .object({
    workforce: z.number().int().min(0).optional().describe("상시 근로자 수"),
    constructionValue: z.number().min(0).optional().describe("총 공사금액 (억원)"),
    industry: aliasedEnum(
      ["construction", "manufacturing", "service", "other"] as const,
      INDUSTRY_ALIASES,
    ).optional().describe("업종. 자연어 alias 허용: 건설→construction, 제조→manufacturing, 서비스→service, 기타→other."),
  })
  .optional();

const WorkConditionsSchema = z
  .object({
    depthM: z.number().min(0).optional().describe("굴착·터파기 깊이(m). graph 룰 applic:excavation_2m_plus 평가"),
    heightM: z.number().min(0).optional().describe("작업 높이(m). graph 룰 applic:fall_protection_2m 평가"),
    workType: z.string().optional().describe("작업 종류 슬러그 (excavation 등)"),
    edgeOpen: z.boolean().optional().describe("개구부·단부 노출 여부. graph 룰 applic:edge_work·fall_protection_2m 평가"),
    confinedSpace: z.boolean().optional().describe("밀폐공간 작업 여부. graph 룰 applic:confined_space 평가 (송기마스크·산소측정 강제)"),
    hotWork: z.boolean().optional().describe("화기작업 (용접·용단·연마) 여부. graph 룰 applic:hot_work 평가 (화기허가서·소화기 강제)"),
    hazardousChemical: z.boolean().optional().describe("화학물질 취급 여부. graph 룰 applic:chemicals_handling·hazard_factor_exposed 평가"),
    contractor: z.boolean().optional().describe("도급 사업장 여부. graph 룰 applic:contractor 평가"),
    machineType: z.string().optional().describe("기계·기구 종류 (프레스, 크레인 등). graph 룰 applic:safety_certification_13·safety_inspection_11·voluntary_safety_confirmation_21 평가"),
    noiseExposure: z.boolean().optional().describe("소음 노출 여부. graph 룰 applic:hazard_factor_exposed 평가"),
    dustExposure: z.boolean().optional().describe("분진 노출 여부. graph 룰 applic:hazard_factor_exposed 평가"),
    vibrationExposure: z.boolean().optional().describe("진동 노출 여부. graph 룰 applic:hazard_factor_exposed 평가"),
    ongoingAssessmentSelected: z.boolean().optional().describe("위험성평가 상시평가 선택 여부. graph 룰 applic:ongoing_assessment_selected 평가"),
  })
  .optional();

const inputSchema = z.object({
  docId: z.string().min(1).describe("법정문서 docId"),
  scale: ScaleSchema,
  workConditions: WorkConditionsSchema,
});

type Input = z.infer<typeof inputSchema>;

interface AppResult {
  applies: boolean;
  reason: string;
  triggeredBy: string[];
  exemptedBy: string[];
}

function evaluate(
  docApplicable: Record<string, unknown> | undefined,
  docExempted: Record<string, unknown> | undefined,
  workConditions: Input["workConditions"],
): AppResult {
  const triggeredBy: string[] = [];
  const exemptedBy: string[] = [];

  // depthGte 평가
  if (typeof docApplicable?.depthGte === "number") {
    const depth = workConditions?.depthM;
    if (typeof depth === "number") {
      if (depth >= (docApplicable.depthGte as number)) {
        triggeredBy.push(`굴착면 깊이 ${depth}m >= 임계값 ${docApplicable.depthGte}m`);
      } else {
        exemptedBy.push(`굴착면 깊이 ${depth}m < 임계값 ${docApplicable.depthGte}m`);
      }
    } else {
      // 깊이 미입력 — 보수적으로 판단 보류
      triggeredBy.push(`임계값 depth>=${docApplicable.depthGte}m 입력 필요`);
    }
  }

  // exemptedWhen.depthLt 등
  if (typeof docExempted?.depthLt === "number") {
    const depth = workConditions?.depthM;
    if (typeof depth === "number" && depth < (docExempted.depthLt as number)) {
      exemptedBy.push(`exemptedWhen depthLt=${docExempted.depthLt}m 만족`);
    }
  }

  // workType 매칭
  if (typeof docApplicable?.workType === "string") {
    if (docApplicable.workType === workConditions?.workType) {
      triggeredBy.push(`작업 종류 일치: ${docApplicable.workType}`);
    }
  }

  // applicableWhen.appliesTo 텍스트 (자동 변환분)
  if (typeof docApplicable?.appliesTo === "string") {
    triggeredBy.push(`적용 범위 (텍스트): ${docApplicable.appliesTo}`);
  }

  const applies = triggeredBy.length > 0 && exemptedBy.length === 0;
  return {
    applies,
    reason: applies
      ? triggeredBy.join(" / ")
      : exemptedBy.length > 0
        ? exemptedBy.join(" / ")
        : "조건 정보 부족 — 보수적 판단 (작성 권장)",
    triggeredBy,
    exemptedBy,
  };
}

// v1.3.x 결정론적 추론 룰 — graph Applicability 노드 + JSON Logic evaluator (외부 평가 2026-05-20)
// 이전: 5인/50인/50억 하드코딩 분기. LLM 버전에 따라 결과 달라질 위험.
// 이후: src/ontology/graph/nodes/applicabilities/*.jsonld 의 condition 평가 — 결정론적.
import { evaluateAllApplicabilities, type ApplicabilityNode, type ApplicabilityContext } from "../lib/applicability-rule.js";
import { graphRepository } from "../lib/graph-repository.js";

async function judgeCrossCutting(
  scale: Input["scale"],
  workConditions: Input["workConditions"],
): Promise<{
  applies: string[];
  exempts: string[];
  triggeredRules: string[]; // applicability IRI 목록
  enforcedControls: string[]; // 강제되는 control IRIs
}> {
  await graphRepository.ensureBuilt();

  // 모든 Applicability 노드 로드
  const allNodes: ApplicabilityNode[] = [];
  for (const sub of ["all_workplace", "5_workers_or_more", "fifty_persons_or_more",
    "50_workers_or_construction", "construction_all", "construction_50bn_plus",
    "construction_under_50bn", "all_workplace_with_excavation",
    "chemicals_handling", "contractor",
    "fall_protection_2m", "excavation_2m_plus", "confined_space", "hot_work", "edge_work",
    "hazard_factor_exposed", "safety_certification_13", "safety_inspection_11",
    "voluntary_safety_confirmation_21", "ongoing_assessment_selected"]) {
    const node = graphRepository.getNode(`applic:${sub}`);
    if (node && (node as ApplicabilityNode).condition) {
      allNodes.push(node as ApplicabilityNode);
    }
  }

  // context 합성 — scale (사업장 규모) + workConditions (작업 조건)
  // workConditions 의 depthM/heightM 은 graph 룰의 workDepth/workHeight 로 alias 매핑
  const ctx: ApplicabilityContext = {
    workforce: scale?.workforce,
    constructionValue: scale?.constructionValue,
    industry: scale?.industry,
    workHeight: workConditions?.heightM,
    workDepth: workConditions?.depthM,
    workType: workConditions?.workType,
    edgeOpen: workConditions?.edgeOpen,
    confinedSpace: workConditions?.confinedSpace,
    hotWork: workConditions?.hotWork,
    hazardousChemical: workConditions?.hazardousChemical,
    contractor: workConditions?.contractor,
    machineType: workConditions?.machineType,
    noiseExposure: workConditions?.noiseExposure,
    dustExposure: workConditions?.dustExposure,
    vibrationExposure: workConditions?.vibrationExposure,
    ongoingAssessmentSelected: workConditions?.ongoingAssessmentSelected,
  };

  const results = evaluateAllApplicabilities(allNodes, ctx);
  const applies: string[] = [];
  const exempts: string[] = [];
  const triggeredRules: string[] = [];
  const enforcedControls = new Set<string>();

  for (const r of results) {
    const label = `${r.label} [${r.legalWeight}]${r.legalBasis.length > 0 ? ` (${r.legalBasis.join(", ")})` : ""}`;
    if (r.applies) {
      applies.push(label);
      triggeredRules.push(r.applicabilityId);
      r.enforces.forEach((c) => enforcedControls.add(c));
    } else if (r.reason) {
      exempts.push(`${r.label}: ${r.reason}`);
    }
  }

  // 건설업 + 산안법 §72 (산안비) — 모든 건설공사 적용 (placeholder 노드 없으면 fallback)
  if (scale?.industry === "construction") {
    applies.push("산업안전보건관리비 계상·사용 (산안법 §72) — 모든 건설공사 [mandatory]");
  }

  return { applies, exempts, triggeredRules, enforcedControls: Array.from(enforcedControls) };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const doc = await getDocument(input.docId);
  if (!doc) {
    return {
      content: [{ type: "text", text: `docId='${input.docId}' Document 노드 미발견.` }],
      structuredContent: { found: false, docId: input.docId },
      isError: true,
    } as McpToolResult;
  }

  const docResult = evaluate(doc.applicableWhen, doc.exemptedWhen, input.workConditions);
  const crossCutting = await judgeCrossCutting(input.scale, input.workConditions);

  // graphology BFS — Document.requires Activity 노드들의 causedBy Hazard 추적 (위험성평가 통합)
  const requiredActivities = await neighborsByEdge(doc["@id"], "requires");
  const relatedHazards: string[] = [];
  for (const actId of requiredActivities) {
    const hzs = await neighborsByEdge(actId, "causedBy");
    relatedHazards.push(...hzs);
  }
  const uniqueHazards = Array.from(new Set(relatedHazards));

  const payload = {
    docId: input.docId,
    title: doc.title,
    document: docResult,
    crossCutting,
    inputScale: input.scale,
    inputWorkConditions: input.workConditions,
    relatedActivities: requiredActivities,
    relatedHazards: uniqueHazards, // 그래프 BFS 2-hop — Document → Activity → Hazard
    graphologyHops: { requires: 1, hazards: 2 },
    _meta: COMMON_RESPONSE_META,
  };

  const text = [
    `# 적용성 판정 — ${doc.title} (docId=${doc.docId})`,
    `결과: ${docResult.applies ? "✅ 적용 (작성 의무)" : "⚠ 미적용 또는 면제"}`,
    `근거: ${docResult.reason}`,
    "",
    `## Cross-cutting (사업장 규모) 자동 안내`,
    ...(crossCutting.applies.length > 0
      ? ["[적용]", ...crossCutting.applies.map((a) => `  + ${a}`)]
      : []),
    ...(crossCutting.exempts.length > 0
      ? ["[면제]", ...crossCutting.exempts.map((e) => `  - ${e}`)]
      : []),
    ...(crossCutting.enforcedControls.length > 0
      ? ["", "## 적용 룰에 따른 강제 통제수단 (자동 도출)",
         ...crossCutting.enforcedControls.map((c) => `  → ${c}`)]
      : []),
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: payload,
  } as McpToolResult;
}

export const queryApplicabilityTool: ToolDefinition = {
  name: "query_applicability",
  title: "법정문서·조문 적용성 자동 판정 (50인·50억·작업조건)",
  description:
    "사업장 규모(workforce/constructionValue/industry) + 작업 조건(depthM/heightM/workType) 입력 시 특정 법정문서(docId)의 적용 의무 여부 + 면제 근거 + 동시 발동되는 cross-cutting 의무를 자동 안내. Document.applicableWhen + exemptedWhen 평가 + 산안법 50인·50억 매트릭스. 작업 시작 전 사전 점검에 활용.",
  inputSchema,
  handler,
};
