/**
 * photo-storage.ts
 *
 * 현장사진 증빙 로컬 저장소.
 * 기본 위치는 ~/.agent-safety-oss/photos 이며 SAFETY_LOCAL_DIR 로 루트 변경 가능.
 */
import { copyFile, readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureSecureDir, writeSecureJson, chmodSecureFile } from "./secure-fs.js";

const STORAGE_ENV_NAME = "SAFETY_LOCAL_DIR";
const DEFAULT_STORAGE_ROOT = resolve(homedir(), ".agent-safety-oss");
const PHOTO_ID_PREFIX = "photo:";
const PHOTO_IRI_PREFIX = "safety:photo_evidence/";
const PHOTO_CONTEXT = {
  safety: "https://safety.ratelworks.org/ontology/v1/",
  cc: "https://construction.ratelworks.org/ontology/v1/",
  prov: "http://www.w3.org/ns/prov#",
  foaf: "http://xmlns.com/foaf/0.1/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
} as const;

export type PhotoEvidenceType = "before_action" | "after_action" | "inspection";

export interface PhotoEvidenceRecord {
  "@context": typeof PHOTO_CONTEXT;
  "@id": string;
  "@type": ["safety:PhotoEvidence", "prov:Entity", "foaf:Image"];
  photoId: string;
  label: string;
  fileUri: string;
  originalFilePath?: string;
  storagePath?: string;
  byteSize?: number;
  sha256?: string;
  relatedTask: string;
  relatedSite?: string;
  relatedRisk?: string;
  evidenceType: PhotoEvidenceType;
  capturedAt: string;
  createdAt: string;
  evidences: string[];
}

export interface SavePhotoEvidenceInput {
  filePath?: string;
  fileUri?: string;
  relatedTask: string;
  relatedSite?: string;
  relatedRisk?: string;
  evidenceType: PhotoEvidenceType;
  capturedAt: string;
}

export interface ListPhotoEvidenceFilter {
  siteId?: string;
  since?: string;
  activityId?: string;
}

export function getSafetyStorageRoot(): string {
  return resolve(process.env[STORAGE_ENV_NAME] || DEFAULT_STORAGE_ROOT);
}

export function getPhotoStorageDir(): string {
  return join(getSafetyStorageRoot(), "photos");
}

export function toPhotoIri(photoId: string): string {
  const normalized = normalizePhotoId(photoId);
  return `${PHOTO_IRI_PREFIX}${localPhotoSlug(normalized)}`;
}

export function normalizePhotoId(photoIdOrIri: string): string {
  const trimmed = photoIdOrIri.trim();
  if (trimmed.startsWith(PHOTO_IRI_PREFIX)) {
    return `${PHOTO_ID_PREFIX}${trimmed.slice(PHOTO_IRI_PREFIX.length)}`;
  }
  if (trimmed.startsWith(PHOTO_ID_PREFIX)) return trimmed;
  return `${PHOTO_ID_PREFIX}${trimmed}`;
}

export async function savePhotoEvidence(input: SavePhotoEvidenceInput): Promise<PhotoEvidenceRecord> {
  await ensurePhotoDir();

  const prepared = await preparePhotoFile(input);
  const photoId = makePhotoId(input.capturedAt, prepared.hashSeed);
  const now = new Date().toISOString();
  const record: PhotoEvidenceRecord = {
    "@context": PHOTO_CONTEXT,
    "@id": toPhotoIri(photoId),
    "@type": ["safety:PhotoEvidence", "prov:Entity", "foaf:Image"],
    photoId,
    label: makePhotoLabel(input.evidenceType, input.relatedTask, input.capturedAt),
    fileUri: prepared.fileUri,
    originalFilePath: prepared.originalFilePath,
    storagePath: prepared.storagePath,
    byteSize: prepared.byteSize,
    sha256: prepared.sha256,
    relatedTask: input.relatedTask,
    relatedSite: input.relatedSite,
    relatedRisk: input.relatedRisk,
    evidenceType: input.evidenceType,
    capturedAt: input.capturedAt,
    createdAt: now,
    evidences: [],
  };

  await writePhotoRecord(record);
  return record;
}

export async function loadPhotoEvidence(photoIdOrIri: string): Promise<PhotoEvidenceRecord | null> {
  try {
    const text = await readFile(photoRecordPath(photoIdOrIri), "utf8");
    return JSON.parse(text) as PhotoEvidenceRecord;
  } catch {
    return null;
  }
}

