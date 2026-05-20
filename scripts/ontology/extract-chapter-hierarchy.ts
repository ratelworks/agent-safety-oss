#!/usr/bin/env tsx
/**
 * extract-chapter-hierarchy.ts
 *
 * 법제처 XML 의 <조문여부>전문</조문여부> 블록에서 편·장·절 정보 추출.
 * Chapter / Section 노드 자동 생성 + article 의 partOf 를 chapter/section 으로 다층화.
 *
 * ELI 4계층 표준: Act → Part(편) → Chapter(장) → Section(절) → Article(조)
 *
 * 노드:
 *   - chapter:산안법:1장 (제1장 총칙)
 *   - section:산안법:1장-1절 (제1절 안전보건관리체제)
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const CHAPTERS = resolve(ROOT, "src", "ontology", "graph", "nodes", "chapters");
const OC = process.env.LAW_OC || "ryongkoon1984";

const LAWS = [
  { actKey: "산안법",        mst: "276853", actNode: "act:산업안전보건법",                name: "산업안전보건법" },
  { actKey: "산안법시행령",   mst: "284771", actNode: "act:산업안전보건법시행령",          name: "산업안전보건법 시행령" },
  { actKey: "산안법시행규칙", mst: "271485", actNode: "act:산업안전보건법시행규칙",        name: "산업안전보건법 시행규칙" },
  { actKey: "기준규칙",       mst: "273603", actNode: "act:산업안전보건기준에관한규칙",   name: "산업안전보건기준에 관한 규칙" },
  { actKey: "중처법",         mst: "228817", actNode: "act:중대재해처벌등에관한법률",      name: "중대재해 처벌 등에 관한 법률" },
  { actKey: "중처법시행령",   mst: "277417", actNode: "act:중대재해처벌등에관한법률시행령", name: "중대재해 처벌 등에 관한 법률 시행령" },
];

interface Header { type: "chapter" | "section" | "part"; num: string; title: string; afterArticle: number; }

(async () => {
  await mkdir(CHAPTERS, { recursive: true });

  // 모든 article 인덱스
  const articleByActNum = new Map<string, { path: string; node: Record<string, unknown> }>();
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ARTICLES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const iri = node["@id"] as string;
    const [, actKey, num] = iri.split(":");
    articleByActNum.set(`${actKey}:${num}`, { path, node });
  }

  let totalChapters = 0, totalSections = 0, totalArticleLinks = 0;

  for (const law of LAWS) {
    const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&MST=${law.mst}&type=XML`;
    const xml = await fetch(url).then(r => r.text());
    const blocks = [...xml.matchAll(/<조문단위[^>]*>([\s\S]*?)<\/조문단위>/g)];

    // 편/장/절 헤더 + 마지막 조문번호 추적
    const headers: Header[] = [];
    let lastArticleNum = 0;
    for (const b of blocks) {
      const inner = b[1];
      const isJoMun = inner.match(/<조문여부>조문<\/조문여부>/);
      const isHeader = inner.match(/<조문여부>전문<\/조문여부>/);
      const numMatch = inner.match(/<조문번호>(\d+)<\/조문번호>/);
      if (isJoMun) {
        if (numMatch) lastArticleNum = parseInt(numMatch[1], 10);
        continue;
      }
      if (!isHeader) continue;
      // 헤더 제목 추출
      const contentMatch = inner.match(/<조문내용>\s*<!\[CDATA\[\s*([^\]]+)\s*\]\]>/);
      if (!contentMatch) continue;
      const text = contentMatch[1].trim();
      const partMatch = text.match(/^제(\d+)편\s*(.+)$/);
      const chapterMatch = text.match(/^제(\d+)장\s*(.+)$/);
      const sectionMatch = text.match(/^제(\d+)절\s*(.+)$/);
      if (partMatch)        headers.push({ type: "part",    num: partMatch[1],    title: partMatch[2].trim(),    afterArticle: lastArticleNum });
      else if (chapterMatch) headers.push({ type: "chapter", num: chapterMatch[1], title: chapterMatch[2].trim(), afterArticle: lastArticleNum });
      else if (sectionMatch) headers.push({ type: "section", num: sectionMatch[1], title: sectionMatch[2].trim(), afterArticle: lastArticleNum });
    }

    // 헤더 노드 생성 + article 매핑
    let currentChapter: { iri: string; num: string; title: string } | null = null;
    let currentSection: { iri: string; num: string; title: string } | null = null;
    const chapterArticles: Map<string, string[]> = new Map();
    const sectionArticles: Map<string, string[]> = new Map();
    const chapterDef: Map<string, { iri: string; num: string; title: string }> = new Map();
    const sectionDef: Map<string, { iri: string; num: string; title: string }> = new Map();

    let articleIdx = 0;
    let lastArtNum = 0;
    for (const b of blocks) {
      const inner = b[1];
      const isJoMun = inner.match(/<조문여부>조문<\/조문여부>/);
      const isHeader = inner.match(/<조문여부>전문<\/조문여부>/);
      const numMatch = inner.match(/<조문번호>(\d+)<\/조문번호>/);
      const subMatch = inner.match(/<조문가지번호>(\d+)<\/조문가지번호>/);

      if (isHeader) {
        const contentMatch = inner.match(/<조문내용>\s*<!\[CDATA\[\s*([^\]]+)\s*\]\]>/);
        if (!contentMatch) continue;
        const text = contentMatch[1].trim();
        const chapterMatch = text.match(/^제(\d+)장\s*(.+)$/);
        const sectionMatch = text.match(/^제(\d+)절\s*(.+)$/);
        if (chapterMatch) {
          const iri = `chapter:${law.actKey}:${chapterMatch[1]}장`;
          currentChapter = { iri, num: chapterMatch[1], title: chapterMatch[2].trim() };
          chapterDef.set(iri, currentChapter);
          currentSection = null;  // 새 장 → 절 reset
        } else if (sectionMatch && currentChapter) {
          const iri = `section:${law.actKey}:${currentChapter.num}장-${sectionMatch[1]}절`;
          currentSection = { iri, num: sectionMatch[1], title: sectionMatch[2].trim() };
          sectionDef.set(iri, currentSection);
        }
      } else if (isJoMun && numMatch) {
        const num = parseInt(numMatch[1], 10);
        const sub = subMatch ? parseInt(subMatch[1], 10) : 0;
        const articleNum = sub > 0 ? `${num}의${sub}` : `${num}`;
        const articleEntry = articleByActNum.get(`${law.actKey}:${articleNum}`);
        if (!articleEntry) continue;

        // partOf 다층화: section > chapter > act
        const newPartOf = currentSection?.iri ?? currentChapter?.iri ?? law.actNode;
        articleEntry.node.partOf = newPartOf;

        if (currentSection) {
          const arr = sectionArticles.get(currentSection.iri) ?? [];
          arr.push(articleEntry.node["@id"] as string);
          sectionArticles.set(currentSection.iri, arr);
        } else if (currentChapter) {
          const arr = chapterArticles.get(currentChapter.iri) ?? [];
          arr.push(articleEntry.node["@id"] as string);
          chapterArticles.set(currentChapter.iri, arr);
        }
      }
    }

    // chapter/section 노드 파일 생성
    for (const [iri, c] of chapterDef.entries()) {
      const fname = `${law.actKey}-${c.num}장.jsonld`;
      const obj: Record<string, unknown> = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": ["Chapter", "Legislation"],
        chapterNumber: c.num,
        title: c.title,
        partOf: law.actNode,
        verificationStatus: "verified",
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          fetchedAt: new Date().toISOString().substring(0, 10),
          licenseHint: "저작권법 §7 비보호 (자유 인용)",
          note: "법령 위계 — 편·장·절 (Phase 5 wave2)."
        },
        description: `${law.name} 제${c.num}장 ${c.title}`,
        legislationIdentifier: law.name,
        jurisdiction: "KR",
        hasArticle: chapterArticles.get(iri) ?? [],
      };
      // 속한 절 목록도 추가
      const sections = [...sectionDef.values()].filter(s => s.iri.startsWith(`section:${law.actKey}:${c.num}장-`)).map(s => s.iri);
      if (sections.length > 0) (obj as Record<string, unknown>).hasSection = sections;
      await writeFile(resolve(CHAPTERS, fname), JSON.stringify(obj, null, 2) + "\n", "utf-8");
      totalChapters++;
    }
    for (const [iri, s] of sectionDef.entries()) {
      const fname = `${law.actKey}-${iri.split(":")[2]}.jsonld`;
      const chapterIri = `chapter:${law.actKey}:${s.iri.split(":")[2].split("-")[0]}`;
      const obj: Record<string, unknown> = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": ["Section", "Legislation"],
        sectionNumber: s.num,
        title: s.title,
        partOf: chapterIri,
        verificationStatus: "verified",
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          fetchedAt: new Date().toISOString().substring(0, 10),
          licenseHint: "저작권법 §7 비보호 (자유 인용)"
        },
        description: `${law.name} 제${s.num}절 ${s.title}`,
        legislationIdentifier: law.name,
        jurisdiction: "KR",
        hasArticle: sectionArticles.get(iri) ?? [],
      };
      await writeFile(resolve(CHAPTERS, fname), JSON.stringify(obj, null, 2) + "\n", "utf-8");
      totalSections++;
    }

    // article 파일 갱신
    for (const [_, entry] of articleByActNum.entries()) {
      const iri = entry.node["@id"] as string;
      if (!iri.startsWith(`art:${law.actKey}:`)) continue;
      await writeFile(entry.path, JSON.stringify(entry.node, null, 2) + "\n", "utf-8");
      totalArticleLinks++;
    }

    console.log(`[${law.actKey.padEnd(15)}] 장 ${chapterDef.size} + 절 ${sectionDef.size}`);
  }

  console.log(`\n✅ 총 ${totalChapters} chapter + ${totalSections} section 노드 생성. ${totalArticleLinks} article partOf 갱신.`);

  // act 노드의 hasChapter 보강
  const ACTS = resolve(ROOT, "src", "ontology", "graph", "nodes", "acts");
  for (const law of LAWS) {
    const actFile = `${law.name.replace(/\s/g, "")}.jsonld`;
    const actPath = resolve(ACTS, actFile);
    try {
      const node = JSON.parse(await readFile(actPath, "utf-8")) as Record<string, unknown>;
      const chapters: string[] = [];
      for (const f of await readdir(CHAPTERS)) {
        if (!f.startsWith(`${law.actKey}-`) || !f.includes("장")) continue;
        if (f.includes("-")) continue;  // 절 파일 제외
        const ch = JSON.parse(await readFile(resolve(CHAPTERS, f), "utf-8")) as { "@id"?: string };
        if (ch["@id"]?.startsWith(`chapter:${law.actKey}:`)) chapters.push(ch["@id"]);
      }
      if (chapters.length > 0) {
        node.hasChapter = chapters.sort();
        await writeFile(actPath, JSON.stringify(node, null, 2) + "\n", "utf-8");
      }
    } catch {}
  }
})();
