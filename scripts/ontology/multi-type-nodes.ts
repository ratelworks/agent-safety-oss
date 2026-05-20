#!/usr/bin/env tsx
/**
 * multi-type-nodes.ts
 *
 * 노드의 @type 을 schema.org 호환 배열로 다중 부여.
 * - Act       → ["Act", "Legislation"]
 * - Article   → ["Article", "Legislation"]
 * - Annex     → ["Annex", "Legislation"]
 * - Penalty   → ["Penalty", "Legislation"]
 * - Document  → ["Document", "DigitalDocument"]
 * - Activity  → ["Activity", "Action"]
 *
 * P11-1 진짜 온톨로지 — schema.org validator 통과 가능.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");

const TYPE_MAP: Record<string, string[]> = {
  Act: ["Act", "Legislation"],
  Article: ["Article", "Legislation"],
  Annex: ["Annex", "Legislation"],
  Penalty: ["Penalty", "Legislation"],
  Document: ["Document", "DigitalDocument"],
  Activity: ["Activity", "Action"],
};

(async () => {
  let updated = 0;
  const visit = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, e.name);
      if (e.isDirectory()) await visit(path);
      else if (e.name.endsWith(".jsonld")) {
        const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & { "@type"?: unknown };
        const cur = node["@type"];
        const curStr = typeof cur === "string" ? cur : Array.isArray(cur) ? cur[0] : null;
        if (typeof curStr !== "string") continue;
        const newType = TYPE_MAP[curStr];
        if (!newType) continue;
        node["@type"] = newType;
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
        updated += 1;
      }
    }
  };
  await visit(NODES);
  console.log(`[done] ${updated} 개 노드 @type 다중 부여 (schema.org Legislation/DigitalDocument/Action 호환)`);
})();
