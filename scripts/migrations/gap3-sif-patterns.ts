#!/usr/bin/env tsx
/**
 * GAP-3: KOSHA 사고사례 6,324건 → 50 패턴 노드 그래프화
 *
 * 라이선스 안전: 본문은 저장 안 함. keyword + business 카테고리 + 빈도만 보존.
 * 패턴 = (사고유형 × 활동) 클러스터.
 *
 * 출력: nodes/patterns/{slug}.jsonld
 *   @id: event:pattern/{slug}
 *   @type: ["Event", "Pattern"]
 */
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const PATTERNS_DIR = resolve(ROOT, "src/ontology/graph/nodes/patterns");
const RELAY = "https://agentsafetyrelay-622699652854.asia-northeast3.run.app/api/accident-cases";

interface Case { business: string; contents: string; keyword: string; }

// 24 사고유형 → 키워드 패턴
const EVENT_PATTERNS: Array<{ event: string; hazards: string[]; pattern: RegExp }> = [
  { event: "fall_from_height", hazards: ["fall_from_height"], pattern: /(추락|떨어짐|떨어져|낙하)/ },
  { event: "fall_object", hazards: ["fall_object"], pattern: /(낙하물|물체에 맞|자재가 떨어|낙반)/ },
  { event: "struck_by", hazards: ["struck_by"], pattern: /(부딪힘|충돌|접촉|들이받)/ },
  { event: "caught_in", hazards: ["machine_entanglement","crushing"], pattern: /(끼임|말려들|협착)/ },
  { event: "cave_in", hazards: ["cave_in","buried_alive"], pattern: /(붕괴|무너짐|매몰|사면)/ },
  { event: "electric_shock", hazards: ["electric_shock"], pattern: /(감전|전기|누전)/ },
  { event: "fire_explosion", hazards: ["fire_explosion","fire"], pattern: /(화재|폭발|연소|화염)/ },
  { event: "asphyxiation", hazards: ["asphyxiation","acute_toxic_gas"], pattern: /(질식|산소결핍|유독가스|밀폐)/ },
  { event: "drowning", hazards: ["drowning"], pattern: /(익사|빠짐|수몰)/ },
  { event: "chemical_contact", hazards: ["chemical_exposure","chemical_burn"], pattern: /(화학|유해물질|약품 접촉|중독)/ },
  { event: "thermal_burn", hazards: ["thermal_burn","heat_stress"], pattern: /(화상|뜨거운|용융|증기)/ },
  { event: "cut_pierce", hazards: ["machine_entanglement"], pattern: /(절단|베임|찔림)/ },
  { event: "overturn_collapse", hazards: ["struck_by_overturn"], pattern: /(전도|넘어짐|장비 전복|차량 전복)/ },
  { event: "traffic_accident", hazards: ["traffic_accident"], pattern: /(교통사고|차량 충돌)/ },
  { event: "trip_slip", hazards: ["trip_slip"], pattern: /(미끄러짐|넘어짐|발을 헛디|걸려)/ },
  { event: "dust_explosion", hazards: ["fire_explosion","dust_exposure"], pattern: /(분진폭발|먼지 폭발)/ },
];

// 27 활동 → 키워드
const ACTIVITY_PATTERNS: Array<{ activity: string; pattern: RegExp }> = [
  { activity: "excavation_2m_plus", pattern: /(굴착|터파기|흙막이)/ },
  { activity: "tower_crane", pattern: /(타워크레인|TC)/ },
  { activity: "scaffolding_assembly", pattern: /(비계|작업발판|시스템 비계)/ },
  { activity: "formwork_shoring", pattern: /(거푸집|동바리|폼)/ },
  { activity: "rc_concrete", pattern: /(콘크리트|타설|RC)/ },
  { activity: "demolition", pattern: /(해체|철거)/ },
  { activity: "tunnel_excavation", pattern: /(터널|발파)/ },
  { activity: "bridge_5m_30m", pattern: /(교량|교각|상판)/ },
  { activity: "phc_pile_driving", pattern: /(항타|PHC|파일)/ },
  { activity: "steel_structure", pattern: /(철골|H-Beam|구조체)/ },
  { activity: "electric_work_50v_plus", pattern: /(전기 작업|배선|결선|배전반)/ },
  { activity: "vehicle_construction", pattern: /(굴삭기|덤프|로더|지게차)/ },
  { activity: "vehicle_cargo", pattern: /(화물차|운반|하역)/ },
  { activity: "heavy_lifting", pattern: /(양중|인양|크레인)/ },
  { activity: "asbestos_removal", pattern: /(석면)/ },
  { activity: "finishing_paint", pattern: /(도장|페인트)/ },
  { activity: "finishing_tile", pattern: /(타일|미장)/ },
  { activity: "waterproofing", pattern: /(방수)/ },
  { activity: "road_pavement", pattern: /(도로|포장|아스팔트)/ },
  { activity: "drainage_sewerage", pattern: /(상하수도|관거)/ },
  { activity: "underground_utility", pattern: /(지중|매설|관로)/ },
];

