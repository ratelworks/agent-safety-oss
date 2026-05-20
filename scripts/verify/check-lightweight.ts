#!/usr/bin/env node
// prepublish 경량 가드레일 4개 — PLAN §0.6 자동 차단.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
// L1: 25 MiB — 정부 양식 PDF/HWP 16 종 약 12 MiB (공공누리·자유 인용)
//   가 본문 가치 (오프라인 작동 + 출처 인용 정확). PLAN §0.6 본질 정의 정합 후 trade-off 결정 (2026-05-03):
//   "본문 그래프화 X, 메타+인용 단위만"의 예외 (양식 본문은 정부 자유 인용물).
//   v1.0 임계값 25 MiB. v1.x lazy-load 분리 시 < 10 MiB 회복 가능.
const PACK_SIZE_LIMIT = 25 * 1024 * 1024;
const RAM_LIMIT = 500 * 1024 * 1024;
const LATENCY_LIMIT_MS = 1000;
const NPM_CACHE_DIR = resolve(tmpdir(), "agent-safety-oss-npm-cache");
const TIER0_FILES = {
  skeleton: "src/ontology/skeleton/skeleton.jsonld",
  actions: "src/ontology/skeleton/actions.jsonld",
  functions: "src/ontology/skeleton/functions.ttl",
  instances: "src/ontology/skeleton/instances.jsonld",
};
const MIN_TIER0_CLASSES = 6;
const TIER0_ACTION_COUNT = 19;
const MIN_TIER0_INSTANCES = 14;
const ONTOLOGY_TEXT_EXTENSIONS = new Set([".json", ".jsonld", ".ttl", ".md"]);
const FIRST_TOOL_NAME = "get_project_info";

const results = [];

await record("L1", ...(await checkPackSize()));
await record("L2", ...(await checkTier0Manifest()));
await record("L3", ...(await checkColdStartRam()));
await record("L4", ...(await checkFirstToolCallLatency()));

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

async function checkPackSize() {
  mkdirSync(NPM_CACHE_DIR, { recursive: true });
  try {
    const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: NPM_CACHE_DIR,
        NPM_CONFIG_CACHE: NPM_CACHE_DIR,
      },
      maxBuffer: 120 * 1024 * 1024,
    });
    const packInfo = parseNpmJson(stdout);
    const size = Number(packInfo?.[0]?.size ?? Number.NaN);
    const ok = Number.isFinite(size) && size < PACK_SIZE_LIMIT;
    return [
      ok,
      `npm pack ${formatBytes(size)} < ${formatBytes(PACK_SIZE_LIMIT)}`,
      `npm pack ${formatBytes(size)} >= ${formatBytes(PACK_SIZE_LIMIT)}`,
    ];
  } catch (error) {
    return [false, "npm pack 측정 실패", commandError(error)];
  }
}

async function checkTier0Manifest() {
  const missing = Object.values(TIER0_FILES).filter((path) => !existsSync(resolve(ROOT, path)));
  if (missing.length > 0) {
    return [false, "Tier 0 manifest 파일 누락", `누락: ${missing.join(", ")}`];
  }

  const skeleton = await readJson(TIER0_FILES.skeleton);
  const actions = await readJson(TIER0_FILES.actions);
  const instances = await readJson(TIER0_FILES.instances);
  const functionsText = await readFile(resolve(ROOT, TIER0_FILES.functions), "utf8");

  const classCount = graphNodes(skeleton).filter((node) => node?.["@type"] === "owl:Class").length;
  const actionCount = graphNodes(actions).filter((node) => hasType(node, "safety:Action")).length;
  const instanceCount = graphNodes(instances).length;
  const hasFunctions = functionsText.trim().length > 0;
  const ok =
    classCount >= MIN_TIER0_CLASSES &&
    actionCount === TIER0_ACTION_COUNT &&
    instanceCount >= MIN_TIER0_INSTANCES &&
    hasFunctions;

  return [
    ok,
    `classes ${classCount}/${MIN_TIER0_CLASSES}, actions ${actionCount}/${TIER0_ACTION_COUNT}, instances ${instanceCount}/${MIN_TIER0_INSTANCES}, functions=${hasFunctions}`,
    `Tier 0 불완전: classes ${classCount}/${MIN_TIER0_CLASSES}, actions ${actionCount}/${TIER0_ACTION_COUNT}, instances ${instanceCount}/${MIN_TIER0_INSTANCES}, functions=${hasFunctions}`,
  ];
}

