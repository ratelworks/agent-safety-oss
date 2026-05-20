#!/usr/bin/env tsx
/**
 * 필드 테스트 — 4 시나리오 × 8단계 워크플로우
 *
 * 신입 안전관리자가 실제 의무 문서를 작성하는 end-to-end:
 *   1. listSafetyDocumentsByCycle (어떤 의무 있나)
 *   2. getWorkPlan/Permit/RiskAssessmentSchema (스펙)
 *   3. analyzeConstructionWorkRisks 또는 chooseAssessmentMethod
 *   4. searchKoshaArchive ctgr (자료실)
 *   5. queryLegalBasis (법령)
 *   6. getSafetyLawArticle (법령 본문)
 *   7. generateSafetyDocument (실제 작성)
 *   8. reviewSafetyDocument (검수)
 *
 * 평가:
 *   - 각 단계 통과 여부
 *   - 응답 품질 (legal grounding, KOSHA 매핑, 실무 활용도)
 *   - 일관성 (1단계 결과를 다음 단계 input 으로 사용)
 *   - 최종 문서가 실무에서 결재 가능한 수준인가
 */
import { listSafetyDocumentsByCycleTool } from "../../build/tools/list-safety-documents-by-cycle.js";
import { getWorkPlanSchemaTool } from "../../build/tools/get-work-plan-schema.js";
import { getRiskAssessmentSchemaTool } from "../../build/tools/get-risk-assessment-schema.js";
import { analyzeConstructionWorkRisksTool } from "../../build/tools/analyze-construction-work-risks.js";
import { chooseAssessmentMethodTool } from "../../build/tools/choose-assessment-method.js";
import { searchKoshaArchiveTool } from "../../build/tools/search-kosha-archive.js";
import { queryLegalBasisTool } from "../../build/tools/query-legal-basis.js";
import { getSafetyLawArticleTool } from "../../build/tools/get-safety-law-article.js";
import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { reviewSafetyDocumentTool } from "../../build/tools/review-safety-document.js";
import { compileSafetyReferencesTool } from "../../build/tools/compile-safety-references.js";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "..", "artifacts", "test-results", "field");

interface Step { name: string; tool: any; input: any; }
interface Scenario { id: string; name: string; persona: string; steps: Step[]; }

