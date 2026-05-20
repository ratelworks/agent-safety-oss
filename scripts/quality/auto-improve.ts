#!/usr/bin/env tsx
/**
 * auto-improve.ts (a-ar 패턴 의무문서 버전)
 *
 * 자율 개선 루프: 결함 검출 → 보강 계획 → 적용 → 검증 → KPI 측정 → 반복
 *
 * Commands:
 *   detect              결함 검출 + 우선순위 산출
 *   plan [docId]        Top 1 또는 지정 doc의 보강 계획 (가이드 후보 자동 생성)
 *   apply [planFile]    plan JSON 적용 (jsonld 노드 patch)
 *   verify              빌드 + 그래프 정합성 + 점수 측정
 *   rollback            마지막 apply 이전으로 git checkout
 *   run --max-rounds N  detect → plan → apply → verify 자동 반복
 *   status              현재 KPI 상태
 *
 * Guard Rails:
 *   1. npm run build 성공
 *   2. npm run verify-graph PASS
 *   3. KPI 향상 (총 결함 수 감소)
 *
 * 향상 안 되면 자동 롤백.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findGuide, type FieldGuide } from "./auto-improve-templates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const STATE_DIR = resolve(ROOT, "artifacts", "local", "auto-improve");

interface KPI {
  totalFields: number;
  emptyFields: number;
  emptyRatio: number;
  fieldsWithoutGuide: number;
  hallucinations: number;
  docsWithDefects: number;
  timestamp: string;
}

interface DocDefect {
  docId: string;
  category: string;
  emptyRatio: number;
  fieldsWithoutGuide: number;
  hallucinations: string[];
  priority: number;
}

interface Plan {
  docId: string;
  fields: Array<{
    sectionTitle: string;
    fieldKey: string;
    fieldLabel: string;
    inputGuide: string;
    standardFormat: string;
    examples: string[];
    checkPoints: string[];
  }>;
  generatedAt: string;
  generatedBy: "rule_based" | "manual" | "llm";
}

// ─── Detect ───────────────────────────────────────────────────────
async function cmdDetect(): Promise<{ kpi: KPI; defects: DocDefect[] }> {
  console.log("[detect] 70 의무문서 자동 결함 검출 중...");
  // auto-defect-detection.ts 호출 (이미 구현됨)
  execSync("npx tsx scripts/ontology/auto-defect-detection.ts > /tmp/auto-improve-detect.log 2>&1", { cwd: ROOT });

  const reportPath = resolve(ROOT, "artifacts", "test-results", "auto", "defect-report.json");
  const defects = JSON.parse(await readFile(reportPath, "utf-8")) as DocDefect[];

  const kpi: KPI = {
    totalFields: defects.reduce((s, d) => s + (d as any).totalFieldCount, 0),
    emptyFields: defects.reduce((s, d) => s + (d as any).emptyFieldCount, 0),
    emptyRatio: 0,
    fieldsWithoutGuide: defects.reduce((s, d) => s + d.fieldsWithoutGuide, 0),
    hallucinations: defects.reduce((s, d) => s + d.hallucinations.length, 0),
    docsWithDefects: defects.filter((d) => d.priority > 0).length,
    timestamp: new Date().toISOString(),
  };
  kpi.emptyRatio = kpi.totalFields > 0 ? kpi.emptyFields / kpi.totalFields : 0;

  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(resolve(STATE_DIR, "last-kpi.json"), JSON.stringify(kpi, null, 2), "utf-8");

  console.log(`[detect] KPI:`);
  console.log(`  · 빈칸 비율:           ${(100 * kpi.emptyRatio).toFixed(1)}% (${kpi.emptyFields}/${kpi.totalFields})`);
  console.log(`  · 가이드 미보유 필드:  ${kpi.fieldsWithoutGuide}`);
  console.log(`  · 환각 의심:           ${kpi.hallucinations}`);
  console.log(`  · 결함 문서 수:        ${kpi.docsWithDefects}/70`);
  console.log(`  · 우선순위 Top 5:`);
  for (let i = 0; i < Math.min(5, defects.length); i++) {
    const d = defects[i];
    console.log(`     ${i+1}. ${d.docId} (${d.category}, 우선순위 ${d.priority.toFixed(1)})`);
  }

  return { kpi, defects };
}

// ─── Plan (룰 기반 가이드 후보 자동 생성) ──────────────────────────
async function cmdPlan(docId?: string): Promise<Plan> {
  console.log(`[plan] 보강 계획 생성 — ${docId ?? "Top 1 자동 선택"}`);

  // detect 결과 로드 (없으면 실행)
  let defects: DocDefect[];
  const reportPath = resolve(ROOT, "artifacts", "test-results", "auto", "defect-report.json");
  try {
    await stat(reportPath);
    defects = JSON.parse(await readFile(reportPath, "utf-8"));
  } catch {
    const r = await cmdDetect();
    defects = r.defects;
  }

  // Target 선택
  let target = docId;
  if (!target) {
    const top = defects.find((d) => d.fieldsWithoutGuide > 0);
    if (!top) {
      console.log("[plan] 보강 대상 없음 (모든 doc에 가이드 보유)");
      return { docId: "", fields: [], generatedAt: new Date().toISOString(), generatedBy: "rule_based" };
    }
    target = top.docId;
    console.log(`[plan] 자동 선택: ${target} (가이드 미보유 ${top.fieldsWithoutGuide} 필드)`);
  }

  // doc 노드 로드
  const docPath = await findDocPath(target);
  if (!docPath) {
    console.error(`[plan] doc 파일 미발견: ${target}`);
    return { docId: target, fields: [], generatedAt: new Date().toISOString(), generatedBy: "rule_based" };
  }
  const doc = JSON.parse(await readFile(docPath, "utf-8"));

  // 카테고리 결정
  const tDocId = target;
  const category =
    tDocId === "msds_register" || tDocId.includes("msds") ? "chemical" :
    tDocId.startsWith("work_plan_") ? "workPlan" :
    tDocId.startsWith("work_permit") ? "workPermit" :
    (tDocId.includes("inspection") || tDocId.includes("check")) ? "inspection" :
    (tDocId.includes("drawing") || tDocId === "concrete_placement_plan" || tDocId === "aerial_work_platform_plan") ? "drawing" :
    (tDocId.includes("accident") || tDocId.includes("severe_accident")) ? "accident" :
    tDocId.includes("risk_assessment") ? "risk" :
    "admin";

  // sections.fields 중 inputGuide 없는 것만 추출 (카테고리·키워드 템플릿 활용)
  const plan: Plan = { docId: target, fields: [], generatedAt: new Date().toISOString(), generatedBy: "rule_based" };
  for (const sec of doc.sections ?? []) {
    for (const f of sec.fields ?? []) {
      if (!f.required) continue;
      if (f.inputGuide) continue; // 이미 보유
      const guide = findGuide(f.label, sec.title, category) ?? {
        inputGuide: ruleBasedInputGuide(f.label, sec.title, sec.legalSource),
        standardFormat: ruleBasedStandardFormat(f.label),
        examples: ruleBasedExamples(f.label),
        checkPoints: ruleBasedCheckPoints(f.label, sec.legalSource),
      };
      plan.fields.push({
        sectionTitle: sec.title,
        fieldKey: f.key,
        fieldLabel: f.label,
        inputGuide: guide.inputGuide,
        standardFormat: guide.standardFormat,
        examples: guide.examples,
        checkPoints: guide.checkPoints,
      });
    }
  }

  await mkdir(STATE_DIR, { recursive: true });
  const planPath = resolve(STATE_DIR, `plan-${target}.json`);
  await writeFile(planPath, JSON.stringify(plan, null, 2), "utf-8");

  console.log(`[plan] ${plan.fields.length}개 field 가이드 후보 생성 → ${planPath}`);
  console.log(`       (룰 기반 fallback. LLM 활용 시 더 정밀한 가이드 가능)`);
  console.log(`       검토 후 'apply ${planPath}' 명령으로 적용`);

  return plan;
}

async function findDocPath(docId: string): Promise<string | null> {
  const dir = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");
  const candidates = [docId.replace(/_/g, "-") + ".jsonld"];
  for (const c of candidates) {
    const p = resolve(dir, c);
    try { await stat(p); return p; } catch { /* next */ }
  }
  return null;
}

