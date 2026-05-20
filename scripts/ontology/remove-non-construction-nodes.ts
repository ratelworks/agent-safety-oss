#!/usr/bin/env tsx
/**
 * remove-non-construction-nodes.ts
 *
 * 건설전용 OSS 노선 — 비건설 온톨로지 노드 정리.
 * 원칙:
 *   - 법률 본문(articles/annexes/chapters/acts)은 통합법이라 그대로 보존
 *   - 온톨로지 노드(documents/activities/equipment/hazards/controls/guides)만 건설로 선별
 *   - 모든 노드 파일에서 dangling reference 일괄 제거
 *
 * 삭제 대상:
 *   1) documents 5    — 비건설 의무문서 (1차 라운드)
 *      + customer-violence-prevention-plan, process-safety-management,
 *        epidemiological-investigation-report, work-plan-{railway-*, quarry, chemical-facility} (7)
 *   2) documents 2    — hazardous-risk-prevention-plan-{industrial,machinery} (산안법 §42 1·2호)
 *   3) activities 4   — chemical_facility, railway_*, quarry
 *   4) equipment 5    — press, injection_molding, shear_bender, roller, pressure_vessel
 *   5) hazards 2      — dust_explosion, psychosocial_stress
 *   6) KOSHA guides ~420 — scope.json out_of_domain (B-E/B-M/H/P/M/O/W + 조선업 B-5/B-6)
 *   7) industrial-equipment.json — 데드 데이터 (코드 미참조, 비건설 명시)
 */

import { readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ── 도메인 노드 삭제 대상 @id ──────────────────────────────────────────
const REMOVED_IDS = new Set<string>([
  // equipment 5
  "equipment:injection_molding",
  "equipment:press",
  "equipment:shear_bender",
  "equipment:roller",
  "equipment:pressure_vessel",
  // activity 4
  "activity:chemical_facility",
  "activity:railway_maintenance",
  "activity:railway_shunting",
  "activity:quarry",
  // documents 9
  "doc:annual/customer_violence_prevention_plan",
  "doc:annual/process_safety_management",
  "doc:ad_hoc/epidemiological_investigation_report",
  "doc:ad_hoc/work_plan_railway_maintenance",
  "doc:ad_hoc/work_plan_railway_shunting",
  "doc:ad_hoc/work_plan_quarry",
  "doc:ad_hoc/work_plan_chemical_facility",
  "doc:ad_hoc/hazardous_risk_prevention_plan_industrial",
  "doc:ad_hoc/hazardous_risk_prevention_plan_machinery",
  // hazards 2
  "hazard:dust_explosion",
  "hazard:psychosocial_stress",
]);

// ── 파일 단위 삭제 (도메인 노드) ────────────────────────────────────────
const REMOVED_FILES_REL = [
  "ontology/graph/nodes/equipment/injection_molding.jsonld",
  "ontology/graph/nodes/equipment/press.jsonld",
  "ontology/graph/nodes/equipment/shear_bender.jsonld",
  "ontology/graph/nodes/equipment/roller.jsonld",
  "ontology/graph/nodes/equipment/pressure_vessel.jsonld",
  "ontology/graph/nodes/activities/chemical_facility.jsonld",
  "ontology/graph/nodes/activities/railway_maintenance.jsonld",
  "ontology/graph/nodes/activities/railway_shunting.jsonld",
  "ontology/graph/nodes/activities/quarry.jsonld",
  "ontology/graph/nodes/documents/customer-violence-prevention-plan.jsonld",
  "ontology/graph/nodes/documents/process-safety-management.jsonld",
  "ontology/graph/nodes/documents/epidemiological-investigation-report.jsonld",
  "ontology/graph/nodes/documents/work-plan-railway-maintenance.jsonld",
  "ontology/graph/nodes/documents/work-plan-railway-shunting.jsonld",
  "ontology/graph/nodes/documents/work-plan-quarry.jsonld",
  "ontology/graph/nodes/documents/work-plan-chemical-facility.jsonld",
  "ontology/graph/nodes/documents/hazardous-risk-prevention-plan-industrial.jsonld",
  "ontology/graph/nodes/documents/hazardous-risk-prevention-plan-machinery.jsonld",
  "ontology/graph/nodes/hazards/dust_explosion.jsonld",
  "ontology/graph/nodes/hazards/psychosocial_stress.jsonld",
  // 데드 데이터
  "ontology/industrial-equipment.json",
];

// ── KOSHA out_of_domain 가이드 prefix (scope.json과 일치) ───────────────
const KOSHA_OUT_OF_DOMAIN_PREFIXES = [
  /^B-E-/i,
  /^B-M-/i,
  /^B-5/i,   // 조선업 안전점검
  /^B-6/i,   // 부선 안전작업
  /^H-/i,
  /^P-/i,
  /^M-/i,
  /^O-/i,
  /^W-/i,
];

function isKoshaOutOfDomain(filename: string): boolean {
  return KOSHA_OUT_OF_DOMAIN_PREFIXES.some((rx) => rx.test(filename));
}

// ── 재귀적으로 객체/배열 내 문자열 배열에서 REMOVED_IDS + 삭제될 KOSHA guide @id 제거 ──
function pruneIds(node: unknown, removedKoshaIds: Set<string>): { changed: boolean; value: unknown } {
  if (Array.isArray(node)) {
    let changed = false;
    const out: unknown[] = [];
    for (const item of node) {
      if (typeof item === "string" && (REMOVED_IDS.has(item) || removedKoshaIds.has(item))) {
        changed = true;
        continue;
      }
      const sub = pruneIds(item, removedKoshaIds);
      if (sub.changed) changed = true;
      out.push(sub.value);
    }
    return { changed, value: out };
  }
  if (node && typeof node === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const sub = pruneIds(v, removedKoshaIds);
      if (sub.changed) changed = true;
      out[k] = sub.value;
    }
    return { changed, value: out };
  }
  return { changed: false, value: node };
}

