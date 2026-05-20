import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { SafetyMcpError, ERROR_CODES } from "../lib/errors.js";

// 파일 최상단 상수 — API 별 공공데이터포털 메타 (에러 payload 에 동봉)
export const API_DATASET_META = {
  safetyMaterial: {
    dataId: "15139398",
    portalUrl: "https://www.data.go.kr/data/15139398/openapi.do",
    label: "안전보건자료 링크 서비스",
  },
  accidentCase: {
    dataId: "15121001",
    portalUrl: "https://www.data.go.kr/data/15121001/openapi.do",
    label: "국내재해사례 게시판",
  },
  accidentCaseAttachment: {
    dataId: "15121008",
    portalUrl: "https://www.data.go.kr/data/15121008/openapi.do",
    label: "국내재해사례 첨부파일",
  },
  constructionFatal: {
    dataId: "15133935",
    portalUrl: "https://www.data.go.kr/data/15133935/openapi.do",
    label: "건설업 일별 중대재해 현황",
  },
  allFatalAccidents: {
    dataId: "15119137",
    portalUrl: "https://www.data.go.kr/data/15119137/openapi.do",
    label: "사고사망 게시판 (전 업종)",
  },
  msds: {
    dataId: "15001197",
    portalUrl: "https://www.data.go.kr/data/15001197/openapi.do",
    label: "물질안전보건자료 (MSDS) — KOSHA 별도 서버 msds.kosha.or.kr, 별도 활용신청·키 발급 필요",
  },
  safetyLaw: {
    dataId: "15123696",
    portalUrl: "https://www.data.go.kr/data/15123696/openapi.do",
    label: "안전보건법령 스마트검색",
  },
  koshaGuideContent: {
    dataId: "15144147",
    portalUrl: "https://www.data.go.kr/data/15144147/openapi.do",
    label: "KOSHA Guide 조회 서비스",
  },
  ppeCertification: {
    dataId: "15139497",
    portalUrl: "https://www.data.go.kr/data/15139497/openapi.do",
    label: "보호구 안전인증 현황",
  },
} as const;

// 파일 최상단 상수 — 환경변수 키 이름 집합
const ENV_KEYS = {
  DATA_GO_KR_KEY: "DATA_GO_KR_KEY",

  // 개별 API 오버라이드 (선택)
  SAFETY_MATERIAL: "KOSHA_SAFETY_MATERIAL_KEY",
  ACCIDENT_CASE: "KOSHA_ACCIDENT_CASE_KEY",
  ACCIDENT_ATTACHMENT: "KOSHA_ACCIDENT_ATTACHMENT_KEY",
  CONSTRUCTION_FATAL: "KOSHA_CONSTRUCTION_FATAL_KEY",
  ALL_FATAL: "KOSHA_ALL_FATAL_KEY",
  MSDS: "KOSHA_MSDS_KEY",
  LAW: "KOSHA_LAW_KEY",
  KOSHA_GUIDE: "KOSHA_GUIDE_KEY",
  PPE_CERTIFICATION: "KOSHA_PPE_KEY",

  // 런타임 옵션
  LOG_LEVEL: "LOG_LEVEL",
  PORT: "PORT",
  CACHE_TTL_SEC: "CACHE_TTL_SEC",
  REQUEST_TIMEOUT_MS: "REQUEST_TIMEOUT_MS",
} as const;

const DEFAULT_CACHE_TTL_SEC = 300;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_PORT = 7345;
const MIN_REQUEST_TIMEOUT_MS = 1_000; // 안전 하한 — 너무 짧으면 fetch 취소 폭주

export type ApiName =
  | "safetyMaterial"
  | "accidentCase"
  | "accidentCaseAttachment"
  | "constructionFatal"
  | "allFatalAccidents"
  | "msds"
  | "safetyLaw"
  | "koshaGuideContent"
  | "ppeCertification";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RuntimeEnv {
  logLevel: LogLevel;
  port: number;
  cacheTtlSec: number;
  requestTimeoutMs: number;
}

