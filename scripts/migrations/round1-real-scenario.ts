#!/usr/bin/env tsx
/**
 * Round 1: 실제 LLM이 사용자 요청을 받았을 때
 * → generate_safety_document 호출 후 결과를 비판적으로 분석
 *
 * 사용자 요청: "황룡건설 천안 신축현장. 지하 5m 굴착, 도시가스 매설관 인접.
 *              굴삭기 1대 + 작업자 8명. 월요일부터 작업. 작업계획서 써줘."
 */
// runtime: tsx 가 .ts 를 직접 해석 (build/ 가 아닌 src/ 경로로 ts-only typecheck 도 통과)
import { generateSafetyDocumentTool } from "../../src/tools/generate-safety-document.js";

const userRequest = {
  docId: "work_plan_excavation",
  draft: {
    metadata: { siteName: "황룡건설 천안 신축현장", planDate: "2026-04-28", supervisor: "홍길동" },
    documentId: "WP-EX-001",
    workPeriod: "2026-04-29 ~ 2026-05-15",
    emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "단국대병원", owner: "010-1234-5678" },
    workConditions: { depthM: 5.0, locationDetail: "도시가스 매설관 GL-1.5m 인접", workforce: 8 },
    // ★ 사용자가 제공 안 한 것: preSurvey, plan 본문 (LLM이 채워야 함)
  },
  scale: { workforce: 8, constructionValue: 5, industry: "construction" },
};

const r: any = await generateSafetyDocumentTool.handler(userRequest);
const text = r.content?.[0]?.text ?? "";
const struct = r.structuredContent ?? {};

console.log("════════════════════════════════════════");
console.log("LLM이 받은 도구 응답 — 사용자에게 보낼 만한가?");
console.log("════════════════════════════════════════\n");

// 1. 본문 출력
console.log(text);

console.log("\n\n════════════════════════════════════════");
console.log("LLM 입장 비판적 분석");
console.log("════════════════════════════════════════\n");

// 빈 필드 카운트
const emptyFields = (text.match(/\(미작성 — 필수\)/g) ?? []).length;
const totalFields = (text.match(/\| [^|]+ \| /g) ?? []).length;
console.log(`빈 필드: ${emptyFields}/${totalFields}`);

// graphContext에서 LLM이 빈칸 채울 단서 있나?
console.log("\n그래프 컨텍스트에서 빈칸 채우기 단서:");
const inferred = struct.inferred ?? {};
console.log(`  hazards: ${(inferred.hazards ?? []).length}개 — IRI만 (어떤 시점 어떤 통제? 답 없음)`);
console.log(`  controls: ${(inferred.controls ?? []).length}개 — IRI만`);
console.log(`  kosha: ${(inferred.kosha ?? []).length}개 — 가이드 제목만 (PDF 본문 미포함)`);

// 사용자가 받았을 때 만족도 추정
console.log("\n사용자가 이 결과 받으면:");
console.log("  ❌ '사전조사 형상·지질·지층 상태'를 어떻게 적어야?  → 답 없음");
console.log("  ❌ '매설물 이설·보호대책' 표준 절차?              → 답 없음");
console.log("  ❌ '굴착방법·순서' 5m 깊이 표준?                   → 답 없음");
console.log("  ❌ '흙막이 지보공 설치방법'?                       → 답 없음");
console.log("  ❌ '계측계획' 어떤 항목·주기?                      → 답 없음");
console.log("  ❌ '신호방법' 무전기 채널·호각?                    → 답 없음");
console.log("");
console.log("→ LLM이 사용자에게 답변하려면 자체 추론 필요. 그래프는 양식·법령만 제공.");
console.log("→ 자체 추론은 환각 위험. 검증된 도메인 지식이 필요.");
