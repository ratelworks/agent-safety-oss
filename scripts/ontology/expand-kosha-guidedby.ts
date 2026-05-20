#!/usr/bin/env tsx
/**
 * expand-kosha-guidedby.ts
 *
 * 미사용 KOSHA Guide 443개를 활용률 향상을 위해 기존 활동/위험에 reverse guidedBy 로 연결.
 * 도메인 키워드 사전을 확장 — 일반 산업안전(전기설비/기계/조명/사다리/창고 등)도 포함.
 *
 * 매칭은 title substring (LLM X). 각 guide 는 best-1 활동 + best-1 위험에 동시 연결되어
 * 위험·활동 쌍방향 활용도 보강.
 */
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const GUIDES_DIR = resolve(NODES, "documents", "guides");
const ACTIVITIES_DIR = resolve(NODES, "activities");
const HAZARDS_DIR = resolve(NODES, "hazards");
const CONTROLS_DIR = resolve(NODES, "controls");
const ARTICLES_DIR = resolve(NODES, "articles");

// 도메인 확장 키워드 — 기존 matchKeywords 보다 넓음
// (기존 _meta.matchKeywords 외에 일반 산업안전 시나리오까지 cover)
const ACTIVITY_KEYWORDS: Record<string, string[]> = {
  "activity:scaffolding_assembly": ["비계","사다리","고소","발판","난간","계단","경사로","낙하"],
  "activity:formwork_shoring": ["거푸집","동바리","콘크리트 타설","슬래브","서포트"],
  "activity:rc_concrete": ["철근","콘크리트","타설","양생","배근","RC","레미콘"],
  "activity:steel_structure": ["철골","용접","cutting","고력볼트","구조물 조립","해체"],
  "activity:excavation_2m_plus": ["굴착","흙막이","파일","토류","띠장","사면","흙","터파기"],
  "activity:tunnel_excavation": ["터널","발파","숏크리트","록볼트"],
  "activity:demolition": ["해체","철거","폐기물","산업시설 해체"],
  "activity:waterproofing": ["방수","아스팔트","우레탄","코팅"],
  "activity:finishing_paint": ["도장","페인트","뿜칠","스프레이"],
  "activity:finishing_tile": ["미장","타일","석재","대리석","바닥마감"],
  "activity:phc_pile_driving": ["파일","항타","말뚝","PHC"],
  "activity:earthwork_landfill": ["성토","절토","정지","불도저","로더","흙다짐"],
  "activity:road_pavement": ["포장","아스팔트 포장","롤러","도로공사"],
  "activity:underground_utility": ["맨홀","지하","상수도","하수도","케이블 매설","밀폐공간"],
  "activity:drainage_sewerage": ["하수","오수","우수","배수","관거"],
  "activity:bridge_5m_30m": ["교량","교각","상판","PC빔"],
  "activity:tower_assembly": ["송전탑","철탑","피뢰","변전"],
  "activity:tower_crane": ["타워크레인","크레인 인양","러핑"],
  "activity:heavy_lifting": ["인양","중량물","호이스트","지브 크레인"],
  "activity:vehicle_cargo": ["화물","적재","하역","상하차","지게차","컨베이어"],
  "activity:vehicle_construction": ["건설기계","굴삭기","로더","불도저","덤프트럭","롤러","장비 조작"],
  "activity:safety_education": ["교육","훈련","TBM","안전보건교육","조회"],
  "activity:tbm_daily": ["TBM","일일","조회","아침","점검회의"],
  "activity:risk_assessment_general": ["위험성평가","유해","평가","Risk Assessment","HAZOP","Bow-Tie"],
  "activity:electric_work_50v_plus": ["전기","전선","접지","변전","수변전","피뢰","감전","수전","접속","계측"],
  "activity:asbestos_removal": ["석면","해체","제거","발암"],
};

const HAZARD_KEYWORDS: Record<string, string[]> = {
  "hazard:fall_from_height": ["추락","고소","비계","사다리","낙하","개구부","난간"],
  "hazard:fall_object": ["낙하물","낙하","비래"],
  "hazard:struck_by": ["부딪힘","충돌","협착","지게차","장비"],
  "hazard:struck_by_overturn": ["전도","전복","넘어짐"],
  "hazard:crushing": ["협착","압착","끼임","롤러","프레스","컨베이어"],
  "hazard:machine_entanglement": ["기계","말림","벨트","체인","회전체","연삭","톱"],
  "hazard:electric_shock": ["감전","누전","전기","활선","정전","접지","전선","변전","수전","피뢰"],
  "hazard:fire_explosion": ["화재","폭발","화기","용접","점화","발화","가연","인화","산소결핍"],
  "hazard:chemical_exposure": ["화학","유해물질","MSDS","독성","발암","발진","흡입","피부","눈"],
  "hazard:dust_exposure": ["분진","먼지","연삭","연마","석재","목재","실리카"],
  "hazard:noise_exposure": ["소음","청력","진동"],
  "hazard:vibration_whole_body": ["진동","전신진동","로컬진동"],
  "hazard:heat_stress": ["고열","온열","폭염","열사병","열중증"],
  "hazard:cold_stress": ["한랭","저체온","동상","한파"],
  "hazard:asphyxiation": ["산소","질식","밀폐","산소결핍"],
  "hazard:buried_alive": ["매몰","붕괴","흙막이","사면","토사"],
  "hazard:trip_slip": ["전도","미끄러짐","걸려","넘어짐","계단"],
  "hazard:msd_repetitive": ["근골격","수공구","반복","들기","운반","무거운"],
  "hazard:manual_handling": ["수공구","들기","운반","인력운반","중량물"],
  "hazard:ergonomic_overload": ["근골격","수공구","반복","무거운","들기","운반"],
  "hazard:radiation_uv": ["용접 광선","자외선","UV","아크 광선"],
  "hazard:ionizing_radiation": ["방사선","X선","감마","비파괴"],
  "hazard:biohazard": ["병원체","세균","바이러스","감염"],
  "hazard:acute_toxic_gas": ["가스","유해가스","독성가스","아황산","암모니아","CO"],
  "hazard:cave_in": ["붕괴","흙막이","사면","토사","함몰"],
  "hazard:contact_high_temp": ["고온","화상","증기"],
};

