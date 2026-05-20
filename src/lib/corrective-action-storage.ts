/**
 * corrective-action-storage.ts
 *
 * 개선조치(CorrectiveAction) 로컬 저장소.
 *
 * 저장 위치:
 *   - 기본: ~/.agent-safety-oss/actions/{actionId}.json
 *   - 환경변수 SAFETY_LOCAL_DIR 이 있으면 해당 디렉토리를 루트로 사용
 *
 * Phase C 의 SafetyIssue/PhotoEvidence 저장소가 같은 main 에 합쳐지기 전까지
 * issue/photos 도구 import 없이 파일 시스템을 직접 조회한다.
 */
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  ensureSecureDir as ensureDir,
  writeSecureJson,
  appendSecureLog,
} from "./secure-fs.js";

const DEFAULT_STORAGE_DIRNAME = ".agent-safety-oss";
const ACTIONS_DIRNAME = "actions";
const ISSUES_DIRNAME = "issues";
const PHOTOS_DIRNAME = "photos";
const ACTIVITY_LOG_NAME = "activity.log";
const ACTION_ID_RE = /^action\.[0-9]{8}\.[0-9]{2,}$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const JSON_EXT_RE = /\.(json|jsonld)$/i;
const SAFE_FILE_STEM_RE = /^[A-Za-z0-9._-]+$/;
const ISSUE_DATE_KEYS = [
  "observedAt",
  "occurredAt",
  "reportedAt",
  "createdAt",
  "updatedAt",
  "date",
] as const;
const PHOTO_KEYS = new Set([
  "photo",
  "photos",
  "photoId",
  "photoIds",
  "photoEvidence",
  "photoEvidenceId",
  "photoEvidenceIds",
  "beforePhoto",
  "beforePhotoEvidence",
  "afterPhoto",
  "afterPhotoEvidence",
  "evidencePhoto",
  "evidencePhotos",
]);
const LEGAL_IRI_RE = /^(art|annex|penalty|law|doc:kosha_guide|kosha):/;
const SAFETY_CONTEXT = {
  safety: "https://safety.ratelworks.org/ontology/v1/",
  cc: "https://construction.ratelworks.org/ontology/v1/",
  schema: "https://schema.org/",
  prov: "http://www.w3.org/ns/prov#",
} as const;

export type CorrectiveActionStatus = "requested" | "in_progress" | "resolved";
export type ReferenceStatus = "found" | "pending";

export interface GraphTriple {
  subject: string;
  predicate: string;
  object: string;
}

export interface ActionAssignee {
  name: string;
  organization?: string;
}

export interface SafetyIssueReference {
  issueId: string;
  iri: string;
  referenceStatus: ReferenceStatus;
  siteId?: string;
  severity?: string;
  title?: string;
  status?: string;
  recordedAt?: string;
  photoEvidenceIds: string[];
  legalReferences: string[];
  sourcePath?: string;
}

export interface CorrectiveActionRecord {
  "@context": typeof SAFETY_CONTEXT;
  "@id": string;
  "@type": "safety:CorrectiveAction";
  actionId: string;
  iri: string;
  relatedIssue: string;
  relatedIssueIri: string;
  relatedIssueState: ReferenceStatus;
  action: string;
  assignee: ActionAssignee;
  dueBy: string;
  recommendedMeasure?: string;
  status: CorrectiveActionStatus;
  siteId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completionNote?: string;
  afterActionPhotoEvidence?: string;
  issueSnapshot: SafetyIssueReference;
  graphChain: GraphTriple[];
}

export interface CorrectiveActionWithEvidence extends CorrectiveActionRecord {
  photos: {
    before: string[];
    after: string[];
  };
}

export interface RecordCorrectiveActionInput {
  relatedIssue: string;
  action: string;
  assignee: ActionAssignee;
  dueBy: string;
  recommendedMeasure?: string;
}

export interface CompleteCorrectiveActionInput {
  actionId: string;
  completionNote: string;
  photoEvidence?: string;
}

export interface PendingActionFilter {
  siteId?: string;
  dueWithin?: number;
}

export function getSafetyLocalDir(): string {
  const override = process.env.SAFETY_LOCAL_DIR?.trim();
  return override ? resolve(override) : resolve(homedir(), DEFAULT_STORAGE_DIRNAME);
}

