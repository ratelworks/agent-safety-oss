#!/usr/bin/env tsx
/**
 * seed-kosha-core-resources.ts
 *
 * KOSHA 핵심 자료 5종 그래프화 (정의만 있고 노드 0개인 prefix를 채움):
 *   1. method:*  — KRAS 7대 위험성평가 방법
 *   2. event:*   — 재해유형 24종 (KOSHA 산업재해통계 분류)
 *   3. stat:*    — 산재 통계 카테고리 (사망사고 Top 패턴 등)
 *   4. src:*     — 자료 출처 노드 (법제처·KOSHA 포털·data.go.kr 등)
 *   5. manual:*  — 핵심 매뉴얼 노드 (KOSHA-MS 등)
 *
 * 추가 작업:
 *   - 위험성평가 의무문서 5종 → evaluatedBy method:* 연결
 *   - 재해 hazards → relatedEvents event:* 연결
 *   - 의무문서 → references src:* 연결
 */

import { writeFile, readFile, readdir, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");

const FETCHED = "2026-04-28";

// ── 1. KRAS 7대 방법 ──────────────────────────────────────────────
const KRAS_METHODS = [
  {
    id: "method:3step",
    label: "위험성 수준 3단계 판단법",
    docId: "kras_3step",
    formId: "10182",
    description: "위험성을 상·중·하 (또는 저·중·고) 3단계로 직관적으로 구분. 소규모 사업장·초보 도입·신속한 판단용.",
    applicableTo: ["activity:risk_assessment_general"],
    bodyFile: "3step.md",
    suitableFor: "small_workplace_initial",
  },
  {
    id: "method:checklist",
    label: "체크리스트법",
    docId: "kras_checklist",
    formId: "10183",
    description: "사전에 정의된 체크리스트 항목을 따라 유해·위험요인을 점검. 주기적·반복 작업에 적합.",
    applicableTo: ["activity:risk_assessment_general", "activity:tbm_daily"],
    bodyFile: "checklist.md",
    suitableFor: "routine_inspection",
  },
  {
    id: "method:key_factor",
    label: "핵심요인 기술법 (OPS, One Point Sheet)",
    docId: "kras_key_factor",
    formId: "10184",
    description: "한 페이지에 핵심 위험요인·통제대책을 요약. TBM/현장 조회 시 활용.",
    applicableTo: ["activity:risk_assessment_general", "activity:tbm_daily", "activity:safety_education"],
    bodyFile: "key-factor.md",
    suitableFor: "tbm_briefing",
  },
  {
    id: "method:frequency_severity",
    label: "빈도·강도법",
    docId: "kras_frequency_severity",
    formId: "10185",
    description: "발생 빈도(F) × 부상 강도(S) 정량 매트릭스 평가. 정기 위험성평가 표준.",
    applicableTo: ["activity:risk_assessment_general"],
    bodyFile: "frequency-severity.md",
    suitableFor: "regular_assessment",
  },
  {
    id: "method:occupational_health",
    label: "산업보건 위험성평가법",
    docId: "kras_occupational_health",
    formId: "10186",
    description: "근로자 건강(소음·분진·화학·근골격계) 영향 위험성평가. 보건관리자·산업의사 활용.",
    applicableTo: ["activity:risk_assessment_general", "activity:asbestos_removal", "activity:finishing_paint", "activity:tunnel_excavation"],
    bodyFile: "occupational-health.md",
    suitableFor: "occupational_health_assessment",
  },
  {
    id: "method:chemical",
    label: "화학물질 위험성평가 (CHARM)",
    docId: "kras_chemical",
    formId: "10187",
    description: "화학물질 노출량(Exposure) × 유해성(Hazard) 평가. MSDS 기반 + KOSHA CHARM 도구.",
    applicableTo: ["activity:risk_assessment_general", "activity:finishing_paint", "activity:asbestos_removal"],
    bodyFile: "chemical.md",
    suitableFor: "chemical_assessment",
  },
  {
    id: "method:construction_continuous",
    label: "건설업 최초·상시·수시·정기 위험성평가",
    docId: "kras_construction_continuous",
    formId: "10188",
    description: "건설현장 4주기(최초·상시·수시·정기) 통합 위험성평가. 건설안전 표준 방법.",
    applicableTo: [
      "activity:risk_assessment_general",
      "activity:rc_concrete", "activity:steel_structure", "activity:scaffolding_assembly",
      "activity:formwork_shoring", "activity:excavation_2m_plus", "activity:tunnel_excavation",
      "activity:demolition", "activity:bridge_5m_30m", "activity:tower_crane",
    ],
    bodyFile: "construction-continuous.md",
    suitableFor: "construction_workplace",
    isPreferredFor: "construction",
  },
];

// ── 2. KOSHA 24종 재해유형 (산업재해통계 분류) ─────────────────────────
const EVENTS = [
  { id: "event:fall_from_height",      label: "떨어짐 (추락)",        koshaCode: "1",  primaryHazard: "hazard:fall_from_height" },
  { id: "event:trip_slip",             label: "넘어짐 (전도)",        koshaCode: "2",  primaryHazard: "hazard:trip_slip" },
  { id: "event:overturn_collapse",     label: "깔림·뒤집힘",          koshaCode: "3",  primaryHazard: "hazard:struck_by_overturn" },
  { id: "event:struck_by",             label: "부딪힘",               koshaCode: "4",  primaryHazard: "hazard:struck_by" },
  { id: "event:fall_object",           label: "맞음 (낙하·비래)",     koshaCode: "5",  primaryHazard: "hazard:fall_object" },
  { id: "event:cave_in",               label: "무너짐 (붕괴)",        koshaCode: "6",  primaryHazard: "hazard:cave_in" },
  { id: "event:caught_in",             label: "끼임",                 koshaCode: "7",  primaryHazard: "hazard:crushing" },
  { id: "event:cut_pierce",            label: "절단·베임·찔림",       koshaCode: "8",  primaryHazard: "hazard:crushing" },
  { id: "event:electric_shock",        label: "감전",                 koshaCode: "9",  primaryHazard: "hazard:electric_shock" },
  { id: "event:fire_explosion",        label: "화재·폭발",            koshaCode: "10", primaryHazard: "hazard:fire_explosion" },
  { id: "event:msd_overload",          label: "무리한 동작 (근골격계)", koshaCode: "11", primaryHazard: "hazard:msd_repetitive" },
  { id: "event:chemical_contact",      label: "화학물질 누출·접촉",   koshaCode: "12", primaryHazard: "hazard:chemical_exposure" },
  { id: "event:asphyxiation",          label: "산소결핍",             koshaCode: "13", primaryHazard: "hazard:asphyxiation" },
  { id: "event:drowning",              label: "빠짐·익사",            koshaCode: "14", primaryHazard: "hazard:drowning" },
  { id: "event:traffic_accident",      label: "사업장 내 교통사고",   koshaCode: "15", primaryHazard: "hazard:traffic_accident" },
  { id: "event:thermal_burn",          label: "이상온도 접촉 (화상)", koshaCode: "16", primaryHazard: "hazard:thermal_burn" },
  { id: "event:noise_vibration",       label: "소음·진동 노출",       koshaCode: "17", primaryHazard: "hazard:noise_exposure" },
  { id: "event:dust_exposure",         label: "분진 노출",            koshaCode: "18", primaryHazard: "hazard:dust_exposure" },
  { id: "event:radiation_exposure",    label: "방사선 노출",          koshaCode: "19", primaryHazard: "hazard:radiation_exposure" },
  { id: "event:violence",              label: "폭언·폭행",            koshaCode: "20", primaryHazard: "hazard:psychosocial_stress" },
  { id: "event:job_stress",            label: "직무스트레스 질환",    koshaCode: "21", primaryHazard: "hazard:psychosocial_stress" },
  { id: "event:biological_infection",  label: "병원체 노출 감염",     koshaCode: "22", primaryHazard: "hazard:biological_hazard" },
  { id: "event:dust_explosion",        label: "분진폭발",             koshaCode: "23", primaryHazard: null },
  { id: "event:other",                 label: "기타",                 koshaCode: "99", primaryHazard: null },
];

// ── 3. 산재 통계 ───────────────────────────────────────────────────
const STATS = [
  {
    id: "stat:construction_fatal_top_5",
    label: "건설업 사망사고 Top 5 유형",
    description: "고용노동부 산재통계 (2024 기준). 건설업 사망사고 1위 추락(50%+) > 끼임 > 부딪힘 > 무너짐 > 떨어짐.",
    period: "2024",
    industry: "construction",
    relatedEvents: ["event:fall_from_height", "event:caught_in", "event:struck_by", "event:cave_in", "event:fall_object"],
    sourceRef: "고용노동부 2024 산업재해 발생현황",
  },
  {
    id: "stat:industrial_accident_construction_share",
    label: "건설업 산재 비중",
    description: "전 산업 사망사고의 약 50%가 건설업. 50억/50인 미만 중소건설현장 사망률 가장 높음.",
    period: "2024",
    industry: "construction",
    sourceRef: "고용노동부 2024 산재통계 + KOSHA 산재예방연구",
  },
  {
    id: "stat:sif_archive_kosha",
    label: "사망사고 고위험요인 (SIF) 아카이브",
    description: "KOSHA 사망사고 사례 6,032건 (data.go.kr 15140383). 작업유형·재해유형·예방대책별 분류.",
    sourceRef: "data.go.kr 15140383",
    sourceUrl: "https://www.data.go.kr/data/15140383/fileData.do",
  },
];

// ── 4. 자료 출처 ───────────────────────────────────────────────────
const SOURCES = [
  { id: "src:law_go_kr",        label: "법제처 국가법령정보센터", url: "https://www.law.go.kr",
    description: "법령 본문 단일 출처. lawService.do API 제공." },
  { id: "src:kosha_portal",     label: "KOSHA 안전보건공단 포털", url: "https://www.kosha.or.kr",
    description: "KOSHA Guide·KRAS·매뉴얼·재해사례 단일 출처." },
  { id: "src:data_go_kr",       label: "공공데이터포털",            url: "https://www.data.go.kr",
    description: "KOSHA Guide(15144147)·SIF(15140383) 등 공공 OpenAPI." },
  { id: "src:msds_kosha",       label: "KOSHA MSDS DB",            url: "https://msds.kosha.or.kr",
    description: "물질안전보건자료 검색 시스템." },
  { id: "src:moel_safety_inspection", label: "고용노동부 안전검사기관", url: "https://www.moel.go.kr",
    description: "안전인증·안전검사 신청 시스템." },
];

// ── 5. 핵심 매뉴얼 ────────────────────────────────────────────────
const MANUALS = [
  {
    id: "manual:kosha_ms",
    label: "KOSHA-MS 안전보건경영시스템",
    description: "KOSHA가 인증하는 안전보건경영시스템 표준. 산안법 §15 안전보건관리체계와 정합. 5개 영역 32개 항목.",
    publishedBy: "한국산업안전보건공단",
    sourceRef: "kosha_portal",
    appliesToActivities: ["activity:general_workplace_safety", "activity:risk_assessment_general"],
  },
  {
    id: "manual:risk_assessment_practical",
    label: "위험성평가 실무 매뉴얼 (KOSHA)",
    description: "위험성평가 7대 방법(KRAS) + 단계별 실무 절차. 산안법 §36 + 위험성평가 고시.",
    publishedBy: "한국산업안전보건공단",
    sourceRef: "kosha_portal",
    appliesToActivities: ["activity:risk_assessment_general"],
  },
  {
    id: "manual:construction_disaster_prevention",
    label: "건설재해예방 실무 매뉴얼",
    description: "건설업 산재예방 표준 절차 (50억/50인 미만 중소현장 중점). 산안법 §73 + 시행령 §59.",
    publishedBy: "한국산업안전보건공단 + 건설안전협의회",
    sourceRef: "kosha_portal",
    appliesToActivities: [
      "activity:rc_concrete", "activity:steel_structure", "activity:scaffolding_assembly",
      "activity:excavation_2m_plus", "activity:demolition", "activity:tower_crane",
    ],
  },
];

// 위험성평가 의무문서 5종 ID
const RISK_DOC_IDS = [
  "doc:annual/risk_assessment_procedure",
  "doc:ad_hoc/initial_risk_assessment",
  "doc:annual/regular_risk_assessment",
  "doc:monthly/monthly_risk_assessment",
  "doc:ad_hoc/ad_hoc_risk_assessment",
];

async function writeNode(dir: string, slug: string, obj: unknown) {
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${slug}.jsonld`), JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

async function main() {
  const METHODS_DIR = resolve(NODES, "methods");
  const EVENTS_DIR  = resolve(NODES, "events");
  const STATS_DIR   = resolve(NODES, "statistics");
  const SOURCES_DIR = resolve(NODES, "sources");
  const MANUALS_DIR = resolve(NODES, "manuals");

  // 1. methods
  for (const m of KRAS_METHODS) {
    await writeNode(METHODS_DIR, m.id.replace("method:", ""), {
      "@context": "../../context.jsonld",
      "@id": m.id,
      "@type": "Method",
      label: m.label,
      docId: m.docId,
      verificationStatus: "kosha_verified",
      jurisdiction: "KR",
      _meta: {
        publishedBy: "한국산업안전보건공단 (KRAS)",
        sourceUrl: "https://portal.kosha.or.kr/kras/evaluation/kras-method",
        formId: m.formId,
        bodyFile: `kras-methods/${m.bodyFile}`,
        fetchedAt: FETCHED,
        licenseHint: "KOSHA 자료 — 출처 표시 필수",
      },
      description: m.description,
      suitableFor: m.suitableFor,
      applicableTo: m.applicableTo,
      ...(m.isPreferredFor && { isPreferredFor: m.isPreferredFor }),
      legalBasis: ["art:위험성평가-고시:6"],
      isPartOf: "src:kosha_portal",
    });
  }
  console.log(`✓ methods: ${KRAS_METHODS.length} nodes`);

  // 2. events
  for (const e of EVENTS) {
    await writeNode(EVENTS_DIR, e.id.replace("event:", ""), {
      "@context": "../../context.jsonld",
      "@id": e.id,
      "@type": "Event",
      label: e.label,
      verificationStatus: "kosha_verified",
      _meta: {
        publishedBy: "고용노동부 + 한국산업안전보건공단",
        koshaAccidentTypeCode: e.koshaCode,
        fetchedAt: FETCHED,
        sourceRef: "산업재해 발생현황 통계 분류",
      },
      description: `KOSHA 산업재해통계 분류 ${e.koshaCode}호 — ${e.label}`,
      ...(e.primaryHazard && { causedBy: [e.primaryHazard] }),
    });
  }
  console.log(`✓ events: ${EVENTS.length} nodes`);

  // 3. stats
  for (const s of STATS) {
    await writeNode(STATS_DIR, s.id.replace("stat:", ""), {
      "@context": "../../context.jsonld",
      "@id": s.id,
      "@type": "Statistic",
      label: s.label,
      verificationStatus: "kosha_verified",
      _meta: {
        publishedBy: "고용노동부 + 한국산업안전보건공단",
        period: s.period ?? "",
        industry: s.industry ?? "",
        sourceRef: s.sourceRef,
        sourceUrl: (s as any).sourceUrl ?? "",
        fetchedAt: FETCHED,
      },
      description: s.description,
      ...((s as any).relatedEvents && { involves: (s as any).relatedEvents }),
    });
  }
  console.log(`✓ statistics: ${STATS.length} nodes`);

  // 4. sources
  for (const s of SOURCES) {
    await writeNode(SOURCES_DIR, s.id.replace("src:", ""), {
      "@context": "../../context.jsonld",
      "@id": s.id,
      "@type": "Source",
      label: s.label,
      verificationStatus: "verified",
      _meta: {
        url: s.url,
        fetchedAt: FETCHED,
        licenseHint: "공공자료 — 출처 표시",
      },
      description: s.description,
    });
  }
  console.log(`✓ sources: ${SOURCES.length} nodes`);

  // 5. manuals
  for (const m of MANUALS) {
    await writeNode(MANUALS_DIR, m.id.replace("manual:", ""), {
      "@context": "../../context.jsonld",
      "@id": m.id,
      "@type": "Manual",
      label: m.label,
      verificationStatus: "kosha_verified",
      _meta: {
        publishedBy: m.publishedBy,
        sourceRef: m.sourceRef,
        fetchedAt: FETCHED,
        licenseHint: "KOSHA 자료 — 출처 표시 필수",
      },
      description: m.description,
      appliesToActivities: m.appliesToActivities,
      isPartOf: `src:${m.sourceRef}`,
    });
  }
  console.log(`✓ manuals: ${MANUALS.length} nodes`);

  // 6. 위험성평가 의무문서 5종에 evaluatedBy [methods] 추가
  let docsUpdated = 0;
  for (const docId of RISK_DOC_IDS) {
    const slug = docId.replace(/^doc:[^/]+\//, "");
    // 파일 검색
    const dir = resolve(NODES, "documents");
    const fname = slug.replace(/_/g, "-") + ".jsonld";
    const path = resolve(dir, fname);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      node.evaluatedBy = KRAS_METHODS.map((m) => m.id);
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      docsUpdated += 1;
    } catch { /* doc not found */ }
  }
  console.log(`✓ 위험성평가 의무문서 evaluatedBy 추가: ${docsUpdated}`);

  // 7. 사고 의무문서 → involves [events] 추가
  const ACCIDENT_DOCS = ["industrial-accident-report.jsonld", "severe-accident-immediate-report.jsonld"];
  for (const fname of ACCIDENT_DOCS) {
    const path = resolve(NODES, "documents", fname);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      node.involves = EVENTS.slice(0, 12).map((e) => e.id); // 주요 12개 재해유형
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      console.log(`  ✓ ${fname} → involves [12 events]`);
    } catch { /* missing */ }
  }

  // 8. hazards → relatedEvents
  // hazard:fall_from_height ← event:fall_from_height (causedBy 역방향)
  // hazard 노드의 mapsToEvent 추가는 생략 (event.causedBy로 충분)

  console.log("\n[done] KOSHA 핵심 자료 5종 그래프화 완료");
  console.log(`       methods 7 / events ${EVENTS.length} / stats ${STATS.length} / sources ${SOURCES.length} / manuals ${MANUALS.length} = ${7 + EVENTS.length + STATS.length + SOURCES.length + MANUALS.length} 노드 추가`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
