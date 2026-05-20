#!/usr/bin/env tsx
/**
 * sync-reverse-edges.ts
 *
 * Document.legalBasis 정방향 → Article/Annex 의 legalBasisOf/specifies 역방향 자동 보정.
 * 양방향 일관성 확보 — query_legal_basis 가 두 방향 어디서든 정확 응답.
 *
 * a-codex P0-3 권고 반영. enrich-graph-iris 다음 단계로 자동 실행 권장.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");
const DOCS_DIR = resolve(NODES_DIR, "documents");
const ARTICLES_DIR = resolve(NODES_DIR, "articles");
const ANNEXES_DIR = resolve(NODES_DIR, "annexes");

(async () => {
  // 1. Document.legalBasis 모두 수집 → 역방향 매핑 build
  const reverseMap = new Map<string, Set<string>>(); // articleIri → docIris
  const docFiles = (await readdir(DOCS_DIR)).filter((f) => f.endsWith(".jsonld"));
  for (const f of docFiles) {
    const node = JSON.parse(await readFile(resolve(DOCS_DIR, f), "utf8")) as {
      "@id": string;
      legalBasis?: string[];
    };
    for (const target of node.legalBasis ?? []) {
      if (!reverseMap.has(target)) reverseMap.set(target, new Set());
      reverseMap.get(target)!.add(node["@id"]);
    }
  }

  console.log(`[reverse-map] ${reverseMap.size} 개 Article/Annex 가 Document에서 참조됨`);

  // 2. Article 노드 — legalBasisOf 갱신
  let articleUpdated = 0;
  for (const f of await readdir(ARTICLES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ARTICLES_DIR, f);
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      "@id": string;
      legalBasisOf?: string[];
    };
    const refs = reverseMap.get(node["@id"]);
    if (!refs) continue;
    const newSet = new Set([...(node.legalBasisOf ?? []), ...refs]);
    const arr = Array.from(newSet).sort();
    if (JSON.stringify(arr) !== JSON.stringify(node.legalBasisOf ?? [])) {
      node.legalBasisOf = arr;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
      articleUpdated += 1;
    }
  }

  // 3. Annex 노드 — specifies 갱신
  let annexUpdated = 0;
  for (const f of await readdir(ANNEXES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ANNEXES_DIR, f);
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      "@id": string;
      specifies?: string[];
    };
    const refs = reverseMap.get(node["@id"]);
    if (!refs) continue;
    const newSet = new Set([...(node.specifies ?? []), ...refs]);
    const arr = Array.from(newSet).sort();
    if (JSON.stringify(arr) !== JSON.stringify(node.specifies ?? [])) {
      node.specifies = arr;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
      annexUpdated += 1;
    }
  }

  console.log(`[done] articleUpdated=${articleUpdated}, annexUpdated=${annexUpdated}`);
})();
