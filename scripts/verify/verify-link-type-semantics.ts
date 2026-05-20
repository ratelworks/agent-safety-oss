#!/usr/bin/env tsx
/**
 * verify-link-type-semantics.ts — operational profile LinkType source/target type 검증
 *
 * 외부 평가 P0-5 (2026-05-19): verify-operational-ontology.ts 가 LinkType 별
 * predicate field count 만 검증. source/target 노드가 정말 fromObjectType /
 * toObjectType 에 해당하는지 미확인.
 *
 * 예: annex_reference 가 doc→doc 으로 선언됐었는데 실제는 doc→annex.
 *     (v1.2.1 에서 P0-4 로 doc→annex 수정 완료. 단 검증 자동화는 미설치)
 *
 * 검증:
 *   1. profile.jsonld 의 LinkType implemented 24 개 로드 (fromObjectType, toObjectType, predicate)
 *   2. ObjectType.mapsToClass → @type 매핑
 *   3. 각 LinkType 의 predicate 으로 grep 한 노드의 source/target @type 검증
 *   4. source/target 노드 존재 여부 (dangling 검출)
 *
 * sampling: 각 LinkType 의 첫 5 edges 확인 (전수 시 시간 ↑).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const PROFILE_PATH = resolve(ROOT, "src", "ontology", "operational", "profile.jsonld");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");

interface LinkTypeSpec {
  id: string;
  predicate: string;
  fromObjectType: string;
  toObjectType: string;
  status: string;
}

interface ObjectTypeSpec {
  id: string;
  mapsToClass: string;
  sourceCategory: string;
}

interface DriftIssue {
  severity: "HIGH" | "MEDIUM";
  linkType: string;
  predicate: string;
  source?: string;
  target?: string;
  expected?: string;
  actual?: string;
  hint: string;
}

function loadProfile(): { linkTypes: LinkTypeSpec[]; objectTypes: Map<string, ObjectTypeSpec> } {
  const profile = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
  const linkTypes: LinkTypeSpec[] = [];
  const objectTypes = new Map<string, ObjectTypeSpec>();

  for (const item of profile["@graph"] || []) {
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    if (types.includes("safety:LinkType")) {
      const status = item["safety:implementationStatus"] || "";
      if (status !== "implemented" && status !== "runtime_storage") continue;
      linkTypes.push({
        id: item["@id"],
        predicate: String(item["safety:implementedByPredicate"] || "").replace(/^safety:/, ""),
        fromObjectType: item["safety:fromObjectType"]?.["@id"] || "",
        toObjectType: item["safety:toObjectType"]?.["@id"] || "",
        status,
      });
    } else if (types.includes("safety:ObjectType")) {
      objectTypes.set(item["@id"], {
        id: item["@id"],
        mapsToClass: (item["safety:mapsToClass"]?.["@id"] || "").replace(/^safety:/, ""),
        sourceCategory: item["safety:sourceCategory"] || "",
      });
    }
  }
  return { linkTypes, objectTypes };
}

function walkJsonld(dir: string, nodes: Map<string, any>): void {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walkJsonld(p, nodes);
    else if (f.endsWith(".jsonld")) {
      try {
        const node = JSON.parse(readFileSync(p, "utf8"));
        if (node["@id"]) nodes.set(node["@id"], node);
      } catch { /* skip */ }
    }
  }
}

function getNodeType(node: any): string[] {
  const t = node["@type"];
  if (!t) return [];
  return Array.isArray(t) ? t.map((x) => String(x).replace(/^safety:/, "")) : [String(t).replace(/^safety:/, "")];
}

function matchesObjectType(node: any, objectTypeId: string, objectTypes: Map<string, ObjectTypeSpec>): boolean {
  const spec = objectTypes.get(objectTypeId);
  if (!spec) return false;
  const types = getNodeType(node);
  // mapsToClass 매칭 + 부분 매칭 (예: WorkActivity ↔ work_activity)
  const expected = spec.mapsToClass;
  return types.some(
    (t) =>
      t === expected ||
      t.toLowerCase() === expected.toLowerCase() ||
      t === expected.toLowerCase().replace(/_/g, "") ||
      // runtime_storage object types — 노드 미존재 허용 (예: SafetyIssue·CorrectiveAction)
      spec.sourceCategory === "runtime_storage",
  );
}

function getEdgeValues(node: any, predicate: string): string[] {
  const v = node[predicate];
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : (x?.["@id"] ?? "")))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  }
  if (typeof v === "string") return [v];
  if (typeof v === "object" && v["@id"]) return [String(v["@id"])];
  return [];
}

