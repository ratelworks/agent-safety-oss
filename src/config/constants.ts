// 파일 최상단 상수 — KOSHA(한국산업안전보건공단) 공공데이터포털 엔드포인트
// 제공기관 코드: B552468 (data.go.kr 기준, 6개+신규 4개 모두 동일)
//
// 검증 출처:
//   - taiengineering/tai-api v1.4.0 (프로덕션 운영 중)
//   - jbj338033/safeguard (Python 프로덕션 코드)
//   - tayayayait/kosha-openapi openapi.json
//   - gonryoonden/safety-ai raw swagger 응답 원본
//   - data.go.kr/en 다국어 명세 페이지
//
// 주의:
//   - 일부 응답 필드 정확 키명은 활용가이드 docx 다운로드로 최종 확정 필요
//   - MSDS / 보호구 인증은 XML 전용 (returnType/JSON 미지원)

export const DATA_GO_KR_BASE = "https://apis.data.go.kr";
export const KOSHA_AGENCY_CODE = "B552468";

const koshaPath = (segment: string) => `/${KOSHA_AGENCY_CODE}${segment}`;

// KOSHA Open API 엔드포인트 (v0.1 범위)
export const KOSHA_ENDPOINTS = {
  // ─── 이미 등록됐던 6개 (경로 교정됨) ───

  // 15116595 KOSHA Guide 목록 (파일 데이터) — 번들 매핑으로 사용
  koshaGuideList: {
    dataId: "15116595",
    sourceType: "bundled" as const,
    bundlePath: "ontology/kosha-guide-map.json",
  },

  // 15144147 KOSHA Guide 조회 서비스 (본문 API)
  // 2026-04-25 정정: callApiId=1050 필수 (data.go.kr/en 가이드 + 직접 호출 검증)
  // 검색 파라미터명: techGdlnNm(지침명), techGdlnNo(지침번호), ofancYmd(제정일 YYYYMMDD)
  koshaGuideContent: {
    dataId: "15144147",
    base: DATA_GO_KR_BASE,
    path: koshaPath("/koshaguide/getKoshaGuide"),
    responseFormat: "json" as const,
    extraParams: { callApiId: "1050" },
    verified: true,
  },

  // 15121001 국내재해사례 게시판 조회
  // 2026-04-25 정정: endpoint disaster_api → disaster_api02 (소문자 g)
  //                  callApiId=1060 필수
  accidentCase: {
    dataId: "15121001",
    base: DATA_GO_KR_BASE,
    path: koshaPath("/disaster_api02/getdisaster_api02"),
    responseFormat: "json" as const,
    extraParams: { callApiId: "1060" },
    verified: true,
  },

  // 15121008 국내재해사례 첨부파일 조회
  // 2026-04-25 정정: endpoint disaster_attach_api → disaster_attach_api02
  //                  callApiId=1070 필수, boardno 필수
  accidentCaseAttachment: {
    dataId: "15121008",
    base: DATA_GO_KR_BASE,
    path: koshaPath("/disaster_attach_api02/Disaster_attach_api02"),
    responseFormat: "json" as const,
    extraParams: { callApiId: "1070" },
    verified: true,
  },

  // 15133935 건설업 일별 중대재해 현황
  // 2026-04-25 정정: callApiId=1010 필수, dsstrDy(YYYYMMDD) 필수
  constructionFatal: {
    dataId: "15133935",
    base: DATA_GO_KR_BASE,
    path: koshaPath("/constDsstr01/getconstDsstr01"),
    responseFormat: "json" as const,
    extraParams: { callApiId: "1010" },
    verified: true,
  },

  // 15119137 사고사망 게시판 (전 업종 상위집합)
  // callApiId=1040 고정값 필수
  allFatalAccidents: {
    dataId: "15119137",
    base: DATA_GO_KR_BASE,
    path: koshaPath("/news_api02/getNews_api02"),
    responseFormat: "json" as const,
    extraParams: { callApiId: "1040" },
    verified: true,
  },

  // 15139398 안전보건자료 링크 서비스
  // 2026-04-25 정정: callApiId=1030 필수, ctgr04_kr=Y(한국어 자료) 필수
  safetyMaterial: {
    dataId: "15139398",
    base: DATA_GO_KR_BASE,
    path: koshaPath("/selectMediaList01/getselectMediaList01"),
    responseFormat: "json" as const,
    extraParams: { callApiId: "1030", ctgr04_kr: "Y" },
    verified: true,
  },

  // 15001197 물질안전보건자료(MSDS) 목록 — XML 전용
  // 2026-04-25 최종 정정 (사용자 제공 정확한 URL로 검증):
  //   endpoint: /B552468/msdschem/getChemList (data.go.kr 통합 게이트웨이, 일반 DATA_GO_KR_KEY 사용)
  //   파라미터: searchWrd(검색어), searchCnd(0=기본/화학물질명)
  //   응답 필드: chemId, casNo, chemNameKor, enNo, keNo, lastDate, unNo
  //   "벤젠" 검색 시 777건 정상 응답 확인
  msdsList: {
    dataId: "15001197",
    base: DATA_GO_KR_BASE,
    path: koshaPath("/msdschem/getChemList"),
    responseFormat: "xml" as const,
    verified: true,
  },

  // 15001197 MSDS 섹션 상세 — 16개 섹션별 분리 엔드포인트 (XML)
  // chemId 파라미터 필수 (kmcNo 아님)
  // 응답 필드: msdsItemCode, msdsItemNameKor, itemDetail, lev, ordrIdx, upMsdsItemCode
  msdsDetailSections: {
    dataId: "15001197",
    base: DATA_GO_KR_BASE,
    pathTemplate: (section: number) =>
      koshaPath(`/msdschem/getChemDetail${String(section).padStart(2, "0")}`),
    responseFormat: "xml" as const,
    verified: true,
  },

  // 15139497 보호구 안전인증 현황 — 신규 추가, XML 전용
  // pteqgrCrtfcTyCd = BH(보호구) 고정
  ppeCertification: {
    dataId: "15139497",
    base: DATA_GO_KR_BASE,
    path: koshaPath("/oshci/getoshci"),
    responseFormat: "xml" as const,
    fixedTypeCode: "BH",
    verified: true,
  },

  // 15123696 안전보건법령 스마트검색 (v0.2에서 Tool 추가)
  safetyLaw: {
    dataId: "15123696",
    base: DATA_GO_KR_BASE,
    path: koshaPath("/srch/smartSearch"),
    responseFormat: "json" as const,
    verified: true,
  },
} as const;

