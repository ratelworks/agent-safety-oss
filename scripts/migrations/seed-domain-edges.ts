#!/usr/bin/env tsx
/**
 * seed-domain-edges.ts
 *
 * 신규 도메인 노드(Activity/Hazard/Control)와 기존 노드(Article/Annex/Document) 간 엣지 채움.
 * 교차 검증 진단: 신규 43 노드 중 41개 고립 — regulates=1, mitigatedBy=0, guidedBy=0.
 *
 * 매핑:
 *   1. Article ↔ Activity (regulates) — 별표 4 13종 작업
 *   2. Hazard ↔ Control (mitigatedBy) — ERIC-PP 위계 (모든 Control 이 모든 Hazard 완화 후보)
 *   3. Activity ↔ Hazard (causedBy 역방향) — 작업별 빈번 위험요인
 *   4. Document ↔ Activity (requires) — 작업 시 필요 문서
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");

// 별표 4 13종 매핑 — Article (기준규칙 §38, 별표 4 6호) ↔ Activity
const ARTICLE_ACTIVITY: Record<string, string[]> = {
  "art:기준규칙:38": [
    "activity:tower_crane",
    "activity:vehicle_cargo",
    "activity:vehicle_construction",
    "activity:electric_work_50v_plus",
    "activity:excavation_2m_plus",
    "activity:tunnel_excavation",
    "activity:bridge_5m_30m",
    "activity:demolition",
    "activity:heavy_lifting",
  ],
  "art:산안법:36": ["activity:risk_assessment_general"],
  "art:산안법:29": ["activity:safety_education"],
  "art:위험성평가-고시:15": ["activity:risk_assessment_general", "activity:tbm_daily"],
};

// Activity ↔ Hazard (작업별 빈번 위험요인)
const ACTIVITY_HAZARDS: Record<string, string[]> = {
  "activity:excavation_2m_plus": ["hazard:cave_in", "hazard:fall_from_height", "hazard:fall_object"],
  "activity:tunnel_excavation": ["hazard:cave_in", "hazard:asphyxiation", "hazard:fall_object"],
  "activity:tower_crane": ["hazard:fall_from_height", "hazard:fall_object", "hazard:struck_by"],
  "activity:vehicle_construction": ["hazard:struck_by", "hazard:cave_in"],
  "activity:vehicle_cargo": ["hazard:struck_by", "hazard:fall_object"],
  "activity:electric_work_50v_plus": ["hazard:electric_shock", "hazard:fire_explosion"],
  "activity:bridge_5m_30m": ["hazard:fall_from_height", "hazard:cave_in"],
  "activity:demolition": ["hazard:cave_in", "hazard:fall_object", "hazard:asphyxiation"],
  "activity:heavy_lifting": ["hazard:struck_by", "hazard:crushing"],
};

// Hazard ↔ Control (ERIC-PP 위계 — 모든 위험은 ERIC-PP 단계 평가)
const HAZARD_CONTROLS: Record<string, string[]> = {
  "hazard:fall_from_height": [
    "control:eric_eliminate",
    "control:eric_engineering",
    "control:eric_administrative",
    "control:eric_ppe",
  ],
  "hazard:fall_object": ["control:eric_engineering", "control:eric_administrative", "control:eric_ppe"],
  "hazard:electric_shock": ["control:eric_isolation", "control:eric_engineering", "control:eric_administrative", "control:eric_ppe"],
  "hazard:crushing": ["control:eric_engineering", "control:eric_administrative"],
  "hazard:cave_in": ["control:eric_engineering", "control:eric_administrative"],
  "hazard:fire_explosion": [
    "control:eric_eliminate",
    "control:eric_substitute",
    "control:eric_isolation",
    "control:eric_engineering",
    "control:eric_administrative",
    "control:eric_ppe",
  ],
  "hazard:asphyxiation": ["control:eric_isolation", "control:eric_engineering", "control:eric_administrative", "control:eric_ppe"],
  "hazard:struck_by": ["control:eric_engineering", "control:eric_administrative", "control:eric_ppe"],
  "hazard:machine_entanglement": ["control:eric_engineering", "control:eric_administrative", "control:eric_ppe"],
  "hazard:chemical_exposure": [
    "control:eric_eliminate",
    "control:eric_substitute",
    "control:eric_isolation",
    "control:eric_engineering",
    "control:eric_administrative",
    "control:eric_ppe",
  ],
  "hazard:noise_vibration": ["control:eric_substitute", "control:eric_engineering", "control:eric_ppe"],
  "hazard:msd_repetitive": ["control:eric_engineering", "control:eric_administrative"],
};

// Document ↔ Activity (requires)
const DOCUMENT_ACTIVITIES: Record<string, string[]> = {
  "doc:ad_hoc/work_plan_excavation": ["activity:excavation_2m_plus"],
  "doc:ad_hoc/work_plan": [
    "activity:tower_crane",
    "activity:vehicle_cargo",
    "activity:vehicle_construction",
    "activity:electric_work_50v_plus",
    "activity:excavation_2m_plus",
    "activity:tunnel_excavation",
    "activity:bridge_5m_30m",
    "activity:demolition",
    "activity:heavy_lifting",
  ],
  "doc:daily/daily_tbm": ["activity:tbm_daily", "activity:risk_assessment_general"],
  "doc:monthly/monthly_education_log": ["activity:safety_education"],
  "doc:monthly/monthly_risk_assessment": ["activity:risk_assessment_general"],
  "doc:annual/regular_risk_assessment": ["activity:risk_assessment_general"],
  "doc:ad_hoc/initial_risk_assessment": ["activity:risk_assessment_general"],
  "doc:ad_hoc/ad_hoc_risk_assessment": ["activity:risk_assessment_general"],
};

async function patchNode(
  dir: string,
  filename: string,
  patcher: (node: Record<string, unknown>) => boolean,
): Promise<boolean> {
  const path = resolve(dir, filename);
  try {
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (patcher(node)) {
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
      return true;
    }
  } catch {
    // 노드 부재
  }
  return false;
}

(async () => {
  const ARTICLES = resolve(NODES, "articles");
  const ACTIVITIES = resolve(NODES, "activities");
  const HAZARDS = resolve(NODES, "hazards");
  const DOCUMENTS = resolve(NODES, "documents");

  // 1. Article.regulates ← Activity 매핑
  let regulatesAdded = 0;
  for (const [articleId, activities] of Object.entries(ARTICLE_ACTIVITY)) {
    const slug = articleId.replace("art:", "").replace(":", "-§");
    const ok = await patchNode(ARTICLES, `${slug}.jsonld`, (node) => {
      const cur = (node.regulates as string[] | undefined) ?? [];
      const merged = Array.from(new Set([...cur, ...activities]));
      if (merged.length !== cur.length) {
        node.regulates = merged;
        return true;
      }
      return false;
    });
    if (ok) regulatesAdded += activities.length;
  }
  console.log(`[regulates] ${regulatesAdded} 엣지 추가`);

  // 2. Activity.causedBy ← Hazard (역방향: Hazard 노드 자체에는 별도 안 채움)
  // Activity 노드에 hazards array 추가 (graphology 인덱싱용)
  let activityHazardsAdded = 0;
  for (const [activityId, hazards] of Object.entries(ACTIVITY_HAZARDS)) {
    const slug = activityId.replace("activity:", "");
    const ok = await patchNode(ACTIVITIES, `${slug}.jsonld`, (node) => {
      const cur = (node.causedBy as string[] | undefined) ?? [];
      const merged = Array.from(new Set([...cur, ...hazards]));
      if (merged.length !== cur.length) {
        node.causedBy = merged;
        return true;
      }
      return false;
    });
    if (ok) activityHazardsAdded += hazards.length;
  }
  console.log(`[activity.causedBy] ${activityHazardsAdded} 엣지 추가`);

  // 3. Hazard.mitigatedBy ← Control
  let mitigatedAdded = 0;
  for (const [hazardId, controls] of Object.entries(HAZARD_CONTROLS)) {
    const slug = hazardId.replace("hazard:", "");
    const ok = await patchNode(HAZARDS, `${slug}.jsonld`, (node) => {
      const cur = (node.mitigatedBy as string[] | undefined) ?? [];
      const merged = Array.from(new Set([...cur, ...controls]));
      if (merged.length !== cur.length) {
        node.mitigatedBy = merged;
        return true;
      }
      return false;
    });
    if (ok) mitigatedAdded += controls.length;
  }
  console.log(`[mitigatedBy] ${mitigatedAdded} 엣지 추가`);

  // 4. Document.requires ← Activity
  let requiresAdded = 0;
  for (const [docId, activities] of Object.entries(DOCUMENT_ACTIVITIES)) {
    // docId 는 'doc:cycle/docId' 형식. filename 은 'docId.jsonld' (cycle 폴더 없음, 평면)
    const docKey = docId.split("/").pop()!;
    const slug = docKey.replace(/_/g, "-");
    const ok = await patchNode(DOCUMENTS, `${slug}.jsonld`, (node) => {
      const cur = (node.requires as string[] | undefined) ?? [];
      const merged = Array.from(new Set([...cur, ...activities]));
      if (merged.length !== cur.length) {
        node.requires = merged;
        return true;
      }
      return false;
    });
    if (ok) requiresAdded += activities.length;
  }
  console.log(`[document.requires] ${requiresAdded} 엣지 추가`);

  console.log(`\n[total] ${regulatesAdded + activityHazardsAdded + mitigatedAdded + requiresAdded} 엣지 신규`);
})();
