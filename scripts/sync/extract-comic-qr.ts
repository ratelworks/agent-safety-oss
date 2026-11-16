#!/usr/bin/env tsx
/**
 * extract-comic-qr.ts — 공단 「만화로 보는 산업안전보건기준에 관한 규칙」 PDF 의 조문 쪽 QR 을 읽어, QR 마다 어느 조문 옆에 인쇄됐는지 정한다
 *
 * 개발자 전용 (외부 도구 필요: poppler 의 pdftoppm·pdftotext, zbar 의 zbarimg). 결과는 scripts/sync/kosha-comic-qr.json.
 *
 * 절차
 *   1. 쪽마다 그림으로 바꿔(pdftoppm) QR 을 읽는다(zbarimg --xml) — 위치는 쪽 크기 대비 % (QR 중심)
 *      한 해상도에서 못 읽는 QR 이 있어 여러 해상도로 읽고 위치로 합친다
 *   2. 쪽의 글자 좌표(pdftotext -bbox-layout)에서 조문 제목("제N조(…)" · 원문 표기 "제N조2(…)" = 제N조의2)을 찾는다
 *   3. QR 을 조문에 붙인다 — 이 책은 조문마다 상자가 있고 제목이 상자 왼쪽 위, QR 이 상자 안 오른쪽 아래에 있다.
 *      상자는 전체 폭이거나 좌우 반 폭이므로, QR 과 같은 단에서 QR 보다 위에 있는 가장 가까운 제목의 조문이 그 QR 의 조문이다.
 *      쪽의 첫 제목보다 위에 있는 QR 과, 글은 있는데 조문 제목이 없는 쪽의 QR 은 앞에서 이어지는 조문
 *      (가장 최근에 제목이 있던 쪽의 같은 단 마지막 제목)이다. 글자가 없는 쪽(책 안내 쪽 등)의 QR 은 조문에 붙이지 않는다.
 *
 * 사용
 *   tsx scripts/sync/extract-comic-qr.ts --pdf <PDF 경로> [--pages 1-344]
 *   tsx scripts/sync/extract-comic-qr.ts --pdf <PDF 경로> --reassign   # 이미 읽은 QR(kosha-comic-qr.json)은 두고 조문 짝만 다시 정한다
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "kosha-comic-qr.json");
/** QR 을 읽는 해상도들 — 한 해상도에서 못 읽는 QR 이 있어 여러 번 읽는다 */
const DPIS = [300, 150, 600];
/** 같은 QR 로 보는 위치 차이(%) */
const SAME_QR_PCT = 1.5;
/** 제목 x 가 이보다 크면(%) 오른쪽 반 단 상자 */
const RIGHT_COLUMN_X = 45;
/** 같은 줄로 보는 제목 y 차이(%) */
const SAME_ROW_DY = 1.5;
const SOURCE = {
  title: "만화로 보는 산업안전보건기준에 관한 규칙 (2026)",
  publisher: "한국산업안전보건공단",
  publicationNo: "2025-교육혁신실-1407",
  url: "https://www.kosha.or.kr/ebook/fcatalog/include/comic_rule_detail.jsp?ccate=0702010000&sdir=647&cimg=",
  license: "공공누리 제4유형 (출처표시·상업적 이용 금지·변경 금지)",
};

interface Qr {
  url: string;
  x: number;
  y: number;
}
interface Heading {
  num: string;
  title: string;
  x: number;
  y: number;
  col: [number, number];
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

/** PNG 머리에서 그림 크기 */
function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function readQrs(pdf: string, page: number, tmp: string): Qr[] {
  const found: Qr[] = [];
  for (const dpi of DPIS) {
    const prefix = join(tmp, `p${page}-${dpi}`);
    run("pdftoppm", ["-r", String(dpi), "-f", String(page), "-l", String(page), "-png", pdf, prefix]);
    const png = readdirSync(tmp).map((f) => join(tmp, f)).find((f) => f.startsWith(prefix) && f.endsWith(".png"));
    if (!png) continue;
    const { w, h } = pngSize(png);
    let xml = "";
    try {
      xml = run("zbarimg", ["-q", "--xml", png]);
    } catch {
      xml = ""; // 읽은 QR 이 없으면 zbarimg 는 0 이 아닌 값으로 끝난다
    }
    rmSync(png);
    for (const m of xml.matchAll(/<symbol type='QR-Code'[^>]*><polygon points='([^']+)'\/><data><!\[CDATA\[([\s\S]*?)\]\]><\/data>/g)) {
      const pts = m[1].trim().split(/\s+/).map((p) => p.split(",").map(Number));
      const x = (pts.reduce((s, p) => s + p[0], 0) / pts.length / w) * 100;
      const y = (pts.reduce((s, p) => s + p[1], 0) / pts.length / h) * 100;
      if (!found.some((q) => Math.abs(q.x - x) < SAME_QR_PCT && Math.abs(q.y - y) < SAME_QR_PCT)) found.push({ url: m[2].trim(), x, y });
    }
  }
  return found;
}

/** 쪽에 글자가 있는가 — 글자 없는 쪽(그림만 있는 안내 쪽)은 이어지는 조문으로 보지 않는다 */
function hasText(pdf: string, page: number): boolean {
  return run("pdftotext", ["-f", String(page), "-l", String(page), pdf, "-"]).replace(/\s/g, "").length > 0;
}

