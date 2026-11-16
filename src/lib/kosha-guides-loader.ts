/**
 * kosha-guides-loader.ts
 *
 * src/ontology/kosha-guides/*.dclx 폴더의 KOSHA Guide 원본(DocLang 아카이브)을 읽어 본문 Markdown 을 돌려준다.
 * 원본 정보(공단 포털 원본 주소·해시·상태·공고일)는 같은 폴더의 _SOURCES.json 한 파일에 있다.
 * 1,040 가이드를 hardcoded dict 대신 폴더 자동 scan (가이드 추가 시 코드 변경 0).
 *
 * 사용 도구:
 *   - get_kosha_guide_md (v1.1.19+ 단일 통합 — 단건/검색/인덱스 모두)
 *
 * v1.1.19 이후 Live API 도구 (get_kosha_guide_content, search_kosha_guides) 는 통합·제거.
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { doclangToMarkdown, readDclxDocument } from "./dclx.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveGuidesDir(): string {
  // 우선순위: build → src (개발 환경)
  const candidates = [
    resolve(__dirname, "..", "ontology", "kosha-guides"),
    resolve(__dirname, "..", "..", "src", "ontology", "kosha-guides"),
  ];
  return candidates[0]; // 런타임은 build/ontology/kosha-guides 만 사용
}

const GUIDES_DIR = resolveGuidesDir();
const GUIDE_EXT = ".dclx";
const SOURCES_FILE = "_SOURCES.json";
/**
 * 지침번호 별칭 — 공단 공공데이터 지침 목록의 번호가 원본 PDF 표지의 번호와 다른 지침.
 * 번들은 원본 표지 번호를 쓰고, 목록 번호로 물어도 같은 본문을 돌려준다.
 */
const GUIDE_NO_ALIASES: Record<string, string> = {
  "B-M-7-2025": "B-M-7-2026",
  "C-C-83-2020": "C-C-83-2026",
};

export interface KoshaGuideMeta {
  guideNo: string;
  fileName: string;
}

/** _SOURCES.json 의 가이드 한 건 — 공단 포털 원본에서 받은 사실 */
export interface KoshaGuideSource {
  title: string;
  /** 공단 포털 상태 (제정·개정·폐지) */
  status: string;
  /** 공단 포털 공고일 YYYY-MM-DD */
  publishedAt?: string;
  /** 공단 포털 목록의 지침번호 (표지 번호와 다를 때만) */
  portalNo?: string;
  sourceUrl: string;
  sha256: string;
  bytes: number;
}

export interface KoshaGuideBody {
  guideNo: string;
  title: string;
  sourceUrl: string;
  body: string; // 본문 전체 (dclx 를 Markdown 으로 그린 것)
  bodyLength: number;
  /** 공단 포털 상태 (제정·개정·폐지) — 원본 정보가 없으면 undefined */
  status?: string;
  /** 공단 포털 공고일 */
  publishedAt?: string;
}

// 캐시 — 한 번 읽으면 메모리 보존
const indexCache = new Map<string, KoshaGuideMeta>();
const bodyCache = new Map<string, KoshaGuideBody>();
let indexLoaded = false;
let sourcesCache: Record<string, KoshaGuideSource> | undefined;

async function ensureIndex(): Promise<void> {
  if (indexLoaded) return;
  try {
    const files = await readdir(GUIDES_DIR);
    for (const f of files) {
      if (!f.endsWith(GUIDE_EXT) || f.startsWith("_")) continue;
      const guideNo = f.slice(0, -GUIDE_EXT.length);
      indexCache.set(guideNo, { guideNo, fileName: f });
    }
    indexLoaded = true;
  } catch {
    // GUIDES_DIR 없음 (개발 환경 또는 fetch 미진행) — 빈 인덱스
    indexLoaded = true;
  }
}

async function loadSources(): Promise<Record<string, KoshaGuideSource>> {
  if (sourcesCache) return sourcesCache;
  try {
    const raw = JSON.parse(await readFile(resolve(GUIDES_DIR, SOURCES_FILE), "utf8")) as { guides?: Record<string, KoshaGuideSource> };
    sourcesCache = raw.guides ?? {};
  } catch {
    sourcesCache = {};
  }
  return sourcesCache;
}

