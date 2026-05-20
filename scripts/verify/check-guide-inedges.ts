#!/usr/bin/env tsx
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const EDGE_PROPS = ["delegates","references","hasArticle","partOf","hasAnnex","specifies","regulates","penalizedBy","penalizedByDelegated","appliesTo","requires","mitigatedBy","mitigates","causedBy","evaluatedBy","cycledAs","legalBasisOf","legalBasis","penaltyOnMissing","relatedDocs","guidedBy","amendedTo","interpretedBy","auditedBy","informedBy","hasHazard","regulatedBy","cycle"];

async function walk(dir: string, label: string, out: any[]) {
  for (const e of await readdir(dir)) {
    const p = join(dir, e);
    if ((await stat(p)).isDirectory()) await walk(p, label, out);
    else if (e.endsWith(".jsonld")) out.push({ ...JSON.parse(await readFile(p, "utf-8")), _typeLabel: label });
  }
}

(async () => {
  const all: any[] = [];
  for (const t of await readdir(NODES)) {
    const td = join(NODES, t);
    if (!(await stat(td)).isDirectory()) continue;
    await walk(td, t, all);
  }
  const guides = all.filter(n => n["@id"]?.startsWith("doc:kosha_guide"));
  const inEdges = new Map<string, Array<{prop:string; src:string}>>();
  for (const n of all) {
    const id = n["@id"]; if (!id) continue;
    for (const prop of EDGE_PROPS) {
      const v = n[prop]; if (!v) continue;
      const arr = Array.isArray(v) ? v : [v];
      for (const t of arr) if (typeof t === "string") {
        if (!inEdges.has(t)) inEdges.set(t, []);
        inEdges.get(t)!.push({ prop, src: id });
      }
    }
  }
  let used = 0; const unused: string[] = [];
  const propBreakdown = new Map<string, number>();
  for (const g of guides) {
    const ins = inEdges.get(g["@id"]) || [];
    if (ins.length > 0) { used++; for (const i of ins) propBreakdown.set(i.prop, (propBreakdown.get(i.prop)||0)+1); }
    else unused.push(g["@id"]);
  }
  console.log(`Guide nodes: ${guides.length}, with in-edge: ${used}, unused: ${unused.length}`);
  console.log("In-edge prop breakdown:");
  for (const [p,c] of [...propBreakdown.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${p}: ${c}`);
  console.log("\nAll unused:");
  for (const u of unused) {
    const guide = guides.find(g => g["@id"] === u);
    console.log(`  ${u}\t${guide?.title ?? ""}`);
  }
})();
