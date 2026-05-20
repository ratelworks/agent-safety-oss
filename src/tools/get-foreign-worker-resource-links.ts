import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";

// 파일 최상단 상수 — 외국인 근로자 대상 KOSHA 자료는 라이선스(변경금지) 문제로
// 번들하지 않는다. 대신 KOSHA 포털의 검색 딥링크를 조립해 반환하고, LLM 또는
// 사용자가 브라우저/WebFetch 로 직접 접근하도록 안내한다.

const LANGUAGE_MAP = {
  ko: { ko: "한국어", en: "Korean" },
  en: { ko: "영어", en: "English" },
  vi: { ko: "베트남어", en: "Vietnamese" },
  th: { ko: "태국어", en: "Thai" },
  ne: { ko: "네팔어", en: "Nepali" },
  km: { ko: "크메르어", en: "Khmer (Cambodian)" },
  zh: { ko: "중국어", en: "Chinese" },
  uz: { ko: "우즈베크어", en: "Uzbek" },
  mn: { ko: "몽골어", en: "Mongolian" },
  id: { ko: "인도네시아어", en: "Indonesian" },
  my: { ko: "미얀마어", en: "Burmese" },
  lo: { ko: "라오스어", en: "Lao" },
  ru: { ko: "러시아어", en: "Russian" },
} as const;

type LanguageCode = keyof typeof LANGUAGE_MAP;

const inputSchema = z.object({
  language: z
    .enum([
      "ko",
      "en",
      "vi",
      "th",
      "ne",
      "km",
      "zh",
      "uz",
      "mn",
      "id",
      "my",
      "lo",
      "ru",
    ])
    .describe("외국인 근로자 모국어 코드 (KOSHA 가 공식 제공하는 13개 언어)"),
  topic: z
    .string()
    .optional()
    .describe("주제·업종 키워드 (예: '건설', '비계', '밀폐공간')"),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const langInfo = LANGUAGE_MAP[input.language as LanguageCode];

  // KOSHA 포털·본 홈페이지 검색 딥링크 (실제 URL 패턴은 SPA 라
  // 사용자/LLM 이 브라우저/WebFetch 로 열 때 해석됨)
  const topicParam = input.topic ? encodeURIComponent(input.topic) : "";
  const langParam = encodeURIComponent(input.language);
  const langKoParam = encodeURIComponent(langInfo.ko);

  const deepLinks = [
    {
      site: "portal.kosha.or.kr (안전보건자료실)",
      url: `https://portal.kosha.or.kr/archive/cent-archive/master-arch?searchType=all&searchVal=${topicParam || langKoParam}&ctgr01=0`,
      note: "KOSHA 산업안전포털 통합 자료실. 외국인 자료 카테고리 필터 필요.",
    },
    {
      site: "kosha.or.kr (외국인 근로자 자료)",
      url: `https://www.kosha.or.kr/kosha/data/foreignWorkerData.do?keyword=${topicParam}&lang=${langParam}`,
      note: "KOSHA 본 홈페이지 외국인 근로자 자료 페이지 (언어별 필터).",
    },
    {
      site: "data.go.kr (안전보건자료 링크 서비스 15139398)",
      url: `https://www.data.go.kr/data/15139398/openapi.do`,
      note: "이 프로젝트의 search_safety_materials Tool 이 호출하는 공식 API. foreignLanguage 파라미터 지원.",
    },
  ];

  const payload = {
    query: {
      language: input.language,
      languageKo: langInfo.ko,
      languageEn: langInfo.en,
      topic: input.topic,
    },
    deepLinks,
    apiAlternative: {
      tool: "search_safety_materials",
      argument: { foreignLanguage: input.language, keyword: input.topic },
      requirement:
        "DATA_GO_KR_KEY 또는 KOSHA_SAFETY_MATERIAL_KEY 환경변수 필요. 키 없이도 이 Tool 은 URL 안내 반환.",
    },
    supportedLanguages: Object.entries(LANGUAGE_MAP).map(([code, names]) => ({
      code,
      ko: names.ko,
      en: names.en,
    })),
    notes: [
      "KOSHA 포털 페이지는 SPA 라 검색 결과를 받으려면 브라우저 또는 WebFetch 에서 JavaScript 렌더 후 읽어야 한다.",
      "LLM 에이전트는 이 응답의 deepLinks 를 사용자에게 전달해 브라우저로 열도록 안내하거나, WebFetch 기능이 있다면 직접 fetch 해 콘텐츠 요약 가능.",
      "정확한 언어별 자료는 search_safety_materials Tool (API 키 필요) 이 최신 KOSHA 인덱스를 반환.",
    ],
    basisType: "safety_material",
    legalWeight: "reference",
    source: "KOSHA (URL 참조)",
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export const getForeignWorkerResourceLinksTool: ToolDefinition = {
  name: "get_foreign_worker_resource_links",
  title: "외국인 근로자 안전자료 URL",
  description:
    "KOSHA 가 공식 제공하는 **13개 언어 외국인 근로자 안전자료** 페이지의 검색 딥링크를 조립해서 반환한다. 네트워크 호출 없이 URL 계산만 수행 (API 키 불필요). LLM 또는 사용자가 브라우저·WebFetch 로 직접 열어 콘텐츠를 받는다. 공식 API 버전은 search_safety_materials (키 필요). 번들 데이터로 포함하지 않은 이유: 공공누리 변경금지·저작권 복잡성.",
  inputSchema,
  handler,
};
