import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { callKoshaApi } from "../lib/api-client.js";
import { KOSHA_ENDPOINTS } from "../config/constants.js";

// 파일 최상단 상수 — 15121001 국내재해사례 게시판 정보 조회
// 실제 스펙(2026-04-25 영문 가이드 검증):
//   endpoint: /B552468/disaster_api02/getdisaster_api02 (JSON)
//   필수: callApiId=1060 (constants.ts extraParams 자동 머지)
const MAX_ROWS = 100;
const DEFAULT_ROWS = 20;

const inputSchema = z.object({
  keyword: z
    .string()
    .optional()
    .describe("제목/내용 키워드 (예: '추락', '협착')"),
  business: z
    .enum(["manufacturing", "construction", "shipbuilding", "service", "all"])
    .default("all")
    .describe(
      "업종 필터 (upstream 에 한글로 매핑: manufacturing→제조업, construction→건설업, shipbuilding→조선업, service→서비스업)",
    ),
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
});

type Input = z.infer<typeof inputSchema>;

const BUSINESS_MAP: Record<Input["business"], string | undefined> = {
  manufacturing: "제조업",
  construction: "건설업",
  shipbuilding: "조선업",
  service: "서비스업",
  all: undefined,
};

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const endpoint = KOSHA_ENDPOINTS.accidentCase;

  const { parsed, url } = await callKoshaApi({
    api: "accidentCase",
    base: endpoint.base,
    path: endpoint.path,
    params: {
      ...endpoint.extraParams, // callApiId=1060 (필수)
      pageNo: input.pageNo,
      numOfRows: input.numOfRows,
      keyword: input.keyword,
      business: BUSINESS_MAP[input.business],
    },
    responseFormat: endpoint.responseFormat,
  });

  const items = extractItems(parsed);

  const payload = {
    query: input,
    upstream: url,
    dataId: endpoint.dataId,
    total: items.length,
    results: items.map((it) => ({
      boardno: it.boardno ?? null,
      summary: it.keyword ?? "",      // KOSHA: keyword 필드가 사고 한 줄 요약
      contents: it.contents ?? "",    // 본문 (HTML 가능)
      business: it.business ?? "",    // 업종
      attachmentCount: Number(it.atcflcnt ?? 0),
      basisType: "accident_case",
      legalWeight: "reference",
      source: "KOSHA",
      hint: it.boardno
        ? `get_accident_case_attachments 에 boardno=${it.boardno} 로 첨부 PDF 조회 가능 (atcflcnt=${it.atcflcnt ?? 0}건)`
        : undefined,
    })),
    graphContext: {
      relatedEvents: [
        "event:fall_from_height", "event:trip_slip", "event:overturn_collapse",
        "event:struck_by", "event:fall_object", "event:cave_in",
        "event:caught_in", "event:cut_pierce", "event:electric_shock",
        "event:fire_explosion", "event:msd_overload", "event:chemical_contact",
      ],
      relatedDocuments: [
        "doc:ad_hoc/industrial_accident_report",
        "doc:ad_hoc/severe_accident_immediate_report",
      ],
      relatedAssessmentMethod: "method:kras_step_2_identify",
      sources: ["src:kosha_portal"],
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

export const searchAccidentCasesTool: ToolDefinition = {
  name: "search_accident_cases",
  title: "국내재해사례 검색 (15121001)",
  description:
    "KOSHA 국내재해사례 게시판(15121001, /disaster_api)에서 업종·키워드로 유사 재해사례를 검색한다. 응답에 boardno 가 포함되며, 이를 get_accident_case_attachments 에 넘기면 첨부 이미지·도면을 추가 조회할 수 있다. (근거 등급: reference)",
  inputSchema,
  handler,
};
