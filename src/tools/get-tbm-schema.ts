import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  renderSchemaAsMarkdown,
  type DocumentSchema,
} from "../lib/document-schemas.js";

// TBM (Tool Box Meeting) — 작업 전 안전점검회의
// 위험성평가 고시 (고용노동부고시 제2026-73호, 2026-11-04 시행) §16 제1항 제3호:
//   매 작업일마다 시행규칙 §37의3 제2호 사항(파악한 유해·위험 요인, 위험성 수준 결정 결과,
//   개선대책 수립 내용 및 이행 결과), 근로자가 준수·주의할 사항 등을 작업 전 안전점검회의 등으로 공유·주지하고
//   근로자의 제안을 청취·반영하도록 노력 → 상시평가의 매 작업일 이행 사항
// 산안법 §36 제4항 후단: 중대재해로 이어질 수 있는 유해·위험 요인은 작업 전 안전점검회의 등으로 상시 주지하도록 노력
// 상시평가는 제1호(매월 평가) 이행을 정기평가로 보고(§16①), 추가 유해·위험 요인이 생기면 수시평가를 따로 한다(§16②)

const inputSchema = z.object({
  duration: z
    .enum(["short", "standard", "detailed"])
    .default("standard")
    .describe("소요시간: short(5분)/standard(10분)/detailed(15~20분)"),
});

type Input = z.infer<typeof inputSchema>;

