/**
 * host-context.ts — 호스트 저장 주입 모드의 실행 맥락 (도구 실행 한 번)
 *
 * createSafetyEngine 이 도구 하나를 실행할 때 이 맥락을 AsyncLocalStorage 로 건다.
 * 저장 모듈(site-profile·local-storage·photo-storage·safety-issue-storage·corrective-action-storage·
 * safety-report-storage·hwpx-export)은 맥락이 있으면 주입한 저장만 쓰고, 없으면(단독 사용) 지금까지의 로컬 파일 저장을 그대로 쓴다.
 * 맥락은 실행마다 새로 만들고 비동기 호출을 따라 전파되므로, 동시에 도는 두 회사의 실행이 서로의 저장을 보지 않는다
 * (프로세스 환경변수나 공유 캐시를 바꾸지 않는다).
 *
 * 쓰기 규칙: 실행 중 put/remove 는 메모리에 모으고, 도구가 성공하면 끝에서 한 번에 저장 인터페이스로 보낸다.
 * 같은 실행 안에서 다시 읽으면 메모리 값을 돌려준다 — 저장 인터페이스에는 "쓴 뒤 읽기"가 가지 않는다.
 *
 * 현장 범위: scope.projectId 가 있으면 현장에 속하는 종류(초안·문서·사진·이슈·조치·보고·활동)의 id 앞에
 * 현장 표지를 붙여 저장하고, 읽을 때는 그 현장 표지가 붙은 기록만 보인다. 현장별 프로필은 그 현장 id 만 읽고 쓴다.
 * 회사 범위(scope 없음)에서는 현장 표지가 붙은 기록이 보이지 않는다 — 회사와 현장의 기록이 섞이지 않는다.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type {
  SafetyFileIn,
  SafetyFileOut,
  SafetyFileReader,
  SafetyScope,
  SafetyStorage,
  SafetyStorageKind,
  SafetyWriteRef,
} from "./storage.js";

// ── 상수 ────────────────────────────────────────────────────────────
/** 호스트 모드 응답에서 로컬 경로 대신 쓰는 이름 */
export const HOST_STORAGE_LABEL = "host-storage";
/** 사진 기록의 fileUri 에 붙이는 호스트 파일 참조 앞머리 */
export const HOST_FILE_URI_PREFIX = "host-file:";
/** 현장에 속하는 저장 종류 — 현장 범위에서 id 앞에 현장 표지가 붙는다 */
const SITE_BOUND_KINDS: ReadonlySet<string> = new Set<SafetyStorageKind>([
  "draft",
  "document",
  "photo",
  "issue",
  "action",
  "report",
  "activity",
]);
const SCOPE_ID_PREFIX = "scope:";
const SCOPE_ID_SEPARATOR = "::";
const SCOPE_TAG_LENGTH = 16;
const ACTIVITY_ID_HASH_LENGTH = 16;
const MAX_STORAGE_ID_LENGTH = 200;

/** 호스트 모드 오류 종류 — 호스트가 코드로 갈라 처리한다 */
export type SafetyEngineErrorCode =
  | "storage_required" //   저장 인터페이스 없이 시작하려 함 (로컬로 조용히 돌아가지 않는다)
  | "invalid_option" //     시작 옵션 모양이 틀림
  | "unknown_tool" //       등록되지 않은 도구
  | "tool_unavailable" //   호스트 모드에서 쓸 수 없는 도구 (로컬 전용)
  | "invalid_input" //      입력 검사 실패 (저장 전에 거절)
  | "scope_mismatch" //     고정한 현장 밖을 읽거나 쓰려 함
  | "file_read_failed" //   호스트 파일 자리에서 입력 파일을 읽지 못함 (아무것도 저장하지 않음)
  | "storage_read_failed" // 저장 인터페이스 읽기 실패 (아무것도 저장하지 않음)
  | "local_write_blocked" // 호스트 모드에서 로컬 파일 쓰기를 시도함 (엔진 결함 — 막았다)
  | "catalog_mismatch" //   도구 목록에 밝힌 저장·파일 효과와 실제 실행이 다름 (엔진 결함 — 저장하지 않음)
  | "tool_failed" //        도구 실행 중 오류 (아무것도 저장하지 않음)
  | "commit_failed"; //     마지막 저장 중 실패 — details 에 쓴 것·못 쓴 것이 나뉜다

