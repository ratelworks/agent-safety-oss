/**
 * photo-storage.ts
 *
 * 현장사진 증빙 로컬 저장소.
 * 기본 위치는 ~/.agent-safety-oss/photos 이며 SAFETY_LOCAL_DIR 로 루트 변경 가능.
 *
 * 호스트 저장 주입 모드(createSafetyEngine)에서는 사진 바이트를 복사하지 않는다 — filePath 는 호스트 파일 참조로 받아
 * 호스트 파일 인터페이스로 읽고(내용 해시만 계산), 사진 기록만 주입한 저장(photo 종류)에 쓴다.
 * 같은 촬영 시각·같은 내용의 사진은 같은 photoId 가 되어 다시 올려도 기록이 늘지 않는다.
 */
import { copyFile, readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureSecureDir, writeSecureJson, chmodSecureFile } from "./secure-fs.js";
import {
  HOST_FILE_URI_PREFIX,
  assertLocalWriteAllowed,
  currentHost,
  engineNow,
  hostStorageLabel,
  sha256Hex,
  type HostRun,
} from "../engine/host-context.js";

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
  /** 호스트 저장 주입 모드: 호스트 파일 참조와 형식 */
  fileRef?: string;
  mimeType?: string;
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
  if (currentHost()) return hostStorageLabel();
  return resolve(process.env[STORAGE_ENV_NAME] || DEFAULT_STORAGE_ROOT);
}

export function getPhotoStorageDir(): string {
  if (currentHost()) return hostStorageLabel("photo");
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
  const host = currentHost();
  if (host) return hostSavePhotoEvidence(host, input);
  await ensurePhotoDir();

  const prepared = await preparePhotoFile(input);
  const photoId = makePhotoId(input.capturedAt, prepared.hashSeed);
  const now = engineNow().toISOString();
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
  const host = currentHost();
  if (host) return (await host.get<PhotoEvidenceRecord>("photo", normalizePhotoId(photoIdOrIri))) ?? null;
  try {
    const text = await readFile(photoRecordPath(photoIdOrIri), "utf8");
    return JSON.parse(text) as PhotoEvidenceRecord;
  } catch {
    return null;
  }
}

export async function listPhotoEvidence(filter: ListPhotoEvidenceFilter = {}): Promise<PhotoEvidenceRecord[]> {
  const host = currentHost();
  if (host) {
    const records = await host.list<PhotoEvidenceRecord>("photo");
    return records
      .map(({ value }) => value)
      .filter((record) => matchesPhotoFilter(record, filter))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }
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
    // stat + readFile 분리 TOCTOU race 회피 — open(O_RDONLY) 후 fstat 으로 동일 inode 검증.
    const { open } = await import("node:fs/promises");
    const fh = await open(sourcePath, "r");
    let buffer: Buffer;
    let sourceStat: Awaited<ReturnType<typeof fh.stat>>;
    try {
      sourceStat = await fh.stat();
      if (!sourceStat.isFile()) throw new Error(`사진 파일이 아닙니다: ${sourcePath}`);
      buffer = await fh.readFile();
    } finally {
      await fh.close();
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const tempPhotoId = makePhotoId(input.capturedAt, sha256);
    const extension = extname(sourcePath) || ".bin";
    const storagePath = join(getPhotoStorageDir(), `${safeFilename(tempPhotoId)}${extension}`);
    // 이미 메모리에 읽은 buffer 를 write — copyFile 대신 writeFile (재경합 회피).
    assertLocalWriteAllowed("사진 복사");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(storagePath, buffer, { mode: 0o600 });

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
  const host = currentHost();
  if (host) {
    host.put("photo", normalizePhotoId(record.photoId), record);
    return;
  }
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

// ── 호스트 저장 주입 모드 ──

async function hostSavePhotoEvidence(host: HostRun, input: SavePhotoEvidenceInput): Promise<PhotoEvidenceRecord> {
  let fileUri: string;
  let hashSeed: string;
  let fileRef: string | undefined;
  let mimeType: string | undefined;
  let byteSize: number | undefined;
  let sha256: string | undefined;
  if (input.filePath) {
    // 호스트 모드의 filePath 는 로컬 경로가 아니라 호스트 파일 참조다
    const file = await host.readFile(input.filePath);
    sha256 = sha256Hex(file.bytes);
    hashSeed = sha256;
    fileRef = input.filePath;
    mimeType = file.mimeType;
    byteSize = file.bytes.byteLength;
    fileUri = `${HOST_FILE_URI_PREFIX}${input.filePath}`;
  } else {
    if (!input.fileUri) throw new Error("filePath 또는 fileUri 중 하나는 필요합니다.");
    if (/^file:/i.test(input.fileUri.trim())) {
      host.raise("invalid_input", "호스트 저장 모드에서는 file 주소를 받지 않습니다 — 호스트 파일 참조(filePath)로 주세요.");
    }
    fileUri = input.fileUri;
    hashSeed = sha256Hex(input.fileUri);
  }
  const photoId = makePhotoId(input.capturedAt, hashSeed);
  const existing = await host.get<PhotoEvidenceRecord>("photo", photoId);
  if (existing) return existing;
  const now = host.nowIso();
  const record: PhotoEvidenceRecord = {
    "@context": PHOTO_CONTEXT,
    "@id": toPhotoIri(photoId),
    "@type": ["safety:PhotoEvidence", "prov:Entity", "foaf:Image"],
    photoId,
    label: makePhotoLabel(input.evidenceType, input.relatedTask, input.capturedAt),
    fileUri,
    fileRef,
    mimeType,
    byteSize,
    sha256,
    relatedTask: input.relatedTask,
    relatedSite: input.relatedSite ?? host.scopeProjectId,
    relatedRisk: input.relatedRisk,
    evidenceType: input.evidenceType,
    capturedAt: input.capturedAt,
    createdAt: now,
    evidences: [],
  };
  host.put("photo", photoId, record);
  return record;
}
