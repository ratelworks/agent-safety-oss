#!/usr/bin/env tsx
/**
 * extract-law-relations.ts
 *
 * 법령 본문에서 4종 관계 자동 추출:
 *   1. references — "제N조" 인용 (동일 법령 내)
 *   2. delegates  — 시행령/시행규칙 본문의 "법 제N조" → 모법 article 의 delegates 역추적
 *   3. penalizedBy — 벌칙 조문(산안법 §167-§175, 중처법 §6-§8)의 "제N조 위반"
 *   4. hasAnnex   — "별표 N" → annex 노드 (자동 생성 + 매핑)
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const ANNEXES = resolve(ROOT, "src", "ontology", "graph", "nodes", "annexes");

interface Article {
  iri: string; path: string; node: Record<string, unknown>;
  actKey: string; articleNumber: string;
  description: string;
}

// 모법 ↔ 시행령/시행규칙 매핑
const ACT_HIERARCHY: Record<string, { decree?: string; rule?: string; standard?: string }> = {
  "산안법":          { decree: "산안법시행령", rule: "산안법시행규칙", standard: "기준규칙" },
  "산안법시행령":    { rule: "산안법시행규칙", standard: "기준규칙" },
  "산안법시행규칙":  { standard: "기준규칙" },
  "중처법":          { decree: "중처법시행령" },
};

function addToArrayUnique(node: Record<string, unknown>, key: string, values: string[]) {
  const cur = (node[key] as string[] | undefined) ?? [];
  const set = new Set(cur);
  for (const v of values) set.add(v);
  if (set.size > cur.length) node[key] = [...set];
}

(async () => {
  // 1. 모든 article 로드
  const articles: Article[] = [];
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ARTICLES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const iri = node["@id"] as string;
    const [, actKey, articleNumber] = iri.split(":");
    articles.push({ iri, path, node, actKey, articleNumber, description: String(node.description ?? "") });
  }

  // article IRI 인덱스 (act:N → article)
  const byActAndNum = new Map<string, Article>();
  for (const a of articles) byActAndNum.set(`${a.actKey}:${a.articleNumber}`, a);
  console.log(`[load] ${articles.length} article\n`);

  // ─── 2. references 추출 ───
  let refsAdded = 0;
  for (const a of articles) {
    // "제N조" 또는 "제N조의M" 매칭
    const refs = new Set<string>();
    for (const m of a.description.matchAll(/제(\d+)조(?:의(\d+))?/g)) {
      const num = m[1];
      const sub = m[2];
      const target = sub ? `${num}의${sub}` : num;
      // 같은 article 자기 인용 제외
      if (target === a.articleNumber) continue;
      const targetIri = `art:${a.actKey}:${target}`;
      if (byActAndNum.has(`${a.actKey}:${target}`)) refs.add(targetIri);
    }
    if (refs.size > 0) {
      addToArrayUnique(a.node, "references", [...refs]);
      refsAdded += refs.size;
    }
  }
  console.log(`[references] ${refsAdded} 엣지 추가 (동일 법령 내 인용)`);

  // ─── 3. delegates 추출 (시행령/시행규칙 → 모법 역추적) ───
  let delegatesAdded = 0;
  for (const a of articles) {
    // 시행령/시행규칙/기준규칙 본문에서 "법 제N조" → 모법 §N
    if (!a.actKey.includes("시행령") && !a.actKey.includes("시행규칙") && a.actKey !== "기준규칙") continue;
    // 모법은 무엇? 시행령/시행규칙은 산안법, 기준규칙은 산안법(통상)
    const parentAct = a.actKey.startsWith("중처법") ? "중처법" : "산안법";
    // "법 제N조" 또는 "법 제N조의M" 매칭
    const refs = new Set<string>();
    for (const m of a.description.matchAll(/법\s*제(\d+)조(?:의(\d+))?|「산업안전보건법」\s*제(\d+)조(?:의(\d+))?|「중대재해[^」]+법」\s*제(\d+)조(?:의(\d+))?/g)) {
      const num = m[1] || m[3] || m[5];
      const sub = m[2] || m[4] || m[6];
      if (!num) continue;
      const targetNum = sub ? `${num}의${sub}` : num;
      const parentIri = `art:${parentAct}:${targetNum}`;
      if (byActAndNum.has(`${parentAct}:${targetNum}`)) {
        refs.add(parentIri);
        // 역방향: 모법 article 에 delegates 로 자기 추가
        const parent = byActAndNum.get(`${parentAct}:${targetNum}`)!;
        addToArrayUnique(parent.node, "delegates", [a.iri]);
        delegatesAdded++;
      }
    }
    if (refs.size > 0) {
      addToArrayUnique(a.node, "delegationOf", [...refs]);
    }
  }
  console.log(`[delegates] ${delegatesAdded} 엣지 추가 (시행령/규칙 → 모법 역추적)`);

  // ─── 4. penalizedBy 추출 ───
  // 벌칙 조문: 산안법 §167~§175, 중처법 §6~§8, 중처법시행령 §7~§8
  const PENALTY_ARTICLES: Array<{ actKey: string; range: [number, number] }> = [
    { actKey: "산안법", range: [167, 175] },
    { actKey: "중처법", range: [6, 8] },
  ];
  let penaltiesAdded = 0;
  for (const pa of PENALTY_ARTICLES) {
    for (let n = pa.range[0]; n <= pa.range[1]; n++) {
      const penalty = byActAndNum.get(`${pa.actKey}:${n}`);
      if (!penalty) continue;
      // 본문에서 "제N조를 위반"·"제N조 제M항을 위반"·"제N조에 따른" 추출
      const violatedArticles = new Set<string>();
      for (const m of penalty.description.matchAll(/제(\d+)조(?:의(\d+))?(?:\s*제\d+항)?(?:[^,]*?위반|에 따른|을 위반)/g)) {
        const num = m[1];
        const sub = m[2];
        const t = sub ? `${num}의${sub}` : num;
        if (byActAndNum.has(`${pa.actKey}:${t}`) && t !== String(n)) {
          violatedArticles.add(`art:${pa.actKey}:${t}`);
        }
      }
      // 역방향: 의무 조문에 penalizedBy 로 벌칙 추가
      for (const violatedIri of violatedArticles) {
        const violated = byActAndNum.get(violatedIri.replace("art:", ""))!;
        if (violated) {
          addToArrayUnique(violated.node, "penalizedBy", [penalty.iri]);
          penaltiesAdded++;
        }
      }
    }
  }
  console.log(`[penalizedBy] ${penaltiesAdded} 엣지 추가 (벌칙 매트릭스)`);

  // ─── 5. hasAnnex 추출 ───
  // "별표 N" 또는 "별표 N의 M" 매칭. annex 노드 자동 생성.
  const existingAnnexIris = new Set<string>();
  for (const f of await readdir(ANNEXES)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(ANNEXES, f), "utf-8")) as { "@id"?: string };
    if (node["@id"]) existingAnnexIris.add(node["@id"]);
  }
  let annexesCreated = 0, annexLinksAdded = 0;
  for (const a of articles) {
    const annexes = new Set<string>();
    // 별표 + 별지 제N호서식 통합 매칭
    const patterns: Array<{ regex: RegExp; kind: string }> = [
      { regex: /별표\s*(\d+)(?:의\s*(\d+))?/g, kind: "별표" },
      { regex: /별지\s*제\s*(\d+)\s*호\s*서식/g, kind: "서식" },
    ];
    for (const p of patterns) {
      for (const m of a.description.matchAll(p.regex)) {
        const num = m[1];
        const sub = p.kind === "별표" ? m[2] : undefined;
        const annexLabel = sub ? `${p.kind}${num}의${sub}` : `${p.kind}${num}`;
        const annexIri = `annex:${a.actKey}:${annexLabel}`;
        annexes.add(annexIri);
        // 노드 생성 (없으면 — sync-annexes가 이미 처리했으니 거의 모두 있을 것)
        if (!existingAnnexIris.has(annexIri)) {
          const fname = `${a.actKey}-${annexLabel}.jsonld`;
          const obj = {
            "@context": "../../context.jsonld",
            "@id": annexIri,
            "@type": ["Annex"],
            title: `${a.actKey} ${annexLabel}`,
            annexNumber: sub ? `${num}-${sub}` : num,
            partOf: a.node.partOf as string,
            verificationStatus: "stub",
            _meta: {
              publishedBy: "법제처 국가법령정보센터 (자동 생성)",
              sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(a.actKey)}/${p.kind}/${num}`,
              fetchedAt: new Date().toISOString().substring(0, 10),
              licenseHint: "저작권법 §7 비보호 (자유 인용)",
              note: "본문 자동 추출 별표/서식 메타 노드. 본문은 법제처 sync 대상."
            },
            description: `${a.actKey} ${annexLabel} — 본문 sync 대기.`,
            jurisdiction: "KR"
          };
          await writeFile(resolve(ANNEXES, fname), JSON.stringify(obj, null, 2) + "\n", "utf-8");
          existingAnnexIris.add(annexIri);
          annexesCreated++;
        }
      }
    }
    if (annexes.size > 0) {
      addToArrayUnique(a.node, "hasAnnex", [...annexes]);
      annexLinksAdded += annexes.size;
    }
  }
  console.log(`[hasAnnex] ${annexLinksAdded} 엣지 추가 + ${annexesCreated} annex 노드 자동 생성`);

  // ─── 6. 외부 법령 인용 ───
  // 「산업안전보건법」「중대재해처벌법」 같은 외부 법령 — 다른 법령 article 매칭
  let externalRefsAdded = 0;
  for (const a of articles) {
    const externalRefs = new Set<string>();
    for (const m of a.description.matchAll(/「([^」]+)」\s*제(\d+)조(?:의(\d+))?/g)) {
      const lawName = m[1];
      const num = m[2];
      const sub = m[3];
      const targetNum = sub ? `${num}의${sub}` : num;
      let targetActKey: string | null = null;
      if (lawName.includes("산업안전보건법") && lawName.includes("시행령")) targetActKey = "산안법시행령";
      else if (lawName.includes("산업안전보건법") && lawName.includes("시행규칙")) targetActKey = "산안법시행규칙";
      else if (lawName.includes("산업안전보건기준")) targetActKey = "기준규칙";
      else if (lawName.includes("산업안전보건법")) targetActKey = "산안법";
      else if (lawName.includes("중대재해") && lawName.includes("시행령")) targetActKey = "중처법시행령";
      else if (lawName.includes("중대재해")) targetActKey = "중처법";
      else if (lawName.includes("위험성평가")) targetActKey = "위험성평가-고시";
      if (!targetActKey) continue;
      if (a.actKey === targetActKey) continue;  // 자기 법령은 references로 별도 처리
      const targetIri = `art:${targetActKey}:${targetNum}`;
      if (byActAndNum.has(`${targetActKey}:${targetNum}`)) externalRefs.add(targetIri);
    }
    if (externalRefs.size > 0) {
      addToArrayUnique(a.node, "references", [...externalRefs]);
      externalRefsAdded += externalRefs.size;
    }
  }
  console.log(`[references-external] ${externalRefsAdded} 엣지 추가 (외부 법령 인용)`);

  // ─── 7. 디스크에 일괄 기록 ───
  for (const a of articles) {
    await writeFile(a.path, JSON.stringify(a.node, null, 2) + "\n", "utf-8");
  }

  console.log(`\n✅ 법령 관계 자동 추출 완료. ${articles.length} article 갱신.`);
})();
