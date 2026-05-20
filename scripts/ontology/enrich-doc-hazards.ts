#!/usr/bin/env tsx
/**
 * enrich-doc-hazards.ts
 * 의무문서 노드에 hasHazard 직접 명시 추가 (loadHazards가 활용).
 * Codex 지적: 굴착 작업계획서 위험요소가 "매몰·붕괴" 2개만이고 차량계·추락·매설물·침수·산소결핍 누락.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "documents");

// 의무문서별 위험요인 직접 매핑 (현장 실무 기반 — KOSHA C-22 굴착 가이드 + ILO 표준)
const DOC_HAZARDS: Record<string, string[]> = {
  "work_plan_excavation": [
    "hazard:buried_alive",        // 매몰
    "hazard:cave_in",             // 붕괴 / 흙막이 변위
    "hazard:struck_by",           // 차량계 건설기계 접촉
    "hazard:struck_by_overturn",  // 굴착기 전도·차량 전복
    "hazard:fall_from_height",    // 굴착단부 추락
    "hazard:fall_object",         // 낙하물
    "hazard:gas_leak",            // 매설관 파손 (도시가스·LPG)
    "hazard:drowning",            // 침수 / 지하수 유입
    "hazard:asphyxiation",        // 산소결핍 (밀폐 굴착)
    "hazard:noise_exposure",      // 발파·해머 소음
  ],
  "work_plan_demolition": [
    "hazard:fall_from_height", "hazard:fall_object", "hazard:struck_by", "hazard:cave_in",
    "hazard:dust_exposure", "hazard:chemical_exposure", "hazard:fire_explosion",
  ],
  "work_plan_tower_crane": [
    "hazard:fall_object", "hazard:struck_by", "hazard:struck_by_overturn", "hazard:fall_from_height",
    "hazard:electric_shock",
  ],
  "work_plan_heavy_lifting": [
    "hazard:fall_object", "hazard:struck_by", "hazard:crushing", "hazard:ergonomic_overload",
  ],
  "work_plan_electric_work": [
    "hazard:electric_shock", "hazard:fire_explosion", "hazard:fall_from_height",
  ],
  "work_plan_tunnel": [
    "hazard:cave_in", "hazard:buried_alive", "hazard:asphyxiation", "hazard:gas_leak",
    "hazard:struck_by", "hazard:fire_explosion", "hazard:noise_exposure", "hazard:dust_exposure",
  ],
  "work_plan_bridge": [
    "hazard:fall_from_height", "hazard:drowning", "hazard:fall_object", "hazard:struck_by",
    "hazard:struck_by_overturn",
  ],
  "work_plan_vehicle_cargo": ["hazard:struck_by", "hazard:crushing", "hazard:fall_object"],
  "work_plan_vehicle_construction": ["hazard:struck_by", "hazard:struck_by_overturn", "hazard:crushing"],
  // 작업허가서
  "work_permit": ["hazard:fire_explosion", "hazard:fire", "hazard:thermal_burn", "hazard:dust_exposure"],
  "work_permit_loto": ["hazard:electric_shock", "hazard:machine_entanglement", "hazard:crushing"],
  "work_permit_confined_space": ["hazard:asphyxiation", "hazard:acute_toxic_gas", "hazard:fire_explosion"],
  "work_permit_high_altitude": ["hazard:fall_from_height", "hazard:fall_object"],
  "work_permit_heavy_lifting": ["hazard:fall_object", "hazard:struck_by", "hazard:crushing"],
  "work_permit_hot_work": ["hazard:fire", "hazard:fire_explosion", "hazard:thermal_burn", "hazard:radiation_uv"],
  // 점검표
  "scaffolding_inspection_checklist": ["hazard:fall_from_height", "hazard:fall_object"],
  "fall_prevention_net_inspection": ["hazard:fall_from_height", "hazard:fall_object"],
  "safety_harness_inspection": ["hazard:fall_from_height"],
  "tower_crane_inspection": ["hazard:fall_object", "hazard:struck_by", "hazard:struck_by_overturn"],
  "construction_machinery_inspection": ["hazard:struck_by", "hazard:struck_by_overturn", "hazard:crushing"],
  "temporary_fire_facility_check": ["hazard:fire", "hazard:fire_explosion", "hazard:thermal_burn"],
  "temporary_electric_inspection": ["hazard:electric_shock", "hazard:fire_explosion"],
  "earth_retaining_drawing": ["hazard:cave_in", "hazard:buried_alive", "hazard:struck_by"],
  "concrete_placement_plan": ["hazard:fall_from_height", "hazard:fall_object", "hazard:chemical_burn", "hazard:ergonomic_overload"],
  "formwork_shoring_drawing": ["hazard:fall_from_height", "hazard:fall_object", "hazard:cave_in"],
  "aerial_work_platform_plan": ["hazard:fall_from_height", "hazard:struck_by_overturn", "hazard:electric_shock"],
};

(async () => {
  let updated = 0, skipped = 0;
  for (const f of await readdir(DOCS)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOCS, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const docId = String(node.docId ?? "");
    const hazards = DOC_HAZARDS[docId];
    if (!hazards) { skipped++; continue; }
    node.hasHazard = hazards;
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    updated++;
  }
  console.log(`✅ ${updated} doc 노드 hasHazard 추가 (${skipped} skip)`);
})();
