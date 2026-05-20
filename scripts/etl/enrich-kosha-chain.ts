#!/usr/bin/env tsx
/**
 * enrich-kosha-chain.ts
 *
 * 1,039 KOSHA Guide 노드의 의미 사슬 enrichment.
 *
 * 흐름:
 *   1) src/ontology/graph/nodes/documents/guides/*.jsonld 순회
 *   2) 각 노드의 title 로 data.go.kr 15123696 (안전보건법령 스마트검색) 호출
 *   3) 응답에서 category 1-5 (법령) → relatedLaw, category 7 (KOSHA GUIDE) → relatedKoshaGuide 엣지 추가
 *   4) _meta.matchType: prefix-fallback → smart-search-enriched
 *
 * 인증:
 *   .env 의 DATA_GO_KR_KEY 사용 (data.go.kr 공공포털 키, URL-decoded 형태)
 *
 * 사용법:
 *   tsx scripts/etl/enrich-kosha-chain.ts [LIMIT]
 *     LIMIT 지정 시 처음 N건만 처리 (dry-run 용)
 *
 * NEXT_SESSION.md §3.1 후속 작업 — 의미 사슬 30% (fallback) → 80%+ 회복 목표.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const GUIDES_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
const API_BASE = "https://apis.data.go.kr/B552468/srch/smartSearch";

// 호출 간 sleep (rate-limit 회피). data.go.kr 공식 제한은 분당 1000회 — 보수적으로 5/s.
const SLEEP_MS = 200;
const MAX_ROWS = 15;
const REQUEST_TIMEOUT_MS = 15_000;
const PROGRESS_INTERVAL = 50;
const FETCHED_AT = new Date().toISOString().slice(0, 10);

// 표준 KOSHA Guide title 접미사 — 검색 keyword 추출 시 strip.
const TITLE_SUFFIXES = [
  "에 관한 기술지침",
  "에 대한 기술지침",
  "안전보건작업 지침",
  "안전보건 작업지침",
  "안전관리 지침",
  "안전작업 지침",
  "안전작업지침",
  "작업안전 지침",
  "기술지침",
  "안전지침",
  "안전대책",
  "안전관리",
  "작업지침",
  "작업기준",
  "관리지침",
  "관리기준",
  "평가지침",
  "평가 지침",
  "산정 지침",
  "산정지침",
  "프로그램 지침",
  "안전인증",
  "지침",
  "기준",
];

// 검색에 의미 없는 조사·접속어 (첫 단어 추출 후 strip 대상).
const KOREAN_PARTICLES = ["에", "에서", "에 대한", "에 관한", "의", "는", "은", "을", "를", "이", "가", "와", "과"];

// title 에서 검색 keyword 추출.
// 1) 괄호 안 제거 → 2) 표준 접미사 strip → 3) 콤마/슬래시 첫 segment → 4) 첫 단어 + 조사 strip.
// 결과가 너무 짧으면 (1 글자) 처음 8자 fallback.
function extractSearchKeyword(title: string): string {
  let t = title.replace(/\([^)]*\)/g, " ").replace(/[（）]/g, " ").trim();

  // 표준 접미사 strip (긴 것부터 매칭)
  const sortedSuffixes = [...TITLE_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const sfx of sortedSuffixes) {
    if (t.endsWith(sfx)) {
      t = t.slice(0, -sfx.length).trim();
      break;
    }
  }

  // 콤마·슬래시·세미콜론 첫 segment
  t = t.split(/[,，/;:·]/u)[0].trim();

  // 공백 기준 첫 단어
  const words = t.split(/\s+/).filter(Boolean);
  let head = words[0] ?? "";

  // 조사 strip (예: "구리에" → "구리")
  const sortedParticles = [...KOREAN_PARTICLES].sort((a, b) => b.length - a.length);
  for (const p of sortedParticles) {
    if (head.endsWith(p)) {
      head = head.slice(0, -p.length).trim();
      break;
    }
  }

  // 너무 짧으면 처음 8자 fallback
  if (head.length < 2) {
    return title.replace(/\([^)]*\)/g, "").trim().slice(0, 8);
  }
  return head;
}

interface SmartSearchItem {
  category?: string;
  doc_id?: string;
  title?: string;
  score?: number;
}

interface SmartSearchResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      categorycount?: Record<string, number | string>;
      items?: { item?: SmartSearchItem | SmartSearchItem[] };
      totalCount?: number | string;
    };
  };
}

interface RelatedLawRef {
  docId: string;
  title: string;
  category: string;
  score: number;
}

interface RelatedGuideRef {
  docId: string;
  title: string;
  score: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function loadEnv(): Promise<void> {
  try {
    const envText = await readFile(resolve(ROOT, ".env"), "utf8");
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // .env 없으면 환경변수만 사용
  }
}

async function smartSearch(searchValue: string, serviceKey: string): Promise<SmartSearchResponse> {
  const url = new URL(API_BASE);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", String(MAX_ROWS));
  url.searchParams.set("searchValue", searchValue);
  url.searchParams.set("category", "0");
  url.searchParams.set("type", "json");

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as SmartSearchResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeItems(it?: SmartSearchItem | SmartSearchItem[]): SmartSearchItem[] {
  if (!it) return [];
  return Array.isArray(it) ? it : [it];
}

interface EnrichmentSummary {
  relatedLaw: RelatedLawRef[];
  relatedKoshaGuide: RelatedGuideRef[];
  totalMatched: number;
  categoryCounts: Record<string, number>;
}

function summarize(resp: SmartSearchResponse, selfGuideNo: string): EnrichmentSummary {
  const body = resp.response?.body;
  const items = normalizeItems(body?.items?.item);

  const relatedLaw: RelatedLawRef[] = items
    .filter((it) => ["1", "2", "3", "4", "5"].includes(it.category ?? ""))
    .slice(0, 5)
    .map((it) => ({
      docId: it.doc_id ?? "",
      title: (it.title ?? "").trim(),
      category: it.category ?? "",
      score: typeof it.score === "number" ? Number(it.score.toFixed(3)) : 0,
    }));

  // self-reference 제거 (자기 자신은 매칭 결과에서 빼야 함)
  const relatedKoshaGuide: RelatedGuideRef[] = items
    .filter((it) => it.category === "7")
    .filter((it) => !selfGuideNo || !(it.doc_id ?? "").includes(selfGuideNo))
    .slice(0, 5)
    .map((it) => ({
      docId: it.doc_id ?? "",
      title: (it.title ?? "").trim(),
      score: typeof it.score === "number" ? Number(it.score.toFixed(3)) : 0,
    }));

  const categoryCounts: Record<string, number> = {};
  const raw = body?.categorycount ?? {};
  for (const [k, v] of Object.entries(raw)) {
    categoryCounts[k] = typeof v === "string" ? parseInt(v, 10) || 0 : Number(v);
  }

  return {
    relatedLaw,
    relatedKoshaGuide,
    totalMatched: relatedLaw.length + relatedKoshaGuide.length,
    categoryCounts,
  };
}

async function main(): Promise<void> {
  await loadEnv();
  const serviceKey = process.env.DATA_GO_KR_KEY;
  if (!serviceKey) {
    console.error("[enrich] DATA_GO_KR_KEY missing in .env");
    process.exit(1);
  }

  const limitArg = process.argv[2];
  const LIMIT = limitArg ? parseInt(limitArg, 10) : Number.POSITIVE_INFINITY;

  const files = (await readdir(GUIDES_DIR)).filter((f) => f.endsWith(".jsonld")).sort();
  const total = Math.min(files.length, LIMIT);
  console.log(`[enrich] target=${total} (of ${files.length} KOSHA Guide nodes)`);
  if (limitArg) console.log(`[enrich] dry-run LIMIT=${LIMIT}`);

  let enriched = 0;
  let withLaw = 0;
  let withGuide = 0;
  let withMatches = 0;
  let skipped = 0;
  let errors = 0;
  const totalStart = Date.now();

  for (let i = 0; i < total; i++) {
    const filename = files[i];
    const path = join(GUIDES_DIR, filename);
    let node: Record<string, unknown>;
    try {
      node = JSON.parse(await readFile(path, "utf8"));
    } catch (e) {
      errors++;
      console.error(`[enrich] parse error ${filename}: ${(e as Error).message}`);
      continue;
    }

    const title = typeof node.title === "string" ? node.title.trim() : "";
    const meta = (node._meta as Record<string, unknown> | undefined) ?? {};
    const guideNo = typeof meta.guideNo === "string" ? meta.guideNo : "";

    if (!title) {
      skipped++;
      continue;
    }

    const searchKeyword = extractSearchKeyword(title);
    try {
      const resp = await smartSearch(searchKeyword, serviceKey);
      const summary = summarize(resp, guideNo);

      const newMeta: Record<string, unknown> = {
        ...meta,
        matchType: "smart-search-enriched",
        matchTypeNote: `data.go.kr 15123696 smart search 매칭 ${summary.totalMatched}건 (법령 ${summary.relatedLaw.length} / KOSHA Guide ${summary.relatedKoshaGuide.length}). keyword="${searchKeyword}" (title 첫 단어 추출). ${FETCHED_AT}.`,
        smartSearchEnrichedAt: FETCHED_AT,
        smartSearchKeyword: searchKeyword,
        smartSearchCategoryCounts: summary.categoryCounts,
      };
      // 직전 fallback note 보존 (history 추적)
      if (meta.matchTypeNote && typeof meta.matchTypeNote === "string" && !(meta as { previousMatchTypeNote?: string }).previousMatchTypeNote) {
        newMeta.previousMatchTypeNote = meta.matchTypeNote;
      }
      node._meta = newMeta;

      if (summary.relatedLaw.length > 0) {
        node.relatedLaw = summary.relatedLaw;
        withLaw++;
      } else {
        delete node.relatedLaw;
      }
      if (summary.relatedKoshaGuide.length > 0) {
        node.relatedKoshaGuide = summary.relatedKoshaGuide;
        withGuide++;
      } else {
        delete node.relatedKoshaGuide;
      }
      if (summary.totalMatched > 0) withMatches++;

      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
      enriched++;

      if ((i + 1) % PROGRESS_INTERVAL === 0) {
        const elapsed = Math.round((Date.now() - totalStart) / 1000);
        const rate = (i + 1) / elapsed;
        const eta = Math.round((total - (i + 1)) / rate);
        console.log(
          `[enrich] ${i + 1}/${total}: enriched=${enriched} withLaw=${withLaw} withGuide=${withGuide} withMatches=${withMatches} errors=${errors} elapsed=${elapsed}s eta=${eta}s`,
        );
      }

      await sleep(SLEEP_MS);
    } catch (e) {
      errors++;
      console.error(`[enrich] error ${filename}: ${(e as Error).message}`);
    }
  }

  const elapsed = Math.round((Date.now() - totalStart) / 1000);
  console.log("");
  console.log("════════════════════════════════════════════════════════");
  console.log(`[enrich] DONE — total=${total} enriched=${enriched} withMatches=${withMatches} (${Math.round((withMatches / total) * 100)}%)`);
  console.log(`         withLaw=${withLaw} withGuide=${withGuide} skipped=${skipped} errors=${errors} elapsed=${elapsed}s`);
  console.log("════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("[enrich] fatal:", e);
  process.exit(1);
});
