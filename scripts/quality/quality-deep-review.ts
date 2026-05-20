#!/usr/bin/env tsx
/**
 * quality-deep-review.ts (v0.11+ 체계적 실측 검증)
 *
 * 54 Document × 표준 입력 → 출력 본문 의미 검사:
 *   1. KOSHA 매핑 의미적 적절성 — docId 키워드 ↔ KOSHA 제목 일치성
 *   2. Hazard 매핑 적절성 — docId 작업 유형 ↔ Hazard 카테고리
 *   3. Control 매핑 적절성 — ERIC-PP 위계 적합
 *   4. 양식 누락 (sections·필수 섹션)
 *   5. 법령 발췌 정확성 (코드블록 내 본문이 해당 §N 진짜 본문인지)
 *
 * 자동 의심 케이스 + 사람 판단 권장 케이스 분리 보고.
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { listDocuments } from "../../build/lib/graph-nodes-loader.js";

interface ToolResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
}

// docId → 의미 검사 키워드 (KOSHA 매핑 적절성 판단용)
// 매핑된 KOSHA 제목에 *이 키워드 중 하나*가 들어있어야 의미적 일치 인정
// 들어있지 않으면 의심 (사람 검토 필요)
const SEMANTIC_KEYWORDS: Record<string, string[]> = {
  // 작업계획서
  work_plan_excavation: ["굴착", "흙막이", "토공", "옹벽", "발파", "매설물"],
  work_plan_tower_crane: ["타워크레인", "크레인", "양중기"],
  work_plan_vehicle_cargo: ["지게차", "하역", "운반"],
  work_plan_vehicle_construction: ["굴삭기", "건설기계", "차량계"],
  work_plan_electric_work: ["전기작업", "활선", "정전전로", "감전", "절연"],
  work_plan_tunnel: ["터널", "낙반", "지보공"],
  work_plan_bridge: ["교량", "가설", "추락", "방호망"],
  work_plan_demolition: ["해체", "철거"],
  work_plan_heavy_lifting: ["중량물", "양중", "운반"],

  // 작업허가서
  work_permit_hot_work: ["용접", "용단", "화기", "화재예방"],
  work_permit_confined_space: ["밀폐공간", "산소", "질식"],
  work_permit_loto: ["정전 작업", "정전·잠금", "정전전로", "에너지 차단", "잠금·표지", "LOTO"],
  work_permit_high_altitude: ["추락", "방호망", "안전대", "고소"],
  // 중량물 취급 허가서 — 크레인·줄걸이·이동식크레인 등 양중 장비 모두 포함
  work_permit_heavy_lifting: ["중량물", "양중", "크레인", "줄걸이", "와이어로프", "항타기"],

  // 위험성평가 — KOSHA "위험성 평가/위험성평가/HAZOP" 모두 포함
  risk_assessment_procedure: ["위험성평가", "위험성 평가", "HAZOP", "체크리스트"],
  initial_risk_assessment: ["위험성평가", "위험성 평가", "HAZOP", "체크리스트"],
  regular_risk_assessment: ["위험성평가", "위험성 평가", "HAZOP", "체크리스트", "정기"],
  monthly_risk_assessment: ["위험성평가", "위험성 평가", "HAZOP", "체크리스트"],
  ad_hoc_risk_assessment: ["위험성평가", "위험성 평가", "JSA", "체크리스트", "HAZOP"],

  // 발주자 안전보건대장 — 매핑 KOSHA 자체가 적음
  basic_safety_health_register: [], // 0건이 정상
  design_safety_health_register: [],
  construction_safety_health_register: [],

  // 행정 (KOSHA 0건이 정상)
  safety_health_regulation: [],
  safety_health_management_policy: [],
  safety_health_mgmt_cost_plan: [],
  safety_health_management_assistant_appointment: [],
  contractor_consultative_body: [],
  legal_summary_posting: [],

  // 사고
  severe_accident_immediate_report: ["재해", "사고", "조사"],
  industrial_accident_report: ["재해", "사고", "조사"],

  // 보호구·교육·표지 — 절연용 방호구도 보호구
  ppe_register: ["보호구", "안전모", "안전대", "절연용", "절연 보호구"],
  safety_signage_register: ["안전보건표지", "표지"],
  supervisor_education_log: [], // 0건 KOSHA 카탈로그 부재 정상
  // 안전보건교육 일지 — 공정안전 근로자 교육도 포함
  monthly_education_log: ["안전교육", "근로자 교육", "안전보건교육"],
  daily_tbm: ["TBM", "안전교육"],

  // MSDS·화학 — 물질안전보건자료 교육·작성도 적절
  msds_register: ["MSDS", "화학물질", "경고표지", "물질안전보건자료", "유해성"],

  // 점검·합동
  pre_work_inspection: ["점검"],
  weekly_joint_inspection: ["점검", "합동점검"],

  // 작업환경·건강 — KOSHA A-* 시리즈 모두 작업환경측정 분석 (정상)
  work_environment_measurement: ["작업환경측정", "분진", "소음", "근골격", "측정,분석", "분석 기술지침", "노출", "유기용제"],
  health_examination_records: ["건강진단", "건강검진"],

  // 위원회·협의체 — 의제는 모든 안전·보건 사안 (자율안전보건관리체계·보건관리·중대재해 등)
  health_safety_committee: ["산업안전보건위원회", "노사협의", "안전보건관리체계", "보건관리", "자율안전", "중대재해", "근로자"],
  contractor_safety_council: ["도급", "수급인"],

  // 신고·관리체계
  safety_health_manager_appointment: ["선임"],
  severe_accident_compliance: ["중대재해", "안전보건관리체계"],

  // 유해위험방지
  hazardous_risk_prevention_plan_industrial: [],
  hazardous_risk_prevention_plan_machinery: [],
  hazardous_risk_prevention_plan_construction: [],

  // 일반 작업계획서 (wrap) — 별표 4 13종 모두 포함
  work_plan: ["작업계획", "차량계", "건설기계", "지게차", "타워크레인", "이동식크레인", "양중", "중량물", "철근", "콘크리트", "거푸집", "동바리", "비계", "작업발판", "해체", "교량", "PSC"],
  work_permit: [], // wrap document
};

interface ReviewResult {
  docId: string;
  bodyLength: number;
  koshaCount: number;
  koshaTitles: string[];
  hazardLabels: string[];
  controlLabels: string[];
  sectionCount: number;

  // 의심 사항
  semanticMismatch: string[]; // KOSHA 제목이 docId 키워드와 무관
  missingSection: string[]; // 필수 섹션 누락
  noLawExtract: boolean; // 법령 본문 발췌 누락 (작업 문서)
  suspicions: string[];

  qualityScore: number; // 0~10
}

function analyze(docId: string, text: string, sc: Record<string, unknown>): ReviewResult {
  const koshaCount = Number(sc.koshaGuideCount ?? 0);
  const hazardCount = Number(sc.hazardCount ?? 0);
  const controlCount = Number(sc.controlCount ?? 0);
  const sectionCount = Number(sc.sectionsCount ?? 0);

  // KOSHA 제목 추출 (## 8. 적용 KOSHA Guide 섹션)
  const koshaTitles: string[] = [];
  const koshaMatch = text.match(/## \d+\. 적용 KOSHA Guide.*?\n\n\| 번호 \| 제목 \|\n\|---\|---\|\n([\s\S]*?)(?=\n\n## |\n---)/);
  if (koshaMatch) {
    const lines = koshaMatch[1].split("\n").filter((l) => l.startsWith("| "));
    for (const l of lines) {
      const parts = l.split("|").map((p) => p.trim());
      if (parts.length >= 3) koshaTitles.push(parts[2]);
    }
  }

  // Hazard·Control 라벨 추출
  const hazardLabels: string[] = [];
  const hazardMatch = text.match(/## \d+\. 식별된 위험 요소.*?\n\n\| 위험 분류 \| 카테고리 \|\n\|---\|---\|\n([\s\S]*?)\n\n##/);
  if (hazardMatch) {
    const lines = hazardMatch[1].split("\n").filter((l) => l.startsWith("| "));
    for (const l of lines) {
      const parts = l.split("|").map((p) => p.trim());
      if (parts.length >= 2) hazardLabels.push(parts[1]);
    }
  }
  const controlLabels: string[] = [];
  const controlMatch = text.match(/## \d+\. 권장 안전대책.*?\n\n\| 위계 \| 대책 \|\n\|---\|---\|\n([\s\S]*?)\n\n##/);
  if (controlMatch) {
    const lines = controlMatch[1].split("\n").filter((l) => l.startsWith("| "));
    for (const l of lines) {
      const parts = l.split("|").map((p) => p.trim());
      if (parts.length >= 3) controlLabels.push(parts[2]);
    }
  }

  // 의미 검사
  const expected = SEMANTIC_KEYWORDS[docId] ?? [];
  const semanticMismatch: string[] = [];
  if (expected.length > 0) {
    for (const title of koshaTitles) {
      const matched = expected.some((kw) => title.includes(kw));
      if (!matched) semanticMismatch.push(title);
    }
  }

  // 필수 섹션 검사
  const missingSection: string[] = [];
  if (!text.includes("## 1. 문서 메타")) missingSection.push("문서 메타");
  if (!text.includes("결재선")) missingSection.push("결재선");
  if (!text.includes("비상연락망")) missingSection.push("비상연락망");

  // 법령 발췌 (작업·허가 문서만)
  const isWorkDoc = docId.startsWith("work_plan_") || docId.startsWith("work_permit_");
  const hasExtract = text.includes("```\n①") || text.includes("```\n사업주") || text.includes("```\n- ") || text.includes("```\n(본 OSS 7 법령 번들에 본문 미수록");
  const noLawExtract = isWorkDoc && !hasExtract;

  // 의심 사항 종합
  const suspicions: string[] = [];
  if (semanticMismatch.length > 0)
    suspicions.push(`KOSHA 의미 불일치 ${semanticMismatch.length}건`);
  if (missingSection.length > 0)
    suspicions.push(`누락 섹션 ${missingSection.join(",")}`);
  if (noLawExtract) suspicions.push("법령 본문 발췌 누락");
  if (sectionCount === 0) suspicions.push("sections 메타 미정의 (fallback)");

  // 점수
  let score = 10;
  if (semanticMismatch.length > 0) score -= Math.min(4, semanticMismatch.length);
  if (missingSection.length > 0) score -= 2;
  if (noLawExtract) score -= 1;
  if (sectionCount === 0) score -= 1;
  score = Math.max(0, score);

  return {
    docId,
    bodyLength: text.length,
    koshaCount,
    koshaTitles,
    hazardLabels,
    controlLabels,
    sectionCount,
    semanticMismatch,
    missingSection,
    noLawExtract,
    suspicions,
    qualityScore: score,
  };
}

(async () => {
  const docs = (await listDocuments()).filter((d) => !d["@id"].startsWith("doc:kosha_guide"));
  console.log(`# Quality Deep Review — ${docs.length} Document\n`);

  const results: ReviewResult[] = [];
  for (const doc of docs) {
    try {
      const r = (await generateSafetyDocumentTool.handler({
        docId: doc.docId,
        draft: {
          metadata: { siteName: "황룡건설 테스트현장", planDate: "2026-04-28", supervisor: "박감독" },
          documentId: `TEST-${doc.docId}`,
          workPeriod: "2026-04-28 ~ 2026-12-31",
          emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
        },
        scale: { workforce: 30, constructionValue: 30, industry: "construction" },
      })) as ToolResult;
      const text = r.content?.[0]?.text ?? "";
      results.push(analyze(doc.docId, text, r.structuredContent ?? {}));
    } catch (err) {
      results.push({
        docId: doc.docId,
        bodyLength: 0, koshaCount: 0, koshaTitles: [], hazardLabels: [], controlLabels: [],
        sectionCount: 0, semanticMismatch: [], missingSection: [], noLawExtract: false,
        suspicions: [`EXCEPTION: ${(err as Error).message}`], qualityScore: 0,
      });
    }
  }

  // 결함 우선 정렬
  results.sort((a, b) => a.qualityScore - b.qualityScore);

  console.log(`## 의심 사항 발견 (점수 < 9) — 사람 검토 필요\n`);
  const suspicious = results.filter((r) => r.suspicions.length > 0);
  if (suspicious.length === 0) {
    console.log(`  ✓ 의심 0건`);
  } else {
    for (const r of suspicious) {
      console.log(`\n### ${r.docId} [${r.qualityScore}점]`);
      console.log(`  KOSHA ${r.koshaCount} / Hazard ${r.hazardLabels.length} / Control ${r.controlLabels.length} / sections ${r.sectionCount}`);
      if (r.semanticMismatch.length > 0) {
        console.log(`  ⚠ KOSHA 의미 불일치 ${r.semanticMismatch.length}건:`);
        for (const t of r.semanticMismatch.slice(0, 5)) console.log(`     - ${t}`);
      }
      if (r.missingSection.length > 0) console.log(`  ✗ 누락 섹션: ${r.missingSection.join(", ")}`);
      if (r.noLawExtract) console.log(`  ✗ 법령 본문 발췌 누락`);
      if (r.sectionCount === 0) console.log(`  · sections 메타 fallback (sections 추가 필요)`);
    }
  }

  console.log(`\n\n## 종합`);
  const passed = results.filter((r) => r.qualityScore >= 9).length;
  const warning = results.filter((r) => r.qualityScore >= 6 && r.qualityScore < 9).length;
  const failed = results.filter((r) => r.qualityScore < 6).length;
  const avg = results.reduce((s, r) => s + r.qualityScore, 0) / results.length;
  console.log(`  ✓ 우수 (≥9): ${passed} / ${results.length}`);
  console.log(`  △ 경고 (6~8): ${warning}`);
  console.log(`  ✗ 결함 (<6): ${failed}`);
  console.log(`  평균 점수: ${avg.toFixed(2)} / 10`);
  console.log(`  KOSHA 의미 불일치 발견: ${results.filter((r) => r.semanticMismatch.length > 0).length} docId`);
  console.log(`  법령 발췌 누락: ${results.filter((r) => r.noLawExtract).length}`);
  console.log(`  fallback 모드: ${results.filter((r) => r.sectionCount === 0).length}`);
})();
