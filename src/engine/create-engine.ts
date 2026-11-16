/**
 * create-engine.ts — 호스트 저장 주입 모드의 진입점
 *
 * 다른 서비스(호스트) 안에서 이 엔진을 쓸 때 요청마다 인스턴스를 만든다:
 *
 *   const engine = createSafetyEngine({ storage, files, clock, trace, scope: { projectId } });
 *   const { result, files, writes } = await engine.call("register_safety_issue", input);
 *
 * - 저장 인터페이스(storage)가 없으면 만들지 않는다 — 로컬 저장으로 조용히 돌아가지 않는다.
 * - 이 인스턴스의 도구 실행은 홈 폴더·SAFETY_LOCAL_DIR·프로세스 공유 캐시에 쓰지 않는다(로컬 쓰기는 막혀 있다).
 * - 회사는 저장 인스턴스가, 현장은 scope.projectId 가 정한다. 인스턴스마다 맥락이 따로라 동시에 돌아도 섞이지 않는다.
 * - 입력은 도구의 원래 스키마(검사·변환 포함)로 먼저 검사하고, 틀리면 아무것도 저장하지 않고 거절한다.
 * - 쓰기는 도구가 성공한 뒤 마지막에 한 번에 보낸다. 실패하면 SafetyEngineError 의 code 로 단계를 나눠 알린다.
 *
 * 단독 사용(MCP 서버·CLI·브라우저 폼)은 이 파일을 거치지 않고 지금까지의 로컬 저장을 그대로 쓴다.
 */
import { performance } from "node:perf_hooks";
import type { z } from "zod";
import { TOOLS, attachCredits } from "../tool-registry.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { VERSION } from "../version.js";
import { HostRun, SafetyEngineError, runInHost } from "./host-context.js";
import {
  SAFETY_STORAGE_KINDS,
  type SafetyClock,
  type SafetyFileOut,
  type SafetyFileReader,
  type SafetyScope,
  type SafetyStorage,
  type SafetyStorageKind,
  type SafetyTraceEvent,
  type SafetyWriteRef,
} from "./storage.js";
import { toolTraits, type SafetyHumanRequirement, type SafetyToolAccess, type SafetyToolTraits } from "./tool-catalog.js";

// ── 상수 ────────────────────────────────────────────────────────────
export const SAFETY_ENGINE_ID = "agent-safety-oss";
/** 호스트 계약 버전 — 저장 종류·결과 모양이 호환되지 않게 바뀌면 올린다 */
export const SAFETY_ENGINE_CONTRACT_VERSION = "1";
const TRACE_PREFIX = "safety.";
const MAX_PROJECT_ID_LENGTH = 160;

export interface SafetyEngineOptions {
  /** 회사 하나로 고정한 저장 인터페이스 (필수) */
  storage: SafetyStorage;
  /** 입력 파일 칸(fileFields)의 참조를 읽는 호스트 파일 인터페이스 — 사진 올리기에 필요 */
  files?: SafetyFileReader;
  /** 시계 — 생략하면 시스템 시계. 같은 시각을 주면 같은 id·기록이 나온다 */
  clock?: SafetyClock;
  /** 활동 기록 id 생성 — 생략하면 시각·내용으로 정한다 */
  newId?: () => string;
  /** 안전한 추적 이벤트(이름과 숫자·참거짓 값만) */
  trace?: (event: SafetyTraceEvent) => void;
  /** 현장 고정 — 생략하면 회사 범위 */
  scope?: SafetyScope;
}

/** 호스트에 공개하는 도구 한 개 */
export interface SafetyToolInfo {
  name: string;
  title?: string;
  description: string;
  /** 도구의 원래 입력 스키마(검사·변환 포함) — 모양만 베끼지 말고 이 객체로 검사한다 */
  inputSchema: z.ZodTypeAny;
  access: SafetyToolAccess;
  storage: "none" | "injected";
  effects: { files: boolean; external: boolean };
  human?: SafetyHumanRequirement;
  siteField?: string;
  fileFields?: readonly string[];
}

export interface SafetyEngineManifest {
  id: string;
  packageVersion: string;
  contractVersion: string;
  storageKinds: readonly SafetyStorageKind[];
  /** 호스트 모드에서 쓸 수 있는 도구 */
  tools: readonly SafetyToolInfo[];
  /** 호스트 모드에서 거절하는 도구와 까닭 */
  excluded: readonly { tool: string; reason: string }[];
}