function ruleBasedInputGuide(label: string, sectionTitle: string, legalSource?: string): string {
  // 키워드 룰 기반 가이드 생성 — LLM 없을 때 fallback
  if (label.includes("일자") || label.includes("일시")) return "YYYY-MM-DD 또는 YYYY-MM-DD HH:MM 형식. 작업 전·후·중 어느 시점인지 명시.";
  if (label.includes("성명") || label.includes("이름")) return "전체 이름 + 자격·직위 명시 (예: '홍길동 (건설안전기사)').";
  if (label.includes("연락처") || label.includes("전화")) return "사업장 비상 가능한 24시간 연락처. 부서·역할 명시.";
  if (label.includes("주소") || label.includes("위치")) return "도로명주소 + 건물명 + 동·층 명시. 지도 좌표 권장.";
  if (label.includes("내용") || label.includes("개요")) return "5W1H 기반 (언제·어디서·누가·무엇을·왜·어떻게) 구체 서술. 추정·예시는 별도 표시.";
  if (label.includes("사유") || label.includes("이유")) return "객관적 사실 + 결정 근거 (법령·규정·내부 절차) 명시.";
  if (label.includes("조치") || label.includes("대책")) return "ERIC-PP 위계 (제거→대체→공학→관리→PPE) 적용. 시점·담당자·검증 방법 포함.";
  if (label.includes("예방")) return "발생 가능성 + 예방조치 (사전·사중·사후) 단계별. 책임자 지정.";
  if (legalSource?.includes("별표")) return `${legalSource} 항목별 표준 형식 따라 기재. 누락 시 ${legalSource} 위반.`;
  return `${sectionTitle} 섹션의 ${label} 항목. 사실 기반·구체 수치·근거 명시. 추정·예시는 별도 표시.`;
}

