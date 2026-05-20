#!/usr/bin/env tsx
/**
 * inherit-hazards-from-activities.ts
 *
 * 가이드.appliesToActivities 활동들의 hasHazard를 가이드.causedBy로 transitive inherit.
 * P3 후 잔여: causedBy 채워지지 않은 ~340개 가이드 보강.
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");

async function main() {
  // activity → hasHazard 인덱스
  const actHazard = new Map<string, string[]>();
  for (const f of await readdir(resolve(NODES, "activities"))) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(NODES, "activities", f), "utf-8"));
    if (node["@id"]) actHazard.set(node["@id"], (node.hasHazard ?? []) as string[]);
  }
  // equipment → hasHazard 인덱스
  for (const f of await readdir(resolve(NODES, "equipment"))) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(NODES, "equipment", f), "utf-8"));
    if (node["@id"]) actHazard.set(node["@id"], (node.hasHazard ?? []) as string[]);
  }
  // hazard → mitigatedBy 인덱스 (transitive control)
  const hazControls = new Map<string, string[]>();
  for (const f of await readdir(resolve(NODES, "hazards"))) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(NODES, "hazards", f), "utf-8"));
    if (node["@id"]) hazControls.set(node["@id"], (node.mitigatedBy ?? []) as string[]);
  }

  const guidesDir = resolve(NODES, "documents", "guides");
  let updated = 0, causedAdded = 0, mitAdded = 0;

  for (const f of await readdir(guidesDir)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(guidesDir, f);
    const node = JSON.parse(await readFile(path, "utf-8"));
    let changed = false;

    const apps = (node.appliesToActivities ?? []) as string[];
    if (apps.length === 0) continue;

    // Inherit hasHazard from each activity/equipment
    const causedSet = new Set((node.causedBy ?? []) as string[]);
    const beforeC = causedSet.size;
    for (const a of apps) {
      for (const h of actHazard.get(a) ?? []) causedSet.add(h);
    }
    if (causedSet.size > beforeC) {
      node.causedBy = [...causedSet];
      causedAdded += causedSet.size - beforeC;
      changed = true;
    }

    // Transitive: causedBy hazards → mitigatedBy controls (top 5/hazard)
    const mitSet = new Set((node.mitigatedBy ?? []) as string[]);
    const beforeM = mitSet.size;
    for (const h of causedSet) {
      const ctrls = hazControls.get(h) ?? [];
      for (const c of ctrls.slice(0, 5)) mitSet.add(c);
    }
    if (mitSet.size > beforeM) {
      node.mitigatedBy = [...mitSet];
      mitAdded += mitSet.size - beforeM;
      changed = true;
    }

    if (changed) {
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      updated += 1;
    }
  }

  console.log(`[done] ${updated} guides updated`);
  console.log(`  causedBy added (transitive):    ${causedAdded}`);
  console.log(`  mitigatedBy added (transitive): ${mitAdded}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
