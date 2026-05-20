#!/usr/bin/env tsx
/**
 * audit-law-ontology.ts
 *
 * 법령 article 1298개의 온톨로지 풍부도 정밀 진단.
 * 단순 분류 인덱스(act 산하 list)인지, 진짜 온톨로지(조문 간 관계 풍부)인지 측정.
 *
 * 측정축:
 *   1. 평균 out-degree (article 당 outgoing edge 수)
 *   2. 평균 in-degree (article 당 incoming edge 수)
 *   3. 관계 종류 다양도 (delegates/references/penalizedBy/hasAnnex/legalBasisOf 보유 비율)
 *   4. 편/장/절 위계 정보 (partOf 다층화)
 *   5. 별표 연결 비율
 *   6. 본문에 있지만 그래프 미반영 위임 패턴 ("대통령령/고용노동부령으로 정한다")
 *   7. 본문 인용 패턴 ("제N조") 추출 가능 수
 *   8. schema.org Legislation 표준 속성 충실도
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "articles");
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");

const RELATION_PROPS = ["delegates", "references", "penalizedBy", "hasAnnex", "regulates", "legalBasisOf", "amendedTo", "interpretedBy", "informedBy", "auditedBy", "cited_in"];

(async () => {
  const articles: Array<{ iri: string; node: Record<string, unknown>; description: string }> = [];
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(ARTICLES, f), "utf-8")) as Record<string, unknown>;
    const desc = String(node.description ?? "");
    articles.push({ iri: node["@id"] as string, node, description: desc });
  }

  // 전체 그래프 in-edge 수집
  const inDegree = new Map<string, number>();
  const allFiles: string[] = [];
  async function walk(dir: string) {
    for (const e of await readdir(dir)) {
      const p = resolve(dir, e);
      const { stat } = await import("node:fs/promises");
      const st = await stat(p);
      if (st.isDirectory()) await walk(p);
      else if (e.endsWith(".jsonld")) allFiles.push(p);
    }
  }
  await walk(NODES);
  const ALL_PROPS = ["delegates","references","hasArticle","partOf","hasAnnex","specifies","regulates","penalizedBy","appliesTo","requires","mitigatedBy","mitigates","causedBy","evaluatedBy","cycledAs","legalBasisOf","legalBasis","penaltyOnMissing","relatedDocs","guidedBy","amendedTo","interpretedBy","auditedBy","informedBy","hasHazard","regulatedBy","cycle"];
  for (const f of allFiles) {
    const n = JSON.parse(await readFile(f, "utf-8"));
    for (const p of ALL_PROPS) {
      const v = n[p]; if (!v) continue;
      const arr = Array.isArray(v) ? v : [v];
      for (const t of arr) if (typeof t === "string") inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
    }
  }

  console.log("\n╔══ 법령 그래프 온톨로지 풍부도 진단 ══╗\n");

  // ─── 1. 관계 보유 비율 ───
  console.log("[1] article 별 관계 보유 비율 (총 article: " + articles.length + ")");
  for (const prop of RELATION_PROPS) {
    const has = articles.filter(a => {
      const v = a.node[prop];
      return Array.isArray(v) ? v.length > 0 : !!v;
    }).length;
    const pct = ((has / articles.length) * 100).toFixed(1);
    const status = has > articles.length * 0.3 ? "✅" : has > articles.length * 0.05 ? "⚠️" : "❌";
    console.log(`  ${status} ${prop.padEnd(15)} ${String(has).padStart(4)} / ${articles.length} (${pct}%)`);
  }

  // ─── 2. 평균 out-degree ───
  let totalOutEdges = 0;
  for (const a of articles) {
    for (const p of ALL_PROPS) {
      const v = a.node[p];
      if (!v) continue;
      totalOutEdges += Array.isArray(v) ? v.length : 1;
    }
  }
  console.log(`\n[2] 평균 out-degree: ${(totalOutEdges/articles.length).toFixed(1)} (article 당)`);

  // ─── 3. 평균 in-degree ───
  let totalInEdges = 0;
  let articlesWithInEdge = 0;
  for (const a of articles) {
    const ind = inDegree.get(a.iri) ?? 0;
    totalInEdges += ind;
    if (ind > 0) articlesWithInEdge++;
  }
  console.log(`[3] 평균 in-degree:  ${(totalInEdges/articles.length).toFixed(1)} (article 당)`);
  console.log(`    in-edge 보유 article: ${articlesWithInEdge}/${articles.length} (${((articlesWithInEdge/articles.length)*100).toFixed(1)}%)`);

  // ─── 4. 본문에 있지만 그래프 미반영: 위임 패턴 ───
  let bodyDelegationsLawDecree = 0;  // 대통령령으로 정한다
  let bodyDelegationsRule = 0;       // 고용노동부령으로 정한다
  let bodyAnnexRefs = 0;             // 별표 N
  let bodyArticleRefs = 0;           // 제N조
  let bodyOtherLawRefs = 0;          // 「OO법」 제N조
  for (const a of articles) {
    const d = a.description;
    bodyDelegationsLawDecree += (d.match(/대통령령으로 정한다|대통령령으로 정하는/g) ?? []).length;
    bodyDelegationsRule += (d.match(/고용노동부령으로 정한다|고용노동부령으로 정하는|장관이 정하는|장관이 정하여 고시/g) ?? []).length;
    bodyAnnexRefs += (d.match(/별표\s*\d+/g) ?? []).length;
    bodyArticleRefs += (d.match(/제\d+조(?!의)/g) ?? []).length;
    bodyOtherLawRefs += (d.match(/「[^」]+법[^」]*」/g) ?? []).length;
  }
  console.log(`\n[4] 본문 패턴 (자동 추출 가능)`);
  console.log(`    "대통령령으로 정한다"      : ${bodyDelegationsLawDecree} 건 — 시행령 위임`);
  console.log(`    "고용노동부령으로 정한다"   : ${bodyDelegationsRule} 건 — 시행규칙·고시 위임`);
  console.log(`    "별표 N"                  : ${bodyAnnexRefs} 건 — annex 연결 가능`);
  console.log(`    "제N조" (동일 법령 인용)   : ${bodyArticleRefs} 건`);
  console.log(`    "「외부법」"                : ${bodyOtherLawRefs} 건 — 외부 법령 인용`);

  // ─── 5. 편/장/절 정보 ───
  // 현재 partOf는 act:N 만 가리킴. 편/장/절 노드 없음.
  let withChapterInfo = 0;
  for (const a of articles) {
    const pof = a.node.partOf;
    if (typeof pof === "string" && (pof.includes("chapter") || pof.includes("section"))) withChapterInfo++;
  }
  console.log(`\n[5] 편/장/절 위계: ${withChapterInfo}/${articles.length} 보유 (현재 partOf는 act 직접 → 평탄 구조)`);

  // ─── 6. 별표 연결 ───
  let articlesWithAnnex = 0;
  for (const a of articles) {
    const v = a.node.hasAnnex;
    if (Array.isArray(v) && v.length > 0) articlesWithAnnex++;
  }
  console.log(`[6] hasAnnex 엣지: ${articlesWithAnnex}/${articles.length} article (별표 직접 연결)`);

  // ─── 7. schema.org Legislation 표준 속성 ───
  const SCHEMA_PROPS = ["legislationIdentifier","legislationDate","legislationType","legislationLegalForce","jurisdiction","temporalCoverage"];
  console.log(`\n[7] schema.org Legislation 표준 속성 보유율`);
  for (const p of SCHEMA_PROPS) {
    const has = articles.filter(a => !!a.node[p]).length;
    console.log(`    ${p.padEnd(28)} ${has}/${articles.length} (${((has/articles.length)*100).toFixed(0)}%)`);
  }

  // ─── 8. 진단 종합 ───
  console.log(`\n[8] 진단 종합`);
  const richArticles = articles.filter(a => {
    let c = 0;
    for (const p of RELATION_PROPS) {
      const v = a.node[p];
      if (Array.isArray(v) ? v.length > 0 : !!v) c++;
    }
    return c >= 2;
  });
  console.log(`    풍부 article (관계 2종+ 보유): ${richArticles.length}/${articles.length} (${((richArticles.length/articles.length)*100).toFixed(1)}%)`);
  if (richArticles.length / articles.length < 0.3) {
    console.log(`    ⚠️ 현재 그래프는 "분류 인덱스" 수준 — article 다수가 act 산하에 list 형태로만 존재. 진짜 온톨로지가 되려면:`);
    console.log(`       · delegates / references / penalizedBy / hasAnnex 자동 추출 필요`);
    console.log(`       · 본문 패턴 (위 [4] 결과)을 그래프 엣지로 변환`);
  } else {
    console.log(`    ✅ 진짜 온톨로지 수준 (관계 풍부)`);
  }
})();
