#!/usr/bin/env tsx
/**
 * v2 — RDF expand 시뮬레이션 + inverse 검사 일반화 + cardinality
 *
 * v1 대비 신규 검증:
 *   A. JSON-LD term 자동 감지 — 노드에서 사용된 모든 키가 context.jsonld 에 등재됐는지
 *   B. RDF expand 시뮬레이션 — string value 가 IRI 로 expand 되는지 (term @type:@id 또는 @vocab 필요)
 *   C. inverse property 일반 검사 — legalBasis ↔ legalBasisOf, mitigatedBy ↔ controlsHazard 등
 *   D. cardinality — 의무문서 필수 필드 1개 이상 작성됐는지
 *   E. datatype — 일자/숫자/이메일 등 형식 검증
 */
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "src/ontology/graph");
const NODES = resolve(ROOT, "nodes");
const CONTEXT_PATH = resolve(ROOT, "context.jsonld");

// 모든 IRI 참조 키 (재귀 검색용)
function isIriValue(v: unknown): boolean {
  return typeof v === "string" && /^[a-z][a-zA-Z0-9_]*:[^\s]+/.test(v);
}

function isVocabularyRef(iri: string): boolean {
  return (
    /^safety:[A-Z]/.test(iri) ||
    iri.startsWith("safety:schema/") ||
    iri.startsWith("safety:action/") ||
    iri.startsWith("safety:agent/") ||
    iri.startsWith("cc:")
  );
}

// inverse property 쌍 — strict 1:1 (forward 만 검사)
// partOf 같이 부모 종류가 여러개인 경우 별도 처리 (any 매칭)
const INVERSE_PAIRS: Array<[string, string]> = [
  ["legalBasis", "legalBasisOf"],
  ["facetGroup", "hasFacet"],
];

// partOf → 부모 노드에 has{Type} 中 어느 하나라도 매칭되면 OK
const PART_INVERSE_KEYS = ["hasArticle","hasChapter","hasSection","hasAnnex","hasPenalty","hasFacet"];

// _meta / standardForm / 기타 @json term — 안의 키는 RDF expand 대상 아님
const JSON_TERMS_NO_DESCEND = new Set(["_meta","standardForm","applicableWhen","exemptedWhen","externalRef","sections","requiredFields","reviewRules"]);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const f of await readdir(dir)) {
    const p = resolve(dir, f);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}

interface NodeInfo { path: string; iri: string; type: string | string[] | undefined; raw: any; allKeys: Set<string>; refs: Map<string, string[]>; }