async function fetchAll(): Promise<Case[]> {
  const all: Case[] = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${RELAY}?numOfRows=200&pageNo=${page}`);
    const j = await r.json() as any;
    const items = j?.body?.items?.item;
    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    const total = j?.body?.totalCount ?? 0;
    process.stdout.write(`\r  fetched ${all.length}/${total}`);
    if (all.length >= total) break;
    page++;
    if (page > 35) break;
  }
  process.stdout.write("\n");
  return all;
}

function classify(c: Case): { event: string; hazards: string[]; activity: string | null } | null {
  const txt = (c.contents ?? "") + " " + (c.keyword ?? "");
  let event: string | null = null;
  let hazards: string[] = [];
  for (const ep of EVENT_PATTERNS) {
    if (ep.pattern.test(txt)) { event = ep.event; hazards = ep.hazards; break; }
  }
  if (!event) return null;
  let activity: string | null = null;
  for (const ap of ACTIVITY_PATTERNS) {
    if (ap.pattern.test(txt)) { activity = ap.activity; break; }
  }
  return { event, hazards, activity };
}

async function main() {
  console.log("[1] KOSHA 사고사례 전수 fetch...");
  const cases = await fetchAll();
  console.log(`    ✓ ${cases.length}건`);

  console.log("[2] 건설업 필터 + 분류...");
  const construction = cases.filter((c) => c.business?.includes("건설"));
  console.log(`    ✓ 건설업 ${construction.length}건`);

  // 패턴 카운트: (event, activity) 조합
  const patternCount = new Map<string, { event: string; activity: string | null; hazards: string[]; count: number; samples: string[] }>();
  let unclassified = 0;
  for (const c of construction) {
    const cls = classify(c);
    if (!cls) { unclassified++; continue; }
    const key = `${cls.event}|${cls.activity ?? "general"}`;
    if (!patternCount.has(key)) {
      patternCount.set(key, { event: cls.event, activity: cls.activity, hazards: cls.hazards, count: 0, samples: [] });
    }
    const p = patternCount.get(key)!;
    p.count++;
    if (p.samples.length < 3 && c.keyword) p.samples.push(c.keyword);
  }
  console.log(`    ✓ ${patternCount.size}개 패턴 / 미분류 ${unclassified}건`);

  // 빈도 ≥ 3 패턴 (희소 사고유형까지 커버)
  const significant = [...patternCount.entries()]
    .filter(([, p]) => p.count >= 3)
    .sort((a, b) => b[1].count - a[1].count);
  console.log(`    ✓ 빈도 ≥3 패턴: ${significant.length}개`);

  console.log("[3] jsonld 패턴 노드 생성...");
  await mkdir(PATTERNS_DIR, { recursive: true });
  const fetchedAt = new Date().toISOString().substring(0, 10);
  let created = 0;
  for (const [key, p] of significant) {
    const slug = key.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    const path = resolve(PATTERNS_DIR, `${slug}.jsonld`);
    const node: any = {
      "@context": "../../context.jsonld",
      "@id": `event:pattern/${slug}`,
      "@type": ["Event"],
      slug,
      title: `${p.event}${p.activity ? ` × ${p.activity}` : ""}`,
      description: `KOSHA 건설업 사고사례 빈도 패턴 — ${p.count}건 관측. 사고유형 ${p.event}${p.activity ? ` 작업유형 ${p.activity}` : ""}.`,
      koshaAccidentType: p.event,
      hasHazard: p.hazards.map((h) => `hazard:${h}`),
      causedBy: p.activity ? [`activity:${p.activity}`] : [],
      caseFrequency: p.count,
      sampleKeywords: p.samples,
      _meta: {
        publishedBy: "한국산업안전보건공단 (KOSHA) 사고사례",
        sourceApi: "data.go.kr 15140383 (KOSHA 사고사례 조회 서비스)",
        sourceUrl: "https://www.kosha.or.kr/kosha/data/accidentCase.do",
        fetchedAt,
        license: "공공누리 출처표시 (KOSHA) — keyword·빈도만 보존, 본문 미저장",
      },
    };
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    created++;
  }
  console.log(`    ✓ ${created}개 패턴 노드 생성`);
}

main().catch((e) => { console.error(e); process.exit(1); });
