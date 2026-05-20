#!/usr/bin/env tsx
/**
 * refine-kosha-mapping.ts
 *
 * 환각 정정 라운드:
 *  1. expand-kosha-guidedby + expand-kosha-guidedby-prefix 가 추가한 fallback edge 모두 제거
 *  2. KOSHA 분류체계(A/B/B-E/B-M/C/D/E/H/M/P/T/W/X) 기반 신규 도메인 활동 5개 추가
 *  3. 의미적 키워드 매칭 + 도메인 카테고리 fallback (정직 표기 _meta.matchType)
 *  4. over-link 분산: chemical_facility 279·risk_assessment 122 등 재분배
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ACTIVITIES = resolve(NODES, "activities");
const HAZARDS = resolve(NODES, "hazards");
const GUIDES = resolve(NODES, "documents", "guides");

const FETCHED = "2026-04-28";

// ─── 1. 신규 도메인 활동 (건설전용 OSS — 일반 사업장 안전만 유지) ───
// 비건설 도메인(industrial_machinery / electrical_facility / occupational_health / process_safety)은
// scope.json excludedActivities에 따라 별도 OSS 분리.
const NEW_DOMAIN_ACTIVITIES = [
  {
    id: "activity:general_workplace_safety",
    file: "general_workplace_safety.jsonld",
    title: "사업장 일반 안전관리",
    category: "general",
    description: "통로·계단·조명·표지·정리정돈·창고 등 사업장 공통 안전관리. 산안법 §37 안전보건표지 + §38 안전조치.",
    hasHazard: ["hazard:trip_slip","hazard:fall_object","hazard:struck_by"],
    regulatedBy: ["art:산안법:37","art:산안법:38"],
    appliesTo: ["applic:all_workplace"]
  }
];

// ─── 2. KOSHA 분류 prefix → 도메인 활동 + 위험 매핑 ───
// 의미적 매칭이 가능한 키워드는 우선 적용, 안 되면 prefix-기반 1개 활동에만 묶음 (over-link 방지)
const PRIMARY_KEYWORDS: Record<string, string[]> = {
  // 건설 도메인 (기존 활동 유지 — 변경 없음)
  "activity:scaffolding_assembly": ["비계","사다리","고소","발판","난간","계단","경사로","개구부"],
  "activity:formwork_shoring": ["거푸집","동바리","서포트"],
  "activity:rc_concrete": ["철근","콘크리트","타설","양생","배근","RC","레미콘"],
  "activity:steel_structure": ["철골","고력볼트","구조물 조립","H형강","강구조"],
  "activity:excavation_2m_plus": ["굴착","흙막이","토류","띠장","사면","터파기"],
  "activity:tunnel_excavation": ["터널","발파","숏크리트","록볼트"],
  "activity:demolition": ["해체","철거","폐기물"],
  "activity:waterproofing": ["방수","아스팔트 방수","우레탄 방수"],
  "activity:finishing_paint": ["도장","페인트","뿜칠","스프레이"],
  "activity:finishing_tile": ["미장","타일","석재 마감","바닥마감"],
  "activity:phc_pile_driving": ["항타","말뚝","PHC"],
  "activity:earthwork_landfill": ["성토","절토","정지","불도저","흙다짐"],
  "activity:road_pavement": ["포장","아스팔트 포장","롤러","도로공사"],
  "activity:underground_utility": ["맨홀","상수도","케이블 매설"],
  "activity:drainage_sewerage": ["하수","오수","우수","배수","관거"],
  "activity:bridge_5m_30m": ["교량","교각","상판","PC빔"],
  "activity:tower_assembly": ["송전탑","철탑"],
  "activity:tower_crane": ["타워크레인","러핑"],
  "activity:heavy_lifting": ["인양","중량물","호이스트","지브"],
  "activity:vehicle_cargo": ["화물","적재","하역","상하차","지게차","컨베이어"],
  "activity:vehicle_construction": ["굴삭기","건설기계","덤프트럭","로더"],
  "activity:safety_education": ["TBM","교육","훈련","안전보건교육","조회"],
  "activity:tbm_daily": ["TBM","일일점검"],
  "activity:risk_assessment_general": ["위험성평가","HAZOP","Bow-Tie"],
  "activity:electric_work_50v_plus": ["전기","활선","감전","수전","변전","피뢰","접지"],
  "activity:asbestos_removal": ["석면","발암"],
  // 일반 사업장 안전 (건설현장 공통 적용)
  "activity:general_workplace_safety": ["통로","조명","표지","급식실","창고","경비","창고 작업","조리","공동주택","오토바이"],
};

const HAZARD_KEYWORDS: Record<string, string[]> = {
  "hazard:fall_from_height": ["추락","고소","비계","사다리","개구부","난간"],
  "hazard:fall_object": ["낙하물","낙하","비래"],
  "hazard:struck_by": ["부딪힘","협착","충돌","지게차"],
  "hazard:struck_by_overturn": ["전도","전복"],
  "hazard:crushing": ["협착","압착","끼임","롤러","프레스","컨베이어"],
  "hazard:machine_entanglement": ["기계","말림","벨트","체인","회전체","연삭","톱","파쇄","혼합","드릴"],
  "hazard:electric_shock": ["감전","누전","활선","변전","수전","전선","피뢰","접지"],
  "hazard:fire_explosion": ["화재","폭발","화기","발화","가연","인화","점화"],
  "hazard:chemical_exposure": ["화학물질","MSDS","독성","발암","흡입","피부","유해가스"],
  "hazard:dust_exposure": ["분진","먼지","연삭","연마","실리카"],
  "hazard:noise_exposure": ["소음","청력"],
  "hazard:vibration_whole_body": ["진동","전신진동"],
  "hazard:heat_stress": ["고열","온열","폭염","열사병"],
  "hazard:cold_stress": ["한랭","저체온","동상"],
  "hazard:asphyxiation": ["산소","질식","밀폐","산소결핍"],
  "hazard:buried_alive": ["매몰","붕괴","흙막이","사면","토사"],
  "hazard:trip_slip": ["전도","미끄러짐","넘어짐","걸려"],
  "hazard:msd_repetitive": ["근골격","수공구","반복","들기","운반"],
  "hazard:radiation_uv": ["용접 광선","자외선","UV","아크 광선"],
  "hazard:ionizing_radiation": ["방사선","X선","감마","비파괴"],
  "hazard:biohazard": ["병원체","세균","바이러스","감염"],
  "hazard:acute_toxic_gas": ["가스","독성가스","아황산","암모니아","CO"],
  "hazard:cave_in": ["붕괴","흙막이","사면","토사"],
  "hazard:contact_high_temp": ["고온","화상","증기"],
};

// 의미 매칭 실패 시 prefix → 1개 활동만 (over-link 방지)
// 비건설 도메인 prefix(B-E/B-M/C-C/E-T/H/M/P/W 등)는 활동 매핑 없이 hazard 만 떨어진다 (out_of_domain).
const PREFIX_FALLBACK: Array<{ rx: RegExp; activity?: string; hazards: string[] }> = [
  { rx: /^A-G/,  activity: "activity:general_workplace_safety",      hazards: ["hazard:trip_slip"] },
  { rx: /^A-R/,  activity: "activity:risk_assessment_general",       hazards: [] },
  { rx: /^A/,    activity: "activity:risk_assessment_general",       hazards: [] },
  { rx: /^B-E/,                                                       hazards: ["hazard:electric_shock"] },
  { rx: /^B-M/,                                                       hazards: ["hazard:machine_entanglement"] },
  { rx: /^B/,                                                         hazards: ["hazard:machine_entanglement"] },
  { rx: /^C-C/,                                                       hazards: ["hazard:chemical_exposure"] },
  { rx: /^C/,    activity: "activity:rc_concrete",                   hazards: [] },
  { rx: /^D-C/,  activity: "activity:rc_concrete",                   hazards: [] },
  { rx: /^D/,    activity: "activity:steel_structure",               hazards: [] },
  { rx: /^E-G/,                                                       hazards: ["hazard:chemical_exposure"] },
  { rx: /^E-M/,  activity: "activity:vehicle_construction",          hazards: [] },
  { rx: /^E-T/,                                                       hazards: ["hazard:chemical_exposure"] },
  { rx: /^E/,                                                         hazards: ["hazard:chemical_exposure"] },
  { rx: /^G/,    activity: "activity:risk_assessment_general",       hazards: [] },
  { rx: /^H/,                                                         hazards: ["hazard:chemical_exposure"] },
  { rx: /^M/,                                                         hazards: ["hazard:machine_entanglement"] },
  { rx: /^O/,    activity: "activity:risk_assessment_general",       hazards: [] },
  { rx: /^P/,                                                         hazards: ["hazard:fire_explosion"] },
  { rx: /^T/,    activity: "activity:safety_education",              hazards: [] },
  { rx: /^W/,                                                         hazards: ["hazard:dust_exposure"] },
  { rx: /^X/,    activity: "activity:risk_assessment_general",       hazards: [] },
];

function matchByKeyword(title: string, dict: Record<string, string[]>): Array<{ id: string; score: number }> {
  const matched: Array<{ id: string; score: number }> = [];
  for (const [id, kws] of Object.entries(dict)) {
    let score = 0;
    for (const kw of kws) if (title.includes(kw)) score++;
    if (score > 0) matched.push({ id, score });
  }
  return matched.sort((a, b) => b.score - a.score);
}

(async () => {
  // 1. 신규 활동 노드 5개 생성
  for (const a of NEW_DOMAIN_ACTIVITIES) {
    const path = resolve(ACTIVITIES, a.file);
    const obj = {
      "@context": "../../context.jsonld",
      "@id": a.id,
      "@type": ["Activity", "Action"],
      title: a.title,
      category: a.category,
      verificationStatus: "verified",
      jurisdiction: "KR",
      _meta: {
        publishedBy: "라텔웍스 + 황룡건설(주)",
        fetchedAt: FETCHED,
        licenseHint: "저작권법 §7 비보호 (자유 인용)",
        graphEnrichmentNote: "KOSHA 분류체계(A/B/B-E/B-M/C/E/H/M/P) 비건설 도메인 활동 추가 — KOSHA 1039 의미적 분류용",
      },
      description: a.description,
      hasHazard: a.hasHazard,
      regulatedBy: a.regulatedBy,
      appliesTo: a.appliesTo,
      guidedBy: [] as string[]  // 아래에서 채움
    };
    await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
  }
  console.log(`[new] ${NEW_DOMAIN_ACTIVITIES.length} 도메인 활동 추가`);

  // 2. 모든 activity / hazard 의 guidedBy 초기화 (이전 fallback edge 모두 제거)
  // 단 verified KOSHA 30개와 기존 명시 매핑은 유지하기 어려우므로 — 정직성 위해 재구성.
  // 보존 대상: 기존 keyword-based 매칭 결과만. fallback-prefix 결과는 제거.
  const actIdx = new Map<string, { path: string; node: Record<string, unknown> }>();
  for (const f of await readdir(ACTIVITIES)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(ACTIVITIES, f);
    const node = JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
    actIdx.set(node["@id"] as string, { path: p, node });
  }
  const hazIdx = new Map<string, { path: string; node: Record<string, unknown> }>();
  for (const f of await readdir(HAZARDS)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(HAZARDS, f);
    const node = JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
    hazIdx.set(node["@id"] as string, { path: p, node });
  }
  for (const { node } of actIdx.values()) node.guidedBy = [];
  for (const { node } of hazIdx.values()) node.guidedBy = [];

  // 3. 가이드 전수 매칭 + 정직 표기
  const guideFiles = await readdir(GUIDES);
  let semanticMatched = 0;
  let fallbackMatched = 0;
  let unmatchedTotal = 0;
  const matchedAct = new Map<string, number>();
  const matchedHaz = new Map<string, number>();

  for (const f of guideFiles) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(GUIDES, f);
    const guide = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & { _meta?: { matchType?: string; guideNo?: string } };
    const title = String(guide.title ?? "");
    const guideNo = String(guide._meta?.guideNo ?? "");

    // (a) 의미적 키워드 매칭 (top-2)
    const actMatches = matchByKeyword(title, PRIMARY_KEYWORDS).slice(0, 2);
    const hazMatches = matchByKeyword(title, HAZARD_KEYWORDS).slice(0, 2);

    let matchType: "semantic" | "prefix-fallback" | "unmatched" = "unmatched";

    if (actMatches.length > 0 || hazMatches.length > 0) {
      matchType = "semantic";
      semanticMatched++;
      for (const m of actMatches) {
        const e = actIdx.get(m.id); if (!e) continue;
        const arr = e.node.guidedBy as string[];
        if (!arr.includes(guide["@id"] as string)) {
          arr.push(guide["@id"] as string);
          matchedAct.set(m.id, (matchedAct.get(m.id) ?? 0) + 1);
        }
      }
      for (const m of hazMatches) {
        const e = hazIdx.get(m.id); if (!e) continue;
        const arr = e.node.guidedBy as string[];
        if (!arr.includes(guide["@id"] as string)) {
          arr.push(guide["@id"] as string);
          matchedHaz.set(m.id, (matchedHaz.get(m.id) ?? 0) + 1);
        }
      }
    } else {
      // (b) prefix fallback — 1개 활동에만 + 정직 표기
      const fb = PREFIX_FALLBACK.find(p => p.rx.test(guideNo));
      if (fb) {
        matchType = "prefix-fallback";
        fallbackMatched++;
        if (fb.activity) {
          const e = actIdx.get(fb.activity);
          if (e) {
            const arr = e.node.guidedBy as string[];
            if (!arr.includes(guide["@id"] as string)) {
              arr.push(guide["@id"] as string);
              matchedAct.set(fb.activity, (matchedAct.get(fb.activity) ?? 0) + 1);
            }
          }
        }
        for (const hid of fb.hazards) {
          const eh = hazIdx.get(hid);
          if (eh) {
            const arr = eh.node.guidedBy as string[];
            if (!arr.includes(guide["@id"] as string)) {
              arr.push(guide["@id"] as string);
              matchedHaz.set(hid, (matchedHaz.get(hid) ?? 0) + 1);
            }
          }
        }
      } else {
        unmatchedTotal++;
      }
    }

    // 가이드 _meta.matchType 정직 표기
    // _meta 의 형 시그니처는 {matchType?, guideNo?} 로 좁혀져 있어 추가 필드는 인덱스 시그니처로 캐스팅.
    const meta = (guide._meta ?? {}) as Record<string, unknown>;
    meta.matchType = matchType;
    if (matchType === "prefix-fallback") {
      meta.matchTypeNote = "KOSHA 코드 prefix 기반 fallback. 의미적 키워드 매칭 실패. 도메인 카테고리 활동에만 약하게 연결.";
    }
    guide._meta = meta as typeof guide._meta;
    await writeFile(path, JSON.stringify(guide, null, 2) + "\n", "utf-8");
  }

  // 4. 디스크 기록
  for (const { path, node } of actIdx.values()) await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
  for (const { path, node } of hazIdx.values()) await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");

  console.log(`\n[refine] semantic 매칭:    ${semanticMatched}`);
  console.log(`[refine] prefix-fallback:  ${fallbackMatched}`);
  console.log(`[refine] 완전 미매칭:       ${unmatchedTotal}`);
  console.log(`\n활동별 새 부담 (top 10):`);
  for (const [n, c] of [...matchedAct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${n.padEnd(45)} ${c}`);
  }
  console.log(`\n위험별 새 부담 (top 10):`);
  for (const [n, c] of [...matchedHaz.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${n.padEnd(45)} ${c}`);
  }
})();
