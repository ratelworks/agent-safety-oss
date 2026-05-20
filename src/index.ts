#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  SERVER_NAME,
  SERVER_DESCRIPTION,
  VERSION,
  PROVIDED_BY,
  DEVELOPED_BY,
} from "./version.js";
import { registerAllTools } from "./tool-registry.js";
import { registerSkeletonResources } from "./resources/skeleton-context.js";
import { registerCapabilities } from "./capability-registry.js";

// 파일 최상단 상수 — 이 진입점은 stdio 전송만 담당
// HTTP 전송은 향후 별도 엔트리(src/server/http.ts)에서 제공 예정
// No-Lock-In Principle (PLAN §0.5): tools + resources 양쪽 capability 등록 →
// Claude Desktop / Codex CLI / MCP Inspector 어느 하네스에서든 호환

async function main(): Promise<void> {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: VERSION,
    },
    {
      instructions: SERVER_DESCRIPTION,
      capabilities: { tools: {}, resources: {} },
    },
  );

  registerAllTools(server);
  registerSkeletonResources(server);
  registerCapabilities(server);  // v1.2.2: capability registry → MCP Resource `safety://graph/capabilities`
                                 // LLM 이 도구 선택 시 capability node 통해 traversal 가능 (외부 평가 P0-1)

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr로만 상태 로그 출력 (stdout은 MCP 프로토콜 전용)
  /* eslint-disable no-console */
  console.error(`[${SERVER_NAME}] v${VERSION} — stdio transport ready`);
  console.error(`  제공: ${PROVIDED_BY}`);
  console.error(`  개발: ${DEVELOPED_BY}`);
  /* eslint-enable no-console */
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});
