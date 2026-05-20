#!/usr/bin/env tsx
/**
 * seed-hazards-controls.ts (P-G-1)
 *
 * Hazard·Control 도메인 분류 체계 ground truth 시드.
 *
 * 출처:
 *   - Hazard: KOSHA 사고 유형 분류 (산업재해 발생형태) + ILO/OSHA 표준
 *   - Control: ERIC-PP 4단계 위계 (Elimination → Substitution → Engineering → Administrative → PPE)
 *
 * 환각 위험 통제:
 *   - 분류 정의는 KOSHA·ILO·OSHA 표준 (LLM 분류 X)
 *   - 키워드 매칭은 Korean substring (substring 알고리즘 X 추론)
 *
 * 멱등 — 재실행 시 노드 재시드.
 */

import { writeFile, readdir, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const HAZARDS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "hazards");
const CONTROLS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "controls");

// ─── Hazard 분류 (KOSHA 산업재해 발생형태 표준 + 작업환경 위험) ───
interface HazardSeed {
  slug: string;
  label: string;
  koshaAccidentType?: string; // KOSHA 표준 사고 유형
  category: "physical" | "chemical" | "biological" | "ergonomic" | "psychosocial" | "environmental";
  description: string;
  matchKeywords: string[]; // KOSHA Guide title substring 매칭용 (positive)
  excludeKeywords?: string[]; // 동음이의어 차단용 (negative). v0.8 quality fix.
}