export class SafetyEngineError extends Error {
  readonly code: SafetyEngineErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: SafetyEngineErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SafetyEngineError";
    this.code = code;
    this.details = details;
  }
}

/** HostRun 이 받는 실행 재료 */
export interface HostRunDeps {
  storage: SafetyStorage;
  files?: SafetyFileReader;
  now: () => Date;
  newId?: () => string;
  scope: Readonly<SafetyScope>;
}

interface PendingOp {
  kind: string;
  storageId: string;
  removed: boolean;
  value?: unknown;
}

/** 도구 실행 한 번의 저장 단위 */
export class HostRun {
  readonly tool: string;
  readonly filesOut: SafetyFileOut[] = [];
  /** 도구가 오류를 삼켜도 엔진이 그대로 알리도록 처음 난 호스트 오류를 남긴다 */
  failure: SafetyEngineError | undefined;
  /** 저장 인터페이스를 한 번이라도 불렀는가 (도구 목록 대조용) */
  touchedStorage = false;
  private readonly deps: HostRunDeps;
  private readonly scopePrefix: string | null;
  private readonly readCache = new Map<string, unknown>();
  private readonly listCache = new Map<string, Map<string, unknown>>();
  private readonly pending = new Map<string, PendingOp>();
  private activitySeq = 0;

  constructor(deps: HostRunDeps, tool: string) {
    this.deps = deps;
    this.tool = tool;
    const projectId = deps.scope.projectId;
    this.scopePrefix = projectId
      ? `${SCOPE_ID_PREFIX}${createHash("sha256").update(projectId).digest("hex").slice(0, SCOPE_TAG_LENGTH)}${SCOPE_ID_SEPARATOR}`
      : null;
  }

  /** 고정한 현장(없으면 회사 범위) */
  get scopeProjectId(): string | undefined {
    return this.deps.scope.projectId;
  }