export function getActionsDir(): string {
  return join(getSafetyLocalDir(), ACTIONS_DIRNAME);
}

export function getIssuesDir(): string {
  return join(getSafetyLocalDir(), ISSUES_DIRNAME);
}

export function getPhotosDir(): string {
  return join(getSafetyLocalDir(), PHOTOS_DIRNAME);
}

export function getCorrectiveActionPath(actionId: string): string {
  assertActionId(actionId);
  return join(getActionsDir(), `${actionId}.json`);
}

export function toCorrectiveActionIri(actionId: string): string {
  return `safety:corrective-action/${actionId}`;
}

export function toIssueIri(issueId: string): string {
  if (isCompactOrAbsoluteIri(issueId)) return issueId;
  return `safety:issue/${issueId}`;
}

export function toPhotoEvidenceIri(photoId: string): string {
  if (isCompactOrAbsoluteIri(photoId)) return photoId;
  return `safety:photo/${photoId}`;
}

export async function recordCorrectiveAction(
  input: RecordCorrectiveActionInput,
): Promise<CorrectiveActionRecord> {
  assertDate(input.dueBy, "dueBy");
  const issueSnapshot =
    (await loadSafetyIssueReference(input.relatedIssue)) ??
    makePendingIssueReference(input.relatedIssue);
  const now = new Date().toISOString();
  const actionId = await nextActionId();
  const record: CorrectiveActionRecord = {
    "@context": SAFETY_CONTEXT,
    "@id": toCorrectiveActionIri(actionId),
    "@type": "safety:CorrectiveAction",
    actionId,
    iri: toCorrectiveActionIri(actionId),
    relatedIssue: input.relatedIssue,
    relatedIssueIri: issueSnapshot.iri,
    relatedIssueState: issueSnapshot.referenceStatus,
    action: input.action,
    assignee: input.assignee,
    dueBy: input.dueBy,
    recommendedMeasure: input.recommendedMeasure,
    status: "requested",
    siteId: issueSnapshot.siteId,
    createdAt: now,
    updatedAt: now,
    issueSnapshot,
    graphChain: [],
  };
  record.graphChain = buildCorrectiveActionGraphChain(record);
  await saveCorrectiveAction(record);
  await logActivity({
    type: "corrective_action_recorded",
    actionId,
    relatedIssue: input.relatedIssue,
    relatedIssueState: record.relatedIssueState,
  });
  return record;
}

export async function completeCorrectiveAction(
  input: CompleteCorrectiveActionInput,
): Promise<CorrectiveActionRecord | null> {
  const record = await loadCorrectiveAction(input.actionId);
  if (!record) return null;
  const now = new Date().toISOString();
  const updated: CorrectiveActionRecord = {
    ...record,
    status: "resolved",
    completionNote: input.completionNote,
    afterActionPhotoEvidence: input.photoEvidence ?? record.afterActionPhotoEvidence,
    completedAt: now,
    updatedAt: now,
  };
  updated.graphChain = buildCorrectiveActionGraphChain(updated);
  await saveCorrectiveAction(updated);
  await logActivity({
    type: "corrective_action_completed",
    actionId: updated.actionId,
    photoEvidence: input.photoEvidence,
  });
  return updated;
}

export async function loadCorrectiveAction(
  actionId: string,
): Promise<CorrectiveActionRecord | null> {
  assertActionId(actionId);
  const record = await readJsonFile(getCorrectiveActionPath(actionId));
  if (!record) return null;
  return normalizeCorrectiveActionRecord(record);
}

export async function getCorrectiveActionWithEvidence(
  actionId: string,
): Promise<CorrectiveActionWithEvidence | null> {
  const record = await loadCorrectiveAction(actionId);
  if (!record) return null;
  const issueSnapshot =
    (await loadSafetyIssueReference(record.relatedIssue)) ?? record.issueSnapshot;
  const after = record.afterActionPhotoEvidence ? [record.afterActionPhotoEvidence] : [];
  const withEvidence: CorrectiveActionWithEvidence = {
    ...record,
    relatedIssueIri: issueSnapshot.iri,
    relatedIssueState: issueSnapshot.referenceStatus,
    issueSnapshot,
    photos: {
      before: issueSnapshot.photoEvidenceIds,
      after,
    },
  };
  withEvidence.graphChain = buildCorrectiveActionGraphChain(withEvidence);
  return withEvidence;
}

