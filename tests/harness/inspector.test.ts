import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const INSPECTOR_ENV_KEY = "MCP_INSPECTOR_BIN";
const INSPECTOR_BIN = "mcp-inspector";
const TBOX_URI = "safety://skeleton/tbox";
const EXPECTED_TOOL_COUNT = 89;
const PROCESS_TIMEOUT_MS = 45_000;
const REQUIRED_CLASSES = [
  "safety:WorkActivity",
  "safety:Hazard",
  "safety:ControlMeasure",
  "safety:KoshaGuide",
  "safety:Article",
  "safety:Action",
] as const;

type HarnessStatus = "pass" | "fail" | "skip";

type HarnessResult = {
  harness: "MCP Inspector";
  mode: "auto";
  status: HarnessStatus;
  passed: boolean;
  skipped: boolean;
  evidence: string[];
  error?: string;
};

type CommandSpec = {
  command: string;
  args: string[];
};

type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: NodeJS.ErrnoException;
};

export async function runInspectorHarness(): Promise<HarnessResult> {
  const evidence: string[] = [];

  try {
    const inspector = await resolveInspectorCommand();
    if (!inspector) {
      return skipResult(
        `${INSPECTOR_BIN} not found. Install @modelcontextprotocol/inspector or set ${INSPECTOR_ENV_KEY}.`,
      );
    }

    const server = await resolveServerCommand();
    evidence.push(`inspector=${inspector.command}`);
    evidence.push(`server=${server.command} ${server.args.join(" ")}`);

    const readResult = await runProcess(
      inspector.command,
      [
        ...inspector.args,
        "--cli",
        server.command,
        ...server.args,
        "--method",
        "resources/read",
        "--uri",
        TBOX_URI,
      ],
      PROCESS_TIMEOUT_MS,
    );
    assertProcessOk(readResult, "resources/read");

    const resourcePayload = parseJsonFromText(readResult.stdout);
    const resourceText = extractResourceText(resourcePayload, TBOX_URI);
    const jsonLd = JSON.parse(resourceText) as Record<string, unknown>;
    const presentClasses = collectOwlClasses(jsonLd);
    const missingClasses = REQUIRED_CLASSES.filter((classId) => !presentClasses.has(classId));
    assert.equal(missingClasses.length, 0, `missing classes: ${missingClasses.join(", ")}`);
    evidence.push(`resource=${TBOX_URI}`);
    evidence.push(`classes=${REQUIRED_CLASSES.length}/${REQUIRED_CLASSES.length}`);

    const toolsResult = await runProcess(
      inspector.command,
      [
        ...inspector.args,
        "--cli",
        server.command,
        ...server.args,
        "--method",
        "tools/list",
      ],
      PROCESS_TIMEOUT_MS,
    );
    assertProcessOk(toolsResult, "tools/list");

    const toolsPayload = parseJsonFromText(toolsResult.stdout);
    const tools = extractTools(toolsPayload);
    assert.equal(tools.length, EXPECTED_TOOL_COUNT);
    evidence.push(`tools=${tools.length}/${EXPECTED_TOOL_COUNT}`);

    return {
      harness: "MCP Inspector",
      mode: "auto",
      status: "pass",
      passed: true,
      skipped: false,
      evidence,
    };
  } catch (err) {
    return {
      harness: "MCP Inspector",
      mode: "auto",
      status: "fail",
      passed: false,
      skipped: false,
      evidence,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function skipResult(reason: string): HarnessResult {
  return {
    harness: "MCP Inspector",
    mode: "auto",
    status: "skip",
    passed: false,
    skipped: true,
    evidence: [reason],
  };
}

async function resolveInspectorCommand(): Promise<CommandSpec | null> {
  const envBin = process.env[INSPECTOR_ENV_KEY];
  if (envBin) {
    await access(envBin, fsConstants.X_OK);
    return { command: envBin, args: [] };
  }

  const localCandidates = [
    join(REPO_ROOT, "node_modules", ".bin", INSPECTOR_BIN),
    join(REPO_ROOT, "..", "..", "node_modules", ".bin", INSPECTOR_BIN),
  ];
  for (const candidate of localCandidates) {
    if (await isExecutable(candidate)) return { command: candidate, args: [] };
  }

  const fromPath = await findOnPath(INSPECTOR_BIN);
  return fromPath ? { command: fromPath, args: [] } : null;
}

async function resolveServerCommand(): Promise<CommandSpec> {
  const builtCli = join(REPO_ROOT, "build", "cli.js");
  if (await isFile(builtCli)) {
    return { command: "node", args: [builtCli, "serve"] };
  }

  const sourceCli = join(REPO_ROOT, "src", "cli.ts");
  return { command: "node", args: ["--import", "tsx", sourceCli, "serve"] };
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    const fileStat = await stat(path);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function findOnPath(binary: string): Promise<string | null> {
  const pathEntries = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, binary);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolveProcess) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        MCP_AUTO_OPEN_ENABLED: "false",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolveProcess({ code: null, stdout, stderr, timedOut, error });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveProcess({ code, stdout, stderr, timedOut });
    });
  });
}

