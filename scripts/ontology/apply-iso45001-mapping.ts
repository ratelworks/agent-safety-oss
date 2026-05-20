/**
 * apply-iso45001-mapping.ts
 *
 * 94종 documents + 38 hazards + 45 controls 노드에 iso45001Class 키 일괄 추가.
 *
 * 매핑 룰 (docs/JSONLD-AUTHORING-GUIDE.md §5 + iso45001-mapping.jsonld):
 *   - hazards/*       → iso45001:Hazard
 *   - controls/*      → iso45001:Control
 *   - documents/* (카테고리 기반):
 *       A_체제·F_도급·M_인증·N_비용 → iso45001:Workplace (조직·예산·도급)
 *       B_위평·D_작업계획            → iso45001:Risk (위험성평가·작업계획)
 *       C_교육                       → iso45001:Competence
 *       E_작업허가                   → iso45001:Permit
 *       G_점검·I_측정·L_진단         → iso45001:Audit
 *       H_화학                       → iso45001:Hazard (유해물질)
 *       J_건강                       → iso45001:Worker
 *       K_사고                       → iso45001:Incident
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes");
const MASTER_PATH = resolve(__dirname, "../../src/ontology/legal-duty-master.json");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");

const CATEGORY_TO_ISO: Record<string, string> = {
  A_체제: "iso45001:Workplace",
  B_위평: "iso45001:Risk",
  C_교육: "iso45001:Competence",
  D_작업계획: "iso45001:Risk",
  E_작업허가: "iso45001:Permit",
  F_도급: "iso45001:Workplace",
  G_점검: "iso45001:Audit",
  H_화학: "iso45001:Hazard",
  I_측정: "iso45001:Audit",
  J_건강: "iso45001:Worker",
  K_사고: "iso45001:Incident",
  L_진단: "iso45001:Audit",
  M_인증: "iso45001:Workplace",
  N_비용: "iso45001:Workplace",
};

interface Stats {
  processed: number;
  updated: number;
  byClass: Record<string, number>;
  errors: string[];
}

function processDir(dir: string, defaultIso: string | null, useCategory: boolean, master?: Map<string, string>): Stats {
  const stats: Stats = { processed: 0, updated: 0, byClass: {}, errors: [] };
  if (!exists(dir)) return stats;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) continue;
    if (!f.endsWith(".jsonld")) continue;
    let node: any;
    try {
      node = JSON.parse(readFileSync(p, "utf8"));
    } catch (e: any) {
      stats.errors.push(`${f}: parse error ${e?.message}`);
      continue;
    }
    stats.processed++;
    let iso: string | null = null;
    if (useCategory && master) {
      const cat = master.get(node.docId);
      iso = cat ? CATEGORY_TO_ISO[cat] ?? defaultIso : defaultIso;
    } else {
      iso = defaultIso;
    }
    if (!iso) continue;
    if (node.iso45001Class === iso) {
      stats.byClass[iso] = (stats.byClass[iso] ?? 0) + 1;
      continue;
    }
    node.iso45001Class = iso;
    stats.updated++;
    stats.byClass[iso] = (stats.byClass[iso] ?? 0) + 1;
    if (!DRY) writeFileSync(p, JSON.stringify(node, null, 2) + "\n", "utf8");
  }
  return stats;
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  // 마스터 SSoT에서 docId → category 매핑
  const master = JSON.parse(readFileSync(MASTER_PATH, "utf8")) as { documents: Array<{ docId: string; category: string }> };
  const docIdToCat = new Map(master.documents.map((d) => [d.docId, d.category]));

  console.log(`=== ISO 45001 매핑 일괄 적용 ${DRY ? "(DRY RUN)" : ""} ===\n`);

  const results = {
    documents: processDir(join(NODES_DIR, "documents"), null, true, docIdToCat),
    hazards: processDir(join(NODES_DIR, "hazards"), "iso45001:Hazard", false),
    controls: processDir(join(NODES_DIR, "controls"), "iso45001:Control", false),
  };

  for (const [section, st] of Object.entries(results)) {
    console.log(`[${section}] processed=${st.processed} updated=${st.updated}`);
    for (const [k, v] of Object.entries(st.byClass)) {
      console.log(`  ${k}: ${v}`);
    }
    if (st.errors.length > 0) {
      console.log(`  errors:`, st.errors.slice(0, 3));
    }
  }

  console.log("\n다음: scripts/verify/verify-graph-integrity.ts 로 정합성 재확인");
}

main();
