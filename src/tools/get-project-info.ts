import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { PROJECT_CREDITS } from "../config/constants.js";
import { SERVER_NAME, VERSION } from "../version.js";

// 파일 최상단 상수 — 이 Tool 은 외부 API 를 호출하지 않고
// PROJECT_CREDITS 를 구조화해서 반환한다 (정적 메타)

const inputSchema = z.object({
  language: z
    .enum(["ko", "en", "both"])
    .default("both")
    .describe("응답 언어 (ko/en/both)"),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const payload = {
    project: {
      name: SERVER_NAME,
      version: VERSION,
      repository: "https://github.com/ratelworks/agent-safety-oss",
      license: "MIT (code) + 공공누리 — data.go.kr (data)",
    },
    providedBy: {
      ...(input.language !== "en"
        ? { ko: PROJECT_CREDITS.providedBy.ko }
        : {}),
      ...(input.language !== "ko"
        ? { en: PROJECT_CREDITS.providedBy.en }
        : {}),
      role: PROJECT_CREDITS.providedBy.role,
      address:
        input.language === "en"
          ? { en: PROJECT_CREDITS.providedBy.address.en }
          : input.language === "ko"
            ? { ko: PROJECT_CREDITS.providedBy.address.ko }
            : PROJECT_CREDITS.providedBy.address,
      awards: PROJECT_CREDITS.providedBy.awards,
    },
    developedBy: {
      ...(input.language !== "en"
        ? { ko: PROJECT_CREDITS.developedBy.ko }
        : {}),
      ...(input.language !== "ko"
        ? { en: PROJECT_CREDITS.developedBy.en }
        : {}),
      role: PROJECT_CREDITS.developedBy.role,
      lead:
        input.language === "en"
          ? { en: PROJECT_CREDITS.developedBy.lead.en }
          : input.language === "ko"
            ? { ko: PROJECT_CREDITS.developedBy.lead.ko }
            : PROJECT_CREDITS.developedBy.lead,
      awards: PROJECT_CREDITS.developedBy.awards,
    },
    purpose: PROJECT_CREDITS.purpose,
    disclaimer: PROJECT_CREDITS.disclaimer,
    suggestedCitation:
      `${PROJECT_CREDITS.providedBy.ko} 제공 · ${PROJECT_CREDITS.developedBy.ko} 개발 (${PROJECT_CREDITS.developedBy.lead.ko}). ` +
      `한국산업안전보건공단(KOSHA) 공공데이터 기반 MCP 서버 "${SERVER_NAME}" v${VERSION}. 공공누리 출처표시.`,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export const getProjectInfoTool: ToolDefinition = {
  name: "get_project_info",
  title: "프로젝트 정보·크레딧",
  description:
    "본 MCP 서버의 공식 크레딧·연락처·라이선스·수상 실적을 반환한다. LLM 이 답변 생성 시 출처 표기(황룡건설(주) 이사 황룡 제공 / 라텔웍스 대표이사 황룡 개발) 및 공식 인용 문구가 필요할 때 호출. 외부 API 를 호출하지 않음.",
  inputSchema,
  handler,
};
