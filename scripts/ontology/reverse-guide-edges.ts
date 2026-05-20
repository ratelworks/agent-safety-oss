#!/usr/bin/env tsx
/**
 * reverse-guide-edges.ts
 *
 * KOSHA 가이드의 outgoing edge 자동 보강 (현재 35% → 목표 80%+).
 *
 * Reverse 매핑:
 *   1. hazard.guidedBy(가이드들) → 각 가이드의 causedBy = [해당 hazard]
 *   2. activity.guidedBy(가이드들) → 각 가이드의 appliesToActivities = [해당 activity]
 *   3. equipment.guidedBy(가이드들) → 각 가이드의 appliesToActivities = [해당 equipment]
 *
 * Transitive (가이드.mitigatedBy):
 *   가이드 G가 hazard H를 다루고, H가 control C로 mitigated되면 → G.mitigatedBy ⊇ {C}
 *   상위 5개 control만 추가 (over-link 방지).
 *
 * 기존 outgoing edge 보존 + 새로 추가만.
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");

async function loadDir(name: string): Promise<Map<string, { path: string; node: any }>> {
  const dir = resolve(NODES, name);
  const map = new Map<string, { path: string; node: any }>();
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(dir, f);
    const node = JSON.parse(await readFile(p, "utf-8"));
    if (node["@id"]) map.set(node["@id"], { path: p, node });
  }
  return map;
}

async function loadGuides(): Promise<Map<string, { path: string; node: any }>> {
  const dir = resolve(NODES, "documents", "guides");
  const map = new Map<string, { path: string; node: any }>();
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(dir, f);
    const node = JSON.parse(await readFile(p, "utf-8"));
    if (node["@id"]) map.set(node["@id"], { path: p, node });
  }
  return map;
}

async function main() {
  const hazards = await loadDir("hazards");
  const activities = await loadDir("activities");
  const equipment = await loadDir("equipment");
  const guides = await loadGuides();

  console.log(`hazards: ${hazards.size}, activities: ${activities.size}, equipment: ${equipment.size}, guides: ${guides.size}`);

  // 1) hazard.guidedBy → guide.causedBy
  const guideToHazards = new Map<string, Set<string>>();
  for (const [hazId, { node }] of hazards) {
    for (const g of (node.guidedBy ?? []) as string[]) {
      if (!guideToHazards.has(g)) guideToHazards.set(g, new Set());
      guideToHazards.get(g)!.add(hazId);
    }
  }
  // 2) activity.guidedBy → guide.appliesToActivities
  const guideToActivities = new Map<string, Set<string>>();
  for (const [actId, { node }] of activities) {
    for (const g of (node.guidedBy ?? []) as string[]) {
      if (!guideToActivities.has(g)) guideToActivities.set(g, new Set());
      guideToActivities.get(g)!.add(actId);
    }
  }
  // 3) equipment.guidedBy → guide.appliesToActivities (장비도 같은 필드로)
  for (const [eqId, { node }] of equipment) {
    for (const g of (node.guidedBy ?? []) as string[]) {
      if (!guideToActivities.has(g)) guideToActivities.set(g, new Set());
      guideToActivities.get(g)!.add(eqId);
    }
  }
  // 4) hazard.mitigatedBy 인덱스 (가이드 mitigatedBy transitive 추론용)
  const hazardToControls = new Map<string, string[]>();
  for (const [hazId, { node }] of hazards) {
    hazardToControls.set(hazId, (node.mitigatedBy ?? []) as string[]);
  }

  // 5) 각 가이드에 적용
  let causedAdded = 0;
  let appliesAdded = 0;
  let mitigatedAdded = 0;
  let updated = 0;

  for (const [guideId, { path, node }] of guides) {
    let changed = false;

    // causedBy
    const newHazards = guideToHazards.get(guideId);
    if (newHazards && newHazards.size > 0) {
      const cur = new Set((node.causedBy ?? []) as string[]);
      const before = cur.size;
      for (const h of newHazards) cur.add(h);
      if (cur.size > before) {
        node.causedBy = [...cur];
        causedAdded += cur.size - before;
        changed = true;
      }
    }

    // appliesToActivities (장비/활동 union)
    const newActs = guideToActivities.get(guideId);
    if (newActs && newActs.size > 0) {
      const cur = new Set((node.appliesToActivities ?? []) as string[]);
      const before = cur.size;
      for (const a of newActs) cur.add(a);
      if (cur.size > before) {
        node.appliesToActivities = [...cur];
        appliesAdded += cur.size - before;
        changed = true;
      }
    }

    // mitigatedBy (transitive — hazard 통해 control)
    if (newHazards) {
      const mitSet = new Set((node.mitigatedBy ?? []) as string[]);
      const beforeM = mitSet.size;
      for (const h of newHazards) {
        const ctrls = hazardToControls.get(h) ?? [];
        // 상위 5개만 (over-link 방지)
        for (const c of ctrls.slice(0, 5)) mitSet.add(c);
      }
      if (mitSet.size > beforeM) {
        node.mitigatedBy = [...mitSet];
        mitigatedAdded += mitSet.size - beforeM;
        changed = true;
      }
    }

    if (changed) {
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      updated += 1;
    }
  }

  console.log(`\n[done] guide outgoing edges populated`);
  console.log(`  guides updated:        ${updated} / ${guides.size}`);
  console.log(`  causedBy edges added:  ${causedAdded}`);
  console.log(`  appliesToActivities:   ${appliesAdded}`);
  console.log(`  mitigatedBy (transitive): ${mitigatedAdded}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