// 개별 API 전용 키 우선, 없으면 공통 DATA_GO_KR_KEY 폴백
export function getApiKey(api: ApiName): string | undefined {
  const specific = (() => {
    switch (api) {
      case "safetyMaterial":
        return process.env[ENV_KEYS.SAFETY_MATERIAL];
      case "accidentCase":
        return process.env[ENV_KEYS.ACCIDENT_CASE];
      case "accidentCaseAttachment":
        return process.env[ENV_KEYS.ACCIDENT_ATTACHMENT];
      case "constructionFatal":
        return process.env[ENV_KEYS.CONSTRUCTION_FATAL];
      case "allFatalAccidents":
        return process.env[ENV_KEYS.ALL_FATAL];
      case "msds":
        return process.env[ENV_KEYS.MSDS];
      case "safetyLaw":
        return process.env[ENV_KEYS.LAW];
      case "koshaGuideContent":
        return process.env[ENV_KEYS.KOSHA_GUIDE];
      case "ppeCertification":
        return process.env[ENV_KEYS.PPE_CERTIFICATION];
    }
  })();

  return specific?.trim() || process.env[ENV_KEYS.DATA_GO_KR_KEY]?.trim();
}

export function requireApiKey(api: ApiName): string {
  const key = getApiKey(api);
  if (!key) {
    const meta = API_DATASET_META[api];
    const envVar = envKeyForApi(api);
    throw new SafetyMcpError(
      ERROR_CODES.API_KEY_MISSING,
      `API key missing for "${api}" (${meta.label}). Set ${ENV_KEYS.DATA_GO_KR_KEY} or ${envVar} in environment. 활용신청은 data.go.kr 개발단계 자동승인으로 즉시 발급.`,
      {
        details: {
          api,
          dataId: meta.dataId,
          label: meta.label,
          portalUrl: meta.portalUrl,
          envVars: [ENV_KEYS.DATA_GO_KR_KEY, envVar],
          hint: "공공데이터포털에서 로그인 후 '활용신청' → '개발단계'(자동승인) → 마이페이지에서 디코딩된 서비스키 복사 → 환경변수 설정.",
        },
      },
    );
  }
  return key;
}

function envKeyForApi(api: ApiName): string {
  switch (api) {
    case "safetyMaterial":
      return ENV_KEYS.SAFETY_MATERIAL;
    case "accidentCase":
      return ENV_KEYS.ACCIDENT_CASE;
    case "accidentCaseAttachment":
      return ENV_KEYS.ACCIDENT_ATTACHMENT;
    case "constructionFatal":
      return ENV_KEYS.CONSTRUCTION_FATAL;
    case "allFatalAccidents":
      return ENV_KEYS.ALL_FATAL;
    case "msds":
      return ENV_KEYS.MSDS;
    case "safetyLaw":
      return ENV_KEYS.LAW;
    case "koshaGuideContent":
      return ENV_KEYS.KOSHA_GUIDE;
    case "ppeCertification":
      return ENV_KEYS.PPE_CERTIFICATION;
  }
}

// 0 을 유효값으로 허용하기 위해 `||` 대신 isFinite 기반 파서 사용
function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

// 라텔웍스 운영 KOSHA Live API 중계
// 외부 npm 사용자는 라텔웍스 발행 AgentHQ API 키로 인증한 뒤 호출 → 라텔웍스가
// data.go.kr 키로 KOSHA Live API 호출. 즉 외부 사용자는 data.go.kr 가입 불필요,
// 단 AgentHQ 키 발급은 필수.
// 운영팀이 디버깅 또는 사내 자체 중계 운영 시 KOSHA_RELAY_URL 을 빈 문자열로 설정하면
// 직접 호출 (이 경우 DATA_GO_KR_KEY 등 사용자 직접 키 필요).
export const DEFAULT_KOSHA_RELAY_URL =
  "https://agentsafetyrelay-622699652854.asia-northeast3.run.app";

export function getKoshaRelayUrl(): string | null {
  const raw = process.env["KOSHA_RELAY_URL"];
  if (raw === undefined) return DEFAULT_KOSHA_RELAY_URL; // 기본값 — 라텔웍스 운영 중계
  if (raw.trim() === "") return null; // 명시적 비우기 → 직접 호출
  return raw.trim().replace(/\/$/, "");
}