const HAZARDS: HazardSeed[] = [
  // ── 물리적 위험 (KOSHA 사고 유형) ──
  { slug: "fall_from_height", label: "추락 (떨어짐)", koshaAccidentType: "떨어짐", category: "physical",
    description: "고소·개구부에서 떨어져 발생하는 위험",
    matchKeywords: ["추락", "방호망", "안전대", "고소", "개구부", "사다리", "비계", "작업발판"] },
  { slug: "trip_slip", label: "넘어짐 (전도)", koshaAccidentType: "넘어짐", category: "physical",
    description: "동일 평면 미끄러짐·헛디딤",
    matchKeywords: ["넘어짐", "전도", "미끄러짐"] },
  { slug: "struck_by_overturn", label: "깔림·뒤집힘", koshaAccidentType: "깔림·뒤집힘", category: "physical",
    description: "장비·물체 전도로 깔림",
    matchKeywords: ["전도", "깔림", "뒤집힘", "전복"] },
  { slug: "struck_by", label: "부딪힘 (충돌)", koshaAccidentType: "부딪힘", category: "physical",
    description: "이동 중 물체 또는 장비와 충돌",
    matchKeywords: ["부딪힘", "충돌"] },
  { slug: "fall_object", label: "맞음 (낙하·비래)", koshaAccidentType: "맞음", category: "physical",
    description: "낙하물·비래물에 맞는 위험",
    matchKeywords: ["낙하", "비래", "맞음", "물체"] },
  { slug: "cave_in", label: "무너짐 (붕괴)", koshaAccidentType: "무너짐", category: "physical",
    description: "지반·구조물 붕괴 매몰",
    matchKeywords: ["붕괴", "흙막이", "지반", "사면", "옹벽", "터널"] },
  { slug: "buried_alive", label: "매몰", koshaAccidentType: "매몰", category: "physical",
    description: "땅·물·물질에 묻힘",
    matchKeywords: ["매몰", "굴착"] },
  { slug: "machine_entanglement", label: "끼임 (협착)", koshaAccidentType: "끼임", category: "physical",
    description: "기계·장비 협착",
    matchKeywords: ["끼임", "협착", "프레스", "롤러", "컨베이어"] },
  { slug: "crushing", label: "절단·베임·찔림", koshaAccidentType: "절단·베임·찔림", category: "physical",
    description: "예리한 물체에 의한 손상",
    matchKeywords: ["절단", "베임", "찔림", "톱"] },
  { slug: "electric_shock", label: "감전", koshaAccidentType: "감전", category: "physical",
    description: "전기에 의한 인체 손상",
    matchKeywords: ["감전", "활선", "충전전로", "누전", "정전 작업", "정전·잠금", "정전전로"],
    excludeKeywords: ["정전기", "정전도장"] },
  { slug: "fire_explosion", label: "폭발·파열", koshaAccidentType: "폭발·파열", category: "physical",
    description: "압력 용기·가스 폭발",
    matchKeywords: ["폭발", "파열", "압력용기"],
    excludeKeywords: ["폭발 방지", "폭발 예방"] },
  { slug: "fire", label: "화재", koshaAccidentType: "화재", category: "physical",
    description: "용접·화기·화학물질 화재",
    matchKeywords: ["화재", "화기", "용접", "용단", "불티"] },

  // ── 인간공학적 위험 ──
  { slug: "msd_repetitive", label: "근골격계 부담작업", category: "ergonomic",
    description: "반복·중량·자세 부담",
    matchKeywords: ["근골격", "VDT", "반복작업", "들기"] },
  { slug: "ergonomic_overload", label: "무리한 동작", koshaAccidentType: "무리한동작", category: "ergonomic",
    description: "들기·당기기·밀기 등 과부하",
    matchKeywords: ["무리한", "들기", "운반", "수공구"] },

  // ── 환경 위험 (이상온도) ──
  { slug: "heat_stress", label: "고온 노출 (온열질환)", category: "environmental",
    description: "폭염·고온환경 작업",
    matchKeywords: ["고열", "온열", "폭염", "열사"] },
  { slug: "cold_stress", label: "저온 노출 (한랭)", category: "environmental",
    description: "한랭환경 작업",
    matchKeywords: ["한랭", "저온"] },
  { slug: "thermal_burn", label: "이상온도 화상", koshaAccidentType: "이상온도", category: "physical",
    description: "고온·저온 물체 접촉 화상·동상",
    matchKeywords: ["화상", "동상"] },

  // ── 화학적 위험 ──
  { slug: "chemical_exposure", label: "화학물질 노출", koshaAccidentType: "화학물질", category: "chemical",
    description: "유해화학물질 흡입·접촉",
    matchKeywords: ["화학물질", "MSDS", "유기용제", "독성", "유해가스"] },
  { slug: "chemical_burn", label: "화학적 화상", category: "chemical",
    description: "산·알칼리·부식성 물질 접촉",
    matchKeywords: ["부식", "산", "알칼리", "약품"] },
  { slug: "asphyxiation", label: "산소결핍·질식", koshaAccidentType: "산소결핍", category: "chemical",
    description: "밀폐공간 산소부족·유해가스",
    matchKeywords: ["산소", "질식", "밀폐", "산소결핍"] },
  { slug: "dust_exposure", label: "분진 노출", category: "chemical",
    description: "분진 흡입·노출",
    matchKeywords: ["분진"] },
  { slug: "dust_explosion", label: "분진폭발", category: "chemical",
    description: "가연성 분진 폭발",
    matchKeywords: ["분진폭발"] },
  { slug: "gas_leak", label: "가스누출", category: "chemical",
    description: "가연성·독성 가스 누출",
    matchKeywords: ["가스누출", "가스"] },

  // ── 물리적 환경 ──
  { slug: "noise_exposure", label: "소음 노출", category: "physical",
    description: "소음성난청·청력손상",
    matchKeywords: ["소음", "청력", "난청"] },
  { slug: "vibration_exposure", label: "진동 노출", category: "physical",
    description: "전신·국소 진동",
    matchKeywords: ["진동"] },
  { slug: "radiation_exposure", label: "방사선 노출", category: "physical",
    description: "전리·비전리 방사선",
    matchKeywords: ["방사선", "X선"] },

  // ── 생물학적 위험 ──
  { slug: "biological_hazard", label: "생물학적 위험", category: "biological",
    description: "감염·혈액매개·곰팡이",
    matchKeywords: ["감염", "혈액", "곰팡이", "병원체"] },

  // ── 기타 ──
  { slug: "drowning", label: "빠짐·익사", koshaAccidentType: "빠짐", category: "physical",
    description: "물·구덩이·탱크 빠짐",
    matchKeywords: ["빠짐", "익사"] },
  { slug: "traffic_accident", label: "교통사고", koshaAccidentType: "교통사고", category: "physical",
    description: "차량 운행 중 사고",
    matchKeywords: ["교통사고", "도로주행", "운전자"],
    excludeKeywords: ["교통수단", "운수업"] },
  { slug: "manual_handling", label: "운반·하역 위험", category: "ergonomic",
    description: "수작업 운반·하역",
    matchKeywords: ["운반", "하역", "양중"] },
  { slug: "psychosocial_stress", label: "직무스트레스·정신건강", category: "psychosocial",
    description: "직무스트레스·과로·괴롭힘",
    matchKeywords: ["직무스트레스", "정신건강", "근로자 스트레스"],
    excludeKeywords: ["급성 스트레스", "조기대응", "PTSD 사후"] },
];

