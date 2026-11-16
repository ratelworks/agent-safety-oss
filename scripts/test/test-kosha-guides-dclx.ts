#!/usr/bin/env tsx
/**
 * test-kosha-guides-dclx.ts — KOSHA Guide 원본 보관(.dclx) 회귀 시험
 *
 *   1. 그래프의 가이드 노드마다 원본 .dclx 가 있고, 옛 변환본(.md)은 남아 있지 않다
 *   2. _SOURCES.json 에 가이드마다 공단 포털 원본 주소·SHA-256·상태가 있다
 *   3. 모든 .dclx 가 읽히고 본문이 비지 않는다
 *   4. 병합 셀 표가 원본대로 그려진다 (C-25-2018 점검기준 표 — 행 머리 "1. 공통사항" 2열×3행 병합)
 *   5. 조회 도구가 공단 상태를 보여 주고, 폐지 지침에는 경고를 붙이고, 포털 목록 번호로 물어도 같은 본문을 준다
 *   6. 표 칸 안에서 줄이 바뀐 낱말도 검색으로 찾는다
 *
 * 사용: tsx scripts/test/test-kosha-guides-dclx.ts   (build/ 를 쓰는 조회 도구 시험이 있어 npm run build 뒤에)
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { doclangToMarkdown, readDclxDocument } from "../../src/lib/dclx.js";
import { getKoshaGuideMdTool } from "../../build/tools/get-kosha-guide-md.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "kosha-guides");
const GUIDE_NODES = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");
const PORTAL_DOWNLOAD = "https://portal.kosha.or.kr/openapi/v1/file/down/";
const STATUSES = new Set(["제정", "개정", "폐지"]);
const MIN_BODY_CHARS = 500;
/** 공단 포털에서 폐지된 번들 지침 (2026-11-16 포털 목록) */
const REPEALED_GUIDE = "W-14-2022";
/** 표지 번호 ↔ 포털 목록 번호 */
const ALIAS = { asked: "B-M-7-2025", bundled: "B-M-7-2026" };
/** 원본 표 칸 안에서 줄이 바뀐 낱말과 그 가이드 */
const CELL_WRAPPED = { keyword: "이동식크레인", guide: "X-61-2013" };

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

async function main(): Promise<void> {
  const files = await readdir(GUIDES_DIR);
  const dclx = new Set(files.filter((f) => f.endsWith(".dclx")).map((f) => f.slice(0, -5)));
  const nodeNos: string[] = [];
  for (const f of (await readdir(GUIDE_NODES)).filter((x) => x.endsWith(".jsonld"))) {
    const no = (JSON.parse(await readFile(resolve(GUIDE_NODES, f), "utf8")) as { _meta?: { guideNo?: string } })._meta?.guideNo;
    if (no) nodeNos.push(no);
  }
  const noArchive = nodeNos.filter((no) => !dclx.has(no));
  check(`가이드 노드 ${nodeNos.length}개 모두 원본 .dclx 가 있다`, nodeNos.length > 0 && noArchive.length === 0, noArchive.slice(0, 5).join(", "));
  const leftoverMd = files.filter((f) => f.endsWith(".md"));
  check("옛 변환본(.md)이 남아 있지 않다", leftoverMd.length === 0, leftoverMd.slice(0, 5).join(", "));

  const sources = (JSON.parse(await readFile(resolve(GUIDES_DIR, "_SOURCES.json"), "utf8")) as {
    guides: Record<string, { status: string; sourceUrl: string; sha256: string; bytes: number; title: string }>;
  }).guides;
  const badSource = nodeNos.filter((no) => {
    const s = sources[no];
    return !s || !s.sourceUrl.startsWith(PORTAL_DOWNLOAD) || !/^[0-9a-f]{64}$/.test(s.sha256) || !(s.bytes > 0) || !STATUSES.has(s.status) || !s.title;
  });
  check("가이드마다 공단 포털 원본 주소·SHA-256·크기·상태·제목이 있다", badSource.length === 0, badSource.slice(0, 5).join(", "));

  const empty: string[] = [];
  for (const no of dclx) {
    try {
      const body = doclangToMarkdown(readDclxDocument(await readFile(resolve(GUIDES_DIR, `${no}.dclx`))));
      if (body.replace(/\s/g, "").length < MIN_BODY_CHARS) empty.push(no);
    } catch {
      empty.push(no);
    }
  }
  check(`원본 ${dclx.size}건 모두 읽히고 본문이 비지 않는다`, empty.length === 0, empty.slice(0, 5).join(", "));

  const c25 = doclangToMarkdown(readDclxDocument(await readFile(resolve(GUIDES_DIR, "C-25-2018.dclx"))));
  check(
    "병합 셀 표가 원본대로 그려진다 (C-25-2018 점검기준 표)",
    c25.includes('<td colspan="2" rowspan="3">1. 공통사항</td>') && c25.includes("받이판<br>및<br>바닥판"),
    c25.includes("1. 공통사항") ? "행 머리 있음" : "행 머리 없음",
  );

  const text = async (input: Record<string, unknown>): Promise<string> => (await getKoshaGuideMdTool.handler(input)).content[0]?.text ?? "";
  const c25Text = await text({ techGdlnNo: "C-25-2018" });
  check("조회 결과에 공단 상태와 원본 주소가 있다", c25Text.includes("> **공단 상태**: ") && c25Text.includes(PORTAL_DOWNLOAD));
  const repealed = await text({ techGdlnNo: REPEALED_GUIDE });
  check("공단 포털에서 폐지된 지침에는 경고가 붙는다", repealed.includes("폐지된 지침입니다"), REPEALED_GUIDE);
  const viaAlias = await text({ techGdlnNo: ALIAS.asked });
  check("포털 목록 번호로 물어도 표지 번호의 본문을 준다", viaAlias.includes(`> **지침번호**: ${ALIAS.bundled}`), `${ALIAS.asked} → ${ALIAS.bundled}`);
  // 원본 표 칸에서 줄이 바뀐 낱말 — X-61-2013 작업 표의 "이동식<br>크레인을<br>이용한"
  const cellWrapped = await text({ keyword: CELL_WRAPPED.keyword, limit: 50 });
  check("표 칸 안에서 줄이 바뀐 낱말도 검색으로 찾는다", cellWrapped.includes(CELL_WRAPPED.guide), `${CELL_WRAPPED.keyword} → ${CELL_WRAPPED.guide}`);

  if (failed > 0) {
    console.error(`\n❌ ${failed}개 실패`);
    process.exit(1);
  }
  console.log("\n✅ 전체 통과");
}

void main();
