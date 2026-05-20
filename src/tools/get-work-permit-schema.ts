import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  renderSchemaAsMarkdown,
  type DocumentSchema,
} from "../lib/document-schemas.js";

// 작업허가서 — 화기·밀폐공간·정전·고소작업 등 위험작업 사전 허가제
// KOSHA P-94-2021 "안전작업허가 지침" 을 참고해 실무에서 자주 쓰이는 체크리스트를
// 통합했다. 원 지침은 "기본 허가 + 보충 허가" 의 2단 구조를 정의하지만 본 Tool
// 은 LLM 이 바로 쓸 수 있도록 허가 유형별 단일 체크리스트로 평탄화했다.
// 엄밀한 법적 서식이 필요한 경우 KOSHA P-94-2021 원문을 별도 참조하라.

const PERMIT_TYPES = {
  hot_work: "화기작업",
  confined_space: "밀폐공간작업",
  electrical_loto: "정전작업 (LOTO)",
  working_at_height: "고소작업",
  excavation: "굴착작업",
} as const;

type PermitTypeCode = keyof typeof PERMIT_TYPES;

const inputSchema = z.object({
  permitType: z
    .enum([
      "hot_work",
      "confined_space",
      "electrical_loto",
      "working_at_height",
      "excavation",
    ])
    .describe("허가 대상 작업 유형"),
});

type Input = z.infer<typeof inputSchema>;

function typeSpecificFields(permitType: PermitTypeCode) {
  switch (permitType) {
    case "hot_work":
      return {
        legalBasis: "산안기준규칙 §241 (화재 예방)",
        specificChecks: [
          { name: "불티 비산 방지포 설치", mandatory: true },
          { name: "소화기 직근 배치 (2대 이상)", mandatory: true },
          { name: "인근 가연물 제거·차폐", mandatory: true },
          { name: "화재감시자 배치", mandatory: true },
          { name: "작업 후 최소 30분 잔화 확인", mandatory: true },
        ],
      };
    case "confined_space":
      return {
        legalBasis: "산안기준규칙 §619~§645 (밀폐공간 작업)",
        specificChecks: [
          { name: "산소 농도 측정 (18%~23.5%)", mandatory: true },
          { name: "유해가스 측정 (H2S/CO/LEL)", mandatory: true },
          { name: "환기 (강제/자연)", mandatory: true },
          { name: "감시인 배치 (외부)", mandatory: true },
          { name: "송기마스크 또는 공기호흡기", mandatory: true },
          { name: "비상 구조 장비·연락수단", mandatory: true },
        ],
      };
    case "electrical_loto":
      return {
        legalBasis: "산안기준규칙 §319 (정전작업) · KOSHA E-150 LOTO 지침",
        specificChecks: [
          { name: "차단 스위치 잠금 (Lock)", mandatory: true },
          { name: "경고표찰 부착 (Tag)", mandatory: true },
          { name: "검전기로 무전압 확인", mandatory: true },
          { name: "잔류전압 방전", mandatory: true },
          { name: "작업자 접지 연결", mandatory: true },
          { name: "2인 1조 작업", mandatory: true },
        ],
      };
    case "working_at_height":
      return {
        legalBasis: "산안기준규칙 §42~§44 (추락 방지) · §55 (안전난간)",
        specificChecks: [
          { name: "작업발판 고정·강도 확인", mandatory: true },
          { name: "안전대 부착설비 + 안전대 100% tie-off", mandatory: true },
          { name: "안전난간 또는 추락방호망", mandatory: true },
          { name: "개구부 덮개·표시", mandatory: true },
          { name: "기상 조건 (강풍 10m/s 이상 중지)", mandatory: true },
        ],
      };
    case "excavation":
      return {
        legalBasis: "산안기준규칙 §38 별표 4 제6호 (굴착작업)",
        specificChecks: [
          { name: "지하매설물 확인 (가스·전기·통신)", mandatory: true },
          { name: "흙막이 지보공 또는 구배 확보", mandatory: true },
          { name: "지반 침하·균열 일일 점검", mandatory: true },
          { name: "굴착기계 반경 내 출입통제", mandatory: true },
          { name: "승강 사다리 설치", mandatory: true },
        ],
      };
  }
}

