import { XMLParser } from "fast-xml-parser";
import { SafetyMcpError, ERROR_CODES } from "./errors.js";
import {
  getApiKey,
  getRuntimeEnv,
  requireApiKey,
  requireAgentHqKey,
  getKoshaRelayUrl,
  mapToRelayEndpoint,
  type ApiName,
} from "../config/env.js";
import { RESPONSE_CODES } from "../config/constants.js";

// 파일 최상단 상수 — XML 파서는 단일 인스턴스로 재사용
// processEntities:false 로 XXE / billion-laughs 같은 entity 공격 방어
const XML_PARSER = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  trimValues: true,
  processEntities: false,
});

// 업스트림 응답 최대 크기 (바이트). 초과 시 업스트림 장애로 판정하고 중단.
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MiB

// relay 호출 실패 시 direct API fallback / retry 정책 (교차 검증 2026-04-30 P0-5)
// relay 가 일시 장애·rate-limit 응답일 때 자동으로 (1) backoff 재시도 → (2) 사용자 키 보유 시 직접 호출 fallback.
// 외부 npm 사용자가 단일 중계 장애로 전체 도구가 멈추는 상황을 방지.
const RETRY_MAX_ATTEMPTS = 2; // 최초 1회 + 재시도 1회. relay 5xx / rate-limit 시만 적용
const RETRY_BACKOFF_MS = 800;
const RETRY_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

// 간단한 메모리 캐시 — 프로세스 내부 TTL 기반
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}
const CACHE = new Map<string, CacheEntry>();

export interface ApiRequestOptions {
  api: ApiName;
  base: string;
  path: string;
  params: Record<string, string | number | undefined>;
  // 응답 포맷 힌트 (포털 API 대부분 XML 기본, dataType=JSON 지원 시 JSON)
  responseFormat?: "json" | "xml" | "auto";
}

export interface ApiResponse<T = unknown> {
  rawText: string;
  parsed: T;
  url: string;
}

