#!/usr/bin/env tsx
/**
 * connect-kosha-core-nodes.ts
 * KOSHA 핵심 자료 신규 노드 22개 orphan 보강.
 *
 *   1. event 12개 → 사고 의무문서 involves 확장 (12→24)
 *   2. stat 3개 → 사고/안전보건경영 의무문서 cited_in
 *   3. source 4개 → 적절한 의무문서/매뉴얼 isPartOf / references
 *   4. manual 3개 → 적절한 의무문서 informedBy
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");
const STATS = resolve(ROOT, "src", "ontology", "graph", "nodes", "statistics");

const ALL_EVENTS = [
  "event:fall_from_height", "event:trip_slip", "event:overturn_collapse",
  "event:struck_by", "event:fall_object", "event:cave_in",
  "event:caught_in", "event:cut_pierce", "event:electric_shock",
  "event:fire_explosion", "event:msd_overload", "event:chemical_contact",
  "event:asphyxiation", "event:drowning", "event:traffic_accident",
  "event:thermal_burn", "event:noise_vibration", "event:dust_exposure",
  "event:radiation_exposure", "event:violence", "event:job_stress",
  "event:biological_infection", "event:dust_explosion", "event:other",
];

interface Patch {
  doc: string;
  prop: string;
  values: string[];
  replace?: boolean;
}

const PATCHES: Patch[] = [
  // 1) 사고 의무문서 → 모든 24개 event involves
  { doc: "industrial-accident-report",       prop: "involves", values: ALL_EVENTS, replace: true },
  { doc: "severe-accident-immediate-report", prop: "involves", values: ALL_EVENTS, replace: true },
  { doc: "severe-accident-compliance",       prop: "involves", values: ALL_EVENTS },

  // 2) 통계 cited_in (사고/경영 문서가 통계를 인용)
  { doc: "industrial-accident-report",       prop: "cited_in", values: ["stat:construction_fatal_top_5", "stat:industrial_accident_construction_share", "stat:sif_archive_kosha"] },
  { doc: "severe-accident-immediate-report", prop: "cited_in", values: ["stat:construction_fatal_top_5", "stat:sif_archive_kosha"] },
  { doc: "safety-health-management-policy",  prop: "cited_in", values: ["stat:construction_fatal_top_5", "stat:industrial_accident_construction_share"] },
  { doc: "severe-accident-compliance",       prop: "cited_in", values: ["stat:construction_fatal_top_5", "stat:industrial_accident_construction_share"] },
  { doc: "construction-disaster-prevention-guidance", prop: "cited_in", values: ["stat:construction_fatal_top_5", "stat:industrial_accident_construction_share"] },
  { doc: "risk-assessment-procedure",        prop: "cited_in", values: ["stat:sif_archive_kosha"] },

  // 3) sources informedBy (의무문서 출처 명시)
  { doc: "msds-register",                    prop: "informedBy", values: ["src:msds_kosha", "src:kosha_portal"] },
  { doc: "safety-certification-application", prop: "informedBy", values: ["src:moel_safety_inspection", "src:kosha_portal"] },
  { doc: "voluntary-safety-confirmation-filing", prop: "informedBy", values: ["src:moel_safety_inspection"] },
  { doc: "safety-inspection-application",    prop: "informedBy", values: ["src:moel_safety_inspection"] },
  { doc: "safety-health-regulation",         prop: "informedBy", values: ["src:law_go_kr", "src:kosha_portal"] },
  { doc: "legal-summary-posting",            prop: "informedBy", values: ["src:law_go_kr"] },
  { doc: "industrial-accident-report",       prop: "informedBy", values: ["src:data_go_kr", "src:kosha_portal"] },

  // 4) manuals informedBy
  { doc: "safety-health-management-policy",  prop: "informedBy", values: ["manual:kosha_ms"] },
  { doc: "severe-accident-compliance",       prop: "informedBy", values: ["manual:kosha_ms"] },
  { doc: "safety-health-regulation",         prop: "informedBy", values: ["manual:kosha_ms"] },
  { doc: "risk-assessment-procedure",        prop: "informedBy", values: ["manual:risk_assessment_practical"] },
  { doc: "regular-risk-assessment",          prop: "informedBy", values: ["manual:risk_assessment_practical"] },
  { doc: "construction-disaster-prevention-guidance", prop: "informedBy", values: ["manual:construction_disaster_prevention"] },
  { doc: "construction-safety-health-register", prop: "informedBy", values: ["manual:construction_disaster_prevention"] },
];

// statistics에 sourceCitation: src:* 매핑 추가
const STAT_SOURCES: Array<{ stat: string; sources: string[]; events?: string[] }> = [
  { stat: "construction_fatal_top_5",          sources: ["src:kosha_portal"] },
  { stat: "industrial_accident_construction_share", sources: ["src:kosha_portal"] },
  { stat: "sif_archive_kosha",                 sources: ["src:data_go_kr"] },
];

async function main() {
  let edges = 0;
  for (const p of PATCHES) {
    const path = resolve(DOCS, p.doc + ".jsonld");
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      if (p.replace) {
        node[p.prop] = [...p.values];
        edges += p.values.length;
      } else {
        const cur = (node[p.prop] as string[] | undefined) ?? [];
        const before = cur.length;
        for (const v of p.values) if (!cur.includes(v)) cur.push(v);
        node[p.prop] = cur;
        edges += cur.length - before;
      }
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      console.log(`  ✓ ${p.doc}.${p.prop} += ${p.values.length}`);
    } catch (err) {
      console.warn(`  ✗ ${p.doc}: ${(err as Error).message}`);
    }
  }

  // statistics에 isPartOf src 추가
  for (const ss of STAT_SOURCES) {
    const path = resolve(STATS, ss.stat + ".jsonld");
    const node = JSON.parse(await readFile(path, "utf-8"));
    node.isPartOf = ss.sources[0]; // 첫 source를 isPartOf로
    if (ss.events) node.involves = ss.events;
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    edges += 1;
  }

  console.log(`\n[done] ${edges} edges added`);
}

main().catch((err) => { console.error(err); process.exit(1); });
