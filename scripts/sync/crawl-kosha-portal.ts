#!/usr/bin/env tsx
/**
 * crawl-kosha-portal.ts
 *
 * KOSHA 산업안전포털(portal.kosha.or.kr) Archive 목록을 공식 내부 API 로 수집한다.
 * - 엔드포인트는 portal24 프레임워크의 공개 POST JSON API (로그인 불필요)
 * - 모든 자료는 공공누리 출처표시 의무 — 응답 메타에 자동 첨부
 * - 크롤링 결과는 src/ontology/kosha-archive-index.json 으로 저장
 *
 * 사용:
 *   npx tsx scripts/sync/crawl-kosha-portal.ts                 # 전체 카테고리
 *   npx tsx scripts/sync/crawl-kosha-portal.ts --max 200       # 상위 200건
 *   npx tsx scripts/sync/crawl-kosha-portal.ts --type ops      # OPS 만
 *
 * 목적:
 *   - 근로자·안전관리자가 안전보건자료에 쉽게 접근하도록 인덱스 제공
 *   - 공공 목적 비상업적 재사용 (공공누리 제1~3유형 준수)
 */

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUTPUT = resolve(ROOT, "src", "ontology", "kosha-archive-index.json");

// ─── 엔드포인트 상수 ───
const PORTAL_BASE = "https://portal.kosha.or.kr";
const ENDPOINTS = {
  mediaList: `${PORTAL_BASE}/api/portal24/bizV/p/VCPDG01007/selectMediaCateList0`,
  mediaCount: `${PORTAL_BASE}/api/portal24/bizV/p/VCPDG01007/selectMediaCateCount0`,
  fileList: `${PORTAL_BASE}/api/portal24/bizA/p/files/getFileList`,
};

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  chnlId: "portal24",
  Referer: "https://portal.kosha.or.kr/archive/cent-archive/master-arch",
  Accept: "application/json",
  "User-Agent":
    "agent-safety-oss-crawler/0.1 (+https://github.com/ratelworks/agent-safety-oss)",
};

// 콘텐츠 형식 코드 (실측 기반)
const CONTENT_TYPE_MAP: Record<string, { en: string; ko: string }> = {
  "01": { en: "book", ko: "책자" },
  "02": { en: "video", ko: "동영상" },
  "07": { en: "teaching_material", ko: "교안" },
  "10": { en: "other", ko: "기타" },
  "12": { en: "ops", ko: "OPS" },
};

// 인자 파싱
const args: Record<string, string | undefined> = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr): [string, string | undefined] | null =>
      a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null,
    )
    .filter((x): x is [string, string | undefined] => x !== null),
);
const MAX_ITEMS = parseInt(args.max ?? "500", 10);
const TYPE_FILTER = args.type ? args.type.toLowerCase() : null;
const DELAY_MS = parseInt(args.delay ?? "1200", 10);
const INCLUDE_ATTACHMENTS = args.attachments !== "false";

// ─── 타입 ───
interface CountBucket {
  code: string;
  label: string;
  count: number;
}

interface RawMediaItem {
  contsFbctnShpCd?: string;
  contsPblsNo?: string;
  contsAplyNo?: string;
  medSeq?: string;
  contsAtcflNo?: string | number | null;
  contsTtlNm?: string;
  srchKywdCn?: string;
  contsRegYmd?: string;
  totHitSum?: number | string;
  medThumbnailPath?: string;
}

interface NormalizedItem {
  contentId: string;
  attachmentId: string | number | null;
  title: string;
  typeCode: string;
  type: string;
  typeKo: string;
  keywords: string;
  publishedAt: string;
  hitCount: number;
  thumbnail: string | null;
  nativeUrl: string;
  attachments?: Attachment[];
}

interface Attachment {
  fileName?: string;
  ext?: string;
  size?: string | number | null;
  url?: string;
  error?: string;
}

// ─── 유틸 ───
async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${url} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ctgr01: 0,
    arrCtgrStr01: "",
    ctgr02: 0,
    arrCtgrStr02: "",
    ctgr03: 0,
    arrCtgrStr03: "",
    ctgr04: 0,
    arrCtgrStr04: "",
    ctgr05: 0,
    arrCtgrStr05: "",
    selectPeriod: "99", // 전체 기간
    startDt: null,
    endDt: null,
    searchType: "all",
    searchVal: null,
    ...overrides,
  };
}

// ─── 수집 루틴 ───
async function fetchMediaCount(): Promise<CountBucket[]> {
  const resp = await postJson<{ payload?: unknown }>(ENDPOINTS.mediaCount, baseBody());
  const payload = (resp as { payload?: unknown })?.payload ?? resp;
  const buckets: Array<Record<string, unknown>> = Array.isArray(payload)
    ? (payload as Array<Record<string, unknown>>)
    : ((payload as { list?: Array<Record<string, unknown>> })?.list ?? []);
  return buckets.map((b) => {
    const code = String(b.comCd ?? b.contsFbctnShpCd ?? "");
    return {
      code,
      label: String(b.contsFbctnShpCdNm ?? CONTENT_TYPE_MAP[code]?.ko ?? "기타"),
      count: Number(b.cnt ?? 0),
    };
  });
}

async function fetchMediaList(typeCode?: string): Promise<RawMediaItem[]> {
  const override = typeCode
    ? { arrCtgrStr01: typeCode } // 단일 유형 필터 (내부 파라미터명 유추, 실패 시 전체 반환)
    : {};
  const resp = await postJson<{ payload?: unknown }>(ENDPOINTS.mediaList, baseBody(override));
  const payload = (resp as { payload?: unknown })?.payload ?? resp;
  const list =
    (payload as { list1?: RawMediaItem[]; list?: RawMediaItem[] })?.list1 ??
    (payload as { list?: RawMediaItem[] })?.list ??
    [];
  return Array.isArray(list) ? list : [];
}

