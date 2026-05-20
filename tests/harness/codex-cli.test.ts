import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const CODEX_BIN = "codex";
const CODEX_ENV_KEY = "CODEX_BIN";
const MCP_SERVER_NAME = "agent-safety-oss";
const INSTANCES_URI = "safety://skeleton/instances";
const PROCESS_TIMEOUT_MS = 120_000;
const AUTH_SKIP_PATTERNS = [
  /not logged in/i,
  /login required/i,
  /authentication required/i,
  /not authenticated/i,
  /api key/i,
  /no auth/i,
  /sign in/i,
];

type HarnessStatus = "pass" | "fail" | "skip";

type HarnessResult = {
  harness: "Codex CLI";
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

export async function runCodexCliHarness(): Promise<HarnessResult> {
  const evidence: string[] = [];
  let tempDir: string | null = null;

  try {
    const codex = await resolveCodexCommand();
    if (!codex) {
      return skipResult(`${CODEX_BIN} not found. Install Codex CLI or set ${CODEX_ENV_KEY}.`);
    }

    const server = await resolveServerCommand();
    tempDir = await mkdtemp(join(tmpdir(), "agent-safety-codex-harness-"));
    const outputPath = join(tempDir, "last-message.json");
    const prompt = buildPrompt();
    const codexArgs = [
      "--ask-for-approval",
      "never",
      "exec",
      "--cd",
      REPO_ROOT,
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "--output-last-message",
      outputPath,
      "-c",
      `${mcpConfigKey("command")}=${tomlString(server.command)}`,
      "-c",
      `${mcpConfigKey("args")}=${tomlArray(server.args)}`,
      prompt,
    ];

    evidence.push(`codex=${codex.command}`);
    evidence.push(`server=${server.command} ${server.args.join(" ")}`);
    evidence.push(`resource=${INSTANCES_URI}`);

    const result = await runProcess(codex.command, [...codex.args, ...codexArgs], PROCESS_TIMEOUT_MS);
    const combinedOutput = `${result.stderr}\n${result.stdout}`;

    if (result.error && result.error.code === "ENOENT") {
      return skipResult(`${CODEX_BIN} not found. Install Codex CLI or set ${CODEX_ENV_KEY}.`);
    }
    if (result.timedOut) {
      return skipResult("codex exec timed out before returning a resource-read verdict");
    }
    if (result.code !== 0 && isAuthOrSetupSkip(combinedOutput)) {
      return skipResult(`codex exec unavailable: ${compactOutput(combinedOutput)}`);
    }
    if (result.code !== 0) {
      throw new Error(`codex exec failed with code ${result.code}: ${compactOutput(combinedOutput)}`);
    }

    const finalText = await readFinalMessage(outputPath, result.stdout);
    const payload = parseJsonFromText(finalText);
    assertObject(payload, "codex final response");
    assert.equal(payload.status, 200, "Codex final response must report status 200");
    assert.equal(payload.jsonValid, true, "Codex final response must report jsonValid=true");
    assert.equal(payload.uri, INSTANCES_URI, `Codex final response must target ${INSTANCES_URI}`);
    if ("graphCount" in payload) {
      assert.equal(typeof payload.graphCount, "number", "graphCount must be a number");
      assert.ok(payload.graphCount > 0, "graphCount must be > 0");
      evidence.push(`graphCount=${payload.graphCount}`);
    }

    return {
      harness: "Codex CLI",
      mode: "auto",
      status: "pass",
      passed: true,
      skipped: false,
      evidence,
    };
  } catch (err) {
    return {
      harness: "Codex CLI",
      mode: "auto",
      status: "fail",
      passed: false,
      skipped: false,
      evidence,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function skipResult(reason: string): HarnessResult {
  return {
    harness: "Codex CLI",
    mode: "auto",
    status: "skip",
    passed: false,
    skipped: true,
    evidence: [reason],
  };
}

async function resolveCodexCommand(): Promise<CommandSpec | null> {
  const envBin = process.env[CODEX_ENV_KEY];
  if (envBin) {
    await access(envBin, fsConstants.X_OK);
    return { command: envBin, args: [] };
  }

  const fromPath = await findOnPath(CODEX_BIN);
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

function buildPrompt(): string {
  return [
    "Use the configured MCP server named agent-safety-oss.",
    "Read the MCP resource safety://skeleton/instances.",
    "Do not inspect repository files and do not infer from source code.",
    "Return exactly one JSON object and no Markdown.",
    `Expected shape: {"status":200,"jsonValid":true,"uri":"${INSTANCES_URI}","graphCount":number}.`,
    "Set status=200 only if the MCP resource read succeeds and the resource text parses as valid JSON.",
  ].join("\n");
}

function mcpConfigKey(field: "command" | "args"): string {
  return `mcp_servers.${JSON.stringify(MCP_SERVER_NAME)}.${field}`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(",")}]`;
}

async function findOnPath(binary: string): Promise<string | null> {
  const pathEntries = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, binary);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
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

function runProcess(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolveProcess) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
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

async function readFinalMessage(outputPath: string, fallbackStdout: string): Promise<string> {
  try {
    const text = await readFile(outputPath, "utf8");
    if (text.trim().length > 0) return text;
  } catch {
    // output-last-message 파일이 없으면 stdout에서 JSON을 추출한다.
  }
  return fallbackStdout;
}

function isAuthOrSetupSkip(output: string): boolean {
  return AUTH_SKIP_PATTERNS.some((pattern) => pattern.test(output));
}

function compactOutput(output: string): string {
  return output.trim().replace(/\s+/g, " ").slice(0, 800);
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error("empty Codex response");

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

  throw new Error(`no JSON object found in Codex response: ${trimmed.slice(0, 500)}`);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${label} must be an object`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runCodexCliHarness();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.harness}: ${result.status.toUpperCase()} (${result.passed})`);
    for (const item of result.evidence) console.log(`- ${item}`);
    if (result.error) console.error(result.error);
  }
  process.exit(result.status === "fail" ? 1 : 0);
}
