#!/usr/bin/env tsx
/**
 * extract-amendments.ts
 *
 * 법령 본문에서 <개정 YYYY.M.D, ...> 패턴 추출 → article.amendmentHistory.
 * 법제처 article-history API 미신청 상황의 자체 우회 — 본문 그대로의 인라인 개정 표기 활용.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "articles");

(async () => {
  let extracted = 0, totalDates = 0;
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ARTICLES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const desc = String(node.description ?? "");
    // <개정 2020.5.26, 2023.8.8> 패턴 + "개정 2020. 5. 26.,..." 변형
    const dates = new Set<string>();
    for (const m of desc.matchAll(/<개정\s+([0-9.,\s]+)>/g)) {
      for (const dm of m[1].matchAll(/(\d{4})\s*[.\s]?\s*(\d{1,2})\s*[.\s]?\s*(\d{1,2})/g)) {
        const y = dm[1], mo = dm[2].padStart(2, "0"), d = dm[3].padStart(2, "0");
        dates.add(`${y}-${mo}-${d}`);
      }
    }
    if (dates.size > 0) {
      const sorted = [...dates].sort();
      node.amendmentHistory = sorted;
      // 시행일자(legislationDate)가 마지막 개정일이 아니면 latestAmendment 표기
      node.latestAmendment = sorted[sorted.length - 1];
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      extracted++;
      totalDates += sorted.length;
    }
  }
  console.log(`✅ ${extracted} article 에 amendmentHistory 추가 (총 ${totalDates} 개정일)`);
})();
