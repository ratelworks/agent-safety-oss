import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { callKoshaApi } from "../lib/api-client.js";
import { KOSHA_ENDPOINTS } from "../config/constants.js";

// 파일 최상단 상수 — 15133935 건설업 일별 중대재해 현황
// 실제 스펙(2026-04-25 영문 가이드 검증):
//   endpoint: /B552468/constDsstr01/getconstDsstr01 (JSON)
//   필수: callApiId=1010 (extraParams 자동), dsstrDy=YYYYMMDD
//   응답 필드: jobPrcsNm/dtlJobPrcsNm/ocmtNm/dsstrKndNm/dsstrDtlCn/rsknsDcrsMsrsCn
const MAX_ROWS = 100;
const DEFAULT_ROWS = 30;

const inputSchema = z.object({
  dsstrDy: z
    .string()
    .regex(/^\d{8}$/, "YYYYMMDD 8자리")
    .describe("재해일자 YYYYMMDD (필수, 예: '20210601'). 공개 범위 2017~2021"),
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const endpoint = KOSHA_ENDPOINTS.constructionFatal;

  const { parsed, url } = await callKoshaApi({
    api: "constructionFatal",
    base: endpoint.base,
    path: endpoint.path,
    params: {
      ...endpoint.extraParams, // callApiId=1010 (필수)
      pageNo: input.pageNo,
      numOfRows: input.numOfRows,
      dsstrDy: input.dsstrDy,
    },
    responseFormat: endpoint.responseFormat,
  });

  const items = extractItems(parsed);

  const payload = {
    query: input,
    upstream: url,
    dataId: endpoint.dataId,
    dataRangeNotice:
      "포털 공개 데이터 범위는 2017~2021 (실시간 갱신 아님). 최신 사고는 search_all_fatal_accidents (15119137) 참조.",
    total: items.length,
    results: items.map((it) => ({
      jobProcess: it.jobPrcsNm ?? "",        // 작업공종 (예: '맨홀 및 관부설작업')
      jobProcessDetail: it.dtlJobPrcsNm ?? "", // 세부공정
      causeObject: it.ocmtNm ?? "",            // 기인물 (예: '토사')
      accidentType: it.dsstrKndNm ?? "",       // 재해종류 (예: '붕괴')
      summary: it.dsstrDtlCn ?? "",            // 사고개요
      controls: it.rsknsDcrsMsrsCn ?? "",      // 위험성 감소대책 ⭐
      basisType: "statistics",
      legalWeight: "reference",
      source: "KOSHA",
    })),
    graphContext: {
      relatedStatistics: [
        "stat:construction_fatal_top_5",
        "stat:industrial_accident_construction_share",
        "stat:sif_archive_kosha",
      ],
      relatedEvents: [
        "event:fall_from_height",  // 추락 (건설 1위)
        "event:caught_in",         // 끼임
        "event:struck_by",         // 부딪힘
        "event:cave_in",           // 무너짐
        "event:fall_object",       // 맞음
        "event:electric_shock",    // 감전
      ],
      relatedHazards: [
        "hazard:fall_from_height",
        "hazard:cave_in",
        "hazard:struck_by",
        "hazard:fall_object",
        "hazard:crushing",
        "hazard:electric_shock",
      ],
      relatedDocuments: [
        "doc:ad_hoc/industrial_accident_report",
        "doc:ad_hoc/severe_accident_immediate_report",
        "doc:semi_annual/severe_accident_compliance",
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

export const searchConstructionFatalAccidentsTool: ToolDefinition = {
  name: "search_construction_fatal_accidents",
  title: "건설업 중대재해 검색 (15133935)",
  description:
    "KOSHA **건설업 일별 중대재해 현황**(15133935, /constDsstr01) — **건설업 한정 건별 실제 기록**. 공개 범위 2017~2021 고정 (실시간 갱신 아님). **구분:** 전 업종(건설 포함) 최신 기록은 search_all_fatal_accidents, 구조화된 원인-대책 패턴은 search_sif_archive. 응답 필드: 작업공종(wrkTypNm), 기인물(cauObjNm), 재해종류(acdntTypNm), 재해개요(acdntCtnt), 위험성 감소대책(rskRdctPln).",
  inputSchema,
  handler,
};
