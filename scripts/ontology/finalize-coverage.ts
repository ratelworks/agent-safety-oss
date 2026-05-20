#!/usr/bin/env tsx
/**
 * finalize-coverage.ts — 마지막 정리
 *  · art:위험성평가-고시:10/11/12 stub 추가 (5건 dangling 해소)
 *  · 비계·추락·거푸집·굴착 cluster orphan article 추가 doc.legalBasis 연결
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const DOCS = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

const FETCHED = "2026-04-28";

const RA_STUBS = [
  { num: "10", title: "위험성평가 결과 기록 사항", description: "위험성평가 고시 §10 위임. 평가서 기록 항목·서식 표준." },
  { num: "11", title: "위험성평가 결과 보존 기간", description: "위험성평가 고시 §11 위임. 결과 3년 보존, 특수건강진단 30년." },
  { num: "12", title: "위험성평가 교육", description: "위험성평가 고시 §12 위임. 평가 담당자·근로자 교육 항목." },
];

// orphan article → doc.legalBasis 추가 매핑
const DOC_LEGAL_BASIS_EXT: Array<{ doc: string; arts: string[] }> = [
  { doc: "doc:ad_hoc/work_permit_high_altitude",
    arts: ["art:기준규칙:44","art:기준규칙:45","art:기준규칙:59","art:기준규칙:60","art:기준규칙:61","art:기준규칙:62"] },
  { doc: "doc:ad_hoc/work_plan",
    arts: ["art:기준규칙:332","art:기준규칙:333","art:기준규칙:334","art:기준규칙:341","art:기준규칙:342"] },
];

async function patchDoc(docId: string, mutate: (n: Record<string, unknown>) => void): Promise<boolean> {
  // doc 파일은 documents/ 루트에 flat 저장 (slug-based 파일명)
  const slug = docId.split("/").pop()!.replace(/_/g, "-");
  const path = resolve(DOCS, slug + ".jsonld");
  try {
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    if (node["@id"] !== docId) return false;
    mutate(node);
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    return true;
  } catch (e) {
    console.warn(`[skip] ${docId}: ${(e as Error).message}`);
    return false;
  }
}

(async () => {
  // 1. 위험성평가 고시 stub
  for (const s of RA_STUBS) {
    const path = resolve(ARTICLES, `위험성평가-고시-§${s.num}.jsonld`);
    const obj = {
      "@context": "../../context.jsonld",
      "@id": `art:위험성평가-고시:${s.num}`,
      "@type": ["Article", "Legislation"],
      articleNumber: s.num,
      title: s.title,
      partOf: "act:사업장위험성평가에관한지침",
      verificationStatus: "stub",
      _meta: { fetchedAt: FETCHED, note: "Coverage closure stub (Phase 2.5 wave3)." },
      description: s.description,
      legislationIdentifier: "사업장 위험성평가에 관한 지침",
      legislationDate: "2025-01-02",
      legislationType: "Notification",
      legislationLegalForce: "InForce",
      jurisdiction: "KR"
    };
    await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
  }
  console.log(`[stub] ${RA_STUBS.length} 위험성평가-고시 stub 추가`);

  // 2. doc.legalBasis 보강
  let patched = 0;
  for (const m of DOC_LEGAL_BASIS_EXT) {
    const ok = await patchDoc(m.doc, (n) => {
      const cur = (n.legalBasis as string[] | undefined) ?? [];
      const set = new Set(cur);
      for (const a of m.arts) set.add(a);
      n.legalBasis = [...set];
    });
    if (ok) patched++;
  }
  console.log(`[doc] legalBasis 추가: ${patched}`);
})();
