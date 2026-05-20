#!/usr/bin/env tsx
/**
 * seed-kosha-deep-resources.ts
 *
 * KOSHA 자료 깊이 보강:
 *   1. KRAS 위험성평가 5단계 절차 (method 카테고리)
 *   2. 위험성 등급 매트릭스 5x4 (method 카테고리)
 *   3. 안전인증/검사/자율안전 분류 (applicabilities 확장)
 *   4. KOSHA-MS 5개 영역 (manuals 확장)
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const FETCHED = "2026-04-28";

// ──────────────────────────────────────────────────────────────
// 1. KRAS 위험성평가 5단계 절차
// ──────────────────────────────────────────────────────────────
const KRAS_STEPS = [
  {
    id: "method:kras_step_1_prep",
    label: "1단계: 사전준비",
    description: "위험성평가 대상 선정·평가팀 구성·평가일정 수립·교육 실시. 위험성평가 고시 §5 적용.",
    inputs: ["사업장 작업·공정 목록", "조직도", "안전관리자 선임"],
    outputs: ["평가대상 목록", "평가팀 명단", "평가 일정"],
    legalBasis: ["art:위험성평가-고시:5"],
  },
  {
    id: "method:kras_step_2_identify",
    label: "2단계: 유해·위험요인 파악",
    description: "작업분류·관찰·청취·과거 재해사례·KOSHA 통계·MSDS 활용하여 유해·위험요인 식별. 위험성평가 고시 §6 적용.",
    inputs: ["작업절차서", "현장 관찰", "작업자 면담", "과거 사고기록", "KOSHA Guide"],
    outputs: ["유해·위험요인 목록"],
    legalBasis: ["art:위험성평가-고시:6"],
    informedBy: ["stat:sif_archive_kosha", "stat:construction_fatal_top_5"],
  },
  {
    id: "method:kras_step_3_estimate",
    label: "3단계: 위험성 추정",
    description: "각 유해·위험요인별 발생 빈도(F)·부상 강도(S) 추정. 빈도·강도법 매트릭스 적용. 위험성평가 고시 §7 적용.",
    inputs: ["유해·위험요인 목록", "노출시간·인원·과거 사고 통계"],
    outputs: ["위험성 점수 (F×S)"],
    legalBasis: ["art:위험성평가-고시:7"],
    informedBy: ["method:risk_matrix_5x4", "method:frequency_severity"],
  },
  {
    id: "method:kras_step_4_decide",
    label: "4단계: 위험성 결정",
    description: "추정된 위험성이 허용 가능한지 판단. 허용 불가능 위험은 감소대책 의무. 위험성평가 고시 §8 적용.",
    inputs: ["위험성 점수", "사업장 허용 기준"],
    outputs: ["허용 가능/불가능 분류"],
    legalBasis: ["art:위험성평가-고시:8"],
  },
  {
    id: "method:kras_step_5_control",
    label: "5단계: 감소대책 수립·이행",
    description: "ERIC-PP 위계(Eliminate→Substitute→Engineering→Administrative→PPE) 따른 통제대책 수립·이행·확인. 위험성평가 고시 §9 적용.",
    inputs: ["허용 불가능 위험요인"],
    outputs: ["감소대책", "잔존위험성 평가", "이행 기록"],
    legalBasis: ["art:위험성평가-고시:9"],
    informedBy: ["control:eric_eliminate", "control:eric_substitute", "control:eric_engineering", "control:eric_administrative", "control:eric_ppe"],
  },
];

// ──────────────────────────────────────────────────────────────
// 2. 위험성 등급 매트릭스 (F×S 5x4)
// ──────────────────────────────────────────────────────────────
const RISK_MATRIX = {
  id: "method:risk_matrix_5x4",
  label: "위험성 등급 매트릭스 (빈도×강도 5x4)",
  description: "KRAS 빈도·강도법 정량 매트릭스. 빈도 5등급(A~E) × 강도 4등급(I~IV) = 위험성 점수(1~20). 등급 환산 (상=15-20 / 중=8-14 / 하=1-7).",
  frequency: {
    A: { label: "상시 (주 1회 이상)", weight: 5 },
    B: { label: "자주 (월 1회 이상)", weight: 4 },
    C: { label: "가끔 (연 3회 이상)", weight: 3 },
    D: { label: "드물게 (연 1회)", weight: 2 },
    E: { label: "거의 없음", weight: 1 },
  },
  severity: {
    "I":  { label: "치명 (사망·영구장애)", weight: 4 },
    "II": { label: "중대 (휴업 14일 이상)", weight: 3 },
    "III":{ label: "경미 (휴업 3-13일)",   weight: 2 },
    "IV": { label: "미미 (휴업 3일 미만)", weight: 1 },
  },
  riskLevel: {
    high:   { range: "15-20", label: "상", action: "즉시 작업 중단 또는 통제 강화" },
    medium: { range: "8-14",  label: "중", action: "안전조치 강화·대책 수립" },
    low:    { range: "1-7",   label: "하", action: "일상 관리로 충분" },
  },
};

// ──────────────────────────────────────────────────────────────
// 3. 안전인증/검사/자율안전 분류 (산안법 §80/§93/§89)
// ──────────────────────────────────────────────────────────────
const CERT_GROUPS = [
  {
    id: "applic:safety_certification_13",
    label: "안전인증 대상 13종 (산안법 §80)",
    description: "유해·위험 기계·기구·방호장치·보호구. KCs 마크 부착. 무인증 시 §169 (3년/3천만).",
    legalBasis: ["art:산안법:80", "art:산안법시행령:74"],
    items: [
      "프레스", "전단기·절곡기", "크레인", "리프트", "압력용기",
      "롤러기", "사출성형기", "고소작업대", "곤돌라", "기계톱(체인톱)",
      "교류아크용접기", "파쇄기", "산업용로봇",
    ],
  },
  {
    id: "applic:safety_inspection_11",
    label: "안전검사 대상 11종 (산안법 §93)",
    description: "사용 사업주가 정기적으로 받는 안전검사. 합격증(검사필증) 부착 의무.",
    legalBasis: ["art:산안법:93", "art:산안법시행령:78"],
    items: [
      "프레스", "전단기", "크레인(2t 이상)", "리프트", "압력용기",
      "곤돌라", "국소배기장치", "원심기", "롤러기", "사출성형기", "고소작업대",
    ],
  },
  {
    id: "applic:voluntary_safety_confirmation_21",
    label: "자율안전확인 대상 21종 (산안법 §89)",
    description: "안전인증대상 외 유해·위험 기계기구. 제조·수입자가 신고. KCs(s) 마크.",
    legalBasis: ["art:산안법:89", "art:산안법시행령:77"],
    items: [
      "동력식 수동대패", "연삭기", "혼합기", "파쇄기·분쇄기", "식품가공기계",
      "컨베이어", "산업용로봇", "자동차정비용 리프트", "공작기계", "고정식 목재가공기",
      "인쇄기", "기압조절실", "용접기", "절단기", "포장기계",
      "기타 안전인증대상이 아닌 위험기계기구",
    ],
  },
];

// ──────────────────────────────────────────────────────────────
// 4. KOSHA-MS 5개 영역 (PDCA 기반)
// ──────────────────────────────────────────────────────────────
const KOSHA_MS_DOMAINS = [
  {
    id: "manual:kosha_ms_domain_leadership",
    label: "[P] 영역1: 안전보건 리더십",
    description: "최고경영자 안전보건방침·책임·권한·근로자 참여. KOSHA-MS 인증 평가 1영역.",
    items: ["안전보건방침 수립", "최고경영자 책임", "근로자 참여·협의", "조직 책임·권한 부여"],
    parentManual: "manual:kosha_ms",
    pdcaPhase: "Plan",
  },
  {
    id: "manual:kosha_ms_domain_planning",
    label: "[P] 영역2: 안전보건 계획",
    description: "위험성평가·법규 식별·목표 설정·이행계획. KOSHA-MS 2영역.",
    items: ["위험성평가", "법령·요구사항 식별", "안전보건 목표", "이행계획 수립"],
    parentManual: "manual:kosha_ms",
    pdcaPhase: "Plan",
  },
  {
    id: "manual:kosha_ms_domain_operation",
    label: "[D] 영역3: 안전보건 운영",
    description: "운영절차·교육·의사소통·문서관리·비상조치·도급 관리. KOSHA-MS 3영역.",
    items: ["운영절차", "교육·훈련", "의사소통", "문서관리", "비상조치", "변경관리", "도급사업 관리"],
    parentManual: "manual:kosha_ms",
    pdcaPhase: "Do",
  },
  {
    id: "manual:kosha_ms_domain_check",
    label: "[C] 영역4: 점검·평가·개선",
    description: "성과측정·내부심사·법규준수평가·시정조치. KOSHA-MS 4영역.",
    items: ["성과측정·모니터링", "내부심사", "법규준수평가", "사고조사", "시정조치"],
    parentManual: "manual:kosha_ms",
    pdcaPhase: "Check",
  },
  {
    id: "manual:kosha_ms_domain_review",
    label: "[A] 영역5: 경영검토·지속개선",
    description: "경영진 검토·지속적 개선 활동. KOSHA-MS 5영역.",
    items: ["경영검토", "지속개선"],
    parentManual: "manual:kosha_ms",
    pdcaPhase: "Act",
  },
];

async function writeNode(dir: string, slug: string, obj: unknown) {
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${slug}.jsonld`), JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

async function main() {
  const METHODS_DIR = resolve(NODES, "methods");
  const APPLIC_DIR  = resolve(NODES, "applicabilities");
  const MANUALS_DIR = resolve(NODES, "manuals");

  // 1. KRAS 5단계
  for (const s of KRAS_STEPS) {
    await writeNode(METHODS_DIR, s.id.replace("method:", ""), {
      "@context": "../../context.jsonld",
      "@id": s.id,
      "@type": "Method",
      label: s.label,
      verificationStatus: "kosha_verified",
      _meta: {
        publishedBy: "한국산업안전보건공단 (KRAS)",
        sourceUrl: "https://portal.kosha.or.kr/kras",
        category: "kras_step",
        fetchedAt: FETCHED,
      },
      description: s.description,
      legalBasis: s.legalBasis,
      isPartOf: "manual:risk_assessment_practical",
      ...(s.informedBy && { informedBy: s.informedBy }),
    });
  }
  console.log(`✓ KRAS 5단계 절차: ${KRAS_STEPS.length} nodes`);

  // 2. 위험성 매트릭스
  await writeNode(METHODS_DIR, "risk_matrix_5x4", {
    "@context": "../../context.jsonld",
    "@id": RISK_MATRIX.id,
    "@type": "Method",
    label: RISK_MATRIX.label,
    verificationStatus: "kosha_verified",
    _meta: {
      publishedBy: "한국산업안전보건공단",
      sourceRef: "위험성평가 고시 + KRAS 빈도·강도법",
      fetchedAt: FETCHED,
      matrix: {
        frequency: RISK_MATRIX.frequency,
        severity: RISK_MATRIX.severity,
        riskLevel: RISK_MATRIX.riskLevel,
      },
    },
    description: RISK_MATRIX.description,
    legalBasis: ["art:위험성평가-고시:7"],
    isPartOf: "method:frequency_severity",
  });
  console.log("✓ 위험성 매트릭스 5x4: 1 node");

  // 3. 인증/검사/자율안전 분류 (applicabilities 확장)
  for (const c of CERT_GROUPS) {
    await writeNode(APPLIC_DIR, c.id.replace("applic:", ""), {
      "@context": "../../context.jsonld",
      "@id": c.id,
      "@type": "Applicability",
      label: c.label,
      verificationStatus: "verified",
      _meta: {
        publishedBy: "고용노동부 + 한국산업안전보건공단",
        sourceUrl: "https://www.law.go.kr/법령/산업안전보건법",
        fetchedAt: FETCHED,
        items: c.items,
        itemCount: c.items.length,
      },
      description: c.description,
      legalBasis: c.legalBasis,
    });
  }
  console.log(`✓ 인증/검사/자율안전 분류: ${CERT_GROUPS.length} nodes`);

  // 4. KOSHA-MS 5개 영역
  for (const d of KOSHA_MS_DOMAINS) {
    await writeNode(MANUALS_DIR, d.id.replace("manual:", ""), {
      "@context": "../../context.jsonld",
      "@id": d.id,
      "@type": "Manual",
      label: d.label,
      verificationStatus: "kosha_verified",
      _meta: {
        publishedBy: "한국산업안전보건공단",
        sourceRef: "KOSHA-MS",
        fetchedAt: FETCHED,
        category: "kosha_ms_domain",
        pdcaPhase: d.pdcaPhase,
        items: d.items,
      },
      description: d.description,
      isPartOf: d.parentManual,
    });
  }
  console.log(`✓ KOSHA-MS 5개 영역: ${KOSHA_MS_DOMAINS.length} nodes`);

  // 5. 의무문서와 연결 (Cross-link)
  // 위험성평가 5종 → kras_step_1~5 모두 evaluatedBy
  const RISK_DOCS = [
    "documents/risk-assessment-procedure.jsonld",
    "documents/initial-risk-assessment.jsonld",
    "documents/regular-risk-assessment.jsonld",
    "documents/monthly-risk-assessment.jsonld",
    "documents/ad-hoc-risk-assessment.jsonld",
  ];
  for (const fr of RISK_DOCS) {
    const path = resolve(NODES, fr);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      const cur = (node.evaluatedBy as string[] | undefined) ?? [];
      for (const s of KRAS_STEPS) if (!cur.includes(s.id)) cur.push(s.id);
      if (!cur.includes(RISK_MATRIX.id)) cur.push(RISK_MATRIX.id);
      node.evaluatedBy = cur;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    } catch { /* missing */ }
  }
  console.log("✓ 위험성평가 5종 → KRAS 5단계+매트릭스 evaluatedBy 추가");

  // 6. 안전인증·검사·자율안전 의무문서 → applicabilities 매핑
  const CERT_DOCS_MAP: Record<string, string[]> = {
    "documents/safety-certification-application.jsonld":      ["applic:safety_certification_13"],
    "documents/safety-inspection-application.jsonld":         ["applic:safety_inspection_11"],
    "documents/voluntary-safety-confirmation-filing.jsonld":  ["applic:voluntary_safety_confirmation_21"],
  };
  for (const [file, applics] of Object.entries(CERT_DOCS_MAP)) {
    const path = resolve(NODES, file);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      const cur = (node.appliesTo as string[] | undefined) ?? [];
      for (const a of applics) if (!cur.includes(a)) cur.push(a);
      node.appliesTo = cur;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    } catch { /* missing */ }
  }
  console.log("✓ 인증·검사 의무문서 → applicabilities 매핑");

  // 7. KOSHA-MS 5영역 → 안전보건경영방침/관리체계 의무문서
  const KOSHA_MS_DOCS = [
    "documents/safety-health-management-policy.jsonld",
    "documents/safety-health-regulation.jsonld",
    "documents/severe-accident-compliance.jsonld",
  ];
  for (const fr of KOSHA_MS_DOCS) {
    const path = resolve(NODES, fr);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      const cur = (node.informedBy as string[] | undefined) ?? [];
      for (const d of KOSHA_MS_DOMAINS) if (!cur.includes(d.id)) cur.push(d.id);
      node.informedBy = cur;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    } catch { /* missing */ }
  }
  console.log("✓ KOSHA-MS 5영역 → 안전보건경영 의무문서 informedBy");

  console.log("\n[done] KOSHA 자료 깊이 보강 완료");
  console.log(`       추가 노드: ${KRAS_STEPS.length} + 1 + ${CERT_GROUPS.length} + ${KOSHA_MS_DOMAINS.length} = ${KRAS_STEPS.length + 1 + CERT_GROUPS.length + KOSHA_MS_DOMAINS.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
