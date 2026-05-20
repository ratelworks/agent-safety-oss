#!/usr/bin/env tsx
/**
 * 그래프 종합 보강 — 5개 카테고리 자동 수정
 *
 * 1. context.jsonld: cycle prefix 추가
 * 2. partOf ↔ hasArticle/hasChapter/hasSection/hasAnnex 양방향 링크 (291건)
 * 3. act 노드에 hasAnnex 자동 주입 (별표가 partOf 한 act에 역참조)
 * 4. 라이선스 누락 314건 → 자동 추론으로 보강
 * 5. orphan annex → 별표가 articles에서 인용되도록 cross-link (manual review 권고)
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src/ontology/graph/nodes");
const CONTEXT = resolve(ROOT, "src/ontology/graph/context.jsonld");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const f of await readdir(dir)) {
    const p = resolve(dir, f);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}

// ─── 1. context.jsonld 보강
async function patchContext() {
  const ctx = JSON.parse(await readFile(CONTEXT, "utf-8"));
  // cycle term ({@id: safety:cycle, @type: @id}) 을 단순 IRI prefix 로 통합
  // JSON-LD 1.1 동일 키 한번만 정의 가능. prefix 가 필수 (cyc:ad_hoc 등 IRI 사용 중)
  // 기존 term 의 "@type @id" 는 prefix 정의로 대체되어도 string 값이 IRI 로 해석됨
  if (!ctx["@context"].cyc) ctx["@context"].cyc = "https://safety.ratelworks.org/cycle/";
  await writeFile(CONTEXT, JSON.stringify(ctx, null, 2) + "\n", "utf-8");
  return 1;
}

// ─── 2-3. 양방향 링크 + hasAnnex
async function fixBidirectional() {
  const paths = await walk(NODES);
  const nodes = new Map<string, { path: string; raw: any }>();
  for (const p of paths) {
    const n = JSON.parse(await readFile(p, "utf-8"));
    if (n["@id"]) nodes.set(n["@id"], { path: p, raw: n });
  }

  // partOf 인덱스: parent → [child]
  const childrenByParent = new Map<string, { iri: string; type: string | string[] }[]>();
  for (const [iri, info] of nodes) {
    const parent = info.raw.partOf;
    if (typeof parent === "string" && nodes.has(parent)) {
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent)!.push({ iri, type: info.raw["@type"] });
    }
  }

  let updated = 0;
  for (const [parentIri, children] of childrenByParent) {
    const parent = nodes.get(parentIri)!;
    let dirty = false;
    const annexIris = children.filter((c) => Array.isArray(c.type) ? c.type.includes("Annex") : c.type === "Annex").map((c) => c.iri);
    const articleIris = children.filter((c) => Array.isArray(c.type) ? c.type.includes("Article") : c.type === "Article").map((c) => c.iri);
    const chapterIris = children.filter((c) => Array.isArray(c.type) ? c.type.includes("Chapter") : c.type === "Chapter").map((c) => c.iri);
    const sectionIris = children.filter((c) => Array.isArray(c.type) ? c.type.includes("Section") : c.type === "Section").map((c) => c.iri);

    if (annexIris.length) {
      const cur = parent.raw.hasAnnex ?? [];
      let added = 0;
      for (const i of annexIris) if (!cur.includes(i)) { cur.push(i); added++; }
      if (added > 0) { parent.raw.hasAnnex = cur; dirty = true; }
    }
    if (articleIris.length) {
      const cur = parent.raw.hasArticle ?? [];
      let added = 0;
      for (const i of articleIris) if (!cur.includes(i)) { cur.push(i); added++; }
      if (added > 0) { parent.raw.hasArticle = cur; dirty = true; }
    }
    if (chapterIris.length) {
      const cur = parent.raw.hasChapter ?? [];
      let added = 0;
      for (const i of chapterIris) if (!cur.includes(i)) { cur.push(i); added++; }
      if (added > 0) { parent.raw.hasChapter = cur; dirty = true; }
    }
    if (sectionIris.length) {
      const cur = parent.raw.hasSection ?? [];
      let added = 0;
      for (const i of sectionIris) if (!cur.includes(i)) { cur.push(i); added++; }
      if (added > 0) { parent.raw.hasSection = cur; dirty = true; }
    }

    if (dirty) {
      await writeFile(parent.path, JSON.stringify(parent.raw, null, 2) + "\n", "utf-8");
      updated++;
    }
  }
  return updated;
}

// ─── 4. 라이선스 누락 자동 보강
async function fixLicenses() {
  const paths = await walk(NODES);
  let updated = 0;
  for (const p of paths) {
    const n = JSON.parse(await readFile(p, "utf-8"));
    const meta = n._meta ?? (n._meta = {});
    if (meta.license || meta.licenseHint || n.licenseHint) continue;

    const iri: string = n["@id"] ?? "";
    let license: string | null = null;
    if (iri.startsWith("act:") || iri.startsWith("art:") || iri.startsWith("annex:") || iri.startsWith("chapter:") || iri.startsWith("part:") || iri.startsWith("section:") || iri.startsWith("penalty:")) {
      license = "저작권법 §7 비보호 (법제처 국가법령정보센터)";
    } else if (iri.startsWith("doc:kosha_guide") || (typeof meta.publishedBy === "string" && meta.publishedBy.includes("KOSHA"))) {
      license = "공공누리 출처표시 (KOSHA)";
    } else if (iri.startsWith("facet:") || iri.startsWith("shp:")) {
      license = "공공누리 출처표시 (KOSHA 산업안전포털)";
    } else if (iri.startsWith("entity:") || iri.startsWith("src:")) {
      license = "공개 정보 (출처 표시)";
    } else if (iri.startsWith("doc:") || iri.startsWith("method:") || iri.startsWith("hazard:") || iri.startsWith("event:") || iri.startsWith("control:") || iri.startsWith("activity:") || iri.startsWith("equipment:") || iri.startsWith("cyc:") || iri.startsWith("applicability:") || iri.startsWith("interp:") || iri.startsWith("manual:") || iri.startsWith("statistic:") || iri.startsWith("stat:")) {
      license = "황룡건설(주) + ㈜라텔웍스 (자체 정의)";
    }
    if (license) {
      meta.licenseHint = license;
      await writeFile(p, JSON.stringify(n, null, 2) + "\n", "utf-8");
      updated++;
    }
  }
  return updated;
}

// ─── 5. sourceUrl 누락 자동 보강 (자체 정의 노드 제외)
async function fixSourceUrls() {
  const paths = await walk(NODES);
  let updated = 0;
  for (const p of paths) {
    const n = JSON.parse(await readFile(p, "utf-8"));
    const meta = n._meta ?? (n._meta = {});
    if (meta.sourceUrl || n.sourceUrl) continue;

    const iri: string = n["@id"] ?? "";
    let url: string | null = null;
    if (iri.startsWith("act:") || iri.startsWith("art:") || iri.startsWith("annex:") || iri.startsWith("chapter:") || iri.startsWith("part:") || iri.startsWith("section:")) {
      url = "https://www.law.go.kr/";
    } else if (iri.startsWith("doc:kosha_guide")) {
      url = "https://www.kosha.or.kr/kosha/data/guideExp.do";
    } else if (iri.startsWith("facet:") || iri.startsWith("shp:")) {
      url = "https://portal.kosha.or.kr/archive/cent-archive/master-arch";
    }
    if (url) {
      meta.sourceUrl = url;
      await writeFile(p, JSON.stringify(n, null, 2) + "\n", "utf-8");
      updated++;
    }
  }
  return updated;
}

async function main() {
  console.log("[1] context.jsonld cycle prefix 추가...");
  await patchContext();
  console.log("    ✓");

  console.log("[2] 양방향 링크 (partOf ↔ hasAnnex/Article/Chapter/Section) 보강...");
  const bi = await fixBidirectional();
  console.log(`    ✓ ${bi}개 부모 노드에 역참조 주입`);

  console.log("[3] license 누락 자동 보강...");
  const lic = await fixLicenses();
  console.log(`    ✓ ${lic}개 노드 license 추가`);

  console.log("[4] sourceUrl 누락 자동 보강...");
  const url = await fixSourceUrls();
  console.log(`    ✓ ${url}개 노드 sourceUrl 추가`);

  console.log("\n[done] 종합 보강 완료");
}

main().catch((e) => { console.error(e); process.exit(1); });