export interface SafetyCallResult {
  /** false = 도구가 오류 응답을 냄(입력은 맞지만 처리할 수 없음) — 아무것도 저장하지 않았다 */
  ok: boolean;
  /** MCP 와 같은 모양의 응답 (content + structuredContent) */
  result: McpToolResult;
  /** 엔진이 낸 문서 파일 — 저장은 호스트가 한다 */
  files: SafetyFileOut[];
  /** 저장 인터페이스로 보낸 쓰기 */
  writes: SafetyWriteRef[];
}

export interface SafetyEngine {
  readonly manifest: SafetyEngineManifest;
  readonly scope: Readonly<SafetyScope>;
  call(tool: string, input?: unknown): Promise<SafetyCallResult>;
}

// ── 목록 (도구 정의·특성에서 한 번 만든다 — 회사 자료가 아니다) ──
const TOOL_BY_NAME = new Map<string, ToolDefinition>(TOOLS.map((tool) => [tool.name, tool]));
let cachedManifest: SafetyEngineManifest | undefined;

/** 호스트 모드 도구 목록 (도구 정의와 특성 목록에서 만든다) */
export function getSafetyEngineManifest(): SafetyEngineManifest {
  if (cachedManifest) return cachedManifest;
  const tools: SafetyToolInfo[] = [];
  const excluded: { tool: string; reason: string }[] = [];
  for (const tool of TOOLS) {
    const traits = toolTraits(tool.name);
    if (!traits) {
      excluded.push({ tool: tool.name, reason: "저장·통신 특성을 밝히지 않은 도구" });
      continue;
    }
    if (traits.storage === "local-only") {
      excluded.push({ tool: tool.name, reason: traits.localOnlyReason ?? "단독 사용 전용 도구" });
      continue;
    }
    tools.push(
      Object.freeze({
        name: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        description: tool.description,
        inputSchema: tool.inputSchema,
        access: traits.access,
        storage: traits.storage,
        effects: Object.freeze({ ...traits.effects }),
        ...(traits.human ? { human: Object.freeze({ ...traits.human }) } : {}),
        ...(traits.siteField ? { siteField: traits.siteField } : {}),
        ...(traits.fileFields ? { fileFields: Object.freeze([...traits.fileFields]) } : {}),
      }),
    );
  }
  cachedManifest = Object.freeze({
    id: SAFETY_ENGINE_ID,
    packageVersion: VERSION,
    contractVersion: SAFETY_ENGINE_CONTRACT_VERSION,
    storageKinds: SAFETY_STORAGE_KINDS,
    tools: Object.freeze(tools),
    excluded: Object.freeze(excluded),
  });
  return cachedManifest;
}

