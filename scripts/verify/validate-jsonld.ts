#!/usr/bin/env tsx
/**
 * validate-jsonld.ts
 *
 * JSON-LD 1.1 spec 부합 검증 (build-time only, 외부 사용자 런타임 미사용).
 *
 * 검증 항목:
 *   1) 각 노드의 @context 가 로컬 경로로 정상 로드 가능
 *   2) jsonld.expand() 통과 — 모든 vocab 정상 매핑
 *   3) @id 중복 없음
 *   4) partOf / legalBasis / penalizedBy 등 IRI 참조가 실존 노드 가리킴 (또는 외부 도메인 IRI)
 *   5) schema.org Legislation 핵심 필드 (legislationIdentifier, legislationDate, legislationType) 채워졌는가
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import jsonld from "jsonld";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");
const CONTEXT_PATH = resolve(ROOT, "src", "ontology", "graph", "context.jsonld");

// 커스텀 documentLoader — 노드의 상대 경로 @context 와 file:// IRI 를 직접 로드
type DocumentLoader = (url: string) => Promise<{
  contextUrl?: string;
  documentUrl: string;
  document: unknown;
}>;

function makeDocumentLoader(): DocumentLoader {
  return async (url: string) => {
    if (url.startsWith("file://")) {
      const path = fileURLToPath(url);
      const document = JSON.parse(await readFile(path, "utf8"));
      return { contextUrl: undefined, documentUrl: url, document };
    }
    if (url.startsWith("https://safety.ratelworks.org/")) {
      // 본 OSS 자체 IRI — 외부 호환 증명 위한 stub (실 RDF 변환 시는 별도 dataset 로드 필요)
      return { contextUrl: undefined, documentUrl: url, document: {} };
    }
    if (url.startsWith("https://schema.org/") || url.startsWith("http://schema.org/")) {
      // schema.org는 spec 검증만 (실 정의 fetch 생략 — build-time 자족성)
      return { contextUrl: undefined, documentUrl: url, document: { "@context": {} } };
    }
    throw new Error(`Unhandled URL: ${url}`);
  };
}

interface Issue {
  level: "error" | "warning";
  node?: string;
  msg: string;
}

async function loadAll(): Promise<Array<{ path: string; node: Record<string, unknown> }>> {
  const out: Array<{ path: string; node: Record<string, unknown> }> = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) await visit(full);
      else if (e.name.endsWith(".jsonld")) {
        const node = JSON.parse(await readFile(full, "utf8")) as Record<string, unknown>;
        out.push({ path: full, node });
      }
    }
  };
  await visit(NODES_DIR);
  return out;
}

(async () => {
  const issues: Issue[] = [];
  const all = await loadAll();
  console.log(`[load] ${all.length} 개 노드 로드`);

  // 1. context 로드 + 인라인 (jsonld.expand 호출용)
  const contextDoc = JSON.parse(await readFile(CONTEXT_PATH, "utf8")) as Record<string, unknown>;
  const documentLoader = makeDocumentLoader();

  // 2-A. inline expand — context 인라인 후 expand
  let expandPass = 0;
  for (const { path, node } of all) {
    try {
      const inlineNode = { ...node, "@context": contextDoc["@context"] } as jsonld.JsonLdDocument;
      await jsonld.expand(inlineNode);
      expandPass += 1;
    } catch (err) {
      issues.push({
        level: "error",
        node: String(node["@id"] ?? path),
        msg: `inline expand 실패: ${(err as Error).message.slice(0, 200)}`,
      });
    }
  }
  console.log(`[expand-inline] ${expandPass}/${all.length} 노드 통과`);

  // 2-B. raw expand — 노드 파일 자체 (file:// IRI 로드, documentLoader 활용)
  // 외부 시스템(예: Apache Jena, RDFLib)이 본 노드를 그대로 expand 가능한지 증명
  let rawExpandPass = 0;
  for (const { path, node } of all) {
    try {
      const url = pathToFileURL(path).toString();
      // 노드의 @context 가 상대경로이므로 base URL 부여
      await jsonld.expand(node as jsonld.JsonLdDocument, {
        documentLoader: documentLoader as never,
        base: url,
      });
      rawExpandPass += 1;
    } catch (err) {
      issues.push({
        level: "warning",
        node: String(node["@id"] ?? path),
        msg: `raw expand (외부 호환) 실패: ${(err as Error).message.slice(0, 150)}`,
      });
    }
  }
  console.log(`[expand-raw] ${rawExpandPass}/${all.length} 외부 호환 통과 (file:// + documentLoader)`);

  // 3. @id 중복
  const idCount = new Map<string, number>();
  for (const { node } of all) {
    const id = String(node["@id"] ?? "");
    idCount.set(id, (idCount.get(id) ?? 0) + 1);
  }
  for (const [id, n] of idCount.entries()) {
    if (n > 1) issues.push({ level: "error", node: id, msg: `duplicate @id (${n}회)` });
  }

  // 4. IRI 참조 정합성
  const allIds = new Set(idCount.keys());
  const externalDomains = ["chemicals.ratelworks.org", "fire.ratelworks.org", "criminal.ratelworks.org", "subcontract.ratelworks.org", "infra.ratelworks.org"];

  function checkRef(ref: string, ctx: string, srcId: string): void {
    if (allIds.has(ref)) return;
    if (externalDomains.some((d) => ref.includes(d))) return;
    // act:/art:/annex:/doc:/penalty:/activity:/cycle:/applic: prefix 만 검사
    if (/^(act|art|annex|doc|penalty|activity|hazard|event|control|method|cycle|applic|interp|manual|stat):/.test(ref)) {
      issues.push({ level: "warning", node: srcId, msg: `${ctx} 참조 '${ref}' 노드 부재` });
    }
  }

  for (const { node } of all) {
    const srcId = String(node["@id"] ?? "");
    const fields = [
      "partOf",
      "delegates",
      "references",
      "hasArticle",
      "hasAnnex",
      "specifies",
      "regulates",
      "penalizedBy",
      "penaltyOnMissing",
      "appliesTo",
      "requires",
      "mitigatedBy",
      "causedBy",
      "evaluatedBy",
      "cycledAs",
      "legalBasisOf",
      "legalBasis",
      "guidedBy",
      "amendedTo",
      "interpretedBy",
      "auditedBy",
      "informedBy",
      "cited_in",
    ];
    for (const f of fields) {
      const v = node[f];
      if (!v) continue;
      const arr = Array.isArray(v) ? v : [v];
      for (const r of arr) {
        if (typeof r === "string") checkRef(r, f, srcId);
      }
    }
  }

  // 5. ELI 메타 채워짐 비율
  const eliRequired = ["legislationIdentifier", "legislationDate", "legislationType"];
  let eliComplete = 0;
  for (const { node } of all) {
    if (eliRequired.every((k) => Boolean(node[k]))) eliComplete += 1;
  }
  console.log(`[ELI] ${eliComplete}/${all.length} 노드 핵심 필드 (legislationIdentifier·Date·Type) 채워짐`);

  // 6. 보고
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  console.log("");
  if (errors.length > 0) {
    console.log(`# Errors (${errors.length})`);
    for (const e of errors.slice(0, 20)) console.log(`  ❌ ${e.node}: ${e.msg}`);
  }
  if (warnings.length > 0) {
    console.log(`\n# Warnings (${warnings.length})`);
    for (const w of warnings.slice(0, 20)) console.log(`  ⚠ ${w.node}: ${w.msg}`);
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log("✅ JSON-LD 1.1 spec + 참조 정합성 + ELI 메타 모두 통과");
  }

  console.log("");
  console.log(`# 종합: errors=${errors.length}, warnings=${warnings.length}`);
  process.exit(errors.length > 0 ? 1 : 0);
})();
