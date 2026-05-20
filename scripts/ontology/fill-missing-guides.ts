/**
 * fill-missing-guides.ts
 *
 * 모든 노드 (.jsonld) 의 빈 inputGuide·examples 를 표준 사전(label-standards.json)으로 자동 채움.
 * fillIfEmpty 원칙 — 이미 값 있는 자리는 건드리지 않음.
 *
 * 매칭 우선순위:
 *   1. exact (label === pattern)
 *   2. startsWith(pattern + ' ')
 *   3. endsWith(' ' + pattern)
 *
 * 사용:
 *   tsx scripts/ontology/fill-missing-guides.ts --dry        검토
 *   tsx scripts/ontology/fill-missing-guides.ts --apply      실제 쓰기
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents");
const STANDARDS_PATH = resolve(ROOT, "scripts/data/label-standards.json");

interface Standard { ig?: string; ex?: string[] }
interface StandardsFile { patterns: Record<string, Standard> }

const standards: StandardsFile = JSON.parse(readFileSync(STANDARDS_PATH, "utf8"));
const patterns = standards.patterns;

function findStandard(label: string): Standard | null {
  const Lt = (label || "").trim();
  if (!Lt) return null;
  // 1. exact
  if (patterns[Lt]) return patterns[Lt];
  // 2. startsWith(pat + ' ')
  for (const p of Object.keys(patterns)) {
    if (Lt.startsWith(p + " ") || Lt.startsWith(p + "·")) return patterns[p];
  }
  // 3. endsWith(' ' + pat) or ('·' + pat)
  for (const p of Object.keys(patterns)) {
    if (Lt.endsWith(" " + p) || Lt.endsWith("·" + p)) return patterns[p];
  }
  return null;
}

function patchField(f: Record<string, unknown>): { changed: boolean; reason: string } {
  if (!f || typeof f !== "object") return { changed: false, reason: "" };
  const label = (f.label as string) || "";
  if (!label) return { changed: false, reason: "" };

  const std = findStandard(label);
  if (!std) return { changed: false, reason: "" };

  let changed = false;
  const reasons: string[] = [];

  if (!f.inputGuide && std.ig) {
    (f as Record<string, unknown>).inputGuide = std.ig;
    changed = true;
    reasons.push("ig");
  }
  if (
    (!f.examples || (Array.isArray(f.examples) && f.examples.length === 0)) &&
    std.ex && std.ex.length > 0
  ) {
    (f as Record<string, unknown>).examples = std.ex.slice();
    changed = true;
    reasons.push("ex");
  }
  return { changed, reason: reasons.join("+") };
}

function patchNode(n: Record<string, unknown>): { changed: boolean; count: number; details: string[] } {
  let count = 0;
  const details: string[] = [];

  function walk(field: Record<string, unknown>, path: string) {
    const r = patchField(field);
    if (r.changed) {
      count++;
      details.push(`  + [${r.reason}] ${path} :: ${field.label}`);
    }
  }

  const rf = (n.requiredFields as Array<Record<string, unknown>>) || [];
  for (let i = 0; i < rf.length; i++) {
    if (rf[i] && typeof rf[i] === "object") walk(rf[i], `requiredFields[${i}]`);
  }
  const secs = (n.sections as Array<Record<string, unknown>>) || [];
  for (let s = 0; s < secs.length; s++) {
    const sec = secs[s];
    const fs = (sec.fields as Array<Record<string, unknown>>) || [];
    for (let i = 0; i < fs.length; i++) {
      if (fs[i] && typeof fs[i] === "object") walk(fs[i], `sections[${s}].fields[${i}]`);
    }
  }
  return { changed: count > 0, count, details };
}

function main() {
  const apply = process.argv.includes("--apply");
  const verbose = process.argv.includes("--verbose");
  const files = readdirSync(NODES_DIR).filter((f) => f.endsWith(".jsonld"));

  let totalNodes = 0;
  let nodesChanged = 0;
  let totalFieldsPatched = 0;

  for (const f of files) {
    const path = join(NODES_DIR, f);
    let n: Record<string, unknown>;
    try {
      n = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      console.error(`[parse error] ${f}`);
      continue;
    }
    totalNodes++;
    const r = patchNode(n);
    if (r.changed) {
      nodesChanged++;
      totalFieldsPatched += r.count;
      console.log(`✓ ${n.docId} (${r.count}건)`);
      if (verbose) for (const d of r.details) console.log(d);
      if (apply) {
        writeFileSync(path, JSON.stringify(n, null, 2), "utf8");
      }
    }
  }

  console.log();
  console.log(`총 노드: ${totalNodes}`);
  console.log(`패치된 노드: ${nodesChanged}`);
  console.log(`패치된 필드: ${totalFieldsPatched}`);
  console.log(apply ? "(apply 모드 — 파일 변경됨)" : "(dry 모드 — --apply 옵션 추가 시 실제 변경)");
}

main();
