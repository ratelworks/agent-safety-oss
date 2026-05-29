#!/usr/bin/env tsx
/**
 * enrich-graph-iris.ts
 *
 * Document JSON-LD 노드 순회 → _meta.legalBasisRefs 의 텍스트 ref 를
 * article-iri-map.ts 로 IRI 매핑 → Document.legalBasis (정방향 정식) 로 승급.
 *
 * 환각 차단 원칙:
 *   - 실제 Article/Annex 노드가 src/ontology/graph/nodes/ 에 존재하는 IRI 만
 *     Document.legalBasis 에 추가
 *   - 매핑은 가능하나 노드 부재 IRI 는 _meta.predictedLegalBasisIris 에 기록
 *     (사용자/agent 가 추후 노드 작성 시 enrich 재실행 → 자동 승급)
 *   - 매핑 실패 ref 는 _meta.unresolvedLegalBasisRefs 에 기록 (LAW_ALIASES 보강 단서)
 *
 * 사용:
 *   npx tsx scripts/ontology/enrich-graph-iris.ts
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractIrisFromRefs } from "../../src/lib/article-iri-map.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");
const DOCS_DIR = resolve(NODES_DIR, "documents");

// 노드 인덱스 + verificationStatus
async function buildNodeIndex(): Promise<Map<string, { status: string; type: string }>> {
  const idx = new Map<string, { status: string; type: string }>();
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) await visit(full);
      else if (e.name.endsWith(".jsonld")) {
        const node = JSON.parse(await readFile(full, "utf8")) as {
          "@id"?: string;
          "@type"?: string;
          verificationStatus?: string;
        };
        if (node["@id"]) {
          idx.set(node["@id"], {
            status: node.verificationStatus ?? "unknown",
            type: node["@type"] ?? "unknown",
          });
        }
      }
    }
  };
  await visit(NODES_DIR);
  return idx;
}

(async () => {
  const idx = await buildNodeIndex();
  console.log(`[node-index] ${idx.size} 개 IRI 등록됨\n`);

  const docFiles = (await readdir(DOCS_DIR)).filter((f) => f.endsWith(".jsonld"));

  let promoted = 0;
  let stubLinked = 0; // 노드는 있으나 stub
  let predicted = 0;
  let unresolvedTotal = 0;

  for (const file of docFiles) {
    const path = resolve(DOCS_DIR, file);
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      legalBasis?: string[];
      _meta?: Record<string, unknown>;
    };
    const meta = (node._meta ?? {}) as Record<string, unknown>;
    const refs =
      (meta["legalBasisRefs"] as Array<{ law: string; article: string; text: string }>) ?? [];

    if (refs.length === 0) continue;

    const { iris, unresolved } = extractIrisFromRefs(refs);

    // verified vs stub vs missing 3분류 (교차 검증 P0-1 권고: stub은 정식 promoted 아님)
    const verifiedIris: string[] = [];
    const stubIris: string[] = [];
    const missing: string[] = [];
    for (const iri of iris) {
      const meta = idx.get(iri);
      if (!meta) {
        missing.push(iri);
      } else if (meta.status === "verified") {
        verifiedIris.push(iri);
      } else {
        stubIris.push(iri); // stub / unknown
      }
    }

    // 기존 legalBasis (수동 작성된 work-plan-excavation 등) 보존
    const currentLegalBasis = (node.legalBasis as string[] | undefined) ?? [];
    const merged = Array.from(new Set([...currentLegalBasis, ...verifiedIris]));
    if (merged.length > 0) node.legalBasis = merged;

    // 메타 갱신
    node._meta = {
      ...meta,
      stubLinkedIris: stubIris, // 노드 있으나 stub (검증 미완)
      predictedLegalBasisIris: missing,
      unresolvedLegalBasisRefs: unresolved,
      enrichedAt: new Date().toISOString().slice(0, 10),
    };

    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");

    promoted += verifiedIris.length;
    stubLinked += stubIris.length;
    predicted += missing.length;
    unresolvedTotal += unresolved.length;

    console.log(
      `[ok] ${file.padEnd(45)} promoted=${verifiedIris.length} stub=${stubIris.length} predicted=${missing.length} unresolved=${unresolved.length}`,
    );
  }

  console.log(
    `\n[done] promoted=${promoted}, stub=${stubLinked}, predicted=${predicted}, unresolved=${unresolvedTotal}`,
  );
  console.log(
    `         promoted = verified Article/Annex 노드와 매칭. 정방향 legalBasis 정식 등록.`,
  );
  console.log(
    `         stub = 노드는 있으나 verificationStatus=stub. _meta.stubLinkedIris 에만 기록 (legalBasis 미승급, 환각 차단 원칙).`,
  );
  console.log(
    `         predicted = IRI 매핑은 됐으나 노드 부재.`,
  );
  console.log(
    `         unresolved = LAW_ALIASES 또는 article 패턴 미인식.`,
  );
})();
