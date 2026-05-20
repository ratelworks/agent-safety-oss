import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  loadAllGuides,
  CYCLE_LABELS,
  type CycleCode,
  type SafetyDocumentGuide,
} from "../lib/safety-document-guides-loader.js";

// 파일 최상단 상수 — 시간 주기별 법정문서 색인
// "이번 달/주/일에 작성해야 하는 문서 무엇?" 에 대한 답을 LLM 에게 제공

const inputSchema = z.object({
  cycle: z
    .enum([
      "daily",
      "weekly",
      "monthly",
      "quarterly",
      "semi_annual",
      "annual",
      "ad_hoc",
      "continuous",
      "all",
    ])
    .default("all")
    .describe(
      "필터 — daily(일간) / weekly(주간) / monthly(월간) / quarterly(분기) / semi_annual(반기) / annual(연간) / ad_hoc(수시) / continuous(상시). all(기본) 은 전체",
    ),
  industry: z
    .enum(["construction", "manufacturing", "service", "other"])
    .optional()
    .describe(
      "업종 필터 (옵션, 향후 적용성 자동 매핑용 — 현재 미사용)",
    ),
  workforce: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("상시 근로자 수 (옵션, 50인/100인 적용성 안내용)"),
  constructionValue: z
    .number()
    .min(0)
    .optional()
    .describe(
      "총 공사금액 (단위: 억원, 옵션, 50억 안전보건대장·유해위험방지계획서 면제 안내용)",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const all = await loadAllGuides();
  const filtered =
    input.cycle === "all"
      ? all
      : all.filter((g) => g.cycle === (input.cycle as CycleCode));

  // cycle 별 그룹핑
  const grouped: Record<string, SafetyDocumentGuide[]> = {};
  for (const g of filtered) {
    if (!grouped[g.cycle]) grouped[g.cycle] = [];
    grouped[g.cycle].push(g);
  }

  // MD 응답
  const lines: string[] = [];
  lines.push(`# 시간 주기별 안전관리 법정문서 색인`);
  lines.push("");
  lines.push(
    `> 필터: cycle=${input.cycle} · 결과 ${filtered.length}건 / 전체 ${all.length}건`,
  );
  lines.push("");

  const cycleOrder: CycleCode[] = [
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "semi_annual",
    "annual",
    "ad_hoc",
    "continuous",
  ];

  for (const c of cycleOrder) {
    const items = grouped[c];
    if (!items || items.length === 0) continue;
    lines.push(`## ${CYCLE_LABELS[c]} (${c})`);
    lines.push("");
    for (const g of items) {
      lines.push(`### ${g.title} \`${g.docId}\``);
      lines.push(`- 보존: ${g.retention}`);
      lines.push(
        `- 적용: ${g.applicability.appliesTo}${g.applicability.exemptedFrom.length > 0 ? ` · 면제 ${g.applicability.exemptedFrom.length}건` : ""}`,
      );
      const mainDetail = g.legalBasisDetails?.[0];
      if (mainDetail) {
        lines.push(`- 근거: ${mainDetail.law} ${mainDetail.article}`);
      } else if (g.legalBasis[0]) {
        lines.push(`- 근거: ${g.legalBasis[0]}`);
      }
      lines.push(
        `- 상세: \`get_safety_document_guide({docId: "${g.docId}"})\``,
      );
      lines.push("");
    }
  }

  // 적용성 힌트 (50인/50억/5인 의무·면제 매트릭스)
  if (input.workforce !== undefined || input.industry || input.constructionValue !== undefined) {
    lines.push(`## 사업장 조건 힌트 (의무·면제)`);
    if (input.workforce !== undefined) {
      lines.push(`- 상시 근로자: **${input.workforce}명**`);
      if (input.workforce >= 5) {
        lines.push(`  · ✅ 중대재해 처벌법 적용 (5인 이상) — 시행령 §4·§5 의무, 시행령 §13 보존 5년`);
      } else {
        lines.push(`  · ❌ 중대재해 처벌법 면제 (5인 미만)`);
      }
      if (input.workforce < 50) {
        lines.push(
          `  · ❌ **안전관리자 선임 면제 (50인 미만)** — 산안법 §17, 시행령 별표 3. 사업주·현장소장이 직접 관리.`,
        );
      } else {
        lines.push(`  · ✅ 안전관리자 선임 의무 (50인 이상) — 산안법 §17`);
      }
      if (input.workforce >= 100) {
        lines.push(`  · ✅ 산업안전보건위원회 운영 (100인 이상) — 산안법 §24, 분기 1회 이상`);
      }
    }
    if (input.industry === "construction") {
      lines.push(`- 업종: **건설업**`);
      lines.push(`  · ✅ 산업안전보건관리비 계상·사용 (모든 건설공사) — 산안법 §72`);
      lines.push(`  · ✅ TBM 매 작업일 + 합동점검 매주 + 발굴 매월 (위험성평가 고시 §15 ④)`);
      if (input.constructionValue !== undefined) {
        lines.push(`  · 총 공사금액: **${input.constructionValue}억원**`);
        if (input.constructionValue < 50) {
          lines.push(
            `    · ❌ **안전보건대장 면제 (50억 미만)** — 산안법 §67`,
          );
          lines.push(
            `    · ❌ **유해위험방지계획서 일반 면제 (50억 미만)** — 산안법 §42`,
          );
        } else {
          lines.push(`    · ✅ 안전보건대장 의무 (50억 이상) — 산안법 §67`);
        }
      } else {
        lines.push(
          `  · 50억 이상 안전보건대장 의무 (§67), 50억 미만 면제. constructionValue 입력 시 자동 판정`,
        );
      }
    }
    lines.push("");
  }

  lines.push(`## 다음 단계`);
  lines.push("");
  lines.push(
    `- 각 문서 상세: \`get_safety_document_guide({docId})\` — 표준 양식·작성가이드·검토규칙·관련 도구`,
  );
  lines.push(
    `- 초안 점검: \`review_safety_document({docId, draft, scale})\` — 누락·환각·정합성 검토`,
  );
  lines.push(
    `- 작성 자료 묶음: \`compile_safety_references({workType, docType})\` — 법령+KOSHA+사례 자동 매칭`,
  );

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      total: filtered.length,
      cycle: input.cycle,
      grouped,
    },
  };
}

export const listSafetyDocumentsByCycleTool: ToolDefinition = {
  name: "list_safety_documents_by_cycle",
  title: "시간 주기별 안전관리 법정문서 색인",
  description:
    "안전관리자·현장소장이 일·주·월·분기·반기·연·수시·상시 단위로 작성해야 하는 법정문서 목록을 반환. 각 문서의 보존기간·법령 근거·적용 사업장 요약. 50억 미만·50인 미만 소규모 건설현장 + 안전관리자 겸임 현장소장의 'cycle 단위 작업 인지' 출발점. cycle='monthly' 등으로 특정 주기만 필터 가능. 상세 가이드는 get_safety_document_guide({docId}) 로 후속 호출.",
  inputSchema,
  handler,
};
