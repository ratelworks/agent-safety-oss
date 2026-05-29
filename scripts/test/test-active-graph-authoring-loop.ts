/**
 * Active Graph Authoring Loop 통합 시나리오 테스트 (decision 002)
 *
 * 안전관리자가 daily_tbm 을 실제로 작성하는 흐름을 처음부터 끝까지 시뮬레이션.
 * 각 단계마다 6개 도구의 호출·응답·a2uiUpdate 메시지를 검증.
 *
 * 시나리오:
 *  1. render_a2ui_form        — 폼 받기 + 그래프 컨텍스트 + writingGuide 노출 검증
 *  2. analyze_work_context    — "굴착 작업" 입력 → 위험·통제·법령·KOSHA 종합
 *  3. suggest_controls_for_hazard — "추락" 입력 → ERIC-PP 위계 추천
 *  4. request_field_help      — hazard1 필드 도움말 (currentValue="추락" 패턴 경고)
 *  5. preview_review (mid)    — 일부 작성 후 부분 검토 (필수 누락 검출)
 *  6. preview_review (final)  — 완성 직전 검토 (환각 의심 인용 포함 → 환각 검출 검증)
 *  7. review_safety_document  — 최종 검토 (preview 결과와 일치 검증)
 *
 * 동일 흐름을 work_plan_excavation 으로도 진행 — §38 ② notifiedToWorkers 검증.
 */
import { renderA2UIFormTool } from "../../src/tools/render-a2ui-form.js";
import { analyzeWorkContextTool } from "../../src/tools/analyze-work-context.js";
import { suggestControlsForHazardTool } from "../../src/tools/suggest-controls-for-hazard.js";
import { requestFieldHelpTool } from "../../src/tools/request-field-help.js";
import { previewReviewTool } from "../../src/tools/preview-review.js";
import { reviewSafetyDocumentTool } from "../../src/tools/review-safety-document.js";

interface TestStep {
  name: string;
  pass: boolean;
  detail: string;
  warnings?: string[];
}

const steps: TestStep[] = [];

function check(name: string, cond: boolean, detail: string, warnings?: string[]): void {
  steps.push({ name, pass: cond, detail, warnings });
  const sym = cond ? "✅" : "❌";
  console.log(`  ${sym} ${name}`);
  console.log(`     ${detail}`);
  if (warnings && warnings.length > 0) {
    for (const w of warnings) console.log(`     ⚠ ${w}`);
  }
}

