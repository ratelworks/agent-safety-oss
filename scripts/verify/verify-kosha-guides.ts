#!/usr/bin/env tsx
/**
 * verify-kosha-guides.ts (Gate 1)
 *
 * 본 OSS 그래프에 시드된 KOSHA Guide IRI 가 실제 KOSHA Live API
 * (data.go.kr 15144147) 카탈로그에 존재하는지 cross-check.
 *
 * P15·P16 환각 사례 (시드된 31개 모두 가공 번호) 재발 차단.
 *
 * 동작:
 *   1) src/ontology/graph/nodes/documents/guides/*.jsonld 의 모든 _meta.guideNo 추출
 *   2) relay /api/kosha-guides 1039 건 페이지네이션 fetch (캐시: /tmp/kosha-live-cache.json TTL 30일)
 *   3) techGdlnNo 일치 검증 — 미매칭 1건이라도 발견 시 exit 1
 *   4) 매칭 시 techGdlnNm 도 본 OSS title 과 cross-check (오타·약칭 검출)
 *
 * 사용:
 *   - 개발 중 수동: npm run verify-kosha
 *   - 배포 전 자동: prepublishOnly chain
 *
 * 환경변수:
 *   - KOSHA_RELAY_URL (기본 라텔웍스 운영 relay)
 *   - VERIFY_KOSHA_CACHE_TTL_HOURS (기본 720 = 30일, KOSHA 개정 빈도 매우 낮음)
 */

import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { getAgentHqKey, AGENTHQ_SIGNUP_URL } from "../../src/config/env.js";

// 파일 최상단 상수
const DEFAULT_RELAY_URL =
  "https://agentsafetyrelay-622699652854.asia-northeast3.run.app";
const PAGE_SIZE = 200;
const CACHE_FILE = resolve(tmpdir(), "agent-safety-oss-kosha-live-cache.json");
const DEFAULT_CACHE_TTL_HOURS = 720; // 30일
const FETCH_TIMEOUT_MS = 20_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");

interface GuideNode {
  filePath: string;
  iri: string;
  guideNo: string;
  title: string;
  verificationStatus?: string;
}

interface KoshaItem {
  techGdlnNo: string;
  techGdlnNm: string;
  [k: string]: unknown;
}

interface CachePayload {
  fetchedAt: string;
  count: number;
  items: KoshaItem[];
}

async function loadSeededGuides(): Promise<GuideNode[]> {
  const out: GuideNode[] = [];
  const files = await readdir(GUIDES_DIR);
  for (const f of files) {
    if (!f.endsWith(".jsonld")) continue;
    const filePath = resolve(GUIDES_DIR, f);
    const node = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown> & {
      "@id"?: string;
      title?: string;
      verificationStatus?: string;
      _meta?: { guideNo?: string };
    };
    const guideNo = node._meta?.guideNo;
    if (!guideNo) {
      throw new Error(`[seed-error] ${f}: _meta.guideNo 누락 — 시드 정책 위반`);
    }
    out.push({
      filePath,
      iri: String(node["@id"] ?? ""),
      guideNo,
      title: String(node.title ?? ""),
      verificationStatus: node.verificationStatus,
    });
  }
  return out;
}

async function loadCache(ttlHours: number): Promise<CachePayload | null> {
  try {
    const st = await stat(CACHE_FILE);
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs > ttlHours * 60 * 60 * 1000) return null;
    const raw = await readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as CachePayload;
  } catch {
    return null;
  }
}

async function saveCache(payload: CachePayload): Promise<void> {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(payload), "utf8");
}

