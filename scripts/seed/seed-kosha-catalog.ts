#!/usr/bin/env tsx
/**
 * seed-kosha-catalog.ts (P-A)
 *
 * KOSHA Live API (data.go.kr 15144147) 전체 카탈로그(1039+ 건) 메타 자동 흡수.
 *
 * 본 OSS 정체성: "한국 안전 도메인 표준 그래프 인프라".
 * 환각 0 — 모든 데이터가 KOSHA Live API ground truth 직접 추출.
 *
 * 흡수 필드:
 *   - techGdlnNo (KOSHA 공식 번호)
 *   - techGdlnNm (공식 제목)
 *   - 카테고리 (번호 prefix → A/B-E/B-M/C/C-C/D/D-C/E/E-G/E-M/F/G/H/K/M/O/P/T/W/X 등)
 *   - sourceUrl (KOSHA 공식)
 *   - 발행일/개정일 (KOSHA 응답에 있으면)
 *
 * 의도적 제외:
 *   - description (본문 발췌 금지 — 환각 통로 차단)
 *   - 14종 문서 매핑 (P-F에서 별도 단계)
 *   - Activity·Hazard·Control 매핑 (P-G에서 단계적)
 *
 * 멱등 — 재실행 시 상태 유지.
 */

import { writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 파일 최상단 상수
const DEFAULT_RELAY_URL =
  "https://agentsafetyrelay-622699652854.asia-northeast3.run.app";
const PAGE_SIZE = 200;
const MAX_PAGES = 20;
const FETCH_TIMEOUT_MS = 20_000;
const FETCHED_AT = new Date().toISOString().slice(0, 10);

// KOSHA 카테고리 분류 (techGdlnNo prefix → 도메인 카테고리)
const CATEGORY_MAP: Record<string, string> = {
  A: "occupational_hygiene", // 작업환경측정·분석
  B: "machine_electric",     // 기계·전기 안전 (B-M, B-E)
  C: "construction",         // 건설 (C-* 및 C-C 화학 일부)
  D: "chemical",             // 화학·D-C 건설 신규
  E: "electric_health",      // 전기·보건 (E-*, E-G, E-M)
  F: "fire",                 // 화재
  G: "general",              // 일반
  H: "health",               // 보건·산업위생
  K: "research",             // 연구·분석
  M: "machine",              // 기계
  O: "miscellaneous",        // 기타
  P: "process",              // 공정·플랜트
  T: "toxicity",             // 독성·생물학
  W: "thermal",              // 한랭·온열
  X: "general_safety",       // 일반 안전
};

// D-C, B-E 등 prefix 인식
function detectCategory(no: string): string {
  // D-C-1-2025 → D-C / B-M-7-2025 → B-M / C-C-7-2026 → C-C
  const m = no.match(/^([A-Z](?:-[A-Z])?)-/);
  if (!m) return "uncategorized";
  const head = m[1];
  if (head === "D-C") return "construction";        // D-C는 건설 신규
  if (head === "B-M") return "machine";
  if (head === "B-E") return "electric";
  if (head === "C-C") return "chemical";
  if (head === "E-G") return "general_health";
  if (head === "E-M") return "medical_health";
  if (head === "A-G") return "general_safety";
  if (head === "A-R") return "management_system";
  // 단일 prefix
  return CATEGORY_MAP[head[0]] ?? "uncategorized";
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CATALOG_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");

interface KoshaItem {
  techGdlnNo: string;
  techGdlnNm: string;
  techGdlnGblsnDt?: string; // 게시일
  techGdlnRevsnDt?: string; // 개정일
  fileNm?: string;
  [k: string]: unknown;
}

async function fetchAll(relayUrl: string): Promise<KoshaItem[]> {
  const all: KoshaItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${relayUrl}/api/kosha-guides?numOfRows=${PAGE_SIZE}&pageNo=${page}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`relay ${url} → HTTP ${res.status}`);
      const data = (await res.json()) as { body?: { items?: { item?: KoshaItem[] } } };
      const items = data.body?.items?.item ?? [];
      if (items.length === 0) break;
      all.push(...items);
      if (items.length < PAGE_SIZE) break;
    } finally {
      clearTimeout(timer);
    }
  }
  return all;
}

