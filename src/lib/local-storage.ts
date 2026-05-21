/**
 * local-storage.ts
 *
 * agent-safety-oss 의 로컬 영구 저장소.
 *
 * 디렉토리 구조 (~/.agent-safety-oss/):
 *   profile.jsonld              — 사업장·인력 SSoT (site-profile.ts)
 *   company-key.json            — 라텔웍스 발행 키 (company-key.ts)
 *   drafts/{docId}.jsonld       — 작성 중 폼 데이터 (자동 저장)
 *   documents/{docId}/          — 완성된 본문 보관
 *     {YYYY-MM-DD-HHmmss-SSS}.{html,md,json}
 *   activity.log                — 모든 저장 이벤트 (JSONL audit trail)
 *
 * 모든 쓰기 작업은 activity.log 에 기록 — 사용자 작업 추적 가능.
 *
 * 의존성 0 — Node 표준만.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  ensureSecureDir as ensureDir,
  writeSecureJson,
  writeSecureTextExclusive,
  appendSecureLog,
} from "./secure-fs.js";
// Issue #5 lateral (2026-05-22) — 보관 timestamp 파일명 KST 기준
import { formatKstDate, formatKstHuman } from "./datetime-kst.js";
import {
  getStorageRoot,
  getDraftsDir,
  getDocumentsDir,
  getActivityLogPath,
} from "../config/paths.js";

// path SSoT: src/config/paths.ts. SAFETY_LOCAL_DIR 환경변수 즉시 반영을 위해 getter 호출.
// 기존 상수 노출은 호환성 유지 — getter 결과를 capture 한 lazy export.
export const STORAGE_ROOT = getStorageRoot();
export const DRAFTS_DIR = getDraftsDir();
export const DOCUMENTS_DIR = getDocumentsDir();
export const ACTIVITY_LOG = getActivityLogPath();

async function logActivity(event: Record<string, unknown>): Promise<void> {
  try {
    await ensureDir(STORAGE_ROOT);
    const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n";
    await appendSecureLog(ACTIVITY_LOG, line);
  } catch {
    // log 실패는 본 작업을 막지 않음
  }
}

// === Draft (작성 중 폼 데이터) ===

export interface FormDraft {
  docId: string;
  formValues: Record<string, string>;
  updatedAt: string;
  createdAt: string;
  autosave: boolean;
  /** 사용자가 명시 저장한 시점 (autosave=false 호출 시) */
  manualSavedAt?: string;
}

/**
 * 입력값을 A2UI input type 표준 형식으로 정규화.
 * viewer의 renderComponent / maybeLoadDraft 와 동일한 룰 — CLI와 A2UI 폼이 같은 결과.
 *
 * 변환 룰:
 *   - 일자/날짜 키 → YYYY-MM-DD
 *   - 일시/datetime 키 → YYYY-MM-DDTHH:MM
 *   - 시각/time 키 → HH:MM
 *   - 숫자 키 → 숫자만 (공백·콤마·단위 제거)
 *
 * 키 패턴 매칭은 단순 휴리스틱. 매칭 실패 시 원본 보존.
 */
export function normalizeFormValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (raw == null) continue;
    const v = String(raw).trim();
    if (v === "") {
      out[key] = "";
      continue;
    }
    const k = key.toLowerCase();
    // datetime: 일시·datetime
    if (/일시|datetime|발생일시|점검일시|회의일시/.test(key) || /datetime|timestamp/.test(k)) {
      const m = v.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})[T ]?([0-9]{2}:[0-9]{2})?/);
      out[key] = m ? (m[2] ? m[1] + "T" + m[2] : m[1] + "T00:00") : v;
      continue;
    }
    // date: 일자·날짜·시작일·종료일·작성일·...
    if (/일자|날짜|date|시작일|종료일|작성일|점검일|평가\s*시기|평가\s*실시일|발생일|체결일|만기일|만료일|승인일|등록일|배치일|채용일|선임일|발급일|기준일|결재일|마감일|개최일|준공일/.test(key)) {
      const m = v.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})/);
      out[key] = m ? m[1] : v;
      continue;
    }
    // time: 시각·time (시·분)
    if (/시각|^시간/.test(key) || /\btime\b/.test(k)) {
      const m = v.match(/([0-9]{2}:[0-9]{2})/);
      out[key] = m ? m[1] : v;
      continue;
    }
    // number: 명백한 숫자 키
    if (/근로자\s*수|인원\s*수|건수|일수|개수|수량|금액|amount|예산|단가/.test(key)) {
      const m = v.match(/-?[0-9]+(?:\.[0-9]+)?/);
      out[key] = m ? m[0] : v;
      continue;
    }
    out[key] = v;
  }
  return out;
}