const SCENARIOS: Scenario[] = [
  {
    id: "S1_excavation",
    name: "굴착작업 5m + 도시가스 인접 — 작업계획서 작성",
    persona: "신입 안전관리자 (입사 6개월), 첫 굴착 현장",
    steps: [
      { name: "ad_hoc 의무 문서 목록", tool: listSafetyDocumentsByCycleTool, input: { cycle: "ad_hoc" } },
      { name: "굴착 작업계획서 스펙", tool: getWorkPlanSchemaTool, input: { workPlanType: "excavation" } },
      { name: "굴착 5m 위험 분석", tool: analyzeConstructionWorkRisksTool, input: { workType: "excavation", depthM: 5, locationDetail: "도시가스 매설관 GL-1.5m 인접" } },
      { name: "KOSHA 자료실 굴착 작업", tool: searchKoshaArchiveTool, input: { ctgr03: "04", shpCd: "ops" } },
      { name: "굴착 법령 근거", tool: queryLegalBasisTool, input: { docId: "work_plan_excavation" } },
      { name: "산안기준규칙 §338 본문", tool: getSafetyLawArticleTool, input: { ref: "산안기준규칙 §338" } },
      { name: "굴착 작업계획서 생성", tool: generateSafetyDocumentTool, input: {
        docId: "work_plan_excavation",
        draft: { metadata: { siteName: "황룡 천안 신축", planDate: "2026-04-29", supervisor: "신입김" }, documentId: "WP-EXC-001",
          workConditions: { depthM: 5.0, locationDetail: "도시가스 매설관 GL-1.5m 인접", workforce: 8 },
          emergencyContacts: { fire: "119", labor: "1350", hospital: "119", owner: "010-XXXX-XXXX" },
          approvalChain: [{ role: "사업주", name: "홍길동", signed: true, date: "2026-04-29" }] },
        scale: { workforce: 8, constructionValue: 5, industry: "construction" },
      } },
      { name: "생성 문서 검수", tool: reviewSafetyDocumentTool, input: {
        docId: "work_plan_excavation",
        draft: { metadata: { siteName: "황룡 천안 신축", planDate: "2026-04-29", supervisor: "신입김" }, documentId: "WP-EXC-001",
          workConditions: { depthM: 5.0, locationDetail: "도시가스 매설관 GL-1.5m 인접", workforce: 8 },
          emergencyContacts: { fire: "119", labor: "1350", hospital: "119", owner: "010-XXXX-XXXX" },
          approvalChain: [{ role: "사업주", name: "홍길동", signed: true, date: "2026-04-29" }] },
        scale: { workforce: 8, constructionValue: 5, industry: "construction" },
      } },
    ],
  },
  {
    id: "S2_severe_accident",
    name: "중대재해 발생 — 즉시 보고서 작성",
    persona: "긴급 상황, 119 호출 후 다음 단계",
    steps: [
      { name: "ad_hoc 의무 문서", tool: listSafetyDocumentsByCycleTool, input: { cycle: "ad_hoc" } },
      { name: "중대재해 보고 안전 자료 컴파일", tool: compileSafetyReferencesTool, input: { workType: "중대재해 즉시 보고", docType: "general" } },
      { name: "산안법 §54 본문", tool: getSafetyLawArticleTool, input: { ref: "산안법 §54" } },
      { name: "중처법 §6 본문", tool: getSafetyLawArticleTool, input: { ref: "중처법 §6" } },
      { name: "건설업 사망사고 검색", tool: searchKoshaArchiveTool, input: { ctgr01: "09", shpCd: "ops" } },
      { name: "중대재해 즉시 보고서 생성 (빈 input)", tool: generateSafetyDocumentTool, input: {
        docId: "severe_accident_immediate_report",
        draft: { metadata: { siteName: "황룡 천안 신축", planDate: "2026-04-29", supervisor: "신입최" }, documentId: "SAR-001",
          // 신입 페르소나 — 긴급 상황에서 핵심 항목 빈칸 (가이드가 채울 수 있도록)
          emergencyContacts: { fire: "119", labor: "1350", hospital: "119", owner: "010-XXXX-XXXX" },
          approvalChain: [{ role: "현장소장", name: "김소장", signed: true, date: "2026-04-29" }] },
        scale: { workforce: 50, constructionValue: 80, industry: "construction" },
      } },
      { name: "보고서 검수", tool: reviewSafetyDocumentTool, input: {
        docId: "severe_accident_immediate_report",
        draft: { metadata: { siteName: "황룡 천안 신축", planDate: "2026-04-29", supervisor: "신입최" }, documentId: "SAR-001",
          occurrenceDate: "2026-04-29 14:30 / 충남 천안시 동남구 황룡건설 신축현장 1공구",
          injured: "홍길동 (만 42세, 형틀목공)",
          circumstances: "거푸집 해체 작업 중 추락 (h=8m)",
          immediateAction: "1. 119 호출 / 2. 작업 중지 / 3. 사업주 보고 / 4. 노동청 보고",
          emergencyContacts: { fire: "119", labor: "1350", hospital: "119", owner: "010-XXXX-XXXX" } },
        scale: { workforce: 50, constructionValue: 80, industry: "construction" },
      } },
    ],
  },
  {
    id: "S3_msds",
    name: "신너 600 MSDS 등록",
    persona: "도장 작업장, 첫 화학물질 등록",
    steps: [
      { name: "continuous 의무 문서", tool: listSafetyDocumentsByCycleTool, input: { cycle: "continuous" } },
      { name: "MSDS 자료 컴파일", tool: compileSafetyReferencesTool, input: { workType: "신너 도장 작업", docType: "general" } },
      { name: "산안법 §110 본문", tool: getSafetyLawArticleTool, input: { ref: "산안법 §110" } },
      { name: "산안법시행규칙 §156", tool: getSafetyLawArticleTool, input: { ref: "산안법시행규칙 §156" } },
      { name: "KOSHA 자료실 화학물질관리", tool: searchKoshaArchiveTool, input: { ctgr04: "04", shpCd: "ops" } },
      { name: "MSDS 등록부 생성", tool: generateSafetyDocumentTool, input: {
        docId: "msds_register",
        draft: { metadata: { siteName: "황룡 도장", planDate: "2026-04-29", supervisor: "신입이" }, documentId: "MSDS-001",
          raw: { productName: "신너 600 (혼합용제)", productCategory: "도장 용제", supplierName: "(주)대한화학", supplierContact: "1599-XXXX" },
          emergencyContacts: { fire: "119", labor: "1350", hospital: "119", owner: "010-XXXX-XXXX" },
          approvalChain: [{ role: "사업주", name: "홍길동", signed: true, date: "2026-04-29" }] },
        scale: { workforce: 5, constructionValue: 5, industry: "construction" },
      } },
      { name: "MSDS 검수", tool: reviewSafetyDocumentTool, input: {
        docId: "msds_register",
        draft: { metadata: { siteName: "황룡 도장", planDate: "2026-04-29", supervisor: "신입이" }, documentId: "MSDS-001",
          raw: { productName: "신너 600", productCategory: "용제" },
          emergencyContacts: { fire: "119", labor: "1350", hospital: "119", owner: "010-XXXX-XXXX" } },
        scale: { workforce: 5, constructionValue: 5, industry: "construction" },
      } },
    ],
  },
  {
    id: "S4_risk_assessment",
    name: "정기 위험성평가 (1년 주기)",
    persona: "안전관리자, 첫 정기 위험성평가",
    steps: [
      { name: "annual 의무 문서", tool: listSafetyDocumentsByCycleTool, input: { cycle: "annual" } },
      { name: "위험성평가 스펙", tool: getRiskAssessmentSchemaTool, input: {} },
      { name: "평가 방법 선택 (KRAS)", tool: chooseAssessmentMethodTool, input: { industry: "construction", scale: "medium", subject: "construction" } },
      { name: "위험성평가 고시 §6 본문", tool: getSafetyLawArticleTool, input: { ref: "위험성평가 §6" } },
      { name: "산안법 §36 본문", tool: getSafetyLawArticleTool, input: { ref: "산안법 §36" } },
      { name: "정기 위험성평가 생성", tool: generateSafetyDocumentTool, input: {
        docId: "regular_risk_assessment",
        draft: { metadata: { siteName: "황룡 천안 신축", planDate: "2026-04-29", supervisor: "신입강" }, documentId: "RRA-2026-001",
          assessmentScope: "본사 + 천안 신축현장 + 강남 리모델링현장 (총 3곳)",
          assessmentMethod: "위험성 추정법 (5×4 matrix)",
          assessmentTeam: ["안전관리자 신입강", "관리감독자 김반장", "근로자대표 박철수"],
          emergencyContacts: { fire: "119", labor: "1350", hospital: "119", owner: "010-XXXX-XXXX" },
          approvalChain: [{ role: "사업주", name: "홍길동", signed: true, date: "2026-04-29" }] },
        scale: { workforce: 50, constructionValue: 30, industry: "construction" },
      } },
      { name: "위험성평가 검수", tool: reviewSafetyDocumentTool, input: {
        docId: "regular_risk_assessment",
        draft: { metadata: { siteName: "황룡 천안", planDate: "2026-04-29", supervisor: "신입강" }, documentId: "RRA-2026-001",
          assessmentScope: "본사 + 천안 신축",
          assessmentMethod: "위험성 추정법",
          emergencyContacts: { fire: "119", labor: "1350", hospital: "119", owner: "010-XXXX-XXXX" } },
        scale: { workforce: 50, constructionValue: 30, industry: "construction" },
      } },
    ],
  },
];

