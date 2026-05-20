/**
 * safety-issue-storage.ts
 *
 * 현장 안전 이슈 로컬 저장소.
 * 기본 위치는 ~/.agent-safety-oss/issues 이며 SAFETY_LOCAL_DIR 로 루트 변경 가능.
 */
import { readFile, readdir } from "node:fs/promises";
import { ensureSecureDir, writeSecureJson } from "./secure-fs.js";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const STORAGE_ENV_NAME = "SAFETY_LOCAL_DIR";
const DEFAULT_STORAGE_ROOT = resolve(homedir(), ".agent-safety-oss");
const ISSUE_ID_PREFIX = "issue:";
const ACTION_ID_PREFIX = "action:";
const ISSUE_IRI_PREFIX = "safety:safety_issue/";
const ACTION_IRI_PREFIX = "safety:corrective_action/";
const ISSUE_CONTEXT = {
  safety: "https://safety.ratelworks.org/ontology/v1/",
  cc: "https://construction.ratelworks.org/ontology/v1/",
  prov: "http://www.w3.org/ns/prov#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
} as const;

export type SafetyIssueSeverity = "low" | "medium" | "high" | "critical";
export type SafetyIssueStatus = "open" | "in_progress" | "resolved" | "verified";

export interface RecommendedMeasure {
  iri: string;
  label: string;
  description?: string;
  ericLevel?: number;
  ericLevelLabel?: string;
  chain: Array<Record<string, unknown>>;
  inference: Record<string, unknown>;
  alternatives?: Array<{
    iri: string;
    label: string;
    ericLevel?: number;
    ericLevelLabel?: string;
  }>;
}

export interface CorrectiveActionRecord {
  actionId: string;
  iri: string;
  label: string;
  status: SafetyIssueStatus;
  createdAt: string;
  updatedAt: string;
  resolves: string;
}

export interface SafetyIssueStatusEvent {
  at: string;
  status: SafetyIssueStatus;
  note: string;
}

