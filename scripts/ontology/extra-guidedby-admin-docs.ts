#!/usr/bin/env tsx
/**
 * extra-guidedby-admin-docs.ts
 * 행정 문서 12개에 KOSHA 가이드 매핑 보강.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const PATCHES: Array<{ file: string; guidedBy: string[] }> = [
  { file: "documents/asbestos-investigation-report.jsonld",
    guidedBy: ["doc:kosha_guide/H-70-2020", "doc:kosha_guide/H-193-2021", "doc:kosha_guide/H-199-2018"] },
  { file: "documents/construction-disaster-prevention-guidance.jsonld",
    guidedBy: ["doc:kosha_guide/C-108-2017"] },
  { file: "documents/health-examination-followup.jsonld",
    guidedBy: ["doc:kosha_guide/H-4-2021", "doc:kosha_guide/H-50-2021"] },
  { file: "documents/industrial-physician-appointment.jsonld",
    guidedBy: ["doc:kosha_guide/H-4-2021"] },
  { file: "documents/safety-certification-application.jsonld",
    guidedBy: ["doc:kosha_guide/M-137-2023"] },
  { file: "documents/safety-health-diagnosis-report.jsonld",
    guidedBy: ["doc:kosha_guide/A-1-2018"] },
  { file: "documents/safety-health-information-provision.jsonld",
    guidedBy: ["doc:kosha_guide/H-158-2021"] },
  { file: "documents/safety-inspection-application.jsonld",
    guidedBy: ["doc:kosha_guide/M-137-2023"] },
  { file: "documents/signaler-appointment.jsonld",
    guidedBy: ["doc:kosha_guide/M-90-2011", "doc:kosha_guide/M-91-2012"] },
  { file: "documents/voluntary-safety-confirmation-filing.jsonld",
    guidedBy: ["doc:kosha_guide/M-137-2023"] },
  { file: "documents/temporary-electric-inspection.jsonld",
    guidedBy: ["doc:kosha_guide/B-E-7-2025"] },
  { file: "documents/work-environment-measurement-notification.jsonld",
    guidedBy: ["doc:kosha_guide/H-75-2015"] },
];

async function main() {
  let added = 0;
  for (const p of PATCHES) {
    const path = resolve(ROOT, "src", "ontology", "graph", "nodes", p.file);
    try {
      const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
      const cur = (node.guidedBy as string[] | undefined) ?? [];
      let inc = 0;
      for (const g of p.guidedBy) {
        if (!cur.includes(g)) {
          cur.push(g);
          inc += 1;
        }
      }
      if (inc > 0) {
        node.guidedBy = cur;
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
        added += inc;
        console.log(`  ✓ ${p.file}: +${inc} edges`);
      }
    } catch (err) {
      console.warn(`  skip ${p.file}: ${(err as Error).message}`);
    }
  }
  console.log(`[done] ${added} guidedBy edges added`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