function buildUrl(
  base: string,
  path: string,
  params: Record<string, string | number | undefined>,
  serviceKey: string,
): string {
  const url = new URL(base.endsWith("/") ? base + path.replace(/^\//, "") : base + path);
  // 공공데이터포털은 serviceKey 파라미터를 사용
  // URL 디코딩된 키를 URLSearchParams에 주면 자동 인코딩됨
  url.searchParams.set("serviceKey", serviceKey);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

// 캐시 키는 serviceKey 를 redact 한 URL 을 사용한다.
// 메모리 덤프·로그·디버깅 시 raw key 가 남지 않도록 방어.
function cacheKey(url: string): string {
  return `GET:${redactKey(url)}`;
}

export async function callKoshaApi<T = unknown>(
  opts: ApiRequestOptions,
): Promise<ApiResponse<T>> {
  const { api, base, path, params, responseFormat = "auto" } = opts;
  const env = getRuntimeEnv();

  // 1) 라텔웍스 운영 중계 우선 시도 (사용자 키 진입장벽 해소)
  // 2) relay 5xx / rate-limit / 네트워크 실패 → backoff 재시도 (RETRY_MAX_ATTEMPTS)
  // 3) 재시도 후에도 실패 + 사용자 키 보유 → 직접 호출 fallback (단일 장애점 해소)
  const relayUrl = getKoshaRelayUrl();
  const directKey = getApiKey(api); // undefined 일 수 있음 — 키 없으면 fallback 비활성
  const relayEndpoint = relayUrl ? mapToRelayEndpoint(base, path) : null;

  // relay 사용 시도 (mapping 있을 때만)
  if (relayUrl && relayEndpoint) {
    // 라텔웍스 발행 AgentHQ API 키 필수 — 미등록 시 명확한 에러 + 가입 URL
    // 운영팀 디버깅 / 사내 자체 중계 운영 시에는 KOSHA_RELAY_URL="" + DATA_GO_KR_KEY 로 우회
    const agentHqKey = requireAgentHqKey();

    const u = new URL(`${relayUrl}/api/${relayEndpoint}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
    const relayFullUrl = u.toString();

    let lastErr: unknown;
    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await fetchAndProcess<T>(relayFullUrl, responseFormat, env, {
          Authorization: `Bearer ${agentHqKey}`,
        });
      } catch (err) {
        lastErr = err;
        // retry 가치 있는 에러만 재시도 (5xx / rate-limit / network)
        if (!isRetriableError(err) || attempt >= RETRY_MAX_ATTEMPTS) break;
        await delay(RETRY_BACKOFF_MS * attempt);
      }
    }

    // relay 실패 후 direct key 가 있으면 직접 호출 fallback (운영팀 / 자체 키 보유자)
    if (directKey) {
      try {
        const directFullUrl = buildUrl(base, path, params, directKey);
        return await fetchAndProcess<T>(directFullUrl, responseFormat, env);
      } catch (directErr) {
        // 둘 다 실패 — 마지막 에러를 throw (정보량 더 큰 쪽 우선)
        throw directErr;
      }
    }

    throw lastErr;
  }

  // relay 미사용 (KOSHA_RELAY_URL="") 또는 매핑 미존재 → 직접 호출 (키 필수)
  const serviceKey = requireApiKey(api);
  const directFullUrl = buildUrl(base, path, params, serviceKey);
  return fetchAndProcess<T>(directFullUrl, responseFormat, env);
}

// 단일 URL 1회 호출 + 캐시·파싱·결과코드 검사. retry / fallback 결정은 호출자에서.
// extraHeaders 로 Authorization 등 호출별 헤더 첨부 가능 (relay 경로 AgentHQ 키 등).
async function fetchAndProcess<T>(
  url: string,
  responseFormat: "json" | "xml" | "auto",
  env: ReturnType<typeof getRuntimeEnv>,
  extraHeaders?: Record<string, string>,
): Promise<ApiResponse<T>> {
  const key = cacheKey(url);
  const redactedUrl = redactKey(url);

  if (env.cacheTtlSec > 0) {
    const hit = CACHE.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as ApiResponse<T>;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.requestTimeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json, application/xml;q=0.9, text/xml;q=0.9",
          ...(extraHeaders ?? {}),
        },
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new SafetyMcpError(
          ERROR_CODES.UPSTREAM_HTTP,
          `Upstream request timed out after ${env.requestTimeoutMs}ms`,
          { upstream: redactedUrl },
        );
      }
      throw new SafetyMcpError(
        ERROR_CODES.UPSTREAM_HTTP,
        `Upstream request failed: ${(err as Error).message}`,
        { upstream: redactedUrl },
      );
    }

    if (!res.ok) {
      // Relay 4xx 응답 body 에는 친화적 진단 정보(agenthq_key_required·agenthq_key_invalid·signupUrl·reissueUrl 등)가 들어있다.
      // 본문 손실 없이 사용자에게 노출하기 위해 4xx 인 경우 body 읽어서 details 에 포함.
      let relayBody: unknown;
      let relayMessage = "";
      if (res.status >= 400 && res.status < 500) {
        try {
          const text = await res.text();
          if (text) {
            try {
              relayBody = JSON.parse(text) as unknown;
              if (relayBody && typeof relayBody === "object" && "message" in (relayBody as Record<string, unknown>)) {
                const m = (relayBody as Record<string, unknown>).message;
                if (typeof m === "string" && m.trim()) relayMessage = m.trim();
              }
            } catch {
              // 비JSON — 짧은 텍스트면 메시지로 활용
              if (text.length < 200) relayMessage = text.trim();
            }
          }
        } catch {
          // body 읽기 실패는 무시 — 기본 HTTP 메시지로 throw
        }
      }
      const baseMessage = `Upstream HTTP ${res.status} ${res.statusText}`;
      const fullMessage = relayMessage ? `${baseMessage}: ${relayMessage}` : baseMessage;
      throw new SafetyMcpError(
        ERROR_CODES.UPSTREAM_HTTP,
        fullMessage,
        {
          status: res.status,
          upstream: redactedUrl,
          ...(relayBody ? { relayResponse: relayBody } : {}),
        },
      );
    }

    const rawText = await readBodyWithLimit(res, MAX_RESPONSE_BYTES, redactedUrl);

    let parsed: unknown;
    try {
      parsed = parseBody(rawText, responseFormat);
    } catch (err) {
      throw new SafetyMcpError(
        ERROR_CODES.UPSTREAM_PARSE,
        `Failed to parse upstream response: ${(err as Error).message}`,
        { upstream: redactedUrl },
      );
    }

    const code = extractResultCode(parsed);
    if (code && code !== RESPONSE_CODES.SUCCESS) {
      if (code === RESPONSE_CODES.NO_DATA) {
        throw new SafetyMcpError(ERROR_CODES.UPSTREAM_NO_DATA, "Upstream returned no data", {
          upstream: redactedUrl,
        });
      }
      throw new SafetyMcpError(
        ERROR_CODES.UPSTREAM_HTTP,
        `Upstream result code ${code}`,
        { upstream: redactedUrl },
      );
    }

    const response: ApiResponse<T> = {
      rawText,
      parsed: parsed as T,
      url: redactedUrl,
    };

    if (env.cacheTtlSec > 0) {
      CACHE.set(key, {
        value: response,
        expiresAt: Date.now() + env.cacheTtlSec * 1000,
      });
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

// retry 가치 판정: 5xx / 429 / 네트워크 실패만 재시도 가치 있음.
// 4xx 인증 실패·404 같은 영구적 실패는 즉시 fallback 또는 throw.
function isRetriableError(err: unknown): boolean {
  if (!(err instanceof SafetyMcpError)) return false;
  if (err.status === undefined) {
    // status 없는 에러 = 네트워크/timeout/parse 실패. timeout·request failed 만 재시도.
    return /timed out|request failed/i.test(err.message);
  }
  return RETRY_STATUSES.has(err.status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
  redactedUrl: string,
): Promise<string> {
  // content-length 선제 거부
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new SafetyMcpError(
      ERROR_CODES.UPSTREAM_HTTP,
      `Upstream body too large: declared ${declared} bytes (max ${maxBytes})`,
      { upstream: redactedUrl },
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    // ReadableStream 미지원 환경 폴백 — text() 는 size 보장 없음
    return res.text();
  }

  const decoder = new TextDecoder("utf-8");
  let total = 0;
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafetyMcpError(
        ERROR_CODES.UPSTREAM_HTTP,
        `Upstream body exceeded ${maxBytes} bytes during streaming read`,
        { upstream: redactedUrl },
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function parseBody(rawText: string, format: "json" | "xml" | "auto"): unknown {
  const trimmed = rawText.trimStart();
  if (format === "json" || (format === "auto" && trimmed.startsWith("{"))) {
    return JSON.parse(rawText);
  }
  return XML_PARSER.parse(rawText);
}

// 응답 안에서 공통 결과 코드 추출 — 포털 API 스키마 다양성 허용
function extractResultCode(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const root = parsed as Record<string, any>;
  const candidates = [
    root?.response?.header?.resultCode,
    root?.response?.header?.resultMsg,
    root?.header?.resultCode,
    root?.resultCode,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^\d{2}$/.test(c)) return c;
  }
  return undefined;
}

function redactKey(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("serviceKey")) {
      u.searchParams.set("serviceKey", "***");
    }
    return u.toString();
  } catch {
    return url.replace(/serviceKey=[^&]+/, "serviceKey=***");
  }
}

