import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { callKoshaApi } from "../lib/api-client.js";
import { KOSHA_ENDPOINTS } from "../config/constants.js";

// 파일 최상단 상수 — 15123696 안전보건법령 스마트검색
// 실제 스펙: GET /B552468/srch/smartSearch
// AI 유사어 검색: '보호구' → 안전대·방진마스크·안전인증 자동 확장
// '스카이' → 고소작업대 자동 매칭
const MAX_ROWS = 20;
const DEFAULT_ROWS = 5;

// KOSHA OneAPI 명세: category 0~11 (10 누락)
const CATEGORY_MAP = {
  "0": "전체",
  "1": "산업안전보건법",
  "2": "산업안전보건법 시행령",
  "3": "산업안전보건법 시행규칙",
  "4": "산업안전보건 기준에 관한 규칙",
  "5": "고시·훈령·예규",
  "6": "안전보건 미디어 자료",
  "7": "KOSHA GUIDE",
  "8": "중대재해처벌법",
  "9": "중대재해처벌법 시행령",
  "11": "유해·위험작업의 취업 제한에 관한 규칙",
} as const;

const inputSchema = z.object({
  searchValue: z
    .string()
    .min(1)
    .describe(
      "검색어 (예: '굴착', '보호구', '스카이'). KOSHA AI 유사어 검색이 자동 확장 — '보호구' → 안전대·방진마스크 등.",
    ),
  category: z
    .enum(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "11"])
    .default("0")
    .describe(
      "검색 분류 — 0:전체 / 1:산안법 / 2:시행령 / 3:시행규칙 / 4:기준규칙 / 5:고시·훈령·예규 / 6:미디어 / 7:KOSHA GUIDE / 8:중대재해처벌법 / 9:중대재해처벌법 시행령 / 11:유해위험작업 취업제한규칙",
    ),
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
});

type Input = z.infer<typeof inputSchema>;

interface SmartSearchItem {
  category?: string;
  title?: string;
  content?: string;
  doc_id?: string;
  score?: number;
  highlight_content?: string;
  filepath?: string;
  keyword?: string;
  image_path?: string | string[];
  med_thumb_yn?: string;
  media_style?: string;
}

interface SmartSearchResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      categorycount?: Record<string, number | string>;
      items?: { item?: SmartSearchItem | SmartSearchItem[] };
      total_media?: SmartSearchItem | SmartSearchItem[];
      associated_word?: string[];
      totalCount?: number | string;
      pageNo?: number | string;
      numOfRows?: number | string;
      dataType?: string;
    };
  };
}

