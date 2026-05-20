#!/usr/bin/env tsx
/**
 * document-quality-test-v2.ts
 *
 * v2 개선:
 *   1. 문서 종류별 평가 기준 차별화 (workPlan / workPermit / accident / admin / inspection)
 *   2. graphContext 점수 항목 (P1 개선 검증)
 *   3. ERIC-PP 정밀도 점수 (P4 개선 검증 — 직접 매핑 비율)
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUT_DIR = resolve(ROOT, "artifacts", "test-results", "v2");

type DocCategory = "workPlan" | "workPermit" | "accident" | "admin" | "inspection";

interface Scenario {
  id: string;
  desc: string;
  category: DocCategory;
  input: any;
  expectedHazards: string[];
  expectedKoshaPattern?: RegExp;
  expectedSections: string[];
}

const SCENARIOS: Scenario[] = [
  {
    id: "S1_굴착_5m_매설물",
    desc: "황룡건설 굴착 5m + 도시가스 매설관 인접",
    category: "workPlan",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "홍길동 (건설안전기사)" },
        documentId: "WP-EX-20260428-001",
        approvalChain: [
          { role: "사업주", name: "황룡 (이사)", signed: true, date: "2026-04-28" },
          { role: "관리감독자", name: "박감독 (현장소장)", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-04-29 ~ 2026-05-15",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114 단국대병원", owner: "010-1234-5678 황룡" },
        workConditions: { depthM: 5.0, locationDetail: "도시가스 매설관 GL-1.5m 인접", workforce: 8 },
      },
      scale: { workforce: 8, constructionValue: 5, industry: "construction" },
    },
    expectedHazards: ["매몰", "붕괴", "추락", "낙하", "가스", "감전"],
    expectedKoshaPattern: /굴착|흙막이|토공|매설/,
    expectedSections: ["사전조사", "작업계획", "통지"],
  },
  {
    id: "S2_정전작업_LOTO",
    desc: "변전실 정전 점검 (LOTO)",
    category: "workPermit",
    input: {
      docId: "work_permit_loto",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "이전기 (전기기사)" },
        documentId: "WP-LOTO-20260428-002",
        approvalChain: [{ role: "전기책임자", name: "이전기", signed: true, date: "2026-04-28" }],
        workPeriod: "2026-04-29 09:00 ~ 16:00",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
      },
      scale: { workforce: 4, constructionValue: 5, industry: "construction" },
    },
    expectedHazards: ["감전", "정전", "활선"],
    expectedKoshaPattern: /정전|LOTO|잠금|차단|충전전로/,
    expectedSections: ["차단", "검전", "잠금"],
  },
  {
    id: "S3_타워크레인_작업계획서",
    desc: "타워크레인 설치·해체",
    category: "workPlan",
    input: {
      docId: "work_plan_tower_crane",
      draft: {
        metadata: { siteName: "황룡건설 서울 강남 빌딩현장", planDate: "2026-04-28", supervisor: "김타워" },
        documentId: "WP-TC-20260428-003",
        approvalChain: [{ role: "현장소장", name: "박감독", signed: true, date: "2026-04-28" }],
        workPeriod: "2026-05-01 ~ 2026-05-03",
        emergencyContacts: { fire: "119", labor: "02-1234-5678", hospital: "강남병원", owner: "010-1234-5678" },
      },
      scale: { workforce: 6, constructionValue: 30, industry: "construction" },
    },
    expectedHazards: ["낙하", "전도", "추락"],
    expectedKoshaPattern: /타워크레인|크레인|양중|지지/,
    expectedSections: ["풍속", "지반", "조립"],
  },
  {
    id: "S4_경영방침_CEO",
    desc: "안전보건경영방침 (중처법 §4)",
    category: "admin",
    input: {
      docId: "safety_health_management_policy",
      draft: {
        metadata: { siteName: "황룡건설(주) 본사", planDate: "2026-04-28", supervisor: "황룡" },
        documentId: "POL-2026-001",
        approvalChain: [{ role: "대표이사", name: "황룡", signed: true, date: "2026-04-28" }],
        workPeriod: "2026-01-01 ~ 2026-12-31",
        emergencyContacts: { fire: "119", labor: "1350", hospital: "1339", owner: "010-1234-5678" },
      },
      scale: { workforce: 250, constructionValue: 500, industry: "construction" },
    },
    expectedHazards: [],
    expectedSections: ["방침", "목표", "예산"],
  },
  {
    id: "S5_중대재해_즉시보고",
    desc: "추락 사망사고 즉시보고 (산안법 §54)",
    category: "accident",
    input: {
      docId: "severe_accident_immediate_report",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "박감독" },
        documentId: "SEV-20260428-001",
        approvalChain: [{ role: "현장소장", name: "박감독", signed: true, date: "2026-04-28" }],
        workPeriod: "발생: 2026-04-28 14:30",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
      },
      scale: { workforce: 50, constructionValue: 80, industry: "construction" },
    },
    expectedHazards: [],
    expectedSections: ["발생", "재해자", "조치"],
  },
];

interface Score {
  total: number;
  max: number;
  percent: number;
  breakdown: Record<string, { score: number; max: number; note: string }>;
}

// 카테고리별 가중치 (0이면 평가 제외)
const WEIGHTS: Record<DocCategory, Record<string, number>> = {
  workPlan:    { legalBasis: 10, koshaGuide: 10, hazards: 10, ericPP: 10, sections: 10, approval: 10, concrete: 10, hallucination: 10, length: 5, graphContext: 10, ericPrecision: 5 },
  workPermit:  { legalBasis: 10, koshaGuide: 10, hazards: 10, ericPP: 10, sections: 10, approval: 10, concrete: 10, hallucination: 10, length: 5, graphContext: 10, ericPrecision: 5 },
  inspection:  { legalBasis: 10, koshaGuide: 10, hazards: 10, ericPP: 5,  sections: 10, approval: 10, concrete: 5,  hallucination: 10, length: 5, graphContext: 10, ericPrecision: 5 },
  // 행정 문서: KOSHA·ERIC 가중치 낮춤, 결재·법령·양식 가중치 높임
  admin:       { legalBasis: 15, koshaGuide: 5,  hazards: 0,  ericPP: 0,  sections: 15, approval: 15, concrete: 5,  hallucination: 10, length: 5, graphContext: 10, ericPrecision: 0 },
  // 사고 보고서: 적시성·필수항목 중심, KOSHA·ERIC 제외
  accident:    { legalBasis: 15, koshaGuide: 0,  hazards: 0,  ericPP: 0,  sections: 20, approval: 15, concrete: 10, hallucination: 15, length: 10, graphContext: 10, ericPrecision: 0 },
};

function evaluateDocument(text: string, sc: Record<string, any>, scenario: Scenario): Score {
  const breakdown: Record<string, { score: number; max: number; note: string }> = {};
  const w = WEIGHTS[scenario.category];

  // 1. 법적 근거
  const legalBasisCount = (sc.legalBasisCount as number | undefined) ?? 0;
  const hasLawExtract = text.includes("```\n①") || text.includes("```\n사업주") || text.includes("```\n- ") || text.includes("법령 근거");
  const lbScore = legalBasisCount >= 1 && hasLawExtract ? w.legalBasis : Math.floor(w.legalBasis * 0.5);
  breakdown.legalBasis = { score: lbScore, max: w.legalBasis, note: `legalBasis ${legalBasisCount}, 본문 발췌 ${hasLawExtract ? "✓" : "✗"}` };

  // 2. KOSHA 가이드
  const koshaCount = (sc.koshaGuideCount as number | undefined) ?? 0;
  let kgScore = w.koshaGuide;
  if (w.koshaGuide > 0) {
    kgScore = Math.min(w.koshaGuide, koshaCount > 0 ? Math.ceil(koshaCount / 2) : 0);
    if (scenario.expectedKoshaPattern && !text.match(scenario.expectedKoshaPattern)) kgScore = Math.floor(kgScore * 0.5);
  }
  breakdown.koshaGuide = { score: kgScore, max: w.koshaGuide, note: w.koshaGuide === 0 ? "N/A (가중치 0)" : `KOSHA ${koshaCount}개` };

  // 3. 위험요소
  let hScore = w.hazards;
  if (w.hazards > 0) {
    if (scenario.expectedHazards.length > 0) {
      const matched = scenario.expectedHazards.filter((h) => text.includes(h)).length;
      hScore = Math.floor(w.hazards * matched / scenario.expectedHazards.length);
    } else {
      hScore = w.hazards;
    }
  }
  breakdown.hazards = { score: hScore, max: w.hazards, note: w.hazards === 0 ? "N/A" : `기대 ${scenario.expectedHazards.length}개 매칭` };

  // 4. ERIC-PP 위계 (위계 5단계 모두 등장)
  let ericScore = w.ericPP;
  if (w.ericPP > 0) {
    let tierFound = 0;
    for (const tier of ["제거", "대체", "공학적", "관리적", "보호구"]) if (text.includes(tier)) tierFound += 1;
    ericScore = Math.floor(w.ericPP * tierFound / 5);
  }
  breakdown.ericPP = { score: ericScore, max: w.ericPP, note: w.ericPP === 0 ? "N/A" : "위계 등장 평가" };

  // 5. ERIC-PP 정밀도 (P4) — 직접 매핑 표시 여부
  let epScore = w.ericPrecision;
  if (w.ericPrecision > 0) {
    const directCount = (text.match(/\| 직접 \|/g) ?? []).length;
    const indirectCount = (text.match(/\| — \|/g) ?? []).length;
    const totalShown = directCount + indirectCount;
    if (totalShown <= 15 && directCount > 0) epScore = w.ericPrecision;
    else if (totalShown <= 15) epScore = Math.floor(w.ericPrecision * 0.7);
    else epScore = Math.floor(w.ericPrecision * 0.5);
  }
  breakdown.ericPrecision = { score: epScore, max: w.ericPrecision, note: w.ericPrecision === 0 ? "N/A" : "위험 직접매핑 cap 15" };

  // 6. 양식·섹션
  let secScore = w.sections;
  if (w.sections > 0 && scenario.expectedSections.length > 0) {
    const matched = scenario.expectedSections.filter((s) => text.includes(s)).length;
    secScore = Math.floor(w.sections * (0.5 + 0.5 * matched / scenario.expectedSections.length));
  }
  breakdown.sections = { score: secScore, max: w.sections, note: `기대 ${scenario.expectedSections.length}개 매칭` };

  // 7. 결재·비상연락
  const hasApproval = text.includes("결재선") || text.includes("결재");
  const hasEmergency = text.includes("비상연락망") || text.includes("비상연락");
  breakdown.approval = {
    score: (hasApproval ? Math.floor(w.approval / 2) : 0) + (hasEmergency ? Math.ceil(w.approval / 2) : 0),
    max: w.approval,
    note: `결재 ${hasApproval ? "✓" : "✗"} / 비상 ${hasEmergency ? "✓" : "✗"}`,
  };

  // 8. 구체성
  const concreteCount =
    (text.match(/\d+m/g)?.length ?? 0) + (text.match(/\d+:\d+/g)?.length ?? 0) +
    (text.match(/\d+년/g)?.length ?? 0) + (text.match(/\d+%/g)?.length ?? 0) +
    (text.match(/\d+kV/g)?.length ?? 0) + (text.match(/\d+ppm/g)?.length ?? 0);
  breakdown.concrete = { score: Math.min(w.concrete, concreteCount), max: w.concrete, note: `구체 수치 ${concreteCount}개` };

  // 9. 환각
  const HALLUCINATION = ["lorem", "임의값", "TODO", "FIXME", "예시 데이터", "가짜", "본 OSS 7 법령 번들에 본문 미수록"];
  let hallCount = 0;
  for (const h of HALLUCINATION) if (text.toLowerCase().includes(h.toLowerCase())) hallCount += 1;
  breakdown.hallucination = { score: Math.max(0, w.hallucination - hallCount * 5), max: w.hallucination, note: hallCount === 0 ? "없음" : `${hallCount}개` };

  // 10. 길이
  const len = text.length;
  let lenScore = 0;
  if (scenario.category === "accident") {
    lenScore = len >= 800 ? w.length : Math.floor(w.length * len / 800);
  } else {
    lenScore = len < 500 ? 0 : len < 1500 ? Math.floor(w.length * 0.5) : len < 8000 ? w.length : Math.floor(w.length * 0.8);
  }
  breakdown.length = { score: lenScore, max: w.length, note: `${len} chars` };

  // 11. graphContext (P1 검증)
  const gc = sc.graphContext;
  let gcScore = 0;
  if (gc) {
    const fields = ["documentNode", "legalBasis", "appliesToActivities", "relatedHazards", "relatedControls", "relatedKoshaGuides", "sources"];
    const presentFields = fields.filter((f) => gc[f] !== undefined && (Array.isArray(gc[f]) ? gc[f].length > 0 : !!gc[f])).length;
    gcScore = Math.floor(w.graphContext * presentFields / fields.length);
  }
  breakdown.graphContext = { score: gcScore, max: w.graphContext, note: gc ? `${Object.keys(gc).length} fields` : "missing" };

  const total = Object.values(breakdown).reduce((s, b) => s + b.score, 0);
  const maxTotal = Object.values(breakdown).reduce((s, b) => s + b.max, 0);
  return { total, max: maxTotal, percent: Math.round(100 * total / maxTotal), breakdown };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const allScores: Array<{ id: string; desc: string; category: DocCategory; score: Score; bodyLength: number }> = [];

  for (const sc of SCENARIOS) {
    const r: any = await generateSafetyDocumentTool.handler(sc.input);
    const text = r.content?.[0]?.text ?? "";
    const struct = r.structuredContent ?? {};
    if (r.isError) { console.log(`❌ ${sc.id}: error`); continue; }

    const score = evaluateDocument(text, struct, sc);
    allScores.push({ id: sc.id, desc: sc.desc, category: sc.category, score, bodyLength: text.length });
    await writeFile(resolve(OUT_DIR, `${sc.id}.md`), text, "utf-8");
    await writeFile(resolve(OUT_DIR, `${sc.id}.meta.json`), JSON.stringify(struct, null, 2), "utf-8");

    console.log(`\n${"━".repeat(70)}`);
    console.log(`▶ ${sc.id} [${sc.category}] — ${sc.desc}`);
    console.log("━".repeat(70));
    console.log(`총점: ${score.total}/${score.max} = ${score.percent}%`);
    for (const [k, b] of Object.entries(score.breakdown)) {
      if (b.max === 0) continue;
      console.log(`  ${k.padEnd(15)} ${b.score}/${b.max}  — ${b.note}`);
    }
  }

  // 종합
  console.log(`\n${"═".repeat(70)}`);
  console.log("종합 평가 (v2 — 카테고리별 가중치)");
  console.log("═".repeat(70));
  console.log(`| 시나리오 | 카테고리 | 점수 | % |`);
  console.log(`|---|---|---|---|`);
  for (const r of allScores) {
    console.log(`| ${r.id} | ${r.category} | ${r.score.total}/${r.score.max} | ${r.score.percent}% |`);
  }
  const avgPct = allScores.reduce((s, r) => s + r.score.percent, 0) / allScores.length;
  console.log(`\n평균 점수: ${avgPct.toFixed(1)}%`);

  // P1 검증: graphContext 평균
  const gcAvg = allScores.reduce((s, r) => s + r.score.breakdown.graphContext.score, 0) / allScores.length;
  const gcMax = allScores.reduce((s, r) => s + r.score.breakdown.graphContext.max, 0) / allScores.length;
  console.log(`\nP1 graphContext: ${gcAvg.toFixed(1)}/${gcMax.toFixed(1)} (이전: 5.0/10)`);

  // P4 검증: ERIC 정밀도 (workPlan/workPermit/inspection만)
  const epScores = allScores.filter((r) => r.score.breakdown.ericPrecision.max > 0);
  if (epScores.length > 0) {
    const epAvg = epScores.reduce((s, r) => s + r.score.breakdown.ericPrecision.score, 0) / epScores.length;
    const epMax = epScores[0].score.breakdown.ericPrecision.max;
    console.log(`P4 ericPrecision: ${epAvg.toFixed(1)}/${epMax} (신규 항목)`);
  }
}

main().catch(console.error);
