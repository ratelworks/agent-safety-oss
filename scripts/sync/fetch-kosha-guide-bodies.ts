#!/usr/bin/env tsx
/**
 * fetch-kosha-guide-bodies.ts
 *
 * 1,039 KOSHA Guide 본문 PDF 를 data.go.kr 15144147 API 로 받아
 * pdftotext 로 변환 후 src/ontology/kosha-guides/{guideNo}.md 로 저장.
 *
 * 사전:
 *   - .env 에 DATA_GO_KR_KEY 설정 (라텔웍스 운영 키)
 *   - pdftotext 설치 (brew install poppler)
 *
 * 사용:
 *   KOSHA_RELAY_URL="" tsx scripts/sync/fetch-kosha-guide-bodies.ts
 *   KOSHA_RELAY_URL="" tsx scripts/sync/fetch-kosha-guide-bodies.ts --start 500 --limit 100
 *
 * 재실행 시 이미 존재하는 MD 는 skip (idempotent).
 *
 * 라이선스: KOSHA Guide 본문은 공공누리 (출처표시·변경금지). MD 헤더에 출처 명시.
 */
import { readFile, writeFile, mkdir, access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
const OUT_DIR = resolve(ROOT, "src/ontology/kosha-guides");
const TMP_DIR = "/tmp/kosha-pdfs";
const RATE_LIMIT_MS = 400; // 0.4s/건 (KOSHA portal 부담 최소화)

const args = process.argv.slice(2);
function getArg(name: string, def: number): number {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = parseInt(args[i + 1] ?? "", 10);
  return isNaN(v) ? def : v;
}
const START = getArg("start", 0);
const LIMIT = getArg("limit", 9999);
const FORCE = args.includes("--force"); // 기존 MD 덮어쓰기 (kordoc 재추출 모드)

interface GuideMeta {
  guideNo: string;
  title: string;
  category?: string;
}

async function exists(p: string): Promise<boolean> {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function runCmd(cmd: string, args: string[], opts: { env?: Record<string, string>; timeout?: number } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = opts.timeout ? setTimeout(() => child.kill(), opts.timeout) : null;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      res({ stdout, stderr, code: code ?? 1 });
    });
  });
}

// 본 helper 는 legacy fetch path. 현 안정판은 KOSHA Guide 1,039건 번들 통합 + get_kosha_guide_md 도구로 직접 접근.
// 본 스크립트 (라텔웍스 운영자용 — 신규 가이드 PDF 번들 보강) 는 다음 중 한 방법으로 마이그레이션 필요:
//   1) Live API 15144147 직접 호출 (axios/fetch + DATA_GO_KR_KEY 환경변수)
//   2) build/cli.js call 옵션을 동적으로 fetch (라텔웍스 운영 RELAY 직접 호출)
// 임시: 호출 시 명시적 에러 반환. 라텔웍스 운영자는 별도 절차 (kosha-guide-map.json + sync 스크립트 단독 복원) 사용.
async function fetchDownloadUrl(guideNo: string): Promise<string | null> {
  console.error(`[DEPRECATED] fetchDownloadUrl(${guideNo}) — legacy. 본문은 src/ontology/kosha-guides/ 번들 또는 Live API 직접 호출.`);
  return null;
  // eslint-disable-next-line @typescript-eslint/no-unreachable-code
  const out = await runCmd(
    "node",
    // 본 라인은 마이그레이션 대기 (legacy fetch path; 안정판은 번들 통합).
    ["build/cli.js", "call", "DEPRECATED_TOOL_PLACEHOLDER", "--inputJson", JSON.stringify({ techGdlnNo: guideNo, numOfRows: 1 })],
    { env: { KOSHA_RELAY_URL: "" }, timeout: 30000 },
  );
  if (out.code !== 0) return null;
  // stdout 첫 줄은 banner ("[agent-safety-oss v...]"), 그 다음부터 multi-line JSON
  const lines = out.stdout.split("\n");
  const jsonStart = lines.findIndex((l) => l.trim().startsWith("{"));
  if (jsonStart < 0) return null;
  const jsonText = lines.slice(jsonStart).join("\n");
  try {
    const top = JSON.parse(jsonText);
    const payload = JSON.parse(top.content?.[0]?.text ?? "{}");
    return payload.results?.[0]?.fileDownloadUrl ?? null;
  } catch { return null; }
}

async function downloadPdf(url: string, dest: string): Promise<boolean> {
  const out = await runCmd("curl", ["-sL", "--max-time", "30", "-o", dest, url], { timeout: 45000 });
  if (out.code !== 0) return false;
  return exists(dest);
}