// MSDS 16섹션 매핑 — LLM 이 필요한 섹션을 골라 조회
export const MSDS_SECTIONS: Record<number, string> = {
  1: "화학제품과 회사 정보",
  2: "유해성·위험성",
  3: "구성성분 정보",
  4: "응급조치 요령",
  5: "폭발·화재 시 대처방법",
  6: "누출 사고 시 대처방법",
  7: "취급 및 저장방법",
  8: "노출방지 및 개인보호구",
  9: "물리화학적 특성",
  10: "안정성 및 반응성",
  11: "독성에 관한 정보",
  12: "환경에 미치는 영향",
  13: "폐기 시 주의사항",
  14: "운송에 필요한 정보",
  15: "법적 규제현황",
  16: "기타 참고사항",
};

// API 응답 공통 코드
export const RESPONSE_CODES = {
  SUCCESS: "00",
  NO_DATA: "03",
} as const;

// ───── 고지 문구 (모든 응답에 자동 첨부) ─────

export const MSDS_DISCLAIMER =
  "본 자료는 참고용이며, 제조·수입자의 물질안전보건자료(MSDS) 작성·제공·비치 의무를 대체하지 않습니다. 사업장에서는 산업안전보건법령에 따라 실제 취급 물질의 MSDS를 반드시 확인하십시오.";

export const KOSHA_GUIDE_DISCLAIMER =
  "KOSHA Guide는 한국산업안전보건공단의 기술적 권고 기준이며, 법령상 강제력을 갖는 의무 규정이 아닙니다. 법적 의무는 관련 산업안전보건법령을 별도로 확인하십시오.";


// ───── 프로젝트 제공·개발 주체 (모든 Tool 응답에 자동 첨부) ─────

