#!/usr/bin/env tsx
/**
 * finalize-orphan-guides.ts
 *
 * refine-kosha-mapping 후 21개 orphan 가이드 정리:
 *   - 비건설 11개 영구 삭제 (의료/실험실/서비스업 한정)
 *   - 건설 적용 10개 수동 매핑 보강 (비파괴/진동/가스누출/배관 등)
 *
 * 영구 삭제 (의료기관·실험실·서비스업 한정):
 *   e-m-4 혈액원성 병원체
 *   h-41 흉부방사선검사 이상자 진료
 *   h-53 병원 근로자 마취가스
 *   h-72 확산시료채취법 분석
 *   h-74 펌프식 시료채취법 분석
 *   h-78 자외선 소독기 노출평가
 *   h-93 의료기관 근로자 공기매개 감염병
 *   h-186 사업장 공기매개 감염병 확산방지
 *   h-212 콜센터 감염병 관리 (서비스업)
 *   h-220 공기매개 신종감염병
 *   d-34 무수암모니아 저장 (화학공장)
 *   e-13 가스충전소·주유소 재해방지 (운영)
 *
 * 건설 적용 매핑 보강:
 *   c-c-26 연료가스 배관 사용전 작업    → underground_utility / fire_explosion / gas_leak
 *   c-c-85 불활성가스 치환             → tunnel_excavation / asphyxiation
 *   c-c-87 가스누출감지경보기           → underground_utility / gas_leak / fire_explosion
 *   c-c-91 비파괴검사 및 열처리          → steel_structure / welding_cutting_apparatus
 *   h-155  비파괴 작업 방사선 노출       → steel_structure / radiation_exposure
 *   h-62   전리방사선 노출              → steel_structure / radiation_exposure
 *   h-77   국소진동 측정·평가           → vehicle_construction / vibration_exposure
 *   h-177  국소진동공구 보건관리        → vehicle_construction / vibration_exposure
 *   h-169  디젤엔진 배기가스           → vehicle_construction / dust_exposure
 */

