#!/usr/bin/env tsx
/**
 * seed-standard-form-fields.ts
 *
 * 한국 안전관리 표준 양식의 공통 필수 메타 5건을 19개 Document 노드의 requiredFields에 추가.
 *
 * 1. documentId        — 문서 고유 번호 (예: "WP-2026-0427-001")
 * 2. approvalChain     — 사업주·관리감독자·근로자대표 서명·날짜
 * 3. workPeriod        — 유효 기간 또는 작업 기간 (작성일 외 별개)
 * 4. emergencyContacts — 119·노동청·응급의료기관·사업주 비상연락망
 * 5. workerNotification — 근로자 통지 사실·일자 증빙
 *
 * 양식 종류별 일부 가감:
 *   - work_plan_*       : 5건 모두
 *   - daily_tbm         : approvalChain 대신 signatures 활용 (이미 있음)
 *   - risk_assessment_* : approvalChain (3 서명) + workPeriod
 *   - industrial_accident_report : 응급 연락망 + 사업주 서명
 *   - 기타 일반 : approvalChain + documentId
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

interface FieldSpec {
  key: string;
  label: string;
  source: string;
}

const COMMON_FIELDS: FieldSpec[] = [
  { key: "documentId", label: "문서 번호 (예: WP-2026-0427-001)", source: "한국 안전관리 표준 양식 공통 메타" },
  {
    key: "approvalChain",
    label: "결재 라인 — 사업주·관리감독자·근로자대표 서명·날짜",
    source: "산업안전보건법 §38 ② (작업계획서) / §6 (위험성평가 근로자 참여)",
  },
  {
    key: "workPeriod",
    label: "작업 기간 또는 유효 기간 (YYYY-MM-DD ~ YYYY-MM-DD)",
    source: "한국 안전관리 표준 양식 공통 메타",
  },
  {
    key: "emergencyContacts",
    label: "비상연락망 — 119·관할 지방고용노동청·응급의료기관·사업주",
    source: "산업안전보건기준에 관한 규칙 §38 별표 4 (사업장 내 연락방법)",
  },
  {
    key: "workerNotification",
    label: "근로자 통지 사실·일자·방법 (회의·게시·교육)",
    source: "산업안전보건법 §38 ② / 위험성평가 고시 §13",
  },
];

// docId 별 적용 필드 목록 (제외 필드는 제외)
const APPLY_RULES: Record<string, string[]> = {
  // 작업계획서 — 5건 모두
  work_plan_excavation: ["documentId", "approvalChain", "workPeriod", "emergencyContacts", "workerNotification"],
  work_plan: ["documentId", "approvalChain", "workPeriod", "emergencyContacts", "workerNotification"],
  // 위험성평가 — 결재·기간
  initial_risk_assessment: ["documentId", "approvalChain", "workPeriod"],
  regular_risk_assessment: ["documentId", "approvalChain", "workPeriod"],
  monthly_risk_assessment: ["documentId", "approvalChain", "workPeriod"],
  ad_hoc_risk_assessment: ["documentId", "approvalChain"],
  // TBM — 이미 signatures + dateTime 있음, 비상연락망만 추가
  daily_tbm: ["documentId", "emergencyContacts"],
  // 작업허가서
  work_permit: ["documentId", "approvalChain", "workPeriod", "emergencyContacts"],
  // 사고보고
  industrial_accident_report: ["documentId", "approvalChain", "emergencyContacts"],
  // 중처법
  severe_accident_compliance: ["documentId", "approvalChain"],
  // 교육·점검·관리
  monthly_education_log: ["documentId", "approvalChain"],
  weekly_joint_inspection: ["documentId", "approvalChain"],
  pre_work_inspection: ["documentId"],
  // 협의체·산안위
  contractor_safety_council: ["documentId", "approvalChain"],
  health_safety_committee: ["documentId", "approvalChain"],
  // 보호구·MSDS
  ppe_register: ["documentId", "approvalChain"],
  msds_register: ["documentId", "approvalChain", "emergencyContacts"],
  // 건강·환경
  health_examination_records: ["documentId", "approvalChain"],
  work_environment_measurement: ["documentId", "approvalChain", "workPeriod"],
  // 선임
  safety_health_manager_appointment: ["documentId", "approvalChain"],
};

(async () => {
  let updated = 0, addedFields = 0;
  for (const f of await readdir(DOCS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOCS_DIR, f);
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      docId: string;
      requiredFields: FieldSpec[];
    };
    const applyKeys = APPLY_RULES[node.docId];
    if (!applyKeys) continue;

    const existingKeys = new Set(node.requiredFields.map((rf) => rf.key));
    const toAdd = COMMON_FIELDS.filter((cf) => applyKeys.includes(cf.key) && !existingKeys.has(cf.key));
    if (toAdd.length === 0) continue;

    node.requiredFields = [...node.requiredFields, ...toAdd];
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
    updated += 1;
    addedFields += toAdd.length;
    console.log(`[ok] ${node.docId.padEnd(35)} +${toAdd.length} 필드 (${toAdd.map(t=>t.key).join(", ")})`);
  }
  console.log(`\n[done] ${updated} 노드 갱신, ${addedFields} 신규 표준 양식 필드 추가`);
})();