function header(text: string): void {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${text}`);
  console.log("═".repeat(70));
}

function isA2UIMessage(m: any): boolean {
  if (!m || typeof m !== "object") return false;
  return (
    "createSurface" in m ||
    "updateComponents" in m ||
    "updateDataModel" in m
  );
}

function validateA2UIUpdate(a2uiUpdate: any): { valid: boolean; reason?: string } {
  if (!Array.isArray(a2uiUpdate)) return { valid: false, reason: "not array" };
  if (a2uiUpdate.length === 0) return { valid: false, reason: "empty" };
  for (const m of a2uiUpdate) {
    if (!isA2UIMessage(m)) return { valid: false, reason: `invalid message: ${JSON.stringify(m).slice(0, 80)}` };
    if (m.updateComponents) {
      const uc = m.updateComponents;
      if (!uc.surfaceId || !uc.root || !Array.isArray(uc.components)) {
        return { valid: false, reason: "updateComponents missing surfaceId/root/components" };
      }
    }
  }
  return { valid: true };
}

async function scenarioDailyTbm(): Promise<void> {
  header("시나리오 A: daily_tbm 작성 (안전관리자 시각)");

  // ────────────────────────────────────────────────────────────────
  // STEP 1: 폼 받기
  // ────────────────────────────────────────────────────────────────
  console.log("\n[STEP 1] render_a2ui_form('daily_tbm') — 폼 진입");
  const r1 = await renderA2UIFormTool.handler({
    docId: "daily_tbm",
    useProfile: false,
    format: "json" as const,
  });
  const sc1 = r1.structuredContent as any;

  check(
    "폼 필드·컴포넌트 정상",
    sc1.fieldCount > 0 && sc1.componentCount > 0,
    `fieldCount=${sc1.fieldCount} · componentCount=${sc1.componentCount} · actions=${sc1.activeActions.length}`,
  );

  check(
    "그래프 컨텍스트 인라인 (decision 002 R1)",
    sc1.graphContext.hazards.length > 0 &&
      sc1.graphContext.controls.length > 0 &&
      sc1.graphContext.legalArticles.length > 0,
    `hazards=${sc1.graphContext.hazards.length} · controls=${sc1.graphContext.controls.length} · legal=${sc1.graphContext.legalArticles.length} · relatedDocs=${sc1.graphContext.relatedDocs.length}`,
  );

  check(
    "writingGuide 노출",
    sc1.writingGuide.hasFieldHints &&
      sc1.writingGuide.commonMistakesCount > 0 &&
      sc1.writingGuide.bestPracticesCount > 0,
    `fieldHints=${sc1.writingGuide.hasFieldHints} · mistakes=${sc1.writingGuide.commonMistakesCount} · practices=${sc1.writingGuide.bestPracticesCount}`,
  );

  const components = sc1.messages[1].updateComponents.components;
  const buttons = components.filter((c: any) => c.component === "Button");
  const cards = components.filter((c: any) => c.component === "Card");
  const expectedActions = [
    "analyze_work_context",
    "suggest_controls_for_hazard",
    "request_field_help",
    "preview_review",
    "assemble_doc_context",
    "submit_safety_document",
  ];
  const actualActions = buttons.map((b: any) => b.action?.name);
  const allPresent = expectedActions.every((a) => actualActions.includes(a));
  check(
    "actions 6종 모두 등록 (decision 002 R2)",
    allPresent,
    `buttons=[${actualActions.join(", ")}]`,
  );

  check(
    "info-card + guide-card 동시 존재",
    cards.length >= 2,
    `cards=[${cards.map((c: any) => c.id).join(", ")}]`,
  );

  // ────────────────────────────────────────────────────────────────
  // STEP 2: 작업명 입력 → analyze_work_context
  // ────────────────────────────────────────────────────────────────
  console.log("\n[STEP 2] analyze_work_context — 사용자가 작업명 '굴착 작업' 입력");
  const r2 = await analyzeWorkContextTool.handler({
    docId: "daily_tbm",
    workName: "굴착 작업",
    workContent: "A동 5층 발코니 거푸집 양중 + B동 굴착",
    workConditions: { depthM: 3, heightM: 5 },
  });
  const sc2 = r2.structuredContent as any;

  check(
    "위험요인 그래프 추론",
    sc2.hazards.length > 0,
    `hazards=${sc2.hazards.length}건 (${sc2.hazards.slice(0, 2).map((h: any) => h.label).join(", ")})`,
  );

  check(
    "통제대책 ERIC 정렬",
    sc2.controls.length > 0 && sc2.controls.every((c: any) => typeof c.ericLevel === "number"),
    `controls=${sc2.controls.length}건 · ericLevels=${[...new Set(sc2.controls.map((c: any) => c.ericLevel))].sort().join(",")}`,
  );

  check(
    "조건 적용성 룰 발동 (depthM=3, heightM=5)",
    sc2.conditionWarnings.length >= 2 &&
      sc2.conditionWarnings.some((w: string) => w.includes("§38")) &&
      sc2.conditionWarnings.some((w: string) => w.includes("§42")),
    `warnings=${sc2.conditionWarnings.length}건 — ${sc2.conditionWarnings.map((w: string) => w.split(" ").slice(0, 3).join(" ")).join(" / ")}`,
  );

  const a2uiValid = validateA2UIUpdate(sc2.a2uiUpdate);
  check(
    "a2uiUpdate 메시지 정상 (decision 002 R3)",
    a2uiValid.valid,
    a2uiValid.valid ? `messages=${sc2.a2uiUpdate.length}` : `invalid: ${a2uiValid.reason}`,
  );

  check(
    "nextActions LLM 체이닝 추천",
    sc2.nextActions.length > 0 &&
      sc2.nextActions.some((a: string) => a.includes("suggest_controls_for_hazard") || a.includes("get_kosha_guide")),
    `nextActions=${sc2.nextActions.length}건`,
  );

  // ────────────────────────────────────────────────────────────────
  // STEP 3: 위험요인 입력 → suggest_controls_for_hazard
  // ────────────────────────────────────────────────────────────────
  console.log("\n[STEP 3] suggest_controls_for_hazard — 사용자가 '추락' 위험요인 입력");
  const r3 = await suggestControlsForHazardTool.handler({
    hazard: "추락",
    docId: "daily_tbm",
  });
  const sc3 = r3.structuredContent as any;

  check(
    "라벨 부분 매칭 hazard 검출",
    sc3.matchedHazards.length > 0,
    `matched=${sc3.matchedHazards.length} (${sc3.matchedHazards.slice(0, 3).map((h: any) => h.label).join(", ")})`,
  );

  check(
    "ERIC 위계별 cap 정렬",
    sc3.controls.length > 0 &&
      [...sc3.controls].every((c: any, i: number, arr: any[]) => i === 0 || arr[i - 1].ericLevel <= c.ericLevel || arr[i - 1].isDirectForDoc),
    `controls=${sc3.controls.length}/${sc3.totalControlsAvailable} (위계: ${[...new Set(sc3.controls.map((c: any) => c.ericLevel))].sort().join(",")})`,
  );

  // ────────────────────────────────────────────────────────────────
  // STEP 4: 필드 도움말 (currentValue 추상명사 검출)
  // ────────────────────────────────────────────────────────────────
  console.log("\n[STEP 4] request_field_help — hazard1 필드, currentValue='추락' (추상명사 검출 기대)");
  const r4 = await requestFieldHelpTool.handler({
    docId: "daily_tbm",
    fieldKey: "hazard1",
    currentValue: "추락",
  });
  const sc4 = r4.structuredContent as any;

  check(
    "필드 라벨·inputGuide 조회",
    sc4.fieldLabel && sc4.inputGuide,
    `label="${sc4.fieldLabel}" · inputGuide="${sc4.inputGuide?.slice(0, 50)}..."`,
  );

  check(
    "_meta.writingGuide.fieldHints 매칭",
    !!sc4.fieldHint,
    sc4.fieldHint ? `hint="${sc4.fieldHint.slice(0, 60)}..."` : "fieldHint 매칭 실패",
  );

  check(
    "currentValue 패턴 검사 (추상명사 경고)",
    sc4.matchedMistakes.length > 0,
    `matchedMistakes=${sc4.matchedMistakes.length}건`,
  );

  // ────────────────────────────────────────────────────────────────
  // STEP 5: 부분 검토 (일부만 작성한 상태)
  // ────────────────────────────────────────────────────────────────
  console.log("\n[STEP 5] preview_review (mid) — 작성 중간 (siteName + tbmDate 만)");
  const r5 = await previewReviewTool.handler({
    docId: "daily_tbm",
    draft: {
      metadata: { siteName: "황룡건설 삼성동 현장", planDate: "2026-05-21" },
      tbmDate: "2026-05-21 07:30",
    },
    scope: "required-only" as const,
  });
  const sc5 = r5.structuredContent as any;

  check(
    "필수 누락 검출 (required-only)",
    sc5.missingRequired.length > 0 && sc5.overall !== "pass",
    `missingRequired=${sc5.missingRequired.length}건 · overall=${sc5.overall}`,
  );

  check(
    "환각 0 (legitimate 작성 단계)",
    sc5.hallucinations.length === 0,
    `hallucinations=${sc5.hallucinations.length}`,
  );

  // ────────────────────────────────────────────────────────────────
  // STEP 6: 환각 시나리오 — 거짓 법령 인용
  // ────────────────────────────────────────────────────────────────
  console.log("\n[STEP 6] preview_review (hallucination-only) — 거짓 법령 §999 본문 인용");
  const r6 = await previewReviewTool.handler({
    docId: "daily_tbm",
    draft: {
      metadata: { siteName: "황룡건설", planDate: "2026-05-21" },
      workContent: "굴착 작업 — 산안기준규칙 §999 에 따라 시행",
    },
    scope: "hallucination-only" as const,
  });
  const sc6 = r6.structuredContent as any;

  check(
    "환각 §999 검출 (hallucination-only)",
    sc6.hallucinations.length > 0,
    `hallucinations=${sc6.hallucinations.length}건 — ${sc6.hallucinations[0]?.reference ?? ""}`,
  );

  // ────────────────────────────────────────────────────────────────
  // STEP 7: 최종 검토 — preview vs full review 일관성
  // ────────────────────────────────────────────────────────────────
  console.log("\n[STEP 7] preview_review 와 review_safety_document 결과 일관성");
  const fullDraft = {
    metadata: { siteName: "황룡건설", planDate: "2026-05-21" },
    tbmDate: "2026-05-21 07:30",
  };
  const previewAll = await previewReviewTool.handler({
    docId: "daily_tbm",
    draft: fullDraft,
    scope: "all" as const,
  });
  const reviewFull = await reviewSafetyDocumentTool.handler({
    docId: "daily_tbm",
    draft: fullDraft,
  });
  const scPrev = previewAll.structuredContent as any;
  const scRev = reviewFull.structuredContent as any;

  check(
    "preview_review.overall == review_safety_document.overall",
    scPrev.overall === scRev.overall,
    `preview=${scPrev.overall} · review=${scRev.overall}`,
  );

  check(
    "preview.summary.fail == review.summary.fail",
    scPrev.summary?.fail === scRev.summary?.fail,
    `preview.fail=${scPrev.summary?.fail} · review.fail=${scRev.summary?.fail}`,
  );
}

async function scenarioWorkPlanExcavation(): Promise<void> {
  header("시나리오 B: work_plan_excavation 작성 (§38 ② notifiedToWorkers 검증)");

  console.log("\n[STEP 1] render_a2ui_form('work_plan_excavation')");
  const r1 = await renderA2UIFormTool.handler({
    docId: "work_plan_excavation",
    useProfile: false,
    format: "json" as const,
  });
  const sc1 = r1.structuredContent as any;
  check(
    "굴착 작업계획서 폼 정상",
    sc1.fieldCount > 0,
    `fieldCount=${sc1.fieldCount} · graphContext.hazards=${sc1.graphContext.hazards.length} · legal=${sc1.graphContext.legalArticles.length}`,
  );

  console.log("\n[STEP 2] analyze_work_context — depthM=3 (§38 발동 기대)");
  const r2 = await analyzeWorkContextTool.handler({
    docId: "work_plan_excavation",
    workName: "굴착",
    workConditions: { depthM: 3 },
  });
  const sc2 = r2.structuredContent as any;
  check(
    "§38 조건 룰 발동",
    sc2.conditionWarnings.some((w: string) => w.includes("§38")),
    `${sc2.conditionWarnings[0] ?? "조건 룰 없음"}`,
  );

  console.log("\n[STEP 3] preview_review — notifiedToWorkers 누락 시 fail 기대 (§38 ②)");
  const r3 = await previewReviewTool.handler({
    docId: "work_plan_excavation",
    draft: {
      metadata: { siteName: "황룡건설", planDate: "2026-05-21" },
      workConditions: { depthM: 3 },
    },
    scope: "all" as const,
  });
  const sc3 = r3.structuredContent as any;
  const notifiedCheck = sc3.checks.find((c: any) =>
    c.rule.includes("작업계획서") && c.rule.includes("알림") ||
    c.rule.includes("notifiedToWorkers") ||
    c.rule.includes("§38") && c.rule.includes("②"),
  );
  check(
    "notifiedToWorkers 누락 검출 (또는 §38 ② manual_review)",
    sc3.overall !== "pass",
    `overall=${sc3.overall} · fail=${sc3.summary?.fail} · 관련 check=${notifiedCheck ? notifiedCheck.rule : "(개별 룰 미식별)"}`,
  );
}

async function scenarioGraphContextConsistency(): Promise<void> {
  header("시나리오 C: 그래프 SSoT 일관성 — render_a2ui_form vs analyze_work_context");

  // render_a2ui_form 의 graphContext 와 analyze_work_context 의 graph 결과가 동일 노드 기반인지
  const r1 = await renderA2UIFormTool.handler({
    docId: "daily_tbm",
    useProfile: false,
    format: "json" as const,
  });
  const sc1 = r1.structuredContent as any;
  const formHazardIris = new Set<string>(sc1.graphContext.hazards.map((h: any) => h.iri));

  const r2 = await analyzeWorkContextTool.handler({
    docId: "daily_tbm",
    workName: "TBM",
  });
  const sc2 = r2.structuredContent as any;
  const analyzeHazardIris = new Set<string>(sc2.hazards.map((h: any) => h.iri));

  // 폼이 가진 hazards 가 analyze 결과의 부분집합 또는 일치
  const intersection = [...formHazardIris].filter((iri) => analyzeHazardIris.has(iri));
  check(
    "render_a2ui_form.graphContext.hazards ⊆ analyze_work_context.hazards (SSoT 일치)",
    formHazardIris.size > 0 && intersection.length === formHazardIris.size,
    `form=${formHazardIris.size} · analyze=${analyzeHazardIris.size} · 교집합=${intersection.length}`,
  );

  // 법령근거 동일성
  const formLegalIris = new Set<string>(sc1.graphContext.legalArticles.map((l: any) => l.iri));
  const analyzeLegalIris = new Set<string>(sc2.legalArticles.map((l: any) => l.iri));
  const legalIntersection = [...formLegalIris].filter((iri) => analyzeLegalIris.has(iri));
  check(
    "법령근거 SSoT 일치",
    formLegalIris.size > 0 && legalIntersection.length === formLegalIris.size,
    `form=${formLegalIris.size} · analyze=${analyzeLegalIris.size} · 교집합=${legalIntersection.length}`,
  );
}

async function main(): Promise<void> {
  console.log("Active Graph Authoring Loop — 통합 시나리오 테스트 (decision 002)");
  console.log(`실행 시각: ${new Date().toISOString()}`);

  await scenarioDailyTbm();
  await scenarioWorkPlanExcavation();
  await scenarioGraphContextConsistency();

  // 결과 요약
  const pass = steps.filter((s) => s.pass).length;
  const fail = steps.filter((s) => !s.pass).length;
  header("전체 요약");
  console.log(`  PASS  ${pass}`);
  console.log(`  FAIL  ${fail}`);
  console.log(`  TOTAL ${steps.length}`);

  if (fail > 0) {
    console.log("\n실패 항목:");
    for (const s of steps) {
      if (!s.pass) console.log(`  ❌ ${s.name} — ${s.detail}`);
    }
    process.exit(1);
  }
  console.log("\n✅ 전체 통과 — decision 002 Active Graph Authoring Loop 통합 시나리오 검증 완료");
}

main().catch((err) => {
  console.error("실행 오류:", err);
  process.exit(1);
});
