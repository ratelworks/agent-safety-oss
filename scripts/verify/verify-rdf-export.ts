#!/usr/bin/env tsx
/**
 * verify-rdf-export.ts — 내보낸 RDF(N-Quads)를 표준 RDF 저장소에 올려 질의하고 결과를 단언한다
 *
 * 그래프 원본(JSON-LD 노드 파일)에서 기대값을 직접 계산해, 내보낸 RDF 에 대한
 * 트리플 패턴 질의 결과와 비교한다. 기대 건수를 코드에 적어 두지 않으므로
 * 데이터가 늘어도 시험을 고칠 필요가 없고, 0건 결과는 통과하지 못한다.
 *
 * 사용: npm run verify:rdf-export   (내보내기를 먼저 실행한 뒤 검증)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Store, DataFactory } from "n3";

const { namedNode } = DataFactory;

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NQ_PATH = resolve(ROOT, "artifacts", "export", "rdf-dist", "safety-graph.nq");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");
const CONTEXT_PATH = resolve(ROOT, "src", "ontology", "graph", "context.jsonld");
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SCHEMA = "https://schema.org/";
/** 예전 시험이 쓰던, 실제로는 존재하지 않는 어휘 주소 — 0건이어야 한다(대조군) */
const WRONG_VOCAB = "https://safety.ratelworks.org/vocab#";
const SAMPLE_ARTICLE = "art:산안법:36";
const SAMPLE_DOCUMENT_ID = "work_plan_excavation";
const SAMPLE_PENALIZED_ARTICLE = "art:기준규칙:38";
const INVERSE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["legalBasis", "legalBasisOf"],
  ["delegates", "delegationOf"],
  ["regulates", "regulatedBy"],
];

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 원본 읽기 ───────────────────────────────────────────────────────
type SourceNode = Record<string, unknown>;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".jsonld") ? [p] : [];
  });
}

const context = (JSON.parse(readFileSync(CONTEXT_PATH, "utf8")) as { "@context": Record<string, unknown> })["@context"];

/** 축약 주소(art:산안법:36)를 전체 주소로 편다 */
function expand(compact: string): string {
  const i = compact.indexOf(":");
  const base = i > 0 ? context[compact.slice(0, i)] : undefined;
  return typeof base === "string" ? base + compact.slice(i + 1) : compact;
}

/** 용어(legalBasis 등)의 전체 술어 주소 */
function predicate(term: string): string {
  const def = context[term];
  const id = typeof def === "string" ? def : (def as { "@id"?: string } | undefined)?.["@id"];
  if (!id) throw new Error(`context 에 없는 용어: ${term}`);
  return expand(id);
}

function refs(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list
    .map((v) => (typeof v === "string" ? v : (v as { "@id"?: string } | null)?.["@id"]))
    .filter((v): v is string => typeof v === "string");
}

function hasType(node: SourceNode, type: string): boolean {
  return refs(node["@type"]).includes(type);
}

