#!/usr/bin/env tsx
/**
 * add-applies-to-activities.ts
 *
 * 의무문서 70개 → 적용 활동 IRI 매핑 (appliesToActivities).
 *
 * 본질: "활동 → 의무문서" 역방향 traversal 활성화.
 * 기존 applicableWhen.workType은 plain text라 그래프 traversal 불가.
 * appliesToActivities는 IRI 참조라 traversal 가능.
 *
 * 매핑 정책:
 *   1. work-plan-{X}        → activity:{X}        (1:1, 9개)
 *   2. work-permit-{X}      → 1:N 활동 매핑
 *   3. 시공 도면            → 해당 작업 활동
 *   4. 점검표               → 해당 작업/장비 활동
 *   5. 일반 안전관리 문서    → activity:risk_assessment_general / safety_education / general_workplace_safety
 *   6. 행정/관리체계 문서    → activity:general_workplace_safety (모든 사업장)
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

// docId → 적용 활동 IRI 리스트
const MAPPING: Record<string, string[]> = {
  // ── 작업계획서 9개 (1:1) ──
  work_plan_bridge:                ["activity:bridge_5m_30m"],
  work_plan_demolition:            ["activity:demolition"],
  work_plan_electric_work:         ["activity:electric_work_50v_plus"],
  work_plan_excavation:            ["activity:excavation_2m_plus"],
  work_plan_heavy_lifting:         ["activity:heavy_lifting"],
  work_plan_tower_crane:           ["activity:tower_crane"],
  work_plan_tunnel:                ["activity:tunnel_excavation"],
  work_plan_vehicle_cargo:         ["activity:vehicle_cargo"],
  work_plan_vehicle_construction:  ["activity:vehicle_construction"],
  // 작업계획서 통합 wrap
  work_plan: [
    "activity:bridge_5m_30m", "activity:demolition", "activity:electric_work_50v_plus",
    "activity:excavation_2m_plus", "activity:heavy_lifting", "activity:tower_crane",
    "activity:tunnel_excavation", "activity:vehicle_cargo", "activity:vehicle_construction",
  ],

  // ── 작업허가서 5개 ──
  work_permit_confined_space: ["activity:underground_utility", "activity:tunnel_excavation", "activity:drainage_sewerage"],
  work_permit_heavy_lifting:  ["activity:heavy_lifting", "activity:tower_crane"],
  work_permit_high_altitude:  ["activity:scaffolding_assembly", "activity:formwork_shoring", "activity:finishing_paint", "activity:finishing_tile"],
  work_permit_hot_work:       ["activity:steel_structure"],
  work_permit_loto:           ["activity:electric_work_50v_plus"],
  // 작업허가서 통합 wrap
  work_permit: [
    "activity:underground_utility", "activity:tunnel_excavation", "activity:steel_structure",
    "activity:electric_work_50v_plus", "activity:heavy_lifting", "activity:scaffolding_assembly",
  ],

  // ── 시공 도면·계획서 ──
  earth_retaining_drawing:  ["activity:excavation_2m_plus"],
  formwork_shoring_drawing: ["activity:formwork_shoring", "activity:rc_concrete"],
  concrete_placement_plan:  ["activity:rc_concrete"],
  aerial_work_platform_plan:["activity:scaffolding_assembly", "activity:finishing_paint", "activity:finishing_tile", "activity:steel_structure"],

  // ── 점검표 ──
  scaffolding_inspection_checklist: ["activity:scaffolding_assembly"],
  fall_prevention_net_inspection:   ["activity:scaffolding_assembly", "activity:steel_structure", "activity:rc_concrete", "activity:formwork_shoring"],
  safety_harness_inspection:        ["activity:scaffolding_assembly", "activity:steel_structure", "activity:formwork_shoring", "activity:rc_concrete", "activity:finishing_paint", "activity:finishing_tile"],
  tower_crane_inspection:           ["activity:tower_crane"],
  construction_machinery_inspection:["activity:vehicle_construction", "activity:vehicle_cargo", "activity:earthwork_landfill"],
  temporary_electric_inspection:    ["activity:electric_work_50v_plus", "activity:general_workplace_safety"],
  temporary_fire_facility_check:    ["activity:general_workplace_safety"],
  pre_work_inspection:              ["activity:general_workplace_safety", "activity:risk_assessment_general"],
  weekly_joint_inspection:          ["activity:general_workplace_safety", "activity:risk_assessment_general"],

  // ── 위험성평가 시리즈 (모든 활동 적용) ──
  risk_assessment_procedure: ["activity:risk_assessment_general"],
  initial_risk_assessment:   ["activity:risk_assessment_general"],
  regular_risk_assessment:   ["activity:risk_assessment_general"],
  monthly_risk_assessment:   ["activity:risk_assessment_general"],
  ad_hoc_risk_assessment:    ["activity:risk_assessment_general"],

  // ── 교육·TBM ──
  daily_tbm:               ["activity:tbm_daily", "activity:safety_education"],
  monthly_education_log:   ["activity:safety_education"],
  supervisor_education_log:["activity:safety_education"],

  // ── MSDS·보호구·표지 ──
  msds_register:           ["activity:general_workplace_safety", "activity:finishing_paint"],
  ppe_register:            ["activity:general_workplace_safety", "activity:risk_assessment_general"],
  safety_signage_register: ["activity:general_workplace_safety"],

  // ── 건강진단·작업환경측정 ──
  health_examination_records:               ["activity:general_workplace_safety", "activity:asbestos_removal", "activity:finishing_paint"],
  health_examination_followup:              ["activity:general_workplace_safety", "activity:asbestos_removal"],
  work_environment_measurement:             ["activity:general_workplace_safety", "activity:tunnel_excavation", "activity:asbestos_removal", "activity:finishing_paint"],
  work_environment_measurement_notification:["activity:general_workplace_safety"],

  // ── 안전보건관리체계·중처법 ──
  safety_health_management_policy: ["activity:general_workplace_safety", "activity:risk_assessment_general"],
  safety_health_regulation:        ["activity:general_workplace_safety"],
  severe_accident_compliance:      ["activity:general_workplace_safety", "activity:risk_assessment_general"],

  // ── 발주자 안전보건대장 3종 ──
  basic_safety_health_register:        ["activity:general_workplace_safety"],
  design_safety_health_register:       ["activity:general_workplace_safety"],
  construction_safety_health_register: ["activity:general_workplace_safety", "activity:risk_assessment_general"],

  // ── 사고·재해 ──
  industrial_accident_report:        ["activity:general_workplace_safety", "activity:risk_assessment_general"],
  severe_accident_immediate_report:  ["activity:general_workplace_safety"],

  // ── 도급·협의체 ──
  contractor_consultative_body: ["activity:general_workplace_safety"],
  contractor_safety_council:    ["activity:general_workplace_safety"],
  health_safety_committee:      ["activity:general_workplace_safety"],

  // ── 행정·신고·선임 ──
  safety_health_manager_appointment:           ["activity:general_workplace_safety"],
  safety_health_management_assistant_appointment: ["activity:general_workplace_safety"],
  industrial_physician_appointment:            ["activity:general_workplace_safety"],
  honorary_safety_supervisor_appointment:      ["activity:general_workplace_safety"],
  signaler_appointment:                         ["activity:tower_crane", "activity:vehicle_construction", "activity:heavy_lifting", "activity:vehicle_cargo"],
  safety_health_information_provision:         ["activity:general_workplace_safety"],
  safety_health_diagnosis_report:              ["activity:general_workplace_safety", "activity:risk_assessment_general"],
  safety_health_mgmt_cost_plan:                ["activity:general_workplace_safety"],

  // ── 안전인증·검사·자율안전확인 ──
  safety_certification_application:    ["activity:tower_crane", "activity:heavy_lifting"],
  voluntary_safety_confirmation_filing:["activity:tower_crane", "activity:heavy_lifting"],
  safety_inspection_application:       ["activity:tower_crane", "activity:heavy_lifting"],

  // ── 유해위험방지·건설재해예방 ──
  hazardous_risk_prevention_plan_construction:["activity:general_workplace_safety", "activity:risk_assessment_general"],
  construction_disaster_prevention_guidance:  ["activity:general_workplace_safety", "activity:risk_assessment_general"],

  // ── 석면 ──
  asbestos_investigation_report: ["activity:asbestos_removal", "activity:demolition"],

  // ── 게시·기타 ──
  legal_summary_posting: ["activity:general_workplace_safety"],
};

async function main() {
  let updated = 0;
  let skipped = 0;
  let totalEdges = 0;

  for (const f of await readdir(DOCS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOCS_DIR, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const docId = String(node.docId ?? "");
    const activities = MAPPING[docId];
    if (!activities) {
      skipped += 1;
      continue;
    }
    node.appliesToActivities = activities;
    totalEdges += activities.length;
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    updated += 1;
  }
  console.log(`[done] ${updated} documents updated, ${skipped} skipped`);
  console.log(`       total appliesToActivities edges added: ${totalEdges}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
