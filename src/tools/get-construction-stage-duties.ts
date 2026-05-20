/**
 * get_construction_stage_duties
 *
 * 공사 진행 단계별 의무 패키지를 반환한다.
 * docs/LEGAL-DUTY-LIFECYCLE.md §5.2 공사 단계.
 *
 * stage:
 *   pre        — 착공 전 (계약 체결 ~ 착공 직전)
 *   active     — 시공 중 (일·주·월 단위)
 *   post       — 준공 (공사 완료 ~ 보관 의무 시작)
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { loadMaster } from "../lib/master-loader.js";

const inputSchema = z.object({
  stage: z.enum(["pre", "active", "post"]).describe("pre=착공전 / active=시공중 / post=준공"),
  isLargeScale: z.boolean().optional().describe("50억+ 또는 50인+ 대규모 여부 (착공 전 추가 의무 활성화)"),
});


interface StageDuty {
  docId: string;
  why: string; // 이 단계에 왜 필요한가
  priority: "must" | "should" | "may"; // must=법령강제, should=권장, may=조건부
}

const STAGE_DUTIES: Record<"pre" | "active" | "post", StageDuty[]> = {
  pre: [
    { docId: "safety_health_management_policy", why: "현장 개설 시 즉시 게시·비치 (산안법 §14)", priority: "must" },
    { docId: "safety_health_manager_appointment", why: "50인 이상 또는 건설업 50억 이상 선임 의무 (산안법 §17)", priority: "must" },
    { docId: "safety_health_total_responsible_appointment", why: "50억 이상 도급 시 안전보건총괄책임자 선임 (산안법 §62)", priority: "must" },
    { docId: "hazardous_risk_prevention_plan_construction", why: "건설공사 착공 15일 전 KOSHA 제출 (산안법 §42)", priority: "must" },
    { docId: "construction_safety_management_plan", why: "공사 착공 전 안전관리계획 수립", priority: "must" },
    { docId: "design_safety_health_register", why: "설계 단계 안전보건대장 (50억 이상)", priority: "must" },
    { docId: "basic_safety_health_register", why: "기본 안전보건대장 작성", priority: "must" },
    { docId: "safety_cost_plan", why: "안전관리비 사용계획서 (착공 전)", priority: "must" },
    { docId: "contract_safety_health_clause", why: "도급계약서 안전보건 조항", priority: "should" },
    { docId: "safety_health_regulation", why: "100인 이상 또는 별표 2 업종은 안전보건관리규정", priority: "may" },
  ],
  active: [
    { docId: "daily_tbm", why: "매일 작업 시작 전 TBM (위험성평가 고시 §15 ④ 3호)", priority: "must" },
    { docId: "monthly_risk_assessment", why: "상시 위험성평가 (매일·매주·매월 KRAS)", priority: "must" },
    { docId: "pre_work_inspection", why: "작업 전 안전점검", priority: "must" },
    { docId: "work_start_pre_check", why: "작업시작 전 점검표 별표 3 23종 (산안기준규칙 §35)", priority: "must" },
    { docId: "construction_machinery_inspection", why: "건설기계 일상점검 (산안법 §93)", priority: "must" },
    { docId: "monthly_education_log", why: "매월 정기 안전보건교육 (산안법 §29)", priority: "must" },
    { docId: "construction_safety_inspection_record", why: "주1회·월1회 정기점검 (산안법 §36의2)", priority: "must" },
    { docId: "weekly_joint_inspection", why: "도급사업주 합동점검 (격주·월별)", priority: "should" },
    { docId: "supervisor_education_log", why: "관리감독자 정기교육 분기 1회 (산안법 §29)", priority: "must" },
    { docId: "ppe_register", why: "보호구 지급 대장 (산안법 §32)", priority: "must" },
    { docId: "safety_signage_register", why: "안전보건표지 게시·관리 (산안법 §37)", priority: "must" },
    { docId: "tower_crane_inspection", why: "타워크레인 등 위험기계 검사 (산안법 §93)", priority: "must" },
    { docId: "scaffolding_inspection_checklist", why: "비계 점검 (산안기준규칙 §57)", priority: "must" },
    { docId: "fall_prevention_net_inspection", why: "추락방지망 점검", priority: "must" },
    { docId: "safety_harness_inspection", why: "안전대 점검", priority: "must" },
    { docId: "temporary_electric_inspection", why: "가설전기 점검 (산안기준규칙 §301)", priority: "must" },
    { docId: "temporary_fire_facility_check", why: "가설소방시설 점검", priority: "must" },
    { docId: "contractor_round_inspection_log", why: "도급사업주 순회점검", priority: "must" },
    { docId: "ad_hoc_risk_assessment", why: "변경·사고 발생 시 수시 위험성평가 (조건부)", priority: "may" },
  ],
  post: [
    { docId: "industrial_accident_report", why: "공사 중 발생한 산재의 사고시점+1개월 제출 (현재 미제출 건 우선)", priority: "must" },
    { docId: "severe_accident_compliance", why: "중대재해 발생 시 재발방지대책 이행계획", priority: "may" },
    { docId: "safety_cost_settlement", why: "공사 완료 후 안전관리비 정산서", priority: "must" },
    { docId: "construction_safety_health_register", why: "공사 안전보건대장 보관 시작 (5년)", priority: "must" },
    { docId: "monthly_education_log", why: "교육일지 보관 의무 시작 (3년)", priority: "must" },
  ],
};

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);
  const master = loadMaster().documents;
  const dutyList = STAGE_DUTIES[args.stage];

  // 대규모 사업장 아니면 50억/50인 조건 의무는 may 또는 제외
  const filtered = dutyList.filter((d) => {
    if (args.isLargeScale === false && /50억|50인|100인|대규모/.test(d.why)) {
      return d.priority !== "must"; // 제외
    }
    return true;
  });

  const enriched = filtered.map((d) => {
    const meta = master.find((m) => m.docId === d.docId);
    return {
      ...d,
      title: meta?.title ?? d.docId,
      legalRef: meta?.legalRef ?? [],
      frequency: meta?.frequency ?? "?",
      submitTo: meta?.submitTo ?? null,
      retention: meta?.retention ?? null,
      missingFromMaster: !meta,
    };
  });

  const stageLabel = { pre: "🏗 착공 전 (Pre)", active: "🔨 시공 중 (Active)", post: "📦 준공 (Post)" }[args.stage];
  const lines: string[] = [];
  lines.push(`# ${stageLabel} — 공사 단계별 법정 의무`);
  lines.push("");
  lines.push(`**대규모 여부**: ${args.isLargeScale === undefined ? "미지정" : args.isLargeScale ? "예 (50억+ 또는 50인+)" : "아니오"}`);
  lines.push(`**의무 수**: ${enriched.length}건 (must ${enriched.filter((e) => e.priority === "must").length} / should ${enriched.filter((e) => e.priority === "should").length} / may ${enriched.filter((e) => e.priority === "may").length})`);
  lines.push("");
  lines.push("---");
  lines.push("");

  const priorityBadge = { must: "🔴 의무", should: "🟠 권장", may: "🟡 조건부" };
  for (const group of ["must", "should", "may"] as const) {
    const groupItems = enriched.filter((e) => e.priority === group);
    if (groupItems.length === 0) continue;
    lines.push(`## ${priorityBadge[group]} (${groupItems.length}건)`);
    lines.push("");
    for (const e of groupItems) {
      lines.push(`### ${e.title}`);
      lines.push(`- **docId**: \`${e.docId}\`${e.missingFromMaster ? " ⚠️ 마스터 미정의" : ""}`);
      lines.push(`- **이유**: ${e.why}`);
      if (e.legalRef.length > 0) lines.push(`- **법령**: ${e.legalRef.join(", ")}`);
      if (e.frequency && e.frequency !== "?") lines.push(`- **주기**: ${e.frequency}`);
      if (e.submitTo) lines.push(`- **제출**: ${e.submitTo}`);
      if (e.retention) lines.push(`- **보관**: ${e.retention}`);
      lines.push("");
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      stage: args.stage,
      isLargeScale: args.isLargeScale,
      counts: {
        total: enriched.length,
        must: enriched.filter((e) => e.priority === "must").length,
        should: enriched.filter((e) => e.priority === "should").length,
        may: enriched.filter((e) => e.priority === "may").length,
      },
      duties: enriched,
      nextActions: [
        "각 docId 로 `generate_safety_document` 또는 `get_safety_document_guide` 호출",
        "착공 전 패키지는 `assess_my_obligations` 와 함께 활용해 사업장별 정확한 의무 도출",
      ],
    },
  };
}

export const getConstructionStageDutiesTool: ToolDefinition = {
  name: "get_construction_stage_duties",
  title: "공사 단계별 법정 의무",
  description:
    "착공 전(pre) / 시공 중(active) / 준공(post) 단계별 법정의무 패키지를 반환한다. isLargeScale 옵션으로 50억·50인 조건부 의무 자동 필터링. 라이프사이클 §5.2 공사 단계.",
  inputSchema,
  handler,
};
