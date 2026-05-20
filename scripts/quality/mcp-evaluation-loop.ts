#!/usr/bin/env tsx
/**
 * mcp-evaluation-loop.ts
 *
 * MCP 도구 + 그래프 컨텍스트의 실제 LLM 활용도 종합 평가.
 *
 * 시나리오 10종:
 *   1. 굴착 5m + 도시가스 (작업계획서 — 직접 큐레이션)
 *   2. 변전실 정전 작업 (LOTO 허가서)
 *   3. 타워크레인 설치 (작업계획서)
 *   4. MSDS 화학물질 등록 (MSDS 등록부)
 *   5. 중대재해 즉시보고 (사고 보고)
 *   6. 정기 위험성평가서 (위험성평가)
 *   7. 산업보건의 선임 (행정 — 룰 기반)        ← 약점 노출 예상
 *   8. 안전인증 신청서 (행정 — 룰 기반)
 *   9. 도급 협의체 회의록 (행정 — 룰 기반)
 *  10. 비계 점검표 (점검 — 직접 큐레이션)
 *
 * 평가 차원:
 *   A. 양식 충실도 (sections·fields 모두 채워질 수 있는가)
 *   B. 법령 정확성 (legalBasis·본문 발췌 정확)
 *   C. KOSHA 가이드 활용 (적합한 가이드 매핑)
 *   D. 위험·통제 자동 식별 (그래프 추론 효과)
 *   E. inputGuide 정밀도 (LLM이 빈칸 채울 수 있는가)
 *   F. 실무 활용도 (결재 가능 수준)
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUT = resolve(ROOT, "artifacts", "test-results", "mcp-eval");

interface Scenario {
  id: string;
  category: "workPlan" | "workPermit" | "risk" | "accident" | "inspection" | "admin" | "msds";
  curationType: "direct" | "rule_based";
  desc: string;
  input: any;
  expectedSections: string[];      // 핵심 섹션 키워드
  expectedHazards: string[];        // 식별되어야 할 위험
  expectedKoshaPattern?: RegExp;    // 매핑되어야 할 KOSHA 가이드
  expectedLegalArticles: string[];  // 인용되어야 할 법령
  llmFillability: "high" | "medium" | "low";  // LLM이 빈칸 채울 수 있는 정도 예상
}

const SCENARIOS: Scenario[] = [
  {
    id: "S1_굴착_5m_매설물",
    category: "workPlan",
    curationType: "direct",
    desc: "굴착 5m + 도시가스 매설관 인접",
    input: {
      docId: "work_plan_excavation",
      draft: { metadata: { siteName: "황룡 천안", planDate: "2026-04-28", supervisor: "홍길동" }, documentId: "T",
        workConditions: { depthM: 5.0, locationDetail: "도시가스 매설관 GL-1.5m 인접", workforce: 8 },
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "사업주", name: "T", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 8, constructionValue: 5, industry: "construction" },
    },
    expectedSections: ["사전조사", "작업계획"],
    expectedHazards: ["매몰", "붕괴", "추락", "가스"],
    expectedKoshaPattern: /굴착|흙막이|매설/,
    expectedLegalArticles: ["기준규칙:38", "별표4-6"],
    llmFillability: "high",
  },
  {
    id: "S2_LOTO",
    category: "workPermit",
    curationType: "direct",
    desc: "변전실 정전 작업 (LOTO)",
    input: {
      docId: "work_permit_loto",
      draft: { metadata: { siteName: "황룡 천안", planDate: "2026-04-28", supervisor: "이전기" }, documentId: "T",
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "전기책임자", name: "이전기", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 4, constructionValue: 5, industry: "construction" },
    },
    expectedSections: ["차단", "검전", "잠금"],
    expectedHazards: ["감전"],
    expectedKoshaPattern: /정전|LOTO|충전전로|감전/,
    expectedLegalArticles: ["기준규칙"],
    llmFillability: "high",
  },
  {
    id: "S3_TowerCrane",
    category: "workPlan",
    curationType: "direct",
    desc: "타워크레인 설치",
    input: {
      docId: "work_plan_tower_crane",
      draft: { metadata: { siteName: "황룡 강남", planDate: "2026-04-28", supervisor: "김타워" }, documentId: "T",
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "현장소장", name: "박감독", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 6, constructionValue: 30, industry: "construction" },
    },
    expectedSections: ["풍속", "지반", "조립"],
    expectedHazards: ["낙하", "전도"],
    expectedKoshaPattern: /타워크레인|크레인/,
    expectedLegalArticles: ["기준규칙:38", "별표4-1"],
    llmFillability: "high",
  },
  {
    id: "S4_MSDS",
    category: "msds",
    curationType: "direct",
    desc: "MSDS 화학물질 등록 (신너 600)",
    input: {
      docId: "msds_register",
      draft: { metadata: { siteName: "황룡 도장", planDate: "2026-04-28", supervisor: "김안전" }, documentId: "T",
        raw: { productName: "신너 600 (혼합용제)" },
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "사업주", name: "황룡", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 5, constructionValue: 5, industry: "construction" },
    },
    expectedSections: ["GHS", "응급조치", "노출방지"],
    expectedHazards: ["chemical_exposure"],
    expectedKoshaPattern: /MSDS|화학물질/,
    expectedLegalArticles: ["산안법:110", "산안법:114"],
    llmFillability: "high",
  },
  {
    id: "S5_SevereAccident",
    category: "accident",
    curationType: "direct",
    desc: "추락 사망사고 즉시보고",
    input: {
      docId: "severe_accident_immediate_report",
      draft: { metadata: { siteName: "황룡 천안", planDate: "2026-04-28", supervisor: "박감독" }, documentId: "T",
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "현장소장", name: "박감독", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 50, constructionValue: 80, industry: "construction" },
    },
    expectedSections: ["발생", "재해자", "조치"],
    expectedHazards: [],
    expectedLegalArticles: ["산안법:54"],
    llmFillability: "medium",
  },
  {
    id: "S6_RiskAssessment",
    category: "risk",
    curationType: "direct",
    desc: "정기 위험성평가서",
    input: {
      docId: "regular_risk_assessment",
      draft: { metadata: { siteName: "황룡 천안", planDate: "2026-04-28", supervisor: "김안전" }, documentId: "T",
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "사업주", name: "황룡", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 50, constructionValue: 30, industry: "construction" },
    },
    expectedSections: ["평가", "방법"],
    expectedHazards: [],
    expectedKoshaPattern: /위험성평가|HAZOP/,
    expectedLegalArticles: ["위험성평가-고시", "산안법:36"],
    llmFillability: "high",
  },
  // ── 룰 기반 자동 ── (약점 검증)
  {
    id: "S7_PhysicianAppointment",
    category: "admin",
    curationType: "rule_based",
    desc: "산업보건의 선임 신고 (50인 이상)",
    input: {
      docId: "industrial_physician_appointment",
      draft: { metadata: { siteName: "황룡건설(주)", planDate: "2026-04-28", supervisor: "황룡" }, documentId: "T",
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "대표이사", name: "황룡", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 75, constructionValue: 100, industry: "construction" },
    },
    expectedSections: ["선임", "보건의", "신고"],
    expectedHazards: [],
    expectedLegalArticles: ["산안법:22", "산안법시행령:29"],
    llmFillability: "low",  // 룰 기반이라 약할 것으로 예상
  },
  {
    id: "S8_SafetyCertification",
    category: "admin",
    curationType: "rule_based",
    desc: "안전인증 신청서 (크레인)",
    input: {
      docId: "safety_certification_application",
      draft: { metadata: { siteName: "㈜한국크레인", planDate: "2026-04-28", supervisor: "박제조" }, documentId: "T",
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "대표이사", name: "박제조", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 100, constructionValue: 50, industry: "construction" },
    },
    expectedSections: ["인증", "신청"],
    expectedLegalArticles: ["산안법:80", "산안법:83"],
    expectedHazards: [],
    llmFillability: "low",
  },
  {
    id: "S9_ContractorCouncil",
    category: "admin",
    curationType: "rule_based",
    desc: "도급 안전보건협의체 회의록",
    input: {
      docId: "contractor_safety_council",
      draft: { metadata: { siteName: "황룡 천안 (5개 도급)", planDate: "2026-04-28", supervisor: "박감독" }, documentId: "T",
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "현장소장", name: "박감독", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 80, constructionValue: 100, industry: "construction" },
    },
    expectedSections: ["참석", "협의"],
    expectedHazards: [],
    expectedLegalArticles: ["산안법:75", "산안법:64"],
    llmFillability: "medium",
  },
  {
    id: "S10_ScaffoldInspection",
    category: "inspection",
    curationType: "direct",
    desc: "비계 점검표",
    input: {
      docId: "scaffolding_inspection_checklist",
      draft: { metadata: { siteName: "황룡 천안", planDate: "2026-04-28", supervisor: "박감독" }, documentId: "T",
        emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
        approvalChain: [{ role: "현장소장", name: "박감독", signed: true, date: "2026-04-28" }] },
      scale: { workforce: 12, constructionValue: 5, industry: "construction" },
    },
    expectedSections: ["구조", "추락", "결과"],
    expectedHazards: ["fall_from_height"],
    expectedKoshaPattern: /비계/,
    expectedLegalArticles: ["기준규칙:57", "기준규칙:59"],
    llmFillability: "high",
  },
];

interface Eval {
  id: string;
  category: string;
  curation: string;
  bodyLength: number;
  // A. 양식 충실도
  sectionsCount: number;
  sectionsHit: number;
  // B. 법령 정확성
  legalCount: number;
  legalArticlesHit: number;
  hasLawExtract: boolean;
  // C. KOSHA 활용
  koshaCount: number;
  koshaPatternMatch: boolean;
  // D. 위험·통제
  hazardCount: number;
  hazardsHit: number;
  controlCount: number;
  // E. inputGuide 정밀도
  inputGuideCount: number;
  exampleCount: number;
  precisionScore: number;  // 가이드 텍스트 정밀도 (룰 기반 default vs 법령 본문 인용 비교)
  // F. 실무 활용도 (정성)
  hasGraphContext: boolean;
  practicalScore: number;  // 0-10
}

function evaluateScenario(s: Scenario, text: string, sc: any): Eval {
  // A. sections
  const sectionsCount = (text.match(/^## \d+\./gm) ?? []).length;
  const sectionsHit = s.expectedSections.filter((kw) => text.includes(kw)).length;

  // B. 법령
  const legalCount = sc.legalBasisCount ?? 0;
  const legalArticlesHit = s.expectedLegalArticles.filter((art) =>
    text.includes(art.replace(":", " §").replace("산안법", "산업안전보건법"))
    || text.includes(art) || text.includes(art.replace("기준규칙", "기준에 관한 규칙"))
  ).length;
  const hasLawExtract = text.includes("```\n①") || text.includes("```\n사업주") || text.includes("```\n- ") || text.includes("```\n제");

  // C. KOSHA
  const koshaCount = sc.koshaGuideCount ?? 0;
  const koshaPatternMatch = s.expectedKoshaPattern ? !!text.match(s.expectedKoshaPattern) : true;

  // D. 위험·통제
  const hazardCount = sc.hazardCount ?? 0;
  const hazardsHit = s.expectedHazards.filter((h) => text.includes(h)).length;
  const controlCount = sc.controlCount ?? 0;

  // E. inputGuide 정밀도
  const inputGuideCount = (text.match(/- 작성 방법:/g) ?? []).length;
  const exampleCount = (text.match(/^  - /gm) ?? []).length;
  // 정밀도 검출: 일반화 default 키워드 등장 비율
  const genericMatches = (text.match(/행정·관리체계 문서|행정문서 표준 — 법적 근거|\(룰 기반 fallback —|N\/A/g) ?? []).length;
  const precisionScore = inputGuideCount > 0
    ? Math.max(0, 10 - Math.floor(10 * genericMatches / inputGuideCount))
    : 5;

  // F. 실무
  const hasGraphContext = !!sc.graphContext;

  // 정성 점수 (heuristic)
  let practicalScore = 0;
  if (sectionsHit >= s.expectedSections.length * 0.5) practicalScore += 2;
  if (legalArticlesHit >= s.expectedLegalArticles.length * 0.5) practicalScore += 2;
  if (hasLawExtract) practicalScore += 1;
  if (koshaPatternMatch && koshaCount > 0) practicalScore += 1;
  if (hazardsHit >= s.expectedHazards.length * 0.5) practicalScore += 1;
  if (precisionScore >= 7) practicalScore += 2;
  if (hasGraphContext) practicalScore += 1;

  return {
    id: s.id, category: s.category, curation: s.curationType, bodyLength: text.length,
    sectionsCount, sectionsHit, legalCount, legalArticlesHit, hasLawExtract,
    koshaCount, koshaPatternMatch, hazardCount, hazardsHit, controlCount,
    inputGuideCount, exampleCount, precisionScore, hasGraphContext, practicalScore,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const evals: Eval[] = [];

  console.log("Phase 2-3: 시나리오 10종 시뮬레이션 + 평가\n");
  for (const s of SCENARIOS) {
    const r: any = await generateSafetyDocumentTool.handler(s.input);
    const text = r.content?.[0]?.text ?? "";
    const sc = r.structuredContent ?? {};
    const ev = evaluateScenario(s, text, sc);
    evals.push(ev);
    await writeFile(resolve(OUT, `${s.id}.md`), text, "utf-8");
    await writeFile(resolve(OUT, `${s.id}.meta.json`), JSON.stringify(sc, null, 2), "utf-8");
  }

  // 결과 표
  console.log("| ID | 카테고리 | 큐레이션 | 길이 | 섹션 | 법령 | KOSHA | hazard | 가이드 | 예시 | 정밀도 | 실무점수 |");
  console.log("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const e of evals) {
    console.log(`| ${e.id} | ${e.category} | ${e.curation} | ${e.bodyLength} | ${e.sectionsHit}/${e.sectionsCount} | ${e.legalArticlesHit}/${e.legalCount} | ${e.koshaCount}${e.koshaPatternMatch ? "✓" : "✗"} | ${e.hazardsHit}/${e.hazardCount} | ${e.inputGuideCount} | ${e.exampleCount} | ${e.precisionScore}/10 | ${e.practicalScore}/10 |`);
  }

  console.log("\n\n=== 종합 평가 ===");
  const direct = evals.filter((e) => e.curation === "direct");
  const rule = evals.filter((e) => e.curation === "rule_based");
  console.log(`직접 큐레이션 (${direct.length}개) 평균:`);
  console.log(`  실무 점수: ${(direct.reduce((s, e) => s + e.practicalScore, 0) / direct.length).toFixed(1)}/10`);
  console.log(`  정밀도:    ${(direct.reduce((s, e) => s + e.precisionScore, 0) / direct.length).toFixed(1)}/10`);
  console.log(`룰 기반 자동 (${rule.length}개) 평균:`);
  console.log(`  실무 점수: ${(rule.reduce((s, e) => s + e.practicalScore, 0) / rule.length).toFixed(1)}/10`);
  console.log(`  정밀도:    ${(rule.reduce((s, e) => s + e.precisionScore, 0) / rule.length).toFixed(1)}/10`);

  // 부족분 자동 식별
  console.log("\n=== 부족분 자동 식별 ===");
  const weak = evals.filter((e) => e.practicalScore < 7 || e.precisionScore < 7);
  for (const w of weak) {
    const issues: string[] = [];
    if (w.practicalScore < 7) issues.push(`실무점수 ${w.practicalScore}`);
    if (w.precisionScore < 7) issues.push(`정밀도 ${w.precisionScore}`);
    if (!w.hasLawExtract) issues.push("법령본문 미발췌");
    if (w.legalArticlesHit === 0) issues.push("법령 매핑 누락");
    if (w.koshaCount === 0 && w.category !== "accident") issues.push("KOSHA 매핑 부재");
    console.log(`  ⚠ ${w.id}: ${issues.join(", ")}`);
  }

  await writeFile(resolve(OUT, "evaluation.json"), JSON.stringify(evals, null, 2), "utf-8");
}

main().catch(console.error);
