#!/usr/bin/env tsx
/**
 * audit-kosha-guide-gaps.ts
 *
 * KOSHA Guide 카테고리별 번호 시퀀스에서 누락된 가이드를 식별 + KOSHA OneAPI totalCount 와 대조.
 *
 * KOSHA Guide 번호 체계: {카테고리}-{번호}-{발행연도}
 *   A: 시료채취·분석 / B: 일반 / C: 건설 / D: 토목 / E: 전기·계장
 *   F: 화공·소방 / G: 일반보건 / H: 보건 / K: 기타 / M: 기계
 *   O: 운반 / P: 화학공정 / T: 화학물질 독성·실험동물 / W: 작업환경
 *   X: 그 외
 *
 * 본 audit 는:
 *   1) 우리 시스템 본문 카테고리별 최대값 식별 + 시퀀스 내 누락 보고
 *   2) `--probe-oneapi` 옵션 시 KOSHA OneAPI 15144147 totalCount 조회 → 우리 메타와 대조
 *   3) 결과를 `src/ontology/_KOSHA_GAP_AUDIT.json` 에 git-tracked 박제
 *
 * 폐지/미발급 구분 (현재 자동화 한계):
 *   - KOSHA OneAPI 15144147 은 현재 유효 가이드만 응답 (totalCount = 1,039 / 2026-05-23)
 *   - 폐지 가이드 카탈로그는 KOSHA stdtboard 게시판 `B2025011500001` (기술지원규정 제·개정 공지사항)
 *     의 첨부파일 "신·구 연계표" 또는 data.go.kr 15116595 fileData (활용신청 후 CSV) 필요
 *   - 시퀀스 갭은 "현재 유효 카탈로그 (OneAPI) 미인지 = 폐지 또는 미발급" 라벨링만 가능
 */
import { readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src/ontology/kosha-guides");
const OUT_PATH = resolve(ROOT, "src/ontology/_KOSHA_GAP_AUDIT.json");

const KOSHA_ONEAPI_URL = "https://apis.data.go.kr/B552468/koshaguide/getKoshaGuide";
const KOSHA_STDTBOARD_REVISION_BBS = "B2025011500001";
const KOSHA_STDTBOARD_PAGE = "https://portal.kosha.or.kr/archive/resources/tech-support/revision/RevisionNoticePage";

const PROBE_ONEAPI = process.argv.includes("--probe-oneapi");

interface GuideId {
  category: string;
  number: number;
  year: number;
  filename: string;
}

function parse(filename: string): GuideId | null {
  const m = filename.match(/^([A-Z](?:-[A-Z])?)-(\d+)-(\d{4})\.md$/);
  if (!m) return null;
  return {
    category: m[1],
    number: parseInt(m[2], 10),
    year: parseInt(m[3], 10),
    filename,
  };
}

async function probeOneApiTotalCount(): Promise<number | null> {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    console.error("[probe-oneapi] DATA_GO_KR_KEY 미설정 — skip");
    return null;
  }
  const url = `${KOSHA_ONEAPI_URL}?serviceKey=${encodeURIComponent(key)}&callApiId=1050&numOfRows=1&pageNo=1`;
  try {
    const r = await fetch(url);
    const j: any = await r.json();
    return j?.body?.totalCount ?? null;
  } catch (err) {
    console.error("[probe-oneapi] error:", (err as Error).message);
    return null;
  }
}