interface Guide {
  filePath: string;
  iri: string;
  title: string;
  raw: Record<string, unknown> & { _meta?: { guideCategory?: string } };
}

async function loadGuides(): Promise<Guide[]> {
  const out: Guide[] = [];
  for (const f of await readdir(GUIDES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const filePath = resolve(GUIDES_DIR, f);
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown> & {
      "@id"?: string; title?: string; _meta?: { guideCategory?: string };
    };
    out.push({ filePath, iri: String(raw["@id"]), title: String(raw.title ?? ""), raw });
  }
  return out;
}

function matchAll(title: string, dict: Record<string, string[]>): string[] {
  const matched: Array<{ id: string; score: number }> = [];
  for (const [id, kws] of Object.entries(dict)) {
    let score = 0;
    for (const kw of kws) if (title.includes(kw)) score++;
    if (score > 0) matched.push({ id, score });
  }
  // 상위 3개만 선택 (over-link 방지)
  return matched.sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.id);
}

async function patchNode(dir: string, idMatch: string, mutate: (n: Record<string, unknown>) => void): Promise<boolean> {
  const fname = idMatch.split(":").pop()!;
  // 직접 매칭
  let path = resolve(dir, fname + ".jsonld");
  try { await stat(path); } catch {
    // 파일명이 slug가 다를 수 있으므로 모두 스캔
    for (const f of await readdir(dir)) {
      if (!f.endsWith(".jsonld")) continue;
      const p = resolve(dir, f);
      const node = JSON.parse(await readFile(p, "utf8"));
      if (node["@id"] === idMatch) { path = p; break; }
    }
  }
  try {
    const node = JSON.parse(await readFile(path, "utf8"));
    if (node["@id"] !== idMatch) return false;
    mutate(node);
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function addGuideTo(node: Record<string, unknown>, guideIri: string) {
  const cur = (node.guidedBy as string[] | undefined) ?? [];
  if (!cur.includes(guideIri)) cur.push(guideIri);
  node.guidedBy = cur;
}

(async () => {
  const guides = await loadGuides();
  console.log(`[load] ${guides.length} guides`);

  // 활동/위험 노드를 미리 인덱싱 (전체 read once)
  const activityIndex = new Map<string, { path: string; node: Record<string, unknown> }>();
  for (const f of await readdir(ACTIVITIES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(ACTIVITIES_DIR, f);
    const node = JSON.parse(await readFile(p, "utf8"));
    if (node["@id"]) activityIndex.set(node["@id"], { path: p, node });
  }
  const hazardIndex = new Map<string, { path: string; node: Record<string, unknown> }>();
  for (const f of await readdir(HAZARDS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(HAZARDS_DIR, f);
    const node = JSON.parse(await readFile(p, "utf8"));
    if (node["@id"]) hazardIndex.set(node["@id"], { path: p, node });
  }

  let activityLinks = 0;
  let hazardLinks = 0;
  let unmatched = 0;

  for (const g of guides) {
    const acts = matchAll(g.title, ACTIVITY_KEYWORDS);
    const haz = matchAll(g.title, HAZARD_KEYWORDS);

    if (acts.length === 0 && haz.length === 0) { unmatched++; continue; }

    for (const aid of acts) {
      const entry = activityIndex.get(aid);
      if (!entry) continue;
      const before = (entry.node.guidedBy as string[] | undefined)?.length ?? 0;
      addGuideTo(entry.node, g.iri);
      const after = (entry.node.guidedBy as string[]).length;
      if (after > before) activityLinks++;
    }
    for (const hid of haz) {
      const entry = hazardIndex.get(hid);
      if (!entry) continue;
      const before = (entry.node.guidedBy as string[] | undefined)?.length ?? 0;
      addGuideTo(entry.node, g.iri);
      const after = (entry.node.guidedBy as string[]).length;
      if (after > before) hazardLinks++;
    }
  }

  // 디스크에 일괄 기록
  for (const { path, node } of activityIndex.values()) {
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
  }
  for (const { path, node } of hazardIndex.values()) {
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
  }

  console.log(`[link] activity guidedBy 신규: ${activityLinks}`);
  console.log(`[link] hazard   guidedBy 신규: ${hazardLinks}`);
  console.log(`[skip] 키워드 미매칭 guide: ${unmatched}`);
})();
