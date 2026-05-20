import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  renderSchemaAsMarkdown,
  type DocumentSchema,
  type SchemaField,
} from "../lib/document-schemas.js";

// 파일 최상단 상수 — 산안기준규칙 §38 별표 4 작업계획서 13종
const WORK_TYPES = {
  tower_crane: "타워크레인 설치·조립·해체",
  vehicle_cargo: "차량계 하역운반기계 사용",
  vehicle_construction: "차량계 건설기계 사용",
  chemical: "화학설비 사용",
  electric: "전기작업 (50V 또는 250VA 초과)",
  excavation: "굴착 (높이 2m 이상)",
  tunnel: "터널굴착",
  bridge: "교량 설치·해체·변경 (5m/30m 이상)",
  quarry: "채석",
  demolition: "건물 해체",
  heavy_lifting: "중량물 취급",
  railway_maintenance: "궤도 보수·점검",
  railway_shunting: "입환작업",
} as const;

type WorkTypeCode = keyof typeof WORK_TYPES;

// 공종별 사전조사·작업계획서 필수 항목 (별표 4 기반)
const WORKTYPE_FIELDS: Record<WorkTypeCode, { preInvestigation: string[]; planFields: string[] }> = {
  tower_crane: {
    preInvestigation: ["풍속 측정 (작업 제한 10m/s, 설치·수리 금지 15m/s)"],
    planFields: ["타워크레인 종류·형식", "설치·조립·해체 순서", "작업도구·장비·가설설비·방호설비", "작업인원 구성·역할", "§142 지지방법"],
  },
  vehicle_cargo: {
    preInvestigation: [],
    planFields: ["추락·낙하·전도·협착·붕괴 위험 예방대책", "운행경로 및 작업방법"],
  },
  vehicle_construction: {
    preInvestigation: ["기계의 굴러떨어짐·지반 침하 위험"],
    planFields: ["차량계 건설기계 종류·성능", "운행경로", "작업방법"],
  },
  chemical: {
    preInvestigation: [],
    planFields: ["밸브·콕 조작", "냉각·가열·교반·압축장치 조작"],
  },
  electric: {
    preInvestigation: [],
    planFields: ["전기작업 목적·내용", "근로자 자격·적정 인원", "작업 범위·책임자 임명", "전격·섬락 보호구 착용"],
  },
  excavation: {
    preInvestigation: ["형상·지질·지층 상태", "균열·함수·용수·동결", "매설물 유무", "지하수위"],
    planFields: ["굴착 방법·순서", "토사 반출 방법", "인원·장비 사용계획", "매설물 이설·보호", "연락·신호방법", "흙막이 지보공 설치·계측", "작업지휘자 배치"],
  },
  tunnel: {
    preInvestigation: ["보링 등으로 지형·지질·지층 상태 조사"],
    planFields: ["굴착 방법", "터널지보공·복공 시공방법·용수 처리", "환기·조명 설치방법"],
  },
  bridge: {
    preInvestigation: [],
    planFields: ["작업 방법·순서", "부재 낙하·전도·붕괴 방지", "근로자 추락 방지", "가설 철구조물 설치·사용·해체 안전성 검토", "기계 종류·성능", "작업지휘자 배치"],
  },
  quarry: {
    preInvestigation: ["지반 붕괴·굴착기계 굴러떨어짐 위험 → 지형·지질·지층"],
    planFields: ["노천/갱내 구별·채석방법", "굴착면 높이·기울기", "소단 위치·넓이", "갱내 낙반·붕괴방지", "발파·분할 방법", "가공장소", "굴착기계등 종류·성능", "적재·운반 방법·경로", "표토·용수 처리"],
  },
  demolition: {
    preInvestigation: ["해체건물 구조·주변 상황"],
    planFields: ["해체 방법·순서도면", "가설·방호·환기·살수·방화 설비", "연락방법", "해체물 처분계획", "해체작업용 기계·기구 계획서", "화약류 사용계획서"],
  },
  heavy_lifting: {
    preInvestigation: [],
    planFields: ["추락 예방 안전대책", "낙하 예방", "전도 예방", "협착 예방", "붕괴 예방"],
  },
  railway_maintenance: {
    preInvestigation: [],
    planFields: ["작업 인원·작업량", "작업순서·방법", "위험요인 안전조치방법"],
  },
  railway_shunting: {
    preInvestigation: [],
    planFields: ["작업 인원·작업량", "작업순서·방법", "위험요인 안전조치방법"],
  },
};