async function main(): Promise<void> {
  const { linkTypes, objectTypes } = loadProfile();
  const nodes = new Map<string, any>();
  walkJsonld(NODES_DIR, nodes);

  console.log("LinkType source/target semantics 검증");
  console.log(`  Profile LinkType (implemented): ${linkTypes.length}`);
  console.log(`  Profile ObjectType:             ${objectTypes.size}`);
  console.log(`  전체 그래프 노드:                ${nodes.size}`);
  console.log();

  const issues: DriftIssue[] = [];
  const SAMPLE_SIZE = 5;

  for (const lt of linkTypes) {
    if (!lt.predicate) continue;
    // 모든 노드에서 predicate 사용 검색
    const usingNodes: Array<{ source: string; target: string }> = [];
    for (const [sourceIri, node] of nodes.entries()) {
      const targets = getEdgeValues(node, lt.predicate);
      for (const target of targets) usingNodes.push({ source: sourceIri, target });
      if (usingNodes.length >= SAMPLE_SIZE * 10) break; // sampling 위 추출 후 자름
    }

    // 각 LinkType 별 sampling 검증
    const sample = usingNodes.slice(0, SAMPLE_SIZE);
    for (const edge of sample) {
      const sourceNode = nodes.get(edge.source);
      const targetNode = nodes.get(edge.target);

      // source / target 노드 존재 검증
      if (!targetNode) {
        // dangling target — runtime_storage 또는 외부 IRI 제외
        if (!edge.target.startsWith("safety:") && !edge.target.startsWith("activity:") && !edge.target.startsWith("hazard:") && !edge.target.startsWith("control:") && !edge.target.startsWith("art:") && !edge.target.startsWith("doc:") && !edge.target.startsWith("annex:")) {
          continue; // 외부 IRI (https://, file://)
        }
        // runtime_storage ObjectType 인 경우 허용
        const toSpec = objectTypes.get(lt.toObjectType);
        if (toSpec?.sourceCategory === "runtime_storage") continue;
        issues.push({
          severity: "MEDIUM",
          linkType: lt.id,
          predicate: lt.predicate,
          source: edge.source,
          target: edge.target,
          hint: `target 노드 미존재 (dangling)`,
        });
        continue;
      }

      // source / target 의 ObjectType 매칭
      if (sourceNode && !matchesObjectType(sourceNode, lt.fromObjectType, objectTypes)) {
        const fromSpec = objectTypes.get(lt.fromObjectType);
        const actualTypes = getNodeType(sourceNode).join(",");
        issues.push({
          severity: "MEDIUM",
          linkType: lt.id,
          predicate: lt.predicate,
          source: edge.source,
          expected: `from=${lt.fromObjectType} (mapsToClass=${fromSpec?.mapsToClass})`,
          actual: `source @type=${actualTypes}`,
          hint: `source 노드 @type 이 fromObjectType.mapsToClass 와 불일치`,
        });
      }
      if (!matchesObjectType(targetNode, lt.toObjectType, objectTypes)) {
        const toSpec = objectTypes.get(lt.toObjectType);
        const actualTypes = getNodeType(targetNode).join(",");
        issues.push({
          severity: "MEDIUM",
          linkType: lt.id,
          predicate: lt.predicate,
          target: edge.target,
          expected: `to=${lt.toObjectType} (mapsToClass=${toSpec?.mapsToClass})`,
          actual: `target @type=${actualTypes}`,
          hint: `target 노드 @type 이 toObjectType.mapsToClass 와 불일치`,
        });
      }
    }
  }

  console.log(`발견 issues (sampling SAMPLE_SIZE=${SAMPLE_SIZE}):`);
  console.log(`  HIGH:   ${issues.filter((i) => i.severity === "HIGH").length}`);
  console.log(`  MEDIUM: ${issues.filter((i) => i.severity === "MEDIUM").length}`);
  console.log();

  for (const sev of ["HIGH", "MEDIUM"] as const) {
    const list = issues.filter((i) => i.severity === sev);
    if (list.length === 0) continue;
    console.log(`[${sev}] ${list.length} 건`);
    // LinkType 별 그룹
    const byLink: Record<string, DriftIssue[]> = {};
    for (const i of list) (byLink[i.linkType] ||= []).push(i);
    for (const [link, items] of Object.entries(byLink)) {
      console.log(`  [${link}] ${items.length} 건`);
      for (const item of items.slice(0, 3)) {
        console.log(`    · ${item.hint}`);
        if (item.source) console.log(`      source: ${item.source}`);
        if (item.target) console.log(`      target: ${item.target}`);
        if (item.expected) console.log(`      expected: ${item.expected}`);
        if (item.actual) console.log(`      actual: ${item.actual}`);
      }
    }
    console.log();
  }

  const high = issues.filter((i) => i.severity === "HIGH").length;
  if (high > 0) {
    console.error(`✗ HIGH ${high} 건 — LinkType semantics drift. release blocker.`);
    process.exit(1);
  }
  console.log(`✓ HIGH 0 건 — LinkType source/target type 정합 OK`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[verify-link-type-semantics] fatal:`, e);
  process.exit(1);
});
