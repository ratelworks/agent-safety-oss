#!/usr/bin/env tsx
/**
 * sync-master-cycleslug.ts
 *
 * legal-duty-master.json 의 94 문서에 graph cycle slug 를 동기화 정합 필드로 추가.
 *
 * 원인: master.frequency 는 자연어 (예: "월1회", "변경시"), graph.cycle 은 slug IRI (예: cyc:monthly).
 * 두 SSoT 가 동일 docId 에 대해 다른 형식으로 주기를 표현해 도구 출력 일관성을 깨뜨림.
 *
 * 처방:
 *   - master.frequency 는 human-readable 표시용으로 유지.
 *   - master.cycleSlug 를 graph.cycle 의 slug (cyc: prefix 제거) 와 1:1 동기화.
 *   - 도구 (get_official_form 등) 는 cycleSlug 를 machine SSoT 로 사용,
 *     frequency 는 사용자 표시 (한국어 자연어) 로 사용.
 *
 * 1회 실행 후 master JSON 이 갱신된다. graph 변경 시 재실행 권장.
 */
// 파일 최상단 상수
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, statSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const MASTER_PATH = resolve(ROOT, "src", "ontology", "legal-duty-master.json");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

interface MasterDoc {
  docId: string;
  title: string;
  frequency?: string;
  cycleSlug?: string;
  [k: string]: unknown;
}

interface MasterFile {
  documents: MasterDoc[];
  [k: string]: unknown;
}

function walkNonGuide(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = resolve(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "guides") continue; // guides 는 별도 sub-schema
      walkNonGuide(p, out);
    } else if (f.endsWith(".jsonld")) {
      out.push(p);
    }
  }
  return out;
}

function extractCycleSlug(cycleValue: unknown): string | null {
  if (typeof cycleValue !== "string") return null;
  // graph.cycle 은 보통 "cyc:monthly" 형태 — slug 부분만 추출.
  return cycleValue.replace(/^cyc:/, "") || null;
}

async function main() {
  const docIdToCycle = new Map<string, string>();
  const docFiles = walkNonGuide(DOCS_DIR);
  for (const f of docFiles) {
    try {
      const n = JSON.parse(readFileSync(f, "utf8"));
      const slug = extractCycleSlug(n.cycle);
      if (n.docId && slug) docIdToCycle.set(n.docId, slug);
    } catch {
      // 파싱 실패 — skip
    }
  }
  console.log(`# sync-master-cycleslug`);
  console.log(`  graph 추출 cycle slug: ${docIdToCycle.size} 건`);

  const master = JSON.parse(await readFile(MASTER_PATH, "utf8")) as MasterFile;
  let changed = 0;
  let missing = 0;
  const missingSamples: string[] = [];
  for (const d of master.documents) {
    const expected = docIdToCycle.get(d.docId);
    if (!expected) {
      missing++;
      if (missingSamples.length < 5) missingSamples.push(d.docId);
      continue;
    }
    if (d.cycleSlug !== expected) {
      d.cycleSlug = expected;
      changed++;
    }
  }
  console.log(`  master 갱신: ${changed} 건 (기존 동일: ${master.documents.length - changed - missing})`);
  console.log(`  graph 에 없음: ${missing} 건 ${missing > 0 ? "[" + missingSamples.join(", ") + (missing > 5 ? ", ..." : "") + "]" : ""}`);

  await writeFile(MASTER_PATH, JSON.stringify(master, null, 2) + "\n", "utf8");
  console.log(`✓ ${MASTER_PATH.replace(ROOT + "/", "")} 저장`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
