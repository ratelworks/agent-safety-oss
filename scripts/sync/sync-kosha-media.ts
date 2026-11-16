#!/usr/bin/env tsx
/**
 * sync-kosha-media.ts — 「만화로 보는 산업안전보건기준에 관한 규칙」 조문 쪽 QR 이 가리키는 공단 자료실 자료를 그래프 노드로 만든다
 *
 * 입력: scripts/sync/kosha-comic-qr.json (extract-comic-qr.ts 가 원본 PDF 에서 읽은 QR·조문 짝)
 *   1. QR 주소를 공단 자료실 자료 번호(medSeq)로 푼다 — 짧은 주소(m.site.naver.com)는 넘겨주는 주소(location)를 읽는다
 *   2. 자료 번호마다 공단 자료실(portal.kosha.or.kr) 자료 정보를 받는다 — 제목·형식·발간번호·등록일·공공누리 유형
 *   3. 자료 노드  src/ontology/graph/nodes/kosha-media/{자료번호}.jsonld
 *      - relatedArticles: 그 자료의 QR 이 옆에 인쇄된 안전보건규칙 조문
 *      - hasFacet: 자료 형식(OPS·동영상 등 — 공단 자료실 형식 코드로 기존 형식 노드에 잇는다)
 *   자료 내용(영상·문서)은 싣지 않는다 — 제목과 공단 자료실 주소만 둔다 (공공누리 변경 금지 자료).
 *   자료실이 정보를 주지 않는 자료(내려간 자료)는 노드로 만들지 않고 scripts/sync/kosha-media-status.json 에 남긴다.
 *
 * 사용: tsx scripts/sync/sync-kosha-media.ts
 */
import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const FACETS = resolve(NODES, "facets", "shp");
const OUT = resolve(NODES, "kosha-media");
const QR_FILE = resolve(__dirname, "kosha-comic-qr.json");
/** 책 QR 이 가리키지만 지금 공단 자료실에서 정보를 주지 않는 자료(내려간 자료) — 확인일과 함께 남긴다 */
const STATUS_FILE = resolve(__dirname, "kosha-media-status.json");
/** 정보를 못 받은 자료가 이 비율을 넘으면 자료실 장애로 보고 아무것도 쓰지 않는다 (기존 노드를 지우지 않게) */
const MAX_MISSING_RATIO = 0.2;
const MEDIA_API = "https://portal.kosha.or.kr/api/portal24/bizV/p/VCPDG01007/selectMediaList";
const MEDIA_PAGE = "https://portal.kosha.or.kr/archive/cent-archive/master-arch/master-list4/master-detail4?medSeq=";
const LAW_KEY = "기준규칙";
const TIMEOUT_MS = 20000;
const RETRY = 2;
/** 동시에 보내는 요청 수 (공단 서버에 부담을 주지 않게) */
const CONCURRENCY = 4;

interface Occurrence {
  page: number;
  x: number;
  y: number;
  url: string;
  article: string | null;
  method: string;
}
interface QrFile {
  source: { title: string; publisher: string; publicationNo: string; url: string; license: string; sha256: string };
  occurrences: Occurrence[];
}
interface Media {
  medSeq: number;
  medName: string;
  contsFbctnShpCd?: string;
  contsFbctnShpNm?: string;
  contsPblsNo?: string;
  contsRegYmd?: string;
  medGonggongnuriNm?: string;
}

async function withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (attempt >= RETRY) throw e;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    return withRetry(fn, attempt + 1);
  }
}

/** QR 주소 → 자료 번호 */
async function resolveMedSeq(url: string): Promise<number | null> {
  const direct = url.match(/medSeq=(\d+)/);
  if (direct) return Number(direct[1]);
  return withRetry(async () => {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const loc = res.headers.get("location") ?? "";
    const m = loc.match(/medSeq=(\d+)/);
    return m ? Number(m[1]) : null;
  });
}

