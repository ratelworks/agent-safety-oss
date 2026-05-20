/**
 * get-kosha-guide-md.ts
 *
 * 번들된 KOSHA Guide 본문 MD 단일 통합 조회 도구. AGENTHQ_API_KEY 없이 동작 (offline, keyless).
 * KOSHA Guide 1,039건 번들 단일 진입점:
 *   - 단건 본문 조회: techGdlnNo='A-1-2018' 형식
 *   - 키워드 검색: keyword='굴착' (제목 + 본문 매칭)
 *   - 전체 인덱스: 인수 없음
 *
 * Live API 기반 get_kosha_guide_content (15144147) 와
 *   빈 번들 stub search_kosha_guides 는 본 도구로 통합·제거. 번들이 1,039건을
 *   keyless offline 제공하므로 외부 호출 불필요.
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  getKoshaGuideMd,
  listKoshaGuidesMd,
  searchKoshaGuidesMd,
  getKoshaGuidesStats,
} from "../lib/kosha-guides-loader.js";
import { COMMON_RESPONSE_META } from "../config/constants.js";

const inputSchema = z.object({
  techGdlnNo: z
    .string()
    .optional()
    .describe("지침번호 (예: 'A-1-2018', 'C-50-2023'). 단건 본문 조회."),
  keyword: z
    .string()
    .optional()
    .describe("키워드 (제목 + 본문 검색). 미지정 시 단건 조회 또는 전체 인덱스."),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  // 단건 조회
  if (input.techGdlnNo) {
    const body = await getKoshaGuideMd(input.techGdlnNo);
    if (!body) {
      const stats = await getKoshaGuidesStats();
      return {
        content: [{
          type: "text",
          text: `[NOT_FOUND] KOSHA Guide '${input.techGdlnNo}' 번들에 없음. 번들 가이드 ${stats.total}건 중 미포함 (폐기 또는 신규 가이드일 수 있음). 원본은 KOSHA portal (https://www.kosha.or.kr/kosha/data/guideExp.do) 직접 참조. LLM 은 본문 추측·생성 금지.`,
        }],
        structuredContent: {
          error: "guide_not_in_bundle",
          guideNo: input.techGdlnNo,
          bundleSize: stats.total,
          sourcePortal: "https://www.kosha.or.kr/kosha/data/guideExp.do",
        },
        isError: true,
      };
    }
    return {
      content: [{
        type: "text",
        text: `# ${body.title}\n\n> **지침번호**: ${body.guideNo}\n> **원본 URL**: ${body.sourceUrl}\n> **출처**: 한국산업안전보건공단 (공공누리 출처표시·변경금지)\n> **본문**: ${body.bodyLength.toLocaleString()} chars\n\n---\n\n${body.body}`,
      }],
      structuredContent: {
        guideNo: body.guideNo,
        title: body.title,
        sourceUrl: body.sourceUrl,
        body: body.body,
        bodyLength: body.bodyLength,
        koshaLicense: "공공누리 출처표시·변경금지",
        ...COMMON_RESPONSE_META,
      },
    };
  }

  // 키워드 검색
  if (input.keyword) {
    const results = await searchKoshaGuidesMd(input.keyword, { limit: input.limit });
    if (results.length === 0) {
      return {
        content: [{
          type: "text",
          text: `[NOT_FOUND] '${input.keyword}' 매칭 KOSHA Guide 없음. 다른 키워드 또는 인수 없이 호출하면 전체 1,039건 인덱스 반환.`,
        }],
        structuredContent: { keyword: input.keyword, total: 0, results: [] },
        isError: true,
      };
    }
    const lines = [`# '${input.keyword}' 매칭 ${results.length}건`, ""];
    for (const r of results) {
      lines.push(`## ${r.guideNo} — ${r.title}`);
      lines.push("");
      lines.push(`> 매칭: ...${r.matchedSnippet}...`);
      lines.push("");
    }
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        keyword: input.keyword,
        total: results.length,
        results,
        ...COMMON_RESPONSE_META,
      },
    };
  }

  // 전체 인덱스
  const all = await listKoshaGuidesMd();
  const stats = await getKoshaGuidesStats();
  return {
    content: [{
      type: "text",
      text: `# 번들 KOSHA Guide 인덱스\n\n> 총 **${stats.total}건** · **${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB** MD 본문\n> 단건 조회: \`get_kosha_guide_md({techGdlnNo: "A-1-2018"})\`\n> 키워드 검색: \`get_kosha_guide_md({keyword: "굴착"})\`\n\n${all.slice(0, 30).map((m) => `- ${m.guideNo}`).join("\n")}\n${all.length > 30 ? `\n... 외 ${all.length - 30}건` : ""}`,
    }],
    structuredContent: {
      total: stats.total,
      totalBytes: stats.totalBytes,
      guides: all.map((m) => m.guideNo),
      ...COMMON_RESPONSE_META,
    },
  };
}

export const getKoshaGuideMdTool: ToolDefinition = {
  name: "get_kosha_guide_md",
  title: "번들 KOSHA Guide 본문 조회",
  description:
    "번들 KOSHA Guide 본문 MD 1,039건 단일 통합 조회 (AGENTHQ_API_KEY 없이 동작, offline). 단건 조회 (techGdlnNo='A-1-2018') / 키워드 검색 (keyword='굴착') / 전체 인덱스 (인수 없음). 본문은 PDF → kordoc 추출 (HTML 표 보존, 정확 원본은 sourceUrl). KOSHA Guide 단일 진입점 (Live API 도구 통합·제거).",
  inputSchema,
  handler,
};
