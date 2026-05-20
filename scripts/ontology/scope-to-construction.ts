#!/usr/bin/env tsx
/**
 * scope-to-construction.ts
 *
 * 도메인을 건설안전으로 좁힘. scope.json 기준.
 *
 *  1. 비건설 활동 4개 (industrial_machinery / electrical_facility / occupational_health / process_safety)
 *     → 노드 파일 삭제 + article.regulates 에서 제거
 *  2. KOSHA 1039 가이드 도메인 분류:
 *     · construction       — C/D/D-C/C-C
 *     · general_applicable — A/G/X
 *     · construction_partial — E-G/T
 *     · out_of_domain      — B-M/B-E/H/P/M/O/W
 *     → 가이드 노드 _meta.scope 표기
 *  3. prefix-fallback edge 모두 제거
 *     · 건설 가이드(construction + general_applicable + construction_partial) 의 의미 매칭만 보존
 *     · out_of_domain 가이드는 어떤 활동에도 묶이지 않음 → guidedBy in-edge 0
 *     · 정직 표기: 검색 시 _meta.scope 로 도메인 외 명시
 */
import { readFile, readdir, writeFile, unlink, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ACTIVITIES = resolve(NODES, "activities");
const ARTICLES = resolve(NODES, "articles");
const HAZARDS = resolve(NODES, "hazards");
const GUIDES = resolve(NODES, "documents", "guides");
const SCOPE_PATH = resolve(ROOT, "src", "ontology", "scope.json");

interface Scope {
  excludedActivities: string[];
  koshaGuide: { categoryMapping: Record<string, string[]> };
}

function classifyGuide(guideNo: string): "construction" | "general_applicable" | "construction_partial" | "out_of_domain" {
  if (/^C-C/.test(guideNo) || /^D-C/.test(guideNo)) return "construction";
  if (/^C-/.test(guideNo) || /^D-/.test(guideNo)) return "construction";
  if (/^[CD]\d/.test(guideNo) || /^[CD]-\d/.test(guideNo)) return "construction";
  if (/^A-G/.test(guideNo) || /^A-R/.test(guideNo) || /^A-/.test(guideNo)) return "general_applicable";
  if (/^G-/.test(guideNo) || /^G\d/.test(guideNo)) return "general_applicable";
  if (/^X-/.test(guideNo) || /^X\d/.test(guideNo)) return "general_applicable";
  if (/^E-G/.test(guideNo)) return "construction_partial";
  if (/^T-/.test(guideNo) || /^T\d/.test(guideNo)) return "construction_partial";
  if (/^[BHPMOW]/.test(guideNo)) return "out_of_domain";
  if (/^E-/.test(guideNo) || /^E\d/.test(guideNo)) return "out_of_domain";
  return "out_of_domain";
}

(async () => {
  const scope = JSON.parse(await readFile(SCOPE_PATH, "utf8")) as Scope;

  // ─── 1. 비건설 활동 4개 노드 파일 삭제 ───
  const excluded = new Set(scope.excludedActivities);
  let removedActivityFiles = 0;
  for (const f of await readdir(ACTIVITIES)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(ACTIVITIES, f);
    const node = JSON.parse(await readFile(p, "utf-8")) as { "@id"?: string };
    if (node["@id"] && excluded.has(node["@id"])) {
      await unlink(p);
      removedActivityFiles++;
    }
  }
  console.log(`[remove] 비건설 활동 ${removedActivityFiles} 노드 삭제`);

  // ─── 2. articles 의 regulates / hasHazard 등에서 제외 활동 IRI 제거 ───
  let articlesFixed = 0;
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(ARTICLES, f);
    let node = JSON.parse(await readFile(p, "utf-8")) as Record<string, unknown>;
    let changed = false;
    for (const prop of ["regulates", "hasHazard"]) {
      const v = node[prop];
      if (Array.isArray(v)) {
        const filtered = (v as string[]).filter(x => !excluded.has(x));
        if (filtered.length !== v.length) { node[prop] = filtered; changed = true; }
      }
    }
    if (changed) { await writeFile(p, JSON.stringify(node, null, 2) + "\n"); articlesFixed++; }
  }
  console.log(`[fix] article 노드 ${articlesFixed} 개 — 제외 활동 참조 제거`);

  // ─── 3. KOSHA 가이드 도메인 분류 + _meta.scope 표기 ───
  const guideFiles = await readdir(GUIDES);
  const stats = { construction: 0, general_applicable: 0, construction_partial: 0, out_of_domain: 0 };
  const guideScope = new Map<string, string>();  // iri → scope
  for (const f of guideFiles) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(GUIDES, f);
    const node = JSON.parse(await readFile(p, "utf-8")) as Record<string, unknown> & { _meta?: { guideNo?: string; scope?: string } };
    const guideNo = String(node._meta?.guideNo ?? "");
    const cls = classifyGuide(guideNo);
    stats[cls]++;
    guideScope.set(node["@id"] as string, cls);
    // _meta 형 시그니처는 {guideNo?, scope?} 로 좁혀져 있어 scopeNote 추가는 인덱스 시그니처 캐스팅.
    const meta = (node._meta ?? {}) as Record<string, unknown>;
    meta.scope = cls;
    if (cls === "out_of_domain") {
      meta.scopeNote = "건설안전 도메인 외 — 별도 산업분야 OSS 대상 (agent-machinery-safety/agent-process-safety 등 미래 분리)";
    }
    node._meta = meta as typeof node._meta;
    await writeFile(p, JSON.stringify(node, null, 2) + "\n");
  }
  console.log(`[classify] KOSHA 1039 분류: construction=${stats.construction}, general_applicable=${stats.general_applicable}, construction_partial=${stats.construction_partial}, out_of_domain=${stats.out_of_domain}`);

  // ─── 4. activity / hazard 의 guidedBy 에서 out_of_domain 가이드 제거 ───
  let actCleaned = 0, hazCleaned = 0;
  for (const f of await readdir(ACTIVITIES)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(ACTIVITIES, f);
    const node = JSON.parse(await readFile(p, "utf-8")) as Record<string, unknown>;
    const cur = (node.guidedBy as string[] | undefined) ?? [];
    const filtered = cur.filter(g => guideScope.get(g) !== "out_of_domain");
    if (filtered.length !== cur.length) {
      node.guidedBy = filtered;
      await writeFile(p, JSON.stringify(node, null, 2) + "\n");
      actCleaned++;
    }
  }
  for (const f of await readdir(HAZARDS)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(HAZARDS, f);
    const node = JSON.parse(await readFile(p, "utf-8")) as Record<string, unknown>;
    const cur = (node.guidedBy as string[] | undefined) ?? [];
    const filtered = cur.filter(g => guideScope.get(g) !== "out_of_domain");
    if (filtered.length !== cur.length) {
      node.guidedBy = filtered;
      await writeFile(p, JSON.stringify(node, null, 2) + "\n");
      hazCleaned++;
    }
  }
  console.log(`[clean] out_of_domain 가이드 제거: activity ${actCleaned}, hazard ${hazCleaned}`);

  console.log(`\n=== 최종 도메인 cover ===`);
  console.log(`건설 직접:   ${stats.construction} 가이드`);
  console.log(`건설 적용 가능: ${stats.general_applicable} 가이드`);
  console.log(`건설 부분적: ${stats.construction_partial} 가이드`);
  console.log(`도메인 외:   ${stats.out_of_domain} 가이드 (별도 산업 OSS 대상)`);
  console.log(`건설 도메인 분모: ${stats.construction + stats.general_applicable + stats.construction_partial} 가이드`);
})();