function draftPath(docId: string): string {
  if (!/^[a-z][a-z0-9_-]*$/i.test(docId)) {
    throw new Error(`invalid docId: ${docId}`);
  }
  return join(DRAFTS_DIR, `${docId}.jsonld`);
}

export async function saveDraft(
  docId: string,
  formValues: Record<string, string>,
  autosave = false,
): Promise<FormDraft> {
  await ensureDir(DRAFTS_DIR);
  const path = draftPath(docId);
  let existing: FormDraft | null = null;
  try {
    const txt = await readFile(path, "utf8");
    existing = JSON.parse(txt);
  } catch {
    // not found
  }

  const now = new Date().toISOString();
  const draft: FormDraft = {
    docId,
    formValues: { ...(existing?.formValues ?? {}), ...formValues }, // merge — 빈 값 무시 안 함 (사용자가 빈칸 의도 가능)
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
    autosave,
    manualSavedAt: autosave ? existing?.manualSavedAt : now,
  };
  await writeSecureJson(path, draft);
  await logActivity({
    type: "draft_saved",
    docId,
    autosave,
    fieldCount: Object.keys(formValues).length,
  });
  return draft;
}

export async function loadDraft(docId: string): Promise<FormDraft | null> {
  try {
    const txt = await readFile(draftPath(docId), "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function deleteDraft(docId: string): Promise<boolean> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(draftPath(docId));
    await logActivity({ type: "draft_deleted", docId });
    return true;
  } catch {
    return false;
  }
}

export interface DraftSummary {
  docId: string;
  updatedAt: string;
  fieldCount: number;
  manualSavedAt?: string;
  autosaveOnly: boolean;
}

export async function listDrafts(): Promise<DraftSummary[]> {
  try {
    await ensureDir(DRAFTS_DIR);
    const files = await readdir(DRAFTS_DIR);
    const out: DraftSummary[] = [];
    for (const f of files) {
      if (!f.endsWith(".jsonld")) continue;
      try {
        const txt = await readFile(join(DRAFTS_DIR, f), "utf8");
        const d = JSON.parse(txt) as FormDraft;
        out.push({
          docId: d.docId,
          updatedAt: d.updatedAt,
          fieldCount: Object.keys(d.formValues || {}).length,
          manualSavedAt: d.manualSavedAt,
          autosaveOnly: !d.manualSavedAt,
        });
      } catch {}
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

// === Archived Document (완성된 본문) ===

export const ARCHIVE_FORMATS = ["markdown", "html", "json"] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

// 같은 millisecond 안에 100건 이상 동시 보관이 발생하면 호출자에게 충돌을 알린다.
const MAX_FILENAME_COLLISIONS = 100;

export interface ArchivedDocument {
  docId: string;
  archivedAt: string;
  format: ArchiveFormat;
  filename: string;
  byteSize: number;
}

function timestamp(): string {
  // Issue #5 lateral — KST 기준 timestamp 파일명.
  // 이전: d.toISOString().slice(0,10) 은 UTC 기준이라 KST 새벽 호출 시 어제 파일명.
  // 이후: KST 기준 YYYY-MM-DD + KST 기준 HHmmss-SSS.
  const utcMs = Date.now();
  const kstMs = utcMs + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const datePart = formatKstDate(new Date(utcMs));
  return (
    datePart +
    "-" +
    String(kst.getUTCHours()).padStart(2, "0") +
    String(kst.getUTCMinutes()).padStart(2, "0") +
    String(kst.getUTCSeconds()).padStart(2, "0") +
    "-" +
    String(kst.getUTCMilliseconds()).padStart(3, "0")
  );
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST";
}

async function writeUniqueFile(
  dir: string,
  baseName: string,
  ext: string,
  content: string,
): Promise<{ filename: string; filepath: string }> {
  for (let index = 0; index < MAX_FILENAME_COLLISIONS; index += 1) {
    const suffix = index === 0 ? "" : `-${String(index).padStart(2, "0")}`;
    const filename = `${baseName}${suffix}.${ext}`;
    const filepath = join(dir, filename);
    try {
      // wx flag: 같은 millisecond 동시 보관 시 덮어쓰기 방지. 0o600 은 secure-fs 정책.
      await writeSecureTextExclusive(filepath, content);
      return { filename, filepath };
    } catch (error) {
      if (isFileExistsError(error)) continue;
      throw error;
    }
  }
  throw new Error(`archive filename collision: ${baseName}.${ext} (>${MAX_FILENAME_COLLISIONS} retries)`);
}

export async function archiveDocument(
  docId: string,
  content: string,
  format: ArchiveFormat = "html",
): Promise<ArchivedDocument> {
  if (!/^[a-z][a-z0-9_-]*$/i.test(docId)) {
    throw new Error(`invalid docId: ${docId}`);
  }
  const dir = join(DOCUMENTS_DIR, docId);
  await ensureDir(dir);
  const ext = format === "html" ? "html" : format === "markdown" ? "md" : "json";
  const { filename } = await writeUniqueFile(dir, timestamp(), ext, content);
  const meta: ArchivedDocument = {
    docId,
    archivedAt: new Date().toISOString(),
    format,
    filename,
    byteSize: Buffer.byteLength(content, "utf8"),
  };
  await logActivity({ type: "document_archived", ...meta });
  return meta;
}

export async function listArchivedDocuments(
  filterDocId?: string,
): Promise<Array<ArchivedDocument & { fullPath: string }>> {
  await ensureDir(DOCUMENTS_DIR);
  const out: Array<ArchivedDocument & { fullPath: string }> = [];
  try {
    const dirs = await readdir(DOCUMENTS_DIR);
    for (const docId of dirs) {
      if (filterDocId && docId !== filterDocId) continue;
      const subdir = join(DOCUMENTS_DIR, docId);
      try {
        const s = await stat(subdir);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }
      const files = await readdir(subdir);
      for (const f of files) {
        const full = join(subdir, f);
        try {
          const s = await stat(full);
          const ext = f.split(".").pop() || "";
          out.push({
            docId,
            archivedAt: s.mtime.toISOString(),
            format: (ext === "md" ? "markdown" : ext) as ArchiveFormat,
            filename: f,
            byteSize: s.size,
            fullPath: full,
          });
        } catch {}
      }
    }
  } catch {}
  return out.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

export async function loadArchivedDocument(docId: string, filename: string): Promise<string | null> {
  // path traversal 가드 — docId·filename 둘 다 ".." / "/" 금지 + 정상화 경로가 DOCUMENTS_DIR 내부인지 검증.
  if (typeof docId !== "string" || typeof filename !== "string") return null;
  if (docId.includes("..") || docId.includes("/") || docId.includes("\\") || docId === "") return null;
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\") || filename === "") return null;
  const target = resolve(DOCUMENTS_DIR, docId, filename);
  const root = resolve(DOCUMENTS_DIR);
  if (!target.startsWith(root + (root.endsWith("/") ? "" : "/")) && target !== root) return null;
  try {
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}

// === Activity Log ===

export interface ActivityEvent {
  at: string;
  type: string;
  [k: string]: unknown;
}

export async function readRecentActivity(limit = 50): Promise<ActivityEvent[]> {
  try {
    const txt = await readFile(ACTIVITY_LOG, "utf8");
    const lines = txt.trim().split("\n").filter(Boolean);
    const events: ActivityEvent[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
    return events.reverse(); // newest first
  } catch {
    return [];
  }
}

export async function getStorageStats(): Promise<{
  storageRoot: string;
  profileExists: boolean;
  draftCount: number;
  archivedDocCount: number;
  archivedDocByDocId: Record<string, number>;
  recentActivityCount: number;
  activityLogBytes: number;
}> {
  const drafts = await listDrafts();
  const archived = await listArchivedDocuments();
  const activity = await readRecentActivity(1000);
  let logBytes = 0;
  try {
    logBytes = (await stat(ACTIVITY_LOG)).size;
  } catch {}
  let profileExists = false;
  try {
    await stat(join(STORAGE_ROOT, "profile.jsonld"));
    profileExists = true;
  } catch {}
  const byDocId: Record<string, number> = {};
  for (const a of archived) byDocId[a.docId] = (byDocId[a.docId] ?? 0) + 1;
  return {
    storageRoot: STORAGE_ROOT,
    profileExists,
    draftCount: drafts.length,
    archivedDocCount: archived.length,
    archivedDocByDocId: byDocId,
    recentActivityCount: activity.length,
    activityLogBytes: logBytes,
  };
}