function normalizeItems(it?: SmartSearchItem | SmartSearchItem[]): SmartSearchItem[] {
  if (!it) return [];
  return Array.isArray(it) ? it : [it];
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const endpoint = KOSHA_ENDPOINTS.safetyLaw;

  const { parsed, url } = await callKoshaApi<SmartSearchResponse>({
    api: "safetyLaw",
    base: endpoint.base,
    path: endpoint.path,
    params: {
      pageNo: input.pageNo,
      numOfRows: input.numOfRows,
      searchValue: input.searchValue,
      category: input.category,
    },
    responseFormat: endpoint.responseFormat,
  });

  const body = parsed?.response?.body;
  const items = normalizeItems(body?.items?.item);
  const media = normalizeItems(body?.total_media);

  // 카테고리별 매칭 건수 — 사용자가 검색어로 어느 분류에 얼마나 자료가 있는지 한 번에 파악
  const counts: Array<{ category: string; label: string; count: number }> = [];
  if (body?.categorycount) {
    for (const [code, cnt] of Object.entries(body.categorycount)) {
      counts.push({
        category: code,
        label: CATEGORY_MAP[code as keyof typeof CATEGORY_MAP] ?? `unknown(${code})`,
        count: typeof cnt === "string" ? parseInt(cnt, 10) || 0 : cnt,
      });
    }
    counts.sort((a, b) => b.count - a.count);
  }

  const summary = [
    `**스마트검색 결과** — searchValue="${input.searchValue}", category=${input.category}(${CATEGORY_MAP[input.category]})`,
    "",
    `- 매칭 합계: **${body?.totalCount ?? items.length}건** (페이지 ${body?.pageNo ?? input.pageNo})`,
  ];

  if (counts.length > 0) {
    summary.push("", "**카테고리별 매칭 건수**:");
    for (const c of counts.filter((x) => x.count > 0)) {
      summary.push(`- ${c.category} (${c.label}): ${c.count}건`);
    }
  }

  if (body?.associated_word && Array.isArray(body.associated_word) && body.associated_word.length > 0) {
    summary.push("", `**AI 유사어**: ${body.associated_word.join(", ")}`);
  }

  if (items.length > 0) {
    summary.push("", `**상위 ${items.length}건**:`);
    items.forEach((it, i) => {
      const title = (it.title ?? "").trim();
      const content = (it.highlight_content ?? it.content ?? "").trim().slice(0, 180);
      summary.push(
        `${i + 1}. [${CATEGORY_MAP[it.category as keyof typeof CATEGORY_MAP] ?? it.category}] ${title}`,
      );
      if (content) summary.push(`   - ${content.replace(/\n+/g, " ")}…`);
      if (it.doc_id) summary.push(`   - doc_id: \`${it.doc_id}\``);
      if (it.filepath) summary.push(`   - filepath: ${it.filepath}`);
      if (typeof it.score === "number") summary.push(`   - score: ${it.score.toFixed(2)}`);
    });
  }

  if (media.length > 0) {
    summary.push("", `**관련 미디어 자료 (${media.length}건)**:`);
    media.slice(0, 3).forEach((m, i) => {
      const t = (m.title ?? "").trim() || (m.content ?? "").trim().slice(0, 60);
      summary.push(`${i + 1}. ${t}${m.filepath ? ` — ${m.filepath}` : ""}`);
    });
  }

  summary.push(
    "",
    `> 출처: KOSHA 안전보건법령 스마트검색 (data.go.kr 15123696). AI 유사어 검색 — 법률 용어에 익숙하지 않아도 관련 자료 자동 매칭. 본 도구는 검색·인용용이며 법적 강제 효력은 원문(법제처·KOSHA) 기준.`,
  );

  return {
    content: [{ type: "text", text: summary.join("\n") }],
    structuredContent: {
      query: input,
      dataId: "15123696",
      sourceUrl: "https://www.data.go.kr/data/15123696/openapi.do",
      totalCount: body?.totalCount ?? items.length,
      pageNo: body?.pageNo ?? input.pageNo,
      numOfRows: body?.numOfRows ?? input.numOfRows,
      categoryCounts: counts,
      associatedWords: body?.associated_word ?? [],
      items: items.map((it) => ({
        category: it.category,
        categoryLabel: CATEGORY_MAP[it.category as keyof typeof CATEGORY_MAP],
        title: it.title,
        content: it.content,
        highlightContent: it.highlight_content,
        docId: it.doc_id,
        score: it.score,
        filepath: it.filepath,
        keyword: it.keyword,
      })),
      media: media.map((m) => ({
        title: m.title,
        content: m.content,
        docId: m.doc_id,
        filepath: m.filepath,
        score: m.score,
      })),
      _meta: {
        upstreamUrl: url,
        responseFormat: endpoint.responseFormat,
        fetchedAt: new Date().toISOString(),
      },
    },
  };
}

export const searchSafetyLawSmartTool: ToolDefinition = {
  name: "search_safety_law_smart",
  title: "안전보건법령 스마트검색 (15123696)",
  description:
    "KOSHA 안전보건법령 스마트검색 (data.go.kr 15123696) 호출. AI 유사어로 산안법·시행령·시행규칙·기준규칙·고시·중대재해처벌법·KOSHA GUIDE·미디어·취업제한규칙을 한 번에 검색. category=0(전체) 또는 1~11 분류별. '보호구'→안전대·방진마스크 자동 확장, '스카이'→고소작업대 매칭 등 키워드 의미 확장. 응답에는 카테고리별 매칭 건수·AI 유사어·각 자료의 score·doc_id·title·content 포함. (근거 등급: recommended — 검색·인용용, 법적 강제는 원문 기준)",
  inputSchema,
  handler,
};
