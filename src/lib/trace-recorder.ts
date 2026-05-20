import { createHash, randomUUID } from "crypto";
import { join } from "path";
import { ensureSecureDir, appendSecureLog } from "./secure-fs.js";
import { getTracesDir } from "../config/paths.js";

const TRACE_DISABLE_ENV = "SAFETY_TRACE_DISABLE";
// SAFETY_TRACE_DIR 가 우선이지만 미설정 시 paths.ts 의 getTracesDir() 가 SAFETY_LOCAL_DIR
// 도 함께 반영해 ~/.agent-safety-oss/traces 또는 SAFETY_LOCAL_DIR/traces 로 라우팅한다.
const TRACE_DIR_ENV = "SAFETY_TRACE_DIR";
const TRACE_AGENT_IRI = "safety:agent/llm-client";
const TRACE_ID_PREFIX = "safety:trace";
const HASH_ID_PREFIX = "safety:hash/sha256";
const CIRCULAR_REFERENCE_MARKER = "[Circular]";

interface ProvOActivity {
  "@id": string;
  "@type": ["prov:Activity", "owl:NamedIndividual"];
  "prov:startedAtTime": string;
  "prov:endedAtTime": string;
  "prov:wasAssociatedWith": string;
  "prov:used": string;
  "prov:generated": string;
  "safety:toolName": string;
  "safety:inputHash": string;
  "safety:outputHash": string;
}

// MCP Tool 호출을 PROV-O Activity JSONL 로 append-only 기록한다.
export class TraceRecorder {
  private readonly traceDir: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(traceDir?: string) {
    // SAFETY_TRACE_DIR 명시 > paths.ts 의 getTracesDir() (SAFETY_LOCAL_DIR 우선, fallback ~/.agent-safety-oss/traces)
    this.traceDir = traceDir ?? process.env[TRACE_DIR_ENV] ?? getTracesDir();
  }

  async recordToolCall(
    toolName: string,
    input: unknown,
    output: unknown,
    startedAt: string,
    endedAt: string,
  ): Promise<void> {
    if (isTraceDisabled()) {
      return;
    }

    try {
      const inputHash = sha256(input);
      const outputHash = sha256(output);
      const activity: ProvOActivity = {
        "@id": `${TRACE_ID_PREFIX}/${randomUUID()}`,
        "@type": ["prov:Activity", "owl:NamedIndividual"],
        "prov:startedAtTime": startedAt,
        "prov:endedAtTime": endedAt,
        "prov:wasAssociatedWith": TRACE_AGENT_IRI,
        "prov:used": `${HASH_ID_PREFIX}/${inputHash}`,
        "prov:generated": `${HASH_ID_PREFIX}/${outputHash}`,
        "safety:toolName": toolName,
        "safety:inputHash": inputHash,
        "safety:outputHash": outputHash,
      };

      const traceFilePath = join(this.traceDir, `${getTraceDate(startedAt)}.jsonl`);
      const traceLine = `${JSON.stringify(activity)}\n`;
      const writeOperation = async () => {
        await ensureSecureDir(this.traceDir);
        await appendSecureLog(traceFilePath, traceLine);
      };

      // 같은 프로세스 안에서는 순서 보장, 프로세스 간에는 O_APPEND appendFile 에 위임한다.
      const queuedWrite = this.writeQueue.then(writeOperation, writeOperation);
      this.writeQueue = queuedWrite;
      await queuedWrite;
    } catch (err) {
      console.error(`[TraceRecorder] trace append failed: ${getErrorMessage(err)}`);
    }
  }
}

function isTraceDisabled(): boolean {
  return process.env[TRACE_DISABLE_ENV]?.trim().toLowerCase() === "true";
}

function getTraceDate(startedAt: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(startedAt)
    ? startedAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value, new WeakSet<object>()));
}

function normalizeForJson(value: unknown, seen: WeakSet<object>): unknown {
  if (value === undefined) {
    return "[undefined]";
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[function:${value.name || "anonymous"}]`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
    };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR_REFERENCE_MARKER;
    }
    seen.add(value);
    const normalized = value.map((item) => normalizeForJson(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return {
      data: value.toString("base64"),
      type: "Buffer",
    };
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return CIRCULAR_REFERENCE_MARKER;
    }
    seen.add(value);

    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeForJson(
        (value as Record<string, unknown>)[key],
        seen,
      );
    }
    seen.delete(value);
    return normalized;
  }

  return String(value);
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
