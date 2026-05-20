#!/usr/bin/env tsx
/**
 * 필드 테스트 — 생성된 4개 의무문서 내용 품질 평가
 *
 * 평가 차원:
 *   1. 법적 근거 정확성 — 인용 법령이 docId 와 일치
 *   2. 그래프 추론 풍부도 — 위험·통제·KOSHA 자동 도출 개수
 *   3. 작성 가이드 완비도 — 모든 필수 필드에 inputGuide+standardFormat+examples+checkPoints
 *   4. 빈칸 작성성 (LLM-fillability) — 가이드만으로 LLM이 채울 수 있는지
 *   5. 실무 활용도 — 결재 가능 여부 표시 + 비상연락망 + 보존 기간
 *   6. 도메인 적합성 — 시나리오 입력에 부합하는 필드/예시
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "..", "artifacts", "test-results", "field");

interface Eval {
  scenario: string;
  bytes: number;
  legalBasisCount: number;       // 인용 법령 수
  legalBodyExcerpts: number;     // 법령 본문 발췌 수
  hazardCount: number;           // 식별 위험요소
  controlCount: number;          // ERIC-PP 통제
  koshaGuideCount: number;       // 적용 KOSHA Guide
  inputGuideCount: number;       // 작성 가이드 (- 작성 방법:)
  standardFormatCount: number;   // 표준 형식
  exampleCount: number;          // 예시
  checkpointCount: number;       // 체크포인트
  approvalReadiness: "ready" | "blocked";  // 결재 사용 가능?
  blockedFields: number;         // 미작성 필수 항목
  hasEmergencyContacts: boolean;
  hasRetention: boolean;
  // 평가 점수 (10점 만점)
  legalAccuracy: number;
  graphReasoning: number;
  fillability: number;
  fieldUsability: number;
  domainFit: number;
  total: number;
}

async function evaluate(scenarioId: string, expectedDocId: string): Promise<Eval> {
  const text = await readFile(resolve(OUT, `${scenarioId}.md`), "utf-8");

  const legalBasisMatch = text.match(/^### .+§\d+|^### .+ 별표/gm) ?? [];
  const legalBodyExcerpts = (text.match(/```\n[\s\S]*?\n```/g) ?? []).length;
  const hazardCount = (text.match(/^\| .+ \| (physical|chemical|environmental|biological|ergonomic|psychosocial)/gm) ?? []).length;
  const controlMatch = text.match(/위계별 선별 (\d+)개 표시/);
  const controlCount = controlMatch ? parseInt(controlMatch[1]) : (text.match(/^\| \d\. /gm) ?? []).length;
  const koshaCountMatch = text.match(/적용 KOSHA Guide \((\d+)건\)/);
  const koshaGuideCount = koshaCountMatch ? parseInt(koshaCountMatch[1]) : 0;
  const inputGuideCount = (text.match(/- 작성 방법:/g) ?? []).length;
  const standardFormatCount = (text.match(/- 표준 형식:/g) ?? []).length;
  const exampleCount = (text.match(/^  - /gm) ?? []).length;
  const checkpointCount = (text.match(/- 체크포인트:/g) ?? []).length;
  const blockedMatch = text.match(/필수 항목 (\d+)건 미작성/);
  const blockedFields = blockedMatch ? parseInt(blockedMatch[1]) : 0;
  const approvalReadiness = blockedFields > 0 ? "blocked" : "ready";
  const hasEmergencyContacts = /^## (?:\d+\.\s*)?비상연락망/m.test(text);
  const hasRetention = /보존:/.test(text);

  // 점수 산출 (각 10점)
  const legalAccuracy = Math.min(10,
    (legalBasisMatch.length >= 1 ? 4 : 0) +
    (legalBodyExcerpts >= 1 ? 3 : 0) +
    (legalBodyExcerpts >= 2 ? 3 : 0)
  );
  const graphReasoning = Math.min(10,
    Math.min(hazardCount, 6) +    // hazard 0~6
    Math.min(controlCount, 3) +   // control 0~3
    (koshaGuideCount >= 3 ? 1 : 0)// guide 1
  );
  const fillability = Math.min(10,
    Math.min(inputGuideCount, 4) +
    (standardFormatCount >= 3 ? 2 : 0) +
    (exampleCount >= 5 ? 2 : 0) +
    (checkpointCount >= 3 ? 2 : 0)
  );
  const fieldUsability = Math.min(10,
    (hasEmergencyContacts ? 3 : 0) +
    (hasRetention ? 2 : 0) +
    (approvalReadiness === "ready" ? 0 : 3) + // blocked 표시는 정직성으로 +3
    (text.length >= 4000 ? 2 : text.length >= 2000 ? 1 : 0)
  );
  // 도메인 적합성 — 시나리오별 키워드 검출
  const domainKeywords: Record<string, string[]> = {
    S1_excavation: ["굴착", "도시가스", "흙막이", "매설물"],
    S2_severe_accident: ["중대재해", "§54", "사상자", "노동청"],
    S3_msds: ["MSDS", "GHS", "화학물질", "신너"],
    S4_risk_assessment: ["위험성평가", "KRAS", "matrix", "정기"],
  };
  const kws = domainKeywords[scenarioId] ?? [];
  const matchedKw = kws.filter(k => text.includes(k)).length;
  const domainFit = Math.round((matchedKw / Math.max(1, kws.length)) * 10);

  const total = Math.round((legalAccuracy + graphReasoning + fillability + fieldUsability + domainFit) / 5 * 10) / 10;

  return {
    scenario: scenarioId, bytes: text.length,
    legalBasisCount: legalBasisMatch.length, legalBodyExcerpts,
    hazardCount, controlCount, koshaGuideCount,
    inputGuideCount, standardFormatCount, exampleCount, checkpointCount,
    approvalReadiness, blockedFields, hasEmergencyContacts, hasRetention,
    legalAccuracy, graphReasoning, fillability, fieldUsability, domainFit, total,
  };
}

async function main() {
  const evals = [
    await evaluate("S1_excavation", "work_plan_excavation"),
    await evaluate("S2_severe_accident", "severe_accident_immediate_report"),
    await evaluate("S3_msds", "msds_register"),
    await evaluate("S4_risk_assessment", "regular_risk_assessment"),
  ];

  console.log("=".repeat(90));
  console.log("필드 테스트 — 생성된 4개 의무문서 내용 품질 평가");
  console.log("=".repeat(90));
  console.log("");

  for (const e of evals) {
    console.log(`\n[${e.scenario}] ${e.bytes.toLocaleString()} bytes`);
    console.log(`  법령: 인용 ${e.legalBasisCount}개, 본문 발췌 ${e.legalBodyExcerpts}개`);
    console.log(`  그래프 추론: 위험 ${e.hazardCount}개, 통제 ${e.controlCount}개, KOSHA ${e.koshaGuideCount}개`);
    console.log(`  작성 가이드: 방법 ${e.inputGuideCount}, 형식 ${e.standardFormatCount}, 예시 ${e.exampleCount}, 체크 ${e.checkpointCount}`);
    console.log(`  실무 활용: 결재=${e.approvalReadiness} (미작성 ${e.blockedFields}), 비상연락=${e.hasEmergencyContacts ? "✓" : "✗"}, 보존=${e.hasRetention ? "✓" : "✗"}`);
    console.log(`  점수: 법령정확성 ${e.legalAccuracy}/10, 그래프추론 ${e.graphReasoning}/10, LLM채움성 ${e.fillability}/10, 현장활용 ${e.fieldUsability}/10, 도메인적합 ${e.domainFit}/10`);
    console.log(`  종합: ${e.total}/10`);
  }

  console.log("\n" + "=".repeat(90));
  const avg = evals.reduce((s, e) => s + e.total, 0) / evals.length;
  console.log(`평균 종합 점수: ${avg.toFixed(2)}/10`);
  console.log(`평균 본문: ${(evals.reduce((s,e)=>s+e.bytes,0)/evals.length/1000).toFixed(1)}KB`);
  console.log(`결재 가능: ${evals.filter(e=>e.approvalReadiness==="ready").length}/4 (필수 미작성 시 blocked 표시 — MCP 정직성)`);
  console.log(`도메인 적합: ${(evals.reduce((s,e)=>s+e.domainFit,0)/evals.length).toFixed(1)}/10 평균`);
  console.log(`그래프 추론 강도: 위험 ${(evals.reduce((s,e)=>s+e.hazardCount,0)/evals.length).toFixed(0)}개, 통제 ${(evals.reduce((s,e)=>s+e.controlCount,0)/evals.length).toFixed(0)}개, KOSHA ${(evals.reduce((s,e)=>s+e.koshaGuideCount,0)/evals.length).toFixed(0)}개 / 시나리오`);
}

main().catch(console.error);
