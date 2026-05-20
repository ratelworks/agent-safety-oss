#!/usr/bin/env tsx
/**
 * connect-orphan-hazards-and-annexes.ts
 *
 * 잔여 orphan 보강 (3 hazards + 12 annexes + cyc:quarterly):
 *
 *   A. Hazards 3 — in-edge 추가
 *      - hazard:psychosocial_stress    ← H-36/H-37/H-204 가이드 causedBy
 *                                        + activity:safety_education hasHazard
 *      - hazard:biological_hazard      ← activity:underground_utility/drainage_sewerage hasHazard
 *      - hazard:machine_entanglement   ← activity:vehicle_construction hasHazard
 *                                        + equipment:crane/lift/gondola hasHazard
 *
 *   B. Annexes 12 — 적절한 documents/articles에서 references 추가
 *      서식101 공사 개요서                  → doc/hazardous-risk-prevention-plan-construction.references
 *      서식102 산업안전보건관리비 사용계획서  → doc/safety-health-mgmt-cost-plan.references
 *      서식103 유해위험방지계획서 자체확인     → doc/hazardous-risk-prevention-plan-construction.references
 *      서식78  석면해체·제거작업 변경 신고서  → doc/asbestos-investigation-report.references
 *      서식3의2 안전관리자 등 해임 보고서     → doc/safety-health-manager-appointment.references
 *      서식6의2 (전문기관)지정신청서          → doc/construction-disaster-prevention-guidance.references
 *      서식7의2 지정서                       → 동일
 *      서식8의2 변경신청서                   → 동일
 *      서식90의2 지도사 자격증 신청서         → doc/honorary-safety-supervisor-appointment.references
 *      서식90의3 지도사 자격증                → 동일
 *      서식67   MSDS 비공개 승인 취소 통지서 → doc/msds-register.references
 *      별표5    강관비계 조립간격 (§59 관련)  → art:기준규칙:59.references (또는 inline)
 *      별표9    위험물질 기준량 (§273 관련)  → art:기준규칙:273.references
 *      별표19   건설재해예방전문지도기관      → doc/construction-disaster-prevention-guidance.references
 *      별표27   석면조사기관                  → doc/asbestos-investigation-report.references
 *
 *   C. cyc:quarterly — pre_work_inspection 등 분기 의무 문서에서 cycle 참조 추가
 *      (사용처가 없으면 보조 cycle 메타로만 보유)
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function addToArray(
  nodePath: string,
  prop: string,
  values: string[],
): Promise<{ added: string[]; skipped: boolean }> {
  if (!await fileExists(nodePath)) return { added: [], skipped: true };
  const node = JSON.parse(await readFile(nodePath, "utf-8")) as Record<string, unknown>;
  const cur = (node[prop] as string[] | undefined) ?? [];
  const added: string[] = [];
  for (const v of values) {
    if (!cur.includes(v)) {
      cur.push(v);
      added.push(v);
    }
  }
  if (added.length === 0) return { added, skipped: false };
  node[prop] = cur;
  await writeFile(nodePath, JSON.stringify(node, null, 2) + "\n", "utf-8");
  return { added, skipped: false };
}

interface Patch {
  file: string;
  prop: string;
  values: string[];
  label: string;
}

const PATCHES: Patch[] = [
  // ── A. Hazards in-edge 보강 ──────────────────────────────────
  // psychosocial_stress: 가이드 causedBy 보강
  { file: "documents/guides/h-36-2021.jsonld", prop: "causedBy",
    values: ["hazard:psychosocial_stress"], label: "H-36 → psychosocial_stress" },
  { file: "documents/guides/h-37-2021.jsonld", prop: "causedBy",
    values: ["hazard:psychosocial_stress"], label: "H-37 → psychosocial_stress" },
  { file: "documents/guides/h-204-2018.jsonld", prop: "causedBy",
    values: ["hazard:psychosocial_stress"], label: "H-204 → psychosocial_stress" },
  // psychosocial_stress: 활동 hasHazard 보강
  { file: "activities/safety_education.jsonld", prop: "hasHazard",
    values: ["hazard:psychosocial_stress"], label: "safety_education hasHazard" },
  // biological_hazard: 활동 hasHazard 보강
  { file: "activities/underground_utility.jsonld", prop: "hasHazard",
    values: ["hazard:biological_hazard"], label: "underground_utility (하수·맨홀)" },
  { file: "activities/drainage_sewerage.jsonld", prop: "hasHazard",
    values: ["hazard:biological_hazard"], label: "drainage_sewerage (오수)" },
  // machine_entanglement: 활동 + 장비 hasHazard 보강
  { file: "activities/vehicle_construction.jsonld", prop: "hasHazard",
    values: ["hazard:machine_entanglement"], label: "vehicle_construction" },
  { file: "activities/scaffolding_assembly.jsonld", prop: "hasHazard",
    values: ["hazard:machine_entanglement"], label: "scaffolding_assembly" },
  { file: "equipment/crane.jsonld", prop: "hasHazard",
    values: ["hazard:machine_entanglement"], label: "crane" },
  { file: "equipment/lift.jsonld", prop: "hasHazard",
    values: ["hazard:machine_entanglement"], label: "lift" },
  { file: "equipment/gondola.jsonld", prop: "hasHazard",
    values: ["hazard:machine_entanglement"], label: "gondola" },

  // ── B. Annexes — documents.references / articles.references ──────
  // 서식101/103 → 유해위험방지계획서(건설) 첨부
  { file: "documents/hazardous-risk-prevention-plan-construction.jsonld", prop: "references",
    values: [
      "annex:산안법시행규칙:서식101",
      "annex:산안법시행규칙:서식103",
    ], label: "유해위험방지계획서 첨부 양식" },
  // 서식102 → 산업안전보건관리비 사용계획서
  { file: "documents/safety-health-mgmt-cost-plan.jsonld", prop: "references",
    values: ["annex:산안법시행규칙:서식102"], label: "안전관리비 사용계획서 양식" },
  // 서식78 + 별표27 → 석면조사보고서
  { file: "documents/asbestos-investigation-report.jsonld", prop: "references",
    values: [
      "annex:산안법시행규칙:서식78",
      "annex:산안법시행령:별표27",
    ], label: "석면 양식·기준" },
  // 서식3의2 → 안전관리자 선임 보고서 (해임 양식)
  { file: "documents/safety-health-manager-appointment.jsonld", prop: "references",
    values: ["annex:산안법시행규칙:서식3의2"], label: "안전관리자 해임 보고서" },
  // 서식6의2/7의2/8의2 + 별표19 → 건설재해예방 지도결과서
  { file: "documents/construction-disaster-prevention-guidance.jsonld", prop: "references",
    values: [
      "annex:산안법시행규칙:서식6의2",
      "annex:산안법시행규칙:서식7의2",
      "annex:산안법시행규칙:서식8의2",
      "annex:산안법시행령:별표19",
    ], label: "건설재해예방지도기관 지정·변경" },
  // 서식90의2/90의3 → 명예감독관 위촉장 (지도사 자격증)
  { file: "documents/honorary-safety-supervisor-appointment.jsonld", prop: "references",
    values: [
      "annex:산안법시행규칙:서식90의2",
      "annex:산안법시행규칙:서식90의3",
    ], label: "지도사 자격증 양식" },
  // 서식67 → MSDS 등록부 (비공개 승인 취소 통지서)
  { file: "documents/msds-register.jsonld", prop: "references",
    values: ["annex:산안법시행규칙:서식67"], label: "MSDS 비공개 승인 취소" },
  // 별표5 → 기준규칙 §59 (강관비계)
  { file: "articles/기준규칙-§59.jsonld", prop: "references",
    values: ["annex:기준규칙:별표5"], label: "기준규칙 §59 강관비계" },
  // 별표9 → 기준규칙 §273 (위험물질 기준량)
  { file: "articles/기준규칙-§273.jsonld", prop: "references",
    values: ["annex:기준규칙:별표9"], label: "기준규칙 §273 위험물질" },

  // ── C. cyc:quarterly — pre_work_inspection 보조 매핑 ────────
  // 산업안전보건위원회는 분기 1회 (산안법 §24, 시행령 §37)
  { file: "documents/health-safety-committee.jsonld", prop: "alternativeCycles",
    values: ["cyc:quarterly"], label: "산업안전보건위원회 분기" },
];

async function main() {
  let success = 0;
  let skipped = 0;
  let alreadyPresent = 0;

  for (const patch of PATCHES) {
    const path = resolve(NODES, patch.file);
    const result = await addToArray(path, patch.prop, patch.values);
    if (result.skipped) {
      console.warn(`  skip (file not found): ${patch.label} @ ${patch.file}`);
      skipped += 1;
    } else if (result.added.length === 0) {
      alreadyPresent += 1;
    } else {
      console.log(`  ✓ ${patch.label}: ${result.added.join(", ")}`);
      success += 1;
    }
  }
  console.log(`\n[done] ${success} patches applied, ${alreadyPresent} already present, ${skipped} skipped`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
