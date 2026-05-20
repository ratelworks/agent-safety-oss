#!/usr/bin/env tsx
/**
 * dump-graph-issues.ts
 * audit-graph-health 와 동일한 로직으로 dangling refs + orphans 전체 목록을 dump.
 * 커버리지 보강 작업 입력으로 사용.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");

const EDGE_PROPS = [
  "delegates","references","hasArticle","partOf","hasAnnex","specifies",
  "regulates","penalizedBy","penalizedByDelegated","appliesTo","requires",
  "mitigatedBy","mitigates","causedBy","evaluatedBy","cycledAs",
  "legalBasisOf","legalBasis","penaltyOnMissing","relatedDocs",
  "guidedBy","amendedTo","interpretedBy","auditedBy","informedBy",
  "hasHazard","regulatedBy","cycle"
] as const;

interface Node { [k: string]: unknown; "@id"?: string; _file?: string; _typeLabel?: string; }

async function walk(dir: string, label: string, out: Node[]) {
  for (const e of await readdir(dir)) {
    const p = join(dir, e);
    const st = await stat(p);
    if (st.isDirectory()) await walk(p, label, out);
    else if (e.endsWith(".jsonld")) {
      try {
        const node = JSON.parse(await readFile(p, "utf-8")) as Node;
        node._file = p; node._typeLabel = label;
        out.push(node);
      } catch {}
    }
  }
}

function extractRefs(n: Node): Array<{prop:string; target:string}> {
  const refs: Array<{prop:string; target:string}> = [];
  for (const prop of EDGE_PROPS) {
    const v = (n as Record<string, unknown>)[prop];
    if (!v) continue;
    if (typeof v === "string") refs.push({ prop, target: v });
    else if (Array.isArray(v)) for (const t of v) if (typeof t === "string") refs.push({ prop, target: t });
  }
  return refs;
}

(async () => {
  const types = await readdir(NODES_DIR);
  const nodes: Node[] = [];
  for (const t of types) {
    const td = join(NODES_DIR, t);
    if (!(await stat(td)).isDirectory()) continue;
    await walk(td, t, nodes);
  }
  const idx = new Map<string, Node>();
  for (const n of nodes) if (n["@id"]) idx.set(n["@id"]!, n);

  const inEdges = new Map<string, Array<{prop:string; source:string}>>();
  const danglingMap = new Map<string, Array<{source:string; prop:string}>>();
  for (const n of nodes) {
    const id = n["@id"]; if (!id) continue;
    for (const r of extractRefs(n)) {
      if (!inEdges.has(r.target)) inEdges.set(r.target, []);
      inEdges.get(r.target)!.push({ prop: r.prop, source: id });
      if (!idx.has(r.target) && r.target.includes(":")) {
        if (!danglingMap.has(r.target)) danglingMap.set(r.target, []);
        danglingMap.get(r.target)!.push({ source: id, prop: r.prop });
      }
    }
  }

  console.log("=== DANGLING REFS (target | sources) ===");
  for (const [target, srcs] of [...danglingMap.entries()].sort()) {
    console.log(`${target}\n  ← ${srcs.map(s => `${s.source}[${s.prop}]`).join(", ")}`);
  }

  console.log("\n=== ORPHAN NODES (in-degree=0) ===");
  for (const n of nodes) {
    const id = n["@id"]; if (!id) continue;
    if (n._typeLabel === "documents" || n._typeLabel === "graph" || n._typeLabel === "acts") continue;
    if ((inEdges.get(id) || []).length === 0) {
      console.log(`${id}\t${n._typeLabel}`);
    }
  }
})();
