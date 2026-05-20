/**
 * complete-frequency-graph.ts
 *
 * 빈도 우선 순서로 모든 94종 법정문서 노드를 그래프 완전체로 보강.
 *
 * 보강 항목 (모두 IRI 참조, dangling 0 보장):
 *   - hasHazard       : 작업·문서가 다루는 위험요인 (hazards 디렉토리 실존만)
 *   - mitigatedBy     : 위험에 대한 통제수단 (controls 디렉토리 실존만)
 *   - relatedDocs     : 라이프사이클 연계 문서 (마스터 SSoT 실존 docId만)
 *   - guidedBy        : KOSHA Guide 등 외부 가이드 IRI (해당 시)
 *
 * 매핑 룰: 빈도(F1~F6) 그룹별로 docId 단위 정의.
 * 사용: npx tsx scripts/ontology/complete-frequency-graph.ts [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/documents");
const HAZARDS_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/hazards");
const CONTROLS_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/controls");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");

const validHazards = new Set<string>();
for (const f of readdirSync(HAZARDS_DIR)) {
  if (f.endsWith(".jsonld")) validHazards.add(`hazard:${f.replace(".jsonld", "")}`);
}
const validControls = new Set<string>();
for (const f of readdirSync(CONTROLS_DIR)) {
  if (f.endsWith(".jsonld")) validControls.add(`control:${f.replace(".jsonld", "")}`);
}
// docId → 실제 @id 매핑 (verify-graph-integrity 가 @id 기반 매칭하므로 정확한 IRI 필요)
const docIdToIri = new Map<string, string>();
for (const f of readdirSync(NODES_DIR)) {
  if (f.endsWith(".jsonld")) {
    try {
      const n = JSON.parse(readFileSync(join(NODES_DIR, f), "utf8"));
      if (n.docId && n["@id"]) docIdToIri.set(n.docId, n["@id"]);
    } catch {}
  }
}
const validDocs = new Set(docIdToIri.keys());

interface Mapping {
  hasHazard?: string[];
  mitigatedBy?: string[];
  relatedDocs?: string[]; // docId 배열 (실제 적용 시 doc:* IRI 또는 docId 그대로)
}

// === F1 매일 9종 ===
const F1_DAILY: Record<string, Mapping> = {
  daily_tbm: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by", "hazard:trip_slip"],
    mitigatedBy: ["control:admin_safety_education", "control:admin_supervisor"],
    relatedDocs: ["pre_work_inspection", "work_start_pre_check", "monthly_risk_assessment"],
  },
  pre_work_inspection: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by", "hazard:caught_in"],
    mitigatedBy: ["control:admin_inspection", "control:admin_supervisor"],
    relatedDocs: ["work_start_pre_check", "daily_tbm", "construction_machinery_inspection"],
  },
  work_start_pre_check: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by"],
    mitigatedBy: ["control:admin_inspection"],
    relatedDocs: ["pre_work_inspection", "daily_tbm"],
  },
  construction_machinery_inspection: {
    hasHazard: ["hazard:struck_by", "hazard:caught_in", "hazard:crushing"],
    mitigatedBy: ["control:admin_inspection", "control:eng_machine_guard"],
    relatedDocs: ["safety_inspection_application", "tower_crane_inspection"],
  },
  fall_prevention_net_inspection: {
    hasHazard: ["hazard:fall_from_height", "hazard:falling_object"],
    mitigatedBy: ["control:eng_fall_net", "control:admin_inspection"],
    relatedDocs: ["safety_harness_inspection", "scaffolding_inspection_checklist", "work_permit_high_altitude"],
  },
  temporary_electric_inspection: {
    hasHazard: ["hazard:electrocution", "hazard:electric_shock", "hazard:fire_explosion"],
    mitigatedBy: ["control:eng_loto", "control:eng_insulation", "control:admin_inspection", "control:ppe_insulating_gloves"],
    relatedDocs: ["work_permit_loto", "work_plan_electric_work"],
  },
  temporary_fire_facility_check: {
    hasHazard: ["hazard:fire_explosion", "hazard:burn"],
    mitigatedBy: ["control:eng_fire_suppression", "control:eng_alarm", "control:admin_inspection"],
    relatedDocs: ["work_permit_hot_work", "evacuation_drill_record", "emergency_response_manual"],
  },
  excavation_daily_check: {
    hasHazard: ["hazard:cave_in", "hazard:buried_alive", "hazard:struck_by", "hazard:falling_object"],
    mitigatedBy: ["control:admin_inspection", "control:eng_shoring", "control:admin_supervisor"],
    relatedDocs: ["work_plan_excavation", "pre_work_inspection"],
  },
  hazard_chemical_workplace_log: {
    hasHazard: ["hazard:chemical_exposure", "hazard:chemical_burn", "hazard:acute_toxic_gas", "hazard:dust"],
    mitigatedBy: ["control:admin_msds", "control:ppe_chemical_suit", "control:ppe_respirator", "control:eng_ventilation"],
    relatedDocs: ["msds_register", "msds_education_log", "work_environment_measurement"],
  },
};

// === F2 매월 7종 ===
const F2_MONTHLY: Record<string, Mapping> = {
  supervisor_monthly_log: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by"],
    mitigatedBy: ["control:admin_supervisor", "control:admin_inspection", "control:admin_safety_education"],
    relatedDocs: ["supervisor_education_log", "daily_tbm", "monthly_risk_assessment"],
  },
  monthly_education_log: {
    relatedDocs: ["new_hire_education_log", "work_change_education_log", "supervisor_education_log", "special_education_log"],
  },
  contractor_safety_council: {
    mitigatedBy: ["control:admin_supervisor", "control:admin_inspection"],
    relatedDocs: ["contractor_consultative_body", "weekly_joint_inspection", "contract_safety_health_clause"],
  },
  ppe_register: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by", "hazard:electric_shock", "hazard:chemical_exposure", "hazard:noise"],
    relatedDocs: ["safety_harness_inspection", "monthly_education_log"],
  },
  noise_dust_protection_log: {
    hasHazard: ["hazard:noise", "hazard:dust", "hazard:vibration_exposure"],
    mitigatedBy: ["control:ppe_hearing_protection", "control:ppe_respirator", "control:eng_ventilation", "control:eng_noise_barrier"],
    relatedDocs: ["work_environment_measurement", "health_examination_records"],
  },
  safety_signage_register: {
    mitigatedBy: ["control:admin_inspection", "control:admin_safety_education"],
    relatedDocs: ["pre_work_inspection", "monthly_education_log"],
  },
};

// === F3 분기·반기·매주 ===
const F3_QUARTER_BIANNUAL: Record<string, Mapping> = {
  safety_health_committee: {
    mitigatedBy: ["control:admin_supervisor", "control:admin_safety_education"],
    relatedDocs: ["safety_health_management_policy", "contractor_safety_council", "monthly_risk_assessment"],
  },
  construction_safety_inspection_record: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by", "hazard:cave_in"],
    mitigatedBy: ["control:admin_inspection"],
    relatedDocs: ["construction_safety_management_plan", "regular_risk_assessment"],
  },
  evacuation_drill_record: {
    hasHazard: ["hazard:fire_explosion", "hazard:asphyxiation"],
    mitigatedBy: ["control:admin_emergency_plan", "control:eng_fire_suppression", "control:eng_alarm"],
    relatedDocs: ["emergency_response_manual", "temporary_fire_facility_check", "first_aid_training_log"],
  },
  work_environment_measurement: {
    relatedDocs: ["work_environment_measurement_notification", "health_examination_records", "noise_dust_protection_log"],
  },
  work_environment_measurement_notification: {
    relatedDocs: ["work_environment_measurement", "msds_register"],
  },
  scaffolding_inspection_checklist: {
    relatedDocs: ["scaffolding_assembly_check", "fall_prevention_net_inspection", "work_permit_high_altitude"],
  },
};

// === F4 연 5종 + 작업단위 14종 ===
const F4_ANNUAL_WORK_UNIT: Record<string, Mapping> = {
  // 연
  regular_risk_assessment: {
    relatedDocs: ["initial_risk_assessment", "monthly_risk_assessment", "ad_hoc_risk_assessment", "risk_assessment_procedure"],
  },
  supervisor_education_log: {
    relatedDocs: ["supervisor_monthly_log", "monthly_education_log"],
  },
  msds_education_log: {
    hasHazard: ["hazard:chemical_exposure", "hazard:chemical_burn"],
    mitigatedBy: ["control:admin_msds", "control:admin_safety_education", "control:ppe_chemical_suit", "control:ppe_respirator"],
    relatedDocs: ["msds_register", "hazard_chemical_workplace_log"],
  },
  first_aid_training_log: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by", "hazard:electrocution", "hazard:burn"],
    mitigatedBy: ["control:admin_emergency_plan", "control:admin_safety_education"],
    relatedDocs: ["evacuation_drill_record", "emergency_response_manual"],
  },
  severe_accident_compliance: {
    relatedDocs: ["industrial_accident_report", "severe_accident_immediate_report", "ad_hoc_risk_assessment"],
  },
  // 작업단위 — 작업허가서·작업계획서 상호 참조 강화
  work_plan_excavation: { relatedDocs: ["excavation_daily_check", "construction_safety_inspection_record"] },
  work_plan_demolition: { relatedDocs: ["asbestos_investigation_report"] },
  work_plan_tower_crane: { relatedDocs: ["tower_crane_inspection", "work_permit_heavy_lifting"] },
  work_plan_heavy_lifting: { relatedDocs: ["work_permit_heavy_lifting", "tower_crane_inspection"] },
  work_plan_electric_work: { relatedDocs: ["work_permit_loto", "temporary_electric_inspection"] },
  work_plan_tunnel: { relatedDocs: ["work_permit_confined_space"] },
  work_plan_bridge: { relatedDocs: ["work_permit_high_altitude", "fall_prevention_net_inspection"] },
  work_permit_hot_work: { relatedDocs: ["temporary_fire_facility_check", "msds_register"] },
  work_permit_confined_space: { relatedDocs: ["confined_space_program", "work_environment_measurement"] },
  work_permit_high_altitude: { relatedDocs: ["fall_prevention_net_inspection", "safety_harness_inspection", "scaffolding_inspection_checklist"] },
  work_permit_heavy_lifting: { relatedDocs: ["work_plan_heavy_lifting", "tower_crane_inspection", "work_plan_tower_crane"] },
  work_permit_loto: { relatedDocs: ["work_plan_electric_work", "temporary_electric_inspection"] },
};

// === F5 현장개설 14종 ===
const F5_OPENING: Record<string, Mapping> = {
  safety_health_management_policy: {
    relatedDocs: ["safety_health_regulation", "health_safety_committee", "safety_health_manager_appointment", "severe_accident_compliance"],
  },
  safety_health_regulation: {
    relatedDocs: ["safety_health_management_policy", "health_safety_committee", "risk_assessment_procedure"],
  },
  construction_safety_health_register: {
    relatedDocs: ["construction_safety_management_plan", "basic_safety_health_register", "design_safety_health_register"],
  },
  legal_summary_posting: {
    mitigatedBy: ["control:admin_safety_education"],
    relatedDocs: ["monthly_education_log", "safety_health_management_policy"],
  },
  safety_health_information_provision: {
    relatedDocs: ["contract_safety_health_clause", "safety_health_regulation", "msds_register"],
  },
  health_safety_committee: {
    relatedDocs: ["safety_health_committee", "safety_health_management_policy"],
  },
  risk_assessment_procedure: {
    relatedDocs: ["regular_risk_assessment", "monthly_risk_assessment", "ad_hoc_risk_assessment", "initial_risk_assessment", "daily_tbm"],
  },
  safety_health_education_material_log: {
    relatedDocs: ["monthly_education_log", "new_hire_education_log", "supervisor_education_log"],
  },
  rest_facility_register: {
    hasHazard: ["hazard:ergonomic_overload", "hazard:heat_stress", "hazard:cold_stress"],
    mitigatedBy: ["control:admin_supervisor"],
    relatedDocs: ["welfare_facility_register"],
  },
  welfare_facility_register: {
    relatedDocs: ["rest_facility_register", "health_examination_records"],
  },
  construction_safety_management_plan: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by", "hazard:cave_in"],
    mitigatedBy: ["control:admin_inspection", "control:admin_emergency_plan"],
    relatedDocs: ["construction_safety_inspection_record", "construction_safety_health_register"],
  },
  contract_safety_health_clause: {
    mitigatedBy: ["control:admin_supervisor"],
    relatedDocs: ["contractor_safety_council", "contractor_consultative_body", "weekly_joint_inspection"],
  },
  emergency_response_manual: {
    hasHazard: ["hazard:fire_explosion", "hazard:asphyxiation", "hazard:electrocution"],
    mitigatedBy: ["control:admin_emergency_plan", "control:eng_fire_suppression", "control:eng_alarm", "control:admin_safety_education"],
    relatedDocs: ["evacuation_drill_record", "first_aid_training_log", "temporary_fire_facility_check"],
  },
  confined_space_program: {
    relatedDocs: ["work_permit_confined_space", "work_environment_measurement"],
  },
};

// === F6 트리거형 22종 ===
const F6_TRIGGER: Record<string, Mapping> = {
  // 선임시 7종
  safety_health_manager_appointment: { relatedDocs: ["safety_health_management_policy", "supervisor_education_log"] },
  safety_health_management_assistant_appointment: { relatedDocs: ["safety_health_manager_appointment"] },
  industrial_physician_appointment: { relatedDocs: ["health_examination_records", "health_examination_followup"] },
  honorary_safety_supervisor_appointment: {
    mitigatedBy: ["control:admin_supervisor"],
    relatedDocs: ["safety_health_committee"],
  },
  safety_health_total_responsible_appointment: {
    mitigatedBy: ["control:admin_supervisor"],
    relatedDocs: ["contract_safety_health_clause", "contractor_safety_council"],
  },
  safety_health_coordinator_appointment: {
    mitigatedBy: ["control:admin_supervisor"],
    relatedDocs: ["safety_health_total_responsible_appointment"],
  },
  signaler_appointment: {
    hasHazard: ["hazard:struck_by", "hazard:caught_in"],
    mitigatedBy: ["control:admin_signal_person"],
    relatedDocs: ["work_plan_heavy_lifting", "tower_crane_inspection"],
  },

  // 설계·발주
  design_safety_health_register: {
    relatedDocs: ["construction_safety_health_register", "basic_safety_health_register"],
  },
  basic_safety_health_register: {
    relatedDocs: ["design_safety_health_register", "construction_safety_health_register"],
  },

  // 위험성평가 트리거
  initial_risk_assessment: {
    relatedDocs: ["regular_risk_assessment", "ad_hoc_risk_assessment", "risk_assessment_procedure"],
  },
  ad_hoc_risk_assessment: {
    relatedDocs: ["initial_risk_assessment", "regular_risk_assessment", "monthly_risk_assessment", "industrial_accident_report"],
  },

  // 수시
  worker_complaint_log: {
    mitigatedBy: ["control:admin_supervisor"],
    relatedDocs: ["ad_hoc_risk_assessment", "daily_tbm"],
  },
  contractor_consultative_body: {
    mitigatedBy: ["control:admin_supervisor"],
    relatedDocs: ["contractor_safety_council", "weekly_joint_inspection"],
  },
  voluntary_inspection_program: { relatedDocs: ["safety_inspection_application"] },
  msds_register: { relatedDocs: ["msds_education_log", "hazard_chemical_workplace_log", "work_environment_measurement"] },

  // 채용·작업변경·특수
  new_hire_education_log: { relatedDocs: ["monthly_education_log", "supervisor_education_log"] },
  work_change_education_log: { relatedDocs: ["monthly_education_log", "ad_hoc_risk_assessment"] },
  special_education_log: { relatedDocs: ["monthly_education_log", "work_permit_hot_work", "work_permit_confined_space"] },

  // 사고
  industrial_accident_report: {
    relatedDocs: ["severe_accident_immediate_report", "severe_accident_compliance", "ad_hoc_risk_assessment"],
  },
  severe_accident_immediate_report: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by", "hazard:electrocution", "hazard:fire_explosion", "hazard:asphyxiation"],
    mitigatedBy: ["control:admin_emergency_plan"],
    relatedDocs: ["industrial_accident_report", "severe_accident_compliance", "work_stop_order_report"],
  },
  work_stop_order_report: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by"],
    mitigatedBy: ["control:admin_emergency_plan", "control:admin_inspection"],
    relatedDocs: ["industrial_accident_report", "ad_hoc_risk_assessment"],
  },

  // 진단·인증·계획
  safety_health_diagnosis_report: {
    mitigatedBy: ["control:admin_inspection", "control:admin_risk_assessment"],
    relatedDocs: ["safety_health_improvement_plan", "regular_risk_assessment"],
  },
  safety_health_improvement_plan: {
    relatedDocs: ["safety_health_diagnosis_report", "regular_risk_assessment"],
  },
  hazardous_risk_prevention_plan_construction: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by", "hazard:cave_in", "hazard:electrocution"],
    mitigatedBy: ["control:admin_inspection", "control:admin_risk_assessment", "control:admin_emergency_plan"],
    relatedDocs: ["construction_safety_management_plan", "regular_risk_assessment"],
  },
  safety_certification_application: {
    relatedDocs: ["safety_inspection_application", "voluntary_safety_confirmation_filing", "construction_machinery_inspection"],
  },
  voluntary_safety_confirmation_filing: {
    relatedDocs: ["safety_certification_application", "safety_inspection_application"],
  },
  safety_inspection_application: {
    relatedDocs: ["voluntary_inspection_program", "construction_machinery_inspection", "safety_certification_application"],
  },

  // 조립·타설
  scaffolding_assembly_check: {
    hasHazard: ["hazard:fall_from_height", "hazard:falling_object"],
    mitigatedBy: ["control:eng_scaffold", "control:admin_inspection", "control:eng_fall_net"],
    relatedDocs: ["scaffolding_inspection_checklist", "fall_prevention_net_inspection"],
  },
  formwork_shoring_check: {
    hasHazard: ["hazard:fall_from_height", "hazard:falling_object", "hazard:cave_in"],
    mitigatedBy: ["control:eng_shoring", "control:admin_inspection"],
    relatedDocs: ["work_plan_excavation", "construction_safety_inspection_record"],
  },

  // 해체전·특수진단후
  asbestos_investigation_report: {
    relatedDocs: ["work_plan_demolition", "msds_register"],
  },
  health_examination_followup: {
    relatedDocs: ["health_examination_records", "industrial_physician_appointment"],
  },

  // 안전관리비
  safety_health_mgmt_cost_plan: {
    mitigatedBy: ["control:admin_inspection"],
    relatedDocs: ["construction_safety_management_plan"],
  },

  // 안전책임자 일지
  safety_responsible_log: {
    mitigatedBy: ["control:admin_supervisor", "control:admin_inspection"],
    relatedDocs: ["supervisor_monthly_log", "construction_safety_inspection_record"],
  },
  // 매월 정산 비용 — F2와 중복 회피 위해 여기서는 제외

  // 매주 합동점검 (건설 2일1회 / 기타 분기)
  weekly_joint_inspection: {
    mitigatedBy: ["control:admin_supervisor", "control:admin_inspection"],
    relatedDocs: ["contractor_safety_council", "contract_safety_health_clause"],
  },
  contractor_round_inspection_log: {
    mitigatedBy: ["control:admin_supervisor", "control:admin_inspection"],
    relatedDocs: ["contractor_safety_council", "weekly_joint_inspection"],
  },

  // 건설재해예방
  construction_disaster_prevention_guidance: {
    hasHazard: ["hazard:fall_from_height", "hazard:struck_by", "hazard:cave_in"],
    mitigatedBy: ["control:admin_supervisor", "control:admin_inspection", "control:admin_risk_assessment"],
    relatedDocs: ["construction_safety_inspection_record", "regular_risk_assessment"],
  },
};

const ALL_MAPPINGS: Record<string, Mapping> = {
  ...F1_DAILY,
  ...F2_MONTHLY,
  ...F3_QUARTER_BIANNUAL,
  ...F4_ANNUAL_WORK_UNIT,
  ...F5_OPENING,
  ...F6_TRIGGER,
};

interface Stats {
  processed: number;
  enriched: number;
  hazardAdded: number;
  controlAdded: number;
  relatedAdded: number;
  invalidHazards: string[];
  invalidControls: string[];
  invalidRelated: string[];
}

function unionMerge(existing: unknown, additions: string[]): { merged: string[]; added: number } {
  const arr = Array.isArray(existing) ? (existing as string[]) : [];
  const set = new Set([...arr, ...additions]);
  return { merged: Array.from(set), added: set.size - arr.length };
}

function main(): void {
  const stats: Stats = {
    processed: 0,
    enriched: 0,
    hazardAdded: 0,
    controlAdded: 0,
    relatedAdded: 0,
    invalidHazards: [],
    invalidControls: [],
    invalidRelated: [],
  };

  for (const fname of readdirSync(NODES_DIR)) {
    if (!fname.endsWith(".jsonld")) continue;
    const file = join(NODES_DIR, fname);
    let node: any;
    try {
      node = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    stats.processed++;
    const docId = node.docId;
    const map = ALL_MAPPINGS[docId];
    if (!map) continue;

    let changed = false;

    if (map.hasHazard) {
      const valid = map.hasHazard.filter((h) => {
        if (!validHazards.has(h)) {
          stats.invalidHazards.push(`${docId} → ${h}`);
          return false;
        }
        return true;
      });
      const r = unionMerge(node.hasHazard, valid);
      if (r.added > 0) {
        node.hasHazard = r.merged;
        stats.hazardAdded += r.added;
        changed = true;
      }
    }

    if (map.mitigatedBy) {
      const valid = map.mitigatedBy.filter((c) => {
        if (!validControls.has(c)) {
          stats.invalidControls.push(`${docId} → ${c}`);
          return false;
        }
        return true;
      });
      const r = unionMerge(node.mitigatedBy, valid);
      if (r.added > 0) {
        node.mitigatedBy = r.merged;
        stats.controlAdded += r.added;
        changed = true;
      }
    }

    if (map.relatedDocs) {
      // 기존 relatedDocs 중 dangling 정리 (이전 실행에서 잘못된 doc:{docId} 형식 추가됨)
      const validIriSet = new Set(docIdToIri.values());
      if (Array.isArray(node.relatedDocs)) {
        const cleaned = (node.relatedDocs as string[]).filter((iri) => validIriSet.has(iri));
        if (cleaned.length !== node.relatedDocs.length) {
          node.relatedDocs = cleaned;
          changed = true;
        }
      }
      const valid: string[] = [];
      for (const rd of map.relatedDocs) {
        const iri = docIdToIri.get(rd);
        if (!iri) {
          stats.invalidRelated.push(`${docId} → ${rd}`);
          continue;
        }
        valid.push(iri);
      }
      const r = unionMerge(node.relatedDocs, valid);
      if (r.added > 0) {
        node.relatedDocs = r.merged;
        stats.relatedAdded += r.added;
        changed = true;
      }
    }

    if (changed && !DRY) {
      writeFileSync(file, JSON.stringify(node, null, 2) + "\n", "utf8");
      stats.enriched++;
    }
  }

  console.log(`=== 빈도 우선 그래프 완전체 보강 ${DRY ? "(DRY RUN)" : ""} ===`);
  console.log(`처리: ${stats.processed} 노드`);
  console.log(`매핑 정의: ${Object.keys(ALL_MAPPINGS).length} docId`);
  console.log(`보강된 노드: ${stats.enriched}`);
  console.log(`hasHazard 추가: ${stats.hazardAdded}`);
  console.log(`mitigatedBy 추가: ${stats.controlAdded}`);
  console.log(`relatedDocs 추가: ${stats.relatedAdded}`);
  if (stats.invalidHazards.length > 0) {
    console.log(`\n⚠️ 잘못된 hazard IRI ${stats.invalidHazards.length}건:`);
    for (const x of stats.invalidHazards.slice(0, 5)) console.log(`  ${x}`);
  }
  if (stats.invalidControls.length > 0) {
    console.log(`\n⚠️ 잘못된 control IRI ${stats.invalidControls.length}건:`);
    for (const x of stats.invalidControls.slice(0, 5)) console.log(`  ${x}`);
  }
  if (stats.invalidRelated.length > 0) {
    console.log(`\n⚠️ 잘못된 relatedDocs ${stats.invalidRelated.length}건:`);
    for (const x of stats.invalidRelated.slice(0, 5)) console.log(`  ${x}`);
  }
}

main();
