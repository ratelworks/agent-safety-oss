#!/usr/bin/env tsx
/**
 * audit-master-cycle-drift.ts
 *
 * release gate — `legal-duty-master.json` 의 각 문서가 가진 `cycleSlug` 가
 * 같은 docId 의 graph `documents/*.jsonld` cycle (IRI slug 부분) 과 일치하는지 검사.
 *
 * 배경: sync-master-cycleslug.ts 는 일회성 ETL 이라 graph.cycle 이 후일 손으로
 * 바뀌면 master.cycleSlug 는 stale 로 남는다. 이 gate 가 없으면 도구 출력
 * (get_official_form vs generate_safety_document) 이 다시 어긋날 수 있다.
 *
 * --lenient 또는 MASTER_CYCLE_DRIFT_LENIENT=1 면 경고만.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const MASTER_PATH = resolve(ROOT, "src", "ontology", "legal-duty-master.json");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

interface MasterDoc {
  docId: string;
  title?: string;
  cycleSlug?: string;
  frequency?: string;
}

interface MasterFile {
  documents: MasterDoc[];
}

async function walkNonGuide(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir)) {
    const p = join(dir, entry);
    const s = await stat(p);
    if (s.isDirectory()) {
      if (entry === "guides") continue;
      await walkNonGuide(p, out);
    } else if (entry.endsWith(".jsonld")) {
      out.push(p);
    }
  }
  return out;
}

async function main() {
  const lenient =
    process.argv.includes("--lenient") || (process.env["MASTER_CYCLE_DRIFT_LENIENT"] ?? "") === "1";

  const master = JSON.parse(await readFile(MASTER_PATH, "utf8")) as MasterFile;
  const graphCycle = new Map<string, string>();
  for (const f of await walkNonGuide(DOCS_DIR)) {
    try {
      const n = JSON.parse(await readFile(f, "utf8")) as { docId?: string; cycle?: string };
      const slug = String(n.cycle ?? "").replace(/^cyc:/, "");
      if (n.docId && slug) graphCycle.set(n.docId, slug);
    } catch {
      // skip
    }
  }

  const drifts: Array<{ docId: string; master: string | undefined; graph: string | undefined }> = [];
  const missingInMaster: string[] = [];
  for (const d of master.documents) {
    const g = graphCycle.get(d.docId);
    if (!g) continue; // master 에만 있는 docId — 별도 분기. 본 gate 는 양쪽 모두 존재할 때만 검사.
    if (!d.cycleSlug) {
      missingInMaster.push(d.docId);
      continue;
    }
    if (d.cycleSlug !== g) drifts.push({ docId: d.docId, master: d.cycleSlug, graph: g });
  }

  console.log(`# audit-master-cycle-drift`);
  console.log(`  master 문서: ${master.documents.length}`);
  console.log(`  graph 매칭: ${[...graphCycle.keys()].filter((k) => master.documents.find((d) => d.docId === k)).length}`);
  console.log(`  cycleSlug 누락 (master): ${missingInMaster.length}`);
  console.log(`  drift (master.cycleSlug ≠ graph.cycle): ${drifts.length}`);

  if (missingInMaster.length > 0) {
    console.log(`\n[cycleSlug 누락 목록]`);
    for (const d of missingInMaster.slice(0, 10)) console.log(`  ✗ ${d}`);
    if (missingInMaster.length > 10) console.log(`  ... 외 ${missingInMaster.length - 10}건`);
  }
  if (drifts.length > 0) {
    console.log(`\n[drift 목록]`);
    for (const d of drifts.slice(0, 10)) {
      console.log(`  ✗ ${d.docId}  master=${d.master}  graph=${d.graph}`);
    }
    if (drifts.length > 10) console.log(`  ... 외 ${drifts.length - 10}건`);
  }

  if (missingInMaster.length > 0 || drifts.length > 0) {
    if (lenient) {
      console.warn(`\n⚠ lenient 모드 — drift 있으나 통과 처리.`);
      return;
    }
    console.error(
      `\n✗ audit-master-cycle-drift FAIL — scripts/etl/sync-master-cycleslug.ts 를 재실행하거나 graph.cycle 을 master.cycleSlug 에 맞춰 정정.`,
    );
    process.exit(1);
  }
  console.log(`✓ audit-master-cycle-drift PASS`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
