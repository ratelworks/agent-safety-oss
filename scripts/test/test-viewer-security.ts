#!/usr/bin/env tsx
/**
 * test-viewer-security.ts — 브라우저 입력 폼 서버의 접근 경계 회귀 시험
 *
 *   1. 요청 판정(Host·Origin·교차 사이트) — 순수 함수
 *   2. 실제 서버: 이 컴퓨터 주소로만 열리는지, 잘못된 Host·Origin 은 403, 큰 본문은 413
 *
 * 미리보기 HTML 정화는 브라우저 DOM 이 있어야 해서 여기서 시험하지 않는다.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requestRejection } from "../../src/viewer.js";

// ── 상수 ────────────────────────────────────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 20000 + Math.floor(Math.random() * 20000);
const START_TIMEOUT_MS = 30_000;
const OVERSIZED_BODY_BYTES = 2 * 1024 * 1024;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Reply { status: number; body: string }

function send(options: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolvePromise, reject) => {
    const req = request(
      { host: "127.0.0.1", port: PORT, method: options.method ?? "GET", path: options.path ?? "/", headers: options.headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function canConnect(host: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port: PORT, timeout: 1500 });
    socket.once("connect", () => { socket.destroy(); resolvePromise(true); });
    socket.once("error", () => resolvePromise(false));
    socket.once("timeout", () => { socket.destroy(); resolvePromise(false); });
  });
}

async function waitUntilUp(): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await canConnect("127.0.0.1")) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("viewer 서버가 시간 안에 뜨지 않음");
}

function testDecision(): void {
  const ok = { host: "localhost:5174" };
  check("localhost Host 허용", requestRejection(ok, 5174) === null);
  check("127.0.0.1 Host 허용", requestRejection({ host: "127.0.0.1:5174" }, 5174) === null);
  check("같은 주소 Origin 허용", requestRejection({ ...ok, origin: "http://localhost:5174" }, 5174) === null);
  check("다른 Host 거절", requestRejection({ host: "evil.example:5174" }, 5174) !== null);
  check("다른 포트 Host 거절", requestRejection({ host: "localhost:9999" }, 5174) !== null);
  check("Host 없음 거절", requestRejection({}, 5174) !== null);
  check("다른 Origin 거절", requestRejection({ ...ok, origin: "http://evil.example" }, 5174) !== null);
  check("null Origin 거절", requestRejection({ ...ok, origin: "null" }, 5174) !== null);
  check("교차 사이트 표시 거절", requestRejection({ ...ok, "sec-fetch-site": "cross-site" }, 5174) !== null);
  check("같은 출처 표시 허용", requestRejection({ ...ok, "sec-fetch-site": "same-origin" }, 5174) === null);
}

async function testServer(): Promise<void> {
  const child: ChildProcess = spawn("npx", ["tsx", "src/viewer.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), AGENT_SAFETY_NO_OPEN: "1" },
    stdio: "ignore",
  });
  try {
    await waitUntilUp();
    const home = await send({ headers: { Host: `localhost:${PORT}` } });
    check("정상 요청은 화면을 돌려줌", home.status === 200 && home.body.includes("<!doctype html>"), String(home.status));

    const badHost = await send({ headers: { Host: `evil.example:${PORT}` } });
    check("다른 Host 는 403", badHost.status === 403, String(badHost.status));

    const badOrigin = await send({
      method: "POST",
      path: "/api/clear",
      headers: { Host: `localhost:${PORT}`, Origin: "http://evil.example", "Content-Type": "application/json" },
      body: "{}",
    });
    check("다른 Origin 의 초기화 요청은 403", badOrigin.status === 403, String(badOrigin.status));

    const big = await send({
      method: "POST",
      path: "/api/draft/save",
      headers: { Host: `localhost:${PORT}`, Origin: `http://localhost:${PORT}`, "Content-Type": "application/json" },
      body: "x".repeat(OVERSIZED_BODY_BYTES),
    });
    check("큰 본문은 413", big.status === 413, String(big.status));

    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (lan) check(`다른 기기용 주소(${lan})로는 접속되지 않음`, !(await canConnect(lan)));
    else console.log("  (외부용 네트워크 주소가 없어 바인딩 확인은 건너뜀)");
  } finally {
    child.kill("SIGTERM");
  }
}

testDecision();
await testServer();
console.log(`[viewer-security] ${pass} 통과 / ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