// ─── Control 분류 (ERIC-PP 위계) ───
interface ControlSeed {
  slug: string;
  label: string;
  ericLevel: 1 | 2 | 3 | 4 | 5; // 1=Eliminate 가장 효과
  category: "elimination" | "substitution" | "engineering" | "administrative" | "ppe";
  description: string;
  matchKeywords: string[];
  excludeKeywords?: string[]; // v0.8 quality fix
}

const CONTROLS: ControlSeed[] = [
  // ── 1. Elimination (제거) ──
  { slug: "elim_avoid_work", label: "위험작업 회피", ericLevel: 1, category: "elimination",
    description: "위험을 만드는 작업 자체를 제거",
    matchKeywords: [] },
  { slug: "elim_automation", label: "자동화·무인화", ericLevel: 1, category: "elimination",
    description: "사람 개입 제거",
    matchKeywords: ["자동화", "로봇"] },

  // ── 2. Substitution (대체) ──
  { slug: "sub_low_toxic", label: "저독성 물질 대체", ericLevel: 2, category: "substitution",
    description: "독성 화학물질을 저독성으로 교체",
    matchKeywords: ["대체"] },
  { slug: "sub_low_risk_method", label: "저위험 공법 대체", ericLevel: 2, category: "substitution",
    description: "고위험 공법을 저위험으로 변경",
    matchKeywords: [] },
  { slug: "sub_safer_equipment", label: "저위험 장비 대체", ericLevel: 2, category: "substitution",
    description: "고위험 장비를 안전 장비로 교체",
    matchKeywords: [] },

  // ── 3. Engineering (공학적 대책) ──
  { slug: "eng_shoring", label: "흙막이 지보공", ericLevel: 3, category: "engineering",
    description: "토사 붕괴 방지 공학 구조",
    matchKeywords: ["흙막이", "지보공", "토류판"] },
  { slug: "eng_fall_net", label: "추락방호망", ericLevel: 3, category: "engineering",
    description: "수평·수직 추락방지망",
    matchKeywords: ["추락방호망", "방망"] },
  { slug: "eng_guard_rail", label: "안전난간·안전대 부착설비", ericLevel: 3, category: "engineering",
    description: "개구부·고소 안전난간",
    matchKeywords: ["안전난간", "난간"] },
  { slug: "eng_scaffold", label: "비계·작업발판", ericLevel: 3, category: "engineering",
    description: "안전 작업발판 가시설",
    matchKeywords: ["비계", "작업발판"] },
  { slug: "eng_ventilation", label: "환기 설비", ericLevel: 3, category: "engineering",
    description: "분진·가스 환기",
    matchKeywords: ["환기", "송풍"] },
  { slug: "eng_noise_barrier", label: "방음·방진 설비", ericLevel: 3, category: "engineering",
    description: "소음·진동 차단",
    matchKeywords: ["방음", "방진"] },
  { slug: "eng_insulation", label: "절연·접지", ericLevel: 3, category: "engineering",
    description: "감전 방지 절연·접지",
    matchKeywords: ["절연", "접지", "누전차단"] },
  { slug: "eng_explosion_proof", label: "방폭 설비", ericLevel: 3, category: "engineering",
    description: "폭발 위험 장소 방폭 구조",
    matchKeywords: ["방폭"] },
  { slug: "eng_loto", label: "LOTO (정전·잠금·표찰)", ericLevel: 3, category: "engineering",
    description: "정전 작업 잠금·표찰 절차",
    matchKeywords: ["LOTO", "정전 작업", "정전·잠금", "정전전로", "에너지 차단", "잠금·표지"],
    excludeKeywords: ["정전기", "정전도장"] },
  { slug: "eng_interlock", label: "인터록·연동장치", ericLevel: 3, category: "engineering",
    description: "안전장치 연동",
    matchKeywords: ["인터록", "연동"] },
  { slug: "eng_alarm", label: "경보·검지 시스템", ericLevel: 3, category: "engineering",
    description: "가스·연기·산소 검지경보",
    matchKeywords: ["검지", "경보", "탐지"] },
  { slug: "eng_fire_suppression", label: "자동소화 설비", ericLevel: 3, category: "engineering",
    description: "스프링클러·자동소화기",
    matchKeywords: ["소화", "스프링클러"] },
  { slug: "eng_isolation_barrier", label: "격리·차폐", ericLevel: 3, category: "engineering",
    description: "위험원 물리적 격리",
    matchKeywords: ["격리", "차폐"] },
  { slug: "eng_machine_guard", label: "기계 방호장치", ericLevel: 3, category: "engineering",
    description: "프레스·회전체 방호",
    matchKeywords: ["방호장치", "방호덮개"] },
  { slug: "eng_monitoring", label: "계측 모니터링", ericLevel: 3, category: "engineering",
    description: "구조물·지반 계측",
    matchKeywords: ["계측", "모니터링"] },

  // ── 4. Administrative (관리적) ──
  { slug: "admin_work_plan", label: "작업계획서 작성", ericLevel: 4, category: "administrative",
    description: "작업 시작 전 계획서·통지",
    matchKeywords: ["작업계획"] },
  { slug: "admin_risk_assessment", label: "위험성평가", ericLevel: 4, category: "administrative",
    description: "정기·수시·최초 평가",
    matchKeywords: ["위험성평가", "위험성 평가"] },
  { slug: "admin_safety_education", label: "안전보건교육·TBM", ericLevel: 4, category: "administrative",
    description: "정기·신규·특별·관리감독자 교육",
    matchKeywords: ["안전교육", "TBM", "교육"] },
  { slug: "admin_work_permit", label: "작업허가제", ericLevel: 4, category: "administrative",
    description: "위험작업 허가 절차",
    matchKeywords: ["작업허가"] },
  { slug: "admin_inspection", label: "점검·기록", ericLevel: 4, category: "administrative",
    description: "정기·일상·합동점검",
    matchKeywords: ["점검"] },
  { slug: "admin_signal_person", label: "신호수 배치", ericLevel: 4, category: "administrative",
    description: "이동·양중 작업 신호수",
    matchKeywords: ["신호수", "신호"] },
  { slug: "admin_supervisor", label: "작업지휘자 배치", ericLevel: 4, category: "administrative",
    description: "위험 작업 지휘자 배치",
    matchKeywords: ["작업지휘자", "관리감독자"] },
  { slug: "admin_emergency_plan", label: "비상연락망·대응계획", ericLevel: 4, category: "administrative",
    description: "사고 시 비상연락·대피",
    matchKeywords: ["비상", "응급", "대피"] },
  { slug: "admin_qualification", label: "자격·면허 확인", ericLevel: 4, category: "administrative",
    description: "건설기계조종·전기·고소작업 자격",
    matchKeywords: ["면허", "자격", "조종"] },
  { slug: "admin_health_check", label: "건강진단", ericLevel: 4, category: "administrative",
    description: "일반·특수 건강진단",
    matchKeywords: ["건강진단", "건강검진"] },
  { slug: "admin_msds", label: "MSDS 게시·교육", ericLevel: 4, category: "administrative",
    description: "물질안전보건자료 작성·게시·교육",
    matchKeywords: ["MSDS", "물질안전보건자료", "경고표지"] },

  // ── 5. PPE (개인보호구) ──
  { slug: "ppe_helmet", label: "안전모", ericLevel: 5, category: "ppe",
    description: "낙하물·머리 보호",
    matchKeywords: ["안전모"] },
  { slug: "ppe_harness", label: "안전대", ericLevel: 5, category: "ppe",
    description: "추락방지 보호구",
    matchKeywords: ["안전대"] },
  { slug: "ppe_safety_shoes", label: "안전화", ericLevel: 5, category: "ppe",
    description: "발 보호",
    matchKeywords: ["안전화"] },
  { slug: "ppe_insulating_gloves", label: "절연장갑", ericLevel: 5, category: "ppe",
    description: "전기작업 보호",
    matchKeywords: ["절연장갑", "절연 보호구"] },
  { slug: "ppe_respirator", label: "호흡보호구", ericLevel: 5, category: "ppe",
    description: "분진·가스·에어로졸",
    matchKeywords: ["호흡보호", "방진마스크"] },
  { slug: "ppe_hearing_protection", label: "청력보호구", ericLevel: 5, category: "ppe",
    description: "귀마개·귀덮개",
    matchKeywords: ["청력보호", "귀마개"] },
  { slug: "ppe_eye_protection", label: "보안경·차광안경", ericLevel: 5, category: "ppe",
    description: "눈 보호",
    matchKeywords: ["보안경", "차광"] },
  { slug: "ppe_chemical_suit", label: "화학물질 방호복", ericLevel: 5, category: "ppe",
    description: "화학물질 차단",
    matchKeywords: ["방호복", "방독"] },
  { slug: "ppe_fall_arrester", label: "안전난간·죔줄", ericLevel: 5, category: "ppe",
    description: "추락방지 죔줄",
    matchKeywords: ["죔줄"] },
];