// ── 검증 ────────────────────────────────────────────────────────────
function main(): void {
  if (!existsSync(NQ_PATH)) {
    console.error(`❌ 내보낸 RDF 가 없음: ${NQ_PATH} (npm run export-rdf 먼저)`);
    process.exit(1);
  }
  const store = new Store(new Parser({ format: "application/n-quads" }).parse(readFileSync(NQ_PATH, "utf8")));
  const sources = new Map<string, SourceNode>();
  for (const file of walk(NODES_DIR)) {
    const node = JSON.parse(readFileSync(file, "utf8")) as SourceNode;
    if (typeof node["@id"] === "string") sources.set(node["@id"], node);
  }
  const objectsOf = (subject: string, term: string): string[] =>
    store.getObjects(namedNode(subject), namedNode(predicate(term)), null).map((o) => o.value).sort();
  const count = (p: string | null, o: string | null): number =>
    store.countQuads(null, p ? namedNode(p) : null, o ? namedNode(o) : null, null);

  check("트리플이 올라옴", store.size > 0, String(store.size));

  // 1. 모든 원본 노드가 RDF 주어로 존재
  const missingSubjects = [...sources.keys()].filter((id) => store.countQuads(namedNode(expand(id)), null, null, null) === 0);
  check("원본 노드가 모두 RDF 주어로 있음", sources.size > 0 && missingSubjects.length === 0, missingSubjects.slice(0, 3).join(", "));

  // 2. schema:Legislation 타입 수 = 원본에서 Legislation 타입인 노드 수
  const legislationInSource = [...sources.values()].filter((n) => hasType(n, "Legislation")).length;
  const legislationInRdf = count(RDF_TYPE, `${SCHEMA}Legislation`);
  check("schema:Legislation 노드 수가 원본과 같음", legislationInSource > 0 && legislationInRdf === legislationInSource, `${legislationInRdf} vs ${legislationInSource}`);

  // 3. 위임 사슬 — 표본 조문의 delegates 대상이 원본과 같음
  const article = sources.get(SAMPLE_ARTICLE);
  const expectedDelegates = refs(article?.delegates).map(expand).sort();
  check(
    `${SAMPLE_ARTICLE} 의 delegates 가 원본과 같음`,
    expectedDelegates.length > 0 && JSON.stringify(objectsOf(expand(SAMPLE_ARTICLE), "delegates")) === JSON.stringify(expectedDelegates),
    `${objectsOf(expand(SAMPLE_ARTICLE), "delegates").length} vs ${expectedDelegates.length}`,
  );

  // 4. 문서의 법령 근거 — 대상이 원본과 같고, 대상마다 제목(schema:name)이 있음
  const doc = [...sources.values()].find((n) => n.docId === SAMPLE_DOCUMENT_ID);
  const docIri = expand(String(doc?.["@id"] ?? ""));
  const expectedBasis = refs(doc?.legalBasis).map(expand).sort();
  const basis = objectsOf(docIri, "legalBasis");
  check(`${SAMPLE_DOCUMENT_ID} 의 legalBasis 가 원본과 같음`, expectedBasis.length > 0 && JSON.stringify(basis) === JSON.stringify(expectedBasis), `${basis.length} vs ${expectedBasis.length}`);
  const untitled = basis.filter((target) => store.countQuads(namedNode(target), namedNode(`${SCHEMA}name`), null, null) === 0);
  check("법령 근거 대상마다 제목이 있음", untitled.length === 0, untitled.slice(0, 3).join(", "));

  // 5. 벌칙 — 표본 조문의 penalizedBy 대상마다 금액(amount)이 있음
  const penalties = objectsOf(expand(SAMPLE_PENALIZED_ARTICLE), "penalizedBy");
  const expectedPenalties = refs(sources.get(SAMPLE_PENALIZED_ARTICLE)?.penalizedBy).map(expand).sort();
  check(`${SAMPLE_PENALIZED_ARTICLE} 의 penalizedBy 가 원본과 같음`, expectedPenalties.length > 0 && JSON.stringify(penalties) === JSON.stringify(expectedPenalties));
  check("벌칙마다 금액이 있음", penalties.every((p) => store.countQuads(namedNode(p), namedNode(predicate("amount")), null, null) > 0));

  // 6. 위험요인 → 통제대책 간선 수 = 원본 합계
  const mitigatedInSource = [...sources.values()].reduce((sum, n) => sum + refs(n.mitigatedBy).length, 0);
  const mitigatedInRdf = count(predicate("mitigatedBy"), null);
  check("mitigatedBy 간선 수가 원본과 같음", mitigatedInSource > 0 && mitigatedInRdf === mitigatedInSource, `${mitigatedInRdf} vs ${mitigatedInSource}`);

  // 7. 역관계 — RDF 에서도 양쪽이 일치 (예외 없음 — owl:inverseOf 선언과 데이터가 같아야 한다)
  const subjects = new Set([...sources.keys()].map(expand));
  for (const [forward, backward] of INVERSE_PAIRS) {
    for (const [a, b] of [[forward, backward], [backward, forward]] as const) {
      let total = 0;
      const oneSided: string[] = [];
      for (const q of store.getQuads(null, namedNode(predicate(a)), null, null)) {
        if (!subjects.has(q.object.value) || !subjects.has(q.subject.value)) continue;
        total += 1;
        if (store.countQuads(namedNode(q.object.value), namedNode(predicate(b)), namedNode(q.subject.value), null) === 0) {
          oneSided.push(`${q.subject.value} → ${q.object.value}`);
        }
      }
      check(`${a} 간선마다 반대쪽 ${b} 가 있음 (${total}건)`, total > 0 && oneSided.length === 0, `${oneSided.length}건 한쪽뿐: ${oneSided.slice(0, 2).join(" ; ")}`);
    }
  }

  // 8. 대조군 — 존재하지 않는 어휘 주소로 물으면 0건
  check("대조군: 잘못된 어휘 주소로는 0건", count(`${WRONG_VOCAB}legalBasis`, null) === 0 && count(`${WRONG_VOCAB}mitigatedBy`, null) === 0);

  console.log(`[rdf-export] 트리플 ${store.size} · 원본 노드 ${sources.size} · Legislation ${legislationInRdf} · mitigatedBy ${mitigatedInRdf}`);
  console.log(`[rdf-export] ${pass} 통과 / ${fail} 실패`);
  if (fail > 0) process.exit(1);
}

main();