async function pdfToText(pdfPath: string): Promise<string> {
  // pdftotext → kordoc 전환 (HTML 표 보존 + markdown 헤더로 정보 손실 최소화).
  // kordoc 가 PDF 의 표지·내부 표를 <table> 로 보존하여 5-10% 정보 추가 추출.
  const tmpMdPath = pdfPath.replace(/\.pdf$/, ".kordoc.md");
  const out = await runCmd("npx", ["kordoc", pdfPath, "-o", tmpMdPath], { timeout: 90000 });
  if (out.code !== 0) return "";
  try {
    return await readFile(tmpMdPath, "utf8");
  } catch {
    return "";
  }
}

function compileMd(g: GuideMeta, text: string, sourceUrl: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `# ${g.title}`,
    "",
    `> **출처**: 한국산업안전보건공단 (KOSHA)`,
    `> **지침번호**: ${g.guideNo}`,
    `> **원본 URL**: ${sourceUrl}`,
    `> **License**: 공공누리 출처표시 (변경금지)`,
    `> **추출 방식**: PDF → kordoc (라텔웍스 자체 도구, HTML 표 보존, ${today})`,
    `> **주의**: 이미지·일부 시각적 서식 손실 가능. 정확 원본은 위 URL.`,
    "",
    "---",
    "",
    "```markdown",
    text.trim(),
    "```",
    "",
  ].join("\n");
}

async function loadGuideList(): Promise<GuideMeta[]> {
  const files = (await readdir(GUIDES_DIR)).filter((f) => f.endsWith(".jsonld")).sort();
  const out: GuideMeta[] = [];
  for (const f of files) {
    try {
      const d = JSON.parse(await readFile(resolve(GUIDES_DIR, f), "utf8"));
      const guideNo = d._meta?.guideNo;
      const title = d.title;
      const category = d._meta?.guideCategory;
      if (guideNo && title) out.push({ guideNo, title, category });
    } catch { /* skip */ }
  }
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });

  const guides = await loadGuideList();
  console.log(`총 ${guides.length} 가이드 발견`);
  console.log(`처리 범위: ${START} ~ ${Math.min(START + LIMIT, guides.length)}\n`);

  let ok = 0, skip = 0, fail = 0;
  const failures: Array<{ guideNo: string; reason: string }> = [];
  const startTime = Date.now();

  const slice = guides.slice(START, START + LIMIT);
  for (let i = 0; i < slice.length; i += 1) {
    const g = slice[i];
    const mdPath = resolve(OUT_DIR, `${g.guideNo}.md`);
    const idx = START + i + 1;

    if (!FORCE && await exists(mdPath)) {
      skip += 1;
      continue;
    }

    const url = await fetchDownloadUrl(g.guideNo);
    if (!url) {
      fail += 1;
      failures.push({ guideNo: g.guideNo, reason: "fileDownloadUrl 없음" });
      continue;
    }

    const pdfPath = resolve(TMP_DIR, `${g.guideNo}.pdf`);
    const dlOk = await downloadPdf(url, pdfPath);
    if (!dlOk) {
      fail += 1;
      failures.push({ guideNo: g.guideNo, reason: "PDF 다운로드 실패" });
      continue;
    }

    const text = await pdfToText(pdfPath);
    if (!text.trim() || text.length < 100) {
      fail += 1;
      failures.push({ guideNo: g.guideNo, reason: `text 추출 실패 (${text.length} chars)` });
      continue;
    }

    const md = compileMd(g, text, url);
    await writeFile(mdPath, md, "utf8");
    ok += 1;

    if (idx % 20 === 0 || idx === guides.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (ok + skip + fail) / parseInt(elapsed) || 0;
      const eta = ((guides.length - idx) / Math.max(rate, 0.1)).toFixed(0);
      console.log(`  [${idx}/${guides.length}] OK ${ok} SKIP ${skip} FAIL ${fail} · ${elapsed}s 경과 · ETA ${eta}s`);
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  // 실패 보고서
  if (failures.length > 0) {
    const reportPath = resolve(OUT_DIR, "_FAILURES.json");
    await writeFile(reportPath, JSON.stringify(failures, null, 2), "utf8");
    console.log(`\n실패 ${failures.length}건 — ${reportPath}`);
  }

  console.log(`\n=== 최종 ===`);
  console.log(`  성공: ${ok}`);
  console.log(`  skip (기존): ${skip}`);
  console.log(`  실패: ${fail}`);
  console.log(`  처리시간: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
