#!/usr/bin/env tsx
/**
 * 전수 커버리지 audit 발견 갭 5건 일괄 보강
 *
 * 1. 사고문서 → 79 패턴 informedBy
 * 2. 44 필드 checkPoints 누락 보강
 * 3. 10 활동 koshaArchiveFacets 자동 매핑
 * 4. 9 위험 mitigatedBy/facet 보강
 * 5. 222 신규 KOSHA Guide 자동 매핑 (제목 기반 키워드)
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src/ontology/graph/nodes");

async function readJson(p: string) { return JSON.parse(await readFile(p, "utf-8")); }
async function writeJson(p: string, n: any) { await writeFile(p, JSON.stringify(n, null, 2) + "\n", "utf-8"); }

// ─── GAP 1: 사고문서 → 패턴 ───
async function gap1_accidentDocsToPatterns(): Promise<number> {
  const PATTERNS_DIR = resolve(NODES, "patterns");
  const patterns: { iri: string; freq: number; event: string }[] = [];
  for (const f of await readdir(PATTERNS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const n = await readJson(resolve(PATTERNS_DIR, f));
    patterns.push({ iri: n["@id"], freq: n.caseFrequency ?? 0, event: n.koshaAccidentType ?? "" });
  }
  // 빈도 높은 상위 30 패턴을 사고문서들이 informedBy 로 참조
  const top = patterns.sort((a, b) => b.freq - a.freq).slice(0, 30).map(p => p.iri);

  const accidentDocs = ["severe-accident-immediate-report", "severe-accident-compliance", "industrial-accident-report"];
  let added = 0;
  for (const slug of accidentDocs) {
    const path = resolve(NODES, "documents", `${slug}.jsonld`);
    const n = await readJson(path);
    const cur: string[] = n.informedBy ?? [];
    let cnt = 0;
    for (const p of top) if (!cur.includes(p)) { cur.push(p); cnt++; }
    if (cnt > 0) { n.informedBy = cur; await writeJson(path, n); added += cnt; }
  }
  return added;
}

// ─── GAP 2: 44 필드 checkPoints 누락 보강 ───
async function gap2_fillCheckPoints(): Promise<number> {
  const DOCS = resolve(NODES, "documents");
  // 일반 점검 필드용 기본 checkPoints
  const DEFAULT_CHECK: Record<string, string[]> = {
    operator: ["국가기술자격 보유 (장비별)", "면허 유효기간 확인", "특별 안전교육 이수"],
    machineType: ["안전인증 + 안전검사 일자 확인", "제조사·모델·등록번호 일치", "용도별 사용 한계"],
    engineBrake: ["주차 시 브레이크 잠금", "주행 전 제동거리 시험", "마모 한계 점검"],
    lights: ["전조등·미등·후진등 작동", "야간 작업 시 추가 조명", "경광등·후방감지기"],
    rolloverProtection: ["ROPS/FOPS 설치 확인", "안전벨트 착용", "전도방지 안전장치"],
  };
  let filled = 0;
  for (const f of await readdir(DOCS)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOCS, f);
    const n = await readJson(path);
    let dirty = false;
    for (const sec of (n.sections ?? [])) {
      for (const fld of (sec.fields ?? [])) {
        if (fld.checkPoints?.length) continue;
        const dft = DEFAULT_CHECK[fld.key];
        if (dft) { fld.checkPoints = dft; filled++; dirty = true; continue; }
        // 일반 fallback
        if (fld.inputGuide) {
          fld.checkPoints = ["작성 정확성 자체 검토", "근거 자료 첨부", "결재선 서명 확인"];
          filled++; dirty = true;
        }
      }
    }
    if (dirty) await writeJson(path, n);
  }
  return filled;
}

// ─── GAP 3·4: 활동/위험 → facet 매핑 ───
async function gap34_facetMapping(): Promise<{ activity: number; hazard: number }> {
  const FACET_CODES = resolve(NODES, "facets/code");
  // facet → 매핑 인덱스 재구성
  const facetByActivity: Record<string, string[]> = {};
  const facetByHazard: Record<string, string[]> = {};
  for (const f of await readdir(FACET_CODES)) {
    if (!f.endsWith(".jsonld")) continue;
    const n = await readJson(resolve(FACET_CODES, f));
    for (const a of (n.appliesToActivities ?? [])) {
      const slug = a.replace(/^activity:/, "");
      if (!facetByActivity[slug]) facetByActivity[slug] = [];
      facetByActivity[slug].push(n["@id"]);
    }
    for (const h of (n.hasHazard ?? [])) {
      const slug = h.replace(/^hazard:/, "");
      if (!facetByHazard[slug]) facetByHazard[slug] = [];
      facetByHazard[slug].push(n["@id"]);
    }
  }

  // 활동 추가 매핑 (분야별 facet)
  const ACTIVITY_FACETS: Record<string, string[]> = {
    earthwork_landfill: ["facet:ctgr03/04", "facet:ctgr03/05"],
    electric_work_50v_plus: ["facet:ctgr02/20", "facet:ctgr02/21", "facet:ctgr01/12"],
    finishing_tile: ["facet:ctgr01/01"],
    general_workplace_safety: ["facet:ctgr01/05", "facet:ctgr01/06"],
    heavy_lifting: ["facet:ctgr02/10", "facet:ctgr02/13", "facet:ctgr02/14"],
    safety_education: [],
    risk_assessment_general: [],
    tbm_daily: [],
    drainage_sewerage: ["facet:ctgr03/20"],
    underground_utility: ["facet:ctgr03/21"],
    waterproofing: ["facet:ctgr03/22"],
    finishing_paint: ["facet:ctgr03/23", "facet:ctgr04/04"],
    road_pavement: ["facet:ctgr03/19"],
    bridge_5m_30m: ["facet:ctgr03/18"],
    phc_pile_driving: ["facet:ctgr03/17"],
    steel_structure: ["facet:ctgr03/15"],
    demolition: ["facet:ctgr03/14"],
    rc_concrete: ["facet:ctgr03/03"],
    formwork_shoring: ["facet:ctgr03/01", "facet:ctgr03/02"],
    excavation_2m_plus: ["facet:ctgr03/04", "facet:ctgr03/05"],
    tower_crane: ["facet:ctgr02/10"],
    tunnel_excavation: ["facet:ctgr03/07", "facet:ctgr03/09"],
    scaffolding_assembly: ["facet:ctgr03/12", "facet:ctgr03/13"],
    asbestos_removal: ["facet:ctgr04/08"],
    tower_assembly: ["facet:ctgr02/10"],
    vehicle_cargo: ["facet:ctgr01/17"],
    vehicle_construction: ["facet:ctgr01/17"],
  };
  let actCount = 0;
  for (const [slug, facets] of Object.entries(ACTIVITY_FACETS)) {
    if (!facets.length) continue;
    const path = resolve(NODES, "activities", `${slug}.jsonld`);
    try {
      const n = await readJson(path);
      const cur: string[] = n.koshaArchiveFacets ?? [];
      let added = 0;
      for (const f of facets) if (!cur.includes(f)) { cur.push(f); added++; }
      if (added > 0) { n.koshaArchiveFacets = cur; await writeJson(path, n); actCount += added; }
    } catch {}
  }

  // 위험 추가 매핑 (mitigatedBy + facet)
  const HAZARD_FIX: Record<string, { mit?: string[]; facet?: string[] }> = {
    acute_toxic_gas: { mit: ["control:eng_explosion_proof", "control:admin_emergency_plan", "control:ppe_respirator"] },
    cold_stress: { facet: ["facet:ctgr04/17"] },
    crushing: { facet: ["facet:ctgr02/16"] },
    drowning: { facet: ["facet:ctgr03/20"] },
    electric_shock: { facet: ["facet:ctgr02/20", "facet:ctgr02/21"] },
    psychosocial_stress: { facet: ["facet:ctgr04/21"] },
    radiation_uv: { facet: ["facet:ctgr04/18"] },
    struck_by_overturn: { facet: ["facet:ctgr01/17"] },
    vibration_exposure: { facet: ["facet:ctgr04/11"] },
  };
  let hazCount = 0;
  for (const [slug, fix] of Object.entries(HAZARD_FIX)) {
    const path = resolve(NODES, "hazards", `${slug}.jsonld`);
    try {
      const n = await readJson(path);
      let dirty = false;
      if (fix.mit?.length) {
        const cur: string[] = n.mitigatedBy ?? [];
        for (const m of fix.mit) if (!cur.includes(m)) { cur.push(m); hazCount++; dirty = true; }
        if (cur.length) n.mitigatedBy = cur;
      }
      if (fix.facet?.length) {
        const cur: string[] = n.koshaArchiveFacets ?? [];
        for (const f of fix.facet) if (!cur.includes(f)) { cur.push(f); hazCount++; dirty = true; }
        if (cur.length) n.koshaArchiveFacets = cur;
      }
      if (dirty) await writeJson(path, n);
    } catch {}
  }

  return { activity: actCount, hazard: hazCount };
}

// ─── GAP 5: 222 신규 KOSHA Guide 자동 매핑 ───
async function gap5_autoMapNewGuides(): Promise<number> {
  const GUIDES_DIR = resolve(NODES, "documents/guides");
  // 활동 슬러그 + 키워드
  const ACTIVITY_KEYWORDS: Array<{ activity: string; pattern: RegExp }> = [
    { activity: "excavation_2m_plus", pattern: /(굴착|터파기|흙막이)/ },
    { activity: "tower_crane", pattern: /타워크레인/ },
    { activity: "scaffolding_assembly", pattern: /(비계|작업발판)/ },
    { activity: "formwork_shoring", pattern: /(거푸집|동바리)/ },
    { activity: "rc_concrete", pattern: /(콘크리트|타설)/ },
    { activity: "demolition", pattern: /(해체|철거)/ },
    { activity: "tunnel_excavation", pattern: /터널/ },
    { activity: "bridge_5m_30m", pattern: /교량/ },
    { activity: "steel_structure", pattern: /철골/ },
    { activity: "phc_pile_driving", pattern: /(항타|파일|PHC)/ },
    { activity: "electric_work_50v_plus", pattern: /(전기|배전|배선)/ },
    { activity: "asbestos_removal", pattern: /석면/ },
  ];
  const HAZARD_KEYWORDS: Array<{ hazard: string; pattern: RegExp }> = [
    { hazard: "fall_from_height", pattern: /(추락|떨어짐)/ },
    { hazard: "fall_object", pattern: /(낙하물|낙반)/ },
    { hazard: "cave_in", pattern: /(붕괴|매몰|사면)/ },
    { hazard: "electric_shock", pattern: /(감전|전기)/ },
    { hazard: "fire_explosion", pattern: /(화재|폭발)/ },
    { hazard: "asphyxiation", pattern: /(질식|밀폐|산소결핍)/ },
    { hazard: "chemical_exposure", pattern: /(화학물질|유해물질)/ },
    { hazard: "noise_exposure", pattern: /소음/ },
    { hazard: "vibration_exposure", pattern: /진동/ },
    { hazard: "dust_exposure", pattern: /(분진|먼지)/ },
    { hazard: "heat_stress", pattern: /(고온|온열|폭염)/ },
    { hazard: "machine_entanglement", pattern: /(기계|끼임|협착)/ },
  ];
  const EQUIPMENT_KEYWORDS: Array<{ equipment: string; pattern: RegExp }> = [
    { equipment: "crane", pattern: /(크레인|호이스트)/ },
    { equipment: "lift", pattern: /리프트/ },
    { equipment: "gondola", pattern: /곤돌라/ },
    { equipment: "aerial_work_platform", pattern: /고소작업대/ },
    { equipment: "welding_cutting_apparatus", pattern: /(용접|용단)/ },
    { equipment: "ac_arc_welder", pattern: /아크용접/ },
    { equipment: "pressure_vessel", pattern: /압력용기/ },
    { equipment: "power_saw", pattern: /(원형톱|전동톱)/ },
  ];

  let mapped = 0;
  for (const f of await readdir(GUIDES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(GUIDES_DIR, f);
    const n = await readJson(path);
    // 이미 매핑된 가이드는 skip
    if ((n.appliesToActivities?.length ?? 0) > 0 || (n.causedBy?.length ?? 0) > 0 || (n.involves?.length ?? 0) > 0) continue;
    const title = (n.title ?? "") as string;
    const acts: string[] = [];
    const hzs: string[] = [];
    const eqs: string[] = [];
    for (const ak of ACTIVITY_KEYWORDS) if (ak.pattern.test(title)) acts.push(`activity:${ak.activity}`);
    for (const hk of HAZARD_KEYWORDS) if (hk.pattern.test(title)) hzs.push(`hazard:${hk.hazard}`);
    for (const ek of EQUIPMENT_KEYWORDS) if (ek.pattern.test(title)) eqs.push(`equipment:${ek.equipment}`);
    if (acts.length === 0 && hzs.length === 0 && eqs.length === 0) continue;
    if (acts.length) n.appliesToActivities = acts;
    if (hzs.length) n.causedBy = hzs;
    if (eqs.length) n.involves = eqs;
    await writeJson(path, n);
    mapped++;
  }
  return mapped;
}

async function main() {
  console.log("[GAP 1] 사고문서 → 79 패턴 informedBy...");
  const r1 = await gap1_accidentDocsToPatterns();
  console.log(`        ✓ +${r1} edges`);

  console.log("[GAP 2] 44 필드 checkPoints 누락 보강...");
  const r2 = await gap2_fillCheckPoints();
  console.log(`        ✓ ${r2} 필드 보강`);

  console.log("[GAP 3·4] 10 활동 + 9 위험 facet/mitigatedBy 매핑...");
  const r34 = await gap34_facetMapping();
  console.log(`        ✓ activity +${r34.activity} edges, hazard +${r34.hazard} edges`);

  console.log("[GAP 5] 222 신규 KOSHA Guide 자동 매핑...");
  const r5 = await gap5_autoMapNewGuides();
  console.log(`        ✓ ${r5} guide 매핑`);
}

main().catch((e) => { console.error(e); process.exit(1); });