export async function listCorrectiveActions(): Promise<CorrectiveActionRecord[]> {
  const files = await safeReadDir(getActionsDir());
  const records: CorrectiveActionRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const raw = await readJsonFile(join(getActionsDir(), file));
    if (!raw) continue;
    try {
      records.push(normalizeCorrectiveActionRecord(raw));
    } catch {
      // 손상 파일은 목록 조회를 막지 않는다.
    }
  }
  return records.sort(compareDueThenCreated);
}

export async function listPendingCorrectiveActions(
  filter: PendingActionFilter = {},
): Promise<CorrectiveActionRecord[]> {
  const actions = await listCorrectiveActions();
  const cutoff = filter.dueWithin === undefined ? null : addDays(new Date(), filter.dueWithin);
  return actions
    .filter((action) => action.status === "requested" || action.status === "in_progress")
    .filter((action) => !filter.siteId || actionMatchesSite(action, filter.siteId))
    .filter((action) => !cutoff || dateOnly(action.dueBy) <= dateOnly(cutoff))
    .sort(compareDueThenCreated);
}

export async function loadSafetyIssueReference(
  issueId: string,
): Promise<SafetyIssueReference | null> {
  const byDirectPath = await loadIssueByCandidatePath(issueId);
  if (byDirectPath) return byDirectPath;

  const issues = await listSafetyIssueReferences();
  return issues.find((issue) => issueMatches(issue, issueId)) ?? null;
}

export async function listSafetyIssueReferences(): Promise<SafetyIssueReference[]> {
  const files = await safeReadDir(getIssuesDir());
  const issues: SafetyIssueReference[] = [];
  for (const file of files) {
    if (!JSON_EXT_RE.test(file)) continue;
    const path = join(getIssuesDir(), file);
    const raw = await readJsonFile(path);
    if (!raw) continue;
    issues.push(buildSafetyIssueReference(raw, file.replace(JSON_EXT_RE, ""), path));
  }
  return issues.sort((a, b) => (b.recordedAt ?? "").localeCompare(a.recordedAt ?? ""));
}

export function buildCorrectiveActionGraphChain(
  action: CorrectiveActionRecord,
): GraphTriple[] {
  const chain: GraphTriple[] = [
    {
      subject: action.relatedIssueIri,
      predicate: "safety:requiresAction",
      object: action.iri,
    },
    {
      subject: action.iri,
      predicate: "safety:resolves",
      object: action.relatedIssueIri,
    },
  ];

  if (action.recommendedMeasure) {
    chain.push({
      subject: action.iri,
      predicate: "safety:recommendedMeasure",
      object: action.recommendedMeasure,
    });
  }

  if (action.afterActionPhotoEvidence) {
    chain.push({
      subject: toPhotoEvidenceIri(action.afterActionPhotoEvidence),
      predicate: "safety:evidences",
      object: action.iri,
    });
  }

  return chain;
}

export function makePendingIssueReference(issueId: string): SafetyIssueReference {
  return {
    issueId,
    iri: toIssueIri(issueId),
    referenceStatus: "pending",
    photoEvidenceIds: [],
    legalReferences: [],
  };
}

export function extractPhotoEvidenceIds(value: unknown): string[] {
  const out: string[] = [];
  visitJson(value, (key, node) => {
    if (!key || !PHOTO_KEYS.has(key)) return;
    for (const item of collectStringLeaves(node)) out.push(item);
  });
  return uniqueStrings(out);
}

export function extractLegalReferences(value: unknown): string[] {
  const out: string[] = [];
  visitJson(value, (_key, node) => {
    if (typeof node === "string" && LEGAL_IRI_RE.test(node)) out.push(node);
  });
  return uniqueStrings(out);
}

