#!/usr/bin/env tsx
/**
 * Phase A-1: 사고 보고 문서를 24종 사고유형(event)·hazard·control과 연결
 *
 * 대상: severe-accident-immediate-report, severe-accident-compliance, industrial-accident-report
 * 추가 엣지: hasHazard (events), mitigatedBy (admin_emergency_plan 등), guidedBy (KOSHA Guide)
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "..", "src/ontology/graph/nodes/documents");

// 24 사고유형 — KOSHA 분류
const ALL_EVENTS = [
  "asphyxiation","biological_infection","caught_in","cave_in","chemical_contact",
  "cut_pierce","drowning","dust_explosion","dust_exposure","electric_shock",
  "fall_from_height","fall_object","fire_explosion","job_stress","msd_overload",
  "noise_vibration","other","overturn_collapse","radiation_exposure","struck_by",
  "thermal_burn","traffic_accident","trip_slip","violence",
];

// 24 사고유형 → 대표 hazard (1:1 또는 다중)
const EVENT_TO_HAZARDS: Record<string, string[]> = {
  asphyxiation: ["asphyxiation"],
  biological_infection: ["biological_hazard"],
  caught_in: ["machine_entanglement", "crushing"],
  cave_in: ["cave_in", "buried_alive"],
  chemical_contact: ["chemical_exposure", "chemical_burn"],
  cut_pierce: ["machine_entanglement"],
  drowning: ["drowning"],
  dust_explosion: ["fire_explosion", "dust_exposure"],
  dust_exposure: ["dust_exposure"],
  electric_shock: ["electric_shock"],
  fall_from_height: ["fall_from_height"],
  fall_object: ["fall_object"],
  fire_explosion: ["fire_explosion", "fire"],
  job_stress: ["psychosocial_stress"],
  msd_overload: ["ergonomic_overload", "manual_handling", "msd_repetitive"],
  noise_vibration: ["noise_exposure", "vibration_exposure"],
  other: [],
  overturn_collapse: ["struck_by_overturn"],
  radiation_exposure: ["radiation_exposure", "radiation_uv"],
  struck_by: ["struck_by"],
  thermal_burn: ["thermal_burn", "heat_stress"],
  traffic_accident: ["traffic_accident"],
  trip_slip: ["trip_slip"],
  violence: ["psychosocial_stress"],
};

// 사고 대응 표준 통제대책 (ERIC-PP 위계)
const ACCIDENT_CONTROLS = [
  "control:admin_emergency_plan",  // 비상대응계획
  "control:admin_inspection",      // 점검
  "control:admin_safety_education",// 교육
  "control:admin_work_permit",     // 작업허가
  "control:admin_risk_assessment", // 위험성평가
];

// KOSHA Guide — 재해조사·중대재해 관련 (실존 IRI)
const ACCIDENT_KOSHA_GUIDES = [
  "doc:kosha_guide/G-5-2017",   // 업무상 사고조사
  "doc:kosha_guide/H-36-2021",  // 중대재해 급성스트레스 조기대응
  "doc:kosha_guide/E-182-2021", // 정전기 화재·폭발 재해조사
];

// 법령 cross-reference
const ACCIDENT_LEGAL_REFS = {
  "severe-accident-immediate-report": [
    "art:산안법:54", "art:산안법:175",
    "art:중처법:6",  // 중대재해처벌법 §6 안전보건확보의무 위반 처벌
    "art:중처법:4",
  ],
  "severe-accident-compliance": [
    "art:산안법:54", "art:산안법:55", "art:산안법:56",
    "art:중처법:4",  "art:중처법:5",  "art:중처법:6",
    "art:중처법시행령:4", "art:중처법시행령:5",
  ],
  "industrial-accident-report": [
    "art:산안법:57", "art:산안법:175",
    "art:산안법시행규칙:73", "art:산안법시행규칙:74",
  ],
};

const PATCHES: Array<{ doc: string; eventScope: "all" | "fatal_only"; }> = [
  { doc: "severe-accident-immediate-report", eventScope: "fatal_only" },
  { doc: "severe-accident-compliance", eventScope: "fatal_only" },
  { doc: "industrial-accident-report", eventScope: "all" },
];

// 중대재해 우선 사고유형 (사망 발생률 높은 11종)
const FATAL_EVENTS = [
  "asphyxiation","caught_in","cave_in","chemical_contact","drowning",
  "electric_shock","fall_from_height","fall_object","fire_explosion",
  "overturn_collapse","struck_by",
];

async function patchDoc(slug: string, scope: "all" | "fatal_only"): Promise<{ changed: boolean; edges: number }> {
  const path = resolve(DOCS, `${slug}.jsonld`);
  const node = JSON.parse(await readFile(path, "utf-8"));

  const events = scope === "all" ? ALL_EVENTS : FATAL_EVENTS;
  const eventIris = events.map(e => `event:${e}`);

  const hazardSet = new Set<string>();
  for (const e of events) {
    for (const h of EVENT_TO_HAZARDS[e] ?? []) hazardSet.add(`hazard:${h}`);
  }

  let edges = 0;
  // hasHazard
  const curHazards: string[] = node.hasHazard ?? [];
  for (const h of hazardSet) if (!curHazards.includes(h)) { curHazards.push(h); edges++; }
  if (curHazards.length) node.hasHazard = curHazards;

  // mitigatedBy — 통제대책 (사고 대응 5종)
  const curControls: string[] = node.mitigatedBy ?? [];
  for (const c of ACCIDENT_CONTROLS) if (!curControls.includes(c)) { curControls.push(c); edges++; }
  if (curControls.length) node.mitigatedBy = curControls;

  // guidedBy — KOSHA Guide
  const curGuides: string[] = node.guidedBy ?? [];
  for (const g of ACCIDENT_KOSHA_GUIDES) if (!curGuides.includes(g)) { curGuides.push(g); edges++; }
  if (curGuides.length) node.guidedBy = curGuides;

  // appliesToActivities → events (사고유형 매핑)
  const curApplies: string[] = node.appliesToActivities ?? [];
  for (const e of eventIris) if (!curApplies.includes(e)) { curApplies.push(e); edges++; }
  if (curApplies.length) node.appliesToActivities = curApplies;

  // legalBasis 추가 cross-reference
  const refs = (ACCIDENT_LEGAL_REFS as any)[slug] ?? [];
  const curLegal: string[] = node.legalBasis ?? [];
  for (const r of refs) if (!curLegal.includes(r)) { curLegal.push(r); edges++; }
  if (curLegal.length) node.legalBasis = curLegal;

  await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
  return { changed: edges > 0, edges };
}

async function main() {
  let totalEdges = 0;
  for (const p of PATCHES) {
    const r = await patchDoc(p.doc, p.eventScope);
    console.log(`  ${p.doc}: +${r.edges} edges (scope=${p.eventScope})`);
    totalEdges += r.edges;
  }
  console.log(`\n[done] 사고 문서 3개 / +${totalEdges} edges`);
}

main().catch(console.error);