export const PROJECT_CREDITS = {
  providedBy: {
    ko: "황룡건설(주)",
    en: "Hwangryong Construction Co., Ltd. — Safety & Health Planning Department",
    role: "데이터 큐레이션·현장 검증·공공 안전자료 접근성 개선 기획",
    address: {
      ko: "충청남도 아산시 염치읍 충무로 431번길 9",
      en: "9, Chungmu-ro 431beon-gil, Yeomchi-eup, Asan-si, Chungcheongnam-do, Republic of Korea",
    },
    awards: [
      {
        name: "AI·스마트 산업안전기술 우수사례 경진대회 대상",
        grade: "대상",
        grantor: "고용노동부 장관상",
        year: 2025,
      },
      {
        name: "2025년 위험성평가 우수사례 지역 발표대회 우수상",
        grade: "우수상",
        grantor: "대전지방고용노동청장상",
        year: 2025,
      },
    ],
  },
  developedBy: {
    ko: "주식회사 라텔웍스",
    en: "Ratelworks Inc.",
    role: "MCP 서버 설계·구현·오픈소스 유지",
    lead: {
      ko: "이사 황룡",
      en: "Hwang Ryong, Director",
    },
    awards: [
      {
        name: "사이드임팩트 2025 : AI 트랙 우승",
        grade: "우승",
        grantor: "브라이언임팩트재단",
        year: 2026,
      },
    ],
  },
  purpose:
    "건설 현장의 근로자와 안전관리자가 KOSHA 공공 안전자료에 더 쉽게 접근할 수 있도록, LLM 에이전트를 통해 근거 기반으로 활용하게 한다.",
  disclaimer:
    "본 MCP 는 공공 목적 오픈소스 프로젝트이며, 제공 결과는 참고용 초안이다. 실제 적용 시 현장 책임자의 최종 검토와 승인이 필요하다.",
} as const;

// 모든 Tool 응답에 자동 첨부되는 공통 메타 (최소 필드 — 토큰 절약)
// 상세 정보(주소·이사·수상·purpose)는 get_project_info Tool 에서 조회
export const COMMON_RESPONSE_META = {
  providedBy: PROJECT_CREDITS.providedBy.ko,
  developedBy: PROJECT_CREDITS.developedBy.ko,
  license: "MIT (code) + 공공누리 (data)",
  projectInfoTool: "get_project_info",
};

// KOSHA 공공누리 출처 표기 표준 문구 (kosha.or.kr/copyright-policy 의 공식 예시)
// 모든 KOSHA 자료 인용 시 부착 의무 (공공누리 1·2·3·4유형 공통)
export const KOSHA_GONGGONGNURI_ATTRIBUTION =
  "본 저작물은 안전보건공단에서 작성하여 공공누리 [유형] 으로 개방한 [제목] 을 이용하였으며, 해당 저작물은 안전보건공단(www.kosha.or.kr)에서 무료로 다운받으실 수 있습니다.";

// ───── 근거 등급 (LLM 결론에 첨부) ─────
// BASIS_TYPES 는 본 프로젝트의 단일 출처 (SSoT).
// Zod 스키마, verify_safety_basis, Tool 반환값 모두 이 배열을 공유한다.

export const BASIS_TYPES = [
  "law",
  "regulation",
  "kosha_guide",
  "accident_case",
  "safety_material",
  "msds",
  "statistics",
  "ppe_certification",
] as const;

export type BasisType = (typeof BASIS_TYPES)[number];

export const LEGAL_WEIGHTS = ["mandatory", "recommended", "reference"] as const;
export type LegalWeight = (typeof LEGAL_WEIGHTS)[number];

export const EVIDENCE_SOURCES = ["KOSHA", "DATA_GO_KR", "LAW_MCP", "INTERNAL"] as const;

export const BASIS_WEIGHT_MAP: Record<BasisType, LegalWeight> = {
  law: "mandatory",
  regulation: "mandatory",
  kosha_guide: "recommended",
  accident_case: "reference",
  safety_material: "reference",
  msds: "reference",
  statistics: "reference",
  ppe_certification: "reference",
};
