#!/usr/bin/env tsx
/**
 * test-mcp-protocol-eras.ts — MCP 서버가 두 세대의 프로토콜을 모두 받는지 확인 (네트워크 없음)
 *
 * 빌드된 서버(build/index.js)를 stdio 로 띄워 실제 클라이언트로 접속한다.
 *   1. 이전 세대(2025 계열, initialize 핸드셰이크) 클라이언트
 *   2. 현행 세대(2026-07-28, 핸드셰이크 없음) 로 고정한 클라이언트
 * 두 세대에서 다음이 같아야 한다:
 *   - 도구 정의 전체(이름·설명·입력 스키마 — 현행 세대가 덧붙이는 스키마 방언 표지 `$schema` 제외)
 *   - 리소스 목록과 모든 리소스의 본문
 *   - 필수 입력이 없는 조회 도구의 호출 결과 (부작용·외부 호출이 있는 도구는 부르지 않는다)
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "..", "..", "build", "index.js");
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const EXPECTED_TOOL_COUNT_MIN = 90;
/** 호출 비교 대상 — 읽기만 하는 조회 도구(이름 접두) 중 필수 입력이 없는 것 */
const READ_ONLY_PREFIXES = ["list_", "get_", "choose_"];
/** 실행 시각·경로처럼 호출마다 달라지는 값이 든 결과는 비교에서 뺀다 */
const VOLATILE_TOOLS = new Set(["get_storage_stats", "get_project_info"]);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface EraResult {
  era: string | undefined;
  protocolVersion: string | undefined;
  toolNames: string[];
  /** 도구 정의 전체(직렬화) */
  toolDefinitions: string;
  resourceUris: string[];
  /** 리소스 uri → 본문(직렬화) */
  resourceBodies: Record<string, string>;
  /** 도구 이름 → 호출 결과(직렬화) */
  callResults: Record<string, string>;
}

async function connectAndProbe(options: ConstructorParameters<typeof Client>[1]): Promise<EraResult> {
  const client = new Client({ name: "era-test", version: "1.0.0" }, options);
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY], stderr: "ignore" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const resources = await client.listResources();
    const resourceBodies: Record<string, string> = {};
    for (const r of resources.resources) {
      const read = await client.readResource({ uri: r.uri });
      resourceBodies[r.uri] = JSON.stringify(read.contents);
    }
    const callResults: Record<string, string> = {};
    for (const t of tools.tools) {
      const required = (t.inputSchema as { required?: string[] }).required ?? [];
      if (required.length > 0 || VOLATILE_TOOLS.has(t.name)) continue;
      if (!READ_ONLY_PREFIXES.some((prefix) => t.name.startsWith(prefix))) continue;
      const called = await client.callTool({ name: t.name, arguments: {} });
      callResults[t.name] = JSON.stringify({ content: called.content, isError: called.isError ?? false });
    }
    return {
      era: client.getProtocolEra(),
      protocolVersion: client.getNegotiatedProtocolVersion(),
      toolNames: tools.tools.map((t) => t.name),
      // 현행 세대는 입력 스키마에 JSON Schema 방언 표지($schema)를 덧붙여 보낸다 — 그 표지만 빼고 비교한다
      toolDefinitions: JSON.stringify(
        tools.tools.map((t) => {
          const { $schema: _dialect, ...inputSchema } = t.inputSchema as Record<string, unknown>;
          return { name: t.name, title: t.title, description: t.description, inputSchema };
        }),
      ),
      resourceUris: resources.resources.map((r) => r.uri),
      resourceBodies,
      callResults,
    };
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const legacy = await connectAndProbe(undefined);
  check("이전 세대로 접속됨", legacy.era === "legacy", String(legacy.era));
  check("이전 세대: 도구 목록", legacy.toolNames.length >= EXPECTED_TOOL_COUNT_MIN, String(legacy.toolNames.length));
  const calledTools = Object.keys(legacy.callResults);
  check("이전 세대: 조회 도구를 실제로 불렀음", calledTools.length > 0);
  check("이전 세대: 리소스 본문을 실제로 읽었음", legacy.resourceUris.length > 0 && Object.values(legacy.resourceBodies).every((b) => b.length > 2));

  const modern = await connectAndProbe({ versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } } });
  check("현행 세대로 접속됨", modern.era === "modern", String(modern.era));
  check("현행 세대: 협상된 버전", modern.protocolVersion === MODERN_PROTOCOL_VERSION, String(modern.protocolVersion));
  check("도구 정의(이름·설명·입력 스키마)가 두 세대에서 같음", modern.toolDefinitions === legacy.toolDefinitions);
  check("리소스 목록이 두 세대에서 같음", JSON.stringify(modern.resourceUris) === JSON.stringify(legacy.resourceUris));
  const differingResources = legacy.resourceUris.filter((uri) => modern.resourceBodies[uri] !== legacy.resourceBodies[uri]);
  check("모든 리소스 본문이 두 세대에서 같음", differingResources.length === 0, differingResources.slice(0, 3).join(", "));
  const differingCalls = calledTools.filter((name) => modern.callResults[name] !== legacy.callResults[name]);
  check("조회 도구 호출 결과가 두 세대에서 같음", differingCalls.length === 0, differingCalls.slice(0, 5).join(", "));

  console.log(
    `[mcp-eras] 이전 세대 ${legacy.protocolVersion} · 현행 세대 ${modern.protocolVersion} · 도구 정의 ${legacy.toolNames.length}개 · 리소스 본문 ${legacy.resourceUris.length}건 · 호출 비교 ${calledTools.length}개 도구`,
  );
  console.log(`[mcp-eras] ${pass} 통과 / ${fail} 실패`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
