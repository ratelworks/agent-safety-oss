/**
 * preview_review
 *
 * Active Graph Authoring Loop (decision 002) — 작성 중 부분 검토 도구.
 *
 * 사용자가 A2UI 폼에서 일부 필드를 작성한 상태에서 "현재까지 검토" 버튼을
 * 클릭하면, LLM 이 본 도구를 호출하여 review_safety_document 를 부분 모드로
 * 호출하고 결과를 A2UI 컴포넌트로 가공해서 폼에 동적 push 한다.
 *
 * review_safety_document 와의 차이:
 *   - 작성 중에 호출 가능 — draft 가 미완성이어도 동작
 *   - scope 으로 검토 범위 좁힘 (필수만 / 환각만 / 전체)
 *   - a2uiUpdate 로 결과를 폼에 시각화 (체크리스트)
 *   - 최종 검토 (review_safety_document) 와 직교 — preview 는 가드레일, review 는 결재 직전 검증
 *
 * 흐름:
 *   1. review_safety_document 의 handler 를 import 하여 직접 호출
 *   2. scope 에 따라 결과 필터링
 *      - required-only: status="fail" + rule startsWith "필수" 만
 *      - hallucination-only: "법령 인용 실존성" + "인라인 스캔" 만
 *      - all: 전체
 *   3. structuredContent + a2uiUpdate (체크리스트 컴포넌트) 조립
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { reviewSafetyDocumentTool } from "./review-safety-document.js";

const inputSchema = z.object({
  docId: z.string().describe("법정문서 docId"),
  draft: z.record(z.unknown()).describe("현재까지 작성된 draft (불완전 가능)"),
  scope: z
    .enum(["all", "required-only", "hallucination-only"])
    .default("all")
    .describe(
      "검토 범위 — all (전체) / required-only (필수 누락만) / hallucination-only (법령 환각만)",
    ),
  surfaceId: z.string().default("safety-form").describe("A2UI surface ID"),
  scale: z
    .object({
      workforce: z.number().optional(),
      constructionValue: z.number().optional(),
      industry: z.string().optional(),
      workHeight: z.number().optional(),
      workDepth: z.number().optional(),
      edgeOpen: z.boolean().optional(),
      confinedSpace: z.boolean().optional(),
      hotWork: z.boolean().optional(),
      hazardousChemical: z.boolean().optional(),
      contractor: z.boolean().optional(),
      machineType: z.string().optional(),
    })
    .optional()
    .describe("현장 규모·조건 (review_safety_document 와 동일)"),
});

type Input = z.infer<typeof inputSchema>;

interface CheckResult {
  rule: string;
  status: "pass" | "warn" | "manual_review" | "fail";
  legalBasis?: string;
  reason?: string;
  details?: unknown;
}

function filterChecks(checks: CheckResult[], scope: Input["scope"]): CheckResult[] {
  if (scope === "all") return checks;
  if (scope === "required-only") {
    return checks.filter(
      (c) =>
        c.status === "fail" &&
        (c.rule.startsWith("필수") || c.rule.includes("결재선") || c.rule.includes("필수 필드")),
    );
  }
  if (scope === "hallucination-only") {
    return checks.filter(
      (c) => c.rule.includes("법령 인용 실존성") || c.rule.includes("인라인 스캔"),
    );
  }
  return checks;
}

function statusEmoji(status: string): string {
  switch (status) {
    case "pass":
      return "✅";
    case "warn":
      return "⚠️";
    case "manual_review":
      return "👀";
    case "fail":
      return "❌";
    default:
      return "•";
  }
}

function buildChecklistMarkdown(checks: CheckResult[]): string {
  const lines: string[] = [];
  const grouped: Record<string, CheckResult[]> = {
    fail: [],
    warn: [],
    manual_review: [],
    pass: [],
  };
  for (const c of checks) (grouped[c.status] ??= []).push(c);

  if (grouped.fail.length > 0) {
    lines.push(`### ❌ 필수 미작성 / 환각 (${grouped.fail.length}건)`);
    for (const c of grouped.fail)
      lines.push(`- ❌ ${c.rule}${c.reason ? ` — ${c.reason}` : ""}`);
    lines.push("");
  }
  if (grouped.warn.length > 0) {
    lines.push(`### ⚠️ 경고 (${grouped.warn.length}건)`);
    for (const c of grouped.warn.slice(0, 10))
      lines.push(`- ⚠️ ${c.rule}${c.reason ? ` — ${c.reason}` : ""}`);
    lines.push("");
  }
  if (grouped.manual_review.length > 0) {
    lines.push(`### 👀 사람 검토 권장 (${grouped.manual_review.length}건)`);
    for (const c of grouped.manual_review.slice(0, 5))
      lines.push(`- 👀 ${c.rule}`);
    lines.push("");
  }
  if (grouped.pass.length > 0) {
    lines.push(`### ✅ 통과 (${grouped.pass.length}건)`);
    lines.push(`> 자동 검증 통과 (전체 표시 생략)`);
    lines.push("");
  }
  return lines.join("\n");
}

function buildA2UIUpdate(
  surfaceId: string,
  overall: string,
  checks: CheckResult[],
): Array<Record<string, unknown>> {
  const cardId = `preview-review-${Date.now()}-card`;
  const colId = `${cardId}-col`;
  const titleId = `${cardId}-title`;
  const summaryId = `${cardId}-summary`;

  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const passCount = checks.filter((c) => c.status === "pass").length;
  const manualCount = checks.filter((c) => c.status === "manual_review").length;

  const overallEmoji = overall === "pass" ? "✅" : overall === "needs_revision" ? "⚠️" : "❌";
  const overallText = `${overallEmoji} 검토 결과: ${overall.toUpperCase()} — fail ${failCount} · warn ${warnCount} · manual ${manualCount} · pass ${passCount}`;

  // 상위 5개 fail 항목을 별도 컴포넌트로
  const failRows = checks
    .filter((c) => c.status === "fail")
    .slice(0, 5)
    .map((c, i) => ({
      id: `${cardId}-fail-${i}`,
      component: "Text",
      text: `❌ ${c.rule}${c.reason ? ` — ${c.reason}` : ""}`,
      usageHint: "body",
    }));

  return [
    {
      updateComponents: {
        surfaceId,
        root: "root",
        components: [
          { id: cardId, component: "Card", child: colId },
          {
            id: colId,
            component: "Column",
            children: [titleId, summaryId, ...failRows.map((r) => r.id)],
          },
          {
            id: titleId,
            component: "Text",
            text: `📝 부분 검토 결과`,
            usageHint: "h2",
          },
          { id: summaryId, component: "Text", text: overallText, usageHint: "body" },
          ...failRows,
        ],
      },
    },
  ];
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args: Input = inputSchema.parse(rawInput);

  // review_safety_document handler 직접 호출 — scale 포함
  const reviewResult = await reviewSafetyDocumentTool.handler({
    docId: args.docId,
    draft: args.draft,
    scale: args.scale,
  });

  const reviewPayload = (reviewResult.structuredContent ?? {}) as Record<string, any>;
  const allChecks: CheckResult[] = (reviewPayload.checks as CheckResult[]) ?? [];
  const overall: string = String(reviewPayload.overall ?? "unknown");
  const filteredChecks = filterChecks(allChecks, args.scope);

  // 누락 필수 목록 추출
  const missingRequired = allChecks
    .filter((c) => c.status === "fail" && c.rule.startsWith("필수"))
    .map((c) => c.rule.replace(/^필수\s*[—-]\s*/, ""));

  // 환각 목록 추출
  const hallucinations: Array<{ reference: string; reason?: string }> = [];
  for (const c of allChecks) {
    if (
      (c.rule.includes("법령 인용 실존성") || c.rule.includes("인라인 스캔")) &&
      c.status === "fail"
    ) {
      const details = c.details as { refChecks?: Array<{ reference: string; exists: boolean; reason?: string }> } | undefined;
      if (details?.refChecks) {
        for (const r of details.refChecks) {
          if (!r.exists) hallucinations.push({ reference: r.reference, reason: r.reason });
        }
      }
    }
  }

  // Markdown 응답
  const lines: string[] = [];
  const overallEmoji = overall === "pass" ? "✅" : overall === "needs_revision" ? "⚠️" : "❌";
  lines.push(`# ${overallEmoji} 부분 검토 결과 — ${args.docId}`);
  lines.push("");
  lines.push(
    `> scope: **${args.scope}** · overall: **${overall}** · 표시 ${filteredChecks.length}/${allChecks.length}건`,
  );
  lines.push("");
  if (missingRequired.length > 0) {
    lines.push(`## 🚫 결재 차단 항목 ${missingRequired.length}건`);
    for (const m of missingRequired.slice(0, 15)) lines.push(`- ${m}`);
    if (missingRequired.length > 15)
      lines.push(`- ... 외 ${missingRequired.length - 15}건`);
    lines.push("");
  }
  if (hallucinations.length > 0) {
    lines.push(`## ⚠️ 환각 의심 법령 인용 ${hallucinations.length}건`);
    for (const h of hallucinations.slice(0, 10))
      lines.push(`- \`${h.reference}\`${h.reason ? ` — ${h.reason}` : ""}`);
    lines.push("");
  }
  lines.push(buildChecklistMarkdown(filteredChecks));

  const a2uiUpdate = buildA2UIUpdate(args.surfaceId, overall, filteredChecks);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      docId: args.docId,
      scope: args.scope,
      overall,
      summary: reviewPayload.summary ?? {},
      missingRequired,
      hallucinations,
      checks: filteredChecks,
      applicability: reviewPayload.applicability,
      a2uiUpdate,
      nextActions: [
        ...(missingRequired.length > 0
          ? [
              `request_field_help({docId: "${args.docId}", fieldKey}) — 누락 필드별 작성 도움말 호출`,
            ]
          : []),
        ...(hallucinations.length > 0
          ? [
              `search_safety_laws({keyword}) — 환각 ref 대신 정확한 조문 재검색`,
              `get_safety_law_article({reference}) — 조문 본문 확인`,
            ]
          : []),
        ...(overall === "pass"
          ? [
              `review_safety_document({docId, draft, scale}) — 최종 검토 (결재 직전)`,
              `generate_safety_document({docId, draft, useProfile: true}) — 본문 생성`,
            ]
          : []),
      ],
    },
    isError: reviewResult.isError,
  };
}

export const previewReviewTool: ToolDefinition = {
  name: "preview_review",
  title: "작성 중 부분 검토 (Active Graph Authoring Loop)",
  description:
    "A2UI 폼에서 사용자가 일부 필드 작성 후 본 도구 호출 → review_safety_document 의 부분 모드로 누락 필수·환각 인용·결재선 즉시 검토. scope 으로 검토 범위 좁힘 (all / required-only / hallucination-only). 작성 중 가드레일 — 최종 검토 (review_safety_document) 와 직교. decision 002 Active Graph Authoring Loop 2단계 도구. 반환 structuredContent.a2uiUpdate 가 viewer 에 체크리스트 컴포넌트 push. LLM 후속 도구 추천: request_field_help (누락 필드별 가이드) / search_safety_laws (환각 정정) / review_safety_document (최종) / generate_safety_document (본문).",
  inputSchema,
  handler,
};