async function fetchMedia(medSeq: number): Promise<Media | null> {
  return withRetry(async () => {
    const res = await fetch(MEDIA_API, {
      method: "POST",
      headers: { "content-type": "application/json", chnlid: "portal24", origin: "https://portal.kosha.or.kr", referer: `${MEDIA_PAGE}${medSeq}` },
      body: JSON.stringify({ medSeq: String(medSeq) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { payload?: { list?: Media[] } };
    return body.payload?.list?.[0] ?? null;
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function isoDate(yyyymmdd?: string): string | undefined {
  return yyyymmdd && /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : undefined;
}

async function main(): Promise<void> {
  const qr = JSON.parse(await readFile(QR_FILE, "utf-8")) as QrFile;
  const articleFiles = new Set(await readdir(ARTICLES));
  // 공단 자료실 형식 코드 → 형식 노드
  const facetByCode = new Map<string, string>();
  for (const f of await readdir(FACETS)) {
    const d = JSON.parse(await readFile(resolve(FACETS, f), "utf-8")) as { "@id": string; koshaArchiveCode?: string };
    if (d.koshaArchiveCode) facetByCode.set(d.koshaArchiveCode, d["@id"]);
  }
  const urls = [...new Set(qr.occurrences.map((o) => o.url))];
  const seqs = await mapLimit(urls, CONCURRENCY, resolveMedSeq);
  const seqByUrl = new Map(urls.map((u, i) => [u, seqs[i]]));
  const unresolved = urls.filter((u) => seqByUrl.get(u) == null);
  if (unresolved.length) console.error(`자료 번호로 풀지 못한 QR 주소 ${unresolved.length}개: ${unresolved.slice(0, 5).join(", ")}`);

  // 자료 번호 → 그 자료의 QR 이 나온 곳들
  const byMedia = new Map<number, Occurrence[]>();
  for (const o of qr.occurrences) {
    const seq = seqByUrl.get(o.url);
    if (seq == null) continue;
    byMedia.set(seq, [...(byMedia.get(seq) ?? []), o]);
  }
  const mediaSeqs = [...byMedia.keys()].sort((a, b) => a - b);
  const infos = await mapLimit(mediaSeqs, CONCURRENCY, fetchMedia);
  const unavailable = mediaSeqs.filter((_, i) => !infos[i]);
  if (unavailable.length > mediaSeqs.length * MAX_MISSING_RATIO) {
    console.error(`공단 자료실에서 정보를 받지 못한 자료가 ${unavailable.length}/${mediaSeqs.length}건 — 자료실 장애로 보고 노드를 바꾸지 않습니다.`);
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });
  for (const f of await readdir(OUT)) if (f.endsWith(".jsonld")) await rm(resolve(OUT, f));
  const today = new Date().toISOString().substring(0, 10);
  let written = 0;
  let linked = 0;
  for (const [i, seq] of mediaSeqs.entries()) {
    const info = infos[i];
    if (!info) continue;
    const occ = byMedia.get(seq)!;
    const articles = [...new Set(occ.map((o) => o.article).filter((a): a is string => Boolean(a)))];
    const related = articles.filter((a) => articleFiles.has(`${LAW_KEY}-§${a}.jsonld`)).map((a) => `art:${LAW_KEY}:${a}`);
    const notFound = articles.filter((a) => !articleFiles.has(`${LAW_KEY}-§${a}.jsonld`));
    const facet = info.contsFbctnShpCd ? facetByCode.get(info.contsFbctnShpCd) : undefined;
    const node = {
      "@context": "../../context.jsonld",
      "@id": `kosha:media/${seq}`,
      "@type": ["DigitalDocument"],
      title: info.medName,
      ...(facet ? { hasFacet: [facet] } : {}),
      ...(related.length ? { relatedArticles: related } : {}),
      verificationStatus: "kosha_verified",
      _meta: {
        publishedBy: "한국산업안전보건공단 (KOSHA) 자료실",
        sourceUrl: `${MEDIA_PAGE}${seq}`,
        koshaMedSeq: seq,
        ...(info.contsFbctnShpNm ? { contentForm: info.contsFbctnShpNm } : {}),
        ...(info.contsPblsNo ? { publicationNo: info.contsPblsNo } : {}),
        ...(isoDate(info.contsRegYmd) ? { registeredAt: isoDate(info.contsRegYmd) } : {}),
        ...(info.medGonggongnuriNm ? { licenseHint: `공공누리 ${info.medGonggongnuriNm}` } : {}),
        fetchedAt: today,
        foundIn: {
          title: qr.source.title,
          publicationNo: qr.source.publicationNo,
          url: qr.source.url,
          pages: [...new Set(occ.map((o) => o.page))].sort((a, b) => a - b),
          qrCount: occ.length,
        },
        relatedArticlesBasis:
          "책의 조문 상자 안에 이 자료의 QR 이 인쇄된 조문 (원본 PDF 에서 QR 과 조문 제목 위치를 읽어 정했다). 조문 제목이 없는 쪽(부록)에 실린 QR 은 조문에 잇지 않았다.",
        ...(notFound.length ? { unresolvedArticles: notFound } : {}),
      },
    };
    await writeFile(resolve(OUT, `${seq}.jsonld`), JSON.stringify(node, null, 2) + "\n", "utf-8");
    written += 1;
    if (related.length) linked += 1;
  }
  const status = {
    checkedAt: today,
    note: "책의 QR 이 가리키지만 공단 자료실(portal.kosha.or.kr)이 자료 정보를 주지 않는 자료 — 자료실에서 내려간 것으로 보고 노드를 만들지 않았다.",
    unavailable: unavailable.map((seq) => {
      const occ = byMedia.get(seq)!;
      return {
        medSeq: seq,
        qrUrls: [...new Set(occ.map((o) => o.url))],
        pages: [...new Set(occ.map((o) => o.page))].sort((a, b) => a - b),
        articles: [...new Set(occ.map((o) => o.article).filter(Boolean))],
      };
    }),
  };
  await writeFile(STATUS_FILE, JSON.stringify(status, null, 1) + "\n", "utf-8");
  console.log(`QR ${qr.occurrences.length}개 · 주소 ${urls.length}개 → 공단 자료 ${mediaSeqs.length}건 · 노드 ${written}개 (조문과 이은 것 ${linked}개) · 자료실에 없는 자료 ${unavailable.length}건`);
}

void main();
