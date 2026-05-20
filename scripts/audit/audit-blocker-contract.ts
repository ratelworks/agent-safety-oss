#!/usr/bin/env tsx
/**
 * audit-blocker-contract.ts
 *
 * CI 게이트 — "severity: blocker 인 reviewRule 은 반드시 기계 검증 계약
 * (checkFields / jsonLogic / evidenceQuery / computedPredicate 중 하나) 을 가진다".
 *
 * 본 게이트가 없으면 reclassify-unverifiable-blockers.ts 의 효과가 시간이 지나며
 * 다시 깨질 수 있다 (사람이 새 blocker 를 checkFields 없이 추가). 결과는
 * release gate (verify-all) 에서 hard fail.
 *
 * --lenient 또는 BLOCKER_CONTRACT_LENIENT=1 면 경고만.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const p = join(dir, entry);
    const s = await stat(p);
    if (s.isDirectory()) out.push(...(await walk(p)));
    else if (entry.endsWith(".jsonld")) out.push(p);
  }
  return out;
}

interface ReviewRule {
  rule: string;
  severity?: string;
  checkFields?: unknown;
  jsonLogic?: unknown;
  evidenceQuery?: unknown;
  computedPredicate?: unknown;
}

function hasMachineCheck(r: ReviewRule): boolean {
  return Boolean(
    (Array.isArray(r.checkFields) && r.checkFields.length > 0) ||
      r.jsonLogic ||
      r.evidenceQuery ||
      r.computedPredicate,
  );
}

async function main() {
  const lenient =
    process.argv.includes("--lenient") || (process.env["BLOCKER_CONTRACT_LENIENT"] ?? "") === "1";
  const files = await walk(NODES_DIR);
  const violations: Array<{ file: string; rule: string }> = [];
  let totalBlocker = 0;
  let totalChecked = 0;
  for (const f of files) {
    let node: { reviewRules?: ReviewRule[] };
    try {
      node = JSON.parse(await readFile(f, "utf8"));
    } catch {
      continue;
    }
    const rules = Array.isArray(node.reviewRules) ? node.reviewRules : null;
    if (!rules) continue;
    for (const r of rules) {
      if (r.severity !== "blocker") continue;
      totalBlocker++;
      if (hasMachineCheck(r)) {
        totalChecked++;
      } else {
        violations.push({ file: f.replace(ROOT + "/", ""), rule: r.rule });
      }
    }
  }
  console.log(`# audit-blocker-contract`);
  console.log(`  검사 blocker rule: ${totalBlocker}`);
  console.log(`  machine-check 보유: ${totalChecked}`);
  console.log(`  위반 (계약 없음): ${violations.length}`);
  if (violations.length > 0) {
    console.log(`\n[위반 목록 — 상위 10]`);
    for (const v of violations.slice(0, 10)) {
      console.log(`  ✗ ${v.file}`);
      console.log(`    rule: ${v.rule}`);
    }
    if (lenient) {
      console.warn(`\n⚠ lenient 모드 — 위반 ${violations.length}건 있으나 통과 처리.`);
      return;
    }
    console.error(
      `\n✗ audit-blocker-contract FAIL — blocker without machine-check 는 manual_review 로 분류하거나 checkFields 를 추가하세요.`,
    );
    process.exit(1);
  }
  console.log(`✓ audit-blocker-contract PASS`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