const inputSchema = z.object({
  workType: z
    .enum([
      "tower_crane",
      "vehicle_cargo",
      "vehicle_construction",
      "chemical",
      "electric",
      "excavation",
      "tunnel",
      "bridge",
      "quarry",
      "demolition",
      "heavy_lifting",
      "railway_maintenance",
      "railway_shunting",
      "other",
    ])
    .default("other")
    .describe(
      "작업계획서 대상 공종 (산안기준규칙 §38 ①). other 는 일반 구조만 반환.",
    ),
});

type Input = z.infer<typeof inputSchema>;

function buildSchema(input: Input): DocumentSchema {
  const wt = input.workType;
  const isSpecific = wt !== "other";
  const label = isSpecific ? WORK_TYPES[wt as WorkTypeCode] : "일반";

  const preInvFields: SchemaField[] = isSpecific
    ? WORKTYPE_FIELDS[wt as WorkTypeCode].preInvestigation.map((t) => ({
        name: t,
        requirement: "mandatory",
        description: "산안기준규칙 §38 별표 4 제" + toHoNumber(wt as WorkTypeCode) + "호 사전조사 항목",
        lawBasis: "산안기준규칙 §38 별표 4",
      }))
    : [
        {
          name: "작업장 지형·지반·지층 상태",
          requirement: "mandatory",
          description: "산안기준규칙 §38 ① 일반 사전조사",
          lawBasis: "산안기준규칙 §38",
        },
      ];

  const planFieldList: SchemaField[] = isSpecific
    ? WORKTYPE_FIELDS[wt as WorkTypeCode].planFields.map((t) => ({
        name: t,
        requirement: "mandatory",
        description: "별표 4 제" + toHoNumber(wt as WorkTypeCode) + "호 작업계획서 필수 내용",
        lawBasis: "산안기준규칙 §38 별표 4",
      }))
    : [
        {
          name: "작업 방법·순서",
          requirement: "mandatory",
          description: "단계별 작업 절차",
        },
        {
          name: "사용 장비·인원",
          requirement: "mandatory",
          description: "장비 종류·성능·작업자 구성",
        },
        {
          name: "위험요인·안전조치",
          requirement: "mandatory",
          description: "예상 위험요인별 조치",
        },
      ];

  return {
    docType: "work_plan",
    docTypeKo: `작업계획서 (${label})`,
    purpose:
      "근로자 위험 방지를 위한 사전조사와 작업계획 수립 (산안기준규칙 §38 ①)",
    legalObligation:
      `산업안전보건법 §38·산안기준규칙 §38 ① 별표 4 ${isSpecific ? "제" + toHoNumber(wt as WorkTypeCode) + "호" : ""} 법정 의무. 위반 시: 단순 미작성·미통지는 산안법 §175 (5천만원 이하 과태료). 위반으로 근로자 사망 시 산안법 §167 (7년 이하 징역 또는 1억원 이하 벌금) 가중 적용.`,
    frequency: "해당 작업 착수 전 매건 작성",
    primaryAuthor: "사업주 (현장소장/안전관리자 작성, 근로자 주지 의무)",
    retention: "작업 완료 시까지 현장 비치 + 관련 기록 3년 보존",
    sections: [
      {
        heading: "1. 기본 정보",
        fields: [
          { name: "공사명·공정명", requirement: "mandatory", description: "공식 공사명과 해당 공정" },
          { name: "작업 일자·기간", requirement: "mandatory", description: "YYYY-MM-DD ~ YYYY-MM-DD" },
          { name: "작업 장소", requirement: "mandatory", description: "현장 주소·세부 위치" },
          { name: "작업 종류", requirement: "mandatory", description: "별표 4 어느 호에 해당하는지", example: isSpecific ? label : "해당 없음" },
          { name: "작성일·작성자", requirement: "mandatory", description: "성명·직책·서명" },
        ],
      },
      {
        heading: "2. 사전조사 결과",
        description: "산안기준규칙 §38 ① 사전조사 의무 사항 기록",
        fields: preInvFields,
      },
      {
        heading: "3. 작업계획",
        description: "별표 4 의 공종별 필수 내용",
        fields: planFieldList,
      },
      {
        heading: "4. 안전보건 조치",
        fields: [
          { name: "관리감독자 지정", requirement: "mandatory", description: "성명·연락처·책임 범위" },
          { name: "개인보호구", requirement: "mandatory", description: "종류·착용 기준 (KOSHA 인증 제품)", lawBasis: "search_ppe_certification" },
          { name: "안전시설", requirement: "mandatory", description: "추락방호망·안전난간·경계표시 등" },
          { name: "TBM 계획", requirement: "mandatory", description: "작업 전 안전점검회의" },
          { name: "교육 계획", requirement: "recommended", description: "특별안전교육 대상 시 필수", lawBasis: "산안법 §29 ③" },
        ],
      },
      {
        heading: "5. 비상 대응",
        fields: [
          { name: "비상연락체계", requirement: "mandatory", description: "119·본사·관할관서" },
          { name: "응급조치 계획", requirement: "mandatory", description: "구급차·응급처치 담당" },
          { name: "사고 발생 시 보고 절차", requirement: "recommended", description: "산안법 §57 보고 의무" },
        ],
      },
      {
        heading: "6. 근로자 주지",
        description: "산안기준규칙 §38 ② — 작업계획서 내용을 근로자에게 알릴 의무",
        fields: [
          { name: "주지 방법", requirement: "mandatory", description: "TBM·게시·교육" },
          { name: "주지 일시·참여 근로자 서명", requirement: "mandatory", description: "명단·서명 첨부" },
        ],
      },
    ],
    signatureBlock: ["작성자", "현장소장", "안전관리자", "관리감독자", "근로자대표"],
    relatedLaws: [
      "산안기준규칙 §38",
      "산안법 §38",
      "산안법 §29",
      "산안법 §57",
    ],
    relatedTools: [
      "compile_safety_references(workType, docType='work_plan')",
      "get_safety_law_article(ref='산안기준규칙 §38')",
      "search_construction_fatal_accidents",
      "search_ppe_certification",
      "verify_safety_basis(claims)",
      "// 문서 필드 누락·별표 4 이행 검증은 별도 프로젝트 agent-quality-oss-mcp 범위",
    ],
    notes: [
      "산안기준규칙 §38 ① 13종 작업은 **법정 의무**. 단순 미작성·미통지 시 산안법 §175 (5천만원 이하 과태료). 위반으로 근로자 사망 시 §167 (7년 이하 징역 또는 1억원 벌금) 가중.",
      "별표 4 의 각 호별 필수 항목을 **모두** 포함해야 함. 일부 누락도 위반.",
      "작업 변경 시 계획서 재작성. 원본은 현장 비치.",
      "도급공사는 도급인·수급인이 별도 작성 후 공유.",
    ],
  };
}

