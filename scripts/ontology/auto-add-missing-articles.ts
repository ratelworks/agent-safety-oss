#!/usr/bin/env tsx
/**
 * auto-add-missing-articles.ts
 *
 * 법제처 XML 에서 모든 조문 IRI 추출 → 그래프 누락 자동 추가 (stub).
 * 이후 sync-law-from-moleg 로 본문 채움.
 *
 * 적용 법령:
 *   - 산업안전보건법 (MST 276853)
 *   - 산업안전보건법 시행령 (MST 284771)
 *   - 산업안전보건법 시행규칙 (MST 271485)
 *   - 산업안전보건기준에 관한 규칙 (MST 273603)
 *   - 중대재해처벌등에관한법률 (MST 228817)
 *   - 중대재해처벌등에관한법률시행령 (MST 277417)
 *
 * 위험성평가 고시는 행정규칙이라 admRulSc 별도 엔드포인트 사용.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const OC = process.env.LAW_OC || "ryongkoon1984";

const LAWS = [
  { actKey: "산안법",        mst: "276853", lawId: "001766", actNode: "act:산업안전보건법",                name: "산업안전보건법",            type: "Act" },
  { actKey: "산안법시행령",   mst: "284771", lawId: "003786", actNode: "act:산업안전보건법시행령",          name: "산업안전보건법 시행령",       type: "Decree" },
  { actKey: "산안법시행규칙", mst: "271485", lawId: "003787", actNode: "act:산업안전보건법시행규칙",        name: "산업안전보건법 시행규칙",     type: "Rule" },
  { actKey: "기준규칙",       mst: "273603", lawId: "007363", actNode: "act:산업안전보건기준에관한규칙",   name: "산업안전보건기준에 관한 규칙", type: "Rule" },
  { actKey: "중처법",         mst: "228817", lawId: "013993", actNode: "act:중대재해처벌등에관한법률",      name: "중대재해 처벌 등에 관한 법률", type: "Act" },
  { actKey: "중처법시행령",   mst: "277417", lawId: "014159", actNode: "act:중대재해처벌등에관한법률시행령", name: "중대재해 처벌 등에 관한 법률 시행령", type: "Decree" },
];

(async () => {
  // 기존 article IRI 인덱스
  const existingIris = new Set<string>();
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(ARTICLES, f), "utf-8")) as { "@id"?: string };
    if (node["@id"]) existingIris.add(node["@id"]);
  }
  console.log(`[index] 기존 article: ${existingIris.size}\n`);

  let totalAdded = 0;
  for (const law of LAWS) {
    const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&MST=${law.mst}&type=XML`;
    const xml = await fetch(url).then(r => r.text());
    const blocks = [...xml.matchAll(/<조문단위[^>]*>([\s\S]*?)<\/조문단위>/g)];

    let addedInLaw = 0;
    for (const b of blocks) {
      const inner = b[1];
      const onlyArticle = inner.match(/<조문여부>조문<\/조문여부>/);
      if (!onlyArticle) continue;
      const numMatch = inner.match(/<조문번호>(\d+)<\/조문번호>/);
      const subMatch = inner.match(/<조문가지번호>(\d+)<\/조문가지번호>/);
      const titleMatch = inner.match(/<조문제목><!\[CDATA\[([^\]]+)\]\]>/);
      if (!numMatch) continue;
      const num = parseInt(numMatch[1], 10);
      const sub = subMatch ? parseInt(subMatch[1], 10) : 0;
      const title = titleMatch ? titleMatch[1].trim() : `제${num}조`;
      const articleNum = sub > 0 ? `${num}의${sub}` : `${num}`;
      const iri = `art:${law.actKey}:${articleNum}`;
      if (existingIris.has(iri)) continue;

      // 신규 stub 생성 (sync로 본문 채워질 예정)
      const obj = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": ["Article", "Legislation"],
        articleNumber: articleNum,
        title,
        partOf: law.actNode,
        verificationStatus: "stub",
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(law.name.replace(/\s/g, ""))}/제${articleNum}조`,
          fetchedAt: new Date().toISOString().substring(0, 10),
          licenseHint: "저작권법 §7 비보호 (자유 인용)",
          note: "자동 추가 stub (Phase 4 wave1) — 다음 sync 시 본문 verified 화."
        },
        description: `**제${articleNum}조 (${title})** — 본문 sync 대기.`,
        legislationIdentifier: law.name,
        legislationDate: "2025-10-01",
        legislationType: law.type,
        legislationLegalForce: "InForce",
        jurisdiction: "KR",
        temporalCoverage: "2025-10-01/.."
      };

      const fname = `${law.actKey}-§${articleNum}.jsonld`;
      await writeFile(resolve(ARTICLES, fname), JSON.stringify(obj, null, 2) + "\n", "utf-8");
      existingIris.add(iri);
      addedInLaw++;
      totalAdded++;
    }
    console.log(`  [${law.actKey.padEnd(15)}] +${addedInLaw} 신규 stub`);
  }
  console.log(`\n✅ 총 ${totalAdded} 신규 article stub 추가. 다음 sync 실행으로 본문 채움.`);
})();
