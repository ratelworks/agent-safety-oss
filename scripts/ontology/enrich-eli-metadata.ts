#!/usr/bin/env tsx
/**
 * enrich-eli-metadata.ts
 *
 * Article/Annex 노드에 schema.org Legislation + ELI 메타 자동 채움.
 * partOf 가 가리키는 Act 노드에서 legislationDate / legislationType / legalForce / jurisdiction 상속.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ACTS_DIR = resolve(NODES_DIR, "acts");

interface ActMeta {
  legislationIdentifier: string;
  legislationDate: string;
  legislationType: string;
  legislationLegalForce: string;
  jurisdiction: string;
  temporalCoverage: string;
}

(async () => {
  const actIndex = new Map<string, ActMeta>();
  for (const f of await readdir(ACTS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(ACTS_DIR, f), "utf8")) as Record<string, unknown> & {
      "@id": string;
      _meta?: Record<string, unknown>;
    };
    actIndex.set(node["@id"], {
      legislationIdentifier: String(node.legislationIdentifier ?? ""),
      legislationDate: String(node.legislationDate ?? ""),
      legislationType: String(node.legislationType ?? "Act"),
      legislationLegalForce: String((node._meta as { legalForce?: string })?.legalForce ?? "InForce"),
      jurisdiction: String((node._meta as { jurisdiction?: string })?.jurisdiction ?? "KR"),
      temporalCoverage: String(node.temporalCoverage ?? ""),
    });
  }
  console.log(`[acts] ${actIndex.size} 개 Act 노드 인덱싱`);

  let updated = 0;

  for (const subdir of ["articles", "annexes"]) {
    const dir = resolve(NODES_DIR, subdir);
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".jsonld")) continue;
      const path = resolve(dir, f);
      const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
        "@id": string;
        partOf: string;
      };
      const act = actIndex.get(node.partOf);
      if (!act) {
        console.warn(`[skip] ${f} — partOf '${node.partOf}' Act 노드 부재`);
        continue;
      }
      let changed = false;
      if (!node.legislationIdentifier) {
        node.legislationIdentifier = act.legislationIdentifier;
        changed = true;
      }
      if (!node.legislationDate) {
        node.legislationDate = act.legislationDate;
        changed = true;
      }
      if (!node.legislationType) {
        node.legislationType = act.legislationType;
        changed = true;
      }
      if (!node.legislationLegalForce) {
        node.legislationLegalForce = act.legislationLegalForce;
        changed = true;
      }
      if (!node.jurisdiction) {
        node.jurisdiction = act.jurisdiction;
        changed = true;
      }
      if (!node.temporalCoverage) {
        node.temporalCoverage = act.temporalCoverage;
        changed = true;
      }
      if (changed) {
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
        updated += 1;
      }
    }
  }

  console.log(`[done] ${updated} 개 Article/Annex 노드 ELI 메타 채움`);
})();
