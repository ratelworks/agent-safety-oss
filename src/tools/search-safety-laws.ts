import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  listLaws,
  searchArticles,
  type LawCode,
} from "../lib/safety-laws-loader.js";

// 파일 최상단 상수 — 로컬 번들 법령 검색 Tool
// 저작권법 §7 비보호 저작물이므로 재배포·인용 자유
const MAX_LIMIT = 30;
const DEFAULT_LIMIT = 10;

const inputSchema = z.object({
  keyword: z
    .string()
    .describe(
      "조문 제목·본문 키워드 (예: '위험성평가', '안전난간', '밀폐공간')",
    ),
  lawCode: z
    .enum([
      "osha",
      "osha-decree",
      "osha-rule",
      "osha-standard",
      "severe-accident",
      "risk-assessment-notice",
    ])
    .optional()
    .describe(
      "특정 법령만 검색 (osha=산안법, osha-decree=시행령, osha-rule=시행규칙, osha-standard=기준규칙, severe-accident=중처법, risk-assessment-notice=위험성평가 고시)",
    ),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const results = await searchArticles(input.keyword, {
    lawCode: input.lawCode as LawCode | undefined,
    limit: input.limit,
  });

  // MD 응답 조립
  const lines: string[] = [];
  lines.push(`# 법령 조문 검색: "${input.keyword}"`);
  lines.push("");
  lines.push(`> 결과 ${results.length}건 · 저작권법 §7 비보호 저작물 (자유 인용)`);
  lines.push(`> 전체 목록: list_core_safety_laws · 조문 본문: get_safety_law_article`);
  lines.push("");

  if (results.length === 0) {
    lines.push("**매칭된 조문이 없습니다.**");
    lines.push("");
    lines.push("다음을 시도하세요:");
    lines.push("- 키워드를 더 일반적인 단어로 변경 (예: '비계' → '비계' 또는 '조립')");
    lines.push("- `list_core_safety_laws()` 로 번들된 법령 전체 목록 확인");
    lines.push("- 번들에 없는 조문은 법제처 https://www.law.go.kr 에서 확인");
  } else {
    for (const a of results) {
      lines.push(`## [${a.lawShortName}] ${a.ref} ${a.title}`);
      // 본문은 너무 길면 앞 300자만 요약 + "전문은 get_safety_law_article 호출" 안내
      const preview = a.body
        .replace(/^##\s+§[^\n]+\n/, "")
        .slice(0, 300)
        .replace(/\n+/g, " ")
        .trim();
      lines.push("");
      lines.push(preview + (a.body.length > 300 ? " ..." : ""));
      lines.push("");
      lines.push(
        `> 전문 조회: \`get_safety_law_article(ref="${a.lawShortName} ${a.ref}")\``,
      );
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  const md = lines.join("\n");

  return {
    content: [{ type: "text", text: md }],
    structuredContent: {
      query: input,
      total: results.length,
      laws: listLaws(),
    },
  };
}

export const searchSafetyLawsTool: ToolDefinition = {
  name: "search_safety_laws",
  title: "법령 조문 검색 (건설·산업안전)",
  description:
    "번들된 건설·산업안전 법령 6개 (산안법·시행령·시행규칙·기준규칙·중처법·위험성평가 고시) 에서 키워드로 조문 검색. 로컬 번들이라 API 키 불필요. 응답은 Markdown — LLM 이 그대로 위험성평가·작업계획서·TBM 등 문서에 인용 가능. 저작권법 §7 비보호 저작물이라 인용·복제 자유.",
  inputSchema,
  handler,
};