function ruleBasedStandardFormat(label: string): string {
  if (label.includes("일자") || label.includes("일시")) return "YYYY-MM-DD HH:MM";
  if (label.includes("연락처")) return "[성명] [직위] [연락처]";
  if (label.includes("성명")) return "[이름] ([자격·직위])";
  if (label.includes("주소")) return "[도로명주소] [건물명] [동·층]";
  if (label.includes("조치")) return "[조치명]: [실행 단계] / [담당자] / [기한]";
  return "[항목별 핵심 사실 + 근거]";
}

function ruleBasedExamples(label: string): string[] {
  if (label.includes("일자")) return ["2026-04-28 14:30", "2026-04-28"];
  if (label.includes("성명")) return ["홍길동 (건설안전기사)", "김안전 (산업안전기사·건설업)"];
  if (label.includes("연락처")) return ["박감독 현장소장 010-1234-5678", "안전관리실 02-XXX-XXXX (24h)"];
  if (label.includes("조치") || label.includes("대책")) return ["즉시 작업중지·대피 + 119 신고 + 사업주 보고", "위험지역 통제 + 추가 위험 차단 + 외부 지원 요청"];
  return ["(룰 기반 fallback — 실제 사례 보강 필요)", "(LLM 호출 시 정밀한 예시 가능)"];
}

function ruleBasedCheckPoints(label: string, legalSource?: string): string[] {
  const points: string[] = [];
  if (legalSource) points.push(`${legalSource} 요건 충족 확인`);
  if (label.includes("일자")) points.push("기록·보존 의무 (시행규칙 §241 등)");
  if (label.includes("성명") || label.includes("연락처")) points.push("사전 동의·개인정보 처리 적법 확인");
  if (label.includes("조치")) points.push("ERIC-PP 위계 적용 / 책임자 지정 / 기한 명시");
  if (points.length === 0) points.push("법령·내부 절차 준수 확인");
  return points;
}

