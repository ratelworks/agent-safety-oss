#!/usr/bin/env node
import { Command } from "commander";
import { SERVER_NAME, VERSION, PROVIDED_BY, DEVELOPED_BY } from "./version.js";
import { TOOLS, findTool, attachCredits } from "./tool-registry.js";
import { toMcpErrorContent } from "./lib/errors.js";
import { toolInputToMeta, getFieldKind, getObjectShape, type FieldKind } from "./lib/schema-introspection.js";

// 파일 최상단 상수 — CLI 서브커맨드 라벨
const CMD = {
  SERVE: "serve",
  TOOLS: "tools",
  CALL: "call",
  DESCRIBE: "describe",
  DOCTOR: "doctor",
} as const;

const program = new Command();

program
  .name(SERVER_NAME)
  .description(
    `한국 건설·산업안전 MCP 서버 (제공: ${PROVIDED_BY} · 개발: ${DEVELOPED_BY})`,
  )
  .version(VERSION);

// 시작 시 크레딧 배너 (한 번만)
if (process.argv.length > 2 && !process.argv.includes("--help") && !process.argv.includes("-h")) {
  // eslint-disable-next-line no-console
  console.error(
    `[${SERVER_NAME} v${VERSION}] 제공: ${PROVIDED_BY} · 개발: ${DEVELOPED_BY}`,
  );
}

program
  .command(CMD.SERVE)
  .description("Start MCP server over stdio")
  .action(async () => {
    await import("./index.js");
  });

// 외부 리뷰 P1 (2026-05-22) — doctor: 시스템 무결성 진단
program
  .command(CMD.DOCTOR)
  .description("Show system health (graph SSoT, KOSHA quality, law freshness, user env)")
  .option("--json", "JSON 출력 (사람 가독 markdown 대신)")
  .action(async (opts: { json?: boolean }) => {
    const { runDoctor } = await import("./tools-meta/doctor.js");
    const output = await runDoctor(opts.json ? "json" : "markdown");
    // eslint-disable-next-line no-console
    console.log(output);
  });

const toolsCmd = program
  .command(CMD.TOOLS)
  .description("List registered MCP tools (grouped by category, --json for raw)")
  .option("--json", "JSON 덤프 모드 (기존 동작)")
  .option(
    "--with-schema",
    "inputSchema (properties · required) 함께 출력 — Issue #4",
  )
  .option(
    "--no-key-required",
    "공공데이터 API 키 없이 바로 쓸 수 있는 도구만 표시",
  )
  .action((opts: { json?: boolean; withSchema?: boolean; keyRequired?: boolean }) => {
    interface ToolRow {
      name: string;
      description: string;
      category: ToolCategory;
      needsApiKey: boolean;
      inputSchema?: ReturnType<typeof toolInputToMeta>;
    }
    const rows: ToolRow[] = TOOLS.map((t) => {
      const base: ToolRow = {
        name: t.name,
        description: t.description,
        category: categorizeTool(t.name),
        needsApiKey: TOOLS_NEEDING_API_KEY.has(t.name),
      };
      if (opts.withSchema) {
        try {
          base.inputSchema = toolInputToMeta(t.inputSchema);
        } catch {
          base.inputSchema = { type: "object", properties: {}, required: [] };
        }
      }
      return base;
    });
    const filtered = opts.keyRequired === false ? rows.filter((r) => !r.needsApiKey) : rows;

    if (opts.json) {
      // 출력 데이터: { name, description, category, needsApiKey: boolean, inputSchema? }
      // needsApiKey 는 boolean (true/false) 만 노출 — API 키 값 자체는 포함 X.
      // CodeQL js/clear-text-logging 은 "needsApiKey" 키 이름만 보고 잡지만 false positive.
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(filtered, null, 2));
      return;
    }

    const groups: Record<ToolCategory, typeof filtered> = {
      "검색·조회 (API 키 필요)": [],
      "검색·조회 (번들, 키 불필요)": [],
      "법령 (번들, 키 불필요)": [],
      "문서 스키마 (가드레일)": [],
      "분석": [],
      "검증": [],
      "프로젝트 메타": [],
    };
    for (const r of filtered) groups[r.category].push(r);

    /* eslint-disable no-console */
    console.log(`[${SERVER_NAME} v${VERSION}] ${filtered.length}/${rows.length} tools\n`);
    for (const [label, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      console.log(`## ${label} (${items.length})`);
      for (const it of items) {
        const key = it.needsApiKey ? " 🔑" : "";
        const short = it.description.replace(/\s+/g, " ").slice(0, 110);
        // Issue #4 — 사람 가독 출력에 required 필드 한 줄 표시
        const tool = findTool(it.name as string);
        let requiredLine = "";
        if (tool) {
          try {
            const meta = toolInputToMeta(tool.inputSchema);
            if (meta.required.length > 0) {
              requiredLine = `\n    필수: ${meta.required.join(", ")}`;
            }
          } catch {}
        }
        console.log(`  • ${it.name}${key}\n    ${short}${short.length >= 110 ? "…" : ""}${requiredLine}`);
      }
      console.log("");
    }
    console.log("  🔑 = 공공데이터포털 API 키 필요 (DATA_GO_KR_KEY)");
    console.log("     '--no-key-required' 로 키 불필요 도구만 필터 / '--json' 으로 raw 덤프");
    console.log("     'tools describe <name>' 으로 단일 도구의 inputSchema 상세 / '--with-schema' 로 전체 JSON 출력");
    /* eslint-enable no-console */
  });

