/**
 * list_upcoming_duties
 *
 * 사이트 프로파일 + 작성이력(선택)을 기준으로 N일 내 마감/작성 필요한 의무 나열.
 * docs/LEGAL-DUTY-LIFECYCLE.md §1.1 인식 + §1.6 보관 결합.
 *
 * compileHistory 가 없는 경우 frequency·nextDueRule 기반 추정 (오늘 + 주기).
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { loadMaster, computeNextDueDate } from "../lib/master-loader.js";
// Issue #5 lateral (2026-05-22) — KST 기준 일자 산술
import { kstToday, kstAddDays, kstDayDiff } from "../lib/datetime-kst.js";

const inputSchema = z.object({
  withinDays: z.number().int().min(1).max(365).default(30).describe("조회 범위 (일)"),
  compileHistory: z
    .record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional()
    .describe("docId → 최근 작성일 (YYYY-MM-DD). 미지정 시 frequency 기반 추정"),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeAdHoc: z.boolean().default(false).describe("수시·트리거형 의무 포함 (기본 제외)"),
});


// Issue #5 lateral — KST 기준 일수 차이 (시간대 안전)
function daysBetween(a: string, b: string): number {
  return kstDayDiff(a, b);
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);
  // Issue #5 lateral — UTC slice 대신 KST 기준 today
  const asOf = args.asOf ?? kstToday();
  const master = loadMaster();
  const upcoming: Array<{
    docId: string;
    title: string;
    category: string;
    nextDueDate: string;
    daysUntil: number;
    overdue: boolean;
    hasCompileRecord: boolean;
    submitTo: string | null;
    submitDeadline: string | null;
  }> = [];
  const adHocSkipped: string[] = [];

  for (const doc of master.documents) {
    const lastCompile = args.compileHistory?.[doc.docId];

    // ad-hoc / 트리거형은 nextDueRule이 정량 산출 불가 — 옵션 따라 스킵
    const isAdHoc = !doc.nextDueRule || /트리거|즉시|발생|신규|선임|채용|착공|타설|해체|조립|기계도입|작업변경|특수작업|변경시/.test(doc.nextDueRule);

    if (isAdHoc && !args.includeAdHoc) {
      adHocSkipped.push(doc.docId);
      continue;
    }

    let baseDate: string | null = lastCompile ?? asOf;
    let nextDueDate = computeNextDueDate(doc.nextDueRule, baseDate);

    if (!nextDueDate) {
      // 정량 산출 불가 → 스킵 (includeAdHoc=true 이면 내일 마감으로 표시)
      if (args.includeAdHoc) {
        // Issue #5 lateral — KST 기준 내일
        nextDueDate = kstAddDays(asOf, 1);
      } else {
        continue;
      }
    }

    const daysUntil = daysBetween(asOf, nextDueDate);
    if (daysUntil < -365) continue; // 1년 이상 과거 작성건은 무시

    if (daysUntil <= args.withinDays) {
      upcoming.push({
        docId: doc.docId,
        title: doc.title,
        category: doc.category,
        nextDueDate,
        daysUntil,
        overdue: daysUntil < 0,
        hasCompileRecord: !!lastCompile,
        submitTo: doc.submitTo ?? null,
        submitDeadline: doc.submitDeadline ?? null,
      });
    }
  }

  upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

  const lines: string[] = [];
  lines.push(`# ${args.withinDays}일 이내 마감/작성 의무 ${upcoming.length}건`);
  lines.push("");
  lines.push(`**기준일**: ${asOf}`);
  if (Object.keys(args.compileHistory ?? {}).length > 0) {
    lines.push(`**작성이력**: ${Object.keys(args.compileHistory!).length}건 입력`);
  } else {
    lines.push(`**작성이력**: 없음 (오늘부터 +주기 추정)`);
  }
  lines.push("");

  const overdue = upcoming.filter((u) => u.overdue);
  const imminent = upcoming.filter((u) => !u.overdue && u.daysUntil <= 7);
  const upcomingRest = upcoming.filter((u) => !u.overdue && u.daysUntil > 7);

  if (overdue.length > 0) {
    lines.push(`## 🔴 지연 (${overdue.length}건)`);
    lines.push("");
    for (const u of overdue) {
      lines.push(`- **${u.title}** — ${u.nextDueDate} (D+${Math.abs(u.daysUntil)}일 지연)`);
      lines.push(`  - docId: \`${u.docId}\` / 카테고리: ${u.category}`);
      if (u.submitTo) lines.push(`  - 제출: ${u.submitTo} / 마감: ${u.submitDeadline ?? "?"}`);
    }
    lines.push("");
  }
  if (imminent.length > 0) {
    lines.push(`## 🟠 임박 7일 이내 (${imminent.length}건)`);
    lines.push("");
    for (const u of imminent) {
      lines.push(`- **${u.title}** — ${u.nextDueDate} (D-${u.daysUntil}일)`);
      lines.push(`  - docId: \`${u.docId}\` / 카테고리: ${u.category}`);
    }
    lines.push("");
  }
  if (upcomingRest.length > 0) {
    lines.push(`## 🟡 예정 (${upcomingRest.length}건)`);
    lines.push("");
    for (const u of upcomingRest) {
      lines.push(`- ${u.nextDueDate} (D-${u.daysUntil}) — ${u.title} (\`${u.docId}\`)`);
    }
  }
  if (upcoming.length === 0) {
    lines.push("*해당 범위 내 의무 없음.*");
  }
  if (!args.includeAdHoc && adHocSkipped.length > 0) {
    lines.push("");
    lines.push(`> ℹ️ 수시·트리거형 ${adHocSkipped.length}종 미포함 (includeAdHoc=true 로 포함 가능)`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      asOf,
      withinDays: args.withinDays,
      counts: {
        total: upcoming.length,
        overdue: overdue.length,
        imminent: imminent.length,
        upcoming: upcomingRest.length,
        adHocSkipped: adHocSkipped.length,
      },
      duties: upcoming,
      adHocSkipped: args.includeAdHoc ? [] : adHocSkipped,
    },
  };
}

export const listUpcomingDutiesTool: ToolDefinition = {
  name: "list_upcoming_duties",
  title: "임박 의무 목록",
  description:
    "지정 기간 내 마감·갱신 필요한 법정의무를 작성이력 + frequency 기반으로 산출한다. 라이프사이클 §1.6 보관·다음 작성일 알림. 작성이력 없으면 오늘 기준 추정.",
  inputSchema,
  handler,
};
