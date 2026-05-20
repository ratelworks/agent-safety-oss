#!/usr/bin/env tsx
/**
 * Round 6: MSDS 27 fields 직접 큐레이션 (GHS 16개 항목 표준)
 *
 * 문제: admin default가 chemical fields에 잘못 적용 → 환각
 * 해결: 각 field에 GHS 표준 + 산안법 §110·§114 + KOSHA MSDS DB 기반 정확 가이드
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(__dirname, "..", "src/ontology/graph/nodes/documents/msds-register.jsonld");

const GUIDES: Record<string, any> = {
  // 5. 폭발·화재 시 대처방법
  extinguishingMedia: {
    inputGuide: "GHS 5.1. 적합한 소화제 + 금지된 소화제 명시. 화학물질별로 물·CO2·분말·폼 적합성 다름.",
    standardFormat: "적합: [소화제]. 금지: [금지 소화제 + 사유].",
    examples: [
      "적합: 분말·CO2·폼. 금지: 물 (인화성 액체 — 화재 확산 + 비등 위험).",
      "적합: 다량의 물·물안개. 금지: 없음.",
    ],
    checkPoints: ["GHS 5.1 표준", "화학별 적합 소화제 (KOSHA MSDS DB 확인)", "사업장 비치 소화기와 일치"],
  },
  fireHazards: {
    inputGuide: "GHS 5.2. 화재·폭발 시 특수 위험성. 분해 시 발생 유해가스·폭발 위험·반응성 명시.",
    standardFormat: "[위험] 발생 가능: [유해가스 종류]. [반응성·폭발 위험].",
    examples: [
      "분해 시 CO·CO2·NOx 발생. 가열 시 증기 폭발 위험. 열·점화원 접촉 회피.",
      "고온 시 자기반응 가능 (130°C 이상). 분해 가스 (할로겐화물 발생).",
    ],
    checkPoints: ["GHS 5.2 표준", "분해 산물 명시", "온도·압력 임계점"],
  },
  firefighterEquipment: {
    inputGuide: "GHS 5.3. 소방관용 보호장비. 자급식호흡기 (SCBA) + 화학방호복 필수.",
    standardFormat: "[호흡 보호] + [방호복] + [추가 장비]",
    examples: [
      "자급식 호흡기 (SCBA) + 화학방호복 (Type 3) + 내화 장갑·장화. 풍상에서 진화.",
      "방진·방독 마스크 (P3 + 정화통 OV) + 일반 방화복. 거리 50m 유지.",
    ],
    checkPoints: ["IDLH 농도 시 SCBA 의무", "방호복 등급 (Type 3·4·5·6)", "풍상 위치 진화"],
  },

  // 6. 누출 사고 시 대처방법
  personalPrecautions: {
    inputGuide: "GHS 6.1. 인체 보호조치 + 보호구 + 비상 절차. 누출 발견 즉시 대피·통제 + 119 신고.",
    standardFormat: "[보호구 착용] + [대피 거리] + [통제 조치] + [신고]",
    examples: [
      "방독·방진 마스크 + 내화학장갑·방호복 착용. 50m 반경 출입통제. 119·환경부 1577-3279 신고.",
      "송기마스크 (밀폐공간) + 화학방호복 + 안전대. 작업 중지·근로자 즉시 대피.",
    ],
    checkPoints: ["GHS 6.1", "비상 대피 경로 사전 표시", "한국독성정보센터 1899-9594 자문"],
  },
  environmentalPrecautions: {
    inputGuide: "GHS 6.2. 환경 보호조치. 배수로·하천·토양 차단 + 환경부 신고 (수질오염사고).",
    standardFormat: "[배수 차단] + [흡수·억제] + [신고]",
    examples: [
      "배수로 모래·흡수재로 차단. 하천 유입 시 환경부 1577-3279 즉시 신고. 흙 30cm 폐기.",
      "현장 격리 + 누출 방지턱 설치. 토양·지하수 오염 우려 시 환경부 신고.",
    ],
    checkPoints: ["배수로·하천 인접 시 즉시 차단", "환경부 신고 의무 (수질오염 100kg+)", "토양 오염 시 환경부 토양환경부서"],
  },
  containment: {
    inputGuide: "GHS 6.3. 정화·중화·수거 방법. 흡수재·중화제·진공 흡수 등.",
    standardFormat: "[수거 방법] + [중화·정화] + [폐기]",
    examples: [
      "분말 흡수재(질석·모래) 살포 → 비에어 진공 흡수 → 지정폐기물로 처리. 잔여 산성 물질 중화 (석회·소다).",
      "흡유포로 흡수 → 밀폐 용기 보관 → 지정폐기물 위탁업체 처리.",
    ],
    checkPoints: ["GHS 6.3", "지정폐기물관리법 준수", "용기는 동일 화학물질용 사용"],
  },

  // 9. 물리화학적 특성
  appearance: {
    inputGuide: "GHS 9.1. 외관 (상태·색·점성). 사용자 식별·이상 발견용.",
    standardFormat: "[상태] [색] [점성/투명도]",
    examples: [
      "투명한 무색 액체. 점성 낮음 (물 유사).",
      "황색 분말. 흡습성 있음 (밀폐 보관 필수).",
    ],
    checkPoints: ["GHS 9.1", "변색 시 변질 의심", "원본 카탈로그와 비교"],
  },
  odor: {
    inputGuide: "GHS 9.2. 냄새·냄새 역치. 누출 조기 감지용.",
    standardFormat: "[냄새 특성] / 역치 [N] ppm",
    examples: [
      "방향족 냄새 (벤젠 유사). 역치 0.5 ppm.",
      "무취 (조기 감지 어려움 — 가스 검지기 필수).",
    ],
    checkPoints: ["GHS 9.2", "무취 화학물질은 가스 검지기 의무", "역치는 KOSHA MSDS DB 참조"],
  },
  physicalProps: {
    inputGuide: "GHS 9.3~9.10. pH·녹는점·끓는점·인화점·증기압·밀도. 화재·저장·취급 안전 기준.",
    standardFormat: "pH [N] / 녹는점 [°C] / 끓는점 [°C] / 인화점 [°C] / 증기압 [kPa] / 밀도 [g/cm³]",
    examples: [
      "pH 6.5~7.5 / 녹는점 -23°C / 끓는점 110°C / 인화점 4°C (강인화성) / 증기압 5.3 kPa (20°C) / 밀도 0.87.",
      "pH N/A (분말) / 녹는점 195°C / 끓는점 N/A / 인화점 N/A / 밀도 1.2.",
    ],
    checkPoints: ["인화점 23°C 이하 = GHS 인화성 카테고리 1·2", "끓는점·증기압으로 노출 위험 판단"],
  },
  solubility: {
    inputGuide: "GHS 9.11. 용해도 (물·기타 용매). 누출·화재 대응에 영향.",
    standardFormat: "물 [용해도]·[용매] [용해도]",
    examples: [
      "물 < 0.05 g/L (불용). 알코올·에테르 가용.",
      "물 가용 (혼합). 모든 비율 혼합.",
    ],
    checkPoints: ["불용성 + 인화성 = 물 소화 부적합", "수용성 = 환경 오염 확산 빠름"],
  },

  // 10. 안정성 및 반응성
  chemicalStability: {
    inputGuide: "GHS 10.1. 화학적 안정성. 통상 조건 vs 비통상 (열·빛·습기).",
    standardFormat: "통상 조건: [안정/불안정] / 비통상 [조건]: [반응]",
    examples: [
      "통상 안정. 가열 130°C 이상 자기반응 가능. 직사광선·습기 회피.",
      "안정. 모든 통상 조건에서 변화 없음.",
    ],
    checkPoints: ["GHS 10.1", "저장 온도·환경 명시", "유효기간 추적"],
  },
  reactivityHazards: {
    inputGuide: "GHS 10.2. 위험 반응 가능성. 열·충격·습기·정전기 트리거.",
    standardFormat: "[트리거 조건]: [반응 결과]",
    examples: [
      "강산화제 접촉 시 격렬 반응 (발화·폭발). 충격·정전기 회피. 알칼리 접촉 시 발열.",
      "위험 반응 없음 (안정).",
    ],
    checkPoints: ["GHS 10.2", "양립금지 물질 §10.4와 일관", "트리거 조건 정전기·충격·고온"],
  },
  incompatibleMaterials: {
    inputGuide: "GHS 10.3. 피해야 할 물질·조건. 양립금지 화학물 격리 저장 의무.",
    standardFormat: "[금지 물질·조건] / [반응 위험]",
    examples: [
      "강산·강알칼리·산화제 (발열·폭발). 알루미늄·아연 (가스 발생). 직사광선 (분해).",
      "산화제·환원제 격리. 금속 분말 회피.",
    ],
    checkPoints: ["저장 격리 (위험물안전관리법 별표6)", "라벨에 양립금지 표시"],
  },
  decompositionProducts: {
    inputGuide: "GHS 10.4. 분해 시 발생 유해물질. 화재·고온 시 발생 가스 명시.",
    standardFormat: "분해 조건: [온도/조건] / 발생 [유해물질]",
    examples: [
      "분해 200°C 이상. 발생: CO·CO2·NOx·HCl. 화재 시 자급식 호흡기 의무.",
      "분해 280°C. 발생: 자극성 산성 가스 (HCl·HF). 환기·SCBA 필수.",
    ],
    checkPoints: ["GHS 10.4", "응급조치 §4와 일관", "소방관용 보호장비 §5.3 일관"],
  },

  // 11. 독성 정보
  acuteToxicity: {
    inputGuide: "GHS 11.1. 급성 독성 (LD50·LC50). 동물실험 또는 GHS 분류 기준값.",
    standardFormat: "LD50 [경로] [N] mg/kg / LC50 흡입 [N] ppm·[N]시간",
    examples: [
      "LD50 (랫, 경구) 5,800 mg/kg (저독성). LC50 (랫, 흡입) 26,700 mg/m³·4h.",
      "LD50 경구 50 mg/kg (고독성 — GHS 카테고리 2). LD50 피부 200 mg/kg.",
    ],
    checkPoints: ["GHS 11.1", "LD50 < 50 mg/kg = 카테고리 1·2 (위험)", "KOSHA MSDS DB 데이터 일치"],
  },
  chronicToxicity: {
    inputGuide: "GHS 11.2. 만성 독성 (발암성·생식독성·표적장기). IARC·EPA 분류 활용.",
    standardFormat: "발암성 [GHS 카테고리] / 생식독성 [카테고리] / 표적장기 [기관]",
    examples: [
      "발암성 카테고리 1A (IARC Group 1). 생식독성 카테고리 1B. 표적장기: 간·신장.",
      "발암성 미분류. 생식독성 카테고리 2. 표적장기: 중추신경계.",
    ],
    checkPoints: ["GHS 11.2", "IARC·EPA 분류와 일치", "특수건강진단 대상 여부"],
  },
  exposureRoute: {
    inputGuide: "GHS 11.3. 노출 경로별 영향 (흡입·피부·경구·눈). 표적장기·증상·잠복기.",
    standardFormat: "[경로]: [증상·표적장기·잠복기]",
    examples: [
      "흡입: 두통·현기증·구역. 표적: 중추신경. 잠복 즉시. 피부: 자극·건조. 경구: 구토·복통.",
      "흡입: 호흡기 자극·기관지염 (만성). 피부: 알레르기성 피부염.",
    ],
    checkPoints: ["GHS 11.3", "경로별 응급조치 §4와 일관", "특수건강진단 항목"],
  },

  // 12. 환경 영향
  ecotoxicity: {
    inputGuide: "GHS 12.1. 수생/육상 생태독성. EC50·LC50 (어류·물벼룩·조류).",
    standardFormat: "어류 LC50 [N] mg/L·96h / 물벼룩 EC50 [N] mg/L·48h / 조류 [N] mg/L·72h",
    examples: [
      "어류 LC50 12 mg/L (96h, GHS 수생 카테고리 만성 2). 물벼룩 EC50 8 mg/L. 조류 6 mg/L.",
      "어류 LC50 > 1,000 mg/L (저독성). 환경부 수질오염사고 신고 면제.",
    ],
    checkPoints: ["GHS 12.1", "수질환경 보전법 적용 여부", "환경부 신고 기준 100kg+"],
  },
  persistence: {
    inputGuide: "GHS 12.2. 잔류성·분해성. 생분해 속도 (BOD/COD).",
    standardFormat: "생분해성 [%] [N]일 / 비생분해성 [잔류기간]",
    examples: [
      "생분해성 65% (28일, OECD 301B). 분해 가능.",
      "비생분해 (안정·잔류). 토양·수계 장기 잔류.",
    ],
    checkPoints: ["GHS 12.2", "OECD 301 시험 기준", "잔류성 유기오염물질 (POPs)"],
  },
  bioaccumulation: {
    inputGuide: "GHS 12.3. 생물농축성. log Kow·BCF 값.",
    standardFormat: "log Kow [N] / BCF [N]",
    examples: [
      "log Kow 4.8 (높음 — 생물농축 우려). BCF 1,200 (PNEC 0.05 mg/L).",
      "log Kow 0.5 (낮음). BCF < 100. 생물농축 위험 낮음.",
    ],
    checkPoints: ["GHS 12.3", "log Kow > 4.5 = 생물농축 우려", "수질환경기준 비교"],
  },
  soilMobility: {
    inputGuide: "GHS 12.4. 토양 이동성. Koc·Henry 상수.",
    standardFormat: "Koc [N] / Henry [Pa·m³/mol]",
    examples: [
      "Koc 200 (이동성 보통). Henry 8.5 (휘발성 보통).",
      "Koc 5,000 (토양 강하게 흡착). 지하수 이동 낮음.",
    ],
    checkPoints: ["토양환경보전법 적용 여부"],
  },

  // 13. 폐기
  wasteDisposal: {
    inputGuide: "GHS 13.1. 폐기 방법 + 폐기물관리법 분류 (지정폐기물 여부).",
    standardFormat: "[지정/일반] 폐기물 / 처리 방법 [소각·매립·재활용]",
    examples: [
      "지정폐기물 (인화성 폐액). 폐기물관리법 §2 + 별표 1. 위탁업체 (소각). 폐기물 인계서 발행.",
      "일반폐기물. 분리 배출. 재활용 가능.",
    ],
    checkPoints: ["폐기물관리법 §2 별표 1 (지정폐기물 27종)", "위탁업체 등록 확인", "폐기물 인계서 5년 보존"],
  },
  containerDisposal: {
    inputGuide: "GHS 13.2. 오염된 용기·포장 처리. 잔존 화학물질 제거 + 재사용 금지.",
    standardFormat: "[잔존 처리] + [폐기 분류] + [재사용 여부]",
    examples: [
      "용기 잔존 물질 제거 후 3회 세척 → 지정폐기물 위탁. 재사용 금지.",
      "빈 용기 부피·표지 손상 — 일반폐기물. 동일 화학물질 외 재사용 금지.",
    ],
    checkPoints: ["GHS 13.2", "재사용 금지 (오염 위험)", "라벨 제거"],
  },

  // 14. 운송
  unNumber: {
    inputGuide: "GHS 14.1. UN 번호·UN 운송명. 국제 위험물 운송 표준 (ADR·IMDG·IATA).",
    standardFormat: "UN [NNNN] / [UN Proper Shipping Name]",
    examples: [
      "UN 1294 / TOLUENE",
      "UN 3082 / ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S.",
    ],
    checkPoints: ["GHS 14.1", "UN Recommendations on Transport 일치", "운송 라벨 부착"],
  },
  transportClass: {
    inputGuide: "GHS 14.2. 운송 위험 등급 (UN Class 1~9) + 포장 등급 (Packing Group I·II·III).",
    standardFormat: "Class [N] / PG [I/II/III] / 라벨 [그림문자]",
    examples: [
      "Class 3 (인화성 액체) / PG II (중간 위험) / 라벨: 불꽃.",
      "Class 8 (부식성) / PG I (높은 위험) / 라벨: 부식.",
    ],
    checkPoints: ["GHS 14.2", "ADR/IMDG/IATA 호환", "PG가 GHS 분류와 일관"],
  },
  transportPrecautions: {
    inputGuide: "GHS 14.3. 운송 시 특별 주의사항. 양립금지·온도·습도·진동.",
    standardFormat: "[제한 조건] + [양립금지] + [긴급 절차]",
    examples: [
      "양립금지: Class 5 (산화제). 직사광선·고온 회피 (50°C 이하). 누출 시 운송중지·119 신고.",
      "건조 운송. 진동 최소화. 산성 양립금지.",
    ],
    checkPoints: ["GHS 14.3", "양립금지는 §10.3과 일관", "운송 중 누출 비상절차"],
  },

  // 15. 법적 규제
  domesticLaws: {
    inputGuide: "GHS 15.1. 국내 적용 법령. 산안법 + 화학물질관리법 + 위험물안전관리법 + 폐기물관리법 등.",
    standardFormat: "[법령]: [분류·기준]",
    examples: [
      "산안법 §110~§115 (MSDS·게시·교육). 화학물질관리법 (유독물 No.X). 위험물안전관리법 §3 (제4류 인화성 액체).",
      "산안법 §38 (작업계획서). 화학물질관리법 (유독물). 폐기물관리법 (지정폐기물).",
    ],
    checkPoints: ["GHS 15.1", "법령별 신고 의무 확인", "산안법 §110 ① + 시행규칙 §159 의무"],
  },
  internationalLaws: {
    inputGuide: "GHS 15.2. 국제 협약. 스톡홀름·로테르담·바젤 협약 + REACH (EU).",
    standardFormat: "[협약]: [등록·신고 여부]",
    examples: [
      "스톡홀름 협약 (POPs): 미해당. 로테르담 (PIC): 미해당. REACH (EU): 등록 완료.",
      "POPs 해당 (DDT 유사 — 사용 금지). 바젤: 폐기물 국제 이동 신고.",
    ],
    checkPoints: ["국제 협약 의무 확인", "수출입 신고"],
  },
  regulatedAs: {
    inputGuide: "GHS 15.3. 유독물·금지물질·허가물질·관찰물질 분류. 화학물질관리법 + 산안법.",
    standardFormat: "[분류명]: [등록번호] / [규제 내용]",
    examples: [
      "유독물 No. 12345. 화학물질관리법 §13 (취급 시 안전관리계획). 산안법 별표12 (특별관리물질).",
      "관찰물질 No.X. CMR (발암·돌연변이·생식독성) 등록.",
    ],
    checkPoints: ["GHS 15.3", "화학물질관리법 분류 정확", "산안법 §39 + 별표12 특별관리물질"],
  },

  // 16. 그 밖의 참고사항
  preparedBy: {
    inputGuide: "GHS 16.1. 작성자·소속·연락처. MSDS 책임자 + KOSHA MSDS DB 등록자.",
    standardFormat: "[성명] / [소속·직위] / [연락처]",
    examples: [
      "김안전 / ㈜한국케미칼 안전관리팀 매니저 / 031-XXX-XXXX",
      "박MSDS / KOSHA 등록 작성자 / 02-XXX-XXXX",
    ],
    checkPoints: ["GHS 16.1", "작성자 자격 (산업안전·보건 자격)", "KOSHA MSDS DB 등록"],
  },
  preparedDate: {
    inputGuide: "GHS 16.2. 최초 작성일. KOSHA MSDS DB 등록일과 일치.",
    standardFormat: "YYYY-MM-DD",
    examples: ["2026-04-28 (최초 작성)", "2020-03-15 (최초) — 5번째 개정"],
    checkPoints: ["GHS 16.2", "신규 화학물질 도입 즉시 작성", "KOSHA DB 등록"],
  },
  revisedDate: {
    inputGuide: "GHS 16.3. 최근 개정일·개정 내용. 산안법 §110 ② 정보 변경 시 갱신 의무.",
    standardFormat: "[일자] / 개정 [N]차 / 변경 [내용]",
    examples: [
      "2026-04-28 / 5차 개정 / GHS 9차 개정 반영 + 노출기준 변경",
      "2024-01-15 / 3차 / 신규 분해산물 추가",
    ],
    checkPoints: ["GHS 16.3", "산안법 §110 ② 변경 시 즉시 갱신", "근로자 재교육 의무"],
  },
  references: {
    inputGuide: "GHS 16.4. 참고문헌·인용 자료. KOSHA MSDS DB·미국 NIOSH·일본 GHS 등.",
    standardFormat: "[자료명] / [발행기관] / [발행연도]",
    examples: [
      "KOSHA MSDS DB (msds.kosha.or.kr). NIOSH Pocket Guide 2020. UN GHS Rev.9 (2021).",
      "환경부 화학물질정보시스템. EPA Chemical Risk Database.",
    ],
    checkPoints: ["출처 검증 가능", "최신 자료 인용"],
  },
};

async function main() {
  const node = JSON.parse(await readFile(PATH, "utf-8"));
  let updated = 0;
  for (const sec of node.sections ?? []) {
    for (const f of sec.fields ?? []) {
      const guide = GUIDES[f.key];
      if (!guide) continue;
      Object.assign(f, guide);
      updated += 1;
    }
  }
  await writeFile(PATH, JSON.stringify(node, null, 2) + "\n", "utf-8");
  console.log(`✓ msds_register: ${updated}개 field 직접 큐레이션 (GHS 16개 항목 표준)`);
}

main().catch(console.error);
