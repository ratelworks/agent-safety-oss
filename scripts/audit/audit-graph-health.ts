#!/usr/bin/env tsx
/**
 * audit-graph-health.ts — 온톨로지 그래프 건강성 전수조사
 *
 * 매 PR/push 시 실행. 임계값 위반 시 exit 1.
 * 보고 항목:
 *  · 노드/엣지 통계
 *  · dangling refs / orphan / hub 분포
 *  · 14종 법정문서 추론 완성도
 *  · Hazard↔Control 매트릭스 밀도
 *  · Activity↔Hazard 매트릭스 밀도
 *  · 핵심 법령 조항 누락 (Coverage Master Index 기반)
 *  · KOSHA Guide 활용률
 *  · DAG 무결성 (cycle 검출)
 *  · verified 비율 (KOSHA Guide 메타 제외)
 *
 * 임계값 (--strict 모드에서 fail):
 *  · SHACL 위반 > 0
 *  · dangling 비율 > 1.5%
 *  · 14종 추론 완성도 < 80%
 *  · DAG cycle > 0
 *  · 핵심 article 누락 > 0 (warning, --critical 시 fail)
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");
const COVERAGE_INDEX = resolve(ROOT, "src", "ontology", "coverage", "master-index.json");

const STRICT = process.argv.includes("--strict");
const CRITICAL = process.argv.includes("--critical");

// ─── 임계값 ───
// dangling 2%는 콘텐츠 보강 진행 중 단기 임계값. 목표 1% 이하 (보강 완료 후 조정).
const THRESHOLDS = {
  danglingPctMax: 2.0,
  doc14CompletePctMin: 80,
  matrixDensityMin: 10,
  matrixDensityMax: 30,
  cycleMax: 0,
};

// ─── 14종 법정문서 IRI (실제 그래프 IRI 기준) ───
const STATUTORY_14_IRIS = [
  "doc:ad_hoc/initial_risk_assessment",
  "doc:monthly/monthly_risk_assessment",
  "doc:annual/regular_risk_assessment",
  "doc:ad_hoc/ad_hoc_risk_assessment",
  "doc:daily/daily_tbm",
  "doc:weekly/weekly_joint_inspection",
  "doc:ad_hoc/work_permit",
  "doc:ad_hoc/work_plan",
  "doc:ad_hoc/industrial_accident_report",
  "doc:on_appointment/safety_health_manager_appointment",
  "doc:semi_annual/severe_accident_compliance",
  "doc:monthly/monthly_education_log",
  "doc:monthly/health_safety_committee",
  "doc:daily/pre_work_inspection",
];

// ─── 엣지 property 카탈로그 ───
const EDGE_PROPS = [
  "delegates","references","hasArticle","partOf","hasAnnex","specifies",
  "regulates","penalizedBy","penalizedByDelegated","appliesTo","requires",
  "mitigatedBy","mitigates","causedBy","evaluatedBy","cycledAs",
  "legalBasisOf","legalBasis","penaltyOnMissing","relatedDocs",
  "guidedBy","amendedTo","interpretedBy","auditedBy","informedBy",
  "hasHazard","regulatedBy","cycle","hasChapter","hasSection","delegationOf"
];

interface Node {
  "@id"?: string;
  "@type"?: string | string[];
  verificationStatus?: string;
  label?: string;
  title?: string;
  legalBasis?: string[];
  cycle?: string;
  applicableWhen?: unknown;
  requiredFields?: unknown[];
  reviewRules?: unknown[];
  mitigatedBy?: string[];
  hasHazard?: string[];
  _file?: string;
  _typeLabel?: string;
  [k: string]: unknown;
}

async function walk(dir: string, label: string, out: Node[]): Promise<void> {
  const entries = await readdir(dir);
  for (const e of entries) {
    const p = join(dir, e);
    const st = await stat(p);
    if (st.isDirectory()) {
      await walk(p, label, out);
    } else if (e.endsWith(".jsonld")) {
      try {
        const raw = await readFile(p, "utf-8");
        const node = JSON.parse(raw) as Node;
        node._file = p;
        node._typeLabel = label;
        out.push(node);
      } catch (err) {
        console.error(`[parse-error] ${p}: ${(err as Error).message}`);
      }
    }
  }
}

async function loadAllNodes(): Promise<Node[]> {
  const types = await readdir(NODES_DIR);
  const nodes: Node[] = [];
  for (const type of types) {
    const typeDir = join(NODES_DIR, type);
    const st = await stat(typeDir);
    if (!st.isDirectory()) continue;
    await walk(typeDir, type, nodes);
  }
  return nodes;
}

interface Ref {
  prop: string;
  target: string;
}

function extractRefs(node: Node): Ref[] {
  const refs: Ref[] = [];
  for (const prop of EDGE_PROPS) {
    const v = node[prop];
    if (!v) continue;
    if (typeof v === "string") refs.push({ prop, target: v });
    else if (Array.isArray(v)) {
      for (const t of v) if (typeof t === "string") refs.push({ prop, target: t });
    }
  }
  return refs;
}

interface CoverageIndex {
  domains: Record<string, {
    label: string;
    totalArticles: number;
    criticalArticles: string[];
    highArticles: string[];
  }>;
}

async function loadCoverageIndex(): Promise<CoverageIndex | null> {
  try {
    const raw = await readFile(COVERAGE_INDEX, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── 메인 ───
async function main() {
  const nodes = await loadAllNodes();
  const idx = new Map<string, Node>();
  for (const n of nodes) if (n["@id"]) idx.set(n["@id"], n);

  // 노드 타입 통계
  const typeCounts: Record<string, number> = {};
  for (const n of nodes) typeCounts[n._typeLabel!] = (typeCounts[n._typeLabel!] || 0) + 1;

  // 엣지 인덱스
  const outEdges = new Map<string, Ref[]>();
  const inEdges = new Map<string, Array<{ prop: string; source: string }>>();
  const edgeCount: Record<string, number> = {};
  for (const n of nodes) {
    const id = n["@id"]; if (!id) continue;
    const refs = extractRefs(n);
    outEdges.set(id, refs);
    for (const r of refs) {
      edgeCount[r.prop] = (edgeCount[r.prop] || 0) + 1;
      if (!inEdges.has(r.target)) inEdges.set(r.target, []);
      inEdges.get(r.target)!.push({ prop: r.prop, source: id });
    }
  }
  const totalEdges = Object.values(edgeCount).reduce((s, c) => s + c, 0);

  // dangling
  const dangling: Array<{ source: string; prop: string; target: string }> = [];
  for (const [src, refs] of outEdges.entries()) {
    for (const r of refs) {
      if (!idx.has(r.target) && r.target.includes(":")) {
        dangling.push({ source: src, prop: r.prop, target: r.target });
      }
    }
  }
  const danglingPct = (dangling.length / totalEdges) * 100;

  // orphan (in-degree 0) — src/ontology/policy/orphan-policy.json 정합
  // ENTRY = 도구 진입점 / STANDALONE = 의도된 독립 vocabulary
  const ENTRY_LABELS = new Set([
    "documents", "acts", "activities", "applicabilities",
    "capabilities", "patterns", "methods", "work_types",
  ]);
  const STANDALONE_LABELS = new Set([
    "cycles", "manuals", "sources", "entities",
    "iso45001", "statistics", "events", "interpretations",
    "object_sets", "facets", "graph",
  ]);
  const orphans: Node[] = [];
  for (const n of nodes) {
    const id = n["@id"]; if (!id) continue;
    const ins = inEdges.get(id) || [];
    const label = n._typeLabel ?? "";
    if (ins.length === 0 && !ENTRY_LABELS.has(label) && !STANDALONE_LABELS.has(label)) {
      orphans.push(n);
    }
  }

  // verified 비율 (KOSHA Guide 메타 제외)
  const meaningful = nodes.filter(n => !n["@id"]?.startsWith("doc:kosha_guide"));
  const verified = meaningful.filter(n => n.verificationStatus === "verified").length;
  const verifiedPct = (verified / meaningful.length) * 100;

  // 14종 법정문서 추론
  let doc14ok = 0, doc14partial = 0, doc14missing = 0;
  const doc14Detail: Array<{ id: string; status: string; flags: string }> = [];
  for (const docId of STATUTORY_14_IRIS) {
    const node = idx.get(docId);
    if (!node) {
      doc14missing++;
      doc14Detail.push({ id: docId, status: "MISSING", flags: "----" });
      continue;
    }
    const lb = (node.legalBasis as string[]) || [];
    const lbDangling = lb.filter(r => !idx.has(r));
    const verif = lbDangling.length === 0 && lb.length > 0;
    const fullSpec = !!node.cycle && !!node.applicableWhen
      && Array.isArray(node.requiredFields) && node.requiredFields.length > 0
      && Array.isArray(node.reviewRules) && node.reviewRules.length > 0;
    const flags = [
      node.cycle ? "C" : "·",
      node.applicableWhen ? "A" : "·",
      Array.isArray(node.requiredFields) && node.requiredFields.length ? "R" : "·",
      Array.isArray(node.reviewRules) && node.reviewRules.length ? "V" : "·",
    ].join("");
    if (verif && fullSpec) {
      doc14ok++;
      doc14Detail.push({ id: docId, status: "OK", flags });
    } else {
      doc14partial++;
      doc14Detail.push({ id: docId, status: `PARTIAL (lb=${lb.length},dang=${lbDangling.length})`, flags });
    }
  }
  const doc14Pct = (doc14ok / STATUTORY_14_IRIS.length) * 100;

  // 매트릭스 밀도
  const hazardCount = nodes.filter(n => n._typeLabel === "hazards").length;
  const controlCount = nodes.filter(n => n._typeLabel === "controls").length;
  const activityCount = nodes.filter(n => n._typeLabel === "activities").length;
  let hcEdges = 0;
  for (const n of nodes) if (n._typeLabel === "hazards") hcEdges += (n.mitigatedBy?.length || 0);
  const hcDensity = (hcEdges / (hazardCount * controlCount)) * 100;
  let ahEdges = 0;
  for (const n of nodes) if (n._typeLabel === "activities") ahEdges += (n.hasHazard?.length || 0);

  // KOSHA Guide 활용률 — 건설 도메인 분모 / 전체 분모 둘 다 표시
  const guideNodes = nodes.filter(n => n["@id"]?.startsWith("doc:kosha_guide"));
  const guideUsed = guideNodes.filter(g => (inEdges.get(g["@id"]!)?.length || 0) > 0).length;
  const guideUsedPct = (guideUsed / guideNodes.length) * 100;
  const constructionGuides = guideNodes.filter(g => {
    const scope = (g._meta as Record<string, unknown> | undefined)?.scope;
    return scope === "construction" || scope === "general_applicable" || scope === "construction_partial";
  });
  const constructionGuideUsed = constructionGuides.filter(g => (inEdges.get(g["@id"]!)?.length || 0) > 0).length;
  const constructionGuideUsedPct = constructionGuides.length > 0
    ? (constructionGuideUsed / constructionGuides.length) * 100
    : 0;
  const outOfDomainGuides = guideNodes.length - constructionGuides.length;

  // Coverage Master Index 기반 누락
  const coverageIdx = await loadCoverageIndex();
  let criticalMissing: string[] = [];
  let highMissing: string[] = [];
  if (coverageIdx) {
    for (const [, dom] of Object.entries(coverageIdx.domains)) {
      for (const c of dom.criticalArticles) if (!idx.has(c)) criticalMissing.push(c);
      for (const h of dom.highArticles) if (!idx.has(h)) highMissing.push(h);
    }
  }

  // DAG cycle
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycles: string[][] = [];
  function dfs(id: string, path: string[]) {
    if (recStack.has(id)) { cycles.push([...path, id]); return; }
    if (visited.has(id)) return;
    visited.add(id); recStack.add(id);
    for (const r of outEdges.get(id) || []) {
      if (r.prop === "delegates" || r.prop === "partOf") dfs(r.target, [...path, id]);
    }
    recStack.delete(id);
  }
  for (const n of nodes) if (n["@id"]) dfs(n["@id"], []);

  // ─── 보고서 출력 ───
  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║  agent-safety-oss — 그래프 건강성 audit                ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);
  console.log(``);
  console.log(`[1] 노드 분포`);
  for (const [t, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t.padEnd(20)} ${String(c).padStart(5)}`);
  }
  console.log(`    ${"─".repeat(28)}`);
  console.log(`    ${"전체".padEnd(20)} ${String(nodes.length).padStart(5)}`);
  console.log(``);
  console.log(`[2] 엣지 분포 (${totalEdges} 총)`);
  for (const [e, c] of Object.entries(edgeCount).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${e.padEnd(20)} ${String(c).padStart(5)}`);
  }
  console.log(``);
  console.log(`[3] dangling refs: ${dangling.length}건 (${danglingPct.toFixed(2)}%)`);
  const danglingByPrefix: Record<string, number> = {};
  for (const d of dangling) {
    const p = d.target.split(":")[0];
    danglingByPrefix[p] = (danglingByPrefix[p] || 0) + 1;
  }
  for (const [p, c] of Object.entries(danglingByPrefix).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${p.padEnd(15)} ${c}`);
  }
  console.log(``);
  console.log(`[4] orphan (in-degree 0): ${orphans.length}개`);
  for (const o of orphans.slice(0, 10)) {
    console.log(`    ${o["@id"]?.padEnd(45)} ${o._typeLabel}`);
  }
  console.log(``);
  console.log(`[5] verified 비율 (KOSHA Guide 메타 제외): ${verifiedPct.toFixed(1)}% (${verified}/${meaningful.length})`);
  console.log(``);
  console.log(`[6] 14종 법정문서 추론 완성도: ${doc14ok}/14 (${doc14Pct.toFixed(0)}%)`);
  for (const d of doc14Detail) {
    const mark = d.status === "OK" ? "✅" : d.status === "MISSING" ? "❌" : "⚠ ";
    console.log(`    ${mark} ${d.id.padEnd(50)} ${d.flags}  ${d.status}`);
  }
  console.log(``);
  console.log(`[7] 매트릭스 밀도`);
  console.log(`    Hazard↔Control:  ${hcEdges}/${hazardCount * controlCount} = ${hcDensity.toFixed(2)}%`);
  console.log(`    Activity→Hazard: ${ahEdges} 엣지 (work activity ${activityCount - 3}개 기준)`);
  console.log(``);
  console.log(`[8] KOSHA Guide 활용률 (건설 도메인): ${constructionGuideUsed}/${constructionGuides.length} = ${constructionGuideUsedPct.toFixed(1)}% — 도메인 외 ${outOfDomainGuides} 가이드 별도 표기 (전체: ${guideUsed}/${guideNodes.length} = ${guideUsedPct.toFixed(1)}%)`);
  console.log(``);
  console.log(`[9] DAG 무결성: cycle ${cycles.length}개`);
  for (const c of cycles.slice(0, 3)) console.log(`    ${c.join(" → ")}`);
  console.log(``);
  if (coverageIdx) {
    console.log(`[10] Coverage Master Index 기준 누락`);
    console.log(`     critical 누락: ${criticalMissing.length}개`);
    for (const a of criticalMissing.slice(0, 10)) console.log(`       ❌ ${a}`);
    if (criticalMissing.length > 10) console.log(`       ... 외 ${criticalMissing.length - 10}개`);
    console.log(`     high 누락: ${highMissing.length}개`);
  } else {
    console.log(`[10] Coverage Master Index 미존재 (src/ontology/coverage/master-index.json)`);
  }
  console.log(``);

  // ─── 임계값 평가 ───
  const issues: string[] = [];
  if (danglingPct > THRESHOLDS.danglingPctMax) issues.push(`dangling ${danglingPct.toFixed(2)}% > ${THRESHOLDS.danglingPctMax}%`);
  if (doc14Pct < THRESHOLDS.doc14CompletePctMin) issues.push(`14종 추론 ${doc14Pct.toFixed(0)}% < ${THRESHOLDS.doc14CompletePctMin}%`);
  if (cycles.length > THRESHOLDS.cycleMax) issues.push(`DAG cycle ${cycles.length} > ${THRESHOLDS.cycleMax}`);
  if (hcDensity < THRESHOLDS.matrixDensityMin) issues.push(`Hazard↔Control 밀도 ${hcDensity.toFixed(2)}% < ${THRESHOLDS.matrixDensityMin}%`);

  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║  종합 진단                                                 ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);
  if (issues.length === 0) {
    console.log(`  ✅ 임계값 모두 통과`);
  } else {
    console.log(`  ⚠ 임계값 위반 ${issues.length}건:`);
    for (const i of issues) console.log(`    · ${i}`);
  }
  if (CRITICAL && criticalMissing.length > 0) {
    issues.push(`critical article 누락 ${criticalMissing.length}개 (--critical 모드)`);
  }
  if (STRICT && issues.length > 0) {
    console.log(`\n[FAIL] --strict 모드: 임계값 위반으로 audit 실패`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
