import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { callKoshaApi } from "../lib/api-client.js";
import {
  KOSHA_ENDPOINTS,
  MSDS_DISCLAIMER,
  MSDS_SECTIONS,
} from "../config/constants.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { stringBool } from "../lib/zod-helpers.js";

// 파일 최상단 상수 — 15001197 물질안전보건자료(MSDS) 조회
// 2026-04-25 정정 (실측 검증):
//   목록: /B552468/msdschem/getChemList (XML 전용)
//   상세: /B552468/msdschem/getChemDetail{01..16} — 16섹션 별도 엔드포인트
//   목록 파라미터: searchWrd (검색어), searchCnd (검색조건 0=화학물질명 기본)
//   상세 파라미터: chemId (목록 응답의 chemId 필드)
//   "벤젠" 검색 시 totalCount=777
const MAX_ROWS = 50;
const DEFAULT_ROWS = 10;
const MAX_DETAIL_ITEMS = 5; // 상세 조회는 상위 N건만 (비용 통제)
const DETAIL_CONCURRENCY = 4; // 섹션 상세 호출 동시 실행 상한

const inputSchema = z.object({
  searchWrd: z
    .string()
    .min(1)
    .describe("검색어 — 화학물질명 한글/영문 또는 CAS 번호 (예: '벤젠', 'benzene', '71-43-2')"),
  searchCnd: z
    .union([z.literal("0"), z.literal(0)])
    .optional()
    .describe("검색조건 코드 (현재 0=화학물질명 기본 검색만 작동 확인)"),
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
  sections: z
    .array(z.coerce.number().int().min(1).max(16))
    .optional()
    .describe(
      "조회할 MSDS 섹션 번호 배열 (1~16). 예: [2,8] = 유해성·위험성 + 노출방지/보호구. 지정 시 상위 5건에 대해 상세 섹션 병합 조회.",
    ),
  summaryOnly: stringBool
    .optional()
    .default(false)
    .describe("true 면 목록만 반환, sections 상세는 건너뜀 (토큰 절약)"),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const listEndpoint = KOSHA_ENDPOINTS.msdsList;
  const listResp = await callKoshaApi({
    api: "msds",
    base: listEndpoint.base,
    path: listEndpoint.path,
    params: {
      pageNo: input.pageNo,
      numOfRows: input.numOfRows,
      searchWrd: input.searchWrd,
      searchCnd: input.searchCnd ?? "0",
    },
    responseFormat: listEndpoint.responseFormat,
  });

  const items = extractItems(listResp.parsed);

  // 섹션 상세 조회 (옵션) — summaryOnly 면 건너뜀
  let sectionDetails: Array<Record<string, unknown>> = [];
  if (
    !input.summaryOnly &&
    input.sections &&
    input.sections.length > 0 &&
    items.length > 0
  ) {
    const topN = items.slice(0, Math.min(items.length, MAX_DETAIL_ITEMS));
    const secEndpoint = KOSHA_ENDPOINTS.msdsDetailSections;

    // 전체 (물질 × 섹션) 조합을 평탄화 후 concurrency 제한
    const jobs: Array<{ itemIdx: number; section: number; chemId: string }> = [];
    for (let i = 0; i < topN.length; i += 1) {
      const it = topN[i];
      // chemId는 KOSHA에서 6자리 zero-padded 필요 (예: 001008). XML 파서가 정수로 변환하므로 명시적으로 패딩
      const rawId = it.chemId;
      if (rawId === undefined || rawId === null || rawId === "") continue;
      const chemId = String(rawId).padStart(6, "0");
      for (const section of input.sections) {
        jobs.push({ itemIdx: i, section, chemId });
      }
    }

    const results = await mapWithConcurrency(
      jobs,
      DETAIL_CONCURRENCY,
      async (job) => {
        try {
          const resp = await callKoshaApi({
            api: "msds",
            base: secEndpoint.base,
            path: secEndpoint.pathTemplate(job.section),
            params: { chemId: job.chemId },
            responseFormat: secEndpoint.responseFormat,
          });
          return {
            ...job,
            ok: true as const,
            sectionName: MSDS_SECTIONS[job.section],
            body: extractDetail(resp.parsed),
          };
        } catch (err) {
          return {
            ...job,
            ok: false as const,
            sectionName: MSDS_SECTIONS[job.section],
            error: (err as Error).message,
          };
        }
      },
    );

    // 결과를 물질별로 재조립
    const grouped = topN.map((it, i) => {
      const rawId = it.chemId;
      if (rawId === undefined || rawId === null || rawId === "") return { chemId: null, error: "no_chemId" };
      const chemId = String(rawId).padStart(6, "0");
      const perSection: Record<number, unknown> = {};
      for (const r of results) {
        if (r.itemIdx !== i) continue;
        perSection[r.section] = r.ok
          ? { sectionName: r.sectionName, body: r.body }
          : { sectionName: r.sectionName, error: "error" in r ? r.error : "unknown_error" };
      }
      return {
        chemId,
        chemicalName: it.chemNameKor ?? "",
        casNo: it.casNo ?? "",
        sections: perSection,
      };
    });
    sectionDetails = grouped;
  }

  const payload = {
    query: input,
    upstream: listResp.url,
    dataId: listEndpoint.dataId,
    disclaimer: MSDS_DISCLAIMER,
    responseFormat: "xml",
    total: items.length,
    results: items.map((it) => ({
      chemId: it.chemId !== undefined && it.chemId !== null && it.chemId !== ""
        ? String(it.chemId).padStart(6, "0")  // detail 조회용 6자리 패딩
        : "",
      chemNameKor: it.chemNameKor ?? "",        // 한글 화학물질명
      casNo: it.casNo ?? "",                    // CAS 번호
      enNo: it.enNo ?? "",                      // EU 번호
      keNo: it.keNo ?? "",                      // 한국 등록번호
      unNo: it.unNo ?? "",                      // UN 번호
      lastDate: it.lastDate ?? "",              // 최종 갱신일
      koshaConfirm: it.koshaConfirm ?? "",      // KOSHA 확인 여부
      basisType: "msds",
      legalWeight: "reference",
      source: "KOSHA",
    })),
    ...(sectionDetails.length > 0 ? { sectionDetails } : {}),
    availableSections: MSDS_SECTIONS,
    graphContext: {
      relatedHazards: [
        "hazard:chemical_exposure",
        "hazard:chemical_burn",
        "hazard:fire_explosion",
        "hazard:acute_toxic_gas",
      ],
      relatedControls: [
        "control:admin_msds",
        "control:eric_substitute",
        "control:eric_engineering",
        "control:eric_ppe",
      ],
      relatedDocuments: [
        "doc:continuous/msds_register",
        "doc:ad_hoc/work_plan_chemical_facility",
      ],
      legalBasis: ["art:산안법:110", "art:산안법:111", "art:산안법:112", "art:산안법:113", "art:산안법:114"],
      sources: ["src:msds_kosha", "src:kosha_portal"],
      assessmentMethod: "method:chemical",
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

// 섹션 상세 응답: items.item 이 배열 (msdsItemCode 별 항목 다수). 모두 평탄화 반환
function extractDetail(parsed: unknown): Array<Record<string, any>> {
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as Record<string, any>;
  const body =
    root?.response?.body?.items?.item ??
    root?.response?.body?.items ??
    root?.body?.items?.item ??
    root?.body?.items ??
    [];
  return Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
}

export const searchMsdsTool: ToolDefinition = {
  name: "search_msds",
  title: "MSDS 조회 (15001197)",
  description:
    "KOSHA 물질안전보건자료(15001197, /B552468/msdschem). searchWrd로 화학물질명(한글/영문) 또는 CAS 번호 검색. sections=[2,8] 같은 배열을 주면 상위 5건에 대해 해당 MSDS 섹션(1=제품정보/2=유해성·위험성/3=구성성분/4=응급조치/5=폭발·화재/6=누출/7=취급저장/8=노출방지·보호구/9=물리화학특성/10=안정성·반응성/11=독성/12=환경/13=폐기/14=운송/15=법적규제/16=기타) 상세를 chemId로 병합 조회한다. XML 전용. 모든 응답에 참고용 고지 자동 첨부.",
  inputSchema,
  handler,
};