function readHeadings(pdf: string, page: number): Heading[] {
  const html = run("pdftotext", ["-bbox-layout", "-f", String(page), "-l", String(page), pdf, "-"]);
  const size = html.match(/<page width="([\d.]+)" height="([\d.]+)"/);
  if (!size) return [];
  const [W, H] = [Number(size[1]), Number(size[2])];
  const out: Heading[] = [];
  for (const ln of html.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([\s\S]*?)<\/line>/g)) {
    const words = [...ln[3].matchAll(/>([^<]*)<\/word>/g)].map((w) => w[1].replace(/&amp;/g, "&")).join(" ");
    const m = words.match(/^\s*제\s*(\d+)\s*조\s*(?:의\s*)?(\d+)?\s*\(([^)]*)/);
    if (m) out.push({ num: m[2] ? `${m[1]}의${m[2]}` : m[1], title: m[3].trim(), x: (Number(ln[1]) / W) * 100, y: (Number(ln[2]) / H) * 100, col: [0, 100] });
  }
  for (const h of out) {
    if (h.x > RIGHT_COLUMN_X) h.col = [50, 100];
    else if (out.some((o) => o !== h && o.x > RIGHT_COLUMN_X && Math.abs(o.y - h.y) < SAME_ROW_DY)) h.col = [0, 50];
  }
  return out;
}

function inColumn(h: Heading, x: number): boolean {
  return h.col[0] <= x && x <= h.col[1];
}

function assign(headings: Heading[], previous: Heading[], q: Qr, pageHasText: boolean): { heading: Heading | null; method: string } {
  const above = headings.filter((h) => h.y < q.y && inColumn(h, q.x));
  if (above.length) return { heading: above.reduce((a, b) => (b.y > a.y ? b : a)), method: "같은 상자(위쪽 제목)" };
  if (!headings.length && !pageHasText) return { heading: null, method: "글자 없는 안내 쪽" };
  const prev = previous.filter((h) => inColumn(h, q.x));
  const pool = prev.length ? prev : previous;
  if (!pool.length) return { heading: null, method: "앞쪽 제목 없음" };
  return { heading: pool.reduce((a, b) => (b.y > a.y || (b.y === a.y && b.x > a.x) ? b : a)), method: "앞쪽에서 이어지는 조문" };
}

function main(): void {
  const pdfIdx = process.argv.indexOf("--pdf");
  if (pdfIdx < 0) {
    console.error("사용: tsx scripts/sync/extract-comic-qr.ts --pdf <PDF 경로> [--pages 1-344]");
    process.exit(2);
  }
  const pdf = resolve(process.argv[pdfIdx + 1]);
  const pagesArg = process.argv.includes("--pages") ? process.argv[process.argv.indexOf("--pages") + 1] : null;
  const total = Number(run("pdfinfo", [pdf]).match(/Pages:\s+(\d+)/)?.[1] ?? 0);
  const [from, to] = pagesArg ? pagesArg.split("-").map(Number) : [1, total];
  const reassign = process.argv.includes("--reassign");
  // --reassign: 이미 읽은 QR 을 쪽별로 다시 쓴다 (판독은 쪽마다 여러 해상도라 오래 걸린다)
  const known = new Map<number, Qr[]>();
  if (reassign) {
    for (const o of (JSON.parse(readFileSync(OUT, "utf-8")) as { occurrences: (Qr & { page: number })[] }).occurrences) {
      known.set(o.page, [...(known.get(o.page) ?? []), { url: o.url, x: o.x, y: o.y }]);
    }
  }
  const tmp = mkdtempSync(join(tmpdir(), "comic-qr-"));
  const occurrences: Record<string, unknown>[] = [];
  // 가장 최근에 조문 제목이 있던 쪽의 제목들 — 제목 없는 쪽이 여러 장 이어져도 그 조문으로 본다
  let previous: Heading[] = [];
  for (let p = from - 1; p >= 1 && !previous.length; p--) previous = readHeadings(pdf, p);
  try {
    for (let page = from; page <= to; page++) {
      const headings = readHeadings(pdf, page);
      const qrs = reassign ? (known.get(page) ?? []) : readQrs(pdf, page, tmp);
      const pageHasText = qrs.length ? hasText(pdf, page) : true;
      for (const q of qrs.sort((a, b) => a.y - b.y || a.x - b.x)) {
        const { heading, method } = assign(headings, previous, q, pageHasText);
        occurrences.push({ page, x: Number(q.x.toFixed(1)), y: Number(q.y.toFixed(1)), url: q.url, article: heading?.num ?? null, articleTitle: heading?.title ?? null, method });
      }
      if (headings.length) previous = headings;
      if (page % 50 === 0) console.log(`  ${page}/${to}쪽 · QR ${occurrences.length}개`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const sha256 = createHash("sha256").update(readFileSync(pdf)).digest("hex");
  writeFileSync(OUT, JSON.stringify({ source: { ...SOURCE, sha256, pages: total }, occurrences }, null, 1) + "\n", "utf-8");
  console.log(`QR ${occurrences.length}개 (조문에 붙인 것 ${occurrences.filter((o) => o.article).length}개) → ${OUT}`);
}

main();