/** 요청 하나를 위한 엔진 인스턴스 */
export function createSafetyEngine(options: SafetyEngineOptions): SafetyEngine {
  const storage = options?.storage;
  if (
    !storage ||
    typeof storage.get !== "function" ||
    typeof storage.list !== "function" ||
    typeof storage.put !== "function" ||
    typeof storage.remove !== "function"
  ) {
    throw new SafetyEngineError(
      "storage_required",
      "호스트 저장 인터페이스(storage: get·list·put·remove)가 없습니다 — 호스트 모드는 로컬 저장으로 돌아가지 않습니다.",
    );
  }
  if (options.files !== undefined && typeof options.files?.read !== "function") {
    throw new SafetyEngineError("invalid_option", "files 는 read(ref) 를 가진 객체여야 합니다.");
  }
  if (options.clock !== undefined && typeof options.clock?.now !== "function") {
    throw new SafetyEngineError("invalid_option", "clock 은 now() 를 가진 객체여야 합니다.");
  }
  if (options.newId !== undefined && typeof options.newId !== "function") {
    throw new SafetyEngineError("invalid_option", "newId 는 함수여야 합니다.");
  }
  if (options.trace !== undefined && typeof options.trace !== "function") {
    throw new SafetyEngineError("invalid_option", "trace 는 함수여야 합니다.");
  }
  const projectId = options.scope?.projectId;
  if (projectId !== undefined && (typeof projectId !== "string" || projectId.trim() === "" || projectId.length > MAX_PROJECT_ID_LENGTH)) {
    throw new SafetyEngineError("invalid_option", `scope.projectId 는 1~${MAX_PROJECT_ID_LENGTH}자 글이어야 합니다.`);
  }
  const scope: Readonly<SafetyScope> = Object.freeze(projectId === undefined ? {} : { projectId });
  const clock = options.clock;
  const now = (): Date => {
    const value = clock ? clock.now() : new Date();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new SafetyEngineError("invalid_option", "clock.now() 가 올바른 Date 를 돌려주지 않았습니다.");
    }
    return value;
  };
  const manifest = getSafetyEngineManifest();

  const emit = (event: SafetyTraceEvent): void => {
    if (!options.trace) return;
    try {
      options.trace(event);
    } catch {
      // 추적 실패는 실행을 막지 않는다
    }
  };

  return Object.freeze({
    manifest,
    scope,
    async call(name: string, input?: unknown): Promise<SafetyCallResult> {
      const tool = typeof name === "string" ? TOOL_BY_NAME.get(name) : undefined;
      if (!tool) throw new SafetyEngineError("unknown_tool", `등록되지 않은 도구입니다: ${String(name)}`);
      const traits = toolTraits(name);
      if (!traits) throw new SafetyEngineError("tool_unavailable", `저장·통신 특성을 밝히지 않은 도구입니다: ${name}`, { tool: name });
      if (traits.storage === "local-only") {
        throw new SafetyEngineError("tool_unavailable", `호스트 모드에서 쓰지 않는 도구입니다: ${name} — ${traits.localOnlyReason ?? ""}`, {
          tool: name,
        });
      }
      const args = applyScope(name, traits, input, scope);
      const parsed = tool.inputSchema.safeParse(args);
      if (!parsed.success) {
        throw new SafetyEngineError("invalid_input", `입력이 도구 스키마와 맞지 않습니다: ${name}`, {
          tool: name,
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
        });
      }

      const run = new HostRun({ storage, files: options.files, now, newId: options.newId, scope }, name);
      const started = performance.now();
      let result: McpToolResult;
      try {
        result = await runInHost(run, async () => tool.handler(args));
      } catch (err) {
        if (run.failure) throw run.failure;
        if (err instanceof SafetyEngineError) throw err;
        throw new SafetyEngineError("tool_failed", `도구 실행 중 오류: ${err instanceof Error ? err.message : String(err)}`, { tool: name });
      }
      // 도구가 호스트 오류를 잡아 오류 응답으로 바꿨어도 그 단계를 그대로 알린다
      if (run.failure) throw run.failure;

      if (result.isError === true) {
        emit({ name: `${TRACE_PREFIX}${name}`, values: { ok: false, writes: 0, files: 0 } });
        return { ok: false, result: attachCredits(result), files: [], writes: [] };
      }
      checkTraits(name, traits, run);
      const writes = await run.flush();
      const files = [...run.filesOut];
      emit({
        name: `${TRACE_PREFIX}${name}`,
        values: { ok: true, writes: writes.length, files: files.length, ms: Math.round(performance.now() - started) },
      });
      return { ok: true, result: attachCredits(result), files, writes };
    },
  });
}

/** 현장으로 고정한 실행: 현장 칸이 비어 있으면 그 현장으로 채우고, 다르면 거절한다 */
function applyScope(name: string, traits: SafetyToolTraits, input: unknown, scope: Readonly<SafetyScope>): Record<string, unknown> {
  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input))) {
    throw new SafetyEngineError("invalid_input", `입력은 객체여야 합니다: ${name}`, { tool: name });
  }
  const args: Record<string, unknown> = { ...((input as Record<string, unknown> | undefined) ?? {}) };
  if (!scope.projectId || !traits.siteField) return args;
  const value = args[traits.siteField];
  if (value === undefined || value === null || value === "") {
    args[traits.siteField] = scope.projectId;
  } else if (value !== scope.projectId) {
    throw new SafetyEngineError("scope_mismatch", `고정한 현장과 다른 현장(${traits.siteField})을 지정했습니다.`, {
      tool: name,
      field: traits.siteField,
    });
  }
  return args;
}

/** 특성 목록과 실제 실행 대조 — 밝히지 않은 저장·파일 효과면 저장하지 않는다 */
function checkTraits(name: string, traits: SafetyToolTraits, run: HostRun): void {
  const mismatch = (what: string): never => {
    throw new SafetyEngineError("catalog_mismatch", `도구 특성 목록과 실행이 다릅니다(${name}): ${what}`, { tool: name });
  };
  if (traits.access !== "write" && run.hasPendingWrites()) mismatch("쓰기를 밝히지 않은 도구가 저장하려 했습니다");
  if (traits.access === "none" && run.touchedStorage) mismatch("저장을 쓰지 않는다고 밝힌 도구가 저장을 읽었습니다");
  if (!traits.effects.files && run.filesOut.length > 0) mismatch("파일을 내지 않는다고 밝힌 도구가 파일을 냈습니다");
}
