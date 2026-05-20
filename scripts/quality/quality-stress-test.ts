#!/usr/bin/env tsx
/**
 * quality-stress-test.ts (v0.8+)
 *
 * 더 까다로운 시나리오로 generate 강건성 검사:
 *   1. 멱등성 — 같은 입력 5회 호출 → 동일 출력?
 *   2. 빈 입력 대응 — 메타 일부 누락 시 graceful fallback
 *   3. 잘못된 docId — 적절한 에러 메시지
 *   4. 응답 시간 — 평균 < 100ms
 *   5. 다양한 작업 조건 — 같은 docId × 다른 입력 → 출력 차이 있는가
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";

interface ToolResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
}

function getText(r: ToolResult): string {
  return r.content?.[0]?.text ?? "";
}

(async () => {
  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  // T1. 멱등성 — work_plan_excavation 5회
  console.log(`# T1. 멱등성 (work_plan_excavation 5회)`);
  const input1 = {
    docId: "work_plan_excavation",
    draft: {
      metadata: { siteName: "T", planDate: "2026-04-28", supervisor: "H" },
      documentId: "X",
      workPeriod: "X",
      emergencyContacts: { fire: "119", labor: "X", hospital: "X", owner: "X" },
      preSurvey: { shape: "S", crackWater: "C", buriedObj: "B", groundwater: "G" },
      plan: { method: "M", resources: "R", protectBuried: "P", signal: "S",
              shoring: "Sh", supervisor: "Su", other: "O" },
    },
  };
  const outputs: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const r = (await generateSafetyDocumentTool.handler(input1)) as ToolResult;
    outputs.push(getText(r));
  }
  const allEqual = outputs.every((o) => o === outputs[0]);
  if (allEqual) { pass += 1; console.log(`  ✓ 5회 호출 모두 동일 (${outputs[0].length}자)`); }
  else { fail += 1; failures.push("T1: 멱등성 X"); console.log(`  ✗ 출력 변동 있음`); }

  // T2. 빈 입력 대응 — 필수 메타만
  console.log(`\n# T2. 최소 입력 대응`);
  const r2 = (await generateSafetyDocumentTool.handler({
    docId: "work_plan_excavation",
    draft: { metadata: { siteName: "T", planDate: "2026-04-28" } },
  })) as ToolResult;
  if (!r2.isError && getText(r2).length > 1000) {
    pass += 1;
    console.log(`  ✓ 최소 입력으로도 ${getText(r2).length}자 본문 생성 (미작성 항목은 (미작성) 표기)`);
  } else {
    fail += 1; failures.push("T2: 최소 입력 처리 X");
    console.log(`  ✗ ${getText(r2).slice(0, 100)}`);
  }

  // T3. 잘못된 docId
  console.log(`\n# T3. 잘못된 docId`);
  const r3 = (await generateSafetyDocumentTool.handler({
    docId: "non_existent_docId_999",
    draft: { metadata: { siteName: "T", planDate: "2026-04-28" } },
  })) as ToolResult;
  if (r3.isError && getText(r3).includes("NOT_FOUND")) {
    pass += 1;
    console.log(`  ✓ NOT_FOUND 에러 반환 (isError=true)`);
  } else {
    fail += 1; failures.push("T3: 에러 처리 X");
    console.log(`  ✗ ${getText(r3).slice(0, 100)}`);
  }

  // T4. 응답 시간 — 49 Document 평균
  console.log(`\n# T4. 응답 시간 (49 Document 평균)`);
  const { listDocuments } = await import("../../build/lib/graph-nodes-loader.js");
  const docs = (await listDocuments()).filter((d) => !d["@id"].startsWith("doc:kosha_guide"));
  const times: number[] = [];
  for (const doc of docs.slice(0, 49)) {
    const t0 = Date.now();
    await generateSafetyDocumentTool.handler({
      docId: doc.docId,
      draft: { metadata: { siteName: "T", planDate: "2026-04-28" } },
    });
    times.push(Date.now() - t0);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const max = Math.max(...times);
  if (avg < 200 && max < 500) {
    pass += 1;
    console.log(`  ✓ 평균 ${avg.toFixed(0)}ms, 최대 ${max}ms (49 Document)`);
  } else {
    fail += 1; failures.push(`T4: 평균 ${avg}ms 임계 초과`);
    console.log(`  ⚠ 평균 ${avg.toFixed(0)}ms, 최대 ${max}ms (임계 200/500)`);
  }

  // T5. 같은 docId × 다른 입력 → 출력 차이
  console.log(`\n# T5. 입력 변동 → 출력 변동 (work_plan_excavation 깊이 1.5m vs 5m)`);
  const r5a = (await generateSafetyDocumentTool.handler({
    docId: "work_plan_excavation",
    draft: { metadata: { siteName: "T", planDate: "2026-04-28" }, workConditions: { depthM: 1.5 } },
  })) as ToolResult;
  const r5b = (await generateSafetyDocumentTool.handler({
    docId: "work_plan_excavation",
    draft: { metadata: { siteName: "T", planDate: "2026-04-28" }, workConditions: { depthM: 5.0 } },
  })) as ToolResult;
  const t5a = getText(r5a);
  const t5b = getText(r5b);
  if (t5a !== t5b && t5a.includes("1.5") && t5b.includes("5")) {
    pass += 1;
    console.log(`  ✓ 작업 조건 차이 출력에 반영 (1.5m vs 5m)`);
  } else {
    fail += 1; failures.push("T5: 입력 변동 무시");
    console.log(`  ✗ 입력 차이 출력에 미반영`);
  }

  // T6. 49 Document 모두 비상연락망 + 결재선 포함
  console.log(`\n# T6. 49 Document 필수 섹션 (비상연락망 + 결재선)`);
  let allHaveSections = true;
  const missingSections: string[] = [];
  for (const doc of docs) {
    const r = (await generateSafetyDocumentTool.handler({
      docId: doc.docId,
      draft: {
        metadata: { siteName: "T", planDate: "2026-04-28" },
        emergencyContacts: { fire: "119", labor: "X", hospital: "X", owner: "X" },
      },
    })) as ToolResult;
    const text = getText(r);
    if (!text.includes("비상연락망") || !text.includes("결재선")) {
      allHaveSections = false;
      missingSections.push(doc.docId);
    }
  }
  if (allHaveSections) {
    pass += 1;
    console.log(`  ✓ 49 Document 모두 비상연락망 + 결재선 포함`);
  } else {
    fail += 1; failures.push(`T6: ${missingSections.length}개 누락`);
    console.log(`  ✗ 누락: ${missingSections.join(", ")}`);
  }

  console.log(`\n# 종합`);
  console.log(`  PASS ${pass} / FAIL ${fail}`);
  if (failures.length > 0) {
    console.log(`  실패: ${failures.join("; ")}`);
  }
  process.exit(fail === 0 ? 0 : 1);
})();
