import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  getKrasMethodMeta,
  getKrasMethodContent,
  type KrasMethodCode,
} from "../lib/kras-methods-loader.js";

// 파일 최상단 상수 — KRAS 특정 방법론 상세 본문 조회

const inputSchema = z.object({
  method: z
    .enum([
      "3step",
      "checklist",
      "key_factor",
      "frequency_severity",
      "occupational_health",
      "chemical",
      "construction_continuous",
    ])
    .describe(
      "KRAS 방법 코드. list_kras_methods 또는 choose_assessment_method 결과의 code 사용",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const meta = getKrasMethodMeta(input.method as KrasMethodCode);
  if (!meta) {
    return {
      content: [
        {
          type: "text",
          text: `# 알 수 없는 방법 코드: ${input.method}\n\n\`list_kras_methods\` 로 유효한 코드 확인.`,
        },
      ],
      structuredContent: { found: false, query: input },
    };
  }

  const md = await getKrasMethodContent(input.method as KrasMethodCode);

  // 그래프 컨텍스트: 방법별 적용 가능한 활동 매핑
  const APPLICABLE_ACTIVITIES: Record<KrasMethodCode, string[]> = {
    "3step":                 ["activity:risk_assessment_general", "activity:tbm_daily"],
    checklist:               ["activity:risk_assessment_general", "activity:tbm_daily", "activity:safety_education"],
    key_factor:              ["activity:risk_assessment_general", "activity:tbm_daily", "activity:safety_education"],
    frequency_severity:      ["activity:risk_assessment_general"],
    occupational_health:     ["activity:risk_assessment_general", "activity:asbestos_removal", "activity:finishing_paint", "activity:tunnel_excavation"],
    chemical:                ["activity:risk_assessment_general", "activity:finishing_paint", "activity:asbestos_removal"],
    construction_continuous: [
      "activity:risk_assessment_general", "activity:rc_concrete", "activity:steel_structure",
      "activity:scaffolding_assembly", "activity:formwork_shoring", "activity:excavation_2m_plus",
      "activity:tunnel_excavation", "activity:demolition", "activity:bridge_5m_30m", "activity:tower_crane",
    ],
  };

  return {
    content: [{ type: "text", text: md }],
    structuredContent: {
      found: true,
      method: meta,
      sourceUrl: "https://portal.kosha.or.kr/kras/evaluation/kras-method",
      pdfFormId: meta.formId,
      graphContext: {
        methodNode: meta.iri,
        applicableActivities: APPLICABLE_ACTIVITIES[input.method as KrasMethodCode] ?? [],
        relatedSteps: [
          "method:kras_step_1_prep",
          "method:kras_step_2_identify",
          "method:kras_step_3_estimate",
          "method:kras_step_4_decide",
          "method:kras_step_5_control",
        ],
        riskMatrix: "method:risk_matrix_5x4",
        riskAssessmentDocs: [
          "doc:annual/risk_assessment_procedure",
          "doc:ad_hoc/initial_risk_assessment",
          "doc:annual/regular_risk_assessment",
          "doc:monthly/monthly_risk_assessment",
          "doc:ad_hoc/ad_hoc_risk_assessment",
        ],
        legalBasis: ["art:위험성평가-고시:6", "art:산안법:36"],
        sources: ["src:kosha_portal"],
      },
    },
  };
}

export const getKrasMethodTool: ToolDefinition = {
  name: "get_kras_method",
  title: "KRAS 위험성평가 방법 상세 조회",
  description:
    "특정 KRAS 위험성평가 방법(3step·checklist·key_factor·frequency_severity·occupational_health·chemical·construction_continuous)의 상세 절차·기록 양식·LLM 작성 주의사항을 Markdown 으로 반환. 각 방법의 평가 단계 / 매트릭스 척도 / 작성 예시 / 법적 근거 포함.",
  inputSchema,
  handler,
};
