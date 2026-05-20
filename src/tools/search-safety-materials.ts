import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { callKoshaApi } from "../lib/api-client.js";
import { KOSHA_ENDPOINTS } from "../config/constants.js";

// 파일 최상단 상수 — 15139398 안전보건자료 링크 서비스
// 실제 스펙(2026-04-25 영문 가이드 검증):
//   endpoint: /B552468/selectMediaList01/getselectMediaList01 (JSON)
//   필수: callApiId=1030 (extraParams), ctgr04_kr=Y (extraParams, 한국어 자료)
//   응답 필드: MED_URL, MED_SJ_NM (제목), MED_COMPY_DY (등록일)
//   카테고리 필터: ctgr01=제작유형, ctgr02=업종, ctgr03=재해유형, ctgr04=외국어
const MAX_ROWS = 100;
const DEFAULT_ROWS = 20;

const inputSchema = z.object({
  ctgr01: z.string().optional().describe("제작유형 코드 (책자/OPS/교안/영상)"),
  ctgr02: z.string().optional().describe("업종 코드"),
  ctgr03: z.string().optional().describe("재해유형 코드"),
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const endpoint = KOSHA_ENDPOINTS.safetyMaterial;

  const { parsed, url } = await callKoshaApi({
    api: "safetyMaterial",
    base: endpoint.base,
    path: endpoint.path,
    params: {
      ...endpoint.extraParams, // callApiId=1030, ctgr04_kr=Y (필수)
      pageNo: input.pageNo,
      numOfRows: input.numOfRows,
      ctgr01: input.ctgr01,
      ctgr02: input.ctgr02,
      ctgr03: input.ctgr03,
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
      title: it.MED_SJ_NM ?? "",
      url: it.MED_URL ?? "",
      registeredAt: it.MED_COMPY_DY ?? "",
      basisType: "safety_material",
      legalWeight: "reference",
      source: "KOSHA",
    })),
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

export const searchSafetyMaterialsTool: ToolDefinition = {
  name: "search_safety_materials",
  title: "안전보건자료 링크 검색 (15139398)",
  description:
    "KOSHA 안전보건자료 링크 서비스(15139398, /selectMediaList01)에서 책자·OPS·교안·영상·외국인 자료를 검색한다. 안전교육 자료 추천, 외국인 근로자 대상 TBM 자료 확보에 사용. (근거 등급: reference)",
  inputSchema,
  handler,
};
