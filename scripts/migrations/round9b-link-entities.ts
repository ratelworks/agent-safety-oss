#!/usr/bin/env tsx
/**
 * Round 9b: 신규 entity·src 노드를 의무문서·법령에서 informedBy로 연결
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "..", "src/ontology/graph/nodes/documents");

const PATCHES: Array<{ doc: string; informedBy: string[] }> = [
  // 굴착 작업계획서 — 매설물 운영사
  { doc: "work-plan-excavation",
    informedBy: ["entity:kogas", "entity:kepco", "entity:kt", "entity:waterworks", "src:kogas:1544-4500", "src:kepco:123"] },

  // MSDS — 화학물질 관계 기관
  { doc: "msds-register",
    informedBy: ["entity:kosha", "entity:moe", "entity:poison_center", "src:poison_center:1899-9594", "src:moe:1577-3279"] },

  // 사고 보고
  { doc: "industrial-accident-report",
    informedBy: ["entity:moel", "entity:comwel", "entity:kosha", "src:moel:1350"] },
  { doc: "severe-accident-immediate-report",
    informedBy: ["entity:moel", "entity:comwel", "src:moel:1350", "src:fire:119", "src:emergency_medical:1339"] },
  { doc: "severe-accident-compliance",
    informedBy: ["entity:moel", "entity:kosha"] },

  // 석면조사
  { doc: "asbestos-investigation-report",
    informedBy: ["entity:moel", "entity:kosha"] },

  // 안전인증·검사
  { doc: "safety-certification-application",
    informedBy: ["entity:kosha", "entity:moel"] },
  { doc: "safety-inspection-application",
    informedBy: ["entity:kosha", "entity:ats", "entity:moel"] },
  { doc: "voluntary-safety-confirmation-filing",
    informedBy: ["entity:kosha", "entity:moel"] },

  // 작업환경측정
  { doc: "work-environment-measurement",
    informedBy: ["entity:kosha", "entity:moel", "entity:kolas"] },
  { doc: "work-environment-measurement-notification",
    informedBy: ["entity:moel"] },

  // 건강진단
  { doc: "health-examination-records",
    informedBy: ["entity:kosha", "entity:nhic", "src:nhic:1577-1000"] },
  { doc: "health-examination-followup",
    informedBy: ["entity:kosha", "entity:nhic"] },
  { doc: "industrial-physician-appointment",
    informedBy: ["entity:moel", "entity:nhic"] },

  // 건설재해예방 지도
  { doc: "construction-disaster-prevention-guidance",
    informedBy: ["entity:kosha", "entity:moel"] },

  // 임시소방시설
  { doc: "temporary-fire-facility-check",
    informedBy: ["entity:nfa", "src:fire:119"] },

  // 가설전기
  { doc: "temporary-electric-inspection",
    informedBy: ["entity:kepco", "entity:kosha", "src:kepco:123"] },

  // 비계·추락방지망 등 점검표 — KOSHA
  { doc: "scaffolding-inspection-checklist", informedBy: ["entity:kosha"] },
  { doc: "fall-prevention-net-inspection", informedBy: ["entity:kosha"] },
  { doc: "safety-harness-inspection", informedBy: ["entity:kosha"] },
  { doc: "tower-crane-inspection", informedBy: ["entity:kosha", "entity:ats"] },
  { doc: "construction-machinery-inspection", informedBy: ["entity:kosha"] },

  // 안전보건관리
  { doc: "safety-health-management-policy", informedBy: ["entity:moel", "entity:kosha"] },
  { doc: "safety-health-regulation", informedBy: ["entity:moel", "entity:kosha", "entity:moleg"] },
  { doc: "safety-health-manager-appointment", informedBy: ["entity:moel"] },
  { doc: "safety-health-management-assistant-appointment", informedBy: ["entity:moel"] },
  { doc: "honorary-safety-supervisor-appointment", informedBy: ["entity:moel"] },
  { doc: "safety-health-diagnosis-report", informedBy: ["entity:moel", "entity:kosha"] },

  // 산업안전보건위원회·도급
  { doc: "health-safety-committee", informedBy: ["entity:moel"] },
  { doc: "contractor-safety-council", informedBy: ["entity:moel"] },
  { doc: "contractor-consultative-body", informedBy: ["entity:moel"] },
  { doc: "weekly-joint-inspection", informedBy: ["entity:moel", "entity:kosha"] },

  // 교육·게시
  { doc: "monthly-education-log", informedBy: ["entity:kosha", "entity:moel"] },
  { doc: "supervisor-education-log", informedBy: ["entity:kosha"] },
  { doc: "daily-tbm", informedBy: ["entity:kosha"] },
  { doc: "legal-summary-posting", informedBy: ["entity:moleg", "entity:moel"] },
  { doc: "safety-signage-register", informedBy: ["entity:kosha"] },

  // 위험성평가
  { doc: "regular-risk-assessment", informedBy: ["entity:kosha", "entity:moel"] },
  { doc: "monthly-risk-assessment", informedBy: ["entity:kosha"] },
  { doc: "initial-risk-assessment", informedBy: ["entity:kosha"] },
  { doc: "ad-hoc-risk-assessment", informedBy: ["entity:kosha"] },
  { doc: "risk-assessment-procedure", informedBy: ["entity:kosha", "entity:moel"] },

  // PPE·신호수
  { doc: "ppe-register", informedBy: ["entity:kosha"] },
  { doc: "signaler-appointment", informedBy: ["entity:kosha"] },

  // 작업허가서·계획서 통합
  { doc: "work-plan", informedBy: ["entity:kosha"] },
  { doc: "work-permit", informedBy: ["entity:kosha"] },

  // 작업계획서 9종 (각각)
  { doc: "work-plan-tower-crane", informedBy: ["entity:kosha", "entity:ats"] },
  { doc: "work-plan-vehicle-cargo", informedBy: ["entity:kosha"] },
  { doc: "work-plan-vehicle-construction", informedBy: ["entity:kosha"] },
  { doc: "work-plan-electric-work", informedBy: ["entity:kosha", "entity:kepco"] },
  { doc: "work-plan-tunnel", informedBy: ["entity:kosha"] },
  { doc: "work-plan-bridge", informedBy: ["entity:kosha"] },
  { doc: "work-plan-demolition", informedBy: ["entity:kosha"] },
  { doc: "work-plan-heavy-lifting", informedBy: ["entity:kosha"] },

  // 작업허가서 5종
  { doc: "work-permit-confined-space", informedBy: ["entity:kosha", "src:fire:119"] },
  { doc: "work-permit-heavy-lifting", informedBy: ["entity:kosha"] },
  { doc: "work-permit-high-altitude", informedBy: ["entity:kosha"] },
  { doc: "work-permit-hot-work", informedBy: ["entity:kosha", "entity:nfa", "src:fire:119"] },
  { doc: "work-permit-loto", informedBy: ["entity:kosha", "entity:kepco"] },

  // 안전관리비
  { doc: "safety-health-mgmt-cost-plan", informedBy: ["entity:moel", "entity:kosha"] },

  // 안전보건정보 제공·기본대장
  { doc: "safety-health-information-provision", informedBy: ["entity:moel"] },
  { doc: "basic-safety-health-register", informedBy: ["entity:moel", "entity:kosha"] },
  { doc: "design-safety-health-register", informedBy: ["entity:moel", "entity:kosha"] },
  { doc: "construction-safety-health-register", informedBy: ["entity:moel", "entity:kosha"] },

  // 사전 점검·합동
  { doc: "pre-work-inspection", informedBy: ["entity:kosha"] },

  // 유해위험방지계획서
  { doc: "hazardous-risk-prevention-plan-construction", informedBy: ["entity:moel", "entity:kosha"] },
];

async function main() {
  let updated = 0, edges = 0;
  for (const p of PATCHES) {
    const path = resolve(DOCS, p.doc + ".jsonld");
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      const cur = (node.informedBy as string[] | undefined) ?? [];
      let added = 0;
      for (const v of p.informedBy) {
        if (!cur.includes(v)) {
          cur.push(v);
          added += 1;
        }
      }
      if (added > 0) {
        node.informedBy = cur;
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
        updated += 1;
        edges += added;
      }
    } catch (err) {
      console.warn(`  ✗ ${p.doc}: ${(err as Error).message}`);
    }
  }
  console.log(`[done] ${updated} doc / ${edges} informedBy 엣지 추가`);
}

main().catch(console.error);