async function walk(dir: string, files: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(p, files);
    } else if (entry.name.endsWith(".jsonld") || entry.name.endsWith(".json")) {
      files.push(p);
    }
  }
  return files;
}

async function main() {
  const SRC_TAX = resolve(ROOT, "src", "ontology");
  const GUIDES_DIR = resolve(SRC_TAX, "graph", "nodes", "documents", "guides");

  // 1) KOSHA out_of_domain guide 파일 식별 + @id 수집
  const guideFiles = await readdir(GUIDES_DIR);
  const removedKoshaPaths: string[] = [];
  const removedKoshaIds = new Set<string>();
  for (const fname of guideFiles) {
    if (!isKoshaOutOfDomain(fname)) continue;
    const full = resolve(GUIDES_DIR, fname);
    const raw = await readFile(full, "utf-8");
    try {
      const json = JSON.parse(raw);
      if (typeof json["@id"] === "string") removedKoshaIds.add(json["@id"]);
    } catch {
      /* ignore */
    }
    removedKoshaPaths.push(full);
  }
  console.log(`[kosha-scan] out_of_domain guide files: ${removedKoshaPaths.length}`);
  console.log(`[kosha-scan] @id collected: ${removedKoshaIds.size}`);

  // 2) 모든 jsonld/json 파일 순회하여 dangling reference 제거
  const allFiles = await walk(SRC_TAX);
  const removedAbsPaths = new Set([
    ...REMOVED_FILES_REL.map((rel) => resolve(SRC_TAX, "..", rel)),
    ...removedKoshaPaths,
  ]);

  let modified = 0;
  for (const f of allFiles) {
    if (removedAbsPaths.has(f)) continue; // 곧 삭제될 파일은 건너뜀
    const raw = await readFile(f, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = pruneIds(parsed, removedKoshaIds);
    if (result.changed) {
      const indent = raw.match(/^\{\n( +)"/m)?.[1].length ?? 2;
      await writeFile(f, JSON.stringify(result.value, null, indent) + "\n", "utf-8");
      modified += 1;
    }
  }
  console.log(`[prune] modified ${modified} files (dangling refs removed)`);

  // 3) scope.json includedActivities 정리 (이미 1차 라운드에서 처리됨, 멱등)
  const scopePath = resolve(SRC_TAX, "scope.json");
  const scope = JSON.parse(await readFile(scopePath, "utf-8"));
  if (Array.isArray(scope.includedActivities)) {
    const before = scope.includedActivities.length;
    scope.includedActivities = scope.includedActivities.filter((id: string) => !REMOVED_IDS.has(id));
    if (scope.includedActivities.length !== before) {
      scope.updatedAt = new Date().toISOString().slice(0, 10);
      await writeFile(scopePath, JSON.stringify(scope, null, 2) + "\n", "utf-8");
      console.log(`[scope] includedActivities: ${before} → ${scope.includedActivities.length}`);
    }
  }

  // 4) 노드 파일 삭제 (src + build)
  let deletedDomain = 0;
  for (const rel of REMOVED_FILES_REL) {
    for (const base of [resolve(ROOT, "src"), resolve(ROOT, "build")]) {
      const full = resolve(base, rel);
      try {
        await stat(full);
        await unlink(full);
        deletedDomain += 1;
      } catch {
        /* 없으면 무시 */
      }
    }
  }
  console.log(`[delete] domain nodes removed: ${deletedDomain} files (src+build)`);

  // 5) KOSHA out_of_domain guide 삭제 (src + build)
  let deletedKosha = 0;
  for (const full of removedKoshaPaths) {
    const fname = relative(GUIDES_DIR, full);
    for (const base of [
      resolve(GUIDES_DIR),
      resolve(ROOT, "build", "ontology", "graph", "nodes", "documents", "guides"),
    ]) {
      const path = resolve(base, fname);
      try {
        await stat(path);
        await unlink(path);
        deletedKosha += 1;
      } catch {
        /* 없으면 무시 */
      }
    }
  }
  console.log(`[delete] KOSHA out_of_domain guides removed: ${deletedKosha} files (src+build)`);

  console.log("\n[done] non-construction ontology nodes purged.");
  console.log("       법률 본문(articles/annexes/chapters/acts/penalties/applicabilities/cycles)은 보존");
  console.log("       run `npm run verify-graph` to confirm graph integrity.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
