#!/usr/bin/env tsx
/**
 * test-real-scenarios.ts
 *
 * 실제 안전관리자가 마주하는 4개 시나리오 도구 체이닝 검증.
 *
 *   S1. 사업장 의무 진단 → 매일 TBM 작성 컨텍스트 → 출력
 *   S2. 중대재해 발생 응답 (시간순 의무 → 산재조사표 제출처)
 *   S3. 화기작업 허가 (그래프 컨텍스트 → 양식 → 보관 추적)
 *   S4. 30일 임박 의무 알림 → 각 의무 작성 가이드
 *
 * 각 시나리오는 여러 도구를 순차 호출하며 출력을 다음 단계 입력으로 사용.
 * 실제 사용 케이스 검증.
 *
 * 실행: npx tsx scripts/test/test-real-scenarios.ts
 *      npm run mcp:test:scenarios
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(ROOT, "build", "cli.js");

interface CallOk {
  ok: true;
  ms: number;
  text: string;
  data: any;
}
interface CallFail {
  ok: false;
  ms: number;
  reason: string;
}
type CallResult = CallOk | CallFail;

function call(tool: string, input: Record<string, unknown> = {}): CallResult {
  const t0 = Date.now();
  const res = spawnSync(
    "node",
    [CLI, "call", tool, "--inputJson", JSON.stringify(input)],
    { encoding: "utf8", cwd: ROOT, maxBuffer: 16 * 1024 * 1024 },
  );
  const ms = Date.now() - t0;
  if (res.status !== 0) return { ok: false, ms, reason: `exit=${res.status}` };
  try {
    const parsed = JSON.parse(res.stdout);
    if (parsed.isError) return { ok: false, ms, reason: parsed.content?.[0]?.text?.slice(0, 100) ?? "isError" };
    return { ok: true, ms, text: parsed.content?.[0]?.text ?? "", data: parsed.structuredContent };
  } catch (e: any) {
    return { ok: false, ms, reason: `parse: ${e.message}` };
  }
}

let totalSteps = 0;
let passedSteps = 0;

function step(label: string, result: CallResult, assertions?: Array<[string, boolean]>): void {
  totalSteps++;
  const badge = result.ok ? "✅" : "❌";
  console.log(`  ${badge} ${label} (${result.ms}ms)`);
  if (!result.ok) {
    console.log(`     ${(result as any).reason}`);
    return;
  }
  let allPass = true;
  if (assertions) {
    for (const [desc, ok] of assertions) {
      const ab = ok ? "✓" : "✗";
      console.log(`     ${ab} ${desc}`);
      if (!ok) allPass = false;
    }
  }
  if (allPass) passedSteps++;
}

function header(title: string): void {
  console.log("\n" + "─".repeat(70));
  console.log(`  ${title}`);
  console.log("─".repeat(70));
}

// =============================================================
// S1. 황룡건설 35인 / 15억 — 매일 TBM 작성 워크플로우
// =============================================================
function scenarioS1(): void {
  header("S1. 사업장 의무 진단 → 매일 TBM 작성 컨텍스트 → 출력");

  // Step 1: 사업장 적용 의무 진단
  const r1 = call("assess_my_obligations", {
    workforce: 35,
    contractAmount: 1_500_000_000,
    industry: "construction",
  });
  step("의무 진단 (35인 / 15억 / 건설업)", r1, [
    ["applies ≥ 20", r1.ok && r1.data.summary.applies >= 20],
    ["depends_on_review > 0", r1.ok && r1.data.summary.dependsOnReview > 0],
  ]);

  // Step 2: 매일 의무 중 TBM 그래프 컨텍스트 조립
  const r2 = call("assemble_doc_context", { docId: "daily_tbm" });
  step("daily_tbm 그래프 컨텍스트", r2, [
    ["legalBasis ≥ 3", r2.ok && r2.data.legalBasis.length >= 3],
    ["hasHazard ≥ 1", r2.ok && r2.data.hazards.length >= 1],
    ["controls ≥ 1", r2.ok && r2.data.controls.length >= 1],
    ["unresolved = 0", r2.ok && r2.data.meta.unresolvedRefs.length === 0],
  ]);

  // Step 3: 작성된 draft 출력 (HTML)
  const r3 = call("export_drafted_document", {
    docId: "daily_tbm",
    draft: {
      siteName: "황룡건설(주) OO현장",
      date: "2026-04-30",
      hazards: "추락(3층 외벽), 부딪힘(자재 운반)",
      controls: "안전대 100% 착용 / 신호수 배치",
      attendees: "홍길동, 김철수, 박영희 (서명)",
      approvalChain: [
        { role: "관리감독자", name: "박영희", title: "현장반장", signed: true, date: "2026-04-30" },
      ],
    },
    format: "html",
  });
  step("HTML 출력", r3, [
    ["HTML 길이 > 1000자", r3.ok && r3.data.length > 1000],
    ["title 매칭", r3.ok && r3.data.title?.includes("TBM")],
  ]);
}

// =============================================================
// S2. 중대재해 (사망 1명) 응답 워크플로우
// =============================================================
function scenarioS2(): void {
  header("S2. 중대재해 발생 → 시간순 의무 → 산재조사표 제출처");

  // Step 1: 응급 워크플로우 (fatal)
  const r1 = call("get_incident_response_workflow", { severity: "fatal", incidentDate: "2026-04-30" });
  step("Fatal incident workflow", r1, [
    ["steps ≥ 6", r1.ok && r1.data.steps.length >= 6],
    ["T+0 즉시 보고 단계 포함", r1.ok && r1.data.steps[0].whenLabel.includes("즉시")],
    ["산재조사표 docId 연계", r1.ok && r1.data.steps.some((s: any) => s.docId === "industrial_accident_report")],
  ]);

  // Step 2: 산재조사표 제출 정보
  const r2 = call("get_submission_info", { docId: "industrial_accident_report" });
  step("산재조사표 제출 정보", r2, [
    ["관할 노동지청 명시", r2.ok && r2.data.submitTo?.includes("노동")],
    ["1개월 이내 마감", r2.ok && r2.data.submitDeadline?.includes("1개월")],
    ["전자제출 가능", r2.ok && r2.data.electronicSubmission?.available === true],
  ]);

  // Step 3: 산재조사표 그래프 컨텍스트 (작성 시 필요한 모든 정보)
  const r3 = call("assemble_doc_context", { docId: "industrial_accident_report" });
  step("산재조사표 그래프 컨텍스트 (별지 30호 매핑)", r3, [
    ["annex 매핑 ✓", r3.ok && r3.data.annex.found === true],
    ["annex 별지 30호", r3.ok && r3.data.annex.annexNumber === "30"],
    ["unresolved = 0", r3.ok && r3.data.meta.unresolvedRefs.length === 0],
    ["score = 7/7", r3.ok && r3.data.document.completenessScore === 7],
  ]);

  // Step 4: 1년 후 보관 상태 확인
  const r4 = call("get_retention_status", {
    docId: "industrial_accident_report",
    compileDate: "2026-04-30",
    asOf: "2027-04-30",
  });
  step("1년 후 보관 상태", r4, [
    ["status = active", r4.ok && r4.data.status === "active"],
    ["남은 보관 ≥ 1000일", r4.ok && (r4.data.remainingDays === "infinity" || r4.data.remainingDays >= 1000)],
  ]);
}

// =============================================================
// S3. 화기작업 허가 워크플로우
// =============================================================
function scenarioS3(): void {
  header("S3. 화기작업 허가 → 그래프 컨텍스트 → 양식 → 출력");

  // Step 1: 화기작업 허가서 그래프 컨텍스트
  const r1 = call("assemble_doc_context", { docId: "work_permit_hot_work" });
  step("화기작업 허가 그래프 컨텍스트", r1, [
    ["fire_explosion hazard 포함", r1.ok && r1.data.hazards.some((h: any) => h.iri === "hazard:fire_explosion")],
    ["fire_suppression control 포함", r1.ok && r1.data.controls.some((c: any) => c.iri === "control:eng_fire_suppression")],
    ["legalBasis ≥ 1", r1.ok && r1.data.legalBasis.length >= 1],
  ]);

  // Step 2: 화기작업 양식 검색 (downloadable forms)
  const r2 = call("list_downloadable_forms", { query: "화재" });
  step("화기/화재 양식 검색", r2, [
    ["forms ≥ 1", r2.ok && r2.data.total >= 1],
  ]);

  // Step 3: 작성 후 보관 상태
  const r3 = call("get_retention_status", {
    docId: "work_permit_hot_work",
    compileDate: "2026-04-30",
    asOf: "2026-05-30",
  });
  step("화기작업허가서 30일 후 보관", r3, [
    ["status 정의됨", r3.ok && typeof r3.data.status === "string"],
  ]);
}

// =============================================================
// S4. 30일 내 임박 의무 알림
// =============================================================
function scenarioS4(): void {
  header("S4. 30일 임박 의무 → 의무 진단 + 가이드");

  // Step 1: 30일 임박 의무
  const r1 = call("list_upcoming_duties", { withinDays: 30 });
  step("30일 임박 의무 조회", r1, [
    ["counts.total ≥ 5", r1.ok && r1.data.counts.total >= 5],
    ["adHoc 스킵 표시", r1.ok && r1.data.counts.adHocSkipped > 0],
  ]);

  // Step 2: 사업장 적용 의무 (대규모)
  const r2 = call("assess_my_obligations", {
    workforce: 80,
    contractAmount: 8_000_000_000,
    industry: "construction",
    hasContractor: true,
  });
  step("80인 / 80억 / 도급 적용 의무", r2, [
    ["applies ≥ 25", r2.ok && r2.data.summary.applies >= 25],
  ]);

  // Step 3: 착공 전 의무 패키지 (대규모)
  const r3 = call("get_construction_stage_duties", { stage: "pre", isLargeScale: true });
  step("착공 전 의무 (대규모)", r3, [
    ["must 의무 ≥ 5", r3.ok && r3.data.counts.must >= 5],
    ["유해위험방지계획서 포함", r3.ok && r3.data.duties.some((d: any) => d.docId === "hazardous_risk_prevention_plan_construction")],
  ]);
}

function main(): void {
  console.log("=".repeat(70));
  console.log("Agent Safety OSS MCP — 실제 사용 시나리오 테스트");
  console.log("=".repeat(70));
  console.log("4개 시나리오 × 도구 체이닝 (3~4 단계씩)\n");

  const t0 = Date.now();
  scenarioS1();
  scenarioS2();
  scenarioS3();
  scenarioS4();
  const totalMs = Date.now() - t0;

  console.log("\n" + "=".repeat(70));
  const allPass = passedSteps === totalSteps;
  const badge = allPass ? "✅ ALL PASS" : "⚠️ 일부 FAIL";
  console.log(`${badge}: ${passedSteps}/${totalSteps} 단계 통과 (총 ${totalMs}ms)`);
  console.log("=".repeat(70));

  process.exit(allPass ? 0 : 1);
}

main();
