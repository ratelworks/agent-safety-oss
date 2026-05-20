import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { callKoshaApi } from "../lib/api-client.js";
import { KOSHA_ENDPOINTS } from "../config/constants.js";

// 파일 최상단 상수 — 15139497 보호구 안전인증 현황
// 실제 스펙: /B552468/oshci/getoshci (XML 전용)
// pteqgrCrtfcTyCd = BH(보호구) 고정
const MAX_ROWS = 100;
const DEFAULT_ROWS = 20;

const inputSchema = z.object({
  keyword: z
    .string()
    .optional()
    .describe("보호구 품목·모델·제조사 키워드 (예: '안전대', '안전모', '방진마스크')"),
  ppeCategory: z
    .enum([
      "any",
      "safety_helmet",
      "safety_belt",
      "safety_harness",
      "safety_shoes",
      "respirator",
      "goggles",
      "ear_protection",
      "gloves",
      "fall_arrester",
    ])
    .default("any")
    .describe(
      "보호구 카테고리 필터 (내부에서 한글 키워드로 매핑하여 업스트림 keyword 파라미터 보강)",
    ),
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
});

type Input = z.infer<typeof inputSchema>;

const CATEGORY_TO_KEYWORD: Record<Input["ppeCategory"], string | undefined> = {
  any: undefined,
  safety_helmet: "안전모",
  safety_belt: "안전대",
  safety_harness: "안전대",
  safety_shoes: "안전화",
  respirator: "방진마스크",
  goggles: "보안경",
  ear_protection: "귀마개",
  gloves: "보호장갑",
  fall_arrester: "추락방지",
};

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const endpoint = KOSHA_ENDPOINTS.ppeCertification;

  // 카테고리와 keyword 중 있는 값을 합쳐 upstream keyword 구성
  const categoryKw = CATEGORY_TO_KEYWORD[input.ppeCategory];
  const mergedKeyword = [input.keyword, categoryKw]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ");

  const { parsed, url } = await callKoshaApi({
    api: "ppeCertification",
    base: endpoint.base,
    path: endpoint.path,
    params: {
      pageNo: input.pageNo,
      numOfRows: input.numOfRows,
      pteqgrCrtfcTyCd: endpoint.fixedTypeCode,
      keyword: mergedKeyword || undefined,
    },
    responseFormat: endpoint.responseFormat,
  });

  const items = extractItems(parsed);

  const payload = {
    query: input,
    upstream: url,
    dataId: endpoint.dataId,
    responseFormat: "xml",
    total: items.length,
    results: items.map((it) => ({
      // KOSHA 실측 필드명 (oshci/getoshci XML 응답)
      certificationNo: it.crtfcNo ?? "",                  // 인증번호 (crtfcNo, c-r-tfcNo)
      ppeName: it.ptqgrCrtfcPrdlstNm ?? "",               // 인증품목명 (정전기 안전화 가죽제 등)
      manufacturer: it.mfplntNm ?? "",                    // 제조공장명
      model: it.pteqgrFomNm ?? "",                        // 형식 (모델명)
      grade: it.pteqgrCpctyGradNm ?? "",                  // 성능등급
      cancelReason: it.pteqgrCanclResnSeNm ?? "",         // 인증취소 사유 (있으면)
      basisType: "ppe_certification",
      legalWeight: "reference",
      source: "KOSHA",
    })),
    notes: [
      "본 목록은 KOSHA 안전인증 통과 제품이며, 실제 사업장 투입 시에는 작업 환경(화학·고소·전기)에 맞는 세부 등급을 별도로 확인해야 한다.",
      "모든 보호구 착용은 안전보건규칙 및 사업장 위험성평가 결과에 근거해야 한다.",
    ],
    graphContext: {
      certificationApplicability: "applic:safety_certification_13",
      relatedDocuments: [
        "doc:continuous/ppe_register",
        "doc:ad_hoc/safety_certification_application",
      ],
      relatedControls: [
        "control:eric_ppe",
        "control:ppe_helmet",
        "control:ppe_safety_shoes",
        "control:ppe_eye_protection",
        "control:ppe_hearing_protection",
        "control:ppe_respirator",
        "control:ppe_harness",
        "control:ppe_fall_arrester",
        "control:ppe_insulating_gloves",
        "control:ppe_chemical_suit",
      ],
      relatedHazards: [
        "hazard:fall_from_height",
        "hazard:fall_object",
        "hazard:chemical_exposure",
        "hazard:noise_exposure",
        "hazard:electric_shock",
        "hazard:dust_exposure",
      ],
      legalBasis: ["art:산안법:80", "art:산안법:83", "art:산안법시행규칙:74"],
      sources: ["src:moel_safety_inspection", "src:kosha_portal"],
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

export const searchPpeCertificationTool: ToolDefinition = {
  name: "search_ppe_certification",
  title: "보호구 안전인증 검색 (15139497)",
  description:
    "KOSHA 보호구 안전인증 현황(15139497, /oshci/getoshci, 적용분야 BH 고정)에서 안전대·안전모·안전화·방진마스크 등 인증 통과 보호구를 조회한다. 특정 작업 위험요인과 매칭하여 TBM/위험성평가의 PPE 권고에 사용. XML 전용.",
  inputSchema,
  handler,
};
