#!/usr/bin/env tsx
/**
 * deep-coverage-audit.ts
 * 표면 audit (dangling=0, orphan≤3, KOSHA=100%) 너머의 의미적 커버리지 결함 식별.
 *
 * 9개 축:
 *   A. Article 본문 완성도 (stub vs verified, body length)
 *   B. Document form 완성도 (requiredFields/reviewRules/applicableWhen 보유 비율)
 *   C. KOSHA Guide 매칭 품질 (prefix-fallback 환각 비율, score 분포)
 *   D. 14종 법정문서 외 doc CARV 추론 가능 여부 (49+13 = 62 doc 전수)
 *   E. Hazard↔Control 매트릭스 빈약 hazard 식별
 *   F. Activity → 작업계획서/허가서 → 법령 체인 완전성
 *   G. Legal coverage 정의 자체의 누락 (52 OBLIGATIONS vs 실 80+ 의무)
 *   H. dist 파일 (nq + ttl 둘 다)
 *   I. Domain pack: 산안법 175조 / 시행령 159조 / 시행규칙 252조 / 기준규칙 671조 cover 비율
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const DIST = resolve(ROOT, "artifacts", "export", "rdf-dist");

interface Node { [k: string]: unknown; "@id"?: string; _file?: string; _typeLabel?: string; }

async function walk(dir: string, label: string, out: Node[]) {
  for (const e of await readdir(dir)) {
    const p = join(dir, e);
    const st = await stat(p);
    if (st.isDirectory()) await walk(p, label, out);
    else if (e.endsWith(".jsonld")) {
      try {
        const node = JSON.parse(await readFile(p, "utf-8")) as Node;
        node._file = p; node._typeLabel = label;
        out.push(node);
      } catch {}
    }
  }
}

(async () => {
  const all: Node[] = [];
  for (const t of await readdir(NODES)) {
    const td = join(NODES, t);
    if (!(await stat(td)).isDirectory()) continue;
    await walk(td, t, all);
  }
  const idx = new Map<string, Node>();
  for (const n of all) if (n["@id"]) idx.set(n["@id"], n);

  console.log("\n╔══ 깊이 진단 (Deep Coverage Audit) ══╗\n");

  // ─── A. Article 본문 완성도 ───
  const articles = all.filter(n => n._typeLabel === "articles");
  const artStubs = articles.filter(n => n.verificationStatus === "stub");
  const artVerified = articles.filter(n => n.verificationStatus === "verified");
  const artNoStatus = articles.filter(n => !n.verificationStatus);
  const shortBody = articles.filter(n => {
    const d = (n.description as string | undefined) ?? "";
    return d.length < 200;
  });
  console.log(`[A] Article 본문 완성도`);
  console.log(`    전체:                ${articles.length}`);
  console.log(`    verified:            ${artVerified.length} (${((artVerified.length/articles.length)*100).toFixed(1)}%)`);
  console.log(`    stub:                ${artStubs.length} (${((artStubs.length/articles.length)*100).toFixed(1)}%)`);
  console.log(`    no-status:           ${artNoStatus.length}`);
  console.log(`    description<200자:    ${shortBody.length} (${((shortBody.length/articles.length)*100).toFixed(1)}%)`);

  // 도메인별 분포
  const byAct: Record<string, { total: number; stub: number; verified: number }> = {};
  for (const a of articles) {
    const id = a["@id"] || "";
    const act = id.split(":")[1] ?? "unknown";
    if (!byAct[act]) byAct[act] = { total: 0, stub: 0, verified: 0 };
    byAct[act].total++;
    if (a.verificationStatus === "stub") byAct[act].stub++;
    if (a.verificationStatus === "verified") byAct[act].verified++;
  }
  console.log(`    도메인별:`);
  for (const [act, s] of Object.entries(byAct)) {
    console.log(`      ${act.padEnd(20)} 전체 ${String(s.total).padStart(3)} | stub ${String(s.stub).padStart(3)} | verified ${String(s.verified).padStart(3)}`);
  }

  // ─── B. Document form 완성도 ───
  const docs = all.filter(n => n._typeLabel === "documents" && !n["@id"]?.startsWith("doc:kosha_guide"));
  let withRequired = 0, withReview = 0, withApplicable = 0, withCycle = 0, withTrigger = 0;
  const docDetails: Array<{ id: string; missing: string[]; isStub: boolean }> = [];
  for (const d of docs) {
    const missing: string[] = [];
    if (!Array.isArray(d.requiredFields) || (d.requiredFields as unknown[]).length === 0) missing.push("requiredFields");
    else withRequired++;
    if (!Array.isArray(d.reviewRules) || (d.reviewRules as unknown[]).length === 0) missing.push("reviewRules");
    else withReview++;
    if (!d.applicableWhen) missing.push("applicableWhen");
    else withApplicable++;
    if (!d.cycle) missing.push("cycle");
    else withCycle++;
    if (!d.trigger) missing.push("trigger");
    else withTrigger++;
    docDetails.push({ id: d["@id"]!, missing, isStub: d.verificationStatus === "stub" });
  }
  console.log(`\n[B] Document form 완성도 (${docs.length}개)`);
  console.log(`    requiredFields 보유:  ${withRequired} (${((withRequired/docs.length)*100).toFixed(1)}%)`);
  console.log(`    reviewRules 보유:     ${withReview}  (${((withReview/docs.length)*100).toFixed(1)}%)`);
  console.log(`    applicableWhen 보유:  ${withApplicable} (${((withApplicable/docs.length)*100).toFixed(1)}%)`);
  console.log(`    cycle 보유:           ${withCycle} (${((withCycle/docs.length)*100).toFixed(1)}%)`);
  console.log(`    trigger 보유:         ${withTrigger} (${((withTrigger/docs.length)*100).toFixed(1)}%)`);
  const incompleteDocs = docDetails.filter(d => d.missing.length > 0);
  console.log(`    완전(필드 모두):      ${docs.length - incompleteDocs.length} / ${docs.length}`);
  if (incompleteDocs.length > 0) {
    console.log(`    불완전 doc top 10:`);
    for (const d of incompleteDocs.slice(0, 10)) {
      console.log(`      ${d.id} [${d.isStub ? "STUB" : "    "}] ← 누락: ${d.missing.join(", ")}`);
    }
  }

  // ─── C. KOSHA Guide 매칭 품질 ───
  const guides = all.filter(n => n["@id"]?.startsWith("doc:kosha_guide"));
  // in-edge로 누가 가리키는지 분석
  const inToGuide = new Map<string, Array<{ src: string; prop: string }>>();
  const EDGE_PROPS = ["delegates","references","hasArticle","partOf","hasAnnex","specifies","regulates","penalizedBy","appliesTo","requires","mitigatedBy","mitigates","causedBy","evaluatedBy","cycledAs","legalBasisOf","legalBasis","penaltyOnMissing","relatedDocs","guidedBy","amendedTo","interpretedBy","auditedBy","informedBy","hasHazard","regulatedBy","cycle"];
  for (const n of all) {
    const id = n["@id"]; if (!id) continue;
    for (const prop of EDGE_PROPS) {
      const v = (n as Record<string, unknown>)[prop];
      if (!v) continue;
      const arr = Array.isArray(v) ? v : [v];
      for (const t of arr) if (typeof t === "string" && t.startsWith("doc:kosha_guide")) {
        if (!inToGuide.has(t)) inToGuide.set(t, []);
        inToGuide.get(t)!.push({ src: id, prop });
      }
    }
  }
  // over-linked guide (5+ 노드가 한 guide 가리킴) — fallback 환각 가능성
  const overLinked = [...inToGuide.entries()].filter(([_, srcs]) => srcs.length >= 5);
  // single-source from prefix-fallback dummies (risk_assessment_general, safety_education이 다수 가리키는지)
  const fallbackSources = ["activity:risk_assessment_general", "activity:safety_education", "activity:vehicle_construction"];
  const fallbackOnlyGuides: string[] = [];
  for (const [g, srcs] of inToGuide.entries()) {
    const uniq = new Set(srcs.map(s => s.src));
    if ([...uniq].every(s => fallbackSources.includes(s))) {
      fallbackOnlyGuides.push(g);
    }
  }
  console.log(`\n[C] KOSHA Guide 매칭 품질`);
  console.log(`    Guide 노드:           ${guides.length}`);
  console.log(`    Over-linked (5+):     ${overLinked.length} (한 guide 가 5+ 노드에 묶임)`);
  console.log(`    Fallback-only:        ${fallbackOnlyGuides.length} (활동 ${fallbackSources.length}개 default 매칭만 — 의미 약함)`);
  console.log(`    Fallback-only top 5 가이드 제목:`);
  for (const giri of fallbackOnlyGuides.slice(0, 5)) {
    const g = guides.find(x => x["@id"] === giri);
    console.log(`      ${giri}\t${g?.title ?? ""}`);
  }
  // 활동/위험 별 guide 부담 분포
  const guidesPerNode = new Map<string, number>();
  for (const [g, srcs] of inToGuide.entries()) {
    for (const s of srcs) guidesPerNode.set(s.src, (guidesPerNode.get(s.src) ?? 0) + 1);
  }
  console.log(`    활동/위험별 guidedBy 부담 top 5:`);
  for (const [n, c] of [...guidesPerNode.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 5)) {
    console.log(`      ${n.padEnd(45)} ${c}`);
  }

  // ─── D. CARV 추론 (49+13 doc 전수) ───
  // CARV: Cycle / Article(legalBasis) / Risk(legalBasisOf의 역방향) / Verification(reviewRules)
  let carvOK = 0, carvPartial = 0, carvFail = 0;
  const carvFails: Array<{ id: string; missing: string[] }> = [];
  for (const d of docs) {
    const c = !!d.cycle;
    const a = Array.isArray(d.legalBasis) && (d.legalBasis as string[]).length > 0;
    const r = Array.isArray(d.requiredFields) && (d.requiredFields as unknown[]).length > 0;
    const v = Array.isArray(d.reviewRules) && (d.reviewRules as unknown[]).length > 0;
    const score = [c, a, r, v].filter(Boolean).length;
    if (score === 4) carvOK++;
    else if (score >= 2) carvPartial++;
    else carvFail++;
    if (score < 4) {
      const missing: string[] = [];
      if (!c) missing.push("Cycle");
      if (!a) missing.push("Article");
      if (!r) missing.push("Required");
      if (!v) missing.push("Verification");
      carvFails.push({ id: d["@id"]!, missing });
    }
  }
  console.log(`\n[D] 의무문서 ${docs.length}개 CARV 전수 (현재 audit는 14종만 확인)`);
  console.log(`    완전 (CARV 4/4):      ${carvOK}`);
  console.log(`    부분 (2~3/4):         ${carvPartial}`);
  console.log(`    불완전 (≤1/4):        ${carvFail}`);
  console.log(`    14종 외 빈약 doc top 15:`);
  for (const f of carvFails.slice(0, 15)) {
    console.log(`      ${f.id.padEnd(50)} 누락: ${f.missing.join(", ")}`);
  }

  // ─── E. Hazard↔Control 매트릭스 빈약 hazard ───
  const hazards = all.filter(n => n._typeLabel === "hazards");
  const hazSparse: Array<{ id: string; controls: number }> = [];
  for (const h of hazards) {
    const m = Array.isArray(h.mitigatedBy) ? (h.mitigatedBy as string[]).length : 0;
    if (m < 4) hazSparse.push({ id: h["@id"]!, controls: m });
  }
  console.log(`\n[E] Hazard↔Control 빈약 (mitigatedBy<4): ${hazSparse.length}개`);
  for (const h of hazSparse) {
    console.log(`      ${h.id.padEnd(35)} controls=${h.controls}`);
  }

  // ─── F. Activity → 작업계획서/허가서 → 법령 체인 ───
  const activities = all.filter(n => n._typeLabel === "activities");
  let chainComplete = 0, chainIncomplete = 0;
  const incompleteActs: string[] = [];
  for (const a of activities) {
    const hasHaz = Array.isArray(a.hasHazard) && (a.hasHazard as string[]).length > 0;
    const hasReg = Array.isArray(a.regulatedBy) && (a.regulatedBy as string[]).length > 0;
    const hasGuide = Array.isArray(a.guidedBy) && (a.guidedBy as string[]).length > 0;
    if (hasHaz && hasReg && hasGuide) chainComplete++;
    else { chainIncomplete++; incompleteActs.push(`${a["@id"]} (haz=${hasHaz} reg=${hasReg} guide=${hasGuide})`); }
  }
  console.log(`\n[F] Activity 4단 체인 (Hazard·Regulation·Guide 모두): ${chainComplete} / ${activities.length}`);
  if (incompleteActs.length > 0) {
    console.log(`    불완전 activity:`);
    for (const a of incompleteActs) console.log(`      ${a}`);
  }

  // ─── H. dist export ───
  let nqExists = false, ttlExists = false;
  try { await stat(resolve(DIST, "safety-graph.nq")); nqExists = true; } catch {}
  try { await stat(resolve(DIST, "safety-graph.ttl")); ttlExists = true; } catch {}
  console.log(`\n[H] dist 산출물`);
  console.log(`    safety-graph.nq:      ${nqExists ? "✓" : "✗"}`);
  console.log(`    safety-graph.ttl:     ${ttlExists ? "✓" : "✗"} ${ttlExists ? "" : "(누락 — 사람 가독성 떨어짐)"}`);

  // ─── I. Domain Pack: 법령별 cover ───
  console.log(`\n[I] 법령별 article cover (전체 조문 vs 그래프 노드)`);
  const expected: Record<string, number> = {
    "산안법": 175, "산안법시행령": 159, "산안법시행규칙": 252,
    "기준규칙": 671, "중처법": 16, "중처법시행령": 14, "위험성평가-고시": 23
  };
  for (const [k, total] of Object.entries(expected)) {
    const got = byAct[k]?.total ?? 0;
    const pct = ((got / total) * 100).toFixed(1);
    console.log(`    ${k.padEnd(20)} ${String(got).padStart(4)} / ${String(total).padStart(4)} = ${pct}%`);
  }
})();
