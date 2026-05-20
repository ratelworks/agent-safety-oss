import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  renderSchemaAsMarkdown,
  type DocumentSchema,
} from "../lib/document-schemas.js";
import {
  getKrasMethodMeta,
  type KrasMethodCode,
} from "../lib/kras-methods-loader.js";

// 파일 최상단 상수 — 고시 2024-76호 위험성평가 스키마
// 상시평가 체계 반영: 체크리스트·3단계 판단·OPS 간편법 허용
// kras_method 파라미터로 KRAS 7개 공식 방법 선택 가능

const inputSchema = z.object({
  method: z
    .enum(["3x3_matrix", "3-step", "checklist", "ops", "auto"])
    .default("auto")
    .describe(
      "(레거시 명칭) 위험성평가 방법 (고시 §5) — auto/3x3_matrix/checklist/3-step/ops. KRAS 공식 명칭은 kras_method 파라미터 권장",
    ),
  kras_method: z
    .enum([
      "3step",
      "checklist",
      "key_factor",
      "frequency_severity",
      "occupational_health",
      "chemical",
      "construction_continuous",
    ])
    .optional()
    .describe(
      "KRAS 7개 공식 방법 코드 — 지정 시 해당 방법 가이드를 스키마에 첨부. list_kras_methods 또는 choose_assessment_method 결과의 code 사용",
    ),
  type: z
    .enum(["initial", "regular", "ad_hoc", "ongoing", "auto"])
    .default("auto")
    .describe(
      "평가 유형 (위험성평가 고시 §15) — initial(최초, §15 ①)/regular(정기 1년 재검토, §15 ③)/ad_hoc(수시, §15 ②)/ongoing(상시, §15 ④). ongoing 은 매월·매주·매 작업일 모두 이행 시 수시·정기 갈음",
    ),
});

type Input = z.infer<typeof inputSchema>;