interface StepResult { name: string; ok: boolean; bytes: number; isError: boolean; meta?: any; error?: string; }
interface ScenarioResult { id: string; name: string; persona: string; steps: StepResult[]; allOk: boolean; totalBytes: number; ms: number; }

async function runStep(s: Step): Promise<StepResult> {
  try {
    const r: any = await s.tool.handler(s.input);
    const text = (r.content?.[0]?.text ?? "");
    const isError = r.isError === true;
    const sc = r.structuredContent ?? {};
    // review tool: isError=true 는 결함 발견(정상 동작), 응답 본문이 있으면 ok
    // throw 나거나 본문 0 byte 만 진짜 fail
    const isReviewTool = s.tool.name === "review_safety_document";
    const ok = isReviewTool ? text.length > 0 : !isError;
    return { name: s.name, ok, bytes: text.length, isError, meta: { iris: countIris(sc), graphContextFields: Object.keys(sc.graphContext ?? {}).length } };
  } catch (e) {
    return { name: s.name, ok: false, bytes: 0, isError: true, error: (e as Error).message };
  }
}

function countIris(sc: any): number {
  // graphContext 안의 IRI 참조 카운트
  const gc = sc.graphContext ?? {};
  let cnt = 0;
  for (const v of Object.values(gc)) {
    if (Array.isArray(v)) cnt += v.filter(x => typeof x === "string" && /^[a-z]+:/.test(x)).length;
  }
  return cnt;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const results: ScenarioResult[] = [];

  for (const sc of SCENARIOS) {
    const start = Date.now();
    const steps: StepResult[] = [];
    let totalBytes = 0;
    for (const st of sc.steps) {
      const r = await runStep(st);
      steps.push(r);
      totalBytes += r.bytes;
    }
    const ms = Date.now() - start;
    const allOk = steps.every(s => s.ok);
    results.push({ id: sc.id, name: sc.name, persona: sc.persona, steps, allOk, totalBytes, ms });

    // 마지막 generate 결과 저장
    const genStep = sc.steps.find(s => s.tool.name === "generate_safety_document");
    if (genStep) {
      const r: any = await genStep.tool.handler(genStep.input);
      await writeFile(resolve(OUT, `${sc.id}.md`), r.content?.[0]?.text ?? "", "utf-8");
      await writeFile(resolve(OUT, `${sc.id}.meta.json`), JSON.stringify(r.structuredContent ?? {}, null, 2), "utf-8");
    }
  }

  // 결과 출력
  console.log("\n" + "=".repeat(80));
  console.log("필드 테스트 — 4 시나리오 × 8단계 워크플로우 결과");
  console.log("=".repeat(80));

  for (const r of results) {
    console.log(`\n[${r.id}] ${r.name}`);
    console.log(`  페르소나: ${r.persona}`);
    console.log(`  통과: ${r.steps.filter(s=>s.ok).length}/${r.steps.length} | 본문 ${r.totalBytes} bytes | ${r.ms}ms`);
    console.log(`  단계별:`);
    for (const s of r.steps) {
      const mark = s.ok ? "✓" : "✗";
      const meta = s.meta ? ` (IRI ${s.meta.iris}, graphContext ${s.meta.graphContextFields} fields)` : "";
      const err = s.error ? ` ERR: ${s.error.substring(0, 60)}` : "";
      console.log(`    ${mark} ${s.name}: ${s.bytes}b${meta}${err}`);
    }
  }

  // 종합
  const totalSteps = results.reduce((s, r) => s + r.steps.length, 0);
  const passSteps = results.reduce((s, r) => s + r.steps.filter(x => x.ok).length, 0);
  console.log("\n" + "=".repeat(80));
  console.log(`종합: ${passSteps}/${totalSteps} 단계 통과 (${(passSteps/totalSteps*100).toFixed(1)}%)`);
  console.log(`시나리오 전체 통과: ${results.filter(r => r.allOk).length}/${results.length}`);
  console.log(`평균 응답: ${(results.reduce((s,r)=>s+r.totalBytes,0)/results.length/1000).toFixed(1)}KB / 시나리오`);
  console.log(`평균 시간: ${(results.reduce((s,r)=>s+r.ms,0)/results.length).toFixed(0)}ms / 시나리오`);

  await writeFile(resolve(OUT, "summary.json"), JSON.stringify(results, null, 2), "utf-8");
}

main().catch((e) => { console.error(e); process.exit(1); });
