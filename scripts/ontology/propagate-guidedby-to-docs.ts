#!/usr/bin/env tsx
/**
 * propagate-guidedby-to-docs.ts
 *
 * 의무문서 → appliesToActivities → 활동 → guidedBy → 가이드를 의무문서 guidedBy에 inherit.
 *
 * 정책:
 *   1. 작업·검사·도면 문서만 propagate (행정/관리체계는 제외 — 자체 매핑 충분)
 *   2. 활동당 가이드 cap = 20 (over-link 방지)
 *   3. 기존 guidedBy 보존, 새로 inherit하는 가이드만 추가
 *   4. construction(KOSHA scope) 우선, general_applicable 차순위, partial 후순위
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");
const ACTS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "activities");
const GUIDES_DIR = resolve(DOCS_DIR, "guides");

// propagation 대상 docId prefix (작업·점검·도면 위주)
const PROPAGATE_PREFIXES = [
  "work_plan_",
  "work_permit_",
  "_inspection",  // *_inspection_checklist 등
  "_drawing",
  "concrete_placement_plan",
  "aerial_work_platform_plan",
  "fall_prevention_net_inspection",
  "safety_harness_inspection",
  "scaffolding_inspection_checklist",
  "tower_crane_inspection",
  "construction_machinery_inspection",
  "temporary_electric_inspection",
  "temporary_fire_facility_check",
  "earth_retaining_drawing",
  "formwork_shoring_drawing",
  "asbestos_investigation_report",
];

const PER_ACTIVITY_CAP = 20;

function shouldPropagate(docId: string): boolean {
  return PROPAGATE_PREFIXES.some((p) =>
    p.startsWith("_") ? docId.includes(p) : docId.startsWith(p)
  );
}

async function loadActivityGuidedBy(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const f of await readdir(ACTS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(ACTS_DIR, f), "utf-8")) as Record<string, unknown>;
    const id = String(node["@id"] ?? "");
    const guides = (node.guidedBy as string[] | undefined) ?? [];
    map.set(id, guides);
  }
  return map;
}

async function loadGuideScope(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const f of await readdir(GUIDES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(GUIDES_DIR, f), "utf-8")) as Record<string, unknown> & {
      _meta?: { scope?: string };
    };
    const id = String(node["@id"] ?? "");
    const scope = node._meta?.scope ?? "general_applicable";
    map.set(id, scope);
  }
  return map;
}

function scopePriority(scope: string): number {
  if (scope === "construction") return 0;
  if (scope === "general_applicable") return 1;
  if (scope === "construction_partial") return 2;
  return 3;
}

async function main() {
  const actGuidedBy = await loadActivityGuidedBy();
  const guideScope = await loadGuideScope();

  let docsUpdated = 0;
  let docsSkipped = 0;
  let totalNewEdges = 0;

  for (const f of await readdir(DOCS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOCS_DIR, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const docId = String(node.docId ?? "");

    if (!shouldPropagate(docId)) {
      docsSkipped += 1;
      continue;
    }

    const activities = (node.appliesToActivities as string[] | undefined) ?? [];
    if (activities.length === 0) continue;

    const existing = new Set((node.guidedBy as string[] | undefined) ?? []);
    const beforeCount = existing.size;

    // 활동별로 cap만큼 가이드 수집 (scope 우선순위 정렬)
    for (const actId of activities) {
      const actGuides = actGuidedBy.get(actId) ?? [];
      const sorted = [...actGuides].sort(
        (a, b) => scopePriority(guideScope.get(a) ?? "") - scopePriority(guideScope.get(b) ?? "")
      );
      const capped = sorted.slice(0, PER_ACTIVITY_CAP);
      for (const g of capped) existing.add(g);
    }

    if (existing.size > beforeCount) {
      node.guidedBy = [...existing];
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      totalNewEdges += existing.size - beforeCount;
      docsUpdated += 1;
      console.log(`  ✓ ${docId}: ${beforeCount} → ${existing.size} guides (+${existing.size - beforeCount})`);
    }
  }

  console.log(`\n[done] ${docsUpdated} documents updated, ${docsSkipped} skipped (admin docs)`);
  console.log(`       total new guidedBy edges: ${totalNewEdges}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
