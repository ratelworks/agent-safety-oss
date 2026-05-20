#!/usr/bin/env tsx
/**
 * Phase A-2 Step 2: 108 KOSHA facet → 그래프 노드 + 활동·위험·장비 cross-link
 *
 * 결과:
 *   - context.jsonld: facet, shp prefix 추가
 *   - nodes/facets/group/ctgr01..05.jsonld (5개 facet group)
 *   - nodes/facets/code/{ctgr}_{code}.jsonld (108개 facet)
 *   - nodes/facets/shp/{ops|video|book|ppt|other}.jsonld (5개 콘텐츠 형식)
 *
 * 신입이 8,976 자료실 트리에서 헤매는 대신 facet IRI traversal로 도달:
 *   facet:ctgr03/04 (굴착작업) → activity:excavation_2m_plus → 작업계획서 굴착 (doc:work_plan/excavation)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const FACET_JSON = resolve(ROOT, "src/ontology/kosha-archive-facets.json");
const NODES = resolve(ROOT, "src/ontology/graph/nodes/facets");
const CONTEXT = resolve(ROOT, "src/ontology/graph/context.jsonld");

// ─── facet code → activity / hazard / event / equipment 매핑
// 모든 매핑은 그래프 활용도를 높이는 cross-reference. 매칭 안 되는 코드는 group만 연결.

// ctgr01 일반분야 (17) — 위험·이벤트 매핑 우선
const CTGR01_MAP: Record<string, { hazards?: string[]; events?: string[]; activities?: string[]; controls?: string[] }> = {
  "01": { events: ["trip_slip"], hazards: ["trip_slip"] },        // 전도
  "02": { },                                                       // 조도
  "03": { controls: ["control:eng_guard_rail"] },                 // 안전난간
  "04": { },                                                       // 비상구
  "05": { },                                                       // 통로
  "06": { hazards: ["fall_from_height"] },                        // 계단
  "07": { hazards: ["fall_from_height"] },                        // 사다리
  "08": { },                                                       // 보호구 (별도 PPE 그래프)
  "09": { hazards: ["fall_from_height"], events: ["fall_from_height"] }, // 추락
  "10": { },                                                       // 위험
  "11": { hazards: ["fall_object"], events: ["fall_object"] },    // 낙하
  "12": { events: ["fire_explosion"], hazards: ["fire", "fire_explosion"] },// 화재
  "13": { events: ["dust_explosion"], hazards: ["fire_explosion"] },// 폭발
  "14": { hazards: ["thermal_burn"], events: ["thermal_burn"] },  // 화상
  "15": { },                                                       // 위생
  "16": { },                                                       // 직업병
  "17": { events: ["traffic_accident"], hazards: ["traffic_accident"] }, // 교통사고
};

// ctgr02 기계설비 (36) — equipment·activity 매핑
const CTGR02_MAP: Record<string, { equipment?: string[]; hazards?: string[]; activities?: string[] }> = {
  "10": { equipment: ["equipment:crane"], activities: ["activity:tower_crane"] }, // 크레인
  "13": { equipment: ["equipment:lift"] },                                          // 리프트
  "14": { equipment: ["equipment:gondola"] },                                       // 곤돌라
  "16": { hazards: ["machine_entanglement"] },                                      // 컨베이어
  "20": { equipment: ["equipment:welding_cutting_apparatus"] },                     // 용접기
  "21": { equipment: ["equipment:ac_arc_welder"] },                                 // 교류아크용접기
  "22": { equipment: ["equipment:aerial_work_platform"] },                          // 고소작업대
  "23": { equipment: ["equipment:pressure_vessel"] },                               // 압력용기
  "27": { equipment: ["equipment:shear_bender"] },                                  // 전단기·절곡기
  "28": { equipment: ["equipment:power_saw"] },                                     // 동력식수공구
};

// ctgr03 작업 (24) — activity 매핑
const CTGR03_MAP: Record<string, { activities?: string[]; hazards?: string[] }> = {
  "01": { activities: ["activity:formwork_shoring"] },           // 거푸집
  "02": { activities: ["activity:formwork_shoring"] },           // 동바리
  "03": { activities: ["activity:rc_concrete"] },                // 콘크리트타설
  "04": { activities: ["activity:excavation_2m_plus"], hazards: ["cave_in", "buried_alive"] }, // 굴착작업
  "05": { activities: ["activity:excavation_2m_plus"], hazards: ["cave_in"] },     // 흙막이지보공
  "07": { activities: ["activity:tunnel_excavation"] },          // 터널작업
  "08": { hazards: ["fall_object"] },                            // 낙반
  "09": { activities: ["activity:tunnel_excavation"] },          // 터널지보공
  "11": { activities: ["activity:tunnel_excavation"] },          // 터널발파
  "12": { activities: ["activity:scaffolding_assembly"] },       // 비계
  "13": { activities: ["activity:scaffolding_assembly"] },       // 작업발판
  "14": { activities: ["activity:demolition"], hazards: ["fall_object", "struck_by"] }, // 해체
  "15": { activities: ["activity:steel_structure"] },            // 철골
  "17": { activities: ["activity:phc_pile_driving"] },           // 항타·항발
  "18": { activities: ["activity:bridge_5m_30m"] },              // 교량
  "19": { activities: ["activity:road_pavement"] },              // 도로포장
  "20": { activities: ["activity:drainage_sewerage"] },          // 상하수도
  "21": { activities: ["activity:underground_utility"] },        // 지중매설
  "22": { activities: ["activity:waterproofing"] },              // 방수
  "23": { activities: ["activity:finishing_paint"] },            // 도장
  "24": { activities: ["activity:finishing_tile"] },             // 타일·미장
};

// ctgr04 직업건강 (28) — hazard·activity 매핑
const CTGR04_MAP: Record<string, { hazards?: string[]; activities?: string[]; events?: string[] }> = {
  "03": { hazards: ["chemical_exposure"] },                                       // 특별관리물질
  "04": { hazards: ["chemical_exposure", "chemical_burn"] },                      // 화학물질관리
  "08": { hazards: ["asphyxiation"], activities: ["activity:asbestos_removal"] }, // 석면
  "10": { hazards: ["noise_exposure"] },                                          // 소음
  "11": { hazards: ["vibration_exposure"] },                                      // 진동
  "13": { hazards: ["dust_exposure"], events: ["dust_exposure"] },               // 분진
  "14": { hazards: ["asphyxiation"] },                                            // 산소결핍
  "16": { hazards: ["asphyxiation", "acute_toxic_gas"], events: ["asphyxiation"] }, // 밀폐공간
  "17": { hazards: ["heat_stress"] },                                             // 고온·한랭
  "18": { hazards: ["radiation_exposure"], events: ["radiation_exposure"] },     // 방사선
  "19": { hazards: ["biological_hazard"], events: ["biological_infection"] },    // 생물학적
  "20": { hazards: ["ergonomic_overload", "manual_handling", "msd_repetitive"], events: ["msd_overload"] }, // 근골격계
  "21": { hazards: ["psychosocial_stress"], events: ["job_stress"] },            // 직무스트레스
};

const SHP_NODES: Array<{ slug: string; code: string; ko: string }> = [
  { slug: "ops", code: "12", ko: "OPS (One Point Sheet)" },
  { slug: "video", code: "02", ko: "동영상" },
  { slug: "book", code: "01", ko: "책자" },
  { slug: "ppt", code: "07", ko: "교안 (PPT)" },
  { slug: "other", code: "10", ko: "기타" },
];

const COUNT_HINT: Record<string, number> = {
  ops: 3629, video: 803, book: 1133, ppt: 486, other: 2925,
};

interface FacetCode { code: string; name: string; }
interface FacetGroup { groupId: string; ko: string; count: number; codes: FacetCode[]; }
interface FacetData {
  fetchedAt: string;
  sourceUrl: string;
  license: string;
  facetGroups: Record<string, FacetGroup>;
}

async function patchContext() {
  const ctx = JSON.parse(await readFile(CONTEXT, "utf-8"));
  let added = 0;
  if (!ctx["@context"].facet) {
    ctx["@context"].facet = "https://safety.ratelworks.org/facet/";
    added++;
  }
  if (!ctx["@context"].shp) {
    ctx["@context"].shp = "https://safety.ratelworks.org/shp/";
    added++;
  }
  if (!ctx["@context"].Facet) {
    ctx["@context"].Facet = "safety:Facet";
    added++;
  }
  if (!ctx["@context"].FacetGroup) {
    ctx["@context"].FacetGroup = "safety:FacetGroup";
    added++;
  }
  if (!ctx["@context"].ContentForm) {
    ctx["@context"].ContentForm = "safety:ContentForm";
    added++;
  }
  if (!ctx["@context"].facetGroup) {
    ctx["@context"].facetGroup = { "@id": "safety:facetGroup", "@type": "@id" };
    added++;
  }
  if (!ctx["@context"].koshaArchiveCode) {
    ctx["@context"].koshaArchiveCode = "safety:koshaArchiveCode";
    added++;
  }
  if (!ctx["@context"].koshaArchiveCount) {
    ctx["@context"].koshaArchiveCount = "safety:koshaArchiveCount";
    added++;
  }
  await writeFile(CONTEXT, JSON.stringify(ctx, null, 2) + "\n", "utf-8");
  return added;
}

// 5종 매핑 필드 모두 옵션으로 노출 — 호출부(228~230)에서 events/equipment/controls 접근.
// 빈 매핑은 Partial<> 로 표현해 TS 에서 누락 필드 안전 접근 (각 ?? [] 처리).
type FacetMapping = Partial<{
  activities: string[];
  hazards: string[];
  events: string[];
  equipment: string[];
  controls: string[];
}>;

function getMap(ctgr: string, code: string): FacetMapping {
  if (ctgr === "ctgr01") return CTGR01_MAP[code] ?? {};
  if (ctgr === "ctgr02") return CTGR02_MAP[code] ?? {};
  if (ctgr === "ctgr03") return CTGR03_MAP[code] ?? {};
  if (ctgr === "ctgr04") return CTGR04_MAP[code] ?? {};
  return {};
}

async function main() {
  const data: FacetData = JSON.parse(await readFile(FACET_JSON, "utf-8"));
  await mkdir(resolve(NODES, "group"), { recursive: true });
  await mkdir(resolve(NODES, "code"), { recursive: true });
  await mkdir(resolve(NODES, "shp"), { recursive: true });

  const ctxAdd = await patchContext();
  console.log(`[context] +${ctxAdd} 신규 prefix/term`);

  // 5 group 노드
  for (const [ctgr, group] of Object.entries(data.facetGroups)) {
    const node: any = {
      "@context": "../../../context.jsonld",
      "@id": `facet:group/${ctgr}`,
      "@type": "FacetGroup",
      slug: ctgr,
      title: group.ko,
      description: `KOSHA 산업안전포털 자료실 ${ctgr} 분류 (${group.ko}) — ${group.count}개 코드. search_kosha_archive 의 ${ctgr} 파라미터 사용.`,
      koshaArchiveCount: group.count,
      _meta: {
        publishedBy: "한국산업안전보건공단 (KOSHA)",
        sourceUrl: data.sourceUrl,
        groupId: group.groupId,
        license: data.license,
        fetchedAt: data.fetchedAt,
      },
    };
    await writeFile(resolve(NODES, "group", `${ctgr}.jsonld`), JSON.stringify(node, null, 2) + "\n", "utf-8");
  }

  // 108 facet 코드 노드
  let totalNodes = 0, mappedCount = 0;
  for (const [ctgr, group] of Object.entries(data.facetGroups)) {
    for (const c of group.codes) {
      const m = getMap(ctgr, c.code);
      const node: any = {
        "@context": "../../../context.jsonld",
        "@id": `facet:${ctgr}/${c.code}`,
        "@type": "Facet",
        slug: `${ctgr}_${c.code}`,
        title: c.name,
        description: `KOSHA 자료실 ${group.ko} > ${c.name}. search_kosha_archive 호출 시 ${ctgr}='${c.code}' 사용.`,
        facetGroup: `facet:group/${ctgr}`,
        koshaArchiveCode: c.code,
        _meta: {
          publishedBy: "한국산업안전보건공단 (KOSHA)",
          sourceUrl: `https://portal.kosha.or.kr/archive/cent-archive/master-arch?${ctgr}=${c.code}`,
          ctgr,
          ko: group.ko,
          fetchedAt: data.fetchedAt,
        },
      };

      let hasMapping = false;
      if (m.activities?.length) { node.appliesToActivities = m.activities; hasMapping = true; }
      if (m.hazards?.length) { node.hasHazard = m.hazards.map((h: string) => `hazard:${h}`); hasMapping = true; }
      if (m.events?.length) { node.references = m.events.map((e: string) => `event:${e}`); hasMapping = true; }
      if (m.equipment?.length) { node.involves = m.equipment; hasMapping = true; }
      if (m.controls?.length) { node.mitigatedBy = m.controls; hasMapping = true; }
      if (hasMapping) mappedCount++;

      await writeFile(resolve(NODES, "code", `${ctgr}_${c.code}.jsonld`), JSON.stringify(node, null, 2) + "\n", "utf-8");
      totalNodes++;
    }
  }

  // 5 콘텐츠 형식 노드
  for (const s of SHP_NODES) {
    const node: any = {
      "@context": "../../../context.jsonld",
      "@id": `shp:${s.slug}`,
      "@type": "ContentForm",
      slug: s.slug,
      title: s.ko,
      description: `KOSHA 자료실 콘텐츠 형식 ${s.ko}. search_kosha_archive 의 shpCd='${s.slug}' (실제 코드 ${s.code}).`,
      koshaArchiveCode: s.code,
      koshaArchiveCount: COUNT_HINT[s.slug] ?? 0,
      _meta: {
        publishedBy: "한국산업안전보건공단 (KOSHA)",
        sourceUrl: `https://portal.kosha.or.kr/archive/cent-archive/master-arch`,
        fetchedAt: data.fetchedAt,
      },
    };
    await writeFile(resolve(NODES, "shp", `${s.slug}.jsonld`), JSON.stringify(node, null, 2) + "\n", "utf-8");
  }

  console.log(`[facet] group 5 / code ${totalNodes} (mapped ${mappedCount}/${totalNodes}=${(mappedCount/totalNodes*100|0)}%) / shp ${SHP_NODES.length}`);
  console.log(`[done] facet 그래프 ${totalNodes + 5 + SHP_NODES.length}개 노드 추가`);
}

main().catch((e) => { console.error(e); process.exit(1); });