// Issue #4 — tools describe <name> 서브커맨드 (toolsCmd 의 하위로 등록 — Commander nested 패턴)
toolsCmd
  .command(`${CMD.DESCRIBE} <toolName>`)
  .description("Show input schema (properties · required · type) for a specific tool")
  .option("--json", "JSON 덤프")
  .action((toolName: string, opts: { json?: boolean }) => {
    const tool = findTool(toolName);
    if (!tool) {
      // eslint-disable-next-line no-console
      console.error(`Unknown tool: ${toolName}`);
      process.exit(2);
    }
    const meta = toolInputToMeta(tool.inputSchema);
    if (opts.json) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          { name: tool.name, title: tool.title, description: tool.description, inputSchema: meta },
          null,
          2,
        ),
      );
      return;
    }
    /* eslint-disable no-console */
    console.log(`# ${tool.title ?? tool.name}\n`);
    console.log(tool.description);
    console.log("");
    console.log(`## Input Schema`);
    console.log(`필수: ${meta.required.length > 0 ? meta.required.join(", ") : "(없음)"}`);
    console.log("");
    for (const [key, field] of Object.entries(meta.properties)) {
      const req = meta.required.includes(key) ? " *필수*" : "";
      const def = field.default !== undefined ? ` (기본=${JSON.stringify(field.default)})` : "";
      const enumStr = field.enumValues ? ` [${field.enumValues.join("|")}]` : "";
      console.log(`  - ${key}: ${field.type}${enumStr}${req}${def}`);
      if (field.description) console.log(`      ${field.description}`);
    }
    console.log("");
    console.log(`## 호출 예시`);
    console.log(
      `  node build/cli.js call ${tool.name} --inputJson '${JSON.stringify(buildExampleInput(meta))}'`,
    );
    /* eslint-enable no-console */
  });

// 예시 입력 생성 (필수만)
function buildExampleInput(meta: ReturnType<typeof toolInputToMeta>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of meta.required) {
    const f = meta.properties[key];
    if (!f) continue;
    switch (f.type) {
      case "string":
        out[key] = f.enumValues?.[0] ?? "string_value";
        break;
      case "number":
        out[key] = 0;
        break;
      case "boolean":
        out[key] = true;
        break;
      case "array":
        out[key] = [];
        break;
      case "object":
        out[key] = {};
        break;
      case "enum":
        out[key] = f.enumValues?.[0] ?? "enum_value";
        break;
      default:
        out[key] = null;
    }
  }
  return out;
}

// 도구별 카테고리 분류 (CLI 표시용)
type ToolCategory =
  | "검색·조회 (API 키 필요)"
  | "검색·조회 (번들, 키 불필요)"
  | "법령 (번들, 키 불필요)"
  | "문서 스키마 (가드레일)"
  | "분석"
  | "검증"
  | "프로젝트 메타";

const TOOLS_NEEDING_API_KEY = new Set<string>([
  // get_kosha_guide_content (legacy) 는 번들 통합으로 제거 (키 불필요)
  "search_accident_cases",
  "get_accident_case_attachments",
  "search_construction_fatal_accidents",
  "search_all_fatal_accidents",
  "search_safety_materials",
  "search_msds",
  "search_ppe_certification",
]);

