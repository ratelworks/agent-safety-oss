/**
 * safety-report-tools.ts
 *
 * SafetyIssue + CorrectiveAction 운영 보고서 도구.
 */
import { z } from "zod";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import {
  generateSafetyReport,
  getReportsDir,
  listSafetyReports,
  type GenerateSafetyReportInput,
} from "../lib/safety-report-storage.js";
// Issue #6 lateral (2026-05-22) — period 자연어 alias
import { aliasedEnum, PERIOD_ALIASES } from "../lib/input-aliases.js";

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// 매일 사이클 흐름: 보고서 생성·조회 후 → 추가 이슈/조치 모니터링 / 인수인계.
const SUGGESTED_NEXT_TOOLS = {
  generate_safety_report: ["list_safety_reports", "list_open_issues", "list_pending_actions"],
  list_safety_reports: ["generate_safety_report", "list_open_issues", "list_pending_actions"],
} as const;

const generateSafetyReportSchema = z
  .object({
    siteId: z.string().optional().describe("현장 ID. 생략 시 generic 보고서"),
    period: aliasedEnum(["weekly", "monthly"] as const, PERIOD_ALIASES).describe(
      "보고 주기. 자연어 alias 허용: 주/주간/매주/week→weekly, 월/월간/매월/month→monthly.",
    ),
    startDate: z.string().regex(DATE_RE, "xsd:date 형식(YYYY-MM-DD)").describe("기간 시작일"),
    endDate: z.string().regex(DATE_RE, "xsd:date 형식(YYYY-MM-DD)").describe("기간 종료일"),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "startDate must be before or equal to endDate",
    path: ["endDate"],
  });

const listSafetyReportsSchema = z.object({
  siteId: z.string().optional().describe("현장 ID"),
  period: aliasedEnum(["weekly", "monthly"] as const, PERIOD_ALIASES).optional().describe(
    "보고 주기 (자연어 alias 허용)",
  ),
});

async function generateSafetyReportHandler(input: unknown): Promise<McpToolResult> {
  const args = generateSafetyReportSchema.parse(input) as GenerateSafetyReportInput;
  const report = await generateSafetyReport(args);
  return {
    content: [{ type: "text", text: report.markdown }],
    structuredContent: {
      reportId: report.reportId,
      iri: report.iri,
      siteId: report.siteId,
      period: report.period,
      startDate: report.startDate,
      endDate: report.endDate,
      generatedAt: report.generatedAt,
      note: report.note,
      stats: report.stats,
      issues: report.issues,
      actions: report.actions.map((action) => ({
        actionId: action.actionId,
        iri: action.iri,
        relatedIssue: action.relatedIssue,
        relatedIssueIri: action.relatedIssueIri,
        relatedIssueState: action.relatedIssueState,
        status: action.status,
        dueBy: action.dueBy,
        completedAt: action.completedAt,
        graphChain: action.graphChain,
      })),
      photoEvidence: report.photoEvidence,
      legalReferences: report.legalReferences,
      graphChain: report.graphChain,
      paths: {
        json: report.jsonPath,
        markdown: report.markdownPath,
      },
      markdown: report.markdown,
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.generate_safety_report,
    },
  };
}

async function listSafetyReportsHandler(input: unknown): Promise<McpToolResult> {
  const args = listSafetyReportsSchema.parse(input ?? {});
  const reports = await listSafetyReports(args);
  const filters = [
    args.siteId ? `siteId=${args.siteId}` : "",
    args.period ? `period=${args.period}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const lines: string[] = [];
  lines.push(`# 안전 운영 보고서 ${reports.length}건${filters ? ` (${filters})` : ""}`);
  lines.push("");
  if (reports.length === 0) {
    lines.push("*저장된 SafetyReport 없음.*");
  } else {
    lines.push("| reportId | siteId | period | 기간 | 이슈 | 완료/미완료 |");
    lines.push("|---|---|---|---|---:|---:|");
    for (const report of reports) {
      lines.push(
        `| \`${report.reportId}\` | ${report.siteId ?? "generic"} | ${report.period} | ${report.startDate}~${report.endDate} | ${report.stats.issueCount} | ${report.stats.completedActionCount}/${report.stats.pendingActionCount} |`,
      );
    }
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      count: reports.length,
      filters: args,
      reports,
      reportsDir: getReportsDir(),
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.list_safety_reports,
    },
  };
}

export const SAFETY_REPORT_TOOLS: ToolDefinition[] = [
  {
    name: "generate_safety_report",
    title: "안전 운영 보고서 생성",
    description:
      "기간 내 SafetyIssue 와 CorrectiveAction 로컬 저장 데이터를 합본하여 safety:SafetyReport 운영 보고서를 Markdown 및 구조화 콘텐츠로 생성한다. 19 법정문서와 분리한다.",
    inputSchema: generateSafetyReportSchema,
    handler: generateSafetyReportHandler,
  },
  {
    name: "list_safety_reports",
    title: "안전 운영 보고서 목록",
    description:
      "로컬 reports 디렉토리에 저장된 safety:SafetyReport 목록을 siteId 또는 period 기준으로 조회한다.",
    inputSchema: listSafetyReportsSchema,
    handler: listSafetyReportsHandler,
  },
];
