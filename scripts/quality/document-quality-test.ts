#!/usr/bin/env tsx
/**
 * document-quality-test.ts
 *
 * 5종 현실 시나리오로 의무문서 작성 테스트 + 객관적 품질 평가.
 *
 * 평가 기준 (각 0~10점):
 *   1. 법적 근거 인용 정확성 (legalBasis 본문 발췌)
 *   2. KOSHA 가이드 활용도 (guidedBy)
 *   3. 위험요소 식별 완전성 (hasHazard)
 *   4. 통제대책 ERIC-PP 위계 적용
 *   5. 양식 일관성 (sections·fields 충실)
 *   6. 결재선·비상연락망 (필수 섹션)
 *   7. 실무 적합성 (구체성·실행 가능성)
 *   8. 환각 의심 (hallucination 키워드)
 *   9. 길이 적정성 (너무 짧지 않은지)
 *  10. 그래프 컨텍스트 활용 (structuredContent 메타)
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUT_DIR = resolve(ROOT, "artifacts", "test-results", "core");

// ADR 006 — over-dump(근거 없는 위험 과다 제시 = 환각) 페널티 파라미터.
// 기대 위험의 OVERDUMP_RATIO 배 또는 (기대 + OVERDUMP_MARGIN) 중 큰 값까지는 무페널티,
// 그 초과분 1건당 OVERDUMP_PENALTY_PER 점 감점(최대 OVERDUMP_PENALTY_CAP).
const OVERDUMP_RATIO = 2; // 기대 위험 대비 2배까지 허용
const OVERDUMP_MARGIN = 10; // 또는 기대 + 10건까지 허용 (기대가 적은 문서 보호)
const OVERDUMP_PENALTY_PER = 0.5; // 초과 위험 1건당 0.5점 감점
const OVERDUMP_PENALTY_CAP = 8; // 페널티 상한 (최소 2점은 잔존)
// KOSHA 가이드 개수 점수 상한 — 의미 매칭(5점)과 동등 비중. 과다 매핑이 점수를 더 올리지 못하게 포화.
const KOSHA_COUNT_SCORE_CAP = 5;

interface Scenario {
  id: string;
  desc: string;
  input: any;
  expectedHazards: string[];      // 기대되는 위험요소
  expectedKoshaPattern?: RegExp;  // KOSHA 가이드 매칭 패턴
  expectedSections: string[];     // 필수 섹션 키워드
}

const SCENARIOS: Scenario[] = [
  {
    id: "S1_굴착_5m_매설물",
    desc: "황룡건설 굴착 5m + 도시가스 매설관 인접",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "홍길동 (건설안전기사)" },
        documentId: "WP-EX-20260428-001",
        approvalChain: [
          { role: "사업주", name: "황룡 (이사)", signed: true, date: "2026-04-28" },
          { role: "관리감독자", name: "박감독 (현장소장)", signed: true, date: "2026-04-28" },
          { role: "근로자대표", name: "이근로 (반장)", signed: true, date: "2026-04-28" },
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
    expectedHazards: ["감전", "정전", "활선", "잠금", "표지"],
    expectedKoshaPattern: /정전|LOTO|잠금|차단|충전전로/,
    expectedSections: ["차단", "검전", "잠금", "접지"],
  },
  {
    id: "S3_타워크레인_작업계획서",
    desc: "타워크레인 설치·해체",
    input: {
      docId: "work_plan_tower_crane",
      draft: {
        metadata: { siteName: "황룡건설 서울 강남 빌딩현장", planDate: "2026-04-28", supervisor: "김타워 (양중기 자격)" },
        documentId: "WP-TC-20260428-003",
        approvalChain: [{ role: "현장소장", name: "박감독", signed: true, date: "2026-04-28" }],
        workPeriod: "2026-05-01 ~ 2026-05-03",
        emergencyContacts: { fire: "119", labor: "02-1234-5678", hospital: "강남병원", owner: "010-1234-5678" },
      },
      scale: { workforce: 6, constructionValue: 30, industry: "construction" },
    },
    expectedHazards: ["낙하", "전도", "추락", "감전"],
    expectedKoshaPattern: /타워크레인|크레인|양중|지지/,
    expectedSections: ["풍속", "지반", "조립", "지지"],
  },
  {
    id: "S4_경영방침_CEO",
    desc: "안전보건경영방침 (중처법 §4)",
    input: {
      docId: "safety_health_management_policy",
      draft: {
        metadata: { siteName: "황룡건설(주) 본사", planDate: "2026-04-28", supervisor: "황룡 (이사)" },
        documentId: "POL-2026-001",
        approvalChain: [{ role: "대표이사", name: "황룡", signed: true, date: "2026-04-28" }],
        workPeriod: "2026-01-01 ~ 2026-12-31",
        emergencyContacts: { fire: "119", labor: "1350", hospital: "1339", owner: "010-1234-5678" },
      },
      scale: { workforce: 250, constructionValue: 500, industry: "construction" },
    },
    expectedHazards: [],
    expectedSections: ["방침", "목표", "예산", "조직"],
  },
  {
    id: "S5_중대재해_즉시보고",
    desc: "추락 사망사고 즉시보고 (산안법 §54)",
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
    expectedHazards: ["추락", "사망"],
    expectedSections: ["발생일시", "재해자", "재해개요", "조치"],
  },
];

interface Score {
  total: number;
  breakdown: Record<string, { score: number; max: number; note: string }>;
}

function evaluateDocument(text: string, sc: Record<string, any>, scenario: Scenario): Score {
  const breakdown: Record<string, { score: number; max: number; note: string }> = {};

  // 1. 법적 근거 인용 (max 10)
  const legalBasisCount = (sc.legalBasisCount as number | undefined) ?? 0;
  const hasLawExtract = text.includes("```\n①") || text.includes("```\n사업주") || text.includes("```\n- ") || text.includes("법령 근거");
  breakdown.legalBasis = {
    score: Math.min(10, legalBasisCount * 2 + (hasLawExtract ? 3 : 0)),
    max: 10,
    note: `legalBasis ${legalBasisCount}개, 본문 발췌 ${hasLawExtract ? "있음" : "없음"}`,
  };

  // 2. KOSHA 가이드 활용 (max 10) — ADR 006: 순수 개수가 아닌 *관련성* 반영.
  //   개수 기여를 KOSHA_COUNT_SCORE_CAP 으로 제한해 "많을수록 고득점" 인센티브(over-dump 유발)를 제거.
  //   의미 매칭(expectedKoshaPattern)이 동등 비중을 갖도록 가중.
  const koshaCount = (sc.koshaGuideCount as number | undefined) ?? 0;
  let koshaPatternScore = 0;
  if (scenario.expectedKoshaPattern) {
    const m = text.match(scenario.expectedKoshaPattern);
    koshaPatternScore = m ? 5 : 0;
  } else {
    koshaPatternScore = 5;
  }
  // 개수 점수: 1건 이상이면 점진 가점하되 상한(KOSHA_COUNT_SCORE_CAP)에서 포화 — 과다 매핑 무가점.
  const koshaCountScore = Math.min(KOSHA_COUNT_SCORE_CAP, Math.floor(koshaCount / 2));
  breakdown.koshaGuide = {
    score: Math.min(10, koshaCountScore + koshaPatternScore),
    max: 10,
    note: `KOSHA ${koshaCount}개 매핑(개수점 ${koshaCountScore}/${KOSHA_COUNT_SCORE_CAP}), 의미 매칭 ${koshaPatternScore}/5`,
  };

  // 3. 위험요소 완전성 + over-dump 페널티 (max 10) — ADR 006
  //   올바름 > 양: 기대 위험을 빠짐없이 포함하되, 근거 없는 위험을 과다 제시(over-dump)하면 감점.
  //   단 화이트리스트(hasHazard 그래프 직접 매핑) 위험은 근거가 명확하므로 개수로 감점하지 않는다.
  //   over-dump 환각의 실거주지는 guide_fallback(가이드 causedBy 무차별 확장)이다.
  const hazardCount = (sc.hazardCount as number | undefined) ?? 0;
  const hazardSource = (sc.hazardSource as string | undefined) ?? "unknown";
  let hazardMatchCount = 0;
  for (const h of scenario.expectedHazards) {
    if (text.includes(h)) hazardMatchCount += 1;
  }
  // over-dump 허용 한계: 기대 위험의 2배 또는 (기대 + OVERDUMP_MARGIN) 중 큰 값까지는 무페널티.
  const overdumpLimit = Math.max(scenario.expectedHazards.length * OVERDUMP_RATIO, scenario.expectedHazards.length + OVERDUMP_MARGIN);
  // 화이트리스트·억제 문서는 over-dump 페널티 면제(근거 명확). guide_fallback 만 초과분 감점.
  const overdumpPenaltyApplies = hazardSource === "guide_fallback" || hazardSource === "unknown";
  const overdumpExcess = overdumpPenaltyApplies ? Math.max(0, hazardCount - overdumpLimit) : 0;
  // 초과 위험 1건당 OVERDUMP_PENALTY_PER 점 감점 (최대 OVERDUMP_PENALTY_CAP).
  const overdumpPenalty = Math.min(OVERDUMP_PENALTY_CAP, Math.ceil(overdumpExcess * OVERDUMP_PENALTY_PER));

  let hazardBase: number;
  if (scenario.expectedHazards.length > 0) {
    // 작업문서: 기대 위험 포함률 (정상 = 만점)
    hazardBase = Math.min(10, Math.floor(10 * hazardMatchCount / scenario.expectedHazards.length));
  } else {
    // 행정문서: 위험요인 미해당이 정답(ADR 006). 억제/0건 = 만점, 폴백 과다 = 환각 감점.
    hazardBase = hazardSource === "suppressed_administrative" || hazardCount === 0 ? 10 : 8;
  }
  const hazardScore = Math.max(0, hazardBase - overdumpPenalty);
  breakdown.hazards = {
    score: hazardScore,
    max: 10,
    note: scenario.expectedHazards.length > 0
      ? `기대 ${scenario.expectedHazards.length}개 중 ${hazardMatchCount}개 매칭, 매핑 ${hazardCount}(${hazardSource})` +
        (overdumpPenalty > 0 ? `, over-dump -${overdumpPenalty}(한계 ${overdumpLimit}↑ 초과 ${overdumpExcess})` : "")
      : `행정문서 위험매핑 ${hazardCount}(${hazardSource})` +
        (overdumpPenalty > 0 ? `, over-dump -${overdumpPenalty}` : hazardCount === 0 ? ", 위험요인 미해당(정상)" : ""),
  };

  // 4. ERIC-PP 위계 (max 10)
  let ericScore = 0;
  for (const tier of ["제거", "대체", "공학적", "관리적", "보호구", "Eliminate", "Substitute", "Engineering", "Administrative", "PPE"]) {
    if (text.includes(tier)) ericScore += 1;
  }
  breakdown.eric = {
    score: Math.min(10, ericScore),
    max: 10,
    note: `ERIC-PP 키워드 ${ericScore}개 등장`,
  };

  // 5. 양식 일관성 (max 10)
  const sectionsCount = (sc.sectionsCount as number | undefined) ?? 0;
  let sectionMatchCount = 0;
  for (const s of scenario.expectedSections) {
    if (text.includes(s)) sectionMatchCount += 1;
  }
  breakdown.sections = {
    score: scenario.expectedSections.length > 0
      ? Math.min(10, Math.floor(5 + 5 * sectionMatchCount / scenario.expectedSections.length))
      : (sectionsCount > 0 ? 8 : 5),
    max: 10,
    note: `기대 ${scenario.expectedSections.length}개 중 ${sectionMatchCount}개 등장, sections 메타 ${sectionsCount}`,
  };

  // 6. 결재선·비상연락망 (max 10)
  const hasApproval = text.includes("결재선") || text.includes("결재");
  const hasEmergency = text.includes("비상연락망") || text.includes("비상연락");
  breakdown.approval = {
    score: (hasApproval ? 5 : 0) + (hasEmergency ? 5 : 0),
    max: 10,
    note: `결재선 ${hasApproval ? "✓" : "✗"} / 비상연락 ${hasEmergency ? "✓" : "✗"}`,
  };

  // 7. 실무 적합성 (max 10) — 구체적 수치·일자·이름 포함
  const concreteCount =
    (text.match(/\d+m/g)?.length ?? 0) +
    (text.match(/\d+:\d+/g)?.length ?? 0) +
    (text.match(/\d+년/g)?.length ?? 0) +
    (text.match(/\d+%/g)?.length ?? 0);
  breakdown.concrete = {
    score: Math.min(10, concreteCount),
    max: 10,
    note: `구체 수치 ${concreteCount}개`,
  };

  // 8. 환각 의심 (max 10, 환각 발견 시 감점)
  const HALLUCINATION_GENERIC = ["lorem ipsum", "TODO", "FIXME", "임의", "예시 데이터", "가짜"];
  let hallCount = 0;
  for (const h of HALLUCINATION_GENERIC) {
    if (text.toLowerCase().includes(h.toLowerCase())) hallCount += 1;
  }
  breakdown.hallucination = {
    score: Math.max(0, 10 - hallCount * 5),
    max: 10,
    note: hallCount === 0 ? "없음" : `환각 의심 ${hallCount}개`,
  };

  // 9. 길이 적정성 (max 10)
  const len = text.length;
  let lenScore = 0;
  if (len < 500) lenScore = 0;
  else if (len < 1500) lenScore = 5;
  else if (len < 8000) lenScore = 10;
  else lenScore = 8;  // 너무 길면 약간 감점
  breakdown.length = { score: lenScore, max: 10, note: `${len} chars` };

  // 10. 그래프 컨텍스트 (max 10)
  const hasMeta = !!sc && Object.keys(sc).length >= 5;
  const hasGraphCtx = !!sc.graphContext || !!sc.legalBasis || !!sc.koshaGuides;
  breakdown.graphContext = {
    score: (hasMeta ? 5 : 0) + (hasGraphCtx ? 5 : 0),
    max: 10,
    note: `meta ${hasMeta ? "✓" : "✗"}, graphContext ${hasGraphCtx ? "✓" : "✗"}`,
  };

  const total = Object.values(breakdown).reduce((sum, b) => sum + b.score, 0);
  return { total, breakdown };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const allScores: Array<{ id: string; desc: string; score: Score; bodyLength: number; bodyExcerpt: string }> = [];

  for (const sc of SCENARIOS) {
    console.log(`\n${"━".repeat(70)}`);
    console.log(`▶ ${sc.id} — ${sc.desc}`);
    console.log("━".repeat(70));

    const r: any = await generateSafetyDocumentTool.handler(sc.input);
    const text = r.content?.[0]?.text ?? "";
    const struct = r.structuredContent ?? {};

    if (r.isError) {
      console.log("❌ ERROR:", text.slice(0, 200));
      continue;
    }

    const score = evaluateDocument(text, struct, sc);
    allScores.push({
      id: sc.id,
      desc: sc.desc,
      score,
      bodyLength: text.length,
      bodyExcerpt: text.slice(0, 600),
    });

    // 파일 저장
    await writeFile(resolve(OUT_DIR, `${sc.id}.md`), text, "utf-8");
    await writeFile(resolve(OUT_DIR, `${sc.id}.meta.json`), JSON.stringify(struct, null, 2), "utf-8");

    console.log(`총점: ${score.total}/100`);
    console.log("세부 점수:");
    for (const [key, b] of Object.entries(score.breakdown)) {
      console.log(`  ${key.padEnd(15)} ${b.score}/${b.max}  — ${b.note}`);
    }
    console.log(`길이: ${text.length} chars`);
  }

  // 종합
  console.log(`\n\n${"═".repeat(70)}`);
  console.log("종합 평가");
  console.log("═".repeat(70));
  console.log(`| 시나리오 | 총점 | 길이 |`);
  console.log(`|---------|-----|------|`);
  for (const r of allScores) {
    console.log(`| ${r.id} | ${r.score.total}/100 | ${r.bodyLength} |`);
  }
  const avg = allScores.reduce((sum, r) => sum + r.score.total, 0) / allScores.length;
  console.log(`\n평균 총점: ${avg.toFixed(1)}/100`);

  // 항목별 평균
  console.log("\n항목별 평균:");
  const keys = Object.keys(allScores[0].score.breakdown);
  for (const k of keys) {
    const avg = allScores.reduce((sum, r) => sum + r.score.breakdown[k].score, 0) / allScores.length;
    console.log(`  ${k.padEnd(15)} ${avg.toFixed(1)}/10`);
  }

  console.log(`\n전체 결과 저장: artifacts/test-results/core/`);
}

main().catch(console.error);
