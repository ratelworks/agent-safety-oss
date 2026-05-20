import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  getGuideById,
  loadAllGuides,
  CYCLE_LABELS,
} from "../lib/safety-document-guides-loader.js";

// 파일 최상단 상수 — 특정 법정문서의 풀 가이드 (양식 + 작성가이드 + 검토규칙)
// "이 서식 어떻게 작성?" 에 대한 답을 LLM 에게 제공

const inputSchema = z.object({
  docId: z
    .string()
    .describe(
      "문서 ID — list_safety_documents_by_cycle 에서 docId 확인. 예: monthly_risk_assessment / daily_tbm / work_plan / industrial_accident_report",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const guide = await getGuideById(input.docId);
  if (!guide) {
    const all = await loadAllGuides();
    const lines: string[] = [];
    lines.push(`# 가이드 없음: \`${input.docId}\``);
    lines.push("");
    lines.push(`등록된 ${all.length}개 docId:`);
    lines.push("");
    for (const g of all) {
      lines.push(`- \`${g.docId}\` — ${g.title} (${CYCLE_LABELS[g.cycle]})`);
    }
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        found: false,
        availableDocIds: all.map((g) => g.docId),
      },
      isError: true,
    } as McpToolResult;
  }

  // MD 렌더링
  const lines: string[] = [];
  lines.push(`# ${guide.title}`);
  lines.push("");
  lines.push(
    `> docId: \`${guide.docId}\` · cycle: **${CYCLE_LABELS[guide.cycle]} (${guide.cycle})**`,
  );
  lines.push(`> 보존: ${guide.retention}`);
  if (guide.alternativeNames && guide.alternativeNames.length > 0) {
    lines.push(`> 별칭: ${guide.alternativeNames.join(" / ")}`);
  }
  lines.push("");
  lines.push(`## 목적`);
  lines.push("");
  lines.push(guide.purpose);
  lines.push("");

  lines.push(`## 법령 근거`);
  lines.push("");
  if (guide.legalBasisDetails && guide.legalBasisDetails.length > 0) {
    for (const lb of guide.legalBasisDetails) {
      lines.push(`- **${lb.law} ${lb.article}**${lb.text ? ` — ${lb.text}` : ""}`);
    }
  } else {
    for (const iri of guide.legalBasis) {
      lines.push(`- \`${iri}\``);
    }
  }
  lines.push("");

  lines.push(`## 적용성`);
  lines.push("");
  lines.push(`- 적용: ${guide.applicability.appliesTo}`);
  if (guide.applicability.exemptedFrom.length > 0) {
    lines.push(`- 면제:`);
    for (const ex of guide.applicability.exemptedFrom) {
      lines.push(`  · ${ex}`);
    }
  }
  if (guide.applicability.scaleNotes) {
    lines.push(`- 비고: ${guide.applicability.scaleNotes}`);
  }
  lines.push("");

  lines.push(`## 표준 양식`);
  lines.push("");
  lines.push(`- 출처: ${guide.standardForm.source}`);
  if (guide.standardForm.sourceUrl) {
    lines.push(`- URL: ${guide.standardForm.sourceUrl}`);
  }
  lines.push("");
  lines.push(`### 필수 필드 (${guide.standardForm.requiredFields.length}개)`);
  for (const f of guide.standardForm.requiredFields) {
    lines.push(`- ${f}`);
  }
  if (guide.standardForm.optionalFields && guide.standardForm.optionalFields.length > 0) {
    lines.push("");
    lines.push(`### 권장 필드`);
    for (const f of guide.standardForm.optionalFields) {
      lines.push(`- ${f}`);
    }
  }
  lines.push("");

  if (guide.writingGuide) {
    lines.push(`## 작성 가이드`);
    lines.push("");
    if (guide.writingGuide.fieldHints) {
      lines.push(`### 필드별 작성 힌트`);
      for (const [field, hint] of Object.entries(guide.writingGuide.fieldHints)) {
        lines.push(`- **${field}**: ${hint}`);
      }
      lines.push("");
    }
    if (guide.writingGuide.commonMistakes && guide.writingGuide.commonMistakes.length > 0) {
      lines.push(`### 흔한 실수 / 감독관 지적사항`);
      for (const m of guide.writingGuide.commonMistakes) {
        lines.push(`- ⚠ ${m}`);
      }
      lines.push("");
    }
    if (guide.writingGuide.bestPractices && guide.writingGuide.bestPractices.length > 0) {
      lines.push(`### 모범 사례`);
      for (const b of guide.writingGuide.bestPractices) {
        lines.push(`- ✓ ${b}`);
      }
      lines.push("");
    }
  }

  if (guide.examples && guide.examples.length > 0) {
    lines.push(`## 참조 자료 (KOSHA·고용노동부 공식)`);
    lines.push("");
    for (const ex of guide.examples) {
      const license = ex.license ? ` · ${ex.license}` : "";
      const url = ex.url ? ` — ${ex.url}` : "";
      lines.push(`- ${ex.title}${ex.source ? ` (${ex.source})` : ""}${license}${url}`);
    }
    lines.push("");
  }

  lines.push(`## 검토 규칙 (review_safety_document 의 reviewRules)`);
  lines.push("");
  for (const r of guide.reviewRules) {
    const sev =
      r.severity === "blocker" ? "🔴" : r.severity === "warning" ? "🟡" : "ℹ️";
    const basis = r.legalBasis ? ` _(근거: ${r.legalBasis})_` : "";
    lines.push(`- ${sev} ${r.rule}${basis}`);
  }
  lines.push("");

  lines.push(`## 관련 도구 (체이닝)`);
  lines.push("");
  for (const t of guide.relatedTools) {
    lines.push(`- \`${t}\``);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      found: true,
      guide,
    },
  };
}

export const getSafetyDocumentGuideTool: ToolDefinition = {
  name: "get_safety_document_guide",
  title: "안전관리 법정문서 풀 가이드 (서식·작성가이드·검토규칙)",
  description:
    "특정 법정문서(docId)의 표준 양식·작성가이드·법령 근거·적용성·검토규칙·KOSHA 참조자료를 통합 반환. 안전관리자/현장소장이 그 문서를 처음부터 작성할 때 옆에 두는 길잡이. list_safety_documents_by_cycle 에서 얻은 docId 를 입력. review_safety_document 의 검토 기준 데이터 source 와 동일.",
  inputSchema,
  handler,
};
