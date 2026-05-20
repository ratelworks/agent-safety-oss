#!/usr/bin/env tsx
/**
 * sync-interpretations.ts
 *
 * 법제처 lawSearch.do?target=expc 로 정부유권해석 검색.
 * 안건명에서 조문 IRI 추출 → interpretation 노드 생성 + article.interpretedBy 추가.
 *
 * 검색 키워드: 각 법령 명칭으로 별도 검색 → 안건명 매칭으로 article 식별.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const INTERPS = resolve(ROOT, "src", "ontology", "graph", "nodes", "interpretations");
const OC = process.env.LAW_OC || "ryongkoon1984";

const SEARCH_KEYWORDS = [
  "산업안전보건법",
  "산업안전보건법시행령",
  "산업안전보건법시행규칙",
  "산업안전보건기준에관한규칙",
  "중대재해처벌",
];

// 안건명에서 법령 식별 매핑
const LAW_PATTERNS: Array<{ regex: RegExp; actKey: string }> = [
  { regex: /「산업안전보건법\s*시행령」/, actKey: "산안법시행령" },
  { regex: /「산업안전보건법\s*시행규칙」/, actKey: "산안법시행규칙" },
  { regex: /「산업안전보건기준에\s*관한\s*규칙」/, actKey: "기준규칙" },
  { regex: /「산업안전보건법」/, actKey: "산안법" },
  { regex: /「중대재해\s*처벌\s*등에\s*관한\s*법률\s*시행령」/, actKey: "중처법시행령" },
  { regex: /「중대재해\s*처벌\s*등에\s*관한\s*법률」/, actKey: "중처법" },
];

interface InterpResult {
  serialId: string;
  caseName: string;
  caseNumber: string;
  questioningOrg: string;
  responseOrg: string;
  responseDate: string;
  detailUrl?: string;
}

async function searchInterpretations(query: string, page = 1): Promise<{ items: InterpResult[]; total: number }> {
  const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=expc&query=${encodeURIComponent(query)}&display=100&page=${page}&type=XML`;
  const xml = await fetch(url).then(r => r.text());
  const totalMatch = xml.match(/<totalCnt>(\d+)<\/totalCnt>/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  const items: InterpResult[] = [];
  for (const m of xml.matchAll(/<expc id="\d+">([\s\S]*?)<\/expc>/g)) {
    const block = m[1];
    const get = (tag: string) => {
      const r = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([^<\\]]+)`));
      return r ? r[1].trim() : "";
    };
    items.push({
      serialId: get("법령해석례일련번호"),
      caseName: get("안건명"),
      caseNumber: get("안건번호"),
      questioningOrg: get("질의기관명"),
      responseOrg: get("회신기관명"),
      responseDate: get("회신일자"),
    });
  }
  return { items, total };
}

// 안건명에서 조문 IRI 추출
function extractArticleIris(caseName: string, articleByActNum: Map<string, string>): string[] {
  const refs = new Set<string>();
  // 각 법령 패턴 매칭
  for (const lp of LAW_PATTERNS) {
    if (!lp.regex.test(caseName)) continue;
    // 그 법령 패턴 다음에 "제N조" 추출
    // 안건명 예시: "「산업안전보건법」 제161조제1항 등 관련"
    // 또는: "「산업안전보건법 시행령」 별표 1 제4호가목 등 관련"
    for (const m of caseName.matchAll(/제(\d+)조(?:의(\d+))?/g)) {
      const num = m[1];
      const sub = m[2];
      const articleNum = sub ? `${num}의${sub}` : num;
      const iri = `art:${lp.actKey}:${articleNum}`;
      if (articleByActNum.has(`${lp.actKey}:${articleNum}`)) refs.add(iri);
    }
  }
  return [...refs];
}

(async () => {
  await mkdir(INTERPS, { recursive: true });

  // 1. article 인덱스
  const articleByActNum = new Map<string, string>();
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(ARTICLES, f), "utf-8")) as { "@id"?: string };
    if (node["@id"]) {
      const [, actKey, num] = node["@id"].split(":");
      articleByActNum.set(`${actKey}:${num}`, node["@id"]);
    }
  }
  console.log(`[load] ${articleByActNum.size} article 인덱스`);

  // 2. 키워드별 해석례 검색 + 누적
  const allInterps = new Map<string, InterpResult>();
  for (const kw of SEARCH_KEYWORDS) {
    const { items, total } = await searchInterpretations(kw);
    console.log(`  [search] "${kw}" → ${items.length}/${total}`);
    for (const it of items) allInterps.set(it.serialId, it);
    // 추가 페이지 (총 100건씩 페이징)
    const pages = Math.min(Math.ceil(total / 100), 5);
    for (let p = 2; p <= pages; p++) {
      const { items: more } = await searchInterpretations(kw, p);
      for (const it of more) allInterps.set(it.serialId, it);
    }
  }
  console.log(`\n[total] 중복 제거 후 ${allInterps.size} 해석례\n`);

  // 3. interpretation 노드 생성 + article 매핑 수집
  const articleInterps = new Map<string, string[]>();  // article IRI → interpretation IRI 목록
  let createdNodes = 0;
  for (const it of allInterps.values()) {
    const articleIris = extractArticleIris(it.caseName, articleByActNum);
    if (articleIris.length === 0) continue;  // 조문 매칭 실패 시 skip

    const interpIri = `interp:${it.serialId}`;
    const fname = `interpretation-${it.serialId}.jsonld`;
    const obj = {
      "@context": "../../context.jsonld",
      "@id": interpIri,
      "@type": ["Interpretation", "DigitalDocument"],
      caseName: it.caseName,
      caseNumber: it.caseNumber,
      questioningOrganization: it.questioningOrg,
      respondingOrganization: it.responseOrg,
      responseDate: it.responseDate,
      relatedArticles: articleIris,
      verificationStatus: "verified",
      _meta: {
        publishedBy: "법제처 국가법령정보센터 — 정부유권해석",
        sourceUrl: `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=expc&ID=${it.serialId}`,
        fetchedAt: new Date().toISOString().substring(0, 10),
        licenseHint: "저작권법 §7 비보호 (자유 인용)",
        note: "정부유권해석례 메타. 본문은 sourceUrl 또는 lawService.do?target=expc 직접 호출."
      },
      description: it.caseName,
      jurisdiction: "KR"
    };
    await writeFile(resolve(INTERPS, fname), JSON.stringify(obj, null, 2) + "\n", "utf-8");
    createdNodes++;

    for (const aIri of articleIris) {
      const arr = articleInterps.get(aIri) ?? [];
      arr.push(interpIri);
      articleInterps.set(aIri, arr);
    }
  }
  console.log(`[interpretation] ${createdNodes} 노드 생성`);

  // 4. article 의 interpretedBy 보강
  let articlesUpdated = 0, totalLinks = 0;
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ARTICLES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const iri = node["@id"] as string;
    const interps = articleInterps.get(iri);
    if (!interps || interps.length === 0) continue;
    const cur = (node.interpretedBy as string[] | undefined) ?? [];
    const set = new Set([...cur, ...interps]);
    if (set.size > cur.length) {
      node.interpretedBy = [...set];
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      articlesUpdated++;
      totalLinks += set.size - cur.length;
    }
  }
  console.log(`[interpretedBy] ${articlesUpdated} article 갱신, ${totalLinks} 엣지 추가`);
})();
