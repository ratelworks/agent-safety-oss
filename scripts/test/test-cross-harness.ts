#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const TEST_TIMEOUT_MS = 150_000;
const AUTO_PASS_THRESHOLD = 2;
const MATRIX = [
  {
    harness: "MCP Inspector",
    mode: "auto",
    command: "node",
    args: ["--import", "tsx", "tests/harness/inspector.test.ts", "--json"],
  },
  {
    harness: "Codex CLI",
    mode: "auto",
    command: "node",
    args: ["--import", "tsx", "tests/harness/codex-cli.test.ts", "--json"],
  },
  {
    harness: "Claude Desktop",
    mode: "manual",
    doc: "tests/harness/claude-desktop.manual.md",
    signoffEnv: "CLAUDE_DESKTOP_HARNESS_SIGNOFF",
  },
];

const results = [];

for (const item of MATRIX) {
  if (item.mode === "manual") {
    results.push(manualResult(item));
    continue;
  }

  results.push(await runAutoItem(item));
}

printMatrix(results);

const automaticResults = results.filter((result) => result.mode === "auto");
const autoPassCount = automaticResults.filter((result) => result.status === "pass").length;
const manualReady = results
  .filter((result) => result.mode === "manual")
  .every((result) => result.status === "manual-pass");

console.log("");
console.log(`auto pass: ${autoPassCount}/${automaticResults.length}`);
console.log(`release gate: ${autoPassCount}/${automaticResults.length} auto PASS + manual sign-off = ${manualReady ? "READY" : "PENDING"}`);

process.exit(autoPassCount >= AUTO_PASS_THRESHOLD ? 0 : 1);

async function runAutoItem(item) {
  const run = await runProcess(item.command, item.args, TEST_TIMEOUT_MS);
  const parsed = parseHarnessJson(run.stdout);

  if (parsed) {
    return normalizeAutoResult(item, parsed, run);
  }

  const status = run.timedOut || run.code !== 0 ? "fail" : "skip";
  return {
    harness: item.harness,
    mode: "auto",
    status,
    passed: false,
    skipped: status === "skip",
    evidence: [compactOutput(`${run.stderr}\n${run.stdout}`) || "no structured harness output"],
    error: run.error ? run.error.message : undefined,
  };
}

function manualResult(item) {
  const signedOff = process.env[item.signoffEnv] === "1" || process.env[item.signoffEnv] === "true";
  return {
    harness: item.harness,
    mode: "manual",
    status: signedOff ? "manual-pass" : "manual",
    passed: signedOff,
    skipped: false,
    evidence: [
      `${item.doc}`,
      signedOff ? `${item.signoffEnv}=true` : `sign-off required via ${item.signoffEnv}=true`,
    ],
  };
}

function normalizeAutoResult(item: any, parsed: any, run: any) {
  const status = parsed.status ?? (parsed.passed ? "pass" : "fail");
  return {
    harness: parsed.harness ?? item.harness,
    mode: parsed.mode ?? "auto",
    status,
    passed: Boolean(parsed.passed),
    skipped: Boolean(parsed.skipped),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    error: parsed.error ?? (run.error ? run.error.message : undefined),
  };
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<any> {
  return new Promise<any>((resolveProcess) => {
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveProcess({ code: null, stdout, stderr, timedOut, error });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveProcess({ code, stdout, stderr, timedOut });
    });
  });
}

function parseHarnessJson(stdout: string) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    for (let start = 0; start < stdout.length; start += 1) {
      const char = stdout[start];
      if (char !== "{") continue;
      for (let end = stdout.length; end > start; end -= 1) {
        try {
          return JSON.parse(stdout.slice(start, end));
        } catch {
          // JSON 경계 탐색을 계속한다.
        }
      }
    }
  }

  return null;
}

function printMatrix(rows: any[]) {
  const printable = rows.map((row: any) => ({
    Harness: row.harness,
    Mode: row.mode,
    Status: String(row.status).toUpperCase(),
    Pass: row.passed ? "true" : "false",
    Evidence: row.evidence.join(" | "),
    Error: row.error ?? "",
  }));

  console.log("Cross-harness matrix");
  console.table(printable);
}

function compactOutput(output: string) {
  return output.trim().replace(/\s+/g, " ").slice(0, 800);
}
