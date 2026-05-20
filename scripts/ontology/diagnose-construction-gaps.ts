#!/usr/bin/env tsx
/**
 * diagnose-construction-gaps.ts
 *
 * 건설안전 도메인 빈틈 정밀 진단:
 *   A. 법령 조문 빈틈 — scope.json 의 "건설 관련 393조" 中 그래프 누락 IRI 목록
 *   B. KOSHA Guide 건설 도메인 522 中 in-edge 0 (미사용) IRI
 *   C. KOSHA 자료 중 그래프 미통합 종류 + 통합 가치 평가
 *   D. stub article 중 본문 verified 가능 후보 (법제처 fetch 가능)
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const GUIDES = resolve(NODES, "documents", "guides");
const SCOPE = JSON.parse(await readFile(resolve(ROOT, "src", "ontology", "scope.json"), "utf-8"));

const EDGE_PROPS = ["delegates","references","hasArticle","partOf","hasAnnex","specifies","regulates","penalizedBy","appliesTo","requires","mitigatedBy","mitigates","causedBy","evaluatedBy","cycledAs","legalBasisOf","legalBasis","penaltyOnMissing","relatedDocs","guidedBy","amendedTo","interpretedBy","auditedBy","informedBy","hasHazard","regulatedBy","cycle"];

interface Node { [k: string]: unknown; "@id"?: string; _file?: string; }

async function walk(dir: string, out: Node[]) {
  for (const e of await readdir(dir)) {
    const p = join(dir, e);
    const { stat } = await import("node:fs/promises");
    const st = await stat(p);
    if (st.isDirectory()) await walk(p, out);
    else if (e.endsWith(".jsonld")) {
      try { const n = JSON.parse(await readFile(p, "utf-8")) as Node; n._file = p; out.push(n); } catch {}
    }
  }
}

(async () => {
  const all: Node[] = [];
  await walk(NODES, all);

  // 기존 article IRI 인덱스
  const articleIris = new Set(all.filter(n => n["@id"]?.startsWith("art:")).map(n => n["@id"]!));

  console.log("\n╔══ 건설안전 도메인 빈틈 진단 ══╗\n");

  // ─── A. 법령 조문 빈틈 ───
  console.log("[A] 건설 관련 법령 조문 cover (scope.json 기준 393조)");
  const lawCoverage = SCOPE.lawCoverage as Record<string, { totalArticles: number; constructionRelevant: number; comment: string }>;
  let totalConstructionRelevant = 0;
  let totalCovered = 0;
  for (const [law, info] of Object.entries(lawCoverage)) {
    const prefix = law === "산업안전보건법" ? "산안법" :
                   law === "산업안전보건법시행령" ? "산안법시행령" :
                   law === "산업안전보건법시행규칙" ? "산안법시행규칙" :
                   law === "산업안전보건기준에관한규칙" ? "기준규칙" :
                   law === "중대재해처벌등에관한법률" ? "중처법" :
                   law === "중대재해처벌등에관한법률시행령" ? "중처법시행령" :
                   law === "위험성평가-고시" ? "위험성평가-고시" : law;
    const covered = [...articleIris].filter(i => i.startsWith(`art:${prefix}:`)).length;
    const target = info.constructionRelevant;
    const pct = target > 0 ? ((covered / target) * 100).toFixed(1) : "N/A";
    totalConstructionRelevant += target;
    totalCovered += Math.min(covered, target);
    const status = covered >= target ? "✅" : (covered >= target * 0.5 ? "⚠️" : "❌");
    console.log(`  ${status} ${law.padEnd(25)} ${String(covered).padStart(3)} / ${target.toString().padStart(3)} (${pct}%)`);
  }
  console.log(`  ────────────────────────────────────────────────`);
  console.log(`  TOTAL                       ${totalCovered} / ${totalConstructionRelevant} (${((totalCovered/totalConstructionRelevant)*100).toFixed(1)}%)`);

  // ─── B. KOSHA 건설 도메인 미사용 ───
  const guides = all.filter(n => n["@id"]?.startsWith("doc:kosha_guide"));
  const constructionGuides = guides.filter(g => {
    const scope = (g._meta as Record<string, unknown> | undefined)?.scope;
    return scope === "construction" || scope === "general_applicable" || scope === "construction_partial";
  });
  const inEdges = new Map<string, number>();
  for (const n of all) {
    for (const prop of EDGE_PROPS) {
      const v = (n as Record<string, unknown>)[prop];
      if (!v) continue;
      const arr = Array.isArray(v) ? v : [v];
      for (const t of arr) if (typeof t === "string") {
        inEdges.set(t, (inEdges.get(t) ?? 0) + 1);
      }
    }
  }
  const unused = constructionGuides.filter(g => (inEdges.get(g["@id"] as string) ?? 0) === 0);
  console.log(`\n[B] KOSHA 건설 도메인 미사용: ${unused.length} / ${constructionGuides.length}`);
  for (const g of unused) {
    console.log(`  ${g["@id"]}\t${g.title ?? ""}`);
  }

  // ─── C. KOSHA 자료 종류 ───
  console.log(`\n[C] KOSHA 자료 종류별 통합 상태`);
  console.log(`  ✅ KOSHA Guide 1039        — 그래프 노드화 (메타 only, 본문 Live)`);
  console.log(`  ❌ KOSHA Archive 8,976     — Live API only (도구 search-kosha-archive)`);
  console.log(`  ❌ SIF Archive 6,032       — Live API + placeholder (라이선스로 미배포)`);
  console.log(`  ❌ 건설업 중대재해 (일별)    — Live API only (도구 search-construction-fatal-accidents)`);
  console.log(`  ❌ 사고사례                — Live API only (도구 search-accident-cases)`);
  console.log(`  ❌ MSDS / PPE 인증         — Live API only (동적 데이터)`);
  console.log(`  ❌ 외국인근로자 자료       — Live API only`);

  // ─── D. stub article 본문 verified 가능 후보 ───
  const stubs = all.filter(n => n.verificationStatus === "stub" && n["@id"]?.startsWith("art:"));
  console.log(`\n[D] stub article (법제처 sync 대상): ${stubs.length}`);
  const byPrefix: Record<string, number> = {};
  for (const s of stubs) {
    const prefix = (s["@id"] as string).split(":")[1] ?? "unknown";
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
  }
  for (const [p, c] of Object.entries(byPrefix).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${p.padEnd(20)} ${c}`);
  }
})();