function toHoNumber(wt: WorkTypeCode): string {
  const order: WorkTypeCode[] = [
    "tower_crane",
    "vehicle_cargo",
    "vehicle_construction",
    "chemical",
    "electric",
    "excavation",
    "tunnel",
    "bridge",
    "quarry",
    "demolition",
    "heavy_lifting",
    "railway_maintenance",
    "railway_shunting",
  ];
  const idx = order.indexOf(wt);
  return idx >= 0 ? String(idx + 1) : "?";
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const schema = buildSchema(input);
  const md = renderSchemaAsMarkdown(schema);

  return {
    content: [{ type: "text", text: md }],
    structuredContent: {
      query: input,
      availableWorkTypes: Object.entries(WORK_TYPES).map(([code, label]) => ({
        code,
        label,
      })),
      schema,
    },
  };
}

export const getWorkPlanSchemaTool: ToolDefinition = {
  name: "get_work_plan_schema",
  title: "작업계획서 스키마",
  description:
    "작업계획서 작성 스키마 (산안기준규칙 §38 ① 별표 4 13종). workType 으로 공종 선택 시 해당 호의 사전조사·작업계획 필수 항목을 자동 구성. LLM 은 이 스키마의 필수 필드를 채워 초안 작성. 별표 4 원문은 `get_safety_law_article('산안기준규칙 §38')` 로 조회.",
  inputSchema,
  handler,
};
