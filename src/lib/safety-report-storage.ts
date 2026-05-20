/**
 * safety-report-storage.ts
 *
 * SafetyReport 운영 보고서 로컬 저장소.
 *
 * SafetyReport 는 19 법정문서와 분리된 사내 운영 합본이다.
 * 이슈·조치·사진·법조 사슬을 모아 reports/{reportId}.json 및 .md 로 저장한다.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ensureSecureDir as ensureDir,
  writeSecureJson,
  writeSecureText,
  appendSecureLog,
} from "./secure-fs.js";
import {
  type CorrectiveActionRecord,
  type GraphTriple,
  type SafetyIssueReference,
  getSafetyLocalDir,
  listCorrectiveActions,
  listSafetyIssueReferences,
  toPhotoEvidenceIri,
} from "./corrective-action-storage.js";

const REPORTS_DIRNAME = "reports";
const ACTIVITY_LOG_NAME = "activity.log";
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const REPORT_CONTEXT = {
  safety: "https://safety.ratelworks.org/ontology/v1/",
  cc: "https://construction.ratelworks.org/ontology/v1/",
  schema: "https://schema.org/",
  prov: "http://www.w3.org/ns/prov#",
} as const;
const OPERATIONAL_REPORT_NOTE =
  "본 보고서는 사내 운영용. 정부 제출용은 19 법정문서 참조";

export type SafetyReportPeriod = "weekly" | "monthly";

export interface GenerateSafetyReportInput {
  siteId?: string;
  period: SafetyReportPeriod;
  startDate: string;
  endDate: string;
}

export interface SafetyReportStats {
  issueCount: number;
  issuesBySeverity: Record<string, number>;
  actionCount: number;
  completedActionCount: number;
  pendingActionCount: number;
  photoCount: number;
  legalReferenceCount: number;
}

export interface SafetyReportRecord {
  "@context": typeof REPORT_CONTEXT;
  "@id": string;
  "@type": "safety:SafetyReport";
  reportId: string;
  iri: string;
  siteId?: string;
  period: SafetyReportPeriod;
  startDate: string;
  endDate: string;
  generatedAt: string;
  note: string;
  markdown: string;
  stats: SafetyReportStats;
  issues: SafetyIssueReference[];
  actions: CorrectiveActionRecord[];
  photoEvidence: string[];
  legalReferences: string[];
  graphChain: GraphTriple[];
  jsonPath: string;
  markdownPath: string;
}

export interface SafetyReportSummary {
  reportId: string;
  iri: string;
  siteId?: string;
  period: SafetyReportPeriod;
  startDate: string;
  endDate: string;
  generatedAt: string;
  stats: SafetyReportStats;
  jsonPath: string;
  markdownPath: string;
}

export interface ListSafetyReportsFilter {
  siteId?: string;
  period?: SafetyReportPeriod;
}

export function getReportsDir(): string {
  return join(getSafetyLocalDir(), REPORTS_DIRNAME);
}

export function toSafetyReportIri(reportId: string): string {
  return `safety:report/${reportId}`;
}

export async function generateSafetyReport(
  input: GenerateSafetyReportInput,
): Promise<SafetyReportRecord> {
  assertDateRange(input.startDate, input.endDate);
  const issues = await collectIssues(input);
  const actions = await collectActions(input, issues);
  const photoEvidence = collectReportPhotos(issues, actions);
  const legalReferences = collectReportLegalReferences(issues);
  const stats = buildStats(issues, actions, photoEvidence, legalReferences);
  const reportId = makeReportId(input);
  const iri = toSafetyReportIri(reportId);
  const graphChain = buildReportGraphChain(iri, issues, actions, photoEvidence, legalReferences);
  const markdown = renderReportMarkdown({
    reportId,
    iri,
    input,
    issues,
    actions,
    photoEvidence,
    legalReferences,
    stats,
  });
  const jsonPath = reportJsonPath(reportId);
  const markdownPath = reportMarkdownPath(reportId);
  const report: SafetyReportRecord = {
    "@context": REPORT_CONTEXT,
    "@id": iri,
    "@type": "safety:SafetyReport",
    reportId,
    iri,
    siteId: input.siteId,
    period: input.period,
    startDate: input.startDate,
    endDate: input.endDate,
    generatedAt: new Date().toISOString(),
    note: OPERATIONAL_REPORT_NOTE,
    markdown,
    stats,
    issues,
    actions,
    photoEvidence,
    legalReferences,
    graphChain,
    jsonPath,
    markdownPath,
  };
  await saveSafetyReport(report);
  await logActivity({
    type: "safety_report_generated",
    reportId,
    siteId: input.siteId,
    period: input.period,
    issueCount: stats.issueCount,
    actionCount: stats.actionCount,
  });
  return report;
}

export async function listSafetyReports(
  filter: ListSafetyReportsFilter = {},
): Promise<SafetyReportSummary[]> {
  const files = await safeReadDir(getReportsDir());
  const reports: SafetyReportSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const raw = await readReportJson(join(getReportsDir(), file));
    if (!raw) continue;
    const summary = summarizeReport(raw);
    if (!summary) continue;
    if (filter.siteId && summary.siteId !== filter.siteId) continue;
    if (filter.period && summary.period !== filter.period) continue;
    reports.push(summary);
  }
  return reports.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

async function collectIssues(input: GenerateSafetyReportInput): Promise<SafetyIssueReference[]> {
  const allIssues = await listSafetyIssueReferences();
  return allIssues.filter((issue) => {
    if (input.siteId && issue.siteId !== input.siteId) return false;
    return isWithinRange(issue.recordedAt, input.startDate, input.endDate);
  });
}

async function collectActions(
  input: GenerateSafetyReportInput,
  issues: SafetyIssueReference[],
): Promise<CorrectiveActionRecord[]> {
  const issueIds = new Set(issues.flatMap((issue) => [issue.issueId, issue.iri]));
  const allActions = await listCorrectiveActions();
  return allActions.filter((action) => {
    if (input.siteId && action.siteId !== input.siteId && action.issueSnapshot.siteId !== input.siteId) {
      return false;
    }
    return actionTouchesRange(action, input.startDate, input.endDate) || issueIds.has(action.relatedIssue);
  });
}

function actionTouchesRange(
  action: CorrectiveActionRecord,
  startDate: string,
  endDate: string,
): boolean {
  return [action.createdAt, action.updatedAt, action.completedAt, action.dueBy].some((date) =>
    isWithinRange(date, startDate, endDate),
  );
}

function collectReportPhotos(
  issues: SafetyIssueReference[],
  actions: CorrectiveActionRecord[],
): string[] {
  const photos = [
    ...issues.flatMap((issue) => issue.photoEvidenceIds),
    ...actions.flatMap((action) => action.issueSnapshot.photoEvidenceIds),
    ...actions
      .map((action) => action.afterActionPhotoEvidence)
      .filter((photo): photo is string => Boolean(photo)),
  ];
  return uniqueStrings(photos);
}

function collectReportLegalReferences(issues: SafetyIssueReference[]): string[] {
  return uniqueStrings(issues.flatMap((issue) => issue.legalReferences));
}

function buildStats(
  issues: SafetyIssueReference[],
  actions: CorrectiveActionRecord[],
  photos: string[],
  legalReferences: string[],
): SafetyReportStats {
  const issuesBySeverity: Record<string, number> = {};
  for (const issue of issues) {
    const severity = issue.severity ?? "unknown";
    issuesBySeverity[severity] = (issuesBySeverity[severity] ?? 0) + 1;
  }
  const completedActionCount = actions.filter((action) => action.status === "resolved").length;
  return {
    issueCount: issues.length,
    issuesBySeverity,
    actionCount: actions.length,
    completedActionCount,
    pendingActionCount: actions.length - completedActionCount,
    photoCount: photos.length,
    legalReferenceCount: legalReferences.length,
  };
}

function buildReportGraphChain(
  reportIri: string,
  issues: SafetyIssueReference[],
  actions: CorrectiveActionRecord[],
  photos: string[],
  legalReferences: string[],
): GraphTriple[] {
  const chain: GraphTriple[] = [];
  for (const issue of issues) {
    chain.push({ subject: reportIri, predicate: "safety:includes", object: issue.iri });
    for (const photo of issue.photoEvidenceIds) {
      chain.push({ subject: toPhotoEvidenceIri(photo), predicate: "safety:evidences", object: issue.iri });
    }
    for (const ref of issue.legalReferences) {
      chain.push({ subject: issue.iri, predicate: "safety:legalBasis", object: ref });
    }
  }
  for (const action of actions) {
    chain.push({ subject: reportIri, predicate: "safety:includesAction", object: action.iri });
    chain.push(...action.graphChain);
  }
  for (const photo of photos) {
    chain.push({ subject: reportIri, predicate: "safety:hasPhotoEvidence", object: toPhotoEvidenceIri(photo) });
  }
  for (const ref of legalReferences) {
    chain.push({ subject: reportIri, predicate: "safety:cites", object: ref });
  }
  return dedupeTriples(chain);
}

function renderReportMarkdown(input: {
  reportId: string;
  iri: string;
  input: GenerateSafetyReportInput;
  issues: SafetyIssueReference[];
  actions: CorrectiveActionRecord[];
  photoEvidence: string[];
  legalReferences: string[];
  stats: SafetyReportStats;
}): string {
  const lines: string[] = [];
  lines.push("# 안전관리 운영 보고서");
  lines.push("");
  lines.push(`- reportId: \`${input.reportId}\``);
  lines.push(`- IRI: \`${input.iri}\``);
  lines.push(`- 기간: ${input.input.startDate} ~ ${input.input.endDate} (${input.input.period})`);
  lines.push(`- 현장: ${input.input.siteId ?? "generic"}`);
  lines.push(`- 구분: ${OPERATIONAL_REPORT_NOTE}`);
  lines.push("");
  lines.push("## 통계");
  lines.push("");
  lines.push("| 항목 | 건수 |");
  lines.push("|---|---:|");
  lines.push(`| 이슈 | ${input.stats.issueCount} |`);
  lines.push(`| 조치 전체 | ${input.stats.actionCount} |`);
  lines.push(`| 조치 완료 | ${input.stats.completedActionCount} |`);
  lines.push(`| 조치 미완료 | ${input.stats.pendingActionCount} |`);
  lines.push(`| 사진 증빙 | ${input.stats.photoCount} |`);
  lines.push(`| 법조 인용 | ${input.stats.legalReferenceCount} |`);
  lines.push("");
  lines.push("## severity별 이슈");
  lines.push("");
  if (Object.keys(input.stats.issuesBySeverity).length === 0) {
    lines.push("*해당 기간 저장된 SafetyIssue 없음.*");
  } else {
    lines.push("| severity | 건수 |");
    lines.push("|---|---:|");
    for (const [severity, count] of Object.entries(input.stats.issuesBySeverity).sort()) {
      lines.push(`| ${severity} | ${count} |`);
    }
  }
  lines.push("");
  lines.push("## 이슈");
  lines.push("");
  if (input.issues.length === 0) {
    lines.push("*해당 기간 이슈 없음.*");
  } else {
    lines.push("| issueId | severity | 제목 | 사진 | 법조 |");
    lines.push("|---|---|---|---:|---:|");
    for (const issue of input.issues) {
      lines.push(
        `| \`${issue.issueId}\` | ${issue.severity ?? "unknown"} | ${escapeTable(issue.title ?? "")} | ${issue.photoEvidenceIds.length} | ${issue.legalReferences.length} |`,
      );
    }
  }
  lines.push("");
  lines.push("## 개선조치");
  lines.push("");
  if (input.actions.length === 0) {
    lines.push("*해당 기간 개선조치 없음.*");
  } else {
    lines.push("| actionId | 관련 이슈 | 상태 | 담당 | 만기 | 완료일 |");
    lines.push("|---|---|---|---|---|---|");
    for (const action of input.actions) {
      lines.push(
        `| \`${action.actionId}\` | \`${action.relatedIssue}\` | ${action.status} | ${escapeTable(formatAssignee(action))} | ${action.dueBy} | ${action.completedAt ?? ""} |`,
      );
    }
  }
  lines.push("");
  lines.push("## 사진 증빙");
  lines.push("");
  if (input.photoEvidence.length === 0) {
    lines.push("*연결된 PhotoEvidence 없음.*");
  } else {
    for (const photo of input.photoEvidence) lines.push(`- \`${photo}\``);
  }
  lines.push("");
  lines.push("## 법조 인용");
  lines.push("");
  if (input.legalReferences.length === 0) {
    lines.push("*연결된 법조 인용 없음.*");
  } else {
    for (const ref of input.legalReferences) lines.push(`- \`${ref}\``);
  }
  lines.push("");
  lines.push(`> ${OPERATIONAL_REPORT_NOTE}`);
  lines.push("");
  return lines.join("\n");
}

async function saveSafetyReport(report: SafetyReportRecord): Promise<void> {
  await ensureDir(getReportsDir());
  await writeSecureJson(report.jsonPath, report);
  await writeSecureText(report.markdownPath, report.markdown);
}

function summarizeReport(raw: Record<string, unknown>): SafetyReportSummary | null {
  const reportId = readString(raw.reportId);
  const period = readPeriod(raw.period);
  const statsRaw = raw.stats;
  if (!reportId || !period || !isRecord(statsRaw)) return null;
  const summary: SafetyReportSummary = {
    reportId,
    iri: readString(raw.iri) ?? toSafetyReportIri(reportId),
    siteId: readString(raw.siteId),
    period,
    startDate: readString(raw.startDate) ?? "",
    endDate: readString(raw.endDate) ?? "",
    generatedAt: readString(raw.generatedAt) ?? "",
    stats: normalizeStats(statsRaw),
    jsonPath: reportJsonPath(reportId),
    markdownPath: reportMarkdownPath(reportId),
  };
  return summary;
}

function normalizeStats(raw: Record<string, unknown>): SafetyReportStats {
  return {
    issueCount: readNumber(raw.issueCount),
    issuesBySeverity: readNumberRecord(raw.issuesBySeverity),
    actionCount: readNumber(raw.actionCount),
    completedActionCount: readNumber(raw.completedActionCount),
    pendingActionCount: readNumber(raw.pendingActionCount),
    photoCount: readNumber(raw.photoCount),
    legalReferenceCount: readNumber(raw.legalReferenceCount),
  };
}

function makeReportId(input: GenerateSafetyReportInput): string {
  const month = input.startDate.slice(0, 7);
  const siteSegment = input.siteId ? safeIdSegment(input.siteId) : "generic";
  return `report.${month}.${siteSegment}`;
}

function reportJsonPath(reportId: string): string {
  return join(getReportsDir(), `${reportId}.json`);
}

function reportMarkdownPath(reportId: string): string {
  return join(getReportsDir(), `${reportId}.md`);
}

function assertDateRange(startDate: string, endDate: string): void {
  if (!DATE_RE.test(startDate)) throw new Error("startDate must be xsd:date (YYYY-MM-DD)");
  if (!DATE_RE.test(endDate)) throw new Error("endDate must be xsd:date (YYYY-MM-DD)");
  if (startDate > endDate) throw new Error("startDate must be before or equal to endDate");
}

function isWithinRange(value: string | undefined, startDate: string, endDate: string): boolean {
  if (!value) return false;
  const day = value.slice(0, 10);
  return DATE_RE.test(day) && startDate <= day && day <= endDate;
}

function formatAssignee(action: CorrectiveActionRecord): string {
  return action.assignee.organization
    ? `${action.assignee.name} (${action.assignee.organization})`
    : action.assignee.name;
}

function escapeTable(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function dedupeTriples(triples: GraphTriple[]): GraphTriple[] {
  const seen = new Set<string>();
  const out: GraphTriple[] = [];
  for (const triple of triples) {
    const key = `${triple.subject}\u0000${triple.predicate}\u0000${triple.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(triple);
  }
  return out;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safeIdSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
  return segment || "site";
}

async function safeReadDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function readReportJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const txt = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(txt);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function logActivity(event: Record<string, unknown>): Promise<void> {
  try {
    await ensureDir(getSafetyLocalDir());
    const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n";
    await appendSecureLog(join(getSafetyLocalDir(), ACTIVITY_LOG_NAME), line);
  } catch {
    // audit trail 실패는 본 작업을 막지 않는다.
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) out[key] = item;
  }
  return out;
}

function readPeriod(value: unknown): SafetyReportPeriod | undefined {
  if (value === "weekly" || value === "monthly") return value;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
