/**
 * get_retention_status
 *
 * 작성일 + retention 기준으로 남은 보관기간·다음 갱신일·만료여부 산출.
 * docs/LEGAL-DUTY-LIFECYCLE.md §1.6 보관(Retention) 단계.
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { findDoc, retentionToDays, computeNextDueDate } from "../lib/master-loader.js";
// Issue #5 lateral (2026-05-22) — KST 기준 일자 산술
import { kstToday, kstDayDiff } from "../lib/datetime-kst.js";

const inputSchema = z.object({
  docId: z.string().describe("법정문서 docId"),
  compileDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("작성일 YYYY-MM-DD"),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("기준일 KST (생략 시 오늘)"),
});


// Issue #5 lateral — KST 기준 일수 차이
function daysBetween(a: string, b: string): number {
  return kstDayDiff(a, b);
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const { docId, compileDate, asOf: asOfArg } = inputSchema.parse(rawInput);
  // Issue #5 lateral — UTC slice 대신 KST 기준 today
  const asOf = asOfArg ?? kstToday();
  const doc = findDoc(docId);
  if (!doc) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] docId="${docId}"` }],
      isError: true,
      structuredContent: { docId, found: false },
    };
  }

  const retentionDays = retentionToDays(doc.retention);
  const elapsedDays = daysBetween(compileDate, asOf);
  const remainingDays =
    retentionDays === null
      ? null
      : retentionDays === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : retentionDays - elapsedDays;
  const expired = remainingDays !== null && remainingDays !== Number.POSITIVE_INFINITY && remainingDays <= 0;
  const nextDueDate = computeNextDueDate(doc.nextDueRule, compileDate);
  const daysUntilNextDue = nextDueDate ? daysBetween(asOf, nextDueDate) : null;

  // 상태 판정
  let status: "active" | "approaching_renewal" | "overdue_renewal" | "retention_expired";
  if (expired) status = "retention_expired";
  else if (daysUntilNextDue !== null && daysUntilNextDue < 0) status = "overdue_renewal";
  else if (daysUntilNextDue !== null && daysUntilNextDue <= 30) status = "approaching_renewal";
  else status = "active";

  const lines: string[] = [];
  const badge = {
    active: "🟢 활성",
    approaching_renewal: "🟡 갱신 임박 (30일 이내)",
    overdue_renewal: "🔴 갱신 지연",
    retention_expired: "⚪ 보관기간 만료",
  }[status];
  lines.push(`# ${doc.title} — 보관 상태`);
  lines.push("");
  lines.push(`**상태**: ${badge}`);
  lines.push("");
  lines.push(`- **작성일**: ${compileDate}`);
  lines.push(`- **기준일**: ${asOf}`);
  lines.push(`- **경과일**: ${elapsedDays}일`);
  lines.push(`- **보관기간**: ${doc.retention}`);
  if (remainingDays === Number.POSITIVE_INFINITY) {
    lines.push(`- **남은 보관**: ♾ 영구`);
  } else if (remainingDays !== null) {
    lines.push(`- **남은 보관**: ${remainingDays}일`);
  } else {
    lines.push(`- **남은 보관**: (자동 산출 불가 — retention="${doc.retention}")`);
  }
  if (nextDueDate) {
    lines.push(`- **다음 작성일**: ${nextDueDate} (D${daysUntilNextDue! >= 0 ? "-" : "+"}${Math.abs(daysUntilNextDue!)}일)`);
  } else {
    lines.push(`- **다음 작성**: ${doc.nextDueRule ?? "(룰 미정의)"}`);
  }
  lines.push(`- **법령근거**: ${doc.legalRef.join(", ")}`);

  if (status === "approaching_renewal" || status === "overdue_renewal") {
    lines.push("");
    lines.push(`> 💡 **권장**: \`generate_safety_document({docId: "${doc.docId}", useProfile: true})\` 로 갱신 초안 생성`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      docId,
      compileDate,
      asOf,
      elapsedDays,
      retention: doc.retention,
      retentionDays,
      remainingDays: remainingDays === Number.POSITIVE_INFINITY ? "infinity" : remainingDays,
      nextDueDate,
      daysUntilNextDue,
      status,
      expired,
    },
  };
}

export const getRetentionStatusTool: ToolDefinition = {
  name: "get_retention_status",
  title: "법정문서 보관·갱신 상태",
  description:
    "특정 법정문서의 작성일 기준으로 남은 보관기간·다음 갱신일·갱신 임박 여부를 산출한다. 라이프사이클 §1.6 보관 단계.",
  inputSchema,
  handler,
};