async function nextActionId(): Promise<string> {
  const prefix = `action.${formatCompactDate(new Date())}.`;
  const actions = await listCorrectiveActions().catch(() => []);
  let maxSeq = 0;
  for (const action of actions) {
    if (!action.actionId.startsWith(prefix)) continue;
    const seq = Number(action.actionId.slice(prefix.length));
    if (Number.isFinite(seq)) maxSeq = Math.max(maxSeq, seq);
  }
  return `${prefix}${String(maxSeq + 1).padStart(2, "0")}`;
}

async function saveCorrectiveAction(record: CorrectiveActionRecord): Promise<void> {
  assertActionId(record.actionId);
  await ensureDir(getActionsDir());
  await writeSecureJson(getCorrectiveActionPath(record.actionId), record);
}

async function loadIssueByCandidatePath(
  issueId: string,
): Promise<SafetyIssueReference | null> {
  const candidates = candidateIssueFilenames(issueId);
  for (const file of candidates) {
    const path = join(getIssuesDir(), file);
    const raw = await readJsonFile(path);
    if (!raw) continue;
    const ref = buildSafetyIssueReference(raw, file.replace(JSON_EXT_RE, ""), path);
    if (issueMatches(ref, issueId)) return ref;
  }
  return null;
}

function candidateIssueFilenames(issueId: string): string[] {
  const stems = new Set<string>();
  if (SAFE_FILE_STEM_RE.test(issueId)) stems.add(issueId);
  stems.add(safeFileStem(issueId));
  const compact = compactIssueId(issueId);
  if (compact && SAFE_FILE_STEM_RE.test(compact)) stems.add(compact);
  const out: string[] = [];
  for (const stem of stems) {
    out.push(`${stem}.json`, `${stem}.jsonld`);
  }
  return out;
}