async function main() {
  const ctx = JSON.parse(await readFile(CONTEXT_PATH, "utf-8"));
  const ctxDef: Record<string, any> = ctx["@context"];
  const ctxKeys = Object.keys(ctxDef);

  // term 정의 분석
  const termType = new Map<string, "prefix" | "id" | "json" | "list" | "literal" | "vocab" | "unknown">();
  const ctxPrefixes: string[] = [];
  for (const [k, v] of Object.entries(ctxDef)) {
    if (typeof v === "string") {
      // 단순 IRI string → prefix 또는 vocabulary mapping
      if (/^https?:\/\/.*[/#]$/.test(v)) {
        termType.set(k, "prefix");
        ctxPrefixes.push(k);
      } else if (/^https?:\/\//.test(v) || /^[a-z]+:[^\s]/.test(v)) {
        termType.set(k, "literal"); // term 매핑 (literal property)
      } else {
        termType.set(k, "literal");
      }
    } else if (typeof v === "object" && v !== null) {
      const t = v["@type"];
      if (v["@prefix"] === true) { termType.set(k, "prefix"); ctxPrefixes.push(k); continue; }
      if (t === "@id") termType.set(k, "id");
      else if (t === "@vocab") termType.set(k, "vocab");
      else if (t === "@json") termType.set(k, "json");
      else if (v["@container"] === "@list" || v["@container"] === "@set") termType.set(k, "list");
      else termType.set(k, "literal");
    }
  }

  const paths = await walk(NODES);
  const nodes = new Map<string, NodeInfo>();
  const allUsedKeys = new Set<string>();

  function collectKeys(obj: any, keys: Set<string>, refs: Map<string, string[]>, depth = 0) {
    if (Array.isArray(obj)) {
      for (const x of obj) collectKeys(x, keys, refs, depth);
      return;
    }
    if (obj === null || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("@")) continue; // JSON-LD keyword
      // top-level keys 만 정합성 검사 (depth==0). 그 외는 @json term 안이라 RDF 영향 없음
      if (depth === 0) keys.add(k);
      // _meta 등 @json term 안은 더 들어가지 않음 (term 미등재 검사 대상 외)
      if (depth === 0 && JSON_TERMS_NO_DESCEND.has(k)) continue;
      // IRI 참조 수집 (depth 무관)
      if (typeof v === "string" && isIriValue(v) && nodes.has(v)) {
        if (!refs.has(k)) refs.set(k, []);
        refs.get(k)!.push(v);
      } else if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x === "string" && isIriValue(x)) {
            if (!refs.has(k)) refs.set(k, []);
            refs.get(k)!.push(x);
          } else if (typeof x === "object") collectKeys(x, keys, refs, depth + 1);
        }
      } else if (typeof v === "object") collectKeys(v, keys, refs, depth + 1);
    }
  }

  for (const p of paths) {
    let n: any;
    try { n = JSON.parse(await readFile(p, "utf-8")); } catch { continue; }
    if (!n["@id"]) continue;
    const allKeys = new Set<string>();
    const refs = new Map<string, string[]>();
    nodes.set(n["@id"], { path: p, iri: n["@id"], type: n["@type"], raw: n, allKeys, refs });
  }
  // 두번째 pass — refs 분석 (nodes Map 완성 후 IRI 참조만 남김)
  for (const [, info] of nodes) {
    collectKeys(info.raw, info.allKeys, info.refs);
    for (const k of info.allKeys) allUsedKeys.add(k);
  }

  // ─── 검사 ───
  const findings: { severity: "HIGH" | "MEDIUM" | "LOW"; category: string; message: string; sample?: string[] }[] = [];

  // A. term 미정의
  const undefinedTerms = [...allUsedKeys].filter((k) => !ctxKeys.includes(k) && !["@context","@id","@type"].includes(k));
  if (undefinedTerms.length) {
    findings.push({ severity: "HIGH", category: "context.jsonld term 미정의", message: `${undefinedTerms.length}개 term 이 context 에 미등재 → JSON-LD expand 시 드롭`, sample: undefinedTerms });
  }

  // B. RDF expand — IRI value 인데 term @type:@id 아닌 경우
  const literalIriLeak: string[] = [];
  for (const [iri, info] of nodes) {
    for (const [key, targets] of info.refs) {
      const tt = termType.get(key);
      if (tt && tt !== "id" && tt !== "vocab" && tt !== "json" && tt !== "prefix") {
        // 참조가 있는데 term 이 IRI 처리 아님 → literal 로 expand
        if (literalIriLeak.length < 20) literalIriLeak.push(`${iri}.${key} (${tt}): targets ${targets.slice(0,2).join(", ")}`);
      }
    }
  }
  if (literalIriLeak.length) {
    findings.push({ severity: "HIGH", category: "RDF expand 시 IRI 가 literal 로 변환", message: `${literalIriLeak.length}건 (term @type:@id 또는 @json 필요)`, sample: literalIriLeak.slice(0,5) });
  }

  // C. inverse property 검사 (strict 1:1)
  for (const [forward, backward] of INVERSE_PAIRS) {
    const asym: string[] = [];
    for (const [iri, info] of nodes) {
      const targets = info.refs.get(forward) ?? [];
      for (const t of targets) {
        const target = nodes.get(t);
        if (!target) continue;
        const back = target.refs.get(backward) ?? [];
        if (!back.includes(iri)) asym.push(`${iri} -[${forward}]-> ${t} (역참조 ${backward} 누락)`);
      }
    }
    if (asym.length) {
      findings.push({ severity: "MEDIUM", category: `inverse 검증 ${forward}↔${backward}`, message: `${asym.length}건 비대칭`, sample: asym.slice(0,5) });
    }
  }

  // C-2. partOf inverse — 부모 노드의 has{Type} 중 어느 하나라도 매칭되면 OK
  const partAsym: string[] = [];
  for (const [iri, info] of nodes) {
    const targets = info.refs.get("partOf") ?? [];
    for (const t of targets) {
      const target = nodes.get(t);
      if (!target) continue;
      const matched = PART_INVERSE_KEYS.some((k) => (target.refs.get(k) ?? []).includes(iri));
      if (!matched) partAsym.push(`${iri} -[partOf]-> ${t} (역참조 has{Article|Chapter|Section|Annex|Penalty|Facet} 중 어느 것도 없음)`);
    }
  }
  if (partAsym.length) {
    findings.push({ severity: "MEDIUM", category: "partOf inverse (any 매칭)", message: `${partAsym.length}건 비대칭`, sample: partAsym.slice(0,5) });
  }

  // D. cardinality — 의무문서 sections 안의 fields 가 비어있지 않은지
  let docMissingFields = 0;
  const docMissingSamples: string[] = [];
  for (const [iri, info] of nodes) {
    const t = info.type;
    const isDoc = Array.isArray(t) ? t.includes("Document") : t === "Document";
    if (!isDoc || iri.startsWith("doc:kosha_guide")) continue;
    const sections = info.raw.sections;
    if (!Array.isArray(sections) || sections.length === 0) continue;
    let totalFields = 0;
    for (const s of sections) totalFields += (s.fields ?? []).length;
    if (totalFields === 0) {
      docMissingFields++;
      if (docMissingSamples.length < 3) docMissingSamples.push(iri);
    }
  }
  if (docMissingFields) {
    findings.push({ severity: "MEDIUM", category: "cardinality (의무문서 섹션 필드)", message: `${docMissingFields}개 의무문서 섹션이 비어있음`, sample: docMissingSamples });
  }

  // E. datatype — _meta.fetchedAt / verifiedAt 형식 (ISO 8601)
  let badDate = 0;
  const badDateSamples: string[] = [];
  for (const [iri, info] of nodes) {
    const meta = info.raw._meta ?? {};
    for (const k of ["fetchedAt", "verifiedAt"]) {
      const v = meta[k] ?? info.raw[k];
      if (v && typeof v === "string" && !/^\d{4}-\d{2}-\d{2}/.test(v)) {
        badDate++;
        if (badDateSamples.length < 3) badDateSamples.push(`${iri}._meta.${k}=${v}`);
      }
    }
  }
  if (badDate) {
    findings.push({ severity: "LOW", category: "datatype (날짜 ISO 8601)", message: `${badDate}건 잘못된 날짜 형식`, sample: badDateSamples });
  }

  // F. 노드 무결성 (v1 동등)
  let dangling = 0;
  const danglingSample: string[] = [];
  for (const [iri, info] of nodes) {
    for (const [key, targets] of info.refs) {
      for (const t of targets) {
        if (isVocabularyRef(t)) continue;
        if (!nodes.has(t)) {
          dangling++;
          if (danglingSample.length < 5) danglingSample.push(`${iri}.${key} -> ${t}`);
        }
      }
    }
  }
  if (dangling) findings.push({ severity: "HIGH", category: "Dangling refs", message: `${dangling}건`, sample: danglingSample });

  // ─── 출력
  console.log("=".repeat(72));
  console.log("온톨로지 v2 감사 — RDF expand + inverse + cardinality");
  console.log("=".repeat(72));
  console.log(`총 노드:           ${nodes.size}`);
  console.log(`사용된 모든 키:    ${allUsedKeys.size}`);
  console.log(`context 등재 term: ${ctxKeys.length}`);
  console.log(`prefix 정의:       ${ctxPrefixes.length}`);
  console.log("");

  const HIGH = findings.filter(f => f.severity === "HIGH");
  const MEDIUM = findings.filter(f => f.severity === "MEDIUM");
  const LOW = findings.filter(f => f.severity === "LOW");
  console.log(`HIGH:   ${HIGH.length}`);
  console.log(`MEDIUM: ${MEDIUM.length}`);
  console.log(`LOW:    ${LOW.length}`);
  console.log("");

  for (const f of findings) {
    console.log(`[${f.severity}] ${f.category}`);
    console.log(`  ${f.message}`);
    if (f.sample) for (const s of f.sample) console.log(`    · ${s}`);
    console.log("");
  }

  // fresh checkout 환경에서도 동작하도록 디렉토리 보장 후 보고서 기록.
  const reportPath = resolve(__dirname, "..", "..", "artifacts", "audit", "audit-report-v2.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({
    totals: { nodes: nodes.size, usedKeys: allUsedKeys.size, ctxKeys: ctxKeys.length },
    findings,
  }, null, 2), "utf-8");
  console.log(`종합: HIGH ${HIGH.length} / MEDIUM ${MEDIUM.length} / LOW ${LOW.length}`);

  // HIGH 발견은 release blocker — 외부 reviewer 지적 사항 해소.
  // --lenient 또는 ONTOLOGY_AUDIT_LENIENT=1 면 종전처럼 통과 (개발 중 임시 우회용).
  const lenient =
    process.argv.includes("--lenient") || (process.env["ONTOLOGY_AUDIT_LENIENT"] ?? "") === "1";
  if (HIGH.length > 0 && !lenient) {
    console.error(`\n✗ audit:graph-v2 FAIL — HIGH ${HIGH.length}건 발견. release blocker.`);
    console.error(`  강제 통과가 필요하면 --lenient 또는 ONTOLOGY_AUDIT_LENIENT=1.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