function slugify(no: string): string {
  return no.toLowerCase().replace(/[^a-z0-9-]/g, "_");
}

function buildNode(item: KoshaItem) {
  const category = detectCategory(item.techGdlnNo);
  const meta: Record<string, unknown> = {
    publishedBy: "한국산업안전보건공단 (KOSHA)",
    sourceApi: "data.go.kr 15144147 (KOSHA Guide 조회 서비스)",
    sourceUrl: "https://www.kosha.or.kr/kosha/data/guideExp.do",
    guideNo: item.techGdlnNo,
    guideCategory: category,
    fetchedAt: FETCHED_AT,
    verifiedAt: FETCHED_AT,
    verifiedBy: "agent-safety-relay /api/kosha-guides full catalog auto-ingest",
    licenseHint: "공공자료 (출처 표기 시 활용)",
    note: "메타 노드. 본문은 번들 도구 get_kosha_guide_md(techGdlnNo) 또는 sourceUrl 직접 참조.",
  };
  if (item.techGdlnGblsnDt) meta.publishedDate = item.techGdlnGblsnDt;
  if (item.techGdlnRevsnDt) meta.revisedDate = item.techGdlnRevsnDt;
  if (item.fileNm) meta.fileName = item.fileNm;

  return {
    "@context": "../../../context.jsonld",
    "@id": `doc:kosha_guide/${item.techGdlnNo}`,
    "@type": "Document",
    docId: `kosha_guide_${slugify(item.techGdlnNo)}`,
    title: item.techGdlnNm.trim(),
    cycle: "cyc:reference",
    verificationStatus: "kosha_live_verified",
    jurisdiction: "KR",
    _meta: meta,
  };
}

(async () => {
  const relayUrl = (process.env["KOSHA_RELAY_URL"] || DEFAULT_RELAY_URL).replace(/\/$/, "");
  console.log(`# P-A — KOSHA 카탈로그 자동 흡수`);
  console.log(`  relay: ${relayUrl}`);

  console.log(`  fetch ...`);
  const items = await fetchAll(relayUrl);
  console.log(`  KOSHA Live: ${items.length} 건`);

  if (items.length < 1000) {
    console.error(`✗ 수신 비정상 (${items.length} < 1000). relay 점검 필요.`);
    process.exit(2);
  }

  // 카테고리 분포
  const byCat = new Map<string, number>();
  for (const it of items) {
    const c = detectCategory(it.techGdlnNo);
    byCat.set(c, (byCat.get(c) ?? 0) + 1);
  }
  console.log(`  카테고리 분포:`);
  for (const [c, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c.padEnd(20)} ${n}`);
  }

  // 카탈로그 디렉토리 보장
  await mkdir(CATALOG_DIR, { recursive: true });

  // 기존 메타 파일 모두 삭제 후 재시드 (멱등 + 환각 노드 자동 정리)
  const existing = await readdir(CATALOG_DIR);
  let purged = 0;
  for (const f of existing) {
    if (f.endsWith(".jsonld")) {
      await unlink(resolve(CATALOG_DIR, f));
      purged += 1;
    }
  }
  console.log(`  purge: ${purged} 개 삭제 (기존)`);

  // 신규 시드
  let written = 0;
  const seenNos = new Set<string>();
  for (const it of items) {
    if (!it.techGdlnNo) continue;
    if (seenNos.has(it.techGdlnNo)) continue; // KOSHA가 동일 번호 중복 반환 방어
    seenNos.add(it.techGdlnNo);
    const node = buildNode(it);
    const fname = `${slugify(it.techGdlnNo)}.jsonld`;
    await writeFile(resolve(CATALOG_DIR, fname), JSON.stringify(node, null, 2) + "\n", "utf8");
    written += 1;
  }
  console.log(`  seed: ${written} 개 시드 (중복 제외)`);
  console.log(`\n✓ P-A 완료 — KOSHA 카탈로그 메타 ${written}개 그래프 흡수.`);
})();