function normalizeCorrectiveActionRecord(raw: Record<string, unknown>): CorrectiveActionRecord {
  const actionId = readString(raw.actionId);
  if (!actionId) throw new Error("invalid corrective action: actionId missing");
  assertActionId(actionId);
  const relatedIssue = readString(raw.relatedIssue) ?? "";
  const issueSnapshotRaw = raw.issueSnapshot;
  const issueSnapshot = isRecord(issueSnapshotRaw)
    ? normalizeIssueReference(issueSnapshotRaw, relatedIssue)
    : makePendingIssueReference(relatedIssue);
  const iri = readString(raw.iri) ?? readString(raw["@id"]) ?? toCorrectiveActionIri(actionId);
  const relatedIssueIri = readString(raw.relatedIssueIri) ?? issueSnapshot.iri;
  const record: CorrectiveActionRecord = {
    "@context": SAFETY_CONTEXT,
    "@id": iri,
    "@type": "safety:CorrectiveAction",
    actionId,
    iri,
    relatedIssue,
    relatedIssueIri,
    relatedIssueState: readReferenceStatus(raw.relatedIssueState) ?? issueSnapshot.referenceStatus,
    action: readString(raw.action) ?? "",
    assignee: normalizeAssignee(raw.assignee),
    dueBy: readString(raw.dueBy) ?? "",
    recommendedMeasure: readString(raw.recommendedMeasure),
    status: readActionStatus(raw.status) ?? "requested",
    siteId: readString(raw.siteId) ?? issueSnapshot.siteId,
    createdAt: readString(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: readString(raw.updatedAt) ?? new Date().toISOString(),
    completedAt: readString(raw.completedAt),
    completionNote: readString(raw.completionNote),
    afterActionPhotoEvidence: readString(raw.afterActionPhotoEvidence),
    issueSnapshot,
    graphChain: [],
  };
  record.graphChain = buildCorrectiveActionGraphChain(record);
  return record;
}

function buildSafetyIssueReference(
  raw: Record<string, unknown>,
  fallbackIssueId: string,
  sourcePath?: string,
): SafetyIssueReference {
  const issueId =
    readString(raw.issueId) ??
    readString(raw.id) ??
    compactIssueId(readString(raw["@id"]) ?? "") ??
    fallbackIssueId;
  return {
    issueId,
    iri: readString(raw.iri) ?? readString(raw["@id"]) ?? toIssueIri(issueId),
    referenceStatus: "found",
    siteId:
      readString(raw.siteId) ??
      readString(raw.site) ??
      readString(raw.projectId) ??
      readString(raw.project),
    severity: readString(raw.severity) ?? readString(raw.riskLevel),
    title:
      readString(raw.title) ??
      readString(raw.summary) ??
      readString(raw.description) ??
      readString(raw.issue),
    status: readString(raw.status),
    recordedAt: readFirstDate(raw),
    photoEvidenceIds: extractPhotoEvidenceIds(raw),
    legalReferences: extractLegalReferences(raw),
    sourcePath,
  };
}

function normalizeIssueReference(
  raw: Record<string, unknown>,
  fallbackIssueId: string,
): SafetyIssueReference {
  const issueId = readString(raw.issueId) ?? fallbackIssueId;
  return {
    issueId,
    iri: readString(raw.iri) ?? toIssueIri(issueId),
    referenceStatus: readReferenceStatus(raw.referenceStatus) ?? "pending",
    siteId: readString(raw.siteId),
    severity: readString(raw.severity),
    title: readString(raw.title),
    status: readString(raw.status),
    recordedAt: readString(raw.recordedAt),
    photoEvidenceIds: toStringArray(raw.photoEvidenceIds),
    legalReferences: toStringArray(raw.legalReferences),
    sourcePath: readString(raw.sourcePath),
  };
}

function normalizeAssignee(value: unknown): ActionAssignee {
  if (typeof value === "string") return { name: value };
  if (isRecord(value)) {
    return {
      name: readString(value.name) ?? "",
      organization: readString(value.organization),
    };
  }
  return { name: "" };
}

function actionMatchesSite(action: CorrectiveActionRecord, siteId: string): boolean {
  return action.siteId === siteId || action.issueSnapshot.siteId === siteId;
}

function issueMatches(issue: SafetyIssueReference, query: string): boolean {
  const candidates = new Set([
    issue.issueId,
    issue.iri,
    compactIssueId(issue.iri) ?? "",
    toIssueIri(issue.issueId),
  ]);
  return candidates.has(query) || candidates.has(compactIssueId(query) ?? "");
}

function readFirstDate(raw: Record<string, unknown>): string | undefined {
  for (const key of ISSUE_DATE_KEYS) {
    const value = readString(raw[key]);
    if (value) return value;
  }
  return undefined;
}

function compareDueThenCreated(a: CorrectiveActionRecord, b: CorrectiveActionRecord): number {
  const dueCompare = a.dueBy.localeCompare(b.dueBy);
  if (dueCompare !== 0) return dueCompare;
  return a.createdAt.localeCompare(b.createdAt);
}

function addDays(base: Date, days: number): Date {
  const out = new Date(base);
  out.setDate(out.getDate() + days);
  return out;
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function formatCompactDate(date: Date): string {
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
}

function assertActionId(actionId: string): void {
  if (!ACTION_ID_RE.test(actionId)) throw new Error(`invalid actionId: ${actionId}`);
}

function assertDate(value: string, fieldName: string): void {
  if (!DATE_RE.test(value)) throw new Error(`${fieldName} must be xsd:date (YYYY-MM-DD)`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${fieldName} is invalid: ${value}`);
}

async function safeReadDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
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

function readActionStatus(value: unknown): CorrectiveActionStatus | undefined {
  if (value === "requested" || value === "in_progress" || value === "resolved") return value;
  return undefined;
}

function readReferenceStatus(value: unknown): ReferenceStatus | undefined {
  if (value === "found" || value === "pending") return value;
  return undefined;
}

function toStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function collectStringLeaves(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStringLeaves(item));
  if (isRecord(value)) return Object.values(value).flatMap((item) => collectStringLeaves(item));
  return [];
}

function visitJson(
  value: unknown,
  visitor: (key: string | undefined, node: unknown) => void,
  key?: string,
): void {
  visitor(key, value);
  if (Array.isArray(value)) {
    for (const item of value) visitJson(item, visitor);
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, childValue] of Object.entries(value)) {
    visitJson(childValue, visitor, childKey);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isCompactOrAbsoluteIri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function compactIssueId(value: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("safety:issue/")) return value.slice("safety:issue/".length);
  if (value.startsWith("issue:")) return value.slice("issue:".length);
  return undefined;
}

function safeFileStem(value: string): string {
  const stem = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
  return stem || "item";
}
