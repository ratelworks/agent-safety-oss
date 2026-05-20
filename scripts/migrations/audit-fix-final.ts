#!/usr/bin/env tsx
/**
 * 최종 보강
 * - act 노드에 hasPenalty 추가 (penalty.partOf 역참조 9건)
 * - 모든 의무문서(66종)에 informedBy: src:kosha_portal 추가 → manual·facetGroup·facet 도달
 * - context.jsonld hasPenalty term 추가
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const PENALTY_DIR = resolve(ROOT, "src/ontology/graph/nodes/penalties");
const ACT_DIR = resolve(ROOT, "src/ontology/graph/nodes/acts");
const DOC_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents");
const CONTEXT = resolve(ROOT, "src/ontology/graph/context.jsonld");

async function patchContext() {
  const ctx = JSON.parse(await readFile(CONTEXT, "utf-8"));
  if (!ctx["@context"].hasPenalty) {
    ctx["@context"].hasPenalty = { "@id": "safety:hasPenalty", "@type": "@id", "@container": "@set" };
    await writeFile(CONTEXT, JSON.stringify(ctx, null, 2) + "\n", "utf-8");
  }
}

async function fixActHasPenalty() {
  const byAct: Record<string, string[]> = {};
  for (const f of await readdir(PENALTY_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(PENALTY_DIR, f), "utf-8"));
    const part = node.partOf;
    if (typeof part === "string") {
      if (!byAct[part]) byAct[part] = [];
      byAct[part].push(node["@id"]);
    }
  }
  let updated = 0;
  for (const [actIri, penalties] of Object.entries(byAct)) {
    const slug = actIri.replace(/^act:/, "");
    const path = resolve(ACT_DIR, `${slug}.jsonld`);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      const cur: string[] = node.hasPenalty ?? [];
      let added = 0;
      for (const p of penalties) if (!cur.includes(p)) { cur.push(p); added++; }
      if (added > 0) {
        node.hasPenalty = cur;
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
        updated++;
      }
    } catch (err) {
      console.warn(`  ✗ ${actIri}: ${(err as Error).message}`);
    }
  }
  return updated;
}

async function linkAllDocsToKoshaPortal() {
  // 의무문서(66종, KOSHA Guide 800+ 제외) 모두에 informedBy: src:kosha_portal 추가
  // → BFS 도달성 회복: doc → src:kosha_portal → facet group → facet
  let updated = 0;
  for (const f of await readdir(DOC_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOC_DIR, f);
    const node = JSON.parse(await readFile(path, "utf-8"));
    const cur: string[] = node.informedBy ?? [];
    if (!cur.includes("src:kosha_portal")) {
      cur.push("src:kosha_portal");
      node.informedBy = cur;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      updated++;
    }
  }
  return updated;
}

async function main() {
  await patchContext();
  console.log("[1] context.jsonld hasPenalty term 추가");
  const acts = await fixActHasPenalty();
  console.log(`[2] act → hasPenalty 양방향 (${acts}개 act 업데이트)`);
  const docs = await linkAllDocsToKoshaPortal();
  console.log(`[3] 의무문서 → src:kosha_portal informedBy (${docs}개 doc 업데이트)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