async function fetchAllKoshaGuides(relayUrl: string, apiKey: string): Promise<KoshaItem[]> {
  const all: KoshaItem[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = `${relayUrl}/api/kosha-guides?numOfRows=${PAGE_SIZE}&pageNo=${page}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      // 라텔웍스 relay 는 AgentHQ API 키 Bearer 인증을 요구한다. 키 누락 시 401.
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        throw new Error(`relay ${url} → HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        body?: { items?: { item?: KoshaItem[] } };
      };
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

interface VerifyReport {
  ok: GuideNode[];
  titleMismatch: Array<{ node: GuideNode; liveTitle: string }>;
  notFound: GuideNode[];
}

function verify(seeds: GuideNode[], live: KoshaItem[]): VerifyReport {
  const liveByNo = new Map<string, KoshaItem>();
  for (const it of live) liveByNo.set(it.techGdlnNo, it);

  const ok: GuideNode[] = [];
  const titleMismatch: Array<{ node: GuideNode; liveTitle: string }> = [];
  const notFound: GuideNode[] = [];

  for (const s of seeds) {
    const hit = liveByNo.get(s.guideNo);
    if (!hit) {
      notFound.push(s);
      continue;
    }
    // 제목은 KOSHA 측 공백·괄호 차이가 있을 수 있어 normalize 후 비교 (앞 30자)
    const norm = (x: string) => x.replace(/\s+/g, "").replace(/[()]/g, "");
    const seedHead = norm(s.title).slice(0, 30);
    const liveHead = norm(hit.techGdlnNm).slice(0, 30);
    if (seedHead && liveHead && seedHead !== liveHead) {
      titleMismatch.push({ node: s, liveTitle: hit.techGdlnNm });
    }
    ok.push(s);
  }
  return { ok, titleMismatch, notFound };
}

(async () => {
  const relayUrl = (process.env["KOSHA_RELAY_URL"] || DEFAULT_RELAY_URL).replace(/\/$/, "");
  const ttl = Number(process.env["VERIFY_KOSHA_CACHE_TTL_HOURS"]) || DEFAULT_CACHE_TTL_HOURS;
  // --strict 또는 VERIFY_KOSHA_STRICT=1 면 키 누락 / 네트워크 실패를 hard fail 로 본다.
  // 기본은 skip 모드 — 오프라인·키 미발급 환경에서 release gate 가 깨지지 않도록 한다.
  const strict =
    process.argv.includes("--strict") || (process.env["VERIFY_KOSHA_STRICT"] ?? "") === "1";

  console.log(`# Gate 1 — KOSHA Guide Live cross-check`);
  console.log(`  relay: ${relayUrl}`);
  console.log(`  mode: ${strict ? "strict (skip = exit 2)" : "lenient (skip = exit 0)"}`);

  const seeds = await loadSeededGuides();
  console.log(`  seeded guides: ${seeds.length}`);

  // KOSHA Live 데이터 (캐시 우선)
  let live: KoshaItem[];
  const cached = await loadCache(ttl);
  if (cached) {
    live = cached.items;
    console.log(`  KOSHA Live (cache ${cached.fetchedAt}): ${live.length}`);
  } else {
    // 캐시 미존재 → relay fetch 필요. 라텔웍스 relay 는 AgentHQ API 키를 요구한다.
    // 키가 없으면 fetch 가 401 로 깨지므로, 명시적으로 skip 모드로 빠진다.
    const apiKey = getAgentHqKey();
    if (!apiKey) {
      const msg =
        `[verify-kosha] AgentHQ API 키가 등록되지 않아 KOSHA Live cross-check 를 건너뜁니다.\n` +
        `  발급: ${AGENTHQ_SIGNUP_URL}\n` +
        `  등록: AGENTHQ_API_KEY 환경변수 또는 link_company_key MCP 도구.\n` +
        `  강제 실패가 필요하면 --strict 플래그 또는 VERIFY_KOSHA_STRICT=1.`;
      if (strict) {
        console.error(msg);
        console.error("✗ Gate 1 FAIL — strict 모드에서는 키 누락이 hard fail 입니다.");
        process.exit(2);
      }
      console.warn(msg);
      console.log("⊘ Gate 1 SKIPPED — lenient 모드. release gate 통과 처리.");
      process.exit(0);
    }
    console.log(`  KOSHA Live fetch ...`);
    try {
      live = await fetchAllKoshaGuides(relayUrl, apiKey);
    } catch (e) {
      const msg = `[verify-kosha] relay fetch 실패: ${(e as Error).message}`;
      if (strict) {
        console.error(msg);
        process.exit(2);
      }
      console.warn(msg);
      console.log("⊘ Gate 1 SKIPPED — lenient 모드. release gate 통과 처리.");
      process.exit(0);
    }
    await saveCache({ fetchedAt: new Date().toISOString(), count: live.length, items: live });
    console.log(`  KOSHA Live (fresh): ${live.length}`);
  }

  if (live.length < 100) {
    console.error(`✗ KOSHA Live 응답 비정상 (수신 ${live.length} 건). relay 점검 필요.`);
    process.exit(2);
  }

  const report = verify(seeds, live);
  console.log("");
  console.log(`  ✓ 매칭: ${report.ok.length}`);
  console.log(`  ⚠ 제목 불일치: ${report.titleMismatch.length}`);
  console.log(`  ✗ Live 미매칭(환각 의심): ${report.notFound.length}`);

  if (report.titleMismatch.length > 0) {
    console.log("\n[제목 불일치 — 약칭/오타 점검 필요]");
    for (const t of report.titleMismatch) {
      console.log(`  ⚠ ${t.node.guideNo}`);
      console.log(`    seed:  ${t.node.title}`);
      console.log(`    live:  ${t.liveTitle}`);
    }
  }

  if (report.notFound.length > 0) {
    console.log("\n[환각 의심 — KOSHA 공식 카탈로그 미존재]");
    for (const n of report.notFound) {
      console.log(`  ✗ ${n.guideNo}  (${n.iri})`);
      console.log(`    file: ${n.filePath.replace(ROOT + "/", "")}`);
      console.log(`    title: ${n.title}`);
    }
    console.error("\n✗ Gate 1 FAIL — 환각 KOSHA Guide 시드 발견. 정정 후 재실행 필요.");
    process.exit(1);
  }

  console.log("\n✓ Gate 1 PASS — 모든 KOSHA Guide 시드가 Live 카탈로그와 일치.");
})();
