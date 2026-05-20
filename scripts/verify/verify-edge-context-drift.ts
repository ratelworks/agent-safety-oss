#!/usr/bin/env tsx
/**
 * verify-edge-context-drift.ts — context.jsonld @id terms vs EDGE_FIELDS drift
 *
 * 외부 평가 P0-2 (2026-05-19): context.jsonld 에서 @type:"@id" 로 선언된 term 과
 * src/lib/graph-nodes-loader.ts 의 EDGE_FIELDS 가 별도 SSoT.
 * graph-nodes-loader 가 모르는 predicate 는 graphology BFS 에서 보이지 않음.
 * → context 의 모든 @id term 이 EDGE_FIELDS 에 등록되었는지 검증.
 *
 * 예외 (의도된 비-runtime predicate):
 *   - PROV-O: wasGeneratedBy, wasDerivedFrom, wasAttributedTo, hadPrimarySource, creator
 *   - OWL/RDFS taxonomy: subClassOf, equivalentClass, broader, narrower
 *   - SKOS: 위와 동일
 *   - Schema/structural: inputSchema, members, koshaArchiveFacets, conformsTo
 *
 * HIGH 발견 시 exit 1 (release blocker).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONTEXT_PATH = resolve(ROOT, "src", "ontology", "graph", "context.jsonld");
const LOADER_PATH = resolve(ROOT, "src", "lib", "graph-nodes-loader.ts");

// 의도된 비-runtime predicate (PROV-O / taxonomy / structural)
const INTENTIONAL_EXCLUSIONS = new Set([
  // PROV-O
  "wasGeneratedBy",
  "wasDerivedFrom",
  "wasAttributedTo",
  "hadPrimarySource",
  "creator",
  // OWL / RDFS taxonomy (runtime BFS 부적합)
  "subClassOf",
  "equivalentClass",
  // SKOS hierarchy
  "broader",
  "narrower",
  // Schema / structural (runtime relation 아님)
  "inputSchema",
  "members",
  "koshaArchiveFacets",
  "conformsTo",
  "iso45001Class",
  "implements",
  "specifies",
  "applicableTo",
  "delegates",
  "cycle",
  "facetGroup",
  "isReferencedBy",
  "legislationPassedBy",
  "hasFacet",
  "hasSection",
  "hasPenalty",
  "requiresCert",
  "alternativeCycles",
  "appliesTo",
  "amendedTo",
]);

interface DriftIssue {
  severity: "HIGH" | "MEDIUM";
  category: "context_missing_in_loader" | "loader_missing_in_context";
  term: string;
  hint: string;
}

function extractContextIdTerms(): Set<string> {
  const ctx = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"));
  const terms = new Set<string>();
  for (const [k, v] of Object.entries(ctx["@context"] || {})) {
    if (v && typeof v === "object" && (v as any)["@type"] === "@id") {
      terms.add(k);
    }
  }
  return terms;
}

function extractEdgeFields(): Set<string> {
  const text = readFileSync(LOADER_PATH, "utf8");
  // EDGE_FIELDS 블록 추출
  const m = text.match(/const EDGE_FIELDS:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\n\};/);
  if (!m) {
    console.error(`EDGE_FIELDS 블록 미발견 (graph-nodes-loader.ts)`);
    process.exit(2);
  }
  const block = m[1];
  const fields = new Set<string>();
  // 패턴: "key: value," — 주석 line 제외
  const lineRe = /^\s*([a-zA-Z_]+):\s*"[a-zA-Z_]+"\s*,/gm;
  let lm: RegExpExecArray | null;
  while ((lm = lineRe.exec(block)) !== null) {
    fields.add(lm[1]);
  }
  return fields;
}

async function main(): Promise<void> {
  const contextTerms = extractContextIdTerms();
  const loaderFields = extractEdgeFields();

  const issues: DriftIssue[] = [];

  for (const term of contextTerms) {
    if (loaderFields.has(term)) continue;
    if (INTENTIONAL_EXCLUSIONS.has(term)) continue;
    issues.push({
      severity: "HIGH",
      category: "context_missing_in_loader",
      term,
      hint: `context.jsonld 에 @type:@id 선언됐는데 EDGE_FIELDS 에 없음. graphology BFS 미반영. 추가 또는 INTENTIONAL_EXCLUSIONS 등록 필요.`,
    });
  }

  for (const field of loaderFields) {
    if (contextTerms.has(field)) continue;
    issues.push({
      severity: "MEDIUM",
      category: "loader_missing_in_context",
      term: field,
      hint: `EDGE_FIELDS 에 있지만 context.jsonld @id term 미정의. 외부 RDF 호환성 약화.`,
    });
  }

  // 출력
  console.log("Context @id ↔ EDGE_FIELDS drift 검증");
  console.log(`  context @type:@id terms:    ${contextTerms.size}`);
  console.log(`  EDGE_FIELDS:                ${loaderFields.size}`);
  console.log(`  INTENTIONAL_EXCLUSIONS:     ${INTENTIONAL_EXCLUSIONS.size}`);
  console.log();

  const high = issues.filter((i) => i.severity === "HIGH");
  const medium = issues.filter((i) => i.severity === "MEDIUM");

  console.log(`발견 issues:`);
  console.log(`  HIGH:   ${high.length}`);
  console.log(`  MEDIUM: ${medium.length}`);
  console.log();

  for (const sev of ["HIGH", "MEDIUM"] as const) {
    const list = issues.filter((i) => i.severity === sev);
    if (list.length === 0) continue;
    console.log(`[${sev}] ${list.length} 건`);
    for (const i of list.slice(0, 20)) {
      console.log(`  · ${i.category}: ${i.term} — ${i.hint}`);
    }
    if (list.length > 20) console.log(`  ... 외 ${list.length - 20} 건`);
    console.log();
  }

  if (high.length > 0) {
    console.error(`✗ HIGH ${high.length} 건 — context.jsonld 와 EDGE_FIELDS drift. release blocker.`);
    process.exit(1);
  }
  console.log(`✓ HIGH 0 건 — context ↔ EDGE_FIELDS 정합 OK`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[verify-edge-context-drift] fatal:`, e);
  process.exit(1);
});
