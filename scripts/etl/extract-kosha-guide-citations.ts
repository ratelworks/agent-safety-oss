#!/usr/bin/env tsx
/**
 * KOSHA Guide .md 본문의 "관련법규·규칙·고시 등" 섹션에서 법령 인용을 추출하고
 * src/ontology/graph/nodes/articles/ 의 노드 ID와 매칭.
 *
 * 출력:
 *   reports/kosha-guide-citations.json — 가이드별 매칭 결과
 *   reports/kosha-guide-extraction-stats.json — 통계
 *
 * 사용:
 *   tsx scripts/etl/extract-kosha-guide-citations.ts [--apply] [--limit=N]
 *
 * --apply 가 있으면 Guide 노드의 relatedLaw 필드를 본문 인용으로 교체.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUIDES_MD_DIR = resolve(ROOT, "src/ontology/kosha-guides");
const GUIDES_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
const ARTICLES_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/articles");
const CHAPTERS_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/chapters");
const REPORTS_DIR = resolve(ROOT, "reports");

// 편/장/절 단위 인용 패턴
const CHAPTER_NUM = /제\s*(\d+)\s*([편장절])/g;

// 법령 매칭 패턴 (긴 것 먼저)
const LAW_PATTERNS: Array<[RegExp, string]> = [
  [/산업안전보건기준에\s*관한\s*규칙/, "기준규칙"],
  [/산업안전보건법\s*시행규칙/, "산안법시행규칙"],
  [/산업안전보건법\s*시행령/, "산안법시행령"],
  [/산업안전보건법/, "산안법"],
  [/중대재해\s*처벌\s*등에?\s*관한\s*법률\s*시행령/, "중처법시행령"],
  [/중대재해\s*처벌\s*등에?\s*관한\s*법률/, "중처법"],
  [/건설기술\s*진흥법\s*시행규칙/, "건진법시행규칙"],
  [/건설기술\s*진흥법\s*시행령/, "건진법시행령"],
  [/건설기술\s*진흥법/, "건진법"],
  [/사업장\s*위험성평가\s*에?\s*관한\s*지침/, "위험성평가"],
  [/위험성평가/, "위험성평가"],
];

const ARTICLE_NUM = /제\s*(\d+)(?:\s*조의\s*(\d+))?\s*조(?:\s*제\s*(\d+)\s*항)?/g;
const SECTION_HEADER_RE = /관련\s*법(규|령)/;
const ARTICLE_RANGE = /제\s*(\d+)\s*[∼~∽-]\s*(\d+)\s*조/g;
const BULLET_LINE = /^\s*(?:[-·◦○*]|[0-9]+\.|\([0-9]+\)|[①-⑳])\s*/;

interface Citation {
  law: string;
  article: number;
  paragraph: number | null;
  rawText: string;
  fromRange?: boolean;
  fromContext?: boolean;
}

interface ChapterCitation {
  law: string;
  unit: string;
  num: number;
  rawText: string;
}

interface ArticleNode {
  id: string;
  title: string;
  articleNumber: string;
}

interface ChapterNode {
  id: string;
  title: string;
  partOf: string;
}

interface MatchedCitation extends Citation {
  articleNodeId: string;
  articleTitle: string;
}

interface MatchedChapter extends ChapterCitation {
  chapterNodeId: string;
  chapterTitle: string;
}

interface GuideResult {
  guideId: string;
  section: string | null;
  citations: Citation[];
  matched: MatchedCitation[];
  chapterCitations: ChapterCitation[];
  chapterMatched: MatchedChapter[];
}

