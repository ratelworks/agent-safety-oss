#!/usr/bin/env tsx
/**
 * sync-annexes.ts
 *
 * 법제처 lawService.do 응답의 <별표단위> 추출 → annex 노드 본문 sync.
 *
 * 현행 판(MST + 시행일 efYd)의 별표·서식을 받아
 *   - 노드가 없으면 원문으로 새로 만들고
 *   - 노드가 있고 본문·제목이 원문과 다르면 본문·제목·출처 표지만 고친다 (노드에 덧붙인 연결 칸은 그대로 둔다)
 *   - 같으면 손대지 않는다 (날짜만 바뀌는 변경을 만들지 않는다)
 *
 * 사용:
 *   LAW_OC=... tsx scripts/sync/sync-annexes.ts                 # 반영
 *   LAW_OC=... tsx scripts/sync/sync-annexes.ts --dry-run       # 바뀔 것만 출력
 *   LAW_OC=... tsx scripts/sync/sync-annexes.ts --only annex:산안법시행규칙:별표5,annex:산안법시행령:별표35
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ANNEXES = resolve(ROOT, "src", "ontology", "graph", "nodes", "annexes");
const OC = process.env.LAW_OC ?? "";
if (!OC) {
  console.error("LAW_OC 환경 변수 필요 (법제처 OpenAPI 인증키). export LAW_OC=...");
  process.exit(2);
}

/** 현행 판 — 판본 점검(check:law-editions)이 현행으로 확인한 MST 와 그 판의 시행일 */
const LAWS = [
  { actKey: "산안법",        name: "산업안전보건법",                     mst: "291447", efYd: "20261027", actNode: "act:산업안전보건법" },
  { actKey: "산안법시행령",  name: "산업안전보건법 시행령",              mst: "288347", efYd: "20260801", actNode: "act:산업안전보건법시행령" },
  { actKey: "산안법시행규칙",name: "산업안전보건법 시행규칙",            mst: "288431", efYd: "20260801", actNode: "act:산업안전보건법시행규칙" },
  { actKey: "기준규칙",      name: "산업안전보건기준에 관한 규칙",       mst: "273603", efYd: "20260302", actNode: "act:산업안전보건기준에관한규칙" },
  { actKey: "중처법",        name: "중대재해 처벌 등에 관한 법률",       mst: "228817", efYd: "20220127", actNode: "act:중대재해처벌등에관한법률" },
  { actKey: "중처법시행령",  name: "중대재해 처벌 등에 관한 법률 시행령", mst: "277417", efYd: "20251001", actNode: "act:중대재해처벌등에관한법률시행령" },
];
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run");
const ONLY = (() => {
  const i = ARGS.indexOf("--only");
  return i >= 0 ? new Set((ARGS[i + 1] ?? "").split(",").map((x) => x.trim()).filter(Boolean)) : null;
})();
/** 본문 비교용 — 띄어쓰기·가운뎃점 모양 차이를 없앤다 */
const flat = (s: string): string => s.replace(/[\sㆍ·‧]/g, "");

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
      const r = inner.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      // 요소 안의 CDATA 표식은 모두 걷는다 ("]]>" 뒤 줄바꿈이 있어도)
      return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
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
    const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=eflaw&MST=${law.mst}&efYd=${law.efYd}&type=XML`;
    const xml = await fetch(url).then(r => r.text());
    const annexes = parseAnnexes(xml);
    console.log(`  [${law.actKey.padEnd(15)}] ${annexes.length} 별표/서식 추출`);

    for (const a of annexes) {
      // 별표 IRI 생성: annex:기준규칙:별표4 또는 annex:기준규칙:서식1
      const numLabel = a.sub ? `${a.kind}${a.num}의${a.sub}` : `${a.kind}${a.num}`;
      const iri = `annex:${law.actKey}:${numLabel}`;
      const fname = `${law.actKey}-${numLabel}.jsonld`;
      const path = existingAnnexes.get(iri) ?? resolve(ANNEXES, fname);
      if (ONLY && !ONLY.has(iri)) continue;
      const today = new Date().toISOString().substring(0, 10);
      const body = a.body || a.title;

      // 있는 노드 — 본문·제목이 원문과 다를 때만 그 칸과 출처 표지를 고친다
      if (existingAnnexes.has(iri)) {
        const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown> & { _meta?: Record<string, unknown> };
        const sameBody = flat(String(node.description ?? "")) === flat(body);
        const sameTitle = flat(String(node.title ?? "")) === flat(a.title);
        if (sameBody && sameTitle) continue;
        console.log(`    [고침] ${iri} — ${sameBody ? "" : `본문 ${String(node.description ?? "").length}→${body.length}자 `}${sameTitle ? "" : `제목 "${String(node.title ?? "")}"→"${a.title}"`}`);
        node.description = body;
        node.title = a.title;
        node._meta = {
          ...(node._meta ?? {}),
          fetchedAt: today,
          verifiedAt: today,
          verifiedBy: `법제처 lawService.do (target=eflaw, MST=${law.mst}, efYd=${law.efYd}) <별표단위>`,
          lawServiceMST: law.mst,
          annexKey: a.key,
          ...(a.hwpUrl && { hwpDownloadUrl: a.hwpUrl }),
          ...(a.pdfUrl && { pdfDownloadUrl: a.pdfUrl }),
        };
        node.verificationStatus = "verified";
        if (!DRY_RUN) await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
        synced++;
        continue;
      }
      console.log(`    [신규] ${iri} — ${a.title} (본문 ${body.length}자)`);

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
          sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(law.name)}/${a.kind}/${a.num}`,
          fetchedAt: today,
          verifiedAt: today,
          verifiedBy: `법제처 lawService.do (target=eflaw, MST=${law.mst}, efYd=${law.efYd}) <별표단위>`,
          lawServiceMST: law.mst,
          annexKey: a.key,
          ...(a.hwpUrl && { hwpDownloadUrl: a.hwpUrl }),
          ...(a.pdfUrl && { pdfDownloadUrl: a.pdfUrl }),
          licenseHint: "저작권법 제7조 비보호 (자유 인용)"
        },
        description: body,
        legislationIdentifier: law.actKey,
        jurisdiction: "KR"
      };
      if (!DRY_RUN) await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
      created++;
      existingAnnexes.set(iri, path);
    }
  }
  console.log(`\n✅ 고친 별표·서식 ${synced} · 새로 만든 것 ${created}${DRY_RUN ? " (dry-run — 파일은 그대로)" : ""}`);
})();
