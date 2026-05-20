#!/usr/bin/env tsx
/**
 * test-lifecycle-tools.ts
 *
 * v0.5 라이프사이클 9 신규 도구 + 그래프 traversal 도구 smoke test.
 *   1. assess_my_obligations
 *   2. get_submission_info
 *   3. get_retention_status
 *   4. list_upcoming_duties
 *   5. get_incident_response_workflow
 *   6. get_construction_stage_duties
 *   7. list_downloadable_forms
 *   8. export_drafted_document
 *   9. assemble_doc_context
 *
 * 실행: npx tsx scripts/test/test-lifecycle-tools.ts
 *      npm run mcp:test:lifecycle
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(ROOT, "build", "cli.js");

interface Result {
  tool: string;
  ok: boolean;
  reason: string;
  ms: number;
  hasStructuredContent?: boolean;
  textLen?: number;
}

function call(tool: string, inputJson: Record<string, unknown> = {}): Result {
  const t0 = Date.now();
  const res = spawnSync(
    "node",
    [CLI, "call", tool, "--inputJson", JSON.stringify(inputJson)],
    { encoding: "utf8", cwd: ROOT, maxBuffer: 16 * 1024 * 1024 },
  );
  const ms = Date.now() - t0;
  if (res.status !== 0) {
    return { tool, ok: false, reason: `exit=${res.status} stderr=${(res.stderr ?? "").slice(0, 200)}`, ms };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return { tool, ok: false, reason: "invalid JSON output", ms };
  }
  const text = parsed?.content?.[0]?.text ?? "";
  if (parsed?.isError) {
    return { tool, ok: false, reason: `isError: ${text.slice(0, 100)}`, ms, textLen: text.length };
  }
  if (!text || text.length < 10) {
    return { tool, ok: false, reason: "empty content", ms };
  }
  return {
    tool,
    ok: true,
    reason: "PASS",
    ms,
    hasStructuredContent: !!parsed.structuredContent,
    textLen: text.length,
  };
}

interface TestCase {
  tool: string;
  input: Record<string, unknown>;
  expectKeys?: string[]; // structuredContent 안에 있어야 할 키
}

const TESTS: TestCase[] = [
  // 1. assess_my_obligations
  {
    tool: "assess_my_obligations",
    input: { workforce: 35, contractAmount: 1_500_000_000, industry: "construction" },
    expectKeys: ["summary", "obligations"],
  },
  // 2. get_submission_info
  {
    tool: "get_submission_info",
    input: { docId: "industrial_accident_report" },
    expectKeys: ["docId", "submitTo", "electronicSubmission"],
  },
  // 3. get_retention_status
  {
    tool: "get_retention_status",
    input: { docId: "industrial_accident_report", compileDate: "2024-01-15", asOf: "2026-04-30" },
    expectKeys: ["status", "remainingDays"],
  },
  // 4. list_upcoming_duties
  {
    tool: "list_upcoming_duties",
    input: { withinDays: 30 },
    expectKeys: ["duties", "counts"],
  },
  // 5. get_incident_response_workflow
  {
    tool: "get_incident_response_workflow",
    input: { severity: "fatal" },
    expectKeys: ["severity", "steps"],
  },
  // 6. get_construction_stage_duties
  {
    tool: "get_construction_stage_duties",
    input: { stage: "active" },
    expectKeys: ["stage", "duties"],
  },
  // 7. list_downloadable_forms
  {
    tool: "list_downloadable_forms",
    input: { format: "official" },
    expectKeys: ["forms", "total"],
  },
  // 8. export_drafted_document
  {
    tool: "export_drafted_document",
    input: {
      docId: "daily_tbm",
      draft: { siteName: "황룡건설(주)", date: "2026-04-30", attendees: "홍길동, 김철수" },
      format: "html",
    },
    expectKeys: ["format", "length"],
  },
  // 9. assemble_doc_context — 빈도별 대표 docId
  { tool: "assemble_doc_context", input: { docId: "daily_tbm" }, expectKeys: ["document", "legalBasis", "hazards", "controls", "lifecycle"] },
  { tool: "assemble_doc_context", input: { docId: "monthly_risk_assessment" }, expectKeys: ["document", "lifecycle"] },
  { tool: "assemble_doc_context", input: { docId: "work_permit_hot_work" }, expectKeys: ["document", "hazards", "controls"] },
  { tool: "assemble_doc_context", input: { docId: "industrial_accident_report" }, expectKeys: ["document", "annex"] },
  { tool: "assemble_doc_context", input: { docId: "regular_risk_assessment" }, expectKeys: ["document"] },
];

function main(): void {
  console.log("=".repeat(70));
  console.log("Agent Safety OSS MCP — v0.5 라이프사이클 도구 smoke test");
  console.log("=".repeat(70));
  console.log(`CLI: ${CLI}`);
  console.log(`테스트 케이스: ${TESTS.length}\n`);

  const results: Result[] = [];
  let passed = 0;
  let failed = 0;
  for (const tc of TESTS) {
    const r = call(tc.tool, tc.input);
    results.push(r);
    const badge = r.ok ? "✅" : "❌";
    const inputStr = JSON.stringify(tc.input).slice(0, 50);
    console.log(`${badge} ${r.tool.padEnd(36)} ${r.ms.toString().padStart(5)}ms  in=${inputStr}`);
    if (r.ok) passed++;
    else {
      failed++;
      console.log(`     reason: ${r.reason}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`결과: ✅ ${passed}/${TESTS.length} PASS · ❌ ${failed} FAIL`);
  console.log(`평균 응답 시간: ${(results.reduce((s, r) => s + r.ms, 0) / results.length).toFixed(0)}ms`);
  console.log("=".repeat(70));

  process.exit(failed === 0 ? 0 : 1);
}

main();
