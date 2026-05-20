#!/usr/bin/env tsx
/**
 * sync-admin-rules.ts
 * 행정규칙 (위험성평가-고시 등) 본문 sync.
 * lawService.do?target=admrul 형식.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "articles");
const OC = process.env.LAW_OC || "ryongkoon1984";

const ADMRULS = [
  { actKey: "위험성평가-고시", id: "2100000251014",
    actNode: "act:사업장위험성평가에관한지침",
    name: "사업장 위험성평가에 관한 지침",
    no: "2024-76", date: "2024-12-18", effective: "2025-01-02" }
];

(async () => {
  // 기존 IRI 인덱스
  const existing = new Set<string>();
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(ARTICLES, f), "utf-8")) as { "@id"?: string };
    if (node["@id"]) existing.add(node["@id"]);
  }

  for (const ar of ADMRULS) {
    const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=admrul&ID=${ar.id}&type=XML`;
    const xml = await fetch(url).then(r => r.text());

    // 모든 조문내용 추출 (행정규칙은 <조문단위> 없음, <조문내용>만 직접)
    const contents = [...xml.matchAll(/<조문내용><!\[CDATA\[([\s\S]*?)\]\]>\s*<\/조문내용>/g)];

    let added = 0, updated = 0;
    for (const cm of contents) {
      const text = cm[1].trim();
      // "제N조(제목) 본문" 또는 "제N조의M(제목) ..." 매칭
      const titleMatch = text.match(/^제(\d+(?:의\d+)?)조(?:의(\d+))?\(([^)]+)\)/);
      if (!titleMatch) continue; // 장 제목 같은 건 skip
      const num = titleMatch[1];
      const title = titleMatch[3];
      const iri = `art:${ar.actKey}:${num}`;
      const fname = `${ar.actKey}-§${num}.jsonld`;
      const path = resolve(ARTICLES, fname);

      const obj = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": ["Article", "Legislation"],
        articleNumber: num,
        title,
        partOf: ar.actNode,
        verificationStatus: "verified",
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          sourceUrl: `https://www.law.go.kr/행정규칙/${encodeURIComponent(ar.name)}`,
          fetchedAt: new Date().toISOString().substring(0, 10),
          verifiedAt: new Date().toISOString().substring(0, 10),
          verifiedBy: "법제처 lawService.do?target=admrul (자동 sync)",
          admRulId: ar.id,
          admRulNo: ar.no,
          licenseHint: "저작권법 §7 비보호 (자유 인용)"
        },
        description: text,
        legislationIdentifier: ar.name,
        legislationDate: ar.date,
        legislationType: "Notification",
        legislationLegalForce: "InForce",
        jurisdiction: "KR",
        temporalCoverage: `${ar.effective}/..`
      };

      await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
      if (existing.has(iri)) updated++;
      else added++;
      existing.add(iri);
    }
    console.log(`[${ar.actKey}] +${added} 신규 / ${updated} 갱신`);
  }
})();
