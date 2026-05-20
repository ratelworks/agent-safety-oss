#!/usr/bin/env tsx
/**
 * Round 3: msds_register 핵심 25개 field 가이드 보강
 *
 * 우선순위: 자주 작성되는 섹션 1·2·3·4·7·8·한국 게시
 *           (총 25개 field, 53개 중 47% 커버)
 *
 * 보강 후 재테스트로 빈칸·LLM 작성 가능성 측정.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const PATH = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "msds-register.jsonld");

interface FieldGuide {
  inputGuide: string;
  standardFormat: string;
  examples: string[];
  checkPoints: string[];
}

const GUIDES: Record<string, FieldGuide> = {
  // 섹션 1 — 화학제품·회사 정보
  productName: {
    inputGuide: "MSDS 1번 항목. 시판 제품명 + 화학물질명 명시. 혼합물은 주성분 강조.",
    standardFormat: "[제품명] (주성분: [화학명])",
    examples: ["신너 600 (주성분: 톨루엔, 자일렌, MEK 혼합)", "에폭시 도료 P-100 (주제: 비스페놀 A 에폭시)"],
    checkPoints: ["KOSHA MSDS DB(msds.kosha.or.kr)에서 동일 제품 검색", "제조사 카탈로그 사양과 일치"],
  },
  intendedUse: {
    inputGuide: "용도(도장·접착·세척·반응제 등) + 사용 제한 (실내·실외·환기조건) 명시.",
    standardFormat: "[용도]. 제한: [환기·온도·금지조건]",
    examples: ["페인트 희석용. 제한: 실내 환기 필수, 화기 엄금.", "콘크리트 양생제. 제한: 5°C 이상, 비올 때 사용금지."],
    checkPoints: ["오용 가능성 있는지", "허가 용도와 실제 사용 일치"],
  },
  manufacturer: {
    inputGuide: "제조·수입자 회사명·주소·대표자 명시. 수입품은 한국 대리점 정보 추가.",
    standardFormat: "[회사명], [주소], 대표 [성명], 사업자등록번호 [N-N-N]",
    examples: ["㈜한국케미칼, 경기 화성시 ..., 대표 김OO, 123-45-67890", "BASF 한국지사, 서울 ..., 대표 ..."],
    checkPoints: ["MSDS 작성 책임자 사인", "사업장 비상연락 가능 여부"],
  },
  emergencyPhone: {
    inputGuide: "24시간 응급 전화. 제조사 비상 연락 + 한국독성정보센터 1899-9594 + 119 명시.",
    standardFormat: "제조사 [N-N-N], 한국독성정보센터 1899-9594, 소방 119",
    examples: ["㈜한국케미칼 1588-XXXX (24h), 한국독성정보센터 1899-9594, 119", "BASF 24h Hotline +49-180-..., 1899-9594, 119"],
    checkPoints: ["24시간 응답 가능", "한국어 응답 가능"],
  },
  // 섹션 2 — 유해성·위험성
  ghsClassification: {
    inputGuide: "GHS(전세계 통일 분류) 기준 위험 분류. 급성독성·피부부식·심각한 눈손상·발암성·생식독성·표적장기독성·흡인독성·인화성·산화성 등.",
    standardFormat: "[유해성 분류명] 카테고리 [N]",
    examples: ["급성독성(경구) 카테고리 4 / 피부 자극성 카테고리 2 / 심각한 눈손상·자극성 카테고리 2A", "인화성 액체 카테고리 2 / 발암성 카테고리 1A"],
    checkPoints: ["GHS 9차 개정 기준", "Globally Harmonized System UN 권고", "한국 산안법 §110 별표12·13 기준 일치"],
  },
  ghsPictogram: {
    inputGuide: "GHS 그림문자 9종 중 해당 항목. 해골(독성), 불꽃(인화), 부식(부식성), 환경(수생독성), 가스용기(고압), 폭발물, 산화제, 건강유해성(긴 표적), 느낌표(자극).",
    standardFormat: "[그림문자명] (해골/불꽃/부식 등) — 코드 GHS[N]",
    examples: ["해골(GHS06) + 부식(GHS05) + 건강유해성(GHS08)", "불꽃(GHS02) + 느낌표(GHS07)"],
    checkPoints: ["용기·포장에도 동일 그림문자", "9차 GHS 개정 기준"],
  },
  signalWord: {
    inputGuide: "위험 또는 경고 둘 중 하나. GHS 분류 카테고리에 따라 자동 결정.",
    standardFormat: "위험 OR 경고",
    examples: ["위험 (인화성 액체 카테고리 1·2 또는 급성독성 카테고리 1·2·3)", "경고 (자극성 카테고리 2 또는 만성 카테고리 2)"],
    checkPoints: ["GHS 분류 카테고리에 따른 자동 결정 (1·2급 = 위험, 그 외 = 경고)"],
  },
  hazardStatement: {
    inputGuide: "H-code 유해·위험 문구 표준 코드 (H200~H420 범위). 다중 분류는 모두 나열.",
    standardFormat: "H[NNN] [표준 문구] (필요 시 복수)",
    examples: ["H225 고인화성 액체 및 증기. H315 피부에 자극을 일으킴. H336 졸음 또는 현기증을 일으킬 수 있음.", "H350 암을 일으킬 수 있음. H361 태아 또는 생식능력에 손상을 일으킬 우려가 있음."],
    checkPoints: ["UN GHS 9차 개정 H-code 정확 사용", "복수 유해성 모두 표시"],
  },
  precautionaryStatement: {
    inputGuide: "P-code 예방조치 문구 (P101~P501 범위). 예방·대응·저장·폐기 4범주 표준 문구.",
    standardFormat: "P[NNN] [표준 문구] (예방·대응·저장·폐기 4범주)",
    examples: ["P210 화기 멀리 — P233 용기는 단단히 밀폐 — P302+P352 피부 묻으면 다량의 물·비누로 씻어내시오 — P403+P235 환기 잘되는 곳에 보관·서늘하게 유지", "P201 사용 전 특별 지시 받기 — P308+P313 노출 우려 시 의학적 진단을 받으시오"],
    checkPoints: ["GHS 표준 P-code 정확 사용", "4 범주(예방·대응·저장·폐기) 모두 명시"],
  },
  // 섹션 3 — 구성 성분
  casNo: {
    inputGuide: "CAS Registry No. (Chemical Abstracts Service) + KE No. (한국 화학물질 등록번호) + UN No. (운송용) 모두 기재.",
    standardFormat: "CAS [N-NN-N] / KE [NNNNN] / UN [NNNN]",
    examples: ["CAS 108-88-3 (톨루엔) / KE-32-345 / UN 1294", "CAS 67-56-1 (메탄올) / KE-19-12 / UN 1230"],
    checkPoints: ["KOSHA MSDS DB CAS 검색 일치", "수입품은 USA Federal Register 등록 확인"],
  },
  composition: {
    inputGuide: "단일물질은 100%, 혼합물은 성분별 함유량 (중량%). 5종 이상 주성분 명시. 영업비밀 시 '영업비밀'로 표시 가능.",
    standardFormat: "[성분명] CAS [N-N-N]: [N]%",
    examples: ["톨루엔 CAS 108-88-3: 60% / 자일렌 CAS 1330-20-7: 30% / MEK CAS 78-93-3: 10%", "비스페놀 A 에폭시 CAS 25068-38-6: 70% / 첨가제 (영업비밀): 30%"],
    checkPoints: ["함유량 합계 100% 또는 명확한 범위", "발암성·생식독성 함유 시 0.1% 이상 표시 의무"],
  },
  impurities: {
    inputGuide: "1% 미만 불순물·안정제. 안전상 중요한 것만 명시. 없으면 '해당사항 없음'.",
    standardFormat: "[성분명]: [N]% (역할: 안정제·억제제 등)",
    examples: ["메탄올 0.5% (안정제)", "해당사항 없음"],
    checkPoints: ["발암성 불순물은 0.1% 이상 표시"],
  },
  // 섹션 4 — 응급조치
  firstAidEye: {
    inputGuide: "눈 접촉 시 즉시 조치. 일반적: 다량의 물 15분 이상 세척 + 의료기관 후송. 화학별 특수 조치 추가.",
    standardFormat: "즉시 [N]분 이상 [세척방법]. 콘택트렌즈 [제거 여부]. 의료기관 후송.",
    examples: ["즉시 다량의 물로 15분 이상 씻어내시오. 콘택트렌즈 제거 가능하면 제거 후 계속 세척. 즉시 의료기관 후송.", "물 15분 세척 후 0.9% 생리식염수로 추가 세척. 안과 즉시 진료."],
    checkPoints: ["응급 세척 시설 위치 (응급세안기·샤워)", "근로자 사전 교육"],
  },
  firstAidSkin: {
    inputGuide: "피부 접촉 시 즉시 조치. 오염 의류 즉시 제거 + 비누·다량의 물 세척. 화상·자극 시 의료 후송.",
    standardFormat: "오염 의류 즉시 제거. [세척방법] [N]분 이상. 자극 [지속 시 조치].",
    examples: ["오염 의류·신발 즉시 제거. 비누와 다량의 물로 15분 이상 씻어내시오. 자극 지속 시 의료기관 후송.", "오염 의류 제거. 물·비누 20분 세척 + 화상 발생 시 즉시 119."],
    checkPoints: ["사업장 응급 샤워 시설", "근로자 사전 교육", "오염 의류 처리 방법"],
  },
  firstAidInhalation: {
    inputGuide: "흡입 시 조치. 환기 좋은 장소로 이동 + 호흡 곤란 시 산소 공급 + 의료 후송.",
    standardFormat: "환기 좋은 곳으로 이동. 호흡 [상태] 시 [조치]. 의료 후송.",
    examples: ["즉시 환기 좋은 장소로 이동. 호흡 곤란 시 산소 공급. 호흡 정지 시 인공호흡 + 119. 의식 없으면 회복 자세.", "환기 좋은 곳 이동 후 안정 + 산소 공급. 1899-9594 한국독성정보센터 자문."],
    checkPoints: ["인공호흡 자격자 사전 지정", "산소 공급 장비 비치"],
  },
  firstAidIngestion: {
    inputGuide: "섭취 시 조치. 의식 있을 때만 입 헹구기 + 즉시 의료기관 후송 + 강제 토하게 하지 않기.",
    standardFormat: "[입 헹굼] [토하기 금지/유도] [의사 진료]",
    examples: ["의식 있으면 입 헹구기. 강제로 토하게 하지 마시오. 즉시 119 + 의료기관 후송. MSDS 지참.", "다량의 물 마시기. 토하지 말 것. 한국독성정보센터 1899-9594."],
    checkPoints: ["MSDS 사본 의료기관 동행", "근로자 사전 교육"],
  },
  firstAidNote: {
    inputGuide: "응급요원·의사에 전달할 정보 (제품명·CAS·증상·노출시간 등).",
    standardFormat: "[제품명·성분]·[노출 경로]·[노출 시간]·[증상]을 의사에 전달.",
    examples: ["제품명·CAS·노출량·증상 의사에 전달. MSDS 지참.", "톨루엔 노출 의심. 증상: 두통·현기증·구역. 노출 시간 약 10분."],
    checkPoints: ["MSDS 응급세트 동행", "비상 연락처 사전 등록"],
  },
  // 섹션 7 — 취급·저장
  handling: {
    inputGuide: "안전한 취급 절차 (정전기·화기·환기·금지조건). 작업자 보호구 + 환기 조건 + 화기 거리 명시.",
    standardFormat: "환기 [조건]. 화기 [N]m 이내 금지. 정전기 [방지조치]. 보호구 [종류].",
    examples: ["국소배기·전체환기 필수. 화기 5m 이내 금지. 정전기 접지·도전성 신발. 보호구: 호흡보호구·내화학장갑·보안경.", "환기 잘되는 옥외 작업 권장. 화기 사용 절대 금지. 정전기 도전성 용기 사용. 방화복·자급식호흡기."],
    checkPoints: ["취급 직전 위험성평가", "근로자 MSDS 교육 사전 의무"],
  },
  storage: {
    inputGuide: "저장 조건 (온도·환기·금지물질). 저장 한도 + 화기 거리 + 양립금지 물질 명시.",
    standardFormat: "온도 [N]°C 이하. 환기 [조건]. 양립금지 [물질]. 저장 한도 [N]L.",
    examples: ["서늘한 곳 (40°C 이하). 환기 필수. 산화제·강산성 물질과 격리 저장. 저장 한도 200L (위험물안전관리법 별표6).", "냉장 (5~10°C). 직사광선 차단. 강알칼리·강산과 분리. 저장 한도 1톤 이하."],
    checkPoints: ["위험물안전관리법 저장 한도", "양립금지 물질 명시", "정기 누출 점검"],
  },
  // 섹션 8 — 노출방지·보호구
  exposureLimit: {
    inputGuide: "고용노동부 고시 노출기준 (TWA·STEL·천장값) 또는 ACGIH TLV. 단위 ppm 또는 mg/m³.",
    standardFormat: "TWA [N] ppm / STEL [N] ppm / 천장값 [N] ppm",
    examples: ["톨루엔: TWA 50 ppm / STEL 150 ppm (고용노동부 고시 기준)", "메탄올: TWA 200 ppm / STEL 250 ppm / 흡수표시: 피부 (S)"],
    checkPoints: ["고용노동부 고시 최신본 확인", "사업장 작업환경측정 결과 비교"],
  },
  engineeringControl: {
    inputGuide: "공학적 노출방지 (LEV·전체환기·격리·자동화). KOSHA 가이드 W-시리즈 참조.",
    standardFormat: "[LEV/전체환기/격리/자동화] [용량] / [위치]",
    examples: ["국소배기장치 (LEV) 후드 작업면 30cm, 풍속 0.5m/s 이상. 작업장 전체환기 6회/h.", "밀폐 자동화 공정. 비상 환기 펌프. 가스 검지기 5개 분산 설치."],
    checkPoints: ["LEV 정기 점검 (산안법 §93 안전검사)", "환기 풍속 측정 기록", "가스 검지기 작동 확인"],
  },
  respiratoryPpe: {
    inputGuide: "호흡보호구 종류 (방진·방독·송기마스크·자급식호흡기). 노출 농도·물질에 따라 자동 결정.",
    standardFormat: "[종류] (정화통 [등급] / [흡수제]) [등급]",
    examples: ["유기가스용 방독마스크 (정화통 OV·검은색) 또는 송기마스크. 농도 IDLH 초과 시 자급식 호흡기 (SCBA).", "방진·방독 겸용 마스크 (P3 등급 + 정화통 BR). 격렬한 작업·고농도 시 송기마스크."],
    checkPoints: ["사용 전 누설 시험", "정화통 사용시간 추적", "근로자 호흡보호구 적합성 검사 (피팅테스트)"],
  },
  skinPpe: {
    inputGuide: "보호장갑 (소재·두께) + 방호복 + 보안경 + 안전화. 화학물질별 적합 소재 매칭.",
    standardFormat: "장갑: [소재] [두께], 방호복: [종류], 보안경: [종류], 안전화: [기준]",
    examples: ["장갑: 부틸고무 0.4mm 이상, 방호복: 화학용 카테고리 III (Type 3 액체방호), 보안경: 측면보호 차폐형, 안전화: 내화학·내정전기.", "장갑: 비닐 0.2mm, 방호복: 일반 작업복+팔토시, 보안경: 안전 보안경, 안전화: 일반 안전화."],
    checkPoints: ["장갑 침투시간 (breakthrough time) 확인", "방호복 등급 (Type 3·4·5·6)", "정전기 방지 신발"],
  },
  // 한국 게시·교육
  postedLocation: {
    inputGuide: "MSDS 게시 의무 위치 (산안법 §114). 작업장 잘 보이는 곳 + 화학물질 취급 장소 인근.",
    standardFormat: "[위치명] (작업장 [N]개소 / 사무실 [N]개소)",
    examples: ["페인트 보관창고 출입문 옆 + 도장 작업장 게시판 + 안전관리실. 총 3개소.", "화학물질 보관실 출입문 + 실험실 입구 + 사업장 게시판. 총 3개소."],
    checkPoints: ["취급 장소 5m 이내 게시", "근로자 항상 볼 수 있는 곳", "갱신 시 즉시 교체"],
  },
  trainingDate: {
    inputGuide: "산안법 §115 MSDS 교육 의무. 신규 채용·작업변경·MSDS 변경 시 교육. 교육일·이수자·강사 기록.",
    standardFormat: "[일자]: [강사] [N]시간 / 이수자 [N]명 (서명부 별첨)",
    examples: ["2026-04-15: 김안전(보건관리자) 2시간 / 이수자 12명 (서명부 별첨, 작업장 게시).", "2026-04-28 (신규채용 3명): 박안전관리자 1시간 / 이수자 3명 + 시험 통과."],
    checkPoints: ["연 1회 이상 정기 교육", "신규·변경 시 즉시 교육", "이수자 서명부 5년 보존"],
  },
  warningLabel: {
    inputGuide: "용기·포장 GHS 경고표지 (산안법 §114). 그림문자·신호어·H-code·P-code·제품명 표시.",
    standardFormat: "GHS 라벨: 그림문자 [N]종 + 신호어 + H[NNN] + P[NNN] + 제품명 + 제조사",
    examples: ["GHS 라벨: 불꽃·해골·느낌표 + '위험' + H225·H315·H336 + P210·P233·P302+P352 + '신너 600' + '㈜한국케미칼'.", "GHS 라벨: 부식·건강유해성 + '위험' + H314·H350 + P201·P260·P303+P361+P353 + '에폭시 P-100'."],
    checkPoints: ["100mL 미만 소량 용기는 약식 표지 가능", "한글 + 영문 병기 권장", "라벨 손상 시 즉시 교체"],
  },
};

async function main() {
  const node = JSON.parse(await readFile(PATH, "utf-8"));
  let updated = 0;
  for (const sec of node.sections ?? []) {
    for (const f of sec.fields ?? []) {
      const guide = GUIDES[f.key];
      if (!guide) continue;
      f.inputGuide = guide.inputGuide;
      f.standardFormat = guide.standardFormat;
      f.examples = guide.examples;
      f.checkPoints = guide.checkPoints;
      updated += 1;
    }
  }
  await writeFile(PATH, JSON.stringify(node, null, 2) + "\n", "utf-8");
  console.log(`✓ msds_register: ${updated}개 field에 가이드 추가`);
}

main().catch(console.error);