// ─── Apply ──────────────────────────────────────────────────────────
async function cmdApply(planPath: string): Promise<void> {
  console.log(`[apply] ${planPath} 적용 중...`);

  // git stash로 기존 상태 백업
  const beforeHash = execSync("git stash create", { cwd: ROOT, encoding: "utf-8" }).trim();
  console.log(`[apply] 백업 hash: ${beforeHash || "(no changes to stash)"}`);

  const plan = JSON.parse(await readFile(planPath, "utf-8")) as Plan;
  const docPath = await findDocPath(plan.docId);
  if (!docPath) {
    console.error(`[apply] doc 미발견: ${plan.docId}`);
    return;
  }

  const doc = JSON.parse(await readFile(docPath, "utf-8"));
  let updated = 0;
  for (const sec of doc.sections ?? []) {
    for (const f of sec.fields ?? []) {
      const planField = plan.fields.find((p) => p.fieldKey === f.key);
      if (!planField) continue;
      f.inputGuide = planField.inputGuide;
      f.standardFormat = planField.standardFormat;
      f.examples = planField.examples;
      f.checkPoints = planField.checkPoints;
      updated += 1;
    }
  }
  await writeFile(docPath, JSON.stringify(doc, null, 2) + "\n", "utf-8");

  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(resolve(STATE_DIR, "last-apply.json"), JSON.stringify({
    docId: plan.docId,
    fieldsUpdated: updated,
    beforeHash,
    appliedAt: new Date().toISOString(),
  }, null, 2), "utf-8");

  console.log(`[apply] ✓ ${plan.docId}: ${updated}개 field 가이드 적용`);
}

// ─── Verify (Guard Rails) ───────────────────────────────────────────
async function cmdVerify(): Promise<{ pass: boolean; reasons: string[] }> {
  console.log("[verify] Guard Rails 검사...");
  const reasons: string[] = [];

  // Guard #1: 빌드
  try {
    execSync("npm run build > /tmp/auto-improve-build.log 2>&1", { cwd: ROOT });
    console.log("  ✓ Guard #1: npm run build 성공");
  } catch {
    reasons.push("build_failed");
    console.log("  ✗ Guard #1: build 실패");
    return { pass: false, reasons };
  }

  // Guard #2: 그래프 정합성
  try {
    const out = execSync("npm run verify-graph 2>&1", { cwd: ROOT, encoding: "utf-8" });
    const danglingMatch = out.match(/Dangling references:\s+(\d+)/);
    const danglingCount = danglingMatch ? Number(danglingMatch[1]) : -1;
    if (danglingCount === 0) {
      console.log("  ✓ Guard #2: 그래프 정합성 PASS (Dangling 0)");
    } else {
      reasons.push(`dangling_${danglingCount}`);
      console.log(`  ✗ Guard #2: Dangling ${danglingCount}건`);
      return { pass: false, reasons };
    }
  } catch {
    reasons.push("verify_graph_failed");
    return { pass: false, reasons };
  }

  // Guard #3: KPI 향상 측정
  const prevKpiPath = resolve(STATE_DIR, "last-kpi.json");
  let prevKpi: KPI | null = null;
  try { prevKpi = JSON.parse(await readFile(prevKpiPath, "utf-8")); } catch { /* 첫 라운드 */ }

  const { kpi: nowKpi } = await cmdDetect();
  if (prevKpi) {
    const prevDefect = prevKpi.fieldsWithoutGuide + prevKpi.emptyFields * 0.3;
    const nowDefect = nowKpi.fieldsWithoutGuide + nowKpi.emptyFields * 0.3;
    if (nowDefect < prevDefect) {
      console.log(`  ✓ Guard #3: KPI 향상 (defect ${prevDefect.toFixed(0)} → ${nowDefect.toFixed(0)})`);
    } else {
      reasons.push("kpi_no_improvement");
      console.log(`  ⚠ Guard #3: KPI 향상 없음 (${prevDefect.toFixed(0)} → ${nowDefect.toFixed(0)})`);
    }
  }

  return { pass: reasons.length === 0, reasons };
}