function findLawSection(content: string): string | null {
  const lines = content.split("\n");
  let startIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADER_RE.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === null) return null;

  let endIdx = lines.length;
  let blankStreak = 0;
  for (let j = startIdx + 1; j < lines.length; j++) {
    const line = lines[j];
    const trimmed = line.trim();
    if (trimmed.startsWith("○") || trimmed.startsWith("◦")) {
      endIdx = j;
      break;
    }
    if (!trimmed) {
      blankStreak++;
      if (blankStreak >= 2) {
        endIdx = j;
        break;
      }
    } else {
      blankStreak = 0;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

function extractCitations(sectionText: string | null): Citation[] {
  const citations: Citation[] = [];
  if (!sectionText) return citations;

  const lines = sectionText.split("\n");
  let pendingLaw: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingLaw = null;
      continue;
    }
    const cleanLine = line.replace(BULLET_LINE, "");

    let matchedLaw: string | null = null;
    for (const [pat, code] of LAW_PATTERNS) {
      if (pat.test(cleanLine)) {
        matchedLaw = code;
        break;
      }
    }

    let foundInLine = false;
    if (matchedLaw) {
      ARTICLE_NUM.lastIndex = 0;
      let am: RegExpExecArray | null;
      while ((am = ARTICLE_NUM.exec(cleanLine)) !== null) {
        const article = parseInt(am[1], 10);
        const paragraph = am[3] ? parseInt(am[3], 10) : null;
        citations.push({ law: matchedLaw, article, paragraph, rawText: cleanLine.slice(0, 160) });
        foundInLine = true;
      }
      ARTICLE_RANGE.lastIndex = 0;
      let rm: RegExpExecArray | null;
      while ((rm = ARTICLE_RANGE.exec(cleanLine)) !== null) {
        const start = parseInt(rm[1], 10);
        const end = parseInt(rm[2], 10);
        if (start <= end && end - start < 100) {
          for (let art = start; art <= end; art++) {
            citations.push({ law: matchedLaw, article: art, paragraph: null, rawText: cleanLine.slice(0, 160), fromRange: true });
          }
          foundInLine = true;
        }
      }
      if (!foundInLine) {
        pendingLaw = matchedLaw;
      }
    } else if (pendingLaw) {
      ARTICLE_NUM.lastIndex = 0;
      let am: RegExpExecArray | null;
      while ((am = ARTICLE_NUM.exec(cleanLine)) !== null) {
        const article = parseInt(am[1], 10);
        const paragraph = am[3] ? parseInt(am[3], 10) : null;
        citations.push({ law: pendingLaw, article, paragraph, rawText: cleanLine.slice(0, 160), fromContext: true });
        foundInLine = true;
      }
      ARTICLE_RANGE.lastIndex = 0;
      let rm: RegExpExecArray | null;
      while ((rm = ARTICLE_RANGE.exec(cleanLine)) !== null) {
        const start = parseInt(rm[1], 10);
        const end = parseInt(rm[2], 10);
        if (start <= end && end - start < 100) {
          for (let art = start; art <= end; art++) {
            citations.push({ law: pendingLaw, article: art, paragraph: null, rawText: cleanLine.slice(0, 160), fromRange: true, fromContext: true });
          }
          foundInLine = true;
        }
      }
      if (!foundInLine) {
        if (cleanLine.includes("KOSHA") || cleanLine.includes("KS") || cleanLine.includes("BS") || cleanLine.includes("OSHA")) {
          // 외부 표준 줄, 컨텍스트 유지
        } else {
          pendingLaw = null;
        }
      }
    }
  }
  return citations;
}

function extractChapterCitations(sectionText: string | null): ChapterCitation[] {
  const chapters: ChapterCitation[] = [];
  if (!sectionText) return chapters;
  let pendingLaw: string | null = null;
  for (const rawLine of sectionText.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      pendingLaw = null;
      continue;
    }
    const cleanLine = line.replace(BULLET_LINE, "");

    let matchedLaw: string | null = null;
    for (const [pat, code] of LAW_PATTERNS) {
      if (pat.test(cleanLine)) {
        matchedLaw = code;
        break;
      }
    }

    const targetLaw = matchedLaw || pendingLaw;
    if (!targetLaw) continue;

    ARTICLE_NUM.lastIndex = 0;
    if (ARTICLE_NUM.test(cleanLine)) continue;

    CHAPTER_NUM.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = CHAPTER_NUM.exec(cleanLine)) !== null) {
      chapters.push({
        law: targetLaw,
        unit: cm[2],
        num: parseInt(cm[1], 10),
        rawText: cleanLine.slice(0, 160),
      });
    }

    if (matchedLaw && chapters.length === 0) pendingLaw = matchedLaw;
  }
  return chapters;
}