function assertProcessOk(result: ProcessResult, label: string): void {
  if (result.error) throw result.error;
  if (result.timedOut) throw new Error(`${label} timed out`);
  if (result.code !== 0) {
    const message = compactProcessOutput(result);
    throw new Error(`${label} failed with code ${result.code}: ${message}`);
  }
}

function compactProcessOutput(result: ProcessResult): string {
  const combined = `${result.stderr}\n${result.stdout}`.trim().replace(/\s+/g, " ");
  return combined.slice(0, 800);
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error("empty JSON output");

  try {
    return JSON.parse(trimmed);
  } catch {
    for (let start = 0; start < text.length; start += 1) {
      const char = text[start];
      if (char !== "{" && char !== "[") continue;
      for (let end = text.length; end > start; end -= 1) {
        try {
          return JSON.parse(text.slice(start, end));
        } catch {
          // JSON 경계 탐색을 계속한다.
        }
      }
    }
  }

  throw new Error(`no JSON object found in output: ${trimmed.slice(0, 500)}`);
}

function extractResourceText(payload: unknown, uri: string): string {
  assertObject(payload, "resources/read payload");
  const contents = payload.contents;
  assert.ok(Array.isArray(contents), "resources/read payload must contain contents[]");
  const content = contents.find((item) => isObject(item) && item.uri === uri);
  assertObject(content, `resource content for ${uri}`);
  assert.equal(typeof content.text, "string", `resource ${uri} must be text`);
  return content.text;
}

function collectOwlClasses(jsonLd: Record<string, unknown>): Set<string> {
  const graph = jsonLd["@graph"];
  assert.ok(Array.isArray(graph), "JSON-LD must contain @graph[]");

  const classes = new Set<string>();
  for (const node of graph) {
    if (!isObject(node)) continue;
    if (!hasType(node["@type"], "owl:Class")) continue;
    const id = node["@id"];
    if (typeof id === "string") classes.add(id);
  }
  return classes;
}

function extractTools(payload: unknown): unknown[] {
  assertObject(payload, "tools/list payload");
  const tools = payload.tools;
  assert.ok(Array.isArray(tools), "tools/list payload must contain tools[]");
  return tools;
}

function hasType(typeValue: unknown, expectedType: string): boolean {
  if (typeof typeValue === "string") return typeValue === expectedType;
  if (Array.isArray(typeValue)) return typeValue.includes(expectedType);
  return false;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  assert.ok(isObject(value), `${label} must be an object`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runInspectorHarness();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.harness}: ${result.status.toUpperCase()} (${result.passed})`);
    for (const item of result.evidence) console.log(`- ${item}`);
    if (result.error) console.error(result.error);
  }
  process.exit(result.status === "fail" ? 1 : 0);
}
