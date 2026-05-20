#!/usr/bin/env tsx
/**
 * A2UI 로컬 동작 검증용 백엔드 서버.
 *
 * 엔드포인트:
 *   GET  /                      → A2UI viewer HTML
 *   GET  /viewer.js             → JSONL → DOM 렌더링 JS
 *   GET  /form.jsonl            → work-plan A2UI JSONL
 *   POST /api/save              → 폼 데이터 저장 (storage/{id}.json)
 *   GET  /api/load/<id>         → 저장된 데이터 재로드
 *   GET  /api/list              → 저장된 모든 submission 목록
 *   GET  /api/health            → 서버 상태
 *
 * 저장 위치: ./storage/*.json (영구, 서버 재시작 후도 유지)
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const STORAGE_DIR = join(ROOT, "storage");
const JSONL_SOURCE = resolve(dirname(ROOT), "reports/a2ui-work-plan-form.jsonl");

if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });

function logMessage(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8);
  process.stderr.write(`[${ts}] ${msg}\n`);
}

function setCorsHeaders(res: any): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function send(res: any, status: number, body: string | Buffer | object, contentType = "application/json; charset=utf-8"): void {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  setCorsHeaders(res);
  let bodyBytes: Buffer;
  if (typeof body === "string") {
    bodyBytes = Buffer.from(body, "utf8");
  } else if (Buffer.isBuffer(body)) {
    bodyBytes = body;
  } else {
    bodyBytes = Buffer.from(JSON.stringify(body, null, 2), "utf8");
  }
  res.setHeader("Content-Length", String(bodyBytes.length));
  res.end(bodyBytes);
}

function serveFile(res: any, filename: string, contentType: string): void {
  const filePath = join(ROOT, filename);
  if (!existsSync(filePath)) {
    return send(res, 404, { error: `${filename} not found` });
  }
  send(res, 200, readFileSync(filePath, "utf8"), contentType);
}

function readBody(req: any): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

const server = createServer(async (req, res) => {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;

  logMessage(`${method} ${pathname}`);

  if (method === "OPTIONS") {
    res.statusCode = 204;
    setCorsHeaders(res);
    return res.end();
  }

  if (method === "GET") {
    if (pathname === "/" || pathname === "/index.html") {
      return serveFile(res, "index.html", "text/html; charset=utf-8");
    }
    if (pathname === "/viewer.js") {
      return serveFile(res, "viewer.js", "application/javascript; charset=utf-8");
    }
    if (pathname === "/form.jsonl") {
      if (!existsSync(JSONL_SOURCE)) return send(res, 404, { error: "form.jsonl not found" });
      return send(res, 200, readFileSync(JSONL_SOURCE, "utf8"), "application/jsonl; charset=utf-8");
    }
    if (pathname === "/api/health") {
      return send(res, 200, {
        ok: true,
        storageDir: STORAGE_DIR,
        submissions: readdirSync(STORAGE_DIR).length,
      });
    }
    if (pathname === "/api/list") {
      const items: Array<{ id: string; submittedAt: string; workName: string; sizeBytes: number }> = [];
      for (const f of readdirSync(STORAGE_DIR).sort()) {
        if (!f.endsWith(".json")) continue;
        try {
          const filePath = join(STORAGE_DIR, f);
          const d = JSON.parse(readFileSync(filePath, "utf8"));
          items.push({
            id: d.id,
            submittedAt: d.submittedAt,
            workName: String(d.input?.workName || "").slice(0, 60),
            sizeBytes: statSync(filePath).size,
          });
        } catch { /* skip corrupt */ }
      }
      return send(res, 200, { items, count: items.length });
    }
    if (pathname.startsWith("/api/load/")) {
      const subId = pathname.split("/").pop() || "";
      const filePath = join(STORAGE_DIR, `${subId}.json`);
      if (!existsSync(filePath)) return send(res, 404, { error: "not found" });
      return send(res, 200, JSON.parse(readFileSync(filePath, "utf8")));
    }
    return send(res, 404, { error: "not found" });
  }

  if (method === "POST" && pathname === "/api/save") {
    const body = await readBody(req);
    let data: any;
    try {
      data = body ? JSON.parse(body) : {};
    } catch (e) {
      return send(res, 400, { error: `invalid JSON: ${(e as Error).message}` });
    }
    const subId: string = data.id || randomBytes(6).toString("hex");
    data.id = subId;
    data.submittedAt = new Date().toISOString();
    data.action = data.action || "submit_work_plan";

    const filePath = join(STORAGE_DIR, `${subId}.json`);
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");

    return send(res, 200, {
      success: true,
      id: subId,
      submittedAt: data.submittedAt,
      storedAt: filePath,
      sizeBytes: statSync(filePath).size,
    });
  }

  return send(res, 404, { error: "not found" });
});

const port = parseInt(process.env.PORT || "5555", 10);
server.listen(port, "127.0.0.1", () => {
  console.log(`A2UI 로컬 서버 시작: http://127.0.0.1:${port}`);
  console.log(`저장 위치: ${STORAGE_DIR}`);
  console.log(`종료: Ctrl+C`);
});

process.on("SIGINT", () => {
  console.log("\n서버 종료");
  server.close(() => process.exit(0));
});