async function fetchAttachmentUrls(
  atcflNo: string | number | null | undefined,
): Promise<Attachment[]> {
  if (!atcflNo) return [];
  try {
    const resp = await postJson<{ payload?: unknown }>(ENDPOINTS.fileList, {
      fileId: String(atcflNo),
      fileUploadType: "02",
      atcflTaskColNm: "lastFile",
      atcflSeTaskComCdNm: "Y",
    });
    const payload = (resp as { payload?: unknown })?.payload ?? [];
    const rows: Array<Record<string, unknown>> = Array.isArray(payload)
      ? (payload as Array<Record<string, unknown>>)
      : ((payload as { list?: Array<Record<string, unknown>> })?.list ?? []);
    return rows.map((r) => ({
      fileName: String(r.orgnlAtchFileNm ?? r.atcflSrvrFileNm ?? ""),
      ext: String(r.atcflExtnNm ?? ""),
      size: (r.atcflSz as string | number | null) ?? null,
      url: joinPath(
        PORTAL_BASE,
        r.atcflSrvrStrgDtlPathAddr as string,
        r.atcflSrvrFileNm as string,
      ),
    }));
  } catch (err) {
    return [{ error: (err as Error).message }];
  }
}

function joinPath(base: string, dir?: string, file?: string): string {
  if (!dir || !file) return "";
  const clean = (s: string): string => String(s).replace(/^\/+|\/+$/g, "");
  return `${base}/${clean(dir)}/${clean(file)}`;
}

function normalizeItem(raw: RawMediaItem): NormalizedItem {
  const typeCode = raw.contsFbctnShpCd ?? "";
  const typeInfo = CONTENT_TYPE_MAP[typeCode] ?? { en: "unknown", ko: "기타" };
  return {
    contentId: raw.contsPblsNo ?? raw.contsAplyNo ?? raw.medSeq ?? "",
    attachmentId: raw.contsAtcflNo ?? null,
    title: raw.contsTtlNm ?? "",
    typeCode,
    type: typeInfo.en,
    typeKo: typeInfo.ko,
    keywords: raw.srchKywdCn ?? "",
    publishedAt: raw.contsRegYmd ?? "",
    hitCount: Number(raw.totHitSum ?? 0),
    thumbnail: raw.medThumbnailPath ?? null,
    nativeUrl: raw.contsPblsNo
      ? `${PORTAL_BASE}/archive/cent-archive/view?contsPblsNo=${encodeURIComponent(raw.contsPblsNo)}`
      : `${PORTAL_BASE}/archive/cent-archive/master-arch`,
  };
}

// ─── 메인 ───
(async () => {
  console.log(`[crawl] portal.kosha.or.kr archive ${new Date().toISOString()}`);
  console.log(`        max=${MAX_ITEMS} type=${TYPE_FILTER ?? "all"} delay=${DELAY_MS}ms`);

  let counts: CountBucket[] = [];
  try {
    counts = await fetchMediaCount();
    console.log(`[crawl] counts:`, counts);
  } catch (err) {
    console.warn(`[warn] count API failed: ${(err as Error).message}`);
  }

  await sleep(DELAY_MS);

  let rawItems: RawMediaItem[] = [];
  try {
    rawItems = await fetchMediaList();
    console.log(`[crawl] fetched list1: ${rawItems.length} raw items`);
  } catch (err) {
    console.error(`[err] list API failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // 유형 필터 (선택)
  if (TYPE_FILTER) {
    const target = Object.entries(CONTENT_TYPE_MAP).find(
      ([, v]) => v.en === TYPE_FILTER,
    )?.[0];
    if (target) {
      rawItems = rawItems.filter((r) => r.contsFbctnShpCd === target);
      console.log(`[crawl] after type=${TYPE_FILTER} filter: ${rawItems.length}`);
    }
  }

  const limited = rawItems.slice(0, MAX_ITEMS);
  const items: NormalizedItem[] = [];

  for (let i = 0; i < limited.length; i += 1) {
    const raw = limited[i];
    const norm = normalizeItem(raw);
    if (INCLUDE_ATTACHMENTS && norm.attachmentId) {
      norm.attachments = await fetchAttachmentUrls(norm.attachmentId);
      await sleep(DELAY_MS);
    }
    items.push(norm);
    if ((i + 1) % 25 === 0) {
      console.log(`[crawl] processed ${i + 1}/${limited.length}`);
    }
  }

  const output = {
    version: "0.1.0",
    source: "한국산업안전보건공단 산업안전포털 안전보건자료실",
    sourceUrl: "https://portal.kosha.or.kr/archive/cent-archive/master-arch",
    license: {
      framework: "공공누리 (KOGL)",
      expectedTypes: ["제1유형: 출처표시", "제3유형: 출처표시+비상업적 이용만 가능"],
      attributionRequired: true,
      attributionFormat: "출처: 한국산업안전보건공단 (KOSHA) — {sourceUrl}",
      noteForConsumers:
        "자료별로 공공누리 유형이 다를 수 있다. 각 자료의 nativeUrl 방문 시 하단 공공누리 마크로 최종 확인하라. 상업적 재배포 전에는 반드시 KOSHA 에 확인.",
    },
    crawledAt: new Date().toISOString(),
    totalCounts: counts,
    collectedCount: items.length,
    items,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(output, null, 2), "utf8");
  console.log(`[done] wrote ${items.length} items → ${OUTPUT}`);
})();
