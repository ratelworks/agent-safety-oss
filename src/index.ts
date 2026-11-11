#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
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

/** 연결 하나를 맡을 서버 인스턴스를 만든다 — 도구·리소스·capability 등록 포함 */
function buildServer(): McpServer {
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
  registerCapabilities(server);  // capability registry → MCP Resource `safety://graph/capabilities`
                                 // LLM 이 도구 선택 시 capability node 통해 traversal 가능 (외부 평가 P0-1)
  return server;
}

async function main(): Promise<void> {
  // serveStdio 가 전송을 맡고, 연결을 여는 첫 교환으로 프로토콜 세대를 정한다 —
  // 2026-07-28 규격(핸드셰이크 없음)과 그 이전 규격(initialize) 클라이언트를 모두 받는다.
  serveStdio(buildServer);

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
