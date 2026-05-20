/**
 * fix-graph-violations.ts
 *
 * SHACL 위반 중 데이터 결손(Shape enum 불일치 아닌 진짜 누락) 일괄 보강.
 *
 * 1. Annex annexKind None 26건 → 노드 @id 패턴으로 자동 분류
 * 2. Hazard category None 8건 + mitigatedBy None 8건 → 표준 매핑
 * 3. DocumentShape iso45001Class None 2건 (work_permit·work_plan 일반 매핑)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");

// === 1. Annex annexKind 추론 ===
function inferAnnexKind(id: string, title: string): string | null {
  const haystack = `${id} ${title}`;
  if (/별표/.test(haystack)) return "별표";
  if (/별지/.test(haystack)) return "별지";
  if (/별첨/.test(haystack)) return "별첨";
  if (/서식/.test(haystack)) return "서식";
  return null;
}

// === 2. Hazard 매핑 ===
// 실제 controls 디렉토리에 존재하는 노드만 매핑 (dangling 회피)
const HAZARD_FIX: Record<string, { category: string; mitigatedBy?: string[] }> = {
  "hazard:burn": { category: "physical", mitigatedBy: ["control:ppe_chemical_suit", "control:eng_fire_suppression"] },
  "hazard:caught_in": { category: "physical", mitigatedBy: ["control:eng_interlock", "control:eng_machine_guard", "control:admin_supervisor"] },
  "hazard:dust": { category: "chemical", mitigatedBy: ["control:ppe_respirator", "control:eng_ventilation"] },
  "hazard:electrocution": { category: "physical", mitigatedBy: ["control:eng_insulation", "control:eng_loto", "control:ppe_insulating_gloves"] },
  "hazard:falling_object": { category: "physical", mitigatedBy: ["control:eng_fall_net", "control:ppe_helmet"] },
  "hazard:noise": { category: "physical", mitigatedBy: ["control:ppe_hearing_protection", "control:eng_noise_barrier"] },
};

interface Stats {
  annexKindFixed: number;
  hazardCategoryFixed: number;
  hazardMitigatedByFixed: number;
  documentIsoFixed: number;
  errors: string[];
}

function walkDir(dir: string): string[] {
  const out: string[] = [];
  if (!exists(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walkDir(p));
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}
function exists(p: string): boolean {
  try { statSync(p); return true; } catch { return false; }
}

function main(): void {
  const stats: Stats = { annexKindFixed: 0, hazardCategoryFixed: 0, hazardMitigatedByFixed: 0, documentIsoFixed: 0, errors: [] };

  // 1. Annex
  const annexDir = join(NODES_DIR, "annexes");
  for (const file of walkDir(annexDir)) {
    let node: any;
    try { node = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    if (node.annexKind) continue;
    const inferred = inferAnnexKind(node["@id"] ?? "", node.title ?? "");
    if (inferred) {
      node.annexKind = inferred;
      if (!DRY) writeFileSync(file, JSON.stringify(node, null, 2) + "\n", "utf8");
      stats.annexKindFixed++;
    } else {
      stats.errors.push(`annexKind 추론 실패: ${node["@id"]}`);
    }
  }

  // 2. Hazard
  const hazardDir = join(NODES_DIR, "hazards");
  for (const file of walkDir(hazardDir)) {
    let node: any;
    try { node = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    const id = node["@id"];
    const fix = HAZARD_FIX[id];
    if (!fix) continue;
    let changed = false;
    if (!node.category) {
      node.category = fix.category;
      stats.hazardCategoryFixed++;
      changed = true;
    }
    if ((!node.mitigatedBy || (Array.isArray(node.mitigatedBy) && node.mitigatedBy.length === 0)) && fix.mitigatedBy) {
      node.mitigatedBy = fix.mitigatedBy;
      stats.hazardMitigatedByFixed++;
      changed = true;
    }
    if (changed && !DRY) writeFileSync(file, JSON.stringify(node, null, 2) + "\n", "utf8");
  }

  // 3. Document ad_hoc/work_permit·work_plan iso45001Class
  // doc:ad_hoc/work_permit → Permit, doc:ad_hoc/work_plan → Risk
  const docDir = join(NODES_DIR, "documents");
  const docFixes: Record<string, string> = {
    "doc:ad_hoc/work_permit": "iso45001:Permit",
    "doc:ad_hoc/work_plan": "iso45001:Risk",
  };
  for (const file of walkDir(docDir)) {
    let node: any;
    try { node = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    const id = node["@id"];
    const iso = docFixes[id];
    if (!iso) continue;
    if (!node.iso45001Class) {
      node.iso45001Class = iso;
      stats.documentIsoFixed++;
      if (!DRY) writeFileSync(file, JSON.stringify(node, null, 2) + "\n", "utf8");
    }
  }

  console.log(`=== 그래프 위반 보강 ${DRY ? "(DRY RUN)" : ""} ===`);
  console.log(JSON.stringify(stats, null, 2));
}

main();