export interface SafetyIssueRecord {
  "@context": typeof ISSUE_CONTEXT;
  "@id": string;
  "@type": ["safety:SafetyIssue", "prov:Entity"];
  issueId: string;
  label: string;
  description: string;
  relatedTask: string;
  relatedRisk: string;
  relatedSite?: string;
  severity: SafetyIssueSeverity;
  status: SafetyIssueStatus;
  photoEvidence: string[];
  recommendedMeasure?: RecommendedMeasure;
  correctiveAction: CorrectiveActionRecord;
  statusHistory: SafetyIssueStatusEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface RegisterSafetyIssueInput {
  relatedTask: string;
  relatedRisk: string;
  relatedSite?: string;
  severity: SafetyIssueSeverity;
  description: string;
  photoEvidence?: string[];
  recommendedMeasure?: RecommendedMeasure;
}

export interface ListSafetyIssueFilter {
  siteId?: string;
  severity?: SafetyIssueSeverity;
  openOnly?: boolean;
  photoEvidence?: string;
}

export function getSafetyIssueStorageRoot(): string {
  return resolve(process.env[STORAGE_ENV_NAME] || DEFAULT_STORAGE_ROOT);
}

export function getSafetyIssueStorageDir(): string {
  return join(getSafetyIssueStorageRoot(), "issues");
}

export function toSafetyIssueIri(issueId: string): string {
  const normalized = normalizeIssueId(issueId);
  return `${ISSUE_IRI_PREFIX}${localIssueSlug(normalized)}`;
}

export function toCorrectiveActionIri(actionId: string): string {
  const normalized = normalizeActionId(actionId);
  return `${ACTION_IRI_PREFIX}${localActionSlug(normalized)}`;
}

export function normalizeIssueId(issueIdOrIri: string): string {
  const trimmed = issueIdOrIri.trim();
  if (trimmed.startsWith(ISSUE_IRI_PREFIX)) {
    return `${ISSUE_ID_PREFIX}${trimmed.slice(ISSUE_IRI_PREFIX.length)}`;
  }
  if (trimmed.startsWith(ISSUE_ID_PREFIX)) return trimmed;
  return `${ISSUE_ID_PREFIX}${trimmed}`;
}

export function normalizeActionId(actionIdOrIri: string): string {
  const trimmed = actionIdOrIri.trim();
  if (trimmed.startsWith(ACTION_IRI_PREFIX)) {
    return `${ACTION_ID_PREFIX}${trimmed.slice(ACTION_IRI_PREFIX.length)}`;
  }
  if (trimmed.startsWith(ACTION_ID_PREFIX)) return trimmed;
  return `${ACTION_ID_PREFIX}${trimmed}`;
}

export async function saveSafetyIssue(input: RegisterSafetyIssueInput): Promise<SafetyIssueRecord> {
  await ensureIssueDir();

  const now = new Date().toISOString();
  const hash = createHash("sha256")
    .update([input.relatedTask, input.relatedRisk, input.severity, input.description, now].join("|"))
    .digest("hex");
  const issueId = makeIssueId(now, hash);
  const actionId = makeActionId(now, hash);
  const issueIri = toSafetyIssueIri(issueId);
  const record: SafetyIssueRecord = {
    "@context": ISSUE_CONTEXT,
    "@id": issueIri,
    "@type": ["safety:SafetyIssue", "prov:Entity"],
    issueId,
    label: makeIssueLabel(input.severity, input.description),
    description: input.description,
    relatedTask: input.relatedTask,
    relatedRisk: input.relatedRisk,
    relatedSite: input.relatedSite,
    severity: input.severity,
    status: "open",
    photoEvidence: input.photoEvidence ?? [],
    recommendedMeasure: input.recommendedMeasure,
    correctiveAction: {
      actionId,
      iri: toCorrectiveActionIri(actionId),
      label: makeActionLabel(input.recommendedMeasure),
      status: "open",
      createdAt: now,
      updatedAt: now,
      resolves: issueIri,
    },
    statusHistory: [{ at: now, status: "open", note: "이슈 등록" }],
    createdAt: now,
    updatedAt: now,
  };

  await writeIssueRecord(record);
  return record;
}

export async function loadSafetyIssue(issueIdOrIri: string): Promise<SafetyIssueRecord | null> {
  try {
    const text = await readFile(issueRecordPath(issueIdOrIri), "utf8");
    return JSON.parse(text) as SafetyIssueRecord;
  } catch {
    return null;
  }
}

export async function listSafetyIssues(filter: ListSafetyIssueFilter = {}): Promise<SafetyIssueRecord[]> {
  await ensureIssueDir();
  const files = await readdir(getSafetyIssueStorageDir());
  const records: SafetyIssueRecord[] = [];

  for (const filename of files) {
    if (!filename.endsWith(".jsonld")) continue;
    try {
      const text = await readFile(join(getSafetyIssueStorageDir(), filename), "utf8");
      const record = JSON.parse(text) as SafetyIssueRecord;
      if (!matchesIssueFilter(record, filter)) continue;
      records.push(record);
    } catch {
      // 손상된 이슈 메타는 목록에서 제외한다.
    }
  }

  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listSafetyIssuesByPhotoEvidence(photoId: string): Promise<SafetyIssueRecord[]> {
  return listSafetyIssues({ photoEvidence: photoId });
}

export async function updateSafetyIssueStatus(
  issueIdOrIri: string,
  status: SafetyIssueStatus,
  note: string,
): Promise<SafetyIssueRecord | null> {
  const record = await loadSafetyIssue(issueIdOrIri);
  if (!record) return null;

  const now = new Date().toISOString();
  record.status = status;
  record.updatedAt = now;
  record.correctiveAction.status = status;
  record.correctiveAction.updatedAt = now;
  record.statusHistory.push({ at: now, status, note });
  await writeIssueRecord(record);
  return record;
}

async function writeIssueRecord(record: SafetyIssueRecord): Promise<void> {
  await ensureIssueDir();
  await writeSecureJson(issueRecordPath(record.issueId), record);
}

async function ensureIssueDir(): Promise<void> {
  await ensureSecureDir(getSafetyIssueStorageDir());
}

function issueRecordPath(issueIdOrIri: string): string {
  return join(getSafetyIssueStorageDir(), `${safeIssueFilename(issueIdOrIri)}.jsonld`);
}

function matchesIssueFilter(record: SafetyIssueRecord, filter: ListSafetyIssueFilter): boolean {
  if (filter.openOnly && !["open", "in_progress"].includes(record.status)) return false;
  if (filter.siteId && record.relatedSite !== filter.siteId) return false;
  if (filter.severity && record.severity !== filter.severity) return false;
  if (filter.photoEvidence && !record.photoEvidence.includes(filter.photoEvidence)) return false;
  return true;
}

function makeIssueId(createdAt: string, hash: string): string {
  const stamp = createdAt.replace(/[^0-9]/g, "").slice(0, 14).padEnd(14, "0");
  return `${ISSUE_ID_PREFIX}${stamp}-${hash.slice(0, 10)}`;
}

function makeActionId(createdAt: string, hash: string): string {
  const stamp = createdAt.replace(/[^0-9]/g, "").slice(0, 14).padEnd(14, "0");
  return `${ACTION_ID_PREFIX}${stamp}-${hash.slice(10, 20)}`;
}

function makeIssueLabel(severity: SafetyIssueSeverity, description: string): string {
  const summary = description.replace(/\s+/g, " ").trim().slice(0, 40);
  return `안전 이슈(${severity}) - ${summary}`;
}

function makeActionLabel(measure: RecommendedMeasure | undefined): string {
  return measure ? `${measure.label} 개선조치` : "안전 이슈 개선조치";
}

function safeIssueFilename(issueIdOrIri: string): string {
  return basename(localIssueSlug(normalizeIssueId(issueIdOrIri))).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function localIssueSlug(issueId: string): string {
  return issueId.startsWith(ISSUE_ID_PREFIX) ? issueId.slice(ISSUE_ID_PREFIX.length) : issueId;
}

function localActionSlug(actionId: string): string {
  return actionId.startsWith(ACTION_ID_PREFIX) ? actionId.slice(ACTION_ID_PREFIX.length) : actionId;
}
