#!/usr/bin/env tsx
/**
 * 운영 온톨로지 프로파일 검증.
 *
 * 목적:
 * - Semantic Layer: ObjectType/LinkType 이 현재 그래프 규모와 연결성을 만족하는지 확인
 * - Kinetic Layer: ActionType 이 실제 MCP tool 과 연결되고 lineage 정책을 갖는지 확인
 * - Dynamic Layer: LLM 하네스가 그래프 사실을 생성하지 않도록 정책이 정의됐는지 확인
 *
 * 이 검증은 전체 JSON-LD publish gate(audit:expand)를 대체하지 않는다.
 * 운영 활용 준비도를 빠르게 점수화하는 별도 gate 이다.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";
import { TOOLS } from "../../src/tool-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const PROFILE_PATH = resolve(ROOT, "src", "ontology", "operational", "profile.jsonld");
const GRAPH_NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes");
const SKELETON_ACTIONS_PATH = resolve(ROOT, "src", "ontology", "skeleton", "actions.jsonld");
const REPORT_PATH = resolve(ROOT, "artifacts", "test-results", "core", "operational-ontology-report.json");

type JsonObject = Record<string, unknown>;

interface GraphNode extends JsonObject {
  "@id"?: string;
  "@type"?: string | string[];
  _file?: string;
  _category?: string;
}

interface CheckResult {
  ok: boolean;
  label: string;
  expected?: unknown;
  actual?: unknown;
  details?: unknown;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function typeList(node: JsonObject): string[] {
  return asArray(node["@type"] as string | string[] | undefined).filter((v): v is string => typeof v === "string");
}

function hasType(node: JsonObject, typeName: string): boolean {
  return typeList(node).includes(typeName);
}

function literalString(node: JsonObject, key: string): string | undefined {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
}

function literalNumber(node: JsonObject, key: string): number {
  const value = node[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function literalBoolean(node: JsonObject, key: string): boolean {
  return node[key] === true;
}

function idOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const id = (value as JsonObject)["@id"];
    if (typeof id === "string") return id;
  }
  return undefined;
}

async function walkFiles(dir: string, suffix: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      await walkFiles(full, suffix, out);
    } else if (entry.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out;
}

async function loadProfile(): Promise<JsonObject[]> {
  const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8")) as JsonObject;
  await jsonld.expand(profile);
  return asArray(profile["@graph"] as JsonObject[] | undefined);
}

async function loadGraphNodes(): Promise<GraphNode[]> {
  const files = await walkFiles(GRAPH_NODES_DIR, ".jsonld");
  const nodes: GraphNode[] = [];
  for (const file of files) {
    try {
      const node = JSON.parse(await readFile(file, "utf8")) as GraphNode;
      const rel = relative(GRAPH_NODES_DIR, file);
      node._file = file;
      node._category = rel.split("/")[0];
      nodes.push(node);
    } catch {
      // 기존 감사 스크립트가 parse error를 별도로 다룬다. 여기서는 운영 프로파일 평가만 계속한다.
    }
  }
  return nodes;
}

async function loadSkeletonActionCount(): Promise<number> {
  const raw = JSON.parse(await readFile(SKELETON_ACTIONS_PATH, "utf8")) as JsonObject;
  const graph = asArray(raw["@graph"] as JsonObject[] | undefined);
  return graph.filter((node) => hasType(node, "safety:Action")).length;
}

function countEdges(nodes: GraphNode[], predicate: string): number {
  const normalized = predicate.includes(":") ? predicate.split(":").at(-1)! : predicate;
  let count = 0;
  for (const node of nodes) {
    const value = node[predicate] ?? node[normalized];
    if (Array.isArray(value)) {
      count += value.length;
    } else if (typeof value === "string") {
      count += 1;
    } else if (value && typeof value === "object") {
      count += 1;
    }
  }
  return count;
}

function summarize(results: CheckResult[]) {
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  return {
    total,
    passed,
    failed: total - passed,
    score: total === 0 ? 0 : Math.round((passed / total) * 100),
  };
}

function printSection(title: string, results: CheckResult[]) {
  const summary = summarize(results);
  console.log(`\n[${title}] ${summary.passed}/${summary.total} (${summary.score}점)`);
  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    const actual = result.actual !== undefined ? ` actual=${JSON.stringify(result.actual)}` : "";
    const expected = result.expected !== undefined ? ` expected=${JSON.stringify(result.expected)}` : "";
    console.log(`  ${mark} ${result.label}${actual}${expected}`);
  }
}

async function main() {
  const profileNodes = await loadProfile();
  const graphNodes = await loadGraphNodes();
  const toolNames = new Set(TOOLS.map((tool) => tool.name));
  const skeletonActionCount = await loadSkeletonActionCount();

  const categoryCounts = new Map<string, number>();
  for (const node of graphNodes) {
    const category = node._category ?? "unknown";
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  const objectTypes = profileNodes.filter((node) => hasType(node, "safety:ObjectType"));
  const linkTypes = profileNodes.filter((node) => hasType(node, "safety:LinkType"));
  const actionTypes = profileNodes.filter((node) => hasType(node, "safety:ActionType"));
  const evidenceTypes = profileNodes.filter((node) => hasType(node, "safety:EvidenceType"));
  const policies = profileNodes.filter((node) => hasType(node, "safety:HarnessPolicy"));

  const semanticObjectChecks: CheckResult[] = objectTypes.map((node) => {
    const source = literalString(node, "safety:sourceCategory") ?? "";
    const min = literalNumber(node, "safety:minGraphNodes");
    const actual = categoryCounts.get(source) ?? 0;
    return {
      ok: actual >= min,
      label: `${node["@id"]} source=${source}`,
      actual,
      expected: `>=${min}`,
    };
  });

  const semanticLinkChecks: CheckResult[] = linkTypes
    .filter((node) => literalString(node, "safety:implementationStatus") === "implemented")
    .map((node) => {
      const predicate = literalString(node, "safety:implementedByPredicate") ?? "";
      const min = literalNumber(node, "safety:minimumEdgeCount");
      const actual = countEdges(graphNodes, predicate);
      return {
        ok: actual >= min,
        label: `${node["@id"]} predicate=${predicate}`,
        actual,
        expected: `>=${min}`,
      };
    });

  const kineticChecks: CheckResult[] = actionTypes.map((node) => {
    const toolName = literalString(node, "safety:implementedByTool") ?? "";
    const reads = asArray(node["safety:readsObjectType"]).map(idOf).filter(Boolean);
    const produces = asArray(node["safety:producesObjectType"]).map(idOf).filter(Boolean);
    const hasLineage = literalBoolean(node, "safety:requiresLineage");
    const ok = toolNames.has(toolName) && reads.length > 0 && produces.length > 0 && hasLineage;
    return {
      ok,
      label: `${node["@id"]} tool=${toolName}`,
      actual: {
        toolExists: toolNames.has(toolName),
        reads: reads.length,
        produces: produces.length,
        requiresLineage: hasLineage,
      },
      expected: "tool + reads + produces + lineage",
    };
  });

  kineticChecks.push({
    ok: skeletonActionCount >= 19,
    label: "skeleton Action contract count",
    actual: skeletonActionCount,
    expected: ">=19",
  });

  const dynamicPolicyIds = new Set(policies.map((node) => String(node["@id"])));
  const requiredPolicies = [
    "safety:policy/no_generated_legal_basis",
    "safety:policy/cite_graph_sources",
    "safety:policy/ask_missing_required_fields",
    "safety:policy/human_fallback_threshold",
  ];
  const dynamicChecks: CheckResult[] = requiredPolicies.map((id) => ({
    ok: dynamicPolicyIds.has(id),
    label: id,
    actual: dynamicPolicyIds.has(id),
    expected: true,
  }));
  dynamicChecks.push({
    ok: evidenceTypes.length >= 3,
    label: "EvidenceType coverage",
    actual: evidenceTypes.length,
    expected: ">=3",
  });

  const standardsChecks: CheckResult[] = [
    {
      ok: profileNodes.length > 0,
      label: "profile JSON-LD expand",
      actual: profileNodes.length,
      expected: ">0 graph nodes",
    },
    {
      ok: graphNodes.length >= 3000,
      label: "full graph available",
      actual: graphNodes.length,
      expected: ">=3000 nodes",
    },
  ];

  const sections = {
    standards: standardsChecks,
    semanticObjects: semanticObjectChecks,
    semanticLinks: semanticLinkChecks,
    kinetic: kineticChecks,
    dynamic: dynamicChecks,
  };

  console.log("=".repeat(72));
  console.log("Operational Ontology Profile Verification");
  console.log("=".repeat(72));
  console.log(`profile: ${relative(ROOT, PROFILE_PATH)}`);
  console.log(`graph nodes: ${graphNodes.length}`);
  console.log(`tool names: ${toolNames.size}`);
  console.log(`skeleton action contracts: ${skeletonActionCount}`);

  printSection("Standards", sections.standards);
  printSection("Semantic Object Types", sections.semanticObjects);
  printSection("Semantic Link Types", sections.semanticLinks);
  printSection("Kinetic Action Types", sections.kinetic);
  printSection("Dynamic Harness Contract", sections.dynamic);

  const allResults = Object.values(sections).flat();
  const overall = summarize(allResults);
  const failed = allResults.filter((r) => !r.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    profilePath: relative(ROOT, PROFILE_PATH),
    graphNodes: graphNodes.length,
    toolNames: toolNames.size,
    skeletonActionCount,
    categoryCounts: Object.fromEntries([...categoryCounts.entries()].sort()),
    sections: Object.fromEntries(
      Object.entries(sections).map(([name, results]) => [name, { ...summarize(results), results }]),
    ),
    overall,
    failed,
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("\n" + "=".repeat(72));
  console.log(`Overall: ${overall.passed}/${overall.total} (${overall.score}점)`);
  console.log(`Report: ${relative(ROOT, REPORT_PATH)}`);
  console.log("=".repeat(72));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