function canonicalGuideNo(guideNo: string): string {
  // 대소문자 정규화 — guideNo 표기 일관성 (A-1-2018 ↔ a-1-2018 모두 OK)
  return GUIDE_NO_ALIASES[guideNo.toUpperCase()] ?? guideNo.toUpperCase();
}

/** 원본 정보 (없으면 undefined) */
export async function getKoshaGuideSource(guideNo: string): Promise<KoshaGuideSource | undefined> {
  return (await loadSources())[canonicalGuideNo(guideNo)];
}

export async function listKoshaGuidesMd(): Promise<KoshaGuideMeta[]> {
  await ensureIndex();
  return [...indexCache.values()].sort((a, b) => a.guideNo.localeCompare(b.guideNo));
}

export async function getKoshaGuideMd(guideNo: string): Promise<KoshaGuideBody | null> {
  const upper = canonicalGuideNo(guideNo);
  const cached = bodyCache.get(upper);
  if (cached) return cached;

  await ensureIndex();
  const meta = indexCache.get(upper);
  if (!meta) return null;

  try {
    const body = doclangToMarkdown(readDclxDocument(await readFile(resolve(GUIDES_DIR, meta.fileName)))).trim();
    const source = (await loadSources())[upper];
    const result: KoshaGuideBody = {
      guideNo: upper,
      title: source?.title ?? meta.guideNo,
      sourceUrl: source?.sourceUrl ?? "",
      body,
      bodyLength: body.length,
      ...(source?.status ? { status: source.status } : {}),
      ...(source?.publishedAt ? { publishedAt: source.publishedAt } : {}),
    };
    bodyCache.set(upper, result);
    return result;
  } catch {
    return null;
  }
}

/** 가이드별 검색용 글 캐시 — 원문과 소문자본 */
const searchCache = new Map<string, { text: string; lower: string }>();

/**
 * 검색용 글 — 제목 + 본문. 표 칸 안에서 줄이 바뀐 낱말("이동식<br>크레인")도 찾도록 칸 줄바꿈(<br>)은 지워 잇고,
 * 나머지 표 태그는 칸 경계로 공백 하나. 가이드마다 한 번만 만든다.
 */
function searchableText(guide: KoshaGuideBody): { text: string; lower: string } {
  const cached = searchCache.get(guide.guideNo);
  if (cached) return cached;
  const text = `${guide.title}\n${guide.body}`.replace(/<br\s*\/?>/gi, "").replace(/<\/?(?:table|caption|tr|td|th)\b[^>]*>/gi, " ");
  const entry = { text, lower: text.toLowerCase() };
  searchCache.set(guide.guideNo, entry);
  return entry;
}

export async function searchKoshaGuidesMd(
  keyword: string,
  options: { limit?: number } = {},
): Promise<Array<{ guideNo: string; title: string; matchedSnippet: string }>> {
  const { limit = 20 } = options;
  await ensureIndex();
  const q = keyword.trim().toLowerCase();
  if (!q) return [];

  const results: Array<{ guideNo: string; title: string; matchedSnippet: string }> = [];
  for (const meta of indexCache.values()) {
    if (results.length >= limit) break;
    const body = await getKoshaGuideMd(meta.guideNo);
    if (!body) continue;
    const { text, lower } = searchableText(body);
    const idx = lower.indexOf(q);
    if (idx < 0) continue;
    results.push({ guideNo: body.guideNo, title: body.title, matchedSnippet: text.slice(Math.max(0, idx - 60), idx + q.length + 60) });
  }
  return results;
}

/** 번들 가이드 수와 원본 아카이브(.dclx) 크기 합 */
export async function getKoshaGuidesStats(): Promise<{ total: number; totalBytes: number }> {
  await ensureIndex();
  let totalBytes = 0;
  for (const meta of indexCache.values()) {
    try {
      totalBytes += (await readFile(resolve(GUIDES_DIR, meta.fileName))).length;
    } catch { /* skip */ }
  }
  return { total: indexCache.size, totalBytes };
}
