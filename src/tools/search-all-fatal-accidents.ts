import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { callKoshaApi } from "../lib/api-client.js";
import { KOSHA_ENDPOINTS } from "../config/constants.js";

// 파일 최상단 상수 — 15119137 사고사망 게시판 조회 (전 업종 상위집합)
// 실제 스펙: /B552468/news_api02/getNews_api02
// callApiId=1040 고정값 필수
const MAX_ROWS = 100;
const DEFAULT_ROWS = 30;

const inputSchema = z.object({
  keyword: z
    .string()
    .optional()
    .describe("제목/내용 키워드"),
  business: z
    .string()
    .optional()
    .describe("업종 (예: '건설업', '제조업', '서비스업')"),
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const endpoint = KOSHA_ENDPOINTS.allFatalAccidents;

  const { parsed, url } = await callKoshaApi({
    api: "allFatalAccidents",
    base: endpoint.base,
    path: endpoint.path,
    params: {
      ...endpoint.extraParams, // callApiId=1040 (필수)
      pageNo: input.pageNo,
      numOfRows: input.numOfRows,
      keyword: input.keyword,
      business: input.business,
    },
    responseFormat: endpoint.responseFormat,
  });

  const items = extractItems(parsed);

  const payload = {
    query: input,
    upstream: url,
    dataId: endpoint.dataId,
    coverage: "전 업종 (건설업 일별 중대재해 15133935 의 상위집합)",
    total: items.length,
    results: items.map((it) => ({
      boardno: it.boardno ?? null,
      summary: it.keyword ?? "",     // KOSHA: keyword 필드가 사고 한 줄 요약
      contents: it.contents ?? "",   // 본문 (HTML 태그 포함 가능)
      business: it.business ?? "",
      attachmentCount: Number(it.atcflcnt ?? 0),
      basisType: "accident_case",
      legalWeight: "reference",
      source: "KOSHA",
    })),
    graphContext: {
      relatedEvents: [
        "event:fall_from_height", "event:trip_slip", "event:overturn_collapse",
        "event:struck_by", "event:fall_object", "event:cave_in",
        "event:caught_in", "event:cut_pierce", "event:electric_shock",
        "event:fire_explosion", "event:msd_overload", "event:chemical_contact",
      ],
      relatedStatistics: ["stat:sif_archive_kosha"],
      relatedDocuments: [
        "doc:ad_hoc/industrial_accident_report",
        "doc:ad_hoc/severe_accident_immediate_report",
      ],
      sources: ["src:kosha_portal", "src:data_go_kr"],
    },
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function extractItems(parsed: unknown): Array<Record<string, any>> {
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as Record<string, any>;
  const body =
    root?.response?.body?.items?.item ??
    root?.response?.body?.items ??
    root?.body?.items?.item ??
    root?.items?.item ??
    root?.items ??
    [];
  return Array.isArray(body) ? body : body ? [body] : [];
}

export const searchAllFatalAccidentsTool: ToolDefinition = {
  name: "search_all_fatal_accidents",
  title: "전 업종 사고사망 게시판 (15119137)",
  description:
    "KOSHA **사고사망 게시판**(15119137, /news_api02, callApiId=1040) — **전 업종 최신 사망사고 공지**. 건설업 일별(15133935, 2017~2021 고정) 의 상위집합으로 가장 최신 기록을 포함. **구분:** 건설만 필요하면 search_construction_fatal_accidents, 구조화된 원인-대책 패턴은 search_sif_archive. 건설 외 업종 비교·전국 기준선 확인 용도.",
  inputSchema,
  handler,
};
