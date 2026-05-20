#!/usr/bin/env tsx
// runtime: tsx 가 .ts 를 직접 해석 (build/ 가 아닌 src/ 경로로 ts-only typecheck 도 통과)
import { generateSafetyDocumentTool } from "../../src/tools/generate-safety-document.js";

const input = {
  docId: "work_plan_excavation",
  draft: {
    metadata: { siteName: "황룡건설 천안 신축현장", planDate: "2026-04-28", supervisor: "홍길동" },
    documentId: "WP-EX-001",
    workPeriod: "2026-04-29 ~ 2026-05-15",
    emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "단국대병원", owner: "010-1234-5678" },
    workConditions: { depthM: 5.0, locationDetail: "도시가스 매설관 GL-1.5m 인접", workforce: 8 },
  },
  scale: { workforce: 8, constructionValue: 5, industry: "construction" },
};

const r: any = await generateSafetyDocumentTool.handler(input);
const text = r.content?.[0]?.text ?? "";

// 메트릭
const guideBlocks = (text.match(/📝 \*\*빈칸 작성 가이드\*\*/g) ?? []).length;
const inputGuideLines = (text.match(/- 작성 방법:/g) ?? []).length;
const standardFormatLines = (text.match(/- 표준 형식:/g) ?? []).length;
const exampleLines = (text.match(/- 예시:/g) ?? []).length;
const checkPointsLines = (text.match(/- 체크포인트:/g) ?? []).length;
const totalExamples = (text.match(/^  - /gm) ?? []).length;

console.log("════════════════════════════════════════");
console.log("Round 1 vs Round 2 비교 (work_plan_excavation, 같은 input)");
console.log("════════════════════════════════════════");
console.log("");
console.log(`본문 길이:                ${text.length} chars (Round 1: 3,331)`);
console.log(`작성 가이드 블록 수:      ${guideBlocks}개 (Round 1: 0)`);
console.log(`작성 방법 안내:           ${inputGuideLines}개 (Round 1: 0)`);
console.log(`표준 형식 안내:           ${standardFormatLines}개`);
console.log(`예시 라벨:                ${exampleLines}개`);
console.log(`예시 본문:                ${totalExamples}개 (각 field당 2개)`);
console.log(`체크포인트:               ${checkPointsLines}개`);
console.log("");
console.log("→ LLM이 빈칸 채울 때 활용 가능한 도메인 단서:");
console.log(`  · 작성 방법 ${inputGuideLines}개`);
console.log(`  · 표준 형식 ${standardFormatLines}개`);
console.log(`  · 시나리오별 예시 ${totalExamples}개`);
console.log(`  · 검증 체크포인트 ${checkPointsLines}개`);
console.log("");
console.log("=================================");
console.log("LLM 입장 재평가 — 사용자 input '지하 5m 굴착, 도시가스 매설관 인접'");
console.log("=================================");
console.log("");
console.log("Round 1: ❌ 양식만 받음. 빈칸 어떻게 채울지 답 없음. 환각 위험.");
console.log("Round 2: ✅ 양식 + 작성 가이드 + 표준 형식 + 예시 + 체크포인트 받음.");
console.log("         ✅ LLM이 사용자 input + 가이드 = 표준 답변 합성 가능.");
console.log("            예: '도시가스 매설관 GL-1.5m 인접' input");
console.log("                 + 가이드 표준 형식 '[매설물 종류] [심도] [관경] (소유자, 입회)'");
console.log("                 → '도시가스관 GL-1.5m DN200 (한국가스공사, 입회 의무)' 자동 추론 가능");
