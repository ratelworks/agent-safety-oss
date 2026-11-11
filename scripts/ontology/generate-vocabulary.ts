#!/usr/bin/env tsx
/**
 * generate-vocabulary.ts — 그래프가 쓰는 자체 어휘의 선언 색인을 만든다
 *
 * 그래프 노드가 쓰는 자체 어휘(safety:, cc:)의 클래스·속성 가운데, 손으로 쓴 어휘 정의
 * (skeleton·운영 프로파일·ISO 45001 매핑·동작 정의)에 선언이 없는 것을 모아
 * `src/ontology/graph/vocabulary.jsonld` 에 선언한다.
 *
 * 각 선언은 내보낸 RDF 에서 관찰한 사실만 담는다 — 속성 종류(개체/값), 쓰이는 주어 클래스,
 * 가리키는 대상 클래스, 역관계. 뜻 설명(rdfs:comment)은 만들지 않는다.
 *
 * 사용
 *   npm run vocabulary:generate   # 내보내기 후 색인 생성
 *   npm run vocabulary:check      # 색인이 현재 그래프와 같은지 점검 (다르면 exit 1)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser } from "n3";
import jsonld from "jsonld";
import { INVERSE_PAIRS } from "./materialize-inverse-edges.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NQ_PATH = resolve(ROOT, "artifacts", "export", "rdf-dist", "safety-graph.nq");
const CONTEXT_PATH = resolve(ROOT, "src", "ontology", "graph", "context.jsonld");
const OUTPUT_PATH = resolve(ROOT, "src", "ontology", "graph", "vocabulary.jsonld");
/** 손으로 쓴 어휘 정의 파일 — 여기에 선언된 용어는 색인에 다시 적지 않는다 */
const AUTHORED_FILES = [
  "src/ontology/skeleton/skeleton.jsonld",
  "src/ontology/skeleton/actions.jsonld",
  "src/ontology/operational/profile.jsonld",
  "src/ontology/graph/iso45001-mapping.jsonld",
].map((p) => resolve(ROOT, p));
const OWN_NAMESPACES = ["https://safety.ratelworks.org/ontology/v1/", "https://construction.ratelworks.org/ontology/v1/"];
const SAFETY_NS = OWN_NAMESPACES[0];
const VOCABULARY_IRI = "https://safety.ratelworks.org/ontology/v1/vocabulary";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const DECLARATION_TYPES = /owl#(Class|ObjectProperty|DatatypeProperty|AnnotationProperty)$|rdf-schema#Class$|rdf-syntax-ns#Property$/;

interface Declaration {
  "@id": string;
  "@type": string;
  "rdfs:label": string;
  "rdfs:isDefinedBy": { "@id": string };
  "schema:domainIncludes"?: Array<{ "@id": string }>;
  "schema:rangeIncludes"?: Array<{ "@id": string }>;
  "owl:inverseOf"?: { "@id": string };
}

function isOwn(iri: string): boolean {
  return OWN_NAMESPACES.some((ns) => iri.startsWith(ns));
}

function localName(iri: string): string {
  return iri.slice(Math.max(iri.lastIndexOf("/"), iri.lastIndexOf("#")) + 1);
}

function idList(values: Set<string>): Array<{ "@id": string }> {
  return [...values].sort().map((v) => ({ "@id": v }));
}

/** 손으로 쓴 어휘 정의 파일에 선언된 클래스·속성 주소 */
async function authoredDeclarations(): Promise<Set<string>> {
  const context = JSON.parse(readFileSync(CONTEXT_PATH, "utf8")) as object;
  const documentLoader = async (url: string) => ({ contextUrl: undefined, documentUrl: url, document: context });
  const declared = new Set<string>();
  for (const file of AUTHORED_FILES) {
    const doc = JSON.parse(readFileSync(file, "utf8")) as object;
    const nquads = (await jsonld.toRDF(doc, { format: "application/n-quads", documentLoader } as never)) as unknown as string;
    for (const q of new Parser({ format: "application/n-quads" }).parse(nquads)) {
      if (q.predicate.value === RDF_TYPE && DECLARATION_TYPES.test(q.object.value)) declared.add(q.subject.value);
    }
  }
  return declared;
}

