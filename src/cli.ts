#!/usr/bin/env node
import { Command } from "commander";
import { SERVER_NAME, VERSION, PROVIDED_BY, DEVELOPED_BY } from "./version.js";
import { TOOLS, findTool, attachCredits } from "./tool-registry.js";
import { toMcpErrorContent } from "./lib/errors.js";

// 파일 최상단 상수 — CLI 서브커맨드 라벨
const CMD = {
  SERVE: "serve",
  TOOLS: "tools",
  CALL: "call",
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

program
  .command(CMD.TOOLS)
  .description("List registered MCP tools (grouped by category, --json for raw)")
  .option("--json", "JSON 덤프 모드 (기존 동작)")
  .option(
    "--no-key-required",
    "공공데이터 API 키 없이 바로 쓸 수 있는 도구만 표시",
  )
  .action((opts: { json?: boolean; keyRequired?: boolean }) => {
    const rows = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      category: categorizeTool(t.name),
      needsApiKey: TOOLS_NEEDING_API_KEY.has(t.name),
    }));
    const filtered = opts.keyRequired === false ? rows.filter((r) => !r.needsApiKey) : rows;

    if (opts.json) {
      // 출력 데이터: { name, description, category, needsApiKey: boolean }
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
        console.log(`  • ${it.name}${key}\n    ${short}${short.length >= 110 ? "…" : ""}`);
      }
      console.log("");
    }
    console.log("  🔑 = 공공데이터포털 API 키 필요 (DATA_GO_KR_KEY)");
    console.log("     '--no-key-required' 로 키 불필요 도구만 필터 / '--json' 으로 raw 덤프");
    /* eslint-enable no-console */
  });

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

    const args = parseKeyValueArgs(cmd.args.slice(1));
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

// --key value 를 받아서 각 값을 최대한 네이티브 타입으로 추정해 반환
// Zod schema 는 coerce 가 걸려 있으므로 런타임이 string 이어도 대부분 동작하지만,
// 배열이나 boolean 같은 경우 문자열로 넘어가면 schema 가 받지 못한다.
function parseKeyValueArgs(tokens: string[]): Record<string, unknown> {
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
    out[key] = coerceArgValue(next);
    i += 1;
  }
  return out;
}

function coerceArgValue(raw: string): unknown {
  // inputJson 은 상위에서 별도 처리하므로 여기선 건너뜀
  // 1) boolean
  if (raw === "true") return true;
  if (raw === "false") return false;
  // 2) JSON 리터럴 (배열/객체/숫자/문자열)
  if (/^[\[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  // 3) 콤마 배열 (예: --sections 2,8)
  if (raw.includes(",") && !/[A-Za-z가-힣\s]/.test(raw)) {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    return parts.map((p) => (isFiniteNumberString(p) ? Number(p) : p));
  }
  // 4) 순수 숫자
  if (isFiniteNumberString(raw)) return Number(raw);
  // 5) 그 외 문자열
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
