#!/usr/bin/env tsx
/**
 * 온톨로지 그래프 종합 감사
 *
 * 8 카테고리:
 *   1. 무결성 — dangling refs / orphans / 중복 @id
 *   2. JSON-LD context — 모든 prefix·term 정의 여부
 *   3. 노드 타입 — @type 누락·미정의
 *   4. 도달성 — 핵심 노드(법령·KOSHA·사고)가 의무문서에서 도달 가능한지
 *   5. 양방향 링크 — informedBy ↔ legalBasisOf 등
 *   6. 의무문서 커버리지 — 66 doc 전체에 핵심 필드 보유
 *   7. 메타데이터 — 라이선스·출처·verifiedAt 표기
 *   8. 도메인 일관성 — 안전관리 외 노드 침투 여부
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "src/ontology/graph");
const NODES = resolve(ROOT, "nodes");
const CONTEXT_PATH = resolve(ROOT, "context.jsonld");

// 그래프 엣지 술어 — 모든 IRI 참조 키
const EDGE_KEYS = [
  "delegates","references","hasArticle","hasChapter","hasSection","delegationOf",
  "partOf","hasAnnex","specifies","regulates","penalizedBy","appliesTo","requires",
  "mitigatedBy","causedBy","evaluatedBy","cycledAs","legalBasisOf","legalBasis",
  "guidedBy","hasHazard","alternativeCycles","appliesToActivities","amendedTo",
  "interpretedBy","auditedBy","informedBy","cited_in","involves","requiresCert",
  "applicableTo","isPartOf","cycle","penaltyOnMissing","relatedDocs",
  "legislationPassedBy","facetGroup","koshaArchiveFacets",
  "hasFacet","hasPenalty",
] as const;

// 노드 단계별 walk
async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const f of await readdir(dir)) {
    const p = resolve(dir, f);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}

interface NodeInfo {
  path: string;
  iri: string;
  type: string | string[] | undefined;
  raw: any;
  refs: Set<string>;
}

interface AuditReport {
  totals: { nodes: number; edges: number };
  integrity: {
    duplicateIris: string[];
    danglingRefs: { source: string; refs: string[] }[];
    orphans: { iri: string; type: string }[];
    selfReferences: { iri: string; key: string }[];
  };
  context: {
    declaredPrefixes: string[];
    usedPrefixes: string[];
    missingPrefixes: string[];
    declaredTerms: string[];
    usedKeys: string[];
    missingKeys: string[];
  };
  types: {
    distribution: Record<string, number>;
    nodesWithoutType: string[];
    typesNotInContext: string[];
  };
  reachability: {
    documentsRoot: number;
    coreNodesReached: number;
    coreNodesIsolated: { iri: string; reason: string }[];
  };
  bidirectional: {
    asymmetric: { from: string; to: string; missingReverse: string }[];
  };
  documents: {
    count: number;
    missingSections: string[];
    missingLegalBasis: string[];
    missingTitle: string[];
    missingCycle: string[];
  };
  metadata: {
    nodesWithoutPublisher: number;
    nodesWithoutSourceUrl: number;
    nodesWithoutVerifiedAt: number;
    nodesWithoutLicense: number;
    sample: { issue: string; iri: string }[];
  };
  domain: {
    suspectExternalDomain: string[];
  };
}

async function main() {
  // 1. 노드 로드
  const paths = await walk(NODES);
  const ctx = JSON.parse(await readFile(CONTEXT_PATH, "utf-8"));
  const ctxKeys = Object.keys(ctx["@context"] ?? {});
  const ctxPrefixes = ctxKeys.filter((k) => {
    const v = ctx["@context"][k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return true;
    // expanded term definition with @prefix: true
    if (typeof v === "object" && v !== null && v["@prefix"] === true) return true;
    return false;
  });

  const nodes = new Map<string, NodeInfo>();
  const dupIris: string[] = [];
  const usedPrefixes = new Set<string>();
  const usedKeys = new Set<string>();
  const allRefs = new Set<string>();
  const refByOrigin = new Map<string, Set<string>>();
  const typeDistribution: Record<string, number> = {};
  const nodesWithoutType: string[] = [];
  let edgeCount = 0;

  for (const p of paths) {
    let n: any;
    try {
      n = JSON.parse(await readFile(p, "utf-8"));
    } catch (e) {
      console.error(`[parse] ${p}: ${(e as Error).message}`);
      continue;
    }
    const iri = n["@id"];
    const rel = relative(NODES, p);
    if (!iri) {
      nodesWithoutType.push(rel);
      continue;
    }
    if (nodes.has(iri)) dupIris.push(`${iri} (${rel} vs ${relative(NODES, nodes.get(iri)!.path)})`);

    // refs collect
    const refs = new Set<string>();
    for (const k of EDGE_KEYS) {
      const v = n[k];
      if (typeof v === "string") { refs.add(v); allRefs.add(v); usedKeys.add(k); edgeCount++; }
      else if (Array.isArray(v)) for (const x of v) {
        if (typeof x === "string") { refs.add(x); allRefs.add(x); usedKeys.add(k); edgeCount++; }
      }
    }

    // type distribution
    const t = n["@type"];
    if (!t) nodesWithoutType.push(iri);
    else {
      const types = Array.isArray(t) ? t : [t];
      for (const tt of types) typeDistribution[tt] = (typeDistribution[tt] ?? 0) + 1;
    }

    // prefix usage
    const prefix = iri.split(":")[0];
    if (prefix) usedPrefixes.add(prefix);
    for (const r of refs) {
      const rp = r.split(":")[0];
      if (rp) usedPrefixes.add(rp);
    }

    nodes.set(iri, { path: p, iri, type: t, raw: n, refs });
    refByOrigin.set(iri, refs);
  }

  // 2. 무결성
  const danglingByNode: Record<string, string[]> = {};
  for (const [iri, info] of nodes) {
    const danglings = [...info.refs].filter((r) => !nodes.has(r));
    if (danglings.length) danglingByNode[iri] = danglings;
  }
  const danglingRefs = Object.entries(danglingByNode).map(([source, refs]) => ({ source, refs }));

  const orphans: { iri: string; type: string }[] = [];
  for (const iri of nodes.keys()) {
    if (!allRefs.has(iri)) {
      const t = nodes.get(iri)!.type;
      orphans.push({ iri, type: Array.isArray(t) ? t.join(",") : (t ?? "?") });
    }
  }

  const selfRefs: { iri: string; key: string }[] = [];
  for (const [iri, info] of nodes) {
    for (const k of EDGE_KEYS) {
      const v = info.raw[k];
      if (v === iri) selfRefs.push({ iri, key: k });
      else if (Array.isArray(v) && v.includes(iri)) selfRefs.push({ iri, key: k });
    }
  }

  // 3. context
  const missingPrefixes = [...usedPrefixes].filter((p) => !ctxPrefixes.includes(p));
  const ctxTermSet = new Set(ctxKeys);
  const missingKeys = [...usedKeys].filter((k) => !ctxTermSet.has(k));

  // 4. types
  const ctxTypes = new Set<string>();
  for (const [k, v] of Object.entries(ctx["@context"] ?? {})) {
    if (typeof v === "string" && v.startsWith("safety:") && k[0] === k[0].toUpperCase()) ctxTypes.add(k);
    if (typeof v === "string" && v.startsWith("schema:") && k[0] === k[0].toUpperCase()) ctxTypes.add(k);
  }
  const usedTypes = Object.keys(typeDistribution);
  const typesNotInContext = usedTypes.filter((t) => !ctxTypes.has(t));

  // 5. 도달성 — 의무문서에서 BFS로 도달 가능한 노드
  const documentRoots = [...nodes.values()]
    .filter((n) => Array.isArray(n.type) ? n.type.includes("Document") : n.type === "Document")
    .map((n) => n.iri);
  const reachable = new Set<string>(documentRoots);
  const queue = [...documentRoots];
  while (queue.length) {
    const cur = queue.shift()!;
    const info = nodes.get(cur);
    if (!info) continue;
    for (const r of info.refs) {
      if (!reachable.has(r) && nodes.has(r)) {
        reachable.add(r);
        queue.push(r);
      }
    }
  }

  // 핵심 노드(법령·KOSHA·hazard·event·activity)가 도달됐는지
  const coreTypes = ["Article","Annex","Hazard","Event","Activity","Control","Method","Cycle","Facet","Equipment","Penalty"];
  const coreIsolated: { iri: string; reason: string }[] = [];
  let coreReachedCount = 0;
  for (const [iri, info] of nodes) {
    const t = Array.isArray(info.type) ? info.type : [info.type ?? ""];
    if (t.some((tt) => coreTypes.includes(tt as string))) {
      if (reachable.has(iri)) coreReachedCount++;
      else coreIsolated.push({ iri, reason: `${t.join(",")} 노드가 의무문서에서 도달 불가` });
    }
  }

  // 6. 양방향 링크 — informedBy(doc → entity/src) 시 entity·src에서 역참조 expected
  // 너무 광범위 — partOf ↔ hasArticle/hasChapter/hasSection 만 검사
  const asymmetric: { from: string; to: string; missingReverse: string }[] = [];
  for (const [iri, info] of nodes) {
    const part = info.raw.partOf;
    if (typeof part === "string" && nodes.has(part)) {
      const parent = nodes.get(part)!;
      const hasA = parent.raw.hasArticle ?? [];
      const hasC = parent.raw.hasChapter ?? [];
      const hasS = parent.raw.hasSection ?? [];
      const hasAn = parent.raw.hasAnnex ?? [];
      const hasP = parent.raw.hasPenalty ?? [];
      const hasF = parent.raw.hasFacet ?? [];
      const found = [...hasA, ...hasC, ...hasS, ...hasAn, ...hasP, ...hasF].includes(iri);
      if (!found) asymmetric.push({ from: iri, to: part, missingReverse: "hasArticle/hasChapter/hasSection/hasAnnex/hasPenalty/hasFacet" });
    }
  }

  // 7. 의무문서 검증
  const docNodes = [...nodes.values()].filter((n) => Array.isArray(n.type) ? n.type.includes("Document") : n.type === "Document");
  const missingSections: string[] = [];
  const missingLegalBasis: string[] = [];
  const missingTitle: string[] = [];
  const missingCycle: string[] = [];
  // 의무문서 한정 (KOSHA Guide 800+ 제외)
  const obligationDocs = docNodes.filter((n) => n.iri.startsWith("doc:") && !n.iri.startsWith("doc:kosha_guide"));
  for (const d of obligationDocs) {
    const r = d.raw;
    if (!Array.isArray(r.sections) || r.sections.length === 0) missingSections.push(d.iri);
    if (!Array.isArray(r.legalBasis) || r.legalBasis.length === 0) missingLegalBasis.push(d.iri);
    if (!r.title || typeof r.title !== "string") missingTitle.push(d.iri);
    if (!r.cycle) missingCycle.push(d.iri);
  }

  // 8. 메타데이터
  let noPublisher = 0, noSourceUrl = 0, noVerifiedAt = 0, noLicense = 0;
  const metaSample: { issue: string; iri: string }[] = [];
  for (const [iri, info] of nodes) {
    const meta = info.raw._meta ?? {};
    if (!meta.publishedBy && !info.raw.publishedBy) {
      noPublisher++;
      if (metaSample.length < 5) metaSample.push({ issue: "no publisher", iri });
    }
    if (!meta.sourceUrl && !info.raw.sourceUrl) noSourceUrl++;
    if (!meta.verifiedAt && !meta.fetchedAt && !info.raw.fetchedAt) noVerifiedAt++;
    if (!meta.license && !meta.licenseHint && !info.raw.licenseHint) noLicense++;
  }

  // 9. 도메인 — 안전관리 외 키워드 (word boundary 기반)
  // 한국어 명사 위주: 광산·채석장·철도·항공·해상. 영어는 "...amine" 같은 false positive 회피
  const offTopicPatterns: { kw: string; pattern: RegExp }[] = [
    { kw: "광산",   pattern: /광산(?!물)|갱도/ },
    { kw: "채석장", pattern: /채석장|채석업/ },
    { kw: "철도",   pattern: /철도(?:안전|차량|운영|시설)/ },
    { kw: "항공",   pattern: /항공기|항공안전/ },
    { kw: "해상",   pattern: /해상안전|해양사고/ },
  ];
  const suspectExternal: string[] = [];
  for (const [iri, info] of nodes) {
    const txt = JSON.stringify(info.raw);
    for (const { kw, pattern } of offTopicPatterns) {
      if (pattern.test(txt)) { suspectExternal.push(`${iri} (keyword: ${kw})`); break; }
    }
  }

  const report: AuditReport = {
    totals: { nodes: nodes.size, edges: edgeCount },
    integrity: {
      duplicateIris: dupIris,
      danglingRefs,
      orphans,
      selfReferences: selfRefs,
    },
    context: {
      declaredPrefixes: ctxPrefixes,
      usedPrefixes: [...usedPrefixes],
      missingPrefixes,
      declaredTerms: ctxKeys,
      usedKeys: [...usedKeys],
      missingKeys,
    },
    types: {
      distribution: typeDistribution,
      nodesWithoutType,
      typesNotInContext,
    },
    reachability: {
      documentsRoot: documentRoots.length,
      coreNodesReached: coreReachedCount,
      coreNodesIsolated: coreIsolated,
    },
    bidirectional: { asymmetric },
    documents: {
      count: obligationDocs.length,
      missingSections,
      missingLegalBasis,
      missingTitle,
      missingCycle,
    },
    metadata: {
      nodesWithoutPublisher: noPublisher,
      nodesWithoutSourceUrl: noSourceUrl,
      nodesWithoutVerifiedAt: noVerifiedAt,
      nodesWithoutLicense: noLicense,
      sample: metaSample,
    },
    domain: { suspectExternalDomain: suspectExternal },
  };

  // ─── 보고서 출력
  console.log("=".repeat(70));
  console.log("온톨로지 그래프 종합 감사 보고서");
  console.log("=".repeat(70));
  console.log(`총 노드: ${report.totals.nodes}`);
  console.log(`총 엣지: ${report.totals.edges}`);
  console.log("");

  console.log("[1] 무결성");
  console.log(`  중복 @id:           ${report.integrity.duplicateIris.length}`);
  if (report.integrity.duplicateIris.length) console.log(`    ${report.integrity.duplicateIris.slice(0,3).join("\n    ")}`);
  console.log(`  Dangling refs:      ${report.integrity.danglingRefs.length} 노드 (${report.integrity.danglingRefs.reduce((s,r)=>s+r.refs.length,0)} 참조)`);
  if (report.integrity.danglingRefs.length) {
    for (const d of report.integrity.danglingRefs.slice(0,5)) console.log(`    ${d.source} → ${d.refs.slice(0,3).join(", ")}${d.refs.length>3?"...":""}`);
  }
  console.log(`  Orphans:            ${report.integrity.orphans.length} (${(report.integrity.orphans.length/nodes.size*100).toFixed(1)}%)`);
  console.log(`  Self-references:    ${report.integrity.selfReferences.length}`);
  console.log("");

  console.log("[2] JSON-LD context");
  console.log(`  선언된 prefix:      ${report.context.declaredPrefixes.length}`);
  console.log(`  사용된 prefix:      ${report.context.usedPrefixes.length}`);
  console.log(`  누락 prefix:        ${report.context.missingPrefixes.length}`);
  if (report.context.missingPrefixes.length) console.log(`    → ${report.context.missingPrefixes.join(", ")}`);
  console.log(`  사용 키 vs 선언:    누락 ${report.context.missingKeys.length}`);
  if (report.context.missingKeys.length) console.log(`    → ${report.context.missingKeys.slice(0,10).join(", ")}`);
  console.log("");

  console.log("[3] 타입 분포");
  const sorted = Object.entries(report.types.distribution).sort((a,b)=>b[1]-a[1]);
  for (const [t, c] of sorted) console.log(`  ${t.padEnd(20)} ${c}`);
  console.log(`  타입 누락 노드:     ${report.types.nodesWithoutType.length}`);
  console.log(`  context 미선언 타입: ${report.types.typesNotInContext.length}`);
  if (report.types.typesNotInContext.length) console.log(`    → ${report.types.typesNotInContext.join(", ")}`);
  console.log("");

  console.log("[4] 도달성 (의무문서 → BFS)");
  console.log(`  Document 루트:      ${report.reachability.documentsRoot}`);
  console.log(`  핵심 노드 도달:     ${report.reachability.coreNodesReached}`);
  console.log(`  핵심 노드 고립:     ${report.reachability.coreNodesIsolated.length}`);
  if (report.reachability.coreNodesIsolated.length) {
    for (const c of report.reachability.coreNodesIsolated.slice(0,5)) console.log(`    ${c.iri}`);
    if (report.reachability.coreNodesIsolated.length > 5) console.log(`    ... +${report.reachability.coreNodesIsolated.length-5}개`);
  }
  console.log("");

  console.log("[5] 양방향 링크");
  console.log(`  partOf ↔ hasArticle/Chapter/Section 비대칭: ${report.bidirectional.asymmetric.length}`);
  if (report.bidirectional.asymmetric.length) {
    for (const a of report.bidirectional.asymmetric.slice(0,5)) console.log(`    ${a.from} partOf ${a.to} (역참조 없음)`);
  }
  console.log("");

  console.log("[6] 의무문서 커버리지");
  console.log(`  의무문서 노드:      ${report.documents.count}`);
  console.log(`  sections 누락:      ${report.documents.missingSections.length}`);
  if (report.documents.missingSections.length) console.log(`    → ${report.documents.missingSections.slice(0,3).join(", ")}`);
  console.log(`  legalBasis 누락:    ${report.documents.missingLegalBasis.length}`);
  if (report.documents.missingLegalBasis.length) console.log(`    → ${report.documents.missingLegalBasis.slice(0,3).join(", ")}`);
  console.log(`  title 누락:         ${report.documents.missingTitle.length}`);
  console.log(`  cycle 누락:         ${report.documents.missingCycle.length}`);
  if (report.documents.missingCycle.length) console.log(`    → ${report.documents.missingCycle.slice(0,3).join(", ")}`);
  console.log("");

  console.log("[7] 메타데이터");
  console.log(`  publisher 누락:     ${report.metadata.nodesWithoutPublisher} (${(report.metadata.nodesWithoutPublisher/nodes.size*100).toFixed(1)}%)`);
  console.log(`  sourceUrl 누락:     ${report.metadata.nodesWithoutSourceUrl} (${(report.metadata.nodesWithoutSourceUrl/nodes.size*100).toFixed(1)}%)`);
  console.log(`  verifiedAt 누락:    ${report.metadata.nodesWithoutVerifiedAt} (${(report.metadata.nodesWithoutVerifiedAt/nodes.size*100).toFixed(1)}%)`);
  console.log(`  license 누락:       ${report.metadata.nodesWithoutLicense} (${(report.metadata.nodesWithoutLicense/nodes.size*100).toFixed(1)}%)`);
  console.log("");

  console.log("[8] 도메인 일관성");
  console.log(`  안전 외 키워드 의심: ${report.domain.suspectExternalDomain.length}`);
  if (report.domain.suspectExternalDomain.length) {
    for (const s of report.domain.suspectExternalDomain.slice(0,5)) console.log(`    ${s}`);
  }
  console.log("");

  // 종합 점수
  const issuesCount = report.integrity.duplicateIris.length
                    + report.integrity.danglingRefs.length
                    + report.context.missingPrefixes.length
                    + report.context.missingKeys.length
                    + report.types.typesNotInContext.length
                    + report.bidirectional.asymmetric.length
                    + report.documents.missingSections.length
                    + report.documents.missingLegalBasis.length
                    + report.documents.missingTitle.length
                    + report.documents.missingCycle.length;
  console.log("=".repeat(70));
  console.log(`종합 이슈 카운트: ${issuesCount} (orphan·메타데이터 누락 제외 — 권고사항)`);
  console.log("=".repeat(70));

  // JSON dump
  const { writeFile } = await import("node:fs/promises");
  await writeFile(resolve(__dirname, "..", "..", "artifacts", "audit", "audit-report.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log("\n전체 리포트: audit-report.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