// ─── Rollback ──────────────────────────────────────────────────────
async function cmdRollback(): Promise<void> {
  const lastApplyPath = resolve(STATE_DIR, "last-apply.json");
  try {
    const last = JSON.parse(await readFile(lastApplyPath, "utf-8"));
    if (last.beforeHash) {
      execSync(`git checkout stash@{0} -- src/`, { cwd: ROOT });
      console.log(`[rollback] ${last.docId} 변경 롤백됨`);
    } else {
      console.log("[rollback] 백업 없음 (apply 안 됨)");
    }
  } catch (err) {
    console.error("[rollback] 실패:", (err as Error).message);
  }
}

// ─── Run (multi-round orchestrator) ────────────────────────────────
async function cmdRun(maxRounds: number): Promise<void> {
  console.log(`[run] 자율 개선 루프 시작 — 최대 ${maxRounds} 라운드`);
  const initial = await cmdDetect();

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`\n${"━".repeat(60)}\n[run] Round ${round}/${maxRounds}\n${"━".repeat(60)}`);

    // 1. plan
    const plan = await cmdPlan();
    if (plan.fields.length === 0) {
      console.log("[run] 더 이상 보강 대상 없음. 종료.");
      break;
    }
    const planPath = resolve(STATE_DIR, `plan-${plan.docId}.json`);

    // 2. apply
    await cmdApply(planPath);

    // 3. verify
    const verify = await cmdVerify();
    if (!verify.pass) {
      console.log(`[run] 검증 실패: ${verify.reasons.join(", ")} → 롤백`);
      await cmdRollback();
      break;
    }
    console.log(`[run] Round ${round} ✓ 적용 + 검증 성공`);
  }

  console.log("\n[run] 완료");
  const final = await cmdDetect();
  console.log(`\n[run] 최종 변화:`);
  console.log(`  빈칸 비율:         ${(100 * initial.kpi.emptyRatio).toFixed(1)}% → ${(100 * final.kpi.emptyRatio).toFixed(1)}%`);
  console.log(`  가이드 미보유:     ${initial.kpi.fieldsWithoutGuide} → ${final.kpi.fieldsWithoutGuide}`);
  console.log(`  결함 문서 수:      ${initial.kpi.docsWithDefects} → ${final.kpi.docsWithDefects}`);
}

// ─── Status ──────────────────────────────────────────────────────────
async function cmdStatus(): Promise<void> {
  try {
    const kpi = JSON.parse(await readFile(resolve(STATE_DIR, "last-kpi.json"), "utf-8")) as KPI;
    console.log(`[status] 마지막 KPI (${kpi.timestamp}):`);
    console.log(`  · 빈칸 비율:           ${(100 * kpi.emptyRatio).toFixed(1)}%`);
    console.log(`  · 가이드 미보유 필드:  ${kpi.fieldsWithoutGuide}`);
    console.log(`  · 결함 문서 수:        ${kpi.docsWithDefects}`);
  } catch {
    console.log("[status] 아직 detect 실행 안 됨. 'auto-improve detect' 먼저.");
  }
}

// ─── CLI ────────────────────────────────────────────────────────────
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "detect":  await cmdDetect(); break;
    case "plan":    await cmdPlan(args[0]); break;
    case "apply":   await cmdApply(args[0] ?? `${STATE_DIR}/plan-latest.json`); break;
    case "verify":  await cmdVerify(); break;
    case "rollback":await cmdRollback(); break;
    case "run": {
      const maxRounds = Number(args.find((a) => a.startsWith("--max-rounds="))?.split("=")[1] ?? args[0] ?? 3);
      await cmdRun(maxRounds);
      break;
    }
    case "status":  await cmdStatus(); break;
    default:
      console.log(`사용법:
  auto-improve detect              # 결함 검출 + KPI 측정
  auto-improve plan [docId]        # 보강 계획 (룰 기반 가이드 후보 자동 생성)
  auto-improve apply [planFile]    # plan 적용 (jsonld patch)
  auto-improve verify              # Guard Rails 검사 (build + graph + KPI)
  auto-improve rollback            # 마지막 apply 이전으로 복원
  auto-improve run --max-rounds=N  # 자율 개선 루프 (기본 3 라운드)
  auto-improve status              # 마지막 KPI 표시
`);
      process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
