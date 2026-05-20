#!/usr/bin/env tsx
/**
 * GAP-1: KOSHA Guide 1039 전수 fetch → 미수집 222 jsonld 노드화
 *
 * Live API: https://agentsafetyrelay-...run.app/api/kosha-guides
 * 라이선스: 공공누리 출처표시 (KOSHA), 변경금지 — 메타(번호·제목·발행일·다운로드URL)만 보존, 본문은 fetchUrl로 동적 조회
 *
 * 추가 노드 형식 (기존 817 노드와 동일):
 *   @id: doc:kosha_guide/{techGdlnNo}
 *   @type: ["Document", "DigitalDocument"]
 *   title: techGdlnNm
 *   cycle: cyc:reference
 *   _meta: { publishedBy, sourceUrl, guideNo, guideCategory, fetchedAt, license }
 */
import { writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
const RELAY = "https://agentsafetyrelay-622699652854.asia-northeast3.run.app/api/kosha-guides";

interface GuideItem {
  techGdlnNm: string;
  techGdlnNo: string;
  techGdlnOfancYmd: string;
  fileDownloadUrl: string;
}

// guide 번호 prefix → category 매핑
function categoryOf(no: string): string {
  const p = no[0]?.toUpperCase();
  return ({
    A: "occupational_health",  // 작업환경측정
    B: "biological",           // 생물학적
    C: "chemical",             // 화학물질
    D: "construction",         // 건설
    E: "electrical",           // 전기
    F: "fire",                 // 소방·화재
    G: "general",              // 일반
    H: "health",               // 보건
    K: "manual_handling",      // 인간공학
    M: "machinery",            // 기계
    O: "occupational_disease", // 직업병
    T: "transport",            // 운반·교통
    W: "welding",              // 용접
    X: "other",                // 기타
  } as Record<string, string>)[p ?? ""] ?? "general";
}

// 건설 도메인 관련성 — D/G/X(일부) 한정 + 키워드 매칭
function constructionRelevance(no: string, title: string): "construction" | "general_applicable" | "out_of_domain" {
  const cat = categoryOf(no);
  if (cat === "construction") return "construction";
  if (/(건설|굴착|타워크레인|비계|거푸집|동바리|콘크리트|철골|항타|터널|교량|도로|해체|발파|매설)/.test(title)) return "construction";
  if (cat === "general") return "general_applicable";
  return "general_applicable"; // 모든 안전 가이드는 건설 현장에 적용 가능 (기본값)
}

async function fetchAll(): Promise<GuideItem[]> {
  const all: GuideItem[] = [];
  const pageSize = 200;
  let page = 1;
  while (true) {
    const url = `${RELAY}?numOfRows=${pageSize}&pageNo=${page}`;
    const r = await fetch(url);
    const j = await r.json() as any;
    const items = j?.body?.items?.item;
    if (!items || !Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    const total = j?.body?.totalCount ?? 0;
    process.stdout.write(`\r  fetched ${all.length}/${total}`);
    if (all.length >= total) break;
    page++;
    if (page > 20) break; // 안전 한도
  }
  process.stdout.write("\n");
  return all;
}

async function main() {
  console.log("[1] KOSHA Guide 1039 전수 fetch...");
  const guides = await fetchAll();
  console.log(`    ✓ ${guides.length}건 fetch 완료`);

  console.log("[2] 기존 노드 인덱스...");
  const existing = new Set<string>();
  for (const f of await readdir(GUIDES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const no = f.replace(/\.jsonld$/, "").replace(/-/g, "-").toUpperCase();
    // 파일명 형식: a-1-2018.jsonld → "A-1-2018"
    const upper = f.replace(/\.jsonld$/, "").toUpperCase();
    existing.add(upper);
  }
  console.log(`    ✓ ${existing.size} 기존 노드`);

  console.log("[3] 미수집 가이드 추출...");
  const missing = guides.filter((g) => {
    const slug = g.techGdlnNo.toLowerCase();
    const fileName = slug + ".jsonld";
    return !existing.has(slug.toUpperCase());
  });
  console.log(`    ✓ ${missing.length}건 미수집`);

  console.log("[4] jsonld 노드 생성...");
  const fetchedAt = new Date().toISOString().substring(0, 10);
  let created = 0;
  for (const g of missing) {
    const slug = g.techGdlnNo.toLowerCase();
    const path = resolve(GUIDES_DIR, `${slug}.jsonld`);
    const cat = categoryOf(g.techGdlnNo);
    const relevance = constructionRelevance(g.techGdlnNo, g.techGdlnNm);
    const node = {
      "@context": "../../../context.jsonld",
      "@id": `doc:kosha_guide/${g.techGdlnNo}`,
      "@type": ["Document", "DigitalDocument"],
      docId: `kosha_guide_${slug}`,
      title: g.techGdlnNm,
      cycle: "cyc:reference",
      verificationStatus: "kosha_live_verified",
      jurisdiction: "KR",
      constructionRelevance: relevance,
      _meta: {
        publishedBy: "한국산업안전보건공단 (KOSHA)",
        sourceApi: "data.go.kr 15144147 (KOSHA Guide 조회 서비스)",
        sourceUrl: "https://www.kosha.or.kr/kosha/data/guideExp.do",
        guideNo: g.techGdlnNo,
        guideCategory: cat,
        publishedDate: g.techGdlnOfancYmd ?? null,
        fileDownloadUrl: g.fileDownloadUrl ?? null,
        fetchedAt,
        licenseHint: "공공누리 출처표시 (KOSHA)",
      },
    };
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    created++;
  }
  console.log(`    ✓ ${created}개 신규 노드 생성`);

  // 통계
  const after = (await readdir(GUIDES_DIR)).filter((f) => f.endsWith(".jsonld")).length;
  console.log(`\n[done] KOSHA Guide ${existing.size} → ${after} (${guides.length} 목표 ${(after/guides.length*100).toFixed(1)}%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
