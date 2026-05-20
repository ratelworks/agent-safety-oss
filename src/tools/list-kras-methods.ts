import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { listKrasMethods } from "../lib/kras-methods-loader.js";

// 파일 최상단 상수 — KRAS 7개 위험성평가 방법론 메타 목록
// 출처: KOSHA 산업안전포털 KRAS

const inputSchema = z.object({});

async function handler(): Promise<McpToolResult> {
  const methods = listKrasMethods();

  const lines: string[] = [];
  lines.push("# KRAS 7개 위험성평가 방법론");
  lines.push("");
  lines.push(
    "> 출처: KOSHA 산업안전포털 KRAS (https://portal.kosha.or.kr/kras/evaluation/kras-method)",
  );
  lines.push("");
  lines.push("| 코드 | 공식 명칭 | 정량/정성 | 적용 규모 | 적용 분야 |");
  lines.push("|---|---|:---:|---|---|");
  for (const m of methods) {
    lines.push(
      `| \`${m.code}\` | ${m.official} | ${m.approach === "quantitative" ? "정량" : "정성"} | ${m.applicableScale.join(", ")} | ${m.applicableSubject.join(", ")} |`,
    );
  }
  lines.push("");
  lines.push("## 사용");
  lines.push("");
  lines.push(
    "- **방법 추천**: `choose_assessment_method({industry, scale, subject})` → 사업장 조건에 맞는 방법 추천",
  );
  lines.push(
    "- **방법 상세**: `get_kras_method({method})` → 절차·기록 양식·LLM 작성 주의사항",
  );
  lines.push(
    "- **평가서 양식**: `get_risk_assessment_schema({method})` → 선택한 방법의 평가서 필드 구조",
  );

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      total: methods.length,
      methods,
      graphContext: {
        relatedNodes: methods.map((m) => m.iri),
        relatedActivities: ["activity:risk_assessment_general"],
        relatedSteps: [
          "method:kras_step_1_prep",
          "method:kras_step_2_identify",
          "method:kras_step_3_estimate",
          "method:kras_step_4_decide",
          "method:kras_step_5_control",
        ],
        riskMatrix: "method:risk_matrix_5x4",
        manuals: ["manual:risk_assessment_practical"],
        sources: ["src:kosha_portal"],
        legalBasis: ["art:위험성평가-고시:6", "art:산안법:36"],
      },
    },
  };
}

export const listKrasMethodsTool: ToolDefinition = {
  name: "list_kras_methods",
  title: "KRAS 위험성평가 7개 방법론 목록",
  description:
    "KOSHA 가 공식 제공하는 KRAS 7개 위험성평가 방법론(3단계 판단법, 체크리스트법, 핵심요인기술법(OPS), 빈도·강도법, 산업보건평가, 화학물질평가(CHARM), 건설 최초·상시·수시·정기 평가)의 메타데이터(코드·공식명·정량/정성·적용규모·적용분야)를 반환. 위험성평가 작성 전 어떤 방법을 적용할지 결정에 사용.",
  inputSchema,
  handler,
};