async function main(): Promise<void> {
  const all = readdirSync(GUIDES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map(parse)
    .filter((g): g is GuideId => g !== null);

  const byCat = new Map<string, GuideId[]>();
  for (const g of all) {
    const arr = byCat.get(g.category) ?? [];
    arr.push(g);
    byCat.set(g.category, arr);
  }

  console.log("# KOSHA Guide 카테고리별 누락 번호 audit");
  console.log(`\n총 보유 본문: ${all.length} guides — ${byCat.size} 카테고리\n`);

  const oneApiTotal = PROBE_ONEAPI ? await probeOneApiTotalCount() : null;
  if (oneApiTotal !== null) {
    const drift = all.length - oneApiTotal;
    console.log(`KOSHA OneAPI 15144147 totalCount: ${oneApiTotal} (drift vs 본문: ${drift >= 0 ? "+" : ""}${drift})\n`);
  }

  interface CategoryStat {
    category: string;
    count: number;
    min: number;
    max: number;
    seqLen: number;
    missingCount: number;
    missing: number[];
  }
  const categoryStats: CategoryStat[] = [];
  const allGaps: Array<{ category: string; number: number; suspectedYear: number }> = [];

  const sortedCats = [...byCat.keys()].sort();
  console.log(`| 카테고리 | 최소 | 최대 | 보유 | 시퀀스 길이 | 누락 |`);
  console.log(`|---|---:|---:|---:|---:|---|`);

  for (const cat of sortedCats) {
    const list = byCat.get(cat)!.sort((a, b) => a.number - b.number);
    const numbers = new Set(list.map((g) => g.number));
    const minN = list[0].number;
    const maxN = list[list.length - 1].number;
    const seqLen = maxN - minN + 1;
    const missing: number[] = [];
    for (let i = minN; i <= maxN; i++) {
      if (!numbers.has(i)) missing.push(i);
    }
    for (const m of missing) {
      let yearGuess = list[0].year;
      for (const g of list) {
        if (Math.abs(g.number - m) < Math.abs(yearGuess - m)) yearGuess = g.year;
        if (g.number > m) {
          yearGuess = g.year;
          break;
        }
      }
      allGaps.push({ category: cat, number: m, suspectedYear: yearGuess });
    }
    const missingStr =
      missing.length > 0
        ? `${missing.length}건 (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ..." : ""})`
        : "(없음)";
    console.log(`| ${cat} | ${minN} | ${maxN} | ${list.length} | ${seqLen} | ${missingStr} |`);
    categoryStats.push({
      category: cat,
      count: list.length,
      min: minN,
      max: maxN,
      seqLen,
      missingCount: missing.length,
      missing,
    });
  }

  console.log("");
  console.log(`## 전체 누락 = ${allGaps.length}건`);
  console.log("");
  console.log("**해석**:");
  console.log("- KOSHA OneAPI 15144147 은 현재 유효 가이드만 응답한다.");
  console.log(`- 시퀀스 갭 ${allGaps.length}건 = OneAPI 미인지 (현재 유효 카탈로그에 없음) = 폐지 또는 미발급.`);
  console.log(`- 정확한 분류 (폐지 vs 미발급)는 KOSHA stdtboard 게시판 ${KOSHA_STDTBOARD_REVISION_BBS} 의 신·구 연계표 첨부파일 또는 data.go.kr 15116595 CSV 활용신청 후 확인.`);
  console.log("");

  const report = {
    _meta: {
      generatedAt: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19) + "+09:00",
      description: "KOSHA Guide 카테고리별 시퀀스 갭 audit. 갭 = KOSHA OneAPI 15144147 미인지 = 폐지 또는 미발급. 정확한 분류는 KOSHA stdtboard B2025011500001 첨부파일 또는 data.go.kr 15116595 CSV 필요.",
      sources: {
        koshaOneApi: {
          dataId: "15144147",
          endpoint: KOSHA_ONEAPI_URL,
          callApiId: "1050",
          scope: "현재 유효 가이드만",
          totalCount: oneApiTotal,
        },
        koshaStdtboardRevisionNotice: {
          bbsId: KOSHA_STDTBOARD_REVISION_BBS,
          name: "기술지원규정 제·개정 공지사항",
          pageUrl: KOSHA_STDTBOARD_PAGE,
          apiEndpoint: "https://portal.kosha.or.kr/api/compn24/auth/stdtboard/process.do (POST)",
          knownArtifactsPstNos: {
            "2024-revision-mapping": "202601221537183BFBGP",
            "2025-revision-history": "20260129100425TTR8ZK",
            "2025-publication-notice": "202601300911438097UD",
          },
          note: "각 게시물에 .hwp/.pdf/.xlsx 첨부 (신·구 연계표). 첨부 다운로드 자동화 미구현. SPA reverse engineering 필요.",
        },
        dataGoKrFileData: {
          dataId: "15116595",
          fileDataUrl: "https://www.data.go.kr/data/15116595/fileData.do",
          format: "CSV",
          scope: "누적 카탈로그 (폐지·이력 포함)",
          authRequired: true,
          note: "data.go.kr 가입 + 활용신청 후 CSV 다운로드. ./data/kosha-guide.csv 배치 후 `npm run sync-kosha` 실행 시 자동 흡수.",
        },
      },
    },
    summary: {
      totalGuidesInBundle: all.length,
      oneApiTotalCount: oneApiTotal,
      driftFromOneApi: oneApiTotal !== null ? all.length - oneApiTotal : null,
      totalCategories: byCat.size,
      totalSequenceGaps: allGaps.length,
    },
    categories: categoryStats,
    gaps: allGaps,
  };

  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(`[saved] ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
