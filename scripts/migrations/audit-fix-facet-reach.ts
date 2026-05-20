#!/usr/bin/env tsx
/**
 * facet group 도달성 보강
 * - 5 facetGroup 노드에 hasFacet 자식 리스트 주입 (facet → group + group → facets 양방향)
 * - manual:kosha_ms 등 KOSHA 매뉴얼이 5 facetGroup 참조 (의무문서 → manual → facetGroup → facet)
 * - src:kosha_portal 노드에서 5 facetGroup 참조
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const FACET_GROUP_DIR = resolve(ROOT, "src/ontology/graph/nodes/facets/group");
const FACET_CODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/facets/code");
const MANUAL_DIR = resolve(ROOT, "src/ontology/graph/nodes/manuals");
const SOURCE_DIR = resolve(ROOT, "src/ontology/graph/nodes/sources");
const CONTEXT = resolve(ROOT, "src/ontology/graph/context.jsonld");

const ALL_FACET_GROUPS = ["facet:group/ctgr01","facet:group/ctgr02","facet:group/ctgr03","facet:group/ctgr04","facet:group/ctgr05"];

async function patchContext() {
  const ctx = JSON.parse(await readFile(CONTEXT, "utf-8"));
  if (!ctx["@context"].hasFacet) {
    ctx["@context"].hasFacet = { "@id": "safety:hasFacet", "@type": "@id", "@container": "@set" };
    await writeFile(CONTEXT, JSON.stringify(ctx, null, 2) + "\n", "utf-8");
  }
}

async function fixGroups() {
  // group → 자신의 facet 자식 인덱스
  const childrenByGroup: Record<string, string[]> = {};
  for (const f of await readdir(FACET_CODE_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(FACET_CODE_DIR, f), "utf-8"));
    const group = node.facetGroup;
    if (typeof group === "string") {
      if (!childrenByGroup[group]) childrenByGroup[group] = [];
      childrenByGroup[group].push(node["@id"]);
    }
  }
  let updated = 0;
  for (const f of await readdir(FACET_GROUP_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(FACET_GROUP_DIR, f);
    const node = JSON.parse(await readFile(path, "utf-8"));
    const facets = childrenByGroup[node["@id"]] ?? [];
    if (facets.length) {
      node.hasFacet = facets.sort();
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      updated++;
    }
  }
  return updated;
}

async function linkManualToFacets() {
  // manual:kosha_ms 가 KOSHA 본부 매뉴얼이므로 5 facetGroup 참조
  const target = resolve(MANUAL_DIR, "kosha_ms.jsonld");
  const node = JSON.parse(await readFile(target, "utf-8"));
  const cur: string[] = node.references ?? [];
  let added = 0;
  for (const g of ALL_FACET_GROUPS) if (!cur.includes(g)) { cur.push(g); added++; }
  if (added > 0) {
    node.references = cur;
    await writeFile(target, JSON.stringify(node, null, 2) + "\n", "utf-8");
  }
  return added;
}

async function linkSourceToFacets() {
  // src:kosha_portal 가 5 facetGroup 의 출처
  for (const f of await readdir(SOURCE_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(SOURCE_DIR, f);
    const node = JSON.parse(await readFile(path, "utf-8"));
    if (node["@id"] !== "src:kosha_portal") continue;
    const cur: string[] = node.references ?? [];
    let added = 0;
    for (const g of ALL_FACET_GROUPS) if (!cur.includes(g)) { cur.push(g); added++; }
    if (added > 0) {
      node.references = cur;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    }
    return added;
  }
  return 0;
}

async function main() {
  await patchContext();
  console.log("[1] context.jsonld hasFacet term 추가");
  const groups = await fixGroups();
  console.log(`[2] facetGroup 5개에 hasFacet 자식 리스트 주입 (${groups}개 업데이트)`);
  const m = await linkManualToFacets();
  console.log(`[3] manual:kosha_ms → 5 facetGroup references (+${m})`);
  const s = await linkSourceToFacets();
  console.log(`[4] src:kosha_portal → 5 facetGroup references (+${s})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