// 라텔웍스 발행 AgentHQ API 키 로드
// 우선순위: 1) AGENTHQ_API_KEY 환경변수 → 2) ~/.agent-safety-oss/company-key.json
// (link_company_key MCP 도구가 저장하는 위치) → 3) 없으면 null
// process 시작 시 한 번 로드 후 캐시. invalidateAgentHqKeyCache() 로 강제 재로드 가능.
let cachedAgentHqKey: string | null | undefined = undefined;

export function getAgentHqKey(): string | null {
  if (cachedAgentHqKey !== undefined) return cachedAgentHqKey;
  // 1) 환경변수 우선
  const envKey = process.env["AGENTHQ_API_KEY"]?.trim();
  if (envKey) {
    cachedAgentHqKey = envKey;
    return envKey;
  }
  // 2) ~/.agent-safety-oss/company-key.json (link_company_key 저장 위치)
  try {
    const path = resolve(homedir(), ".agent-safety-oss", "company-key.json");
    const txt = readFileSync(path, "utf8");
    const parsed = JSON.parse(txt) as { apiKey?: string };
    if (parsed.apiKey && typeof parsed.apiKey === "string") {
      cachedAgentHqKey = parsed.apiKey;
      return parsed.apiKey;
    }
  } catch {
    // 파일 없거나 파싱 실패 — 정상 케이스 (키 미등록 사용자)
  }
  cachedAgentHqKey = null;
  return null;
}

export function invalidateAgentHqKeyCache(): void {
  cachedAgentHqKey = undefined;
}

export const AGENTHQ_SIGNUP_URL = "https://ratelworks.co.kr/agenthq/api-key";

export function requireAgentHqKey(): string {
  const key = getAgentHqKey();
  if (!key) {
    throw new SafetyMcpError(
      ERROR_CODES.AGENTHQ_API_KEY_REQUIRED,
      `라텔웍스 발행 AgentHQ API 키가 등록되지 않았습니다. KOSHA Live API (재해사례·MSDS·KOSHA Guide 본문 등) 호출에 필수입니다. ` +
        `발급: ${AGENTHQ_SIGNUP_URL} → 가입 후 이메일로 발송되는 키를 (a) link_company_key MCP 도구로 등록하거나 (b) AGENTHQ_API_KEY 환경변수에 설정.`,
      {
        details: {
          signupUrl: AGENTHQ_SIGNUP_URL,
          envVar: "AGENTHQ_API_KEY",
          mcpTool: "link_company_key",
          keyFile: "~/.agent-safety-oss/company-key.json",
        },
      },
    );
  }
  return key;
}

// base + path → 중계 endpoint name 매핑 (KOSHA Live API)
// 본 OSS 의 실제 KOSHA portal 24 path 와 정확 일치
export function mapToRelayEndpoint(base: string, path: string): string | null {
  const fullPath = `${base}${path}`.toLowerCase();
  if (fullPath.includes("/koshaguide/")) return "kosha-guides";
  if (fullPath.includes("disaster_attach_api02")) return "accident-attachments";
  if (fullPath.includes("disaster_api02")) return "accident-cases";
  if (fullPath.includes("constdsstr01")) return "construction-fatal";
  if (fullPath.includes("news_api02")) return "all-fatal";
  if (fullPath.includes("selectmedialist01")) return "safety-materials";
  if (fullPath.includes("msdschem")) return "msds";
  if (fullPath.includes("/oshci/")) return "ppe-cert";
  if (fullPath.includes("smartsearch")) return "safety-law";
  return null;
}

export function getRuntimeEnv(): RuntimeEnv {
  const cacheRaw = parseIntEnv(process.env[ENV_KEYS.CACHE_TTL_SEC], DEFAULT_CACHE_TTL_SEC);
  const timeoutRaw = parseIntEnv(
    process.env[ENV_KEYS.REQUEST_TIMEOUT_MS],
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
  return {
    logLevel: (process.env[ENV_KEYS.LOG_LEVEL] as LogLevel) ?? "info",
    port: parseIntEnv(process.env[ENV_KEYS.PORT], DEFAULT_PORT),
    // 0 이면 캐시 비활성화 (의도적). 음수는 0 으로 클램프
    cacheTtlSec: Math.max(0, cacheRaw),
    // timeout 은 하한을 둬서 0 이나 음수 설정을 막는다
    requestTimeoutMs: Math.max(MIN_REQUEST_TIMEOUT_MS, timeoutRaw),
  };
}