function buildArticleIndex(): Map<string, ArticleNode> {
  const index = new Map<string, ArticleNode>();
  for (const f of readdirSync(ARTICLES_NODE_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    try {
      const d = JSON.parse(readFileSync(join(ARTICLES_NODE_DIR, f), "utf8"));
      const aid: string = d["@id"];
      if (!aid || !aid.startsWith("art:")) continue;
      const parts = aid.split(":");
      if (parts.length < 3) continue;
      const law = parts[1];
      const article = parseInt(parts[2], 10);
      if (Number.isNaN(article)) continue;
      const paragraph = parts.length > 3 ? parseInt(parts[3], 10) : null;
      const key = `${law}:${article}:${paragraph ?? ""}`;
      index.set(key, {
        id: aid,
        title: d.title || "",
        articleNumber: d.articleNumber || "",
      });
    } catch (e) {
      process.stderr.write(`[WARN] ${f} 파싱 실패: ${(e as Error).message}\n`);
    }
  }
  return index;
}

function buildChapterIndex(): Map<string, ChapterNode> {
  const index = new Map<string, ChapterNode>();
  if (!existsSync(CHAPTERS_NODE_DIR)) return index;
  for (const f of readdirSync(CHAPTERS_NODE_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const d = JSON.parse(readFileSync(join(CHAPTERS_NODE_DIR, f), "utf8"));
    const cid: string = d["@id"];
    if (!cid) continue;
    const m = cid.match(/^chapter:([^:]+):(\d+)장/);
    if (m) {
      index.set(`${m[1]}:${m[2]}`, {
        id: cid,
        title: d.title || "",
        partOf: d.partOf || "",
      });
    }
  }
  return index;
}

function matchCitation(c: Citation, index: Map<string, ArticleNode>): ArticleNode | null {
  const k1 = `${c.law}:${c.article}:${c.paragraph ?? ""}`;
  if (index.has(k1)) return index.get(k1)!;
  const k2 = `${c.law}:${c.article}:`;
  if (index.has(k2)) return index.get(k2)!;
  return null;
}

function matchChapter(c: ChapterCitation, index: Map<string, ChapterNode>): ChapterNode | null {
  if (c.unit !== "장") return null;
  return index.get(`${c.law}:${c.num}`) || null;
}

function updateGuideNodes(results: GuideResult[]): number {
  let updated = 0;
  let skippedNoNode = 0;
  for (const r of results) {
    if (r.matched.length === 0 && r.chapterMatched.length === 0 && r.chapterCitations.length === 0) continue;
    const gid = r.guideId;
    const candidates = [join(GUIDES_NODE_DIR, `${gid.toLowerCase()}.jsonld`), join(GUIDES_NODE_DIR, `${gid}.jsonld`)];
    const guideNodePath = candidates.find((p) => existsSync(p));
    if (!guideNodePath) {
      skippedNoNode++;
      continue;
    }
    const d = JSON.parse(readFileSync(guideNodePath, "utf8"));

    let citedAsOf: string | null = null;
    const yearMatch = gid.match(/-(\d{4})$/);
    if (yearMatch) citedAsOf = yearMatch[1];

    if (d.relatedLaw && !d._legacyRelatedLaw) d._legacyRelatedLaw = d.relatedLaw;

    if (r.chapterMatched.length > 0) {
      d.relatedChapter = r.chapterMatched.map((cm) => ({
        chapterNodeId: cm.chapterNodeId,
        law: cm.law,
        chapterTitle: cm.chapterTitle,
        source: "guide_body_citation",
        rawCitation: (cm.rawText || "").slice(0, 140),
      }));
    }

    const rawChapter = r.chapterCitations.filter(
      (c) => !r.chapterMatched.some((cm) => cm.law === c.law && cm.num === c.num),
    );
    if (rawChapter.length > 0) {
      d.rawChapterCitations = rawChapter.map((c) => ({
        law: c.law,
        unit: c.unit,
        num: c.num,
        rawCitation: (c.rawText || "").slice(0, 140),
        needsNode: true,
      }));
    }

    const newRelated: any[] = [];
    for (const m of r.matched) {
      const entry: any = {
        articleNodeId: m.articleNodeId,
        law: m.law,
        articleNumber: String(m.article) + (m.paragraph ? `(${m.paragraph})` : ""),
        title: m.articleTitle,
        source: "guide_body_citation",
        score: 100,
        rawCitation: (m.rawText || "").slice(0, 140),
      };
      if (citedAsOf) {
        entry.citedAsOf = citedAsOf;
        entry.temporalNote =
          `KOSHA Guide ${gid} 본문 직접 인용 (${citedAsOf}년 발행 시점). ` +
          `article 노드는 현재 법령이므로 그 사이 개정이 있다면 본문 의미와 article 노드 내용이 다를 수 있음. ` +
          `정확한 발행 시점 법령은 가이드 원문 (sourceUrl) 참조.`;
      }
      newRelated.push(entry);
    }
    if (newRelated.length > 0) {
      d.relatedLaw = newRelated;
      (d._meta ||= {}).relatedLawSource = "guide_body_citation_v1";
      d._meta.relatedLawUpdatedAt = "2026-05-18";
    } else if (r.chapterMatched.length > 0 || r.chapterCitations.length > 0) {
      (d._meta ||= {}).relatedChapterUpdatedAt = "2026-05-18";
    }

    writeFileSync(guideNodePath, JSON.stringify(d, null, 2), "utf8");
    updated++;
  }
  if (skippedNoNode > 0) process.stderr.write(`  [WARN] ${skippedNoNode}건의 가이드는 노드 파일을 찾지 못해 스킵\n`);
  return updated;
}

function main() {
  const args = process.argv.slice(2);
  const applyChanges = args.includes("--apply");
  let limit: number | null = null;
  for (const a of args) {
    if (a.startsWith("--limit=")) limit = parseInt(a.split("=")[1], 10);
  }

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const articleIndex = buildArticleIndex();
  const chapterIndex = buildChapterIndex();
  process.stderr.write(`Article 인덱스: ${articleIndex.size}개 노드 로드\n`);
  process.stderr.write(`Chapter 인덱스: ${chapterIndex.size}개 노드 로드\n`);

  let mdFiles = readdirSync(GUIDES_MD_DIR).filter((f) => f.endsWith(".md")).sort();
  if (limit) mdFiles = mdFiles.slice(0, limit);
  process.stderr.write(`.md 파일: ${mdFiles.length}개 처리\n`);

  const results: GuideResult[] = [];
  const stats: any = {
    totalMd: mdFiles.length,
    withSection: 0,
    withAnyCitation: 0,
    withMatchedArticle: 0,
    totalCitations: 0,
    totalMatched: 0,
    totalChapterCitations: 0,
    totalChapterMatched: 0,
    byLaw: {} as Record<string, number>,
    byLawMatched: {} as Record<string, number>,
    unmatchedSample: [] as Array<{ guideId: string; law: string; article: number; paragraph: number | null }>,
  };

  for (const f of mdFiles) {
    const guideId = f.replace(".md", "");
    const content = readFileSync(join(GUIDES_MD_DIR, f), "utf8");
    const section = findLawSection(content);
    if (!section) {
      results.push({ guideId, section: null, citations: [], matched: [], chapterCitations: [], chapterMatched: [] });
      continue;
    }
    stats.withSection++;
    const citations = extractCitations(section);
    const chapterCitations = extractChapterCitations(section);
    if (citations.length > 0) stats.withAnyCitation++;
    stats.totalCitations += citations.length;
    stats.totalChapterCitations += chapterCitations.length;

    const matched: MatchedCitation[] = [];
    for (const c of citations) {
      stats.byLaw[c.law] = (stats.byLaw[c.law] || 0) + 1;
      const m = matchCitation(c, articleIndex);
      if (m) {
        stats.totalMatched++;
        stats.byLawMatched[c.law] = (stats.byLawMatched[c.law] || 0) + 1;
        matched.push({ ...c, articleNodeId: m.id, articleTitle: m.title });
      } else {
        if (stats.unmatchedSample.length < 30) {
          stats.unmatchedSample.push({ guideId, law: c.law, article: c.article, paragraph: c.paragraph });
        }
      }
    }

    const chapterMatched: MatchedChapter[] = [];
    for (const c of chapterCitations) {
      const m = matchChapter(c, chapterIndex);
      if (m) {
        stats.totalChapterMatched++;
        chapterMatched.push({ ...c, chapterNodeId: m.id, chapterTitle: m.title });
      }
    }

    if (matched.length > 0 || chapterMatched.length > 0) stats.withMatchedArticle++;
    results.push({
      guideId,
      section: section.slice(0, 200),
      citations,
      matched,
      chapterCitations,
      chapterMatched,
    });
  }

  writeFileSync(join(REPORTS_DIR, "kosha-guide-citations.json"), JSON.stringify(results, null, 2), "utf8");
  writeFileSync(join(REPORTS_DIR, "kosha-guide-extraction-stats.json"), JSON.stringify(stats, null, 2), "utf8");

  console.log(`\n=== 추출 결과 (limit=${limit ?? "none"}) ===`);
  console.log(`  총 .md 파일             : ${stats.totalMd}`);
  console.log(`  관련법규 섹션 있음        : ${stats.withSection} (${(stats.withSection / stats.totalMd * 100).toFixed(1)}%)`);
  console.log(`  최소 1건 추출            : ${stats.withAnyCitation} (${(stats.withAnyCitation / stats.totalMd * 100).toFixed(1)}%)`);
  console.log(`  최소 1건 article 매칭     : ${stats.withMatchedArticle} (${(stats.withMatchedArticle / stats.totalMd * 100).toFixed(1)}%)`);
  console.log(`  총 인용                : ${stats.totalCitations}`);
  console.log(`  매칭된 인용            : ${stats.totalMatched} (${(stats.totalMatched / Math.max(stats.totalCitations, 1) * 100).toFixed(1)}%)`);
  console.log(`\n  법령별 추출 (상위 10):`);
  const sortedLaws = Object.entries(stats.byLaw as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [law, cnt] of sortedLaws) {
    const matched = stats.byLawMatched[law] || 0;
    console.log(`    ${law.padEnd(20)} ${String(cnt).padStart(5)} 추출 / ${String(matched).padStart(5)} 매칭 (${(matched / cnt * 100).toFixed(1)}%)`);
  }
  console.log(`\n  미매칭 샘플 (상위 5):`);
  for (const s of stats.unmatchedSample.slice(0, 5)) {
    const paraStr = s.paragraph ? `-제${s.paragraph}항` : "";
    console.log(`    ${s.guideId.padEnd(15)} ${s.law}:${s.article}${paraStr}`);
  }
  console.log(`\n  저장:`);
  console.log(`    reports/kosha-guide-citations.json`);
  console.log(`    reports/kosha-guide-extraction-stats.json`);

  if (applyChanges) {
    console.log(`\n[--apply] Guide 노드 업데이트 시작...`);
    const updated = updateGuideNodes(results);
    console.log(`  업데이트 완료: ${updated}건`);
  }
}

main();