async function checkColdStartRam() {
  const code = `
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = ${JSON.stringify(ROOT)};
const exts = new Set(${JSON.stringify([...ONTOLOGY_TEXT_EXTENSIONS])});
const ontologyRoot = existsSync(resolve(root, "build/ontology"))
  ? resolve(root, "build/ontology")
  : resolve(root, "src/ontology");
const payloads = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.isFile() || !exts.has(extname(path))) continue;
    const text = readFileSync(path, "utf8");
    if (path.endsWith(".json") || path.endsWith(".jsonld")) {
      payloads.push(JSON.parse(text));
    } else {
      payloads.push(text);
    }
  }
}

walk(ontologyRoot);
globalThis.__agentSafetyOntologyPayloads = payloads;
if (globalThis.gc) globalThis.gc();
console.log(JSON.stringify({
  rss: process.memoryUsage().rss,
  files: payloads.length,
  root: ontologyRoot.startsWith(root) ? ontologyRoot.slice(root.length + 1) : ontologyRoot
}));
`;

  try {
    const stdout = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", code], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    const measurement = JSON.parse(stdout);
    const rss = Number(measurement.rss);
    const ok = Number.isFinite(rss) && rss < RAM_LIMIT;
    return [
      ok,
      `RSS ${formatBytes(rss)} < ${formatBytes(RAM_LIMIT)} (${measurement.root}, ${measurement.files} files)`,
      `RSS ${formatBytes(rss)} >= ${formatBytes(RAM_LIMIT)} (${measurement.root}, ${measurement.files} files)`,
    ];
  } catch (error) {
    return [false, "cold-start RAM 측정 실패", commandError(error)];
  }
}

async function checkFirstToolCallLatency() {
  try {
    const measurement: any = existsSync(resolve(ROOT, "build/cli.js"))
      ? await measureMcpStdioToolCall()
      : measureSourceFallbackToolCall();
    const ok = measurement.latencyMs < LATENCY_LIMIT_MS;
    return [
      ok,
      `${measurement.mode} ${measurement.latencyMs.toFixed(1)}ms < ${LATENCY_LIMIT_MS}ms`,
      `${measurement.mode} ${measurement.latencyMs.toFixed(1)}ms >= ${LATENCY_LIMIT_MS}ms`,
    ];
  } catch (error) {
    return [false, "first tool call latency 측정 실패", error.message];
  }
}

function measureMcpStdioToolCall() {
  return new Promise((resolveMeasurement, rejectMeasurement) => {
    const start = performance.now();
    const child = spawn(process.execPath, ["build/cli.js", "serve"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let stderr = "";
    let initialized = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectMeasurement(new Error(`MCP stdio timeout: ${lastLines(stderr, 4)}`));
    }, 5000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectMeasurement(error);
    });
    child.on("exit", (code) => {
      if (!initialized) {
        clearTimeout(timeout);
        rejectMeasurement(new Error(`MCP stdio exited before response: ${code}; ${lastLines(stderr, 4)}`));
      }
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === 1) {
          writeJson(child, {
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {},
          });
          writeJson(child, {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: FIRST_TOOL_NAME,
              arguments: {},
            },
          });
        }
        if (message.id === 2) {
          initialized = true;
          clearTimeout(timeout);
          child.kill("SIGTERM");
          resolveMeasurement({
            latencyMs: performance.now() - start,
            mode: "MCP stdio first tool call",
          });
        }
      }
    });

    writeJson(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "prepublish-gate",
          version: "1.0.0",
        },
      },
    });
  });
}

function measureSourceFallbackToolCall() {
  const start = performance.now();
  const packageJson = JSON.parse(readFileSyncText("package.json"));
  const registryText = readFileSyncText("src/tool-registry.ts");
  const projectInfoText = readFileSyncText("src/tools/get-project-info.ts");
  if (packageJson.name !== "agent-safety-oss") {
    throw new Error("package metadata 로드 실패");
  }
  if (!registryText.includes("getProjectInfoTool") || !projectInfoText.includes(FIRST_TOOL_NAME)) {
    throw new Error(`${FIRST_TOOL_NAME} source fallback 로드 실패`);
  }
  return {
    latencyMs: performance.now() - start,
    mode: "source fallback first tool call",
  };
}

function writeJson(child, payload) {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

function readFileSyncText(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function graphNodes(doc) {
  return Array.isArray(doc?.["@graph"]) ? doc["@graph"] : [];
}

function hasType(node, type) {
  const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return types.includes(type);
}

function parseNpmJson(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("npm pack JSON 출력 파싱 실패");
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "NaN";
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(2)} MB`;
}

function commandError(error) {
  const stdout = typeof error.stdout === "string" ? error.stdout : "";
  const stderr = typeof error.stderr === "string" ? error.stderr : "";
  return lastLines(`${stdout}\n${stderr}\n${error.message}`, 6);
}

function lastLines(text, count) {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-count).join(" / ");
}
