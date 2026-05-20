#!/usr/bin/env tsx
/**
 * fix-fragment-and-typos.ts
 *  · 오타 IRI 정정 (art:위험성평가고시: → art:위험성평가-고시:)
 *  · #paragraph fragment 참조 정규화 (art:기준규칙:38#2 → art:기준규칙:38)
 *  · 기타 누락 노드 stub (art:산안법:26, annex:산안법시행규칙:별표5)
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const ANNEXES = resolve(NODES, "annexes");

const REPLACEMENTS: Array<[RegExp, string]> = [
  // 오타 정정
  [/art:위험성평가고시:/g, "art:위험성평가-고시:"],
  // #paragraph fragment 정규화 (parent 로 정규화)
  [/(art:[가-힣A-Za-z]+:\d+)#\d+/g, "$1"],
  [/(art:[가-힣A-Za-z]+:\d+)#[가-힣A-Za-z]+/g, "$1"],
  [/(annex:[가-힣A-Za-z]+:[가-힣A-Za-z0-9-]+호)-[가-힣]+목/g, "$1"],
];

async function walkAndFix(dir: string): Promise<number> {
  let count = 0;
  for (const e of await readdir(dir)) {
    const p = join(dir, e);
    const st = await stat(p);
    if (st.isDirectory()) count += await walkAndFix(p);
    else if (e.endsWith(".jsonld")) {
      const orig = await readFile(p, "utf-8");
      let modified = orig;
      for (const [re, sub] of REPLACEMENTS) modified = modified.replace(re, sub);
      // 중복 제거 (같은 IRI 가 같은 prop 내 두 번 나타나면 정리)
      if (modified !== orig) {
        try {
          const node = JSON.parse(modified);
          for (const k of Object.keys(node)) {
            if (Array.isArray(node[k]) && node[k].every((v: unknown) => typeof v === "string")) {
              node[k] = [...new Set(node[k] as string[])];
            }
          }
          modified = JSON.stringify(node, null, 2) + "\n";
        } catch {}
        await writeFile(p, modified, "utf-8");
        count++;
      }
    }
  }
  return count;
}

const FETCHED = "2026-04-28";
const STUB_ARTICLES = [
  { act: "산안법", num: "26", title: "안전보건관리규정의 작성·변경 절차",
    description: "산안법 §26 안전보건관리규정 작성·변경 시 산업안전보건위원회 심의·의결, 근로자대표 의견청취 절차." },
];
const STUB_ANNEXES = [
  { id: "annex:산안법시행규칙:별표5", num: "5", title: "안전보건교육 교육시간·교육내용",
    partOf: "act:산업안전보건법시행규칙",
    description: "산안법 §29 위임. 정기교육·신규교육·특별교육·관리감독자 교육의 대상별 교육시간 및 교육내용 표준." }
];

(async () => {
  const fixed = await walkAndFix(NODES);
  console.log(`[fix] ${fixed} 파일 정정 (오타·fragment 정규화)`);

  for (const a of STUB_ARTICLES) {
    const path = resolve(ARTICLES, `${a.act}-§${a.num}.jsonld`);
    const obj = {
      "@context": "../../context.jsonld",
      "@id": `art:${a.act}:${a.num}`,
      "@type": ["Article", "Legislation"],
      articleNumber: a.num,
      title: a.title,
      partOf: "act:산업안전보건법",
      verificationStatus: "stub",
      _meta: { fetchedAt: FETCHED, note: "Coverage closure stub (Phase 2.5 wave3)." },
      description: a.description,
      legislationIdentifier: "산업안전보건법",
      legislationDate: "2025-10-01",
      legislationType: "Act",
      legislationLegalForce: "InForce",
      jurisdiction: "KR",
      temporalCoverage: "2025-10-01/.."
    };
    await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
  }
  for (const x of STUB_ANNEXES) {
    const fname = `${x.partOf.replace("act:","")}-별표${x.num}.jsonld`;
    const path = resolve(ANNEXES, fname);
    const obj = {
      "@context": "../../context.jsonld",
      "@id": x.id,
      "@type": ["Annex"],
      title: x.title,
      annexNumber: x.num,
      partOf: x.partOf,
      verificationStatus: "stub",
      _meta: { fetchedAt: FETCHED, note: "Coverage closure stub (Phase 2.5 wave3)." },
      description: x.description,
      jurisdiction: "KR"
    };
    await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
  }
  console.log(`[stub] ${STUB_ARTICLES.length} article + ${STUB_ANNEXES.length} annex 추가`);
})();