  now(): Date {
    return new Date(this.deps.now().getTime());
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  /** 호스트 오류를 남기고 던진다 — 도구가 catch 로 삼켜도 엔진이 이 오류를 낸다 */
  raise(code: SafetyEngineErrorCode, message: string, details: Record<string, unknown> = {}): never {
    const error = new SafetyEngineError(code, message, { tool: this.tool, ...details });
    if (!this.failure) this.failure = error;
    throw error;
  }

  // ── 저장 id ↔ 논리 id ──
  private readStorageId(kind: string, id: string): string | null {
    if (kind === "project_profile") {
      return this.deps.scope.projectId && id !== this.deps.scope.projectId ? null : id;
    }
    if (!SITE_BOUND_KINDS.has(kind)) return id;
    if (!this.scopePrefix && id.startsWith(SCOPE_ID_PREFIX)) return null;
    return this.scopePrefix ? this.scopePrefix + id : id;
  }

  private writeStorageId(kind: string, id: string): string {
    if (typeof id !== "string" || id === "") this.raise("tool_failed", "저장 id 가 비었습니다.", { kind });
    const storageId = this.readStorageId(kind, id);
    if (storageId === null) {
      this.raise("scope_mismatch", "고정한 현장 밖의 기록은 쓰지 않습니다.", { kind });
    }
    if (storageId.length > MAX_STORAGE_ID_LENGTH) {
      this.raise("tool_failed", `저장 id 가 ${MAX_STORAGE_ID_LENGTH}자를 넘습니다.`, { kind });
    }
    return storageId;
  }

  private logicalId(kind: string, storageId: string): string | null {
    if (kind === "project_profile") {
      return this.deps.scope.projectId && storageId !== this.deps.scope.projectId ? null : storageId;
    }
    if (!SITE_BOUND_KINDS.has(kind)) return storageId;
    if (this.scopePrefix) return storageId.startsWith(this.scopePrefix) ? storageId.slice(this.scopePrefix.length) : null;
    return storageId.startsWith(SCOPE_ID_PREFIX) ? null : storageId;
  }

  private async callStorage<T>(what: string, fn: () => Promise<T>): Promise<T> {
    this.touchedStorage = true;
    try {
      return await fn();
    } catch (err) {
      return this.raise("storage_read_failed", `저장 인터페이스 ${what} 실패: ${errorMessage(err)}`);
    }
  }

  // ── 읽기 (같은 실행에서 쓴 값은 메모리에서) ──
  async get<T>(kind: SafetyStorageKind, id: string): Promise<T | undefined> {
    const storageId = this.readStorageId(kind, id);
    if (storageId === null) return undefined;
    const key = cacheKey(kind, storageId);
    const op = this.pending.get(key);
    if (op) return op.removed ? undefined : (cloneJson(op.value) as T);
    const listed = this.listCache.get(kind);
    if (listed) return listed.has(storageId) ? (cloneJson(listed.get(storageId)) as T) : undefined;
    if (!this.readCache.has(key)) {
      const value = await this.callStorage("get", () => this.deps.storage.get(kind, storageId));
      this.readCache.set(key, value === undefined || value === null ? undefined : cloneJson(value));
    }
    const cached = this.readCache.get(key);
    return cached === undefined ? undefined : (cloneJson(cached) as T);
  }

  async list<T>(kind: SafetyStorageKind): Promise<Array<{ id: string; value: T }>> {
    if (!this.listCache.has(kind)) {
      const records = await this.callStorage("list", () => this.deps.storage.list(kind));
      if (!Array.isArray(records)) this.raise("storage_read_failed", "저장 인터페이스 list 가 배열을 돌려주지 않았습니다.", { kind });
      const byId = new Map<string, unknown>();
      for (const record of records) {
        if (!record || typeof record.id !== "string" || record.value === undefined || record.value === null) continue;
        byId.set(record.id, cloneJson(record.value));
      }
      this.listCache.set(kind, byId);
    }
    const merged = new Map(this.listCache.get(kind));
    for (const op of this.pending.values()) {
      if (op.kind !== kind) continue;
      if (op.removed) merged.delete(op.storageId);
      else merged.set(op.storageId, op.value);
    }
    const out: Array<{ id: string; value: T }> = [];
    for (const [storageId, value] of merged) {
      const id = this.logicalId(kind, storageId);
      if (id === null) continue;
      out.push({ id, value: cloneJson(value) as T });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // ── 쓰기 (메모리에 모았다가 flush 에서) ──
  put(kind: SafetyStorageKind, id: string, value: unknown): void {
    const storageId = this.writeStorageId(kind, id);
    let json: unknown;
    try {
      json = cloneJson(value);
    } catch (err) {
      this.raise("tool_failed", `저장할 값을 JSON 으로 옮길 수 없습니다: ${errorMessage(err)}`, { kind });
    }
    if (json === undefined || json === null) this.raise("tool_failed", "저장할 값이 비었습니다.", { kind });
    const key = cacheKey(kind, storageId);
    this.pending.delete(key);
    this.pending.set(key, { kind, storageId, removed: false, value: json });
  }

  remove(kind: SafetyStorageKind, id: string): void {
    const storageId = this.writeStorageId(kind, id);
    const key = cacheKey(kind, storageId);
    this.pending.delete(key);
    this.pending.set(key, { kind, storageId, removed: true });
  }

  /** 활동 기록 한 줄 (쓰기 작업마다) */
  activity(event: Record<string, unknown>): void {
    const at = this.nowIso();
    const record = { at, ...event };
    this.activitySeq += 1;
    const id = this.deps.newId
      ? this.deps.newId()
      : `act-${at.replace(/[^0-9]/g, "").slice(0, 17)}-${createHash("sha256")
          .update(`${this.tool}\u0000${this.activitySeq}\u0000${stableJson(record)}`)
          .digest("hex")
          .slice(0, ACTIVITY_ID_HASH_LENGTH)}`;
    this.put("activity", id, record);
  }

  hasPendingWrites(): boolean {
    return this.pending.size > 0;
  }

  // ── 파일 ──
  /** 입력 파일 칸의 참조를 호스트 파일 자리에서 읽는다 */
  async readFile(ref: string): Promise<SafetyFileIn> {
    if (!this.deps.files) {
      this.raise("file_read_failed", "파일을 읽을 호스트 파일 인터페이스(files)가 없습니다.");
    }
    let file: SafetyFileIn;
    try {
      file = await this.deps.files.read(ref);
    } catch (err) {
      return this.raise("file_read_failed", `호스트 파일을 읽지 못했습니다: ${errorMessage(err)}`);
    }
    if (!file || !(file.bytes instanceof Uint8Array)) {
      this.raise("file_read_failed", "호스트 파일 인터페이스가 바이트(Uint8Array)를 돌려주지 않았습니다.");
    }
    return file;
  }

  /** 엔진이 낸 파일 — 같은 실행에서 같은 이름·같은 내용이면 한 번만 */
  addFile(file: Omit<SafetyFileOut, "sha256">): SafetyFileOut {
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const out: SafetyFileOut = { ...file, bytes, sha256: sha256Hex(bytes) };
    const same = this.filesOut.find((f) => f.fileName === out.fileName && f.sha256 === out.sha256);
    if (same) return same;
    this.filesOut.push(out);
    return out;
  }

  /** 모은 쓰기를 저장 인터페이스로 보낸다. 중간에 실패하면 쓴 것·못 쓴 것을 나눠 알린다 */
  async flush(): Promise<SafetyWriteRef[]> {
    const ops = [...this.pending.values()];
    const written: SafetyWriteRef[] = [];
    for (let index = 0; index < ops.length; index += 1) {
      const op = ops[index]!;
      const ref: SafetyWriteRef = { kind: op.kind, id: op.storageId, op: op.removed ? "remove" : "put" };
      try {
        const result = op.removed
          ? this.deps.storage.remove(op.kind, op.storageId)
          : this.deps.storage.put(op.kind, op.storageId, op.value);
        if (result && typeof (result as Promise<void>).then === "function") await result;
      } catch (err) {
        throw new SafetyEngineError(
          "commit_failed",
          `저장 중 실패했습니다(${written.length}/${ops.length}건 저장됨). 같은 시각·같은 입력으로 다시 실행하면 같은 id 로 다시 씁니다: ${errorMessage(err)}`,
          {
            tool: this.tool,
            written,
            failed: ref,
            notWritten: ops.slice(index + 1).map((o) => ({ kind: o.kind, id: o.storageId, op: o.removed ? "remove" : "put" })),
            files: this.filesOut.map((f) => ({ fileName: f.fileName, sha256: f.sha256, documentKind: f.documentKind })),
          },
        );
      }
      written.push(ref);
    }
    this.pending.clear();
    return written;
  }
}

// ── 맥락 ──
const hostContext = new AsyncLocalStorage<HostRun>();

/** 지금 실행 중인 호스트 맥락 (단독 사용이면 undefined) */
export function currentHost(): HostRun | undefined {
  return hostContext.getStore();
}

export function isHostMode(): boolean {
  return hostContext.getStore() !== undefined;
}

export function runInHost<T>(run: HostRun, fn: () => Promise<T>): Promise<T> {
  return hostContext.run(run, fn);
}

/** 지금 시각 — 호스트 모드면 주입한 시계, 단독 사용이면 시스템 시계 */
export function engineNow(): Date {
  const host = hostContext.getStore();
  return host ? host.now() : new Date();
}

export function engineNowMs(): number {
  const host = hostContext.getStore();
  return host ? host.now().getTime() : Date.now();
}

/** 호스트 모드에서 로컬 파일 쓰기를 막는다 (저장 모듈의 마지막 방어선) */
export function assertLocalWriteAllowed(what: string): void {
  const host = hostContext.getStore();
  if (host) host.raise("local_write_blocked", `호스트 저장 모드에서는 로컬 파일을 쓰지 않습니다: ${what}`);
}

/** 호스트 모드 응답에 쓰는 저장 위치 이름 */
export function hostStorageLabel(...segments: string[]): string {
  return [HOST_STORAGE_LABEL, ...segments].join("/");
}

// ── 보조 ──
function cacheKey(kind: string, storageId: string): string {
  return `${kind}\u0000${storageId}`;
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  return text === undefined ? undefined : JSON.parse(text);
}

/** 키 순서를 정렬한 JSON (내용 비교·해시용, undefined 칸은 뺀다) */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(cloneJson(value)));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
