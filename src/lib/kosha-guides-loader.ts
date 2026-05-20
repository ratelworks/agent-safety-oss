/**
 * kosha-guides-loader.ts
 *
 * src/ontology/kosha-guides/*.md 폴더의 KOSHA Guide 본문 MD 를 로드.
 * 1,039 가이드를 hardcoded dict 대신 폴더 자동 scan (가이드 추가 시 코드 변경 0).
 *
 * 사용 도구:
 *   - get_kosha_guide_md (v1.1.19+ 단일 통합 — 단건/검색/인덱스 모두)
 *
 * v1.1.19 이후 Live API 도구 (get_kosha_guide_content, search_kosha_guides) 는 통합·제거.
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

export interface KoshaGuideMeta {
  guideNo: string;
  fileName: string;
}

export interface KoshaGuideBody {
  guideNo: string;
  title: string;
  sourceUrl: string;
  body: string; // 본문 전체 (PDF 추출 + MD 헤더 제외)
  bodyLength: number;
}

// 캐시 — 한 번 읽으면 메모리 보존
const indexCache = new Map<string, KoshaGuideMeta>();
const bodyCache = new Map<string, KoshaGuideBody>();
let indexLoaded = false;

async function ensureIndex(): Promise<void> {
  if (indexLoaded) return;
  try {
    const files = await readdir(GUIDES_DIR);
    for (const f of files) {
      if (!f.endsWith(".md") || f.startsWith("_")) continue;
      const guideNo = f.replace(/\.md$/, "");
      indexCache.set(guideNo, { guideNo, fileName: f });
    }
    indexLoaded = true;
  } catch {
    // GUIDES_DIR 없음 (개발 환경 또는 fetch 미진행) — 빈 인덱스
    indexLoaded = true;
  }
}

export async function listKoshaGuidesMd(): Promise<KoshaGuideMeta[]> {
  await ensureIndex();
  return [...indexCache.values()].sort((a, b) => a.guideNo.localeCompare(b.guideNo));
}

export async function getKoshaGuideMd(guideNo: string): Promise<KoshaGuideBody | null> {
  // 대소문자 정규화 — guideNo 표기 일관성 (A-1-2018 ↔ a-1-2018 모두 OK)
  const upper = guideNo.toUpperCase();
  const cached = bodyCache.get(upper);
  if (cached) return cached;

  await ensureIndex();
  const meta = indexCache.get(upper);
  if (!meta) return null;

  try {
    const path = resolve(GUIDES_DIR, meta.fileName);
    const raw = await readFile(path, "utf8");

    // MD 파싱 — 헤더 (제목·메타) + 본문 분리
    const lines = raw.split("\n");
    const titleLine = lines.find((l) => l.startsWith("# "));
    const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : meta.guideNo;
    const sourceUrlLine = lines.find((l) => l.startsWith("> **원본 URL**:"));
    const sourceUrl = sourceUrlLine ? sourceUrlLine.replace(/^>\s*\*\*원본 URL\*\*:\s*/, "").trim() : "";

    // 본문 = "---" (헤더 종료 구분선) 다음 EOF. 시작·끝 ``` fence 는 제거.
    // 본문 안의 ``` 와 충돌 안 함 (이전 fence 매칭 방식 회귀 fix).
    const headerEnd = raw.indexOf("\n---\n");
    let body = headerEnd >= 0 ? raw.slice(headerEnd + 5) : raw;
    body = body.replace(/^\s*```\s*\n/, "").replace(/\n```\s*\n?\s*$/, "").trim();

    const result: KoshaGuideBody = {
      guideNo: upper,
      title,
      sourceUrl,
      body,
      bodyLength: body.length,
    };
    bodyCache.set(upper, result);
    return result;
  } catch {
    return null;
  }
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
    const haystack = `${body.title}\n${body.body}`.toLowerCase();
    const idx = haystack.indexOf(q);
    if (idx < 0) continue;
    const snippet = body.body.slice(Math.max(0, idx - 60), idx + q.length + 60);
    results.push({ guideNo: body.guideNo, title: body.title, matchedSnippet: snippet });
  }
  return results;
}

export async function getKoshaGuidesStats(): Promise<{ total: number; totalBytes: number }> {
  await ensureIndex();
  let totalBytes = 0;
  for (const meta of indexCache.values()) {
    try {
      const path = resolve(GUIDES_DIR, meta.fileName);
      const raw = await readFile(path, "utf8");
      totalBytes += raw.length;
    } catch { /* skip */ }
  }
  return { total: indexCache.size, totalBytes };
}
