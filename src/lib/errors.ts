import { ZodError } from "zod";

// 파일 최상단 상수 — MCP에 노출될 수 있는 표준 에러 코드
// AGENTHQ_API_KEY_REQUIRED — 라텔웍스 발행 AgentHQ API 키 미등록 시 KOSHA Live 호출 차단
//   가입 URL: https://ratelworks.co.kr/agenthq/api-key
//   등록 방법: link_company_key MCP 도구 또는 AGENTHQ_API_KEY 환경변수
export const ERROR_CODES = {
  AGENTHQ_API_KEY_REQUIRED: "AGENTHQ_API_KEY_REQUIRED",
  API_KEY_MISSING: "API_KEY_MISSING",
  UPSTREAM_HTTP: "UPSTREAM_HTTP",
  UPSTREAM_PARSE: "UPSTREAM_PARSE",
  UPSTREAM_NO_DATA: "UPSTREAM_NO_DATA",
  INVALID_INPUT: "INVALID_INPUT",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class SafetyMcpError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  readonly upstream?: string;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { status?: number; upstream?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "SafetyMcpError";
    this.code = code;
    this.status = opts.status;
    this.upstream = opts.upstream;
    this.details = opts.details;
  }
}

export function isSafetyMcpError(err: unknown): err is SafetyMcpError {
  return err instanceof SafetyMcpError;
}

// ZodError 를 INVALID_INPUT 구조화된 응답으로 변환
function zodErrorToPayload(err: ZodError): {
  code: ErrorCode;
  message: string;
  details: Array<{ path: string; message: string; code: string }>;
} {
  return {
    code: ERROR_CODES.INVALID_INPUT,
    message: "Input validation failed",
    details: err.issues.map((i) => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
      code: i.code,
    })),
  };
}

// MCP CallTool 응답용 에러 페이로드 직렬화
export function toMcpErrorContent(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  // 1) Zod 입력 검증 실패
  if (err instanceof ZodError) {
    const payload = zodErrorToPayload(err);
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: true,
    };
  }

  // 2) 내부 표준 에러
  if (isSafetyMcpError(err)) {
    const payload: Record<string, unknown> = {
      code: err.code,
      message: err.message,
    };
    if (err.status !== undefined) payload.status = err.status;
    if (err.upstream) payload.upstream = err.upstream;
    if (err.details !== undefined) payload.details = err.details;
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: true,
    };
  }

  // 3) 그 외 예기치 못한 오류만 INTERNAL
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      { type: "text", text: JSON.stringify({ code: ERROR_CODES.INTERNAL, message }, null, 2) },
    ],
    isError: true,
  };
}
