/**
 * enrich-doc-hazard-refs.ts
 *
 * Document 노드의 hasHazard 배열에 hazard IRI 일괄 추가.
 * 작업허가/작업계획 문서가 해당 작업의 hazard 노드를 명시적 참조하도록 그래프 강화.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/documents");
const HAZARDS_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/hazards");

const validHazards = new Set<string>();
for (const f of readdirSync(HAZARDS_DIR)) {
  if (f.endsWith(".jsonld")) validHazards.add(`hazard:${f.replace(".jsonld", "")}`);
}

const DOC_TO_HAZARDS: Record<string, string[]> = {
  // 작업허가서 — 각 작업의 핵심 위험
  work_permit_hot_work: ["hazard:fire_explosion", "hazard:burn", "hazard:thermal_burn", "hazard:electric_shock"],
  work_permit_confined_space: ["hazard:asphyxiation", "hazard:acute_toxic_gas", "hazard:gas_leak", "hazard:fire_explosion"],
  work_permit_high_altitude: ["hazard:fall_from_height", "hazard:falling_object"],
  work_permit_heavy_lifting: ["hazard:struck_by", "hazard:caught_in", "hazard:crushing", "hazard:falling_object"],
  work_permit_loto: ["hazard:electrocution", "hazard:caught_in", "hazard:machine_entanglement"],
  confined_space_program: ["hazard:asphyxiation", "hazard:acute_toxic_gas", "hazard:gas_leak"],

  // 작업계획서 — 공종별 위험
  work_plan_excavation: ["hazard:cave_in", "hazard:buried_alive", "hazard:struck_by", "hazard:falling_object"],
  work_plan_demolition: ["hazard:falling_object", "hazard:struck_by", "hazard:dust", "hazard:noise"],
  work_plan_tower_crane: ["hazard:falling_object", "hazard:struck_by", "hazard:fall_from_height"],
  work_plan_heavy_lifting: ["hazard:struck_by", "hazard:crushing", "hazard:falling_object"],
  work_plan_vehicle_construction: ["hazard:struck_by", "hazard:traffic_accident", "hazard:struck_by_overturn"],
  work_plan_vehicle_cargo: ["hazard:struck_by", "hazard:falling_object", "hazard:traffic_accident"],
  work_plan_electric_work: ["hazard:electrocution", "hazard:electric_shock", "hazard:fire_explosion"],
  work_plan_tunnel: ["hazard:cave_in", "hazard:asphyxiation", "hazard:dust", "hazard:noise"],
  work_plan_bridge: ["hazard:fall_from_height", "hazard:falling_object", "hazard:struck_by"],

  // 점검·인증
  scaffolding_inspection_checklist: ["hazard:fall_from_height", "hazard:falling_object"],
  fall_prevention_net_inspection: ["hazard:fall_from_height", "hazard:falling_object"],
  safety_harness_inspection: ["hazard:fall_from_height"],
  temporary_electric_inspection: ["hazard:electrocution", "hazard:electric_shock", "hazard:fire_explosion"],
  temporary_fire_facility_check: ["hazard:fire_explosion", "hazard:burn"],
  tower_crane_inspection: ["hazard:falling_object", "hazard:struck_by", "hazard:crushing"],
  construction_machinery_inspection: ["hazard:struck_by", "hazard:caught_in", "hazard:crushing"],

  // MSDS·화학
  msds_register: ["hazard:chemical_exposure", "hazard:chemical_burn", "hazard:acute_toxic_gas", "hazard:fire_explosion"],

  // 측정·건강
  work_environment_measurement: ["hazard:dust", "hazard:noise", "hazard:chemical_exposure", "hazard:vibration_exposure"],
  work_environment_measurement_notification: ["hazard:dust", "hazard:noise", "hazard:chemical_exposure"],
  health_examination_records: ["hazard:chemical_exposure", "hazard:dust", "hazard:noise", "hazard:radiation_exposure", "hazard:vibration_exposure", "hazard:msd_repetitive"],
  health_examination_followup: ["hazard:chemical_exposure", "hazard:dust", "hazard:noise"],

  // 위험성평가
  initial_risk_assessment: ["hazard:fall_from_height", "hazard:struck_by", "hazard:electric_shock", "hazard:caught_in"],
  regular_risk_assessment: ["hazard:fall_from_height", "hazard:struck_by"],
  ad_hoc_risk_assessment: ["hazard:fall_from_height", "hazard:struck_by", "hazard:fire_explosion"],
  monthly_risk_assessment: ["hazard:fall_from_height", "hazard:struck_by"],
  daily_tbm: ["hazard:fall_from_height", "hazard:struck_by", "hazard:trip_slip"],

  // 사고
  industrial_accident_report: ["hazard:fall_from_height", "hazard:struck_by", "hazard:electrocution", "hazard:caught_in", "hazard:falling_object"],
  severe_accident_immediate_report: ["hazard:fall_from_height", "hazard:struck_by", "hazard:electrocution", "hazard:fire_explosion", "hazard:asphyxiation"],

  // 환경·기상
  asbestos_investigation_report: ["hazard:dust", "hazard:chemical_exposure"],
};

interface Stats {
  processed: number;
  enriched: number;
  totalRefsAdded: number;
  dangling: string[];
}

function main(): void {
  const stats: Stats = { processed: 0, enriched: 0, totalRefsAdded: 0, dangling: [] };

  for (const fname of readdirSync(NODES_DIR)) {
    if (!fname.endsWith(".jsonld")) continue;
    const file = join(NODES_DIR, fname);
    let node: any;
    try { node = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    stats.processed++;
    const docId = node.docId;
    const desired = DOC_TO_HAZARDS[docId];
    if (!desired || desired.length === 0) continue;

    const validRefs = desired.filter((h) => {
      if (!validHazards.has(h)) {
        stats.dangling.push(`${docId} → ${h}`);
        return false;
      }
      return true;
    });
    if (validRefs.length === 0) continue;

    const existing = Array.isArray(node.hasHazard) ? node.hasHazard : [];
    const merged = Array.from(new Set([...existing, ...validRefs]));
    if (merged.length === existing.length) continue;

    node.hasHazard = merged;
    writeFileSync(file, JSON.stringify(node, null, 2) + "\n", "utf8");
    stats.enriched++;
    stats.totalRefsAdded += merged.length - existing.length;
  }

  console.log("=== Document → Hazard 참조 확대 ===");
  console.log(JSON.stringify(stats, null, 2));
}

main();
