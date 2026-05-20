#!/usr/bin/env node
// prepublish essence gate 9개 — PLAN §2 본질 검증 자동 차단.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GRAPH_CHECK_SCRIPT = "scripts/dev/skeleton-graph-check.ts";
const TEXT_EXTENSIONS = new Set([".json", ".jsonld", ".ttl", ".md", ".ts"]);
const LEGACY_IRI_PATTERNS = ["vocab#", "class/"];
const CONTEXT_ALIASES = ["Activity", "Control", "Hazard", "Article", "Document", "Action"];
const KOSHA_GUIDES_DIR = "src/ontology/graph/nodes/documents/guides";
const RESOURCE_FILE = "src/resources/skeleton-context.ts";
const INDEX_FILE = "src/index.ts";
const ACTIONS_FILE = "src/ontology/skeleton/actions.jsonld";
const HARNESS_DIR = "tests/harness";
// 메인 지원 host = Claude Desktop · Codex CLI 2종 + inspector)
const HARNESS_EXPECTED_COUNT = 3;
const GUIDE_DIR = "src/ontology/guides";
const GUIDE_EXPECTED_COUNT = 19;
const FUNCTIONS_FILE = "src/ontology/skeleton/functions.ttl";
const MIN_KOSHA_GUIDE_META_COUNT = 1000;
const MIN_FUNCTION_SHAPE_COUNT = 5;

const results = [];
const graphCheck = runGraphCheck();

await record("G1", graphCheck.ok, graphCheck.detail, graphCheck.reason);
await record("G2", ...(await checkLegacyIri()));
await record("G3", ...(await checkContextAliases()));
await record("G4", ...(await checkKoshaGuideMeta()));
await record("G5", ...(await checkMcpResource()));
await record("G6", ...(await checkActionCount()));
await record("G7", ...(await checkCrossHarness()));
await record("G8", ...(await checkTraversableChainAndGuides(graphCheck)));
await record("G9", ...(await checkFunctionShacl()));

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  process.exit(1);
}

async function record(id: string, ...args: any[]) {
  const [ok, detail, reason = detail] = args;
  results.push({ id, ok, detail, reason });
  if (ok) {
    console.log(`${id} ✅ (${detail})`);
    return;
  }
  console.error(`${id} ❌ (${reason})`);
}

function runGraphCheck() {
  const result = spawnSync(process.execPath, [GRAPH_CHECK_SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    return {
      ok: false,
      detail: "skeleton-graph-check 실행 실패",
      reason: lastLines(output, 6) || `exit ${result.status}`,
    };
  }
  const match = output.match(/(\d+)\/6\s+—\s+그래프 연결 신뢰도/);
  const passCount = match ? Number(match[1]) : 0;
  return {
    ok: passCount === 6,
    detail: `graph-check ${passCount}/6`,
    reason: match ? `graph-check ${passCount}/6` : "graph-check 결과를 파싱할 수 없음",
  };
}

async function checkLegacyIri() {
  const files = await listFiles(resolve(ROOT, "src/ontology"));
  const textFiles = files.filter((file) => TEXT_EXTENSIONS.has(extname(file)));
  const matches = [];
  for (const file of textFiles) {
    const text = await readFile(file, "utf8");
    for (const pattern of LEGACY_IRI_PATTERNS) {
      if (text.includes(pattern)) {
        matches.push(`${relative(file)}:${pattern}`);
      }
    }
  }
  const ok = matches.length === 0;
  return [
    ok,
    `legacy IRI residual ${matches.length}건`,
    matches.length > 0 ? matches.slice(0, 5).join(", ") : undefined,
  ];
}

async function checkContextAliases() {
  const context = await readJson("src/ontology/graph/context.jsonld");
  const aliases = CONTEXT_ALIASES.filter((name) => typeof context["@context"]?.[name] === "string");
  return [
    aliases.length >= 1,
    `context alias ${aliases.length}개 (${aliases.join(", ")})`,
    `context alias가 없음: ${CONTEXT_ALIASES.join(", ")}`,
  ];
}

async function checkKoshaGuideMeta() {
  const count = await countFiles(resolve(ROOT, KOSHA_GUIDES_DIR));
  return [
    count >= MIN_KOSHA_GUIDE_META_COUNT,
    `KOSHA guide meta ${count}건`,
    `KOSHA guide meta ${count}건 < ${MIN_KOSHA_GUIDE_META_COUNT}`,
  ];
}

async function checkMcpResource() {
  const indexText = await readFile(resolve(ROOT, INDEX_FILE), "utf8");
  const hasCapability = /capabilities\s*:\s*\{[\s\S]*resources\s*:/.test(indexText);
  const hasResourceFile = existsSync(resolve(ROOT, RESOURCE_FILE));
  const ok = hasCapability && hasResourceFile;
  return [
    ok,
    `capabilities.resources=${hasCapability}, ${RESOURCE_FILE}=${hasResourceFile}`,
    `MCP Resource 등록 불완전: capabilities.resources=${hasCapability}, ${RESOURCE_FILE}=${hasResourceFile}`,
  ];
}

async function checkActionCount() {
  const actions = await readJson(ACTIONS_FILE);
  const actionCount = graphNodes(actions).filter((node) => hasType(node, "safety:Action")).length;
  return [
    actionCount === 19,
    `Action ${actionCount}/19`,
    `Action count ${actionCount}/19`,
  ];
}

async function checkCrossHarness() {
  const dir = resolve(ROOT, HARNESS_DIR);
  if (!existsSync(dir)) {
    return [
      true,
      "manual fallback: tests/harness 없음; test:harness:matrix 별도",
      undefined,
    ];
  }
  const count = await countFiles(dir);
  return [
    count >= HARNESS_EXPECTED_COUNT,
    `harness files ${count}/${HARNESS_EXPECTED_COUNT}`,
    `harness files ${count}/${HARNESS_EXPECTED_COUNT}`,
  ];
}

async function checkTraversableChainAndGuides(currentGraphCheck) {
  const guideCount = await countFiles(resolve(ROOT, GUIDE_DIR));
  const ok = currentGraphCheck.ok && guideCount === GUIDE_EXPECTED_COUNT;
  return [
    ok,
    `graph-check ${currentGraphCheck.ok ? "6/6" : "미통과"}, 별지 guides ${guideCount}/${GUIDE_EXPECTED_COUNT}`,
    `사슬/별지 미통과: ${currentGraphCheck.detail}, guides ${guideCount}/${GUIDE_EXPECTED_COUNT}`,
  ];
}

async function checkFunctionShacl() {
  const text = await readFile(resolve(ROOT, FUNCTIONS_FILE), "utf8");
  const shapeCount = countRegex(text, /\ba\s+sh:NodeShape\b/g);
  return [
    shapeCount >= MIN_FUNCTION_SHAPE_COUNT,
    `Function SHACL NodeShape ${shapeCount}개`,
    `Function SHACL NodeShape ${shapeCount}개 < ${MIN_FUNCTION_SHAPE_COUNT}`,
  ];
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

function graphNodes(doc) {
  return Array.isArray(doc?.["@graph"]) ? doc["@graph"] : [];
}

function hasType(node, type) {
  const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return types.includes(type);
}

async function countFiles(dir) {
  return (await listFiles(dir)).length;
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(path);
      if (entry.isFile()) return [path];
      return [];
    }),
  );
  return nested.flat();
}

function countRegex(text, regex) {
  return (text.match(regex) ?? []).length;
}

function relative(file) {
  return file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
}

function lastLines(text, count) {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-count).join(" / ");
}