export async function listPhotoEvidence(filter: ListPhotoEvidenceFilter = {}): Promise<PhotoEvidenceRecord[]> {
  await ensurePhotoDir();
  const files = await readdir(getPhotoStorageDir());
  const records: PhotoEvidenceRecord[] = [];

  for (const filename of files) {
    if (!filename.endsWith(".jsonld")) continue;
    try {
      const text = await readFile(join(getPhotoStorageDir(), filename), "utf8");
      const record = JSON.parse(text) as PhotoEvidenceRecord;
      if (!matchesPhotoFilter(record, filter)) continue;
      records.push(record);
    } catch {
      // 손상된 사진 메타는 목록에서 제외한다.
    }
  }

  return records.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export async function appendPhotoEvidenceIssue(photoIdOrIri: string, issueId: string): Promise<PhotoEvidenceRecord | null> {
  const record = await loadPhotoEvidence(photoIdOrIri);
  if (!record) return null;
  if (!record.evidences.includes(issueId)) {
    record.evidences.push(issueId);
    await writePhotoRecord(record);
  }
  return record;
}

async function preparePhotoFile(input: SavePhotoEvidenceInput): Promise<{
  fileUri: string;
  originalFilePath?: string;
  storagePath?: string;
  byteSize?: number;
  sha256?: string;
  hashSeed: string;
}> {
  if (input.filePath) {
    const sourcePath = resolve(input.filePath);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) throw new Error(`사진 파일이 아닙니다: ${sourcePath}`);

    const buffer = await readFile(sourcePath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const tempPhotoId = makePhotoId(input.capturedAt, sha256);
    const extension = extname(sourcePath) || ".bin";
    const storagePath = join(getPhotoStorageDir(), `${safeFilename(tempPhotoId)}${extension}`);
    await copyFile(sourcePath, storagePath);
    // copyFile 은 source mode 보존하므로 사후 chmod 로 0o600 강제 (사진 binary PII 보호).
    await chmodSecureFile(storagePath);

    return {
      fileUri: pathToFileURL(storagePath).href,
      originalFilePath: sourcePath,
      storagePath,
      byteSize: sourceStat.size,
      sha256,
      hashSeed: sha256,
    };
  }

  if (!input.fileUri) throw new Error("filePath 또는 fileUri 중 하나는 필요합니다.");
  return {
    fileUri: input.fileUri,
    hashSeed: createHash("sha256").update(input.fileUri).digest("hex"),
  };
}

async function writePhotoRecord(record: PhotoEvidenceRecord): Promise<void> {
  await ensurePhotoDir();
  await writeSecureJson(photoRecordPath(record.photoId), record);
}

async function ensurePhotoDir(): Promise<void> {
  await ensureSecureDir(getPhotoStorageDir());
}

function photoRecordPath(photoIdOrIri: string): string {
  return join(getPhotoStorageDir(), `${safeFilename(photoIdOrIri)}.jsonld`);
}

function matchesPhotoFilter(record: PhotoEvidenceRecord, filter: ListPhotoEvidenceFilter): boolean {
  if (filter.siteId && record.relatedSite !== filter.siteId) return false;
  if (filter.activityId && record.relatedTask !== filter.activityId) return false;
  if (filter.since && record.capturedAt < filter.since && record.createdAt < filter.since) return false;
  return true;
}

function makePhotoId(capturedAt: string, hashSeed: string): string {
  const stamp = capturedAt
    .replace(/[^0-9]/g, "")
    .slice(0, 14)
    .padEnd(14, "0");
  return `${PHOTO_ID_PREFIX}${stamp}-${hashSeed.slice(0, 10)}`;
}

function makePhotoLabel(evidenceType: PhotoEvidenceType, relatedTask: string, capturedAt: string): string {
  const typeLabel: Record<PhotoEvidenceType, string> = {
    before_action: "조치 전",
    after_action: "조치 후",
    inspection: "점검",
  };
  return `${typeLabel[evidenceType]} 사진 증빙 - ${relatedTask} - ${capturedAt}`;
}

function safeFilename(photoIdOrIri: string): string {
  return basename(localPhotoSlug(normalizePhotoId(photoIdOrIri))).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function localPhotoSlug(photoId: string): string {
  return photoId.startsWith(PHOTO_ID_PREFIX) ? photoId.slice(PHOTO_ID_PREFIX.length) : photoId;
}
