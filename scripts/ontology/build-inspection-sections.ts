#!/usr/bin/env tsx
/**
 * 점검표 9개에 sections + fields 구축.
 *
 * 법적 근거: 기준규칙 §32·§38·§42·§57·§93·§147·§301 외 + 산안법 §64
 * 표준 점검 항목: KOSHA 가이드 + 기준규칙 본문 발췌
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

interface Section {
  title: string;
  legalSource?: string;
  fields: Array<{
    key: string;
    label: string;
    required: boolean;
    inputGuide?: string;
    standardFormat?: string;
    examples?: string[];
    checkPoints?: string[];
  }>;
}

const INSPECTION_TEMPLATES: Record<string, Section[]> = {
  "scaffolding-inspection-checklist": [
    {
      title: "점검 메타",
      legalSource: "기준규칙 §57 (비계 작업 시작 전 점검 의무)",
      fields: [
        { key: "inspectionDate", label: "점검 일시", required: true,
          inputGuide: "작업 시작 전 점검 일시. 매일 작업 전 + 강풍·강우 후 + 비계 변경 후.",
          standardFormat: "YYYY-MM-DD HH:MM",
          examples: ["2026-04-29 07:30 (작업 시작 전)", "2026-04-29 13:00 (오후 강풍 후)"],
          checkPoints: ["기준규칙 §57 매 작업 전 점검 의무", "악천후 후 추가 점검"] },
        { key: "inspector", label: "점검자 (자격)", required: true,
          inputGuide: "관리감독자·안전관리자 또는 작업지휘자. 비계 자격 보유자 권장.",
          standardFormat: "[성명] [직위·자격]",
          examples: ["박감독 (관리감독자, 비계기능사)", "김안전 (안전관리자)"],
          checkPoints: ["관리감독자 직무 (산안법 §16)"] },
        { key: "scaffoldType", label: "비계 종류", required: true,
          inputGuide: "강관비계 / 시스템비계 / 달비계 / 말비계 / 이동식 비계.",
          standardFormat: "[종류] / 설치 위치·높이",
          examples: ["강관비계 (외벽 단면, 높이 18m)", "시스템비계 (내부 거푸집, 높이 9m)"],
          checkPoints: ["비계 도면·구조계산서 보유"] },
      ],
    },
    {
      title: "구조 점검",
      legalSource: "기준규칙 §57·§59·§60·§62·§63 + 별표5 강관비계 조립간격",
      fields: [
        { key: "ground", label: "지반·받침철물", required: true,
          inputGuide: "지반 침하·기울어짐 + 받침철물(잭·깔판) 적정 + 가설판 균열·파손.",
          standardFormat: "지반 [평탄·고저차]. 받침철물 [정렬]. 가설판 [상태]",
          examples: ["지반 평탄. 받침철물 잭 30mm 균등. 가설판 양호.", "받침철물 일부 침하 발견 (북측 3개) → 즉시 보강."],
          checkPoints: ["기준규칙 §59 지반 견고", "강관 받침판 사용", "동결·연약지반 확인"] },
        { key: "uprights", label: "비계기둥·띠장·장선", required: true,
          inputGuide: "기둥 수직·띠장 수평·장선 간격 적정. 별표5 기준 (기둥 1.85m 이하·띠장 1.5m·장선 1.5m).",
          standardFormat: "기둥 간격 [m]·띠장 [m]·장선 [m] (기준 일치/이격 [범위])",
          examples: ["기둥 1.8m·띠장 1.5m·장선 1.5m (기준 일치). 기울기 0.5도 이내.", "기둥 일부 1.95m (기준 1.85m 초과) → 즉시 보강."],
          checkPoints: ["별표5 표준 간격", "수직·수평 측정", "이음부 결속"] },
        { key: "platform", label: "작업발판·안전난간", required: true,
          inputGuide: "작업발판 폭 40cm 이상·고정 + 안전난간 90cm·중간대 45cm + 발끝막이판 10cm.",
          standardFormat: "발판 [폭·고정]·안전난간 [높이]·발끝막이판 [높이]",
          examples: ["발판 폭 50cm·이중 고정. 난간 상부 100cm·중간 50cm. 발끝막이 10cm.", "난간 일부 미설치 발견 → 즉시 설치 후 작업 재개."],
          checkPoints: ["기준규칙 §13 안전난간 설치 기준", "발판 결속·균열·파손"] },
        { key: "ladders", label: "승강설비", required: true,
          inputGuide: "사다리·승강로 적정 (3.5m 간격·60도 이내·고정).",
          standardFormat: "[종류] 간격 [m]·각도 [도]·고정 [방식]",
          examples: ["사다리 3m 간격·60도·상·하 고정. 손잡이 1.0m 돌출.", "승강로 1개소 미설치 → 추가 설치."],
          checkPoints: ["기준규칙 §24 승강설비 설치"] },
      ],
    },
    {
      title: "추락방지·안전망",
      legalSource: "기준규칙 §42·§43 (추락방지 + 안전망)",
      fields: [
        { key: "fallNet", label: "추락방지망", required: true,
          inputGuide: "비계 외측 추락방지망 설치 + 망목·강도·접합부 점검.",
          standardFormat: "설치 [위치] / 망목 [N]cm / 강도 [기준] / 접합부 [상태]",
          examples: ["외측 5층마다 설치 (높이 5m 간격). 망목 100×100mm. 강도 KS 기준. 접합 양호.", "3층 망 일부 손상 (10×30cm 구멍) → 즉시 교체."],
          checkPoints: ["기준규칙 §42 추락방지", "망 손상·오염", "지지 구조 강도"] },
        { key: "anchorPoints", label: "안전대 부착설비", required: true,
          inputGuide: "수직·수평 부착설비 + 강도 + 부착 방법.",
          standardFormat: "[종류] 위치 [N]개소 / 강도 [기준]",
          examples: ["수직 안전로프 5개소·수평 안전로프 외측 1열. 강도 22kN.", "안전로프 손상 1개소 → 교체."],
          checkPoints: ["기준규칙 §44 안전대 부착설비", "부식·손상 확인"] },
      ],
    },
    {
      title: "결과 + 부적합 조치",
      legalSource: "산안법 §38·§56 (작업중지 의무)",
      fields: [
        { key: "overallResult", label: "종합 결과", required: true,
          inputGuide: "점검 결과 종합 (적합/조건부 적합/부적합).",
          standardFormat: "[적합/조건부/부적합] / 부적합 시 [작업중지 결정]",
          examples: ["적합 (모든 항목 기준 충족, 작업 가능)", "조건부 적합 (난간 보강 후 작업 시작) / 부적합 (작업중지 + 보강 후 재점검)"],
          checkPoints: ["부적합 시 즉시 작업중지 권한", "재점검 의무"] },
        { key: "correctiveAction", label: "부적합 시 조치", required: true,
          inputGuide: "발견 결함별 시정 조치·담당자·기한·재점검 일자.",
          standardFormat: "[결함] / 조치 [내용] / 담당 [성명] / 기한 [일시] / 재점검 [일자]",
          examples: ["북측 받침철물 침하 / 잭 추가 보강 / 박작업 / 2026-04-29 09:00 / 09:30 재점검", "안전난간 미설치 → 즉시 설치 / 김반장 / 즉시 / 작업 재개 직전 재점검"],
          checkPoints: ["조치 사진 기록", "재점검 후 작업 재개", "기록 5년 보존"] },
      ],
    },
  ],

  "fall-prevention-net-inspection": [
    {
      title: "점검 메타",
      legalSource: "기준규칙 §42 (추락방지망 설치·점검 의무)",
      fields: [
        { key: "inspectionDate", label: "점검 일시", required: true },
        { key: "inspector", label: "점검자", required: true },
        { key: "netLocation", label: "망 설치 위치·층", required: true,
          inputGuide: "추락방지망 설치 층·구획·면적.",
          standardFormat: "[건물·층] [면적]m² ([N]장)",
          examples: ["A동 5층 외측 80m² (4장)", "B동 1·2층 슬래브 단부 50m²"] },
      ],
    },
    {
      title: "망 점검",
      legalSource: "기준규칙 §42 + KS K 6606",
      fields: [
        { key: "netCondition", label: "망목·강도", required: true,
          inputGuide: "망목 100×100mm + 인장강도 KS 기준 + 신축률 확인.",
          standardFormat: "망목 [N]×[N]mm / 인장강도 [기준] / 신축 [범위]",
          examples: ["망목 100×100mm. 인장강도 KS K 6606 기준. 신축 10% 이내.", "망목 일부 손상 (5x10cm) → 교체."] },
        { key: "damageCheck", label: "손상·오염 점검", required: true,
          inputGuide: "찢어짐·구멍·녹·기름 오염 + UV 노화.",
          standardFormat: "[손상 종류] [위치] [면적]",
          examples: ["손상 무.", "찢어짐 2개소 (북측 3m² 영역) → 즉시 교체."] },
        { key: "anchoring", label: "지지 구조·결속", required: true,
          inputGuide: "지지 구조(보·기둥) 강도 + 결속 (와이어·결속선) 적정.",
          standardFormat: "지지 [구조] / 결속 [방법] / 간격 [m]",
          examples: ["보·기둥 결속 와이어 강도 22kN. 0.5m 간격 결속.", "결속 일부 풀림 → 재결속."] },
      ],
    },
    {
      title: "결과·조치",
      fields: [
        { key: "result", label: "종합 결과", required: true },
        { key: "action", label: "부적합 조치", required: true },
      ],
    },
  ],

  "safety-harness-inspection": [
    {
      title: "점검 메타",
      legalSource: "기준규칙 §32 (안전대 점검 의무)",
      fields: [
        { key: "inspectionDate", label: "점검 일시", required: true },
        { key: "inspector", label: "점검자", required: true },
        { key: "harnessId", label: "안전대 식별번호", required: true,
          inputGuide: "안전대 일련번호·KCs 인증번호.",
          standardFormat: "일련번호 [N] / KCs [번호] / 사용자 [성명]",
          examples: ["SN 2024-0123 / KCs 18-A-1234 / 홍길동", "SN 2024-0456 / 김근로 (입사 1년차)"] },
      ],
    },
    {
      title: "본체 점검",
      legalSource: "기준규칙 §32 + 별표9-2",
      fields: [
        { key: "webbing", label: "웨빙 (벨트)", required: true,
          inputGuide: "찢어짐·마모·UV 노화·녹·기름 오염 점검.",
          standardFormat: "[부위] [상태]",
          examples: ["어깨·허리 웨빙 양호. 마모 1mm 이내.", "허리 벨트 5cm 찢어짐 → 폐기."] },
        { key: "buckle", label: "버클·D링", required: true,
          inputGuide: "버클 잠금 동작·D링 변형·녹.",
          standardFormat: "[동작 정상/이상] / [변형 유무]",
          examples: ["버클 정상 동작. D링 변형 무.", "어깨 D링 미세 변형 → 교체."] },
        { key: "lanyard", label: "죔줄·완충장치", required: true,
          inputGuide: "죔줄 마모·매듭·완충장치(쇼크 업소버) 작동 흔적.",
          standardFormat: "죔줄 [상태] / 완충장치 [작동 흔적]",
          examples: ["죔줄 양호. 완충장치 미작동 (정상).", "완충장치 작동 흔적 (충격 받음) → 폐기 후 신규."] },
      ],
    },
    {
      title: "결과·조치",
      fields: [
        { key: "result", label: "종합 결과", required: true,
          inputGuide: "사용 가능/조건부/폐기. 5년 사용 후 의무 폐기.",
          standardFormat: "[판정] / [폐기 사유]",
          examples: ["사용 가능 (다음 점검 1주 후)", "폐기 (제조 5년 경과)"],
          checkPoints: ["KOSHA H-42 안전대 사용 지침"] },
        { key: "action", label: "조치", required: true },
      ],
    },
  ],

  "tower-crane-inspection": [
    {
      title: "점검 메타",
      legalSource: "기준규칙 §147 (양중기 작업 시작 전 점검) + 산안법 §93 안전검사",
      fields: [
        { key: "inspectionDate", label: "점검 일시", required: true,
          inputGuide: "매일 작업 시작 전 + 강풍·강우 후 + 부재 변경 후.",
          standardFormat: "YYYY-MM-DD HH:MM",
          examples: ["2026-04-29 06:30 (작업 시작 전)"] },
        { key: "operator", label: "운전자 (자격)", required: true,
          inputGuide: "타워크레인 운전자격증 보유자 + 정기 신체검사.",
          standardFormat: "[성명] (자격증 [번호], 신체검사 [일자])",
          examples: ["김타워 (국가기술자격 18-XX, 신체 2026-03-15)"] },
        { key: "modelInfo", label: "타워크레인 정보", required: true,
          inputGuide: "기종·정격하중·작업반경.",
          standardFormat: "[기종] / 정격하중 [톤] / 작업반경 [m]",
          examples: ["POTAIN MD 365 / 정격 12톤 (반경 30m) / 6톤 (50m)"] },
      ],
    },
    {
      title: "안전장치 점검",
      legalSource: "기준규칙 §134·§141·§147",
      fields: [
        { key: "overloadDevice", label: "과부하방지장치", required: true,
          inputGuide: "정격 초과 시 자동 정지·경보. 시험 작동 확인.",
          standardFormat: "시험 [정상/이상] / 경보 [동작]",
          examples: ["115% 부하 시험 → 자동 정지 + 경보 정상.", "경보 미동작 → 즉시 수리."] },
        { key: "limitSwitch", label: "권과방지·충돌방지장치", required: true,
          inputGuide: "후크 상한·하한 자동 정지 + 인접 크레인 충돌방지.",
          standardFormat: "[장치] [동작 정상/이상]",
          examples: ["권과 상한 자동정지 정상. 인접 크레인 거리감지 정상."] },
        { key: "windAlarm", label: "풍속계·경보", required: true,
          inputGuide: "10m/s 작업제한·15m/s 작업중지 자동 경보.",
          standardFormat: "풍속 [m/s] / 경보 [상태]",
          examples: ["풍속 5m/s. 경보 정상 작동.", "풍속 12m/s → 작업중지."],
          checkPoints: ["기준규칙 §147 풍속 한계", "10m/s 작업제한·15m/s 중지"] },
      ],
    },
    {
      title: "기계 점검",
      fields: [
        { key: "wireRope", label: "와이어로프·후크", required: true,
          inputGuide: "와이어로프 손상·꼬임·마모 + 후크 균열·변형.",
          standardFormat: "와이어 [상태] / 후크 [상태]",
          examples: ["와이어 양호. 후크 균열 무.", "와이어 1소선 절단 → 교체."] },
        { key: "structure", label: "지브·마스트·턴테이블", required: true,
          inputGuide: "구조 균열·볼트 풀림·도장 손상.",
          standardFormat: "[부위] [상태]",
          examples: ["지브·마스트 균열 무. 볼트 토크 정상.", "마스트 결속 일부 풀림 → 재토크."] },
      ],
    },
    {
      title: "결과·조치",
      fields: [
        { key: "result", label: "종합 결과", required: true },
        { key: "action", label: "조치", required: true },
      ],
    },
  ],

  "construction-machinery-inspection": [
    {
      title: "점검 메타",
      legalSource: "기준규칙 §93 (차량계 건설기계 작업 시작 전 점검)",
      fields: [
        { key: "inspectionDate", label: "점검 일시", required: true },
        { key: "operator", label: "운전자 (자격)", required: true,
          inputGuide: "건설기계 종류별 운전자격증.",
          standardFormat: "[성명] / [장비명] [자격번호]",
          examples: ["박운전 / 굴삭기 운전기능사 18-XXX", "이운전 / 덤프트럭 (대형면허 + 화물차 자격)"] },
        { key: "machineType", label: "장비 종류·규격", required: true,
          inputGuide: "굴삭기·로더·덤프·롤러 + 정격 용량.",
          standardFormat: "[장비명] [모델] / 정격 [용량]",
          examples: ["굴삭기 (현대 R220LC-9, 0.92㎥ 버킷)", "덤프트럭 (현대 메가 15톤)"] },
      ],
    },
    {
      title: "기본 점검",
      legalSource: "기준규칙 §93·§99·§104",
      fields: [
        { key: "engineBrake", label: "시동·브레이크·조향", required: true,
          inputGuide: "시동 정상·브레이크 작동·조향장치.",
          standardFormat: "[항목] [정상/이상]",
          examples: ["시동·브레이크·조향 모두 정상.", "브레이크 페달 스폰지 → 정비 후 작업."] },
        { key: "lights", label: "전조등·후방경보", required: true,
          inputGuide: "기준규칙 §104 전조등 의무 + 후진 시 자동 경보.",
          standardFormat: "전조등 [상태] / 후방경보 [동작]",
          examples: ["전조등 정상. 후방경보 85dB 동작 정상."] },
        { key: "rolloverProtection", label: "전도방지·시트벨트", required: true,
          inputGuide: "ROPS·FOPS·시트벨트 의무.",
          standardFormat: "[장치] [상태]",
          examples: ["ROPS·FOPS 균열 무. 시트벨트 작동 정상."] },
      ],
    },
    {
      title: "작업장치",
      fields: [
        { key: "attachment", label: "버킷·디퍼·블레이드", required: true,
          inputGuide: "균열·이빨 마모·핀 풀림.",
          standardFormat: "[부위] [상태]",
          examples: ["버킷 이빨 마모 30% (교체 기준 50%). 균열 무.", "디퍼 핀 일부 풀림 → 재체결."] },
        { key: "hydraulic", label: "유압 누유·유압호스", required: true,
          inputGuide: "유압유 누유·호스 마모·균열.",
          standardFormat: "누유 [위치]·호스 [상태]",
          examples: ["누유 무. 호스 양호."] },
      ],
    },
    {
      title: "결과·조치",
      fields: [
        { key: "result", label: "종합 결과", required: true },
        { key: "action", label: "조치", required: true },
      ],
    },
  ],

  "temporary-electric-inspection": [
    {
      title: "점검 메타",
      legalSource: "기준규칙 §301~§305 (전기설비 점검 의무)",
      fields: [
        { key: "inspectionDate", label: "점검 일시", required: true },
        { key: "inspector", label: "점검자 (전기 자격)", required: true,
          inputGuide: "전기기사·산업기사 또는 안전관리자.",
          standardFormat: "[성명] (자격 [번호])",
          examples: ["이전기 (전기기사 19-EE-XXX)"] },
      ],
    },
    {
      title: "분전반·차단기",
      legalSource: "기준규칙 §301·§302·§303",
      fields: [
        { key: "panel", label: "분전반·MCB·MCCB", required: true,
          inputGuide: "분전반 잠금·MCB 정격·MCCB 동작 시험.",
          standardFormat: "분전반 [잠금]·MCB [정격A]·MCCB [동작]",
          examples: ["분전반 잠금. MCB 30A. MCCB 200A 시험 정상."] },
        { key: "rcd", label: "누전차단기 (ELCB)", required: true,
          inputGuide: "30mA 0.03초·시험버튼 작동 (월 1회 이상).",
          standardFormat: "감도 [mA] / 시험 [동작]",
          examples: ["감도 30mA, 0.03초 동작. 시험버튼 정상."],
          checkPoints: ["기준규칙 §304 누전차단기 의무"] },
      ],
    },
    {
      title: "접지·절연",
      legalSource: "기준규칙 §301·§305",
      fields: [
        { key: "grounding", label: "접지 저항", required: true,
          inputGuide: "접지 저항 100Ω 이하 (Class 3) 또는 10Ω 이하 (Class 1).",
          standardFormat: "접지저항 [Ω] (기준 [N]Ω 이하)",
          examples: ["접지저항 5Ω (기준 100Ω 이하 — 양호)"] },
        { key: "insulation", label: "절연저항", required: true,
          inputGuide: "절연저항 1MΩ 이상 (저압) / 5MΩ 이상 (고압).",
          standardFormat: "절연저항 [MΩ] (기준 [N]MΩ 이상)",
          examples: ["전체 회로 5MΩ (저압 기준 양호)"] },
      ],
    },
    {
      title: "케이블·콘센트",
      fields: [
        { key: "cable", label: "케이블 손상·접속", required: true,
          inputGuide: "케이블 피복 손상·접속점 절연.",
          standardFormat: "[위치] [상태]",
          examples: ["전체 양호. 접속점 절연테이프 부식 무."] },
        { key: "outlet", label: "콘센트·플러그", required: true,
          inputGuide: "방수형 콘센트 + 누전차단 콘센트 사용.",
          standardFormat: "[종류] [상태]",
          examples: ["방수형 IP65, 누전차단 콘센트 모두 양호."] },
      ],
    },
    {
      title: "결과·조치",
      fields: [
        { key: "result", label: "종합 결과", required: true },
        { key: "action", label: "조치", required: true },
      ],
    },
  ],

  "temporary-fire-facility-check": [
    {
      title: "점검 메타",
      legalSource: "건설현장 화재안전기준 (소방청 고시) + 산안법 §38",
      fields: [
        { key: "inspectionDate", label: "점검 일시", required: true },
        { key: "inspector", label: "점검자", required: true },
        { key: "siteScale", label: "현장 규모", required: true,
          inputGuide: "층수·연면적 (소방시설 의무 결정 기준).",
          standardFormat: "지하 [N]층 + 지상 [N]층 / 연면적 [m²]",
          examples: ["지하 3층 + 지상 15층 / 연면적 25,000m²"] },
      ],
    },
    {
      title: "소화 설비",
      fields: [
        { key: "extinguisher", label: "소화기 위치·압력", required: true,
          inputGuide: "5m 간격 + 압력 정상 + 유효기한.",
          standardFormat: "[N]개 / 간격 [m] / 압력 [정상/저하] / 유효기한 [일자]",
          examples: ["8개 (5m 간격). 압력 모두 정상. 유효 2027-12.", "1개 압력 저하 → 교체."] },
        { key: "hydrant", label: "소화전·연결송수관", required: true,
          inputGuide: "건축법상 의무 시 소화전·연결송수관 설치.",
          standardFormat: "[종류] [N]개소 / 압력·수량 시험",
          examples: ["옥내소화전 4층마다. 시험 0.7MPa 정상.", "(소규모 미설치 — 의무 없음)"] },
      ],
    },
    {
      title: "경보·피난",
      fields: [
        { key: "fireDetector", label: "자동화재탐지기", required: true,
          inputGuide: "연기·열 감지기 + 경보 동작.",
          standardFormat: "[종류] [N]개 / 시험 [동작]",
          examples: ["연기감지기 12개·경보 시험 정상."] },
        { key: "emergencyLight", label: "비상조명·피난로", required: true,
          inputGuide: "비상조명 30분 작동 + 피난로 표지 + 출입구 잠금 해제.",
          standardFormat: "비상조명 [N]개·피난로 [상태]·출입구 [잠금]",
          examples: ["비상조명 8개 (30분 시험 정상). 피난로 표지 양호. 출입구 잠금 해제됨."] },
      ],
    },
    {
      title: "결과·조치",
      fields: [
        { key: "result", label: "종합 결과", required: true },
        { key: "action", label: "조치", required: true },
      ],
    },
  ],

  "pre-work-inspection": [
    {
      title: "점검 메타",
      legalSource: "기준규칙 §38 ② (작업 시작 전 점검) + 산안법 §29 (TBM)",
      fields: [
        { key: "inspectionDate", label: "점검 일시", required: true },
        { key: "supervisor", label: "작업지휘자·관리감독자", required: true },
        { key: "workType", label: "당일 작업", required: true,
          inputGuide: "작업명·구역·인원·예정 시간.",
          standardFormat: "[작업명] / [구역] / 인원 [N]명 / [시작·종료]",
          examples: ["굴착작업 (1구역) / 8명 / 08:00~17:00"] },
      ],
    },
    {
      title: "환경·기상",
      fields: [
        { key: "weather", label: "기상 (강우·풍속·기온)", required: true,
          inputGuide: "당일·시간대 기상예보 + 작업중지 기준.",
          standardFormat: "[강우]mm/h·[풍속]m/s·[기온]°C / 작업중지 [기준]",
          examples: ["강우 0mm·풍속 3m/s·기온 18°C. 작업 가능.", "풍속 12m/s 예보 → 11시 이후 작업중지."] },
        { key: "siteCondition", label: "작업장 환경", required: true,
          inputGuide: "조명·통풍·진입로·기물 정리.",
          standardFormat: "[조명]·[통풍]·[진입로]·[정리]",
          examples: ["조명 양호. 통풍 정상. 진입로 정리 완료."] },
      ],
    },
    {
      title: "근로자·보호구",
      fields: [
        { key: "workerCondition", label: "근로자 상태", required: true,
          inputGuide: "건강·음주·피로 + 신규자·외국인 별도 확인.",
          standardFormat: "건강 [N]명·음주 [무]·신규 [N]명",
          examples: ["8명 건강 양호. 음주 무. 신규 1명 (별도 OJT)."] },
        { key: "ppe", label: "보호구 착용", required: true,
          inputGuide: "안전모·안전대·안전화·고시인성 의무.",
          standardFormat: "[종류] [착용 인원]/[전체]",
          examples: ["안전모·안전화 8/8. 안전대 4/4 (고소 작업).", "1명 안전모 미착용 → 작업 시작 전 시정."] },
      ],
    },
    {
      title: "위험요인 + TBM",
      fields: [
        { key: "tbmTopic", label: "TBM 주제·위험 식별", required: true,
          inputGuide: "당일 작업 위험 + 통제대책 + 신호 + 비상연락.",
          standardFormat: "[위험] / [통제] / [신호] / [비상]",
          examples: ["굴착 매몰 + 흙막이 점검 + 무전기 CH-7 + 119/박감독.", "고소 추락 + 안전대 부착설비 + 신호수 배치."] },
      ],
    },
    {
      title: "결과·조치",
      fields: [
        { key: "result", label: "작업 시작 가능 여부", required: true },
        { key: "action", label: "부적합 조치", required: true },
      ],
    },
  ],

  "weekly-joint-inspection": [
    {
      title: "회의 메타",
      legalSource: "산안법 §64 (도급사업장 합동안전보건점검 — 분기 1회 의무, 주간 KOSHA 권고)",
      fields: [
        { key: "meetingDate", label: "점검 일시", required: true,
          standardFormat: "YYYY-MM-DD HH:MM",
          examples: ["2026-04-29 14:00"] },
        { key: "participants", label: "참석자 (원·하도급)", required: true,
          inputGuide: "원도급·하도급 안전보건책임자·관리감독자·근로자대표 모두 참석. 산안법 §64 분기 1회 의무.",
          standardFormat: "원도급 [N]명·하도급 [N]사 [N]명·근로자대표 [N]명 (총 [N]명)",
          examples: ["원도급 황룡건설 5명 + 하도급 ㈜OO철근 3명·㈜XX전기 2명·㈜YY설비 2명 + 근로자대표 4명 (총 16명)"] },
      ],
    },
    {
      title: "점검 구역",
      fields: [
        { key: "inspectedArea", label: "합동 점검 구역·내용", required: true,
          inputGuide: "현장 전체 또는 구역별 점검 + 작업별 위험요인.",
          standardFormat: "[구역] / [점검 내용]",
          examples: ["1공구 굴착 + 2공구 골조 + 3공구 마감 (전 구역). 안전난간·비계·전기설비·소화기."] },
      ],
    },
    {
      title: "발견 결함",
      fields: [
        { key: "findings", label: "발견 결함 (구역별)", required: true,
          inputGuide: "결함 항목·위치·심각도 + 즉시 작업중지 여부.",
          standardFormat: "[N]건 / [구역]: [결함]·[심각도]",
          examples: ["3건. 2공구 안전난간 일부 미설치 (중·즉시 시정). 1공구 분전반 잠금 무 (경·당일 시정).", "결함 무 (전체 양호)."] },
        { key: "correctiveActions", label: "시정 조치 + 기한", required: true,
          inputGuide: "결함별 담당자·기한·재점검.",
          standardFormat: "[결함] → [담당]·[기한]·[재점검]",
          examples: ["안전난간 미설치 → 박반장·즉시·14:30 재점검. 분전반 잠금 → 이전기·17:00·내일 점검."] },
      ],
    },
    {
      title: "다음 회의",
      fields: [
        { key: "nextMeeting", label: "다음 회의 일자", required: true,
          inputGuide: "산안법 §64 분기 1회 의무. KOSHA 주간 권고.",
          standardFormat: "YYYY-MM-DD",
          examples: ["2026-05-06 (주간)", "2026-07-29 (분기 의무)"] },
      ],
    },
  ],
};

async function main() {
  let updated = 0;
  for (const [docKey, sections] of Object.entries(INSPECTION_TEMPLATES)) {
    const path = resolve(DOCS, `${docKey}.jsonld`);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      node.sections = sections;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      const fieldCount = sections.reduce((s, sec) => s + sec.fields.length, 0);
      console.log(`  ✓ ${docKey}: ${sections.length} sections, ${fieldCount} fields`);
      updated += 1;
    } catch (err) {
      console.warn(`  ✗ ${docKey}: ${(err as Error).message}`);
    }
  }
  console.log(`\n[done] ${updated} 점검표에 sections 구축 완료`);
}

main().catch(console.error);
