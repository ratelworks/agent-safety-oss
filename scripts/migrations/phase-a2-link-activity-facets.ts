#!/usr/bin/env tsx
/**
 * Phase A-2 Step 3: facet → activity 매핑을 역링크로 activity 노드에 주입
 *
 * 신입이 generate_safety_document(work_plan_excavation) 호출 시
 * activity:excavation_2m_plus → koshaArchiveFacets: [facet:ctgr03/04, ...]
 * → graphContext에 facet IRI 노출 → LLM이 search_kosha_archive ctgr03=04로 자료실 진입
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const FACET_NODES = resolve(ROOT, "src/ontology/graph/nodes/facets/code");
const ACTIVITY_NODES = resolve(ROOT, "src/ontology/graph/nodes/activities");
const HAZARD_NODES = resolve(ROOT, "src/ontology/graph/nodes/hazards");
const EVENT_NODES = resolve(ROOT, "src/ontology/graph/nodes/events");
const EQUIPMENT_NODES = resolve(ROOT, "src/ontology/graph/nodes/equipment");

import { readdir } from "node:fs/promises";

async function indexFacets() {
  const reverse: Record<string, string[]> = {}; // targetIri → [facetIri]
  for (const f of await readdir(FACET_NODES)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(FACET_NODES, f), "utf-8"));
    const facetIri: string = node["@id"];
    const collect = (key: string) => {
      const arr = node[key];
      if (Array.isArray(arr)) for (const t of arr) {
        if (typeof t === "string") {
          if (!reverse[t]) reverse[t] = [];
          if (!reverse[t].includes(facetIri)) reverse[t].push(facetIri);
        }
      }
    };
    collect("appliesToActivities");
    collect("hasHazard");
    collect("references");
    collect("involves");
  }
  return reverse;
}

async function patchNodes(dir: string, prefix: string, reverse: Record<string, string[]>) {
  let updated = 0, edges = 0;
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(dir, f);
    const node = JSON.parse(await readFile(path, "utf-8"));
    const targetIri = `${prefix}:${f.replace(/\.jsonld$/, "")}`;
    const facets = reverse[targetIri];
    if (!facets || facets.length === 0) continue;
    const cur: string[] = node.koshaArchiveFacets ?? [];
    let added = 0;
    for (const fi of facets) {
      if (!cur.includes(fi)) { cur.push(fi); added++; }
    }
    if (added > 0) {
      node.koshaArchiveFacets = cur;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      updated++;
      edges += added;
    }
  }
  return { updated, edges };
}

async function main() {
  const reverse = await indexFacets();
  console.log(`[index] facet → target reverse map ${Object.keys(reverse).length}개`);

  const a = await patchNodes(ACTIVITY_NODES, "activity", reverse);
  console.log(`  activity: ${a.updated}개 노드 / +${a.edges} edges`);
  const h = await patchNodes(HAZARD_NODES, "hazard", reverse);
  console.log(`  hazard:   ${h.updated}개 노드 / +${h.edges} edges`);
  const e = await patchNodes(EVENT_NODES, "event", reverse);
  console.log(`  event:    ${e.updated}개 노드 / +${e.edges} edges`);
  const eq = await patchNodes(EQUIPMENT_NODES, "equipment", reverse);
  console.log(`  equipment:${eq.updated}개 노드 / +${eq.edges} edges`);

  // context.jsonld에 koshaArchiveFacets 추가
  const ctxPath = resolve(ROOT, "src/ontology/graph/context.jsonld");
  const ctx = JSON.parse(await readFile(ctxPath, "utf-8"));
  if (!ctx["@context"].koshaArchiveFacets) {
    ctx["@context"].koshaArchiveFacets = { "@id": "safety:koshaArchiveFacets", "@type": "@id", "@container": "@set" };
    await writeFile(ctxPath, JSON.stringify(ctx, null, 2) + "\n", "utf-8");
    console.log("[context] +koshaArchiveFacets term");
  }

  console.log(`\n[done] 역링크 ${a.edges + h.edges + e.edges + eq.edges} edges 추가`);
}

main().catch((e) => { console.error(e); process.exit(1); });