function buildSchema(input: Input): DocumentSchema {
  const isOngoing = input.type === "ongoing";
  return {
    docType: "risk_assessment",
    docTypeKo: `위험성평가서${isOngoing ? " (상시평가)" : ""}`,
    purpose:
      "사업주가 사업장 유해·위험요인을 파악·평가하고 위험성 감소대책을 수립·실행하기 위한 법정 문서 (산안법 §36)",
    legalObligation:
      "산업안전보건법 §36 위반 시 500만원 이하 과태료, 산업재해 발생 시 가중 처벌",
    frequency: isOngoing
      ? "매월 1회 이상 발굴 + 매주 합동 논의·점검 + 매 작업일 작업 전 안전점검회의 (고시 §15 제4항 1·2·3호)"
      : "최초(성립 1개월 내, §15 ①) / 정기(1년 재검토, §15 ③) / 수시(변경·재해 시, §15 ②)",
    primaryAuthor:
      "사업주 (총괄) + 관리감독자 + 안전관리자·보건관리자 + 근로자 (참여 필수, 고시 §6)",
    retention: "3년 (위험성평가 고시 §14 ②)",
    sections: [
      {
        heading: "1. 기본 정보",
        fields: [
          { name: "사업장명", requirement: "mandatory", description: "사업자등록증 기재 명칭" },
          { name: "공사/사업 개요", requirement: "mandatory", description: "공사명·공종·규모·기간" },
          { name: "평가 실시일", requirement: "mandatory", description: "YYYY-MM-DD" },
          { name: "평가 유형", requirement: "mandatory", description: "최초/정기/수시/상시 중 택일", lawBasis: "고시 §15 (실시 시기)" },
          { name: "평가 방법", requirement: "mandatory", description: "3단계 판단/체크리스트/빈도·강도/핵심요인기술/건설상시/화학물질/산업보건", lawBasis: "고시 §7 (위험성평가의 방법)" },
          { name: "참여자 명단", requirement: "mandatory", description: "역할·성명·서명 — 근로자 참여 필수", lawBasis: "고시 §6 (근로자 참여)" },
        ],
      },
      {
        heading: "2. 유해·위험요인 파악",
        description: "산안법 §36 ① 의 유해·위험요인 6범주 중 해당 항목 기재",
        fields: [
          { name: "유해·위험요인 목록", requirement: "mandatory", description: "건설물·기계·원재료·가스·분진·작업행동 등", lawBasis: "산안법 §36 ①" },
          { name: "파악 방법", requirement: "recommended", description: "현장조사/근로자 면담/재해사례 분석" },
          { name: "관련 재해사례", requirement: "recommended", description: "유사 재해 1~3건 인용", example: "search_accident_cases 결과" },
        ],
      },
      {
        heading: "3. 위험성 추정·결정",
        description:
          input.method === "3x3_matrix"
            ? "빈도(1~3) × 강도(1~3) 매트릭스"
            : input.method === "3-step"
              ? "위험성 수준 3단계 판단법 (고시 §7)"
              : input.method === "checklist"
                ? "체크리스트법 (고시 §7)"
                : "방법 선택 가능 (고시 §7 — KRAS 7방법 중 사업장 여건에 맞춰 선택)",
        fields: [
          { name: "위험성 크기", requirement: "mandatory", description: "선택한 방법에 따라 수치 또는 등급" },
          { name: "허용 가능 여부", requirement: "mandatory", description: "허용 가능/불가능 판정" },
          { name: "판정 근거", requirement: "recommended", description: "관련 법규·가이드 인용" },
        ],
      },
      {
        heading: "4. 위험성 감소대책",
        fields: [
          { name: "제거/대체/공학적/관리적/보호구 대책", requirement: "mandatory", description: "ERIC-PP 원칙 순서로 작성" },
          { name: "이행 책임자", requirement: "mandatory", description: "대책별 담당 지정" },
          { name: "이행 기한", requirement: "mandatory", description: "YYYY-MM-DD 또는 즉시" },
          { name: "감소대책 이행 후 잔존 위험성", requirement: "recommended", description: "재평가 결과" },
        ],
      },
      {
        heading: "5. 기록·보존",
        fields: [
          { name: "평가 결과 기록", requirement: "mandatory", description: "고시 §14 ① 의 6개 항목 모두 포함", lawBasis: "고시 §14 (기록 및 보존)" },
          { name: "근로자 공유 방법", requirement: "mandatory", description: "TBM·게시·교육 등", lawBasis: "고시 §13 (공유)" },
          { name: "차기 평가 예정일", requirement: "recommended", description: "정기 평가 주기 (1년)" },
        ],
      },
    ],
    signatureBlock: ["작성자 (안전관리자)", "검토자 (관리감독자)", "승인자 (사업주·경영책임자)", "근로자대표"],
    relatedLaws: [
      "산안법 §36 (위험성평가 의무)",
      "산안법 시행규칙 §37 (위험성평가 실시 시기 보충)",
      "위험성평가 고시 §6 (근로자 참여)",
      "위험성평가 고시 §7 (위험성평가 방법 — KRAS 7방법)",
      "위험성평가 고시 §13 (공유)",
      "위험성평가 고시 §14 (기록·보존 3년)",
      "위험성평가 고시 §15 (실시 시기 — 최초·수시·정기·상시)",
    ],
    relatedTools: [
      "compile_safety_references(workType, docType='risk_assessment')",
      "search_accident_cases(keyword=공종)",
      "search_sif_archive(workType)",
      "analyze_construction_work_risks(workType)",
      "verify_safety_basis(claims)",
      "// 문서 필드 누락 검증은 별도 프로젝트 agent-quality-oss-mcp 범위",
    ],
    notes: [
      isOngoing
        ? "상시평가는 **매월 1회 이상 발굴 + 매주 합동점검 + 매 작업일 작업 전 안전점검회의**로 구성 (고시 §15 ④ 1·2·3호). 셋 모두 이행 시 §15 ②(수시) + §15 ③(정기) 갈음."
        : "정기평가는 1년마다 적정성 재검토 (고시 §15 ③). 수시평가는 설비·물질 신규·변경·재해 발생 시 (§15 ②).",
      "근로자 참여 서명은 필수 (고시 §6). 미기재 시 과태료 대상.",
      "감소대책은 제거(Eliminate) → 대체(Replace) → 공학적(Engineering) → 관리적(Administrative) → 보호구(PPE) 순서로 고려.",
      "KOSHA 위험성평가 인정사업장(KRAS)에 등록 시 산재보험료 감면 혜택.",
    ],
  };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const schema = buildSchema(input);
  let md = renderSchemaAsMarkdown(schema);

  // KRAS 방법 지정 시 스키마 위에 방법 안내 헤더 추가
  let krasMeta: ReturnType<typeof getKrasMethodMeta> | undefined = undefined;
  if (input.kras_method) {
    krasMeta = getKrasMethodMeta(input.kras_method as KrasMethodCode);
    if (krasMeta) {
      const krasHeader = [
        `> ## 🎯 선택한 KRAS 방법: ${krasMeta.official} (\`${krasMeta.code}\`)`,
        `> - **접근**: ${krasMeta.approach === "quantitative" ? "정량 (매트릭스 산출)" : "정성 (직관·체크)"}`,
        `> - **적용 규모**: ${krasMeta.applicableScale.join(", ")}`,
        `> - **상세 절차**: \`get_kras_method({method: "${krasMeta.code}"})\` 호출 권장`,
        `> - **출처**: KOSHA KRAS (https://portal.kosha.or.kr/kras/evaluation/kras-method)`,
        "",
        "---",
        "",
      ].join("\n");
      md = krasHeader + md;
    }
  }

  return {
    content: [{ type: "text", text: md }],
    structuredContent: {
      query: input,
      schema,
      krasMethod: krasMeta,
    },
  };
}

export const getRiskAssessmentSchemaTool: ToolDefinition = {
  name: "get_risk_assessment_schema",
  title: "위험성평가서 스키마",
  description:
    "위험성평가서 작성을 위한 법정 필수 필드·구조를 Markdown 으로 반환. 위험성평가 고시 제2024-76호(상시평가 체계 §15 ④) 기반. type 으로 최초·정기·수시·상시 선택, kras_method 로 KRAS 7방법 선택. LLM 은 이 스키마의 🔴 필수 필드를 반드시 채워 초안 작성. 법령 조문은 `get_safety_law_article` 로 인용·검증.",
  inputSchema,
  handler,
};
