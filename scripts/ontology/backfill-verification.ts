// ─────────────────────────────────────────────────────────────────────────────
// backfill-verification
//
// verificationStatus 필드 부재 노드 (~1129건) 에 출처 기반 자동 등급 부여:
//   _meta.publishedBy 기준
//     - 법제처 / 고용노동부 / 황룡건설+라텔웍스    → "verified"
//     - KOSHA / 한국산업안전보건공단                → "needs_review"
//     - 그 외 / 부재                                → "needs_review"
//
// 사용:
//   npx tsx scripts/ontology/backfill-verification.ts          # dry-run
//   npx tsx scripts/ontology/backfill-verification.ts --apply  # 적용
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const NODES_ROOT = join(REPO_ROOT, "src/ontology/graph/nodes");

const VERIFIED_PUBLISHERS = ["법제처", "고용노동부", "라텔웍스", "황룡건설"];
const NEEDS_REVIEW_PUBLISHERS = ["KOSHA", "한국산업안전보건공단", "안전보건공단"];

function classifyByPublisher(publisher: string | undefined): "verified" | "needs_review" {
  if (!publisher) return "needs_review";
  if (VERIFIED_PUBLISHERS.some((v) => publisher.includes(v))) return "verified";
  if (NEEDS_REVIEW_PUBLISHERS.some((n) => publisher.includes(n))) return "needs_review";
  return "needs_review";
}

interface Stats {
  total: number;
  alreadyHasStatus: number;
  added_verified: number;
  added_needs_review: number;
}

function main() {
  const apply = process.argv.includes("--apply");
  const stats: Stats = { total: 0, alreadyHasStatus: 0, added_verified: 0, added_needs_review: 0 };
  const samples: { file: string; status: string; publisher: string }[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".jsonld")) processFile(full);
    }
  }

  function processFile(full: string) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      return;
    }
    if (!raw["@id"]) return;
    stats.total++;

    if (raw.verificationStatus) {
      stats.alreadyHasStatus++;
      return;
    }

    const publisher = raw._meta?.publishedBy;
    const status = classifyByPublisher(publisher);
    if (status === "verified") stats.added_verified++;
    else stats.added_needs_review++;

    if (samples.length < 10) {
      samples.push({ file: relative(REPO_ROOT, full), status, publisher: publisher || "(없음)" });
    }

    if (apply) {
      // verificationStatus 를 @type 바로 다음에 삽입하되, JSON 키 순서 유지하기 위해
      // 새 객체로 재구성. 핵심 키는 위쪽, _meta 는 아래.
      const reordered: any = {};
      const priority = ["@context", "@id", "@type", "docId", "title"];
      for (const k of priority) {
        if (k in raw) reordered[k] = raw[k];
      }
      reordered.verificationStatus = status;
      for (const k of Object.keys(raw)) {
        if (priority.includes(k) || k === "verificationStatus") continue;
        reordered[k] = raw[k];
      }
      writeFileSync(full, JSON.stringify(reordered, null, 2) + "\n");
    }
  }

  walk(NODES_ROOT);

  console.log(`\n=== ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`전체 노드: ${stats.total}`);
  console.log(`이미 verificationStatus 있음: ${stats.alreadyHasStatus}`);
  console.log(`추가 verified: ${stats.added_verified}`);
  console.log(`추가 needs_review: ${stats.added_needs_review}`);
  console.log(`\n샘플:`);
  for (const s of samples) {
    console.log(`  [${s.status}] ${s.file} (publisher: ${s.publisher})`);
  }
  if (!apply) console.log(`\n적용: npx tsx scripts/ontology/backfill-verification.ts --apply`);
}

main();