async function build(): Promise<string> {
  if (!existsSync(NQ_PATH)) throw new Error(`내보낸 RDF 가 없음: ${NQ_PATH} (npm run export-rdf 먼저)`);
  const quads = new Parser({ format: "application/n-quads" }).parse(readFileSync(NQ_PATH, "utf8"));

  const typesOf = new Map<string, Set<string>>();
  for (const q of quads) {
    if (q.predicate.value !== RDF_TYPE) continue;
    const set = typesOf.get(q.subject.value) ?? new Set<string>();
    set.add(q.object.value);
    typesOf.set(q.subject.value, set);
  }

  const usedClasses = new Set<string>();
  for (const set of typesOf.values()) for (const t of set) if (isOwn(t)) usedClasses.add(t);

  interface Usage { iriObjects: number; literalObjects: number; domains: Set<string>; ranges: Set<string> }
  const usage = new Map<string, Usage>();
  for (const q of quads) {
    const p = q.predicate.value;
    if (p === RDF_TYPE || !isOwn(p)) continue;
    const u = usage.get(p) ?? { iriObjects: 0, literalObjects: 0, domains: new Set<string>(), ranges: new Set<string>() };
    if (q.object.termType === "Literal") u.literalObjects += 1;
    else u.iriObjects += 1;
    for (const t of typesOf.get(q.subject.value) ?? []) if (isOwn(t)) u.domains.add(t);
    if (q.object.termType === "NamedNode") for (const t of typesOf.get(q.object.value) ?? []) if (isOwn(t)) u.ranges.add(t);
    usage.set(p, u);
  }

  const authored = await authoredDeclarations();
  const inverse = new Map<string, string>();
  for (const [a, b] of INVERSE_PAIRS) {
    inverse.set(SAFETY_NS + a, SAFETY_NS + b);
    inverse.set(SAFETY_NS + b, SAFETY_NS + a);
  }

  const graph: Declaration[] = [];
  for (const iri of [...usedClasses].sort()) {
    if (authored.has(iri)) continue;
    graph.push({ "@id": iri, "@type": "owl:Class", "rdfs:label": localName(iri), "rdfs:isDefinedBy": { "@id": VOCABULARY_IRI } });
  }
  for (const iri of [...usage.keys()].sort()) {
    if (authored.has(iri)) {
      // 손으로 쓴 정의가 있는 속성은 다시 선언하지 않고, 역관계만 덧붙인다
      const inv = inverse.get(iri);
      if (inv) graph.push({ "@id": iri, "owl:inverseOf": { "@id": inv } } as unknown as Declaration);
      continue;
    }
    const u = usage.get(iri) as Usage;
    const declaration: Declaration = {
      "@id": iri,
      // 개체를 가리키는 쓰임이 하나라도 있으면 개체 속성으로 본다
      "@type": u.iriObjects > 0 ? "owl:ObjectProperty" : "owl:DatatypeProperty",
      "rdfs:label": localName(iri),
      "rdfs:isDefinedBy": { "@id": VOCABULARY_IRI },
    };
    if (u.domains.size > 0) declaration["schema:domainIncludes"] = idList(u.domains);
    if (u.ranges.size > 0) declaration["schema:rangeIncludes"] = idList(u.ranges);
    const inv = inverse.get(iri);
    if (inv) declaration["owl:inverseOf"] = { "@id": inv };
    graph.push(declaration);
  }

  const doc = {
    "@context": {
      owl: "http://www.w3.org/2002/07/owl#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      schema: "https://schema.org/",
      dcterms: "http://purl.org/dc/terms/",
    },
    "@graph": [
      {
        "@id": VOCABULARY_IRI,
        "@type": "owl:Ontology",
        "rdfs:label": "건설안전 그래프 어휘 색인",
        "rdfs:comment":
          "그래프 노드가 쓰는 자체 어휘 가운데 손으로 쓴 어휘 정의(skeleton, 운영 프로파일, ISO 45001 매핑, 동작 정의)에 선언이 없는 클래스와 속성의 선언 색인. 내보낸 RDF 에서 관찰한 쓰임(속성 종류, 주어 클래스, 대상 클래스, 역관계)만 담으며 자동 생성된다. 뜻 설명은 담지 않는다.",
        "dcterms:license": { "@id": "https://opensource.org/licenses/MIT" },
      },
      ...graph,
    ],
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const content = await build();
  const parsed = JSON.parse(content) as { "@graph": Declaration[] };
  const classes = parsed["@graph"].filter((d) => d["@type"] === "owl:Class").length;
  const properties = parsed["@graph"].filter((d) => /Property$/.test(d["@type"] ?? "")).length;
  if (check) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : "";
    if (current !== content) {
      console.error("❌ 어휘 색인이 현재 그래프와 다름 — npm run vocabulary:generate 로 다시 만들 것");
      process.exit(1);
    }
    console.log(`✅ 어휘 색인이 그래프와 같음 — 클래스 ${classes} · 속성 ${properties}`);
    return;
  }
  writeFileSync(OUTPUT_PATH, content);
  console.log(`어휘 색인 생성 — 클래스 ${classes} · 속성 ${properties} → ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
