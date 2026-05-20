import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  renderSchemaAsMarkdown,
  type DocumentSchema,
} from "../lib/document-schemas.js";

// OPS (One Point Sheet) — 단일 위험요인 1페이지 안전 요약

const inputSchema = z.object({});

function buildSchema(): DocumentSchema {
  return {
    docType: "ops",
    docTypeKo: "OPS (One Point Sheet)",
    purpose:
      "단일 위험요인·주제에 대한 1페이지 안전 요약. KOSHA 안전보건자료 표준 포맷 중 하나로 현장 벽보·교재로 활용. 위험성평가 고시 §7 'KRAS 7방법' 중 핵심요인 기술법(OPS) 의 법정 인정 방법.",
    legalObligation:
      "법정 의무 문서 아님 (관행·법정 인정 방법). 단, TBM·위험성평가 증빙으로 활용 가능.",
    frequency: "필요시 (공정 변경·사고 후·교육 등)",
    primaryAuthor: "안전관리자·관리감독자",
    retention: "관행 1년 (KOSHA 안전보건자료 표준)",
    sections: [
      {
        heading: "1. 헤더",
        fields: [
          { name: "제목", requirement: "mandatory", description: "간결한 한 문장", example: "거푸집 해체 중 떨어짐 방지" },
          { name: "적용 공종", requirement: "mandatory", description: "대상 작업" },
          { name: "작성일·작성자", requirement: "mandatory", description: "YYYY-MM-DD · 성명" },
          { name: "버전", requirement: "recommended", description: "v1.0 등" },
        ],
      },
      {
        heading: "2. 위험요인 (한 가지)",
        description: "OPS 핵심은 **한 가지 주제에 집중**",
        fields: [
          { name: "대표 위험요인", requirement: "mandatory", description: "떨어짐/맞음/끼임 등 단일 선택" },
          { name: "발생 가능 상황", requirement: "mandatory", description: "구체적 시나리오 1~2줄" },
          { name: "결과·피해 예상", requirement: "recommended", description: "사망·중상·경상 등" },
        ],
      },
      {
        heading: "3. 핵심 행동 수칙 (3~5개)",
        description: "'하지 말 것' 보다 '해야 할 것' 중심으로",
        fields: [
          { name: "수칙 1", requirement: "mandatory", description: "구체적 행동 문장", example: "작업 전 안전대 체결부위 확인" },
          { name: "수칙 2", requirement: "mandatory", description: "" },
          { name: "수칙 3", requirement: "mandatory", description: "" },
          { name: "수칙 4·5", requirement: "recommended", description: "필요 시 추가" },
        ],
      },
      {
        heading: "4. 유사 재해사례 (선택)",
        fields: [
          { name: "사례 요약", requirement: "recommended", description: "1~2줄, KOSHA 재해사례 인용", example: "search_accident_cases 또는 search_sif_archive 결과" },
          { name: "교훈", requirement: "recommended", description: "한 줄 교훈" },
        ],
      },
      {
        heading: "5. 체크리스트 / 시각자료",
        fields: [
          { name: "작업 전 체크 (3~5개)", requirement: "recommended", description: "근로자 자가 점검용" },
          { name: "시각자료 영역", requirement: "recommended", description: "이미지·도식 placeholder (실제 이미지는 작성자 첨부)" },
        ],
      },
    ],
    relatedLaws: [
      "산안법 §36 (위험성평가 의무)",
      "위험성평가 고시 §7 (위험성평가 방법 — KRAS 7방법 중 핵심요인 기술법)",
      "위험성평가 고시 §15 ④ (상시평가 증빙으로도 활용 가능)",
    ],
    relatedTools: [
      "compile_safety_references(workType, docType='ops')",
      "search_accident_cases(keyword)",
      "search_sif_archive(workType)",
      "get_foreign_worker_resource_links(language, topic)",
    ],
    notes: [
      "OPS 는 **한 가지 주제**에 집중. 위험요인이 여러 개면 OPS 를 여러 장 작성.",
      "A4 한 장 분량을 넘지 말 것. 현장 벽보 용도.",
      "외국인 근로자가 많은 현장은 해당 언어 버전 별도 작성 권장.",
      "간결·시각적·즉시 실행 가능한 지침이 핵심. 법령 조문 긴 인용 지양.",
    ],
  };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  inputSchema.parse(rawInput ?? {});
  const schema = buildSchema();
  const md = renderSchemaAsMarkdown(schema);
  return {
    content: [{ type: "text", text: md }],
    structuredContent: { schema },
  };
}

export const getOpsSchemaTool: ToolDefinition = {
  name: "get_ops_schema",
  title: "OPS (One Point Sheet) 스키마",
  description:
    "단일 위험요인에 대한 1페이지 안전 요약 문서 스키마. 위험성평가 고시 §7 'KRAS 7방법' 중 핵심요인 기술법(OPS) 으로 인정. 매 작업일 TBM(§15 ④ 3호) 부속 자료로 상시평가 증빙 활용 가능. 제목·위험요인·핵심 수칙 3~5개·유사사례·체크리스트 구조.",
  inputSchema,
  handler,
};
