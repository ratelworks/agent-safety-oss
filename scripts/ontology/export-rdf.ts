#!/usr/bin/env tsx
/**
 * export-rdf.ts
 *
 * 모든 JSON-LD 노드를 N-Quads + Turtle 로 export.
 * 외부 RDF 시스템 (Apache Jena, RDFLib, Stardog, GraphDB) 에서 직접 활용 가능.
 * P11-3 진짜 온톨로지 — RDF 호환 진짜 증명.
 *
 * 산출물:
 *   - artifacts/export/rdf-dist/safety-graph.nq     N-Quads (RDF 표준 직렬화)
 *   - artifacts/export/rdf-dist/safety-graph.ttl    Turtle (사람 읽기 친화)
 */

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const CONTEXT_PATH = resolve(ROOT, "src", "ontology", "graph", "context.jsonld");
const DIST = resolve(ROOT, "artifacts", "export", "rdf-dist");

(async () => {
  await mkdir(DIST, { recursive: true });

  const ctxDoc = JSON.parse(await readFile(CONTEXT_PATH, "utf8")) as Record<string, unknown>;
  const allNodes: unknown[] = [];

  const visit = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, e.name);
      if (e.isDirectory()) await visit(path);
      else if (e.name.endsWith(".jsonld")) {
        const node = JSON.parse(await readFile(path, "utf8"));
        // context를 inline으로 교체 (외부 fetch 회피)
        node["@context"] = ctxDoc["@context"];
        allNodes.push(node);
      }
    }
  };
  await visit(NODES);

  console.log(`[load] ${allNodes.length} 개 노드 → RDF 변환`);

  // JSON-LD @graph 형태로 묶음
  const graphDoc = {
    "@context": ctxDoc["@context"],
    "@graph": allNodes.map((n) => {
      const obj = n as Record<string, unknown>;
      const { "@context": _, ...rest } = obj;
      return rest;
    }),
  };

  // N-Quads export
  const nquads = await jsonld.toRDF(graphDoc as jsonld.JsonLdDocument, { format: "application/n-quads" });
  const nqPath = resolve(DIST, "safety-graph.nq");
  await writeFile(nqPath, nquads as string, "utf8");
  console.log(`[nquads] ${nqPath} (${(nquads as string).split("\n").length} triples)`);

  // Turtle 직렬화 — n3 라이브러리로 N-Quads → Turtle 변환
  try {
    const N3 = await import("n3");
    const parser = new N3.Parser({ format: "application/n-quads" });
    const writer = new N3.Writer({ format: "text/turtle", prefixes: {
      schema: "https://schema.org/",
      safety: "https://safety.ratelworks.org/vocab#",
      act: "https://safety.ratelworks.org/act/",
      art: "https://safety.ratelworks.org/article/",
      annex: "https://safety.ratelworks.org/annex/",
      doc: "https://safety.ratelworks.org/document/",
      penalty: "https://safety.ratelworks.org/penalty/",
      activity: "https://safety.ratelworks.org/activity/",
      hazard: "https://safety.ratelworks.org/hazard/",
      control: "https://safety.ratelworks.org/control/",
      cyc: "https://safety.ratelworks.org/cycle/",
      applic: "https://safety.ratelworks.org/applicability/",
      equipment: "https://safety.ratelworks.org/equipment/",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      eli: "http://data.europa.eu/eli/ontology#",
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    }});
    const quads = parser.parse(nquads as string);
    writer.addQuads(quads);
    await new Promise<void>((res, rej) => {
      writer.end((err: Error | null, result: string) => {
        if (err) return rej(err);
        const ttlPath = resolve(DIST, "safety-graph.ttl");
        writeFile(ttlPath, result, "utf8").then(() => {
          console.log(`[turtle] ${ttlPath} (${result.split("\n").length} 줄)`);
          res();
        }).catch(rej);
      });
    });
  } catch (e) {
    console.warn(`[turtle] 실패 — ${(e as Error).message}`);
  }

  console.log(`[done] RDF export 완료. Apache Jena/RDFLib/Stardog 등 표준 도구로 활용 가능.`);
})();
