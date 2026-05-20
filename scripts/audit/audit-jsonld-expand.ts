#!/usr/bin/env tsx
/**
 * 진본 W3C JSON-LD 1.1 expand 기반 검증 (jsonld.js)
 *
 * audit-v2 의 simulation 한계 보완:
 *   - 실제 expand 알고리즘으로 IRI/literal 분류
 *   - dropped property 감지 (term 미정의 또는 misconfigured)
 *   - dangling IRI 감지 (expand 후 IRI 형식이지만 nodes 에 없음)
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";
import { mapWithConcurrency } from "../../src/lib/concurrency.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "src/ontology/graph");
const NODES = resolve(ROOT, "nodes");
const CTX_PATH = resolve(ROOT, "context.jsonld");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const f of await readdir(dir)) {
    const p = resolve(dir, f);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}

async function main() {
  const ctxRaw = JSON.parse(await readFile(CTX_PATH, "utf-8"));
  const ctxKeys = new Set(Object.keys(ctxRaw["@context"]));

  const paths = await walk(NODES);
  const allIds = new Set<string>();
  const documentLoader = (url: string) => {
    if (url.endsWith("context.jsonld")) {
      return Promise.resolve({ contextUrl: undefined as any, document: ctxRaw, documentUrl: url });
    }
    return Promise.resolve({ contextUrl: undefined as any, document: {}, documentUrl: url });
  };

  // 1차 — 모든 @id 수집
  for (const p of paths) {
    try {
      const n = JSON.parse(await readFile(p, "utf-8"));
      if (n["@id"]) allIds.add(n["@id"]);
    } catch {}
  }
  console.log(`[load] ${paths.length} 파일 / ${allIds.size} 노드`);

  // 2차 — 전수 expand 검증 (publish gate)
  const samplePaths = paths;
  console.log(`[expand] 전수 ${paths.length} 노드 검증 시작...`);

  let danglingExpanded = 0;
  const danglingSamples: string[] = [];
  let droppedKeys: Record<string, number> = {};
  const droppedSamples: Record<string, string[]> = {};
  let expandErrors = 0;

  // 전수 IRI → CURIE 역변환을 위한 prefix 인덱스
  const prefixIris: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(ctxRaw["@context"])) {
    if (typeof v === "string" && /^https?:\/\//.test(v as string)) prefixIris.push([k, v as string]);
  }
  prefixIris.sort((a, b) => b[1].length - a[1].length); // longest first
  function toCurie(iri: string): string | null {
    for (const [pf, root] of prefixIris) if (iri.startsWith(root)) return `${pf}:${iri.substring(root.length)}`;
    return null;
  }

  function resolveCurie(curie: string): string {
    return resolveCurieWithContext(curie, ctxRaw["@context"]);
  }

  function resolveCurieWithContext(curie: string, context: Record<string, any>): string {
    if (curie.startsWith("http")) return curie;
    const colon = curie.indexOf(":");
    if (colon === -1) return curie;
    const pf = curie.substring(0, colon);
    const suf = curie.substring(colon + 1);
    const pfDef = context[pf];
    if (typeof pfDef === "string" && /^https?:\/\//.test(pfDef)) return pfDef + suf;
    return curie;
  }

  function isVocabularyRef(curie: string): boolean {
    return (
      /^safety:[A-Z]/.test(curie) ||
      curie.startsWith("safety:schema/") ||
      curie.startsWith("safety:action/") ||
      curie.startsWith("safety:agent/") ||
      curie.startsWith("cc:")
    );
  }

  function mergedContextForNode(node: any): Record<string, any> {
    const merged: Record<string, any> = { ...ctxRaw["@context"] };
    const local = node?.["@context"];
    const items = Array.isArray(local) ? local : [local];
    for (const item of items) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        Object.assign(merged, item);
      }
    }
    return merged;
  }

  // 전수 expand 병렬 (mapWithConcurrency) — 25–45s → 5–10s
  await mapWithConcurrency(samplePaths, 16, async (p) => {
    let node: any;
    try {
      node = JSON.parse(await readFile(p, "utf-8"));
    } catch { return; }
    const inputKeys = new Set(Object.keys(node).filter(k => !k.startsWith("@")));
    const nodeContext = mergedContextForNode(node);
    let expanded: any;
    try {
      expanded = await jsonld.expand(node, { documentLoader: documentLoader as any });
    } catch { expandErrors++; return; }
    if (!Array.isArray(expanded) || expanded.length === 0) return;
    const out = expanded[0] as any;
    const outIris = new Set(Object.keys(out).filter(k => k.startsWith("http")));

    for (const k of inputKeys) {
      const def = nodeContext[k];
      const inputVal = node[k];
      if (inputVal === undefined || inputVal === null || (Array.isArray(inputVal) && inputVal.length === 0)) continue;
      let expectedIri: string | undefined;
      if (typeof def === "string") expectedIri = resolveCurieWithContext(def, nodeContext);
      else if (typeof def === "object" && def && def["@id"]) expectedIri = resolveCurieWithContext(def["@id"], nodeContext);
      if (expectedIri && expectedIri.startsWith("http") && !outIris.has(expectedIri)) {
        droppedKeys[k] = (droppedKeys[k] ?? 0) + 1;
        droppedSamples[k] ??= [];
        if (droppedSamples[k].length < 3) droppedSamples[k].push(String(node["@id"] ?? p));
      }
    }

    for (const [, valArr] of Object.entries(out)) {
      if (!Array.isArray(valArr)) continue;
      for (const v of valArr) {
        if (v && typeof v === "object" && (v as any)["@id"] && typeof (v as any)["@id"] === "string") {
          const id = (v as any)["@id"];
          if (!id.startsWith("http")) continue;
          const curie = toCurie(id);
          if (curie && !allIds.has(curie) && !isVocabularyRef(curie)) {
            danglingExpanded++;
            if (danglingSamples.length < 10) danglingSamples.push(`${node["@id"]} → ${curie}`);
          }
        }
      }
    }
  });

  console.log(`\n[전수 expand] ${samplePaths.length} 노드 검증`);
  console.log(`  dangling IRI:    ${danglingExpanded}건`);
  if (danglingSamples.length) for (const s of danglingSamples) console.log(`    · ${s}`);
  if (Object.keys(droppedKeys).length > 0) {
    console.log("  ⚠ dropped/misexpanded keys:");
    for (const [k, c] of Object.entries(droppedKeys).sort((a,b)=>b[1]-a[1]).slice(0, 10)) {
      console.log(`    ${k}: ${c}회`);
      for (const sample of droppedSamples[k] ?? []) console.log(`      · ${sample}`);
    }
  } else {
    console.log("  ✓ dropped key 없음");
  }
  console.log(`  expand 에러:     ${expandErrors}건`);

  // publish gate — fail fast
  if (danglingExpanded > 0 || Object.keys(droppedKeys).length > 0 || expandErrors > 0) {
    console.error("\n✗ 진본 expand 검증 실패 — 배포 차단");
    process.exit(1);
  }

  // 3차 — context.jsonld 자체 expand 가능?
  try {
    await jsonld.expand({ "@context": ctxRaw["@context"], "@id": "test:_validation_probe" }, { documentLoader: documentLoader as any });
    console.log("✓ context.jsonld expand 성공");
  } catch (e) {
    console.log("✗ context.jsonld expand 실패:", (e as Error).message);
  }

  // 4차 — 핵심 의무문서 5개 expand 후 IRI 보존 확인
  const targets = [
    "src/ontology/graph/nodes/documents/work-plan-excavation.jsonld",
    "src/ontology/graph/nodes/documents/severe-accident-immediate-report.jsonld",
    "src/ontology/graph/nodes/documents/msds-register.jsonld",
    "src/ontology/graph/nodes/articles/산안법-§54.jsonld",
    "src/ontology/graph/nodes/hazards/cave_in.jsonld",
  ];
  console.log(`\n[핵심 노드 IRI 보존 검증]`);
  for (const t of targets) {
    const path = resolve(__dirname, "..", "..", t);
    try {
      const n = JSON.parse(await readFile(path, "utf-8"));
      const ex = await jsonld.expand(n, { documentLoader: documentLoader as any });
      const out = ex[0] as any;
      const id = out["@id"];
      const types = out["@type"] ?? [];
      const predicateCount = Object.keys(out).filter(k => k.startsWith("http")).length;
      console.log(`  ${id}: types=${(types as string[]).length}, predicates=${predicateCount}`);
    } catch (e) {
      console.log(`  ${t}: ERROR — ${(e as Error).message}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