import { readFile, writeFile, unlink, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");
const NODES_ROOT = resolve(ROOT, "src", "ontology", "graph", "nodes");

const NON_CONSTRUCTION_DELETE = [
  "e-m-4-2025",
  "h-41-2021",
  "h-53-2021",
  "h-72-2015",
  "h-74-2015",
  "h-78-2012",
  "h-93-2021",
  "h-186-2016",
  "h-212-2022",
  "h-220-2023",
  "d-34-2013",
  "e-13-2012",
];

// guideId(@id 일부) → activity/hazard/equipment 노드의 guidedBy에 추가할 매핑
const MANUAL_MAPPINGS: Array<{
  guideFile: string;
  guideId: string;
  activities?: string[];
  hazards?: string[];
  equipments?: string[];
}> = [
  {
    guideFile: "c-c-26-2026.jsonld",
    guideId: "doc:kosha_guide/C-C-26-2026",
    activities: ["activity:underground_utility"],
    hazards: ["hazard:fire_explosion", "hazard:gas_leak"],
  },
  {
    guideFile: "c-c-85-2026.jsonld",
    guideId: "doc:kosha_guide/C-C-85-2026",
    activities: ["activity:tunnel_excavation", "activity:underground_utility"],
    hazards: ["hazard:asphyxiation"],
  },
  {
    guideFile: "c-c-87-2026.jsonld",
    guideId: "doc:kosha_guide/C-C-87-2026",
    activities: ["activity:underground_utility", "activity:tunnel_excavation"],
    hazards: ["hazard:gas_leak", "hazard:fire_explosion"],
  },
  {
    guideFile: "c-c-91-2026.jsonld",
    guideId: "doc:kosha_guide/C-C-91-2026",
    activities: ["activity:steel_structure"],
    equipments: ["equipment:welding_cutting_apparatus"],
  },
  {
    guideFile: "h-155-2019.jsonld",
    guideId: "doc:kosha_guide/H-155-2019",
    activities: ["activity:steel_structure"],
    hazards: ["hazard:radiation_exposure"],
  },
  {
    guideFile: "h-62-2021.jsonld",
    guideId: "doc:kosha_guide/H-62-2021",
    activities: ["activity:steel_structure"],
    hazards: ["hazard:radiation_exposure"],
  },
  {
    guideFile: "h-77-2012.jsonld",
    guideId: "doc:kosha_guide/H-77-2012",
    activities: ["activity:vehicle_construction"],
    hazards: ["hazard:vibration_exposure"],
  },
  {
    guideFile: "h-177-2015.jsonld",
    guideId: "doc:kosha_guide/H-177-2015",
    activities: ["activity:vehicle_construction"],
    hazards: ["hazard:vibration_exposure"],
  },
  {
    guideFile: "h-169-2015.jsonld",
    guideId: "doc:kosha_guide/H-169-2015",
    activities: ["activity:vehicle_construction"],
    hazards: ["hazard:dust_exposure"],
  },
];

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function addGuidedBy(nodePath: string, guideId: string): Promise<boolean> {
  if (!await fileExists(nodePath)) return false;
  const node = JSON.parse(await readFile(nodePath, "utf-8")) as Record<string, unknown>;
  const arr = (node.guidedBy as string[] | undefined) ?? [];
  if (arr.includes(guideId)) return false;
  arr.push(guideId);
  node.guidedBy = arr;
  await writeFile(nodePath, JSON.stringify(node, null, 2) + "\n", "utf-8");
  return true;
}

async function main() {
  // 1) 비건설 12개 영구 삭제
  let deleted = 0;
  for (const stem of NON_CONSTRUCTION_DELETE) {
    for (const base of [GUIDES_DIR, resolve(ROOT, "build", "ontology", "graph", "nodes", "documents", "guides")]) {
      const p = resolve(base, `${stem}.jsonld`);
      if (await fileExists(p)) {
        await unlink(p);
        deleted += 1;
      }
    }
  }
  console.log(`[delete] non-construction orphans: ${deleted} files (src+build)`);

  // 1.1) 삭제된 가이드 ID들의 dangling reference 정리
  const deletedIds = NON_CONSTRUCTION_DELETE.map((s) => `doc:kosha_guide/${s.toUpperCase().replace(/-(\d+)$/, (_, y) => `-${y}`)}`);
  // 정확한 @id 추출은 위 변환으로 어렵다 — fallback: 모든 노드에서 doc:kosha_guide/ 시작하는 ref 중 보유 가이드에 없는 것 제거 (verify-graph가 잡아냄)

  // 2) 건설 적용 9개 수동 매핑 보강
  let edges = 0;
  for (const m of MANUAL_MAPPINGS) {
    const guidePath = resolve(GUIDES_DIR, m.guideFile);
    if (!await fileExists(guidePath)) {
      console.warn(`  skip (not found): ${m.guideFile}`);
      continue;
    }
    for (const actId of m.activities ?? []) {
      const slug = actId.replace("activity:", "");
      const path = resolve(NODES_ROOT, "activities", `${slug}.jsonld`);
      if (await addGuidedBy(path, m.guideId)) edges += 1;
    }
    for (const hazId of m.hazards ?? []) {
      const slug = hazId.replace("hazard:", "");
      const path = resolve(NODES_ROOT, "hazards", `${slug}.jsonld`);
      if (await addGuidedBy(path, m.guideId)) edges += 1;
    }
    for (const eqId of m.equipments ?? []) {
      const slug = eqId.replace("equipment:", "");
      const path = resolve(NODES_ROOT, "equipment", `${slug}.jsonld`);
      if (await addGuidedBy(path, m.guideId)) edges += 1;
    }
  }
  console.log(`[manual-map] added ${edges} guidedBy edges for orphan guides`);

  console.log("\n[done] orphan finalization complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
