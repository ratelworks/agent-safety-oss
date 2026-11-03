#!/usr/bin/env tsx
/**
 * test-input-schema-parity.ts
 *
 * 모든 도구 입력 스키마의 수용·거부 동작이 기록된 기준과 같은지 확인한다.
 * 검증 라이브러리(zod) 판 올림처럼 스키마 정의는 그대로인데 해석기가 바뀌는 변경에서
 * "같은 입력을 받고 같은 입력을 거부한다" 를 입력 묶음 전체로 증명하기 위한 회귀 시험.
 *
 * 두 층을 따로 본다:
 *   - full : 도구 handler 가 쓰는 inputSchema.safeParse(입력)
 *   - mcp  : MCP 서버 경로 — 등록에 쓰는 원형(shape)으로 먼저 검증한 뒤, 통과한 값을 inputSchema 로 다시 검증
 *
 * 입력 묶음은 도구별 메타(필수·종류·열거값)에서 결정론적으로 만든다
 * (빈 객체, 필수만, 전체, 필드별 잘못된 종류·null·빈 문자열·경계 숫자, 필수 누락, 모르는 키, 객체 아닌 입력 등).
 *
 * 사용:
 *   tsx scripts/test/test-input-schema-parity.ts           # 기준 파일과 대조 (불일치 시 exit 1)
 *   tsx scripts/test/test-input-schema-parity.ts --record  # 현재 동작을 기준 파일로 기록
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TOOLS, extractRawShape } from "../../src/tool-registry.js";
import { toolInputToMeta, type FieldMeta, type ToolInputMeta } from "../../src/lib/schema-introspection.js";

// 파일 최상단 상수
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const FIXTURE = resolve(ROOT, "scripts", "test", "fixtures", "input-schema-parity.json");
const RECORD = process.argv.includes("--record");
const RESET_CORPUS = process.argv.includes("--reset-corpus");
const EXPECTED_TOOL_COUNT = 92;
const SAMPLE_STRING = "거푸집 해체";
const ENUM_INVALID = "__invalid_enum__";
const LONG_STRING = "가".repeat(600);

type Input = unknown;

interface LayerResult {
  ok: boolean;
  // 통과 시 파싱 결과의 해시, 거부 시 문제 경로 목록(정렬)
  out?: string;
  paths?: string[];
  // 사용자 정의 오류 문구(code=custom) — 판이 바뀌어도 유지돼야 하는 메시지
  custom?: string[];
}

interface CaseRecord {
  tool: string;
  label: string;
  full: LayerResult;
  mcp: LayerResult;
}

// 기준 파일 — 입력 묶음은 corpusMeta(처음 기록 때의 도구 메타, 이후 고정)에서 결정론적으로
// 다시 만들므로 입력 자체는 저장하지 않는다. 도구 메타가 바뀌어도 입력 묶음은 그대로라
// 같은 입력에 대한 수용·거부를 계속 대조할 수 있다.
//   corpusMeta : 입력 묶음 생성용 고정 메타 (--record 로도 바뀌지 않음, --reset-corpus 때만 갱신)
//   meta       : 현재 기대하는 도구 메타 (CLI tools --json 의 inputSchema 와 같은 값)
//   results[도구] = ["라벨\tfull\tmcp"] (mcp 가 full 과 같으면 생략)
interface Fixture {
  toolCount: number;
  toolNames: string[];
  corpusMeta: Record<string, ToolInputMeta>;
  meta: Record<string, ToolInputMeta>;
  results: Record<string, string[]>;
}

// 키 순서와 무관한 정규 JSON
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value) ?? "undefined").digest("hex").slice(0, 16);
}

interface IssueLike {
  path: PropertyKey[];
  code: string;
  message: string;
}
interface SafeParseLike {
  success: boolean;
  data?: unknown;
  error?: { issues: IssueLike[] };
}

function encodeLayer(r: LayerResult): string {
  if (r.ok) return `+${r.out}`;
  const custom = r.custom && r.custom.length > 0 ? `|${r.custom.join("|")}` : "";
  return `-${(r.paths ?? []).join(",")}${custom}`;
}

function encodeCase(c: CaseRecord): string {
  const full = encodeLayer(c.full);
  const mcp = encodeLayer(c.mcp);
  return mcp === full ? `${c.label}\t${full}` : `${c.label}\t${full}\t${mcp}`;
}

function toLayer(r: SafeParseLike): LayerResult {
  if (r.success) return { ok: true, out: hash(r.data) };
  const issues: IssueLike[] = r.error?.issues ?? [];
  const paths: string[] = [...new Set(issues.map((i) => i.path.map(String).join(".")))].sort();
  const custom: string[] = [...new Set(issues.filter((i) => i.code === "custom").map((i) => i.message))].sort();
  const res: LayerResult = { ok: false, paths };
  if (custom.length > 0) res.custom = custom;
  return res;
}

function runFull(schema: z.ZodType, input: Input): LayerResult {
  return toLayer(schema.safeParse(input) as SafeParseLike);
}

function runMcp(schema: z.ZodType, input: Input): LayerResult {
  // MCP SDK 는 등록된 원형(shape)을 객체 스키마로 감싸 먼저 검증하고, handler 가 inputSchema 로 다시 검증한다.
  const shapeSchema = z.object(extractRawShape(schema));
  const first = shapeSchema.safeParse(input) as SafeParseLike;
  if (!first.success) return toLayer(first);
  return toLayer(schema.safeParse(first.data) as SafeParseLike);
}

// 종류별 정상 표본
function validSample(meta: FieldMeta): unknown {
  switch (meta.type) {
    case "string":
      return SAMPLE_STRING;
    case "number":
      return 1;
    case "boolean":
      return true;
    case "enum":
      return meta.enumValues && meta.enumValues.length > 0 ? meta.enumValues[0] : SAMPLE_STRING;
    case "array":
      if (meta.itemsType === "string") return [SAMPLE_STRING];
      if (meta.itemsType === "number") return [1];
      if (meta.itemsType === "object") return [{}];
      return [];
    case "object":
      return {};
    default:
      return SAMPLE_STRING;
  }
}

// 종류별 경계·오류 표본
function probeValues(meta: FieldMeta): Array<[string, unknown]> {
  const probes: Array<[string, unknown]> = [["null", null]];
  switch (meta.type) {
    case "string":
      probes.push(["empty", ""], ["number", 7], ["long", LONG_STRING], ["date", "2026-11-03"], ["array", ["x"]]);
      break;
    case "number":
      probes.push(["neg", -1], ["zero", 0], ["frac", 1.5], ["huge", 1e9], ["numstr", "3"], ["str", "abc"]);
      break;
    case "boolean":
      probes.push(["false", false], ["strTrue", "true"], ["strNo", "no"], ["strBad", "maybe"], ["num", 1]);
      break;
    case "enum":
      for (const v of meta.enumValues ?? []) probes.push([`enum:${v}`, v]);
      probes.push(["enumBad", ENUM_INVALID], ["num", 3]);
      break;
    case "array":
      probes.push(["emptyArr", []], ["strItems", ["a", "b"]], ["numItems", [1, 2]], ["objItems", [{}]], ["notArr", "a"]);
      break;
    case "object":
      probes.push(["emptyObj", {}], ["strRec", { k: "v" }], ["numRec", { k: 1 }], ["nested", { a: { b: 1 } }], ["notObj", "a"], ["arr", []]);
      break;
    default:
      probes.push(["str", SAMPLE_STRING], ["num", 1], ["obj", {}], ["arr", []]);
  }
  return probes;
}

function buildCases(meta: { properties: Record<string, FieldMeta>; required: string[] }): Array<[string, Input]> {
  const cases: Array<[string, Input]> = [];
  const props = meta.properties;
  const requiredOnly: Record<string, unknown> = {};
  for (const k of meta.required) requiredOnly[k] = validSample(props[k]);
  const all: Record<string, unknown> = {};
  for (const [k, m] of Object.entries(props)) all[k] = validSample(m);

  cases.push(["undefined", undefined]);
  cases.push(["null", null]);
  cases.push(["array", []]);
  cases.push(["string", "x"]);
  cases.push(["empty", {}]);
  cases.push(["requiredOnly", requiredOnly]);
  cases.push(["all", all]);
  cases.push(["unknownKey", { ...all, __unknown__: "x" }]);
  cases.push(["aliasTopic", { ...requiredOnly, topic: SAMPLE_STRING, workName: SAMPLE_STRING }]);
  for (const k of meta.required) {
    const missing = { ...all };
    delete missing[k];
    cases.push([`missing:${k}`, missing]);
  }
  for (const [k, m] of Object.entries(props)) {
    for (const [label, v] of probeValues(m)) {
      cases.push([`field:${k}:${label}`, { ...all, [k]: v }]);
      cases.push([`fieldReq:${k}:${label}`, { ...requiredOnly, [k]: v }]);
    }
  }
  return cases;
}

function loadFixture(): Fixture | null {
  try {
    return JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;
  } catch {
    return null;
  }
}

function main(): void {
  const toolNames = TOOLS.map((t) => t.name);
  const meta: Record<string, ToolInputMeta> = {};
  for (const tool of TOOLS) meta[tool.name] = toolInputToMeta(tool.inputSchema);

  const expected = loadFixture();
  if (!RECORD && !expected) {
    console.error(`❌ 기준 파일 없음: ${FIXTURE} (--record 로 먼저 기록)`);
    process.exit(1);
  }
  const corpusMeta: Record<string, ToolInputMeta> =
    expected && !RESET_CORPUS ? { ...meta, ...expected.corpusMeta } : meta;

  const cases: CaseRecord[] = [];
  for (const tool of TOOLS) {
    for (const [label, input] of buildCases(corpusMeta[tool.name])) {
      cases.push({ tool: tool.name, label, full: runFull(tool.inputSchema, input), mcp: runMcp(tool.inputSchema, input) });
    }
  }
  const results: Record<string, string[]> = {};
  for (const c of cases) (results[c.tool] ??= []).push(encodeCase(c));
  const current: Fixture = { toolCount: TOOLS.length, toolNames, corpusMeta, meta, results };

  const total = cases.length;
  const acceptedFull = cases.filter((c) => c.full.ok).length;
  const acceptedMcp = cases.filter((c) => c.mcp.ok).length;
  const summary = `도구 ${current.toolCount}개 · 입력 ${total}건 · full 수용 ${acceptedFull} / 거부 ${total - acceptedFull} · mcp 수용 ${acceptedMcp} / 거부 ${total - acceptedMcp}`;

  if (RECORD) {
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, JSON.stringify(current, null, 1) + "\n");
    console.log(`기록: ${summary} → ${FIXTURE}`);
    return;
  }

  const exp = expected as Fixture;
  const failures: string[] = [];
  if (current.toolCount !== EXPECTED_TOOL_COUNT) failures.push(`도구 수 ${current.toolCount} ≠ ${EXPECTED_TOOL_COUNT}`);
  if (canonical(exp.toolNames) !== canonical(current.toolNames)) failures.push("도구 이름·순서가 기준과 다름");
  for (const name of new Set([...Object.keys(exp.meta), ...toolNames])) {
    if (canonical(exp.meta[name]) !== canonical(current.meta[name])) {
      failures.push(`메타 불일치: ${name} — 기준 ${canonical(exp.meta[name])} / 현재 ${canonical(current.meta[name])}`);
    }
  }
  let compared = 0;
  for (const name of new Set([...Object.keys(exp.results), ...toolNames])) {
    const e = new Map((exp.results[name] ?? []).map((line) => [line.split("\t")[0], line] as const));
    const a = new Map((current.results[name] ?? []).map((line) => [line.split("\t")[0], line] as const));
    for (const label of new Set([...e.keys(), ...a.keys()])) {
      compared += 1;
      if (e.get(label) !== a.get(label)) failures.push(`${name}: 기준 ${JSON.stringify(e.get(label))} / 현재 ${JSON.stringify(a.get(label))}`);
    }
  }
  console.log(`${summary} · 대조 ${compared}건`);
  if (compared === 0) failures.push("대조한 입력이 0건 — 빈 검사");
  if (failures.length > 0) {
    console.error(`❌ 입력 스키마 동작 불일치 ${failures.length}건`);
    for (const f of failures.slice(0, 60)) console.error(`  - ${f}`);
    if (failures.length > 60) console.error(`  … 외 ${failures.length - 60}건`);
    process.exit(1);
  }
  console.log("✅ 모든 도구 입력 스키마의 수용·거부·파싱 결과가 기준과 같음");
}

main();
