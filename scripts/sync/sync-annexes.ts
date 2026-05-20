#!/usr/bin/env tsx
/**
 * sync-annexes.ts
 *
 * 법제처 lawService.do 응답의 <별표단위> 추출 → annex 노드 본문 sync.
 * 81개 자동 생성 별표 + 기존 20개 stub 모두 verified 화.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ANNEXES = resolve(ROOT, "src", "ontology", "graph", "nodes", "annexes");
const OC = process.env.LAW_OC || "ryongkoon1984";

const LAWS = [
  { actKey: "산안법",        mst: "276853", actNode: "act:산업안전보건법" },
  { actKey: "산안법시행령",  mst: "284771", actNode: "act:산업안전보건법시행령" },
  { actKey: "산안법시행규칙",mst: "271485", actNode: "act:산업안전보건법시행규칙" },
  { actKey: "기준규칙",      mst: "273603", actNode: "act:산업안전보건기준에관한규칙" },
  { actKey: "중처법",        mst: "228817", actNode: "act:중대재해처벌등에관한법률" },
  { actKey: "중처법시행령",  mst: "277417", actNode: "act:중대재해처벌등에관한법률시행령" },
];

interface AnnexData {
  key: string; num: string; sub: string; kind: string; title: string;
  body: string; hwpUrl?: string; pdfUrl?: string;
}

function parseAnnexes(xml: string): AnnexData[] {
  const annexes: AnnexData[] = [];
  for (const m of xml.matchAll(/<별표단위[^>]*별표키="([^"]+)"[^>]*>([\s\S]*?)<\/별표단위>/g)) {
    const key = m[1];
    const inner = m[2];
    const get = (tag: string) => {
      const r = inner.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
      return r ? r[1].trim() : "";
    };
    const num = get("별표번호").replace(/^0+/, "") || "0";
    const sub = get("별표가지번호").replace(/^0+/, "") || "0";
    const kind = get("별표구분");
    const title = get("별표제목");
    // <별표내용> 다중 CDATA → 모두 합침
    const bodyParts: string[] = [];
    const innerBodyMatch = inner.match(/<별표내용>([\s\S]*?)<\/별표내용>/);
    if (innerBodyMatch) {
      const cdata = innerBodyMatch[1];
      for (const cm of cdata.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
        bodyParts.push(cm[1]);
      }
    }
    const body = bodyParts.join("\n").trim();
    const hwpLink = inner.match(/<별표서식파일링크>([^<]+)<\/별표서식파일링크>/);
    const pdfLink = inner.match(/<별표서식PDF파일링크>([^<]+)<\/별표서식PDF파일링크>/);
    annexes.push({
      key, num, sub: sub === "0" ? "" : sub, kind, title, body,
      hwpUrl: hwpLink ? `https://www.law.go.kr${hwpLink[1]}` : undefined,
      pdfUrl: pdfLink ? `https://www.law.go.kr${pdfLink[1]}` : undefined,
    });
  }
  return annexes;
}

(async () => {
  // 기존 annex IRI 인덱스
  const existingAnnexes = new Map<string, string>();  // IRI → file path
  for (const f of await readdir(ANNEXES)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ANNEXES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as { "@id"?: string };
    if (node["@id"]) existingAnnexes.set(node["@id"], path);
  }
  console.log(`[index] 기존 annex: ${existingAnnexes.size}\n`);

  let synced = 0, created = 0;
  for (const law of LAWS) {
    const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&MST=${law.mst}&type=XML`;
    const xml = await fetch(url).then(r => r.text());
    const annexes = parseAnnexes(xml);
    console.log(`  [${law.actKey.padEnd(15)}] ${annexes.length} 별표/서식 추출`);

    for (const a of annexes) {
      // 별표 IRI 생성: annex:기준규칙:별표4 또는 annex:기준규칙:서식1
      const numLabel = a.sub ? `${a.kind}${a.num}의${a.sub}` : `${a.kind}${a.num}`;
      const iri = `annex:${law.actKey}:${numLabel}`;
      const fname = `${law.actKey}-${numLabel}.jsonld`;
      const path = existingAnnexes.get(iri) ?? resolve(ANNEXES, fname);

      const obj: Record<string, unknown> = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": ["Annex"],
        annexNumber: a.sub ? `${a.num}-${a.sub}` : a.num,
        annexKind: a.kind,
        title: a.title,
        partOf: law.actNode,
        verificationStatus: "verified",
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(law.actKey)}/${a.kind}/${a.num}`,
          fetchedAt: new Date().toISOString().substring(0, 10),
          verifiedAt: new Date().toISOString().substring(0, 10),
          verifiedBy: "법제처 lawService.do <별표단위> 자동 sync",
          annexKey: a.key,
          ...(a.hwpUrl && { hwpDownloadUrl: a.hwpUrl }),
          ...(a.pdfUrl && { pdfDownloadUrl: a.pdfUrl }),
          licenseHint: "저작권법 §7 비보호 (자유 인용)"
        },
        description: a.body || a.title,
        legislationIdentifier: law.actKey,
        jurisdiction: "KR"
      };
      await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
      if (existingAnnexes.has(iri)) synced++; else created++;
      existingAnnexes.set(iri, path);
    }
  }
  console.log(`\n✅ ${synced} annex sync + ${created} 신규 생성`);
})();