function buildSchema(input: Input): DocumentSchema {
  const pt = input.permitType;
  const label = PERMIT_TYPES[pt];
  const typeSpec = typeSpecificFields(pt);

  return {
    docType: "work_permit",
    docTypeKo: `작업허가서 (${label})`,
    purpose: `${label} 시작 전 위험요인 사전 확인과 안전조치 이행을 확인하는 허가서. KOSHA P-94-2021 "안전작업허가 지침" 참고 (원 지침의 기본·보충 허가 2단 구조는 본 Tool 에서 단일 체크리스트로 평탄화).`,
    legalObligation: `${typeSpec.legalBasis} 에 따른 사업주 안전조치 의무. 허가서 형식은 관행이나 의무 조치 미이행 시 산안법 §167 (7년 이하 징역).`,
    frequency: "작업별 발행 (당일 유효)",
    primaryAuthor: "허가자 (관리감독자) → 작업자 수령·서명",
    retention: "3년",
    sections: [
      {
        heading: "1. 기본 정보",
        fields: [
          { name: "허가서 번호", requirement: "mandatory", description: "일련번호 (YYYYMMDD-NN)" },
          { name: "작업명", requirement: "mandatory", description: `${label} 세부 작업` },
          { name: "작업 장소", requirement: "mandatory", description: "현장·세부 위치" },
          { name: "작업 일시", requirement: "mandatory", description: "시작·종료 시각 (유효 시간)" },
          { name: "작업자 명단", requirement: "mandatory", description: "성명·자격·인원수" },
        ],
      },
      {
        heading: "2. 작업 전 필수 확인 항목",
        description: `${label} 전용 체크리스트 (${typeSpec.legalBasis})`,
        fields: typeSpec.specificChecks.map((c) => ({
          name: c.name,
          requirement: c.mandatory ? "mandatory" : "recommended",
          description: "작업 전 확인·서명",
          lawBasis: typeSpec.legalBasis,
        })) as any,
      },
      {
        heading: "3. 보호구 및 안전장비",
        fields: [
          { name: "개인보호구", requirement: "mandatory", description: "KOSHA 인증 제품 지정", lawBasis: "search_ppe_certification" },
          { name: "측정기·감시장비", requirement: pt === "confined_space" || pt === "electrical_loto" ? "mandatory" : "recommended", description: "가스검지기·검전기 등 필요 시" },
          { name: "구조·탈출 장비", requirement: pt === "confined_space" ? "mandatory" : "recommended", description: "구명줄·구조 담당자" },
        ],
      },
      {
        heading: "4. 감시·통제 인력",
        fields: [
          { name: "작업지휘자", requirement: "mandatory", description: "성명·자격" },
          { name: "화재감시자/감시인", requirement: pt === "hot_work" || pt === "confined_space" ? "mandatory" : "recommended", description: "외부 감시 담당" },
          { name: "신호수", requirement: "recommended", description: "중장비·양중 작업 시" },
        ],
      },
      {
        heading: "5. 비상 대응",
        fields: [
          { name: "비상연락처", requirement: "mandatory", description: "119·본사·관할관서" },
          { name: "대피 경로·집결지", requirement: "mandatory", description: "현장 내 지정" },
          { name: "응급조치 담당자", requirement: "mandatory", description: "성명·응급처치 자격" },
        ],
      },
      {
        heading: "6. 서명·허가",
        description: "작업 시작 전 양측 서명 필수",
        fields: [
          { name: "허가자 서명", requirement: "mandatory", description: "관리감독자 또는 안전관리자" },
          { name: "작업자 서명", requirement: "mandatory", description: "작업 내용·안전수칙 숙지 확인" },
          { name: "작업 종료 확인", requirement: "mandatory", description: "작업 종료 후 이상 유무 서명" },
        ],
      },
    ],
    signatureBlock: ["허가자 (관리감독자)", "안전관리자", "작업자 대표", "작업 종료 확인자"],
    relatedLaws: [
      typeSpec.legalBasis.split(" ")[0], // "산안기준규칙"
      "산안법 §38",
      "산안법 §29 (작업자 교육)",
    ],
    relatedTools: [
      "compile_safety_references(workType, docType='work_permit')",
      "get_safety_law_article(ref)",
      "search_ppe_certification(ppeCategory)",
      "verify_safety_basis(claims)",
    ],
    notes: [
      "허가서는 **작업 시작 전 양측 서명** 후에만 유효.",
      "작업 범위·시간 외의 작업 금지. 변경 시 새 허가서 발행.",
      "허가자가 현장 미점검 후 서명하면 관리자 책임. 실측·확인 후 서명.",
      "밀폐공간·화기·정전 작업은 사고 시 중대재해로 직결 → 허가서 누락은 중처법 §4 안전보건확보의무 위반 소지.",
    ],
  };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const schema = buildSchema(input);
  const md = renderSchemaAsMarkdown(schema);
  return {
    content: [{ type: "text", text: md }],
    structuredContent: {
      query: input,
      availableTypes: Object.entries(PERMIT_TYPES).map(([code, label]) => ({
        code,
        label,
      })),
      schema,
    },
  };
}

export const getWorkPermitSchemaTool: ToolDefinition = {
  name: "get_work_permit_schema",
  title: "작업허가서 스키마",
  description:
    "위험작업 사전 허가제용 작업허가서 스키마. 5가지 유형 (화기·밀폐공간·정전/LOTO·고소·굴착) 각각 전용 체크리스트. KOSHA P-94-2021 참고 (원 지침의 기본·보충 허가 2단 구조는 단일 체크리스트로 평탄화 — 엄밀한 법적 서식은 원문 참조). 관련 법령 조문 인용 포함. 양측 서명 구조.",
  inputSchema,
  handler,
};
