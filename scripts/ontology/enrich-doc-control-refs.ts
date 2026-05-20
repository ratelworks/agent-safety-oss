/**
 * enrich-doc-control-refs.ts
 *
 * Document 노드의 mitigatedBy / requires 배열에 control IRI 일괄 추가.
 * 위험성평가/작업허가/작업계획 문서가 통제수단 노드를 명시적 참조하도록 그래프 강화.
 *
 * 룰:
 *   - work_permit_hot_work    → 화기작업 통제 (eng_fire_suppression, ppe_chemical_suit, admin_work_permit)
 *   - work_permit_confined_space → 밀폐공간 통제 (eng_ventilation, ppe_respirator, admin_emergency_plan)
 *   - work_permit_high_altitude  → 추락 통제 (ppe_fall_arrester, ppe_harness, eng_fall_net)
 *   - work_permit_heavy_lifting  → 중량물 통제 (eng_machine_guard, admin_signal_person, ppe_helmet)
 *   - work_permit_loto           → LOTO (eng_loto, eng_isolation_barrier, admin_loto)
 *   - work_plan_*                → 일반 통제 + 공종별 추가
 *   - risk_assessment_*          → admin_risk_assessment (필수) + 일반 통제
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/documents");
const CONTROLS_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/controls");

// 실제 존재하는 control IRI 인덱스
const validControls = new Set<string>();
for (const f of readdirSync(CONTROLS_DIR)) {
  if (f.endsWith(".jsonld")) {
    validControls.add(`control:${f.replace(".jsonld", "")}`);
  }
}

const DOC_TO_CONTROLS: Record<string, string[]> = {
  // 위험성평가
  risk_assessment_procedure: ["control:admin_risk_assessment", "control:admin_supervisor"],
  initial_risk_assessment: ["control:admin_risk_assessment", "control:admin_supervisor", "control:admin_safety_education"],
  regular_risk_assessment: ["control:admin_risk_assessment", "control:admin_inspection"],
  monthly_risk_assessment: ["control:admin_risk_assessment"],
  ad_hoc_risk_assessment: ["control:admin_risk_assessment", "control:admin_emergency_plan"],
  daily_tbm: ["control:admin_safety_education", "control:admin_supervisor"],

  // 작업허가서
  work_permit_hot_work: [
    "control:admin_work_permit",
    "control:admin_supervisor",
    "control:eng_fire_suppression",
    "control:eng_alarm",
    "control:ppe_chemical_suit",
  ],
  work_permit_confined_space: [
    "control:admin_work_permit",
    "control:admin_emergency_plan",
    "control:eng_ventilation",
    "control:eng_monitoring",
    "control:ppe_respirator",
  ],
  work_permit_high_altitude: [
    "control:admin_work_permit",
    "control:admin_supervisor",
    "control:eng_fall_net",
    "control:ppe_fall_arrester",
    "control:ppe_harness",
  ],
  work_permit_heavy_lifting: [
    "control:admin_work_permit",
    "control:admin_signal_person",
    "control:eng_machine_guard",
    "control:ppe_helmet",
  ],
  work_permit_loto: ["control:admin_work_permit", "control:eng_loto", "control:eng_isolation_barrier", "control:eng_insulation"],
  confined_space_program: [
    "control:admin_emergency_plan",
    "control:admin_qualification",
    "control:eng_ventilation",
    "control:eng_monitoring",
    "control:ppe_respirator",
  ],

  // 작업계획서
  work_plan_excavation: ["control:admin_work_plan", "control:admin_supervisor", "control:eng_shoring"],
  work_plan_demolition: ["control:admin_work_plan", "control:admin_supervisor", "control:eng_isolation_barrier"],
  work_plan_tower_crane: ["control:admin_work_plan", "control:admin_signal_person", "control:eng_machine_guard"],
  work_plan_heavy_lifting: ["control:admin_work_plan", "control:admin_signal_person", "control:eng_machine_guard", "control:ppe_helmet"],
  work_plan_vehicle_construction: ["control:admin_work_plan", "control:admin_signal_person"],
  work_plan_vehicle_cargo: ["control:admin_work_plan", "control:admin_signal_person"],
  work_plan_electric_work: ["control:admin_work_plan", "control:eng_loto", "control:eng_insulation", "control:ppe_insulating_gloves"],
  work_plan_tunnel: ["control:admin_work_plan", "control:eng_ventilation", "control:eng_monitoring", "control:eng_shoring"],
  work_plan_bridge: ["control:admin_work_plan", "control:eng_fall_net", "control:ppe_fall_arrester"],

  // 점검·일지
  pre_work_inspection: ["control:admin_inspection", "control:admin_supervisor"],
  work_start_pre_check: ["control:admin_inspection"],
  construction_machinery_inspection: ["control:admin_inspection", "control:eng_machine_guard"],
  tower_crane_inspection: ["control:admin_inspection", "control:eng_machine_guard"],
  scaffolding_inspection_checklist: ["control:admin_inspection", "control:eng_scaffold"],
  fall_prevention_net_inspection: ["control:admin_inspection", "control:eng_fall_net"],
  safety_harness_inspection: ["control:admin_inspection", "control:ppe_harness", "control:ppe_fall_arrester"],
  temporary_electric_inspection: ["control:admin_inspection", "control:eng_insulation", "control:eng_loto"],
  temporary_fire_facility_check: ["control:admin_inspection", "control:eng_fire_suppression", "control:eng_alarm"],

  // 보호구·교육·MSDS
  ppe_register: ["control:eric_ppe", "control:ppe_helmet", "control:ppe_harness", "control:ppe_safety_shoes", "control:ppe_eye_protection"],
  monthly_education_log: ["control:admin_safety_education"],
  supervisor_education_log: ["control:admin_safety_education", "control:admin_supervisor"],
  new_hire_education_log: ["control:admin_safety_education"],
  work_change_education_log: ["control:admin_safety_education"],
  special_education_log: ["control:admin_safety_education", "control:admin_qualification"],
  msds_register: ["control:admin_msds", "control:ppe_chemical_suit", "control:ppe_respirator"],

  // 사고 대응
  industrial_accident_report: ["control:admin_emergency_plan"],
  severe_accident_immediate_report: ["control:admin_emergency_plan"],
  severe_accident_compliance: ["control:admin_emergency_plan", "control:admin_risk_assessment"],
};

interface Stats {
  processed: number;
  enriched: number;
  totalRefsAdded: number;
  invalidControls: string[];
}

function main(): void {
  const stats: Stats = { processed: 0, enriched: 0, totalRefsAdded: 0, invalidControls: [] };

  for (const fname of readdirSync(NODES_DIR)) {
    if (!fname.endsWith(".jsonld")) continue;
    const file = join(NODES_DIR, fname);
    let node: any;
    try { node = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    stats.processed++;
    const docId = node.docId;
    const desired = DOC_TO_CONTROLS[docId];
    if (!desired || desired.length === 0) continue;

    // dangling 회피: 실제 존재하는 control 만
    const validRefs = desired.filter((c) => {
      if (!validControls.has(c)) {
        stats.invalidControls.push(`${docId} → ${c}`);
        return false;
      }
      return true;
    });
    if (validRefs.length === 0) continue;

    const existing = Array.isArray(node.mitigatedBy) ? node.mitigatedBy : [];
    const merged = Array.from(new Set([...existing, ...validRefs]));
    if (merged.length === existing.length) continue; // no change

    node.mitigatedBy = merged;
    writeFileSync(file, JSON.stringify(node, null, 2) + "\n", "utf8");
    stats.enriched++;
    stats.totalRefsAdded += merged.length - existing.length;
  }

  console.log("=== Document → Control 참조 보강 ===");
  console.log(JSON.stringify(stats, null, 2));
}

main();