const VERIFIED_AT = new Date().toISOString().slice(0, 10);

async function clearDir(dir: string): Promise<number> {
  let deleted = 0;
  for (const f of await readdir(dir)) {
    if (f.endsWith(".jsonld")) {
      await unlink(resolve(dir, f));
      deleted += 1;
    }
  }
  return deleted;
}

(async () => {
  console.log(`# P-G-1 — Hazard·Control 도메인 분류 시드`);

  const hazardsPurged = await clearDir(HAZARDS_DIR);
  const controlsPurged = await clearDir(CONTROLS_DIR);
  console.log(`  purge — hazards ${hazardsPurged}, controls ${controlsPurged}`);

  // Hazard 시드
  for (const h of HAZARDS) {
    const node = {
      "@context": "../../context.jsonld",
      "@id": `hazard:${h.slug}`,
      "@type": "Hazard",
      slug: h.slug,
      label: h.label,
      category: h.category,
      koshaAccidentType: h.koshaAccidentType,
      _meta: {
        publishedBy: "황룡건설(주) + ㈜라텔웍스",
        sourceStandard: "KOSHA 산업재해 발생형태 분류 + ILO/OSHA 표준",
        verifiedAt: VERIFIED_AT,
        matchKeywords: h.matchKeywords, // KOSHA Guide 매핑용 (positive)
        excludeKeywords: h.excludeKeywords ?? [], // v0.8 동음이의어 차단
      },
    };
    await writeFile(resolve(HAZARDS_DIR, `${h.slug}.jsonld`),
      JSON.stringify(node, null, 2) + "\n", "utf8");
  }
  console.log(`  hazards seed: ${HAZARDS.length}`);

  // Control 시드
  for (const c of CONTROLS) {
    const node = {
      "@context": "../../context.jsonld",
      "@id": `control:${c.slug}`,
      "@type": "Control",
      slug: c.slug,
      label: c.label,
      ericLevel: c.ericLevel,
      category: c.category,
      _meta: {
        publishedBy: "황룡건설(주) + ㈜라텔웍스",
        sourceStandard: "ERIC-PP 위계 (Elimination → Substitution → Engineering → Administrative → PPE)",
        verifiedAt: VERIFIED_AT,
        matchKeywords: c.matchKeywords,
        excludeKeywords: c.excludeKeywords ?? [],
      },
    };
    await writeFile(resolve(CONTROLS_DIR, `${c.slug}.jsonld`),
      JSON.stringify(node, null, 2) + "\n", "utf8");
  }
  console.log(`  controls seed: ${CONTROLS.length}`);

  console.log(`\n✓ P-G-1 완료`);
})();