function categorizeTool(name: string): ToolCategory {
  if (name === "get_project_info") return "프로젝트 메타";
  if (name === "verify_safety_basis") return "검증";
  if (
    name === "analyze_construction_work_risks" ||
    name === "compile_safety_references"
  )
    return "분석";
  if (
    name === "search_safety_laws" ||
    name === "get_safety_law_article" ||
    name === "list_core_safety_laws"
  )
    return "법령 (번들, 키 불필요)";
  if (name.startsWith("get_") && name.endsWith("_schema"))
    return "문서 스키마 (가드레일)";
  if (TOOLS_NEEDING_API_KEY.has(name)) return "검색·조회 (API 키 필요)";
  return "검색·조회 (번들, 키 불필요)";
}

program
  .command(`${CMD.CALL} <toolName>`)
  .description("Invoke a tool directly (arguments as --key value pairs)")
  .allowUnknownOption(true)
  .action(async (toolName: string, _opts, cmd) => {
    const tool = findTool(toolName);
    if (!tool) {
      // eslint-disable-next-line no-console
      console.error(`Unknown tool: ${toolName}`);
      process.exit(2);
    }

    // Issue #3 — schema-aware coercion. tool.inputSchema 의 shape 으로 각 키의 expected type 확인.
    // 예: industryCode: ZodString → "41" 을 string 으로 보존 (Number 변환 X).
    const fieldKinds = extractFieldKinds(tool.inputSchema);
    const args = parseKeyValueArgs(cmd.args.slice(1), fieldKinds);
    // --inputJson 가 있으면 우선 사용. coerceArgValue 가 이미 객체로 파싱했을 수
    // 있으므로 타입 가드로 둘 다 처리한다.
    let input: unknown;
    if ("inputJson" in args) {
      const v = (args as Record<string, unknown>).inputJson;
      input = typeof v === "string" ? JSON.parse(v) : v;
    } else {
      input = args;
    }

    try {
      const result = attachCredits(await tool.handler(input));
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
      if (result.isError) process.exit(1);
    } catch (err) {
      const payload = toMcpErrorContent(err);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(payload, null, 2));
      process.exit(1);
    }
  });

// Issue #3 — inputSchema 의 shape 에서 각 키의 FieldKind 추출 (schema-aware coercion)
function extractFieldKinds(inputSchema: unknown): Record<string, FieldKind> {
  try {
    const shape = getObjectShape(inputSchema as any);
    if (!shape) return {};
    const out: Record<string, FieldKind> = {};
    for (const [key, fieldSchema] of Object.entries(shape)) {
      out[key] = getFieldKind(fieldSchema);
    }
    return out;
  } catch {
    return {};
  }
}

// --key value 를 받아서 각 값을 inputSchema 의 expected type 에 맞춰 coerce.
// Issue #3 fix — string 필드는 따옴표 입력을 보존 (number 자동 변환 X).
function parseKeyValueArgs(tokens: string[], fieldKinds: Record<string, FieldKind> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = tokens[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = coerceArgValue(next, fieldKinds[key]);
    i += 1;
  }
  return out;
}

function coerceArgValue(raw: string, expectedKind?: FieldKind): unknown {
  // Issue #3 — string 필드는 raw 그대로 보존 (인용부호 제거된 string 인자 보호)
  if (expectedKind === "string" || expectedKind === "enum") return raw;

  // inputJson 은 상위에서 별도 처리하므로 여기선 건너뜀
  // 1) boolean (string/enum 은 위에서 return — 나머지에서만 변환)
  if (raw === "true") return true;
  if (raw === "false") return false;
  // 2) JSON 리터럴 (배열/객체) — array/object 또는 unknown 일 때
  if (/^[\[{]/.test(raw) && (expectedKind === "array" || expectedKind === "object" || expectedKind === undefined || expectedKind === "unknown")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  // 3) 콤마 배열 (예: --sections 2,8)
  if (
    expectedKind === "array" &&
    raw.includes(",") &&
    !/[A-Za-z가-힣\s]/.test(raw)
  ) {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    return parts.map((p) => (isFiniteNumberString(p) ? Number(p) : p));
  }
  // 4) number 필드 — Number 변환
  if (expectedKind === "number" && isFiniteNumberString(raw)) return Number(raw);
  // 5) unknown 필드 (schema 미수집) — 기존 동작 유지 (BC 보존)
  if (expectedKind === undefined || expectedKind === "unknown") {
    if (raw.includes(",") && !/[A-Za-z가-힣\s]/.test(raw)) {
      const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
      return parts.map((p) => (isFiniteNumberString(p) ? Number(p) : p));
    }
    if (isFiniteNumberString(raw)) return Number(raw);
  }
  // 6) 그 외 문자열
  return raw;
}

function isFiniteNumberString(s: string): boolean {
  if (!/^-?\d+(\.\d+)?$/.test(s)) return false;
  return Number.isFinite(Number(s));
}

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
