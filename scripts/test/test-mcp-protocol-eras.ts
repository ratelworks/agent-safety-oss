#!/usr/bin/env tsx
/**
 * test-mcp-protocol-eras.ts — MCP 서버가 두 세대의 프로토콜을 모두 받는지 확인 (네트워크 없음)
 *
 * 빌드된 서버(build/index.js)를 stdio 로 띄워 실제 클라이언트로 접속한다.
 *   1. 이전 세대(2025 계열, initialize 핸드셰이크) 클라이언트
 *   2. 현행 세대(2026-07-28, 핸드셰이크 없음) 로 고정한 클라이언트
 * 각 세대에서 도구 목록·도구 호출·리소스 목록이 같은 결과를 내야 한다.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "..", "..", "build", "index.js");
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const SAMPLE_TOOL = "list_kras_methods";
const EXPECTED_TOOL_COUNT_MIN = 90;

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
  resourceCount: number;
  toolText: string;
}

async function connectAndProbe(options: ConstructorParameters<typeof Client>[1]): Promise<EraResult> {
  const client = new Client({ name: "era-test", version: "1.0.0" }, options);
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY], stderr: "ignore" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const resources = await client.listResources();
    const called = await client.callTool({ name: SAMPLE_TOOL, arguments: {} });
    const first = (called.content as Array<{ type: string; text?: string }> | undefined)?.[0];
    return {
      era: client.getProtocolEra(),
      protocolVersion: client.getNegotiatedProtocolVersion(),
      toolNames: tools.tools.map((t) => t.name),
      resourceCount: resources.resources.length,
      toolText: first?.text ?? "",
    };
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const legacy = await connectAndProbe(undefined);
  check("이전 세대로 접속됨", legacy.era === "legacy", String(legacy.era));
  check("이전 세대: 도구 목록", legacy.toolNames.length >= EXPECTED_TOOL_COUNT_MIN, String(legacy.toolNames.length));
  check("이전 세대: 도구 호출 결과", legacy.toolText.length > 0);

  const modern = await connectAndProbe({ versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } } });
  check("현행 세대로 접속됨", modern.era === "modern", String(modern.era));
  check("현행 세대: 협상된 버전", modern.protocolVersion === MODERN_PROTOCOL_VERSION, String(modern.protocolVersion));
  check("현행 세대: 도구 목록이 이전 세대와 같음", JSON.stringify(modern.toolNames) === JSON.stringify(legacy.toolNames));
  check("현행 세대: 리소스 수가 이전 세대와 같음", modern.resourceCount === legacy.resourceCount && modern.resourceCount > 0);
  check("현행 세대: 도구 호출 결과가 이전 세대와 같음", modern.toolText === legacy.toolText);

  console.log(
    `[mcp-eras] 이전 세대 ${legacy.protocolVersion} · 현행 세대 ${modern.protocolVersion} · 도구 ${legacy.toolNames.length}개 · 리소스 ${legacy.resourceCount}개`,
  );
  console.log(`[mcp-eras] ${pass} 통과 / ${fail} 실패`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
