#!/usr/bin/env tsx
/**
 * legalBasis ↔ legalBasisOf inverse 222건 자동 보강
 *
 * 의무문서가 art:* 또는 annex:* 참조 시,
 * 해당 article/annex 노드의 legalBasisOf 에 doc IRI 를 역참조로 추가
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src/ontology/graph/nodes");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const f of await readdir(dir)) {
    const p = resolve(dir, f);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}

async function main() {
  const paths = await walk(NODES);
  const nodes = new Map<string, { path: string; raw: any }>();
  for (const p of paths) {
    try {
      const n = JSON.parse(await readFile(p, "utf-8"));
      if (n["@id"]) nodes.set(n["@id"], { path: p, raw: n });
    } catch {}
  }

  // 인덱스: target IRI (art:/annex:) → [참조하는 노드 IRI 들]
  // doc:* 뿐 아니라 applic:* / method:* / control:* 등 모든 노드의 legalBasis 포함
  const inverseIndex: Record<string, Set<string>> = {};
  for (const [iri, info] of nodes) {
    const lb: string[] = info.raw.legalBasis ?? [];
    for (const target of lb) {
      if (typeof target !== "string") continue;
      if (!nodes.has(target)) continue;
      if (!inverseIndex[target]) inverseIndex[target] = new Set();
      inverseIndex[target].add(iri);
    }
  }

  // 각 target 노드에 legalBasisOf 추가
  let updatedNodes = 0, addedEdges = 0;
  for (const [target, docs] of Object.entries(inverseIndex)) {
    const tNode = nodes.get(target)!;
    const cur: string[] = tNode.raw.legalBasisOf ?? [];
    let added = 0;
    for (const d of docs) {
      if (!cur.includes(d)) { cur.push(d); added++; }
    }
    if (added > 0) {
      tNode.raw.legalBasisOf = cur.sort();
      await writeFile(tNode.path, JSON.stringify(tNode.raw, null, 2) + "\n", "utf-8");
      updatedNodes++;
      addedEdges += added;
    }
  }

  console.log(`[done] ${updatedNodes}개 article/annex 노드 / +${addedEdges} legalBasisOf 엣지 추가`);
}

main().catch((e) => { console.error(e); process.exit(1); });