function buildSchema(input: Input): DocumentSchema {
  return {
    docType: "tbm",
    docTypeKo: "TBM (작업 전 안전점검회의) 기록",
    purpose:
      "매 작업일 작업 시작 전 위험성평가 결과(위험요인·위험성 수준·개선대책과 이행 결과)와 근로자가 지킬 사항을 공유·주지하고 근로자의 제안을 듣는 회의 기록. 상시평가를 택한 사업장의 매 작업일 이행 증빙.",
    legalObligation:
      "위험성평가 고시 제2026-73호 §16 제1항 제3호 (상시평가 — 매 작업일 작업 전 안전점검회의 등으로 시행규칙 §37의3 제2호 사항·준수 및 주의 사항 공유·주지, 근로자 제안 청취·반영 노력) · 산안법 §36 제4항 후단 (중대재해로 이어질 수 있는 유해·위험 요인 상시 주지 노력). 상시평가는 제1호(매월 평가) 이행을 정기평가로 보며(§16①), 추가 유해·위험 요인이 생기면 수시평가를 따로 한다(§16②).",
    frequency: "매 작업일 작업 시작 전 1회",
    primaryAuthor: "관리감독자 (진행) + 근로자 (참여·서명)",
    retention: "3년 (위험성평가 기록과 동일, 시행규칙 §37)",
    sections: [
      {
        heading: "1. 기본 정보",
        fields: [
          { name: "일자·시간", requirement: "mandatory", description: "YYYY-MM-DD HH:MM" },
          { name: "장소", requirement: "mandatory", description: "현장·작업 구역" },
          { name: "공종", requirement: "mandatory", description: "당일 진행 작업", example: "거푸집 해체" },
          { name: "기상 정보", requirement: "recommended", description: "날씨·기온·풍속 (옥외)" },
          { name: "참여 인원", requirement: "mandatory", description: "총 N명 (명단 첨부)" },
          { name: "진행자 (관리감독자)", requirement: "mandatory", description: "성명·서명" },
        ],
      },
      {
        heading: "2. 당일 위험성평가 결과 공유 (시행규칙 §37의3 제2호)",
        description: "고시 §16 제1항 제3호 — 파악한 유해·위험 요인, 위험성 수준 결정 결과, 개선대책 수립 내용 및 이행 결과를 작업 전에 공유·주지",
        fields: [
          { name: "주요 위험요인 3~5개", requirement: "mandatory", description: "떨어짐·맞음·끼임·무너짐 등 구체적 기술", example: "1) 개구부 추락, 2) 자재 낙하" },
          { name: "위험성 수준 결정 결과", requirement: "mandatory", description: "위험요인마다 허용 가능/불가 판단 (사업장이 정한 기준 — 고시 §11)", lawBasis: "시행규칙 §37의3 제2호" },
          { name: "개선대책 수립 내용 및 이행 결과", requirement: "mandatory", description: "대책과 오늘 시작 전 이행 여부", lawBasis: "시행규칙 §37의3 제2호" },
          { name: "전일 발생 이슈·니어미스", requirement: "recommended", description: "어제 문제가 있었는지" },
          { name: "유사 재해사례 공유", requirement: "recommended", description: "관련 KOSHA 재해사례 1건", example: "search_accident_cases 결과" },
        ],
      },
      {
        heading: "3. 감소대책 · 핵심 수칙",
        fields: [
          { name: "근로자가 준수·주의할 사항 3~5개", requirement: "mandatory", description: "근로자가 지켜야 할 구체적 행동 지침", lawBasis: "고시 §16 제1항 제3호" },
          { name: "필요 보호구", requirement: "mandatory", description: "안전모·안전대·안전화·보안경 등", lawBasis: "search_ppe_certification 권장" },
          { name: "작업 중지 기준", requirement: "recommended", description: "강풍·우천 등 기상 조건" },
        ],
      },
      {
        heading: "4. 근로자 참여 확인",
        description: "고시 §16 제1항 제3호 (근로자 제안 청취·반영 노력) · §17 (공유 방법 — 작업 전 안전점검회의 등 정기 회의)",
        fields: [
          { name: "근로자 제안·의견과 반영 여부", requirement: "recommended", description: "근로자가 제기한 위험·우려사항과 반영 계획", lawBasis: "고시 §16 제1항 제3호" },
          { name: "참여자 서명", requirement: "mandatory", description: "전원 서명 (또는 확인 서명)" },
        ],
      },
      {
        heading: "5. 특별 주의 사항",
        fields: [
          { name: "외국인 근로자 대응", requirement: "recommended", description: "모국어 자료 제공 여부", lawBasis: "get_foreign_worker_resource_links" },
          { name: "신규 근로자 특별 안내", requirement: "recommended", description: "당일 신규 입장자 주의 조치" },
        ],
      },
    ],
    signatureBlock: ["관리감독자 (진행)", "참여 근로자 대표"],
    relatedLaws: [
      "산안법 §36 (위험성평가 — ④ 후단 작업 전 안전점검회의 등으로 상시 주지)",
      "산안법 시행규칙 §37의3 (근로자 공유 사항) · §37의4 (기록·보존 3년)",
      "위험성평가 고시 §16 (상시평가 — 매월·매주·매 작업일)",
      "위험성평가 고시 §17 (근로자 공유 방법)",
    ],
    relatedTools: [
      "compile_safety_references(workType, docType='tbm')",
      "search_sif_archive(workType, hazardCode)",
      "search_accident_cases(keyword)",
      "get_foreign_worker_resource_links(language, topic)",
      "search_ppe_certification",
      "analyze_construction_work_risks(workType)",
    ],
    notes: [
      `소요시간: ${input.duration === "short" ? "5분 (핵심 위험요인 + 수칙만)" : input.duration === "detailed" ? "15~20분 (사례 인용 + 질의응답 충분히)" : "10분 (표준)"}`,
      "상시평가(고시 §16 제1항)는 매월 평가(1호) 이행을 **정기평가로 본다**. 매월 평가에서 파악되지 않은 추가 유해·위험 요인이 생기면 **수시평가를 따로** 한다(§16 제2항).",
      "TBM 기록은 중대재해 발생 시 안전보건조치 이행 증빙으로 매우 중요.",
      "근로자가 모국어를 모르는 외국인이면 `get_foreign_worker_resource_links` 로 자료 확보.",
      "산재보험료 감면 KRAS 인정 심사 시 TBM 기록 일관성이 평가 요소.",
    ],
  };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const schema = buildSchema(input);
  const md = renderSchemaAsMarkdown(schema);

  return {
    content: [{ type: "text", text: md }],
    structuredContent: { query: input, schema },
  };
}

export const getTbmSchemaTool: ToolDefinition = {
  name: "get_tbm_schema",
  title: "TBM 기록 스키마",
  description:
    "TBM (Tool Box Meeting) 기록 스키마. 위험성평가 고시 제2026-73호 §16 제1항 제3호 기반 (매 작업일 작업 전 안전점검회의 — 위험요인·위험성 수준 결정 결과·개선대책과 이행 결과·준수 사항 공유, 근로자 제안 청취). 상시평가는 매월 평가 이행을 정기평가로 보며 추가 위험요인은 수시평가를 따로 한다. 5/10/15분 옵션. LLM 은 이 스키마로 TBM 대본을 한국어 자연어로 작성.",
  inputSchema,
  handler,
};
