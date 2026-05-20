#!/usr/bin/env tsx
/**
 * reclassify-unverifiable-blockers.ts
 *
 * reviewRules 의 severity: "blocker" 중 기계 검증 계약(checkFields / jsonLogic /
 * evidenceQuery / computedPredicate) 이 없는 항목 137건을 severity: "manual_review"
 * 로 재분류한다.
 *
 * 배경: review-safety-document.ts:857-878 가 "checkFields 없는 blocker 는 manual_review 로
 * 강등" 분기를 이미 가지고 있었다. 즉 런타임이 자동 강등하던 규칙을 데이터 자체에
 * 정직하게 반영한다. 사용자 영향 — review_safety_document 출력에서 같은 규칙이
 * "blocker (강등됨)" vs "manual_review" 로 일관성 없이 표기되던 문제를 제거한다.
 *
 * 1회 실행 후 jsonld 노드들이 갱신된다. CI 게이트(reclassify-blocker-gate) 가
 * 본 변환의 정합을 강제한다.
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");

interface ReviewRule {
  rule: string;
  severity: "blocker" | "warning" | "manual_review";
  checkFields?: string[];
  jsonLogic?: unknown;
  evidenceQuery?: unknown;
  computedPredicate?: unknown;
  [k: string]: unknown;
}

interface DocNode {
  reviewRules?: ReviewRule[];
  [k: string]: unknown;
}

function hasMachineCheck(r: ReviewRule): boolean {
  return Boolean(
    (r.checkFields && Array.isArray(r.checkFields) && r.checkFields.length > 0) ||
      r.jsonLogic ||
      r.evidenceQuery ||
      r.computedPredicate,
  );
}

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

async function main() {
  const files = await walk(NODES_DIR);
  let nodeTouched = 0;
  let ruleConverted = 0;
  const perFile: Array<{ path: string; count: number }> = [];
  for (const f of files) {
    let raw: string;
    let node: DocNode;
    try {
      raw = await readFile(f, "utf8");
      node = JSON.parse(raw) as DocNode;
    } catch {
      continue;
    }
    const rules = Array.isArray(node.reviewRules) ? node.reviewRules : null;
    if (!rules) continue;
    let perFileCount = 0;
    for (const r of rules) {
      if (r.severity === "blocker" && !hasMachineCheck(r)) {
        r.severity = "manual_review";
        perFileCount++;
        ruleConverted++;
      }
    }
    if (perFileCount > 0) {
      nodeTouched++;
      perFile.push({ path: f.replace(ROOT + "/", ""), count: perFileCount });
      // trailing newline 보존 — 다른 sync 스크립트와 동일 포맷
      await writeFile(f, JSON.stringify(node, null, 2) + (raw.endsWith("\n") ? "\n" : ""), "utf8");
    }
  }
  console.log(`# reclassify-unverifiable-blockers`);
  console.log(`  처리 노드: ${nodeTouched}`);
  console.log(`  변환 규칙: ${ruleConverted}`);
  console.log(`  상위 5개:`);
  perFile.sort((a, b) => b.count - a.count);
  for (const e of perFile.slice(0, 5)) console.log(`    ${e.count}건  ${e.path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
