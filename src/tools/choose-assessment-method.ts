import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  recommendMethod,
  getKrasMethodMeta,
  type RecommendInput,
} from "../lib/kras-methods-loader.js";

// 파일 최상단 상수 — 사업장 조건 기반 KRAS 방법 추천

const inputSchema = z.object({
  industry: z
    .enum(["construction", "manufacturing", "service", "other"])
    .describe(
      "업종 — construction: 건설업 (의무 적용 construction_continuous) / manufacturing: 제조업 / service: 서비스업 / other: 기타",
    ),
  scale: z
    .enum(["small", "medium", "large"])
    .describe(
      "사업장 규모 — small: 소규모 (50인 미만 권장) / medium: 중규모 (50~300인) / large: 대규모 (300인 이상)",
    ),
  subject: z
    .enum(["general", "chemical", "health", "construction"])
    .default("general")
    .describe(
      "평가 영역 — general: 일반 안전 / chemical: 화학물질 (→ CHARM 우선) / health: 직업병·작업환경 (→ 산업보건평가 우선) / construction: 건설 작업 (→ 건설상시평가 우선)",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const recInput: RecommendInput = {
    industry: input.industry,
    scale: input.scale,
    subject: input.subject,
  };
  const rec = recommendMethod(recInput);

  const primaryMeta = getKrasMethodMeta(rec.primary);
  const secondaryMetas = rec.secondary.map((c) => getKrasMethodMeta(c)).filter((m) => m);

  const lines: string[] = [];
  lines.push(`# 위험성평가 방법 추천`);
  lines.push("");
  lines.push(`> 입력: 업종=**${input.industry}** · 규모=**${input.scale}** · 영역=**${input.subject}**`);
  lines.push("");
  lines.push(`## ✅ 1순위 (Primary)`);
  lines.push("");
  if (primaryMeta) {
    lines.push(`**\`${rec.primary}\`** — ${primaryMeta.official}`);
    lines.push(`- 접근: ${primaryMeta.approach === "quantitative" ? "정량 (매트릭스)" : "정성 (직관·체크)"}`);
    lines.push(`- 적용 규모: ${primaryMeta.applicableScale.join(", ")}`);
  }
  lines.push("");
  if (secondaryMetas.length > 0) {
    lines.push(`## 🔄 보조 (Secondary)`);
    lines.push("");
    for (const m of secondaryMetas) {
      lines.push(`- **\`${m!.code}\`** — ${m!.official}`);
    }
    lines.push("");
  }
  lines.push(`## 추천 사유`);
  lines.push("");
  lines.push(rec.reasoning);
  lines.push("");
  lines.push("## 다음 단계");
  lines.push("");
  lines.push(`1. \`get_kras_method({method: "${rec.primary}"})\` 로 1순위 방법 상세 절차 조회`);
  lines.push(`2. \`get_risk_assessment_schema({method: "${rec.primary}"})\` 로 평가서 양식 받기`);
  lines.push(`3. 작업·공정별로 평가 진행`);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      input: recInput,
      recommendation: {
        primary: rec.primary,
        primaryMeta,
        secondary: rec.secondary,
        secondaryMetas,
        reasoning: rec.reasoning,
      },
      graphContext: {
        primaryMethodIRI: primaryMeta?.iri,
        secondaryMethodIRIs: secondaryMetas.map((m) => m?.iri).filter((x): x is string => !!x),
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
        ],
        legalBasis: ["art:위험성평가-고시:6", "art:산안법:36"],
        sources: ["src:kosha_portal"],
      },
    },
  };
}

export const chooseAssessmentMethodTool: ToolDefinition = {
  name: "choose_assessment_method",
  title: "KRAS 위험성평가 방법 추천",
  description:
    "사업장 조건(업종·규모·평가 영역) 입력 시 가장 적합한 KRAS 위험성평가 방법을 1순위·보조로 추천. 건설업은 construction_continuous 의무, 화학물질 영역은 CHARM 우선, 직업병 영역은 산업보건평가 우선 등 KOSHA 가이드 기반 휴리스틱 적용.",
  inputSchema,
  handler,
};
