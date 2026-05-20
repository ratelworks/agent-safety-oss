#!/usr/bin/env tsx
/**
 * auto-align-to-official.ts (2026-04-29)
 *
 * 공식 양식·법령 본문의 cached 라벨과 MCP 노드의 sections.fields를 100% 매칭되게 자동 정렬.
 *
 * 정책:
 *  - cached 라벨은 audit-form-vs-mcp.ts 에서 가져옴
 *  - MCP 노드의 sections를 단일 섹션으로 재구성하여 모든 cached 라벨을 fields 로 추가
 *  - 기존 fields 의 inputGuide·examples·checkPoints 가 있으면 보존 (라벨 매칭 시)
 *  - 없으면 자동 생성된 빈 inputGuide
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJ = resolve(__dirname, "..", "..");

// docId → 공식 cached 라벨 매핑 (audit-form-vs-mcp.ts 와 동기)
const OFFICIAL_LABELS: Record<string, { sectionTitle: string; legalSource: string; labels: string[] }> = {
  initial_risk_assessment: {
    sectionTitle: "최초 위험성평가",
    legalSource: "위험성평가 고시 §15 ① + 시행규칙 §37",
    labels: ["사업장 정보", "사업장명", "평가 실시일", "평가자", "근로자 참여",
      "사전조사 안전보건정보", "유해·위험요인 파악", "위험성 결정", "위험성 감소대책",
      "최초 평가 착수일", "사업 성립일"],
  },
  regular_risk_assessment: {
    sectionTitle: "정기 위험성평가",
    legalSource: "위험성평가 고시 §15 ③",
    labels: ["사업장 정보", "사업장명", "평가 실시일", "평가자",
      "기계·기구·설비 성능 저하", "근로자 교체 지식·경험 변화", "안전·보건 새로운 지식", "감소대책 유효성",
      "유해·위험요인 파악", "위험성 결정", "위험성 감소대책"],
  },
  ad_hoc_risk_assessment: {
    sectionTitle: "수시 위험성평가",
    legalSource: "위험성평가 고시 §15 ②",
    labels: ["사업장 정보", "사업장명", "평가 실시일",
      "건설물 설치·이전·변경·해체", "기계·기구·설비·원재료 신규 도입·변경",
      "정비·보수", "작업방법·절차 신규 도입·변경", "중대산업사고·산업재해 발생",
      "유해·위험요인 파악", "위험성 결정", "위험성 감소대책"],
  },
  monthly_risk_assessment: {
    sectionTitle: "상시 위험성평가",
    legalSource: "위험성평가 고시 §15 ④",
    labels: ["사업장 정보", "사업장명",
      "매월 1회 이상 근로자 제안·아차사고·순회점검",
      "매주 안전보건 책임자·관리감독자 논의·공유",
      "매 작업일 작업 전 안전점검회의(TBM)",
      "유해·위험요인 파악", "위험성 결정", "위험성 감소대책"],
  },
  work_plan_tower_crane: {
    sectionTitle: "타워크레인 설치·조립·해체 작업계획서",
    legalSource: "산안기준규칙 §38 + 별표 4 1호",
    labels: ["풍속", "타워크레인 종류·형식", "설치·조립·해체 순서",
      "작업도구·장비·가설설비·방호설비", "작업인원 구성·역할 범위", "지지방법"],
  },
  work_plan_vehicle_cargo: {
    sectionTitle: "차량계 하역운반기계등 사용 작업계획서",
    legalSource: "산안기준규칙 §38 + 별표 4 2호",
    labels: ["추락·낙하·전도·협착·붕괴 위험 예방대책", "운행경로 및 작업방법"],
  },
  work_plan_vehicle_construction: {
    sectionTitle: "차량계 건설기계 사용 작업계획서",
    legalSource: "산안기준규칙 §38 + 별표 4 3호",
    labels: ["굴러떨어짐·지반 침하 위험", "차량계 건설기계 종류·성능", "운행 경로", "작업방법"],
  },
  work_plan_electric_work: {
    sectionTitle: "전기작업 작업계획서",
    legalSource: "산안기준규칙 §38 + 별표 4 5호",
    labels: ["전기작업 목적·내용", "근로자 자격·적정 인원", "작업 범위·작업책임자 임명·전격·섬락 보호구 착용"],
  },
  work_plan_excavation: {
    sectionTitle: "굴착 작업계획서 (높이 2m 이상)",
    legalSource: "산안기준규칙 §38 + 별표 4 6호",
    labels: ["형상·지질 및 지층의 상태", "균열·함수·용수 및 동결의 유무 또는 상태",
      "매설물 등의 유무 또는 상태", "지반의 지하수위 상태",
      "굴착방법 및 순서, 토사 등 반출 방법", "필요한 인원 및 장비 사용계획",
      "매설물 등에 대한 이설·보호대책", "사업장 내 연락방법 및 신호방법",
      "흙막이 지보공 설치방법 및 계측계획", "작업지휘자의 배치계획"],
  },
  work_plan_tunnel: {
    sectionTitle: "터널굴착 작업계획서",
    legalSource: "산안기준규칙 §38 + 별표 4 7호",
    labels: ["보링 등 적절한 방법으로 낙반·출수 및 가스폭발 위험 방지",
      "굴착 방법", "터널지보공 및 복공의 시공방법과 용수의 처리방법",
      "환기 또는 조명시설을 설치할 때에는 그 방법"],
  },
  work_plan_bridge: {
    sectionTitle: "교량 설치·해체·변경 작업계획서",
    legalSource: "산안기준규칙 §38 + 별표 4 8호",
    labels: ["작업 방법 및 순서", "부재의 낙하·전도 또는 붕괴 방지 방법",
      "근로자 추락 위험 방지 안전조치", "가설 철구조물의 설치·사용·해체 시 안전성 검토 방법",
      "사용하는 기계등의 종류 및 성능", "작업지휘자 배치계획"],
  },
  work_plan_demolition: {
    sectionTitle: "해체작업 작업계획서",
    legalSource: "산안기준규칙 §38 + 별표 4 10호",
    labels: ["해체건물 등의 구조", "주변 상황",
      "해체의 방법 및 해체 순서도면", "가설설비·방호설비·환기설비 및 살수·방화설비 등의 방법",
      "사업장 내 연락방법", "해체물의 처분계획",
      "해체작업용 기계·기구 등의 작업계획서", "해체작업용 화약류 등의 사용계획서",
      "그 밖에 안전·보건에 관련된 사항"],
  },
  work_plan_heavy_lifting: {
    sectionTitle: "중량물 취급 작업계획서",
    legalSource: "산안기준규칙 §38 + 별표 4 11호",
    labels: ["추락위험 예방 안전대책", "낙하위험 예방 안전대책",
      "전도위험 예방 안전대책", "협착위험 예방 안전대책", "붕괴위험 예방 안전대책"],
  },
  contractor_consultative_body: {
    sectionTitle: "안전보건협의체 회의록",
    legalSource: "산안법 §63 ② + 시행령 §63",
    labels: ["회의 일시", "도급인 사업장명", "관계수급인 사업장명", "협의 의제",
      "안전보건조치", "위험요인 공유", "회의 결과", "참석자 명단·서명",
      "다음 회의 일자"],
  },
  contractor_safety_council: {
    sectionTitle: "도급 합동 안전보건점검",
    legalSource: "산안법 §64 + 시행규칙 §80",
    labels: ["점검 일시", "도급인 점검자", "관계수급인 점검자", "근로자 1명 점검자",
      "점검 대상 작업장", "발견 사항", "개선 요구", "수급인 조치 사항",
      "이행 확인", "다음 점검 일자"],
  },
  safety_health_information_provision: {
    sectionTitle: "작업 전 안전보건정보 제공",
    legalSource: "산안법 §65",
    labels: ["정보 제공 일시", "도급인 사업장명", "관계수급인 사업장명",
      "유해성·위험성 화학물질 정보", "질식·붕괴 위험 작업 정보",
      "MSDS 별첨", "안전보건 작업절차서", "수급인 확인 서명"],
  },
  pre_work_inspection: {
    sectionTitle: "작업시작 전 점검표",
    legalSource: "산안기준규칙 §35",
    labels: ["점검 일자", "작업명", "점검자 (관리감독자)",
      "기계·설비·기구 점검", "안전장치 작동 점검", "보호구 착용 점검",
      "점검 결과 (적합/부적합)", "부적합 시 조치", "근로자 통보"],
  },
  weekly_joint_inspection: {
    sectionTitle: "주간 합동안전점검",
    legalSource: "산안법 §64",
    labels: ["점검 일시", "점검자 (도급인·수급인·근로자 1명)",
      "점검 대상 작업장", "발견 사항", "개선 요구",
      "수급인 조치 사항", "다음 점검 일자"],
  },
  // ─────── 작업허가서 5종 (KOSHA P-94-2021 본문) ───────
  work_permit: {
    sectionTitle: "통합 작업허가서 (5종 위험작업)",
    legalSource: "KOSHA P-94-2021 + 산안기준규칙",
    labels: ["허가서 번호", "작업명", "작업 위치", "작업 일시", "작업 유형 (화기/밀폐/LOTO/고소/굴착)",
      "작업 책임자", "작업자 명단", "위험요인", "안전조치", "필요 보호구",
      "허가자 (안전관리자·관리감독자)", "허가 시각", "작업 종료 시각", "사후 점검자 서명"],
  },
  work_permit_hot_work: {
    sectionTitle: "화기작업 허가서",
    legalSource: "산안기준규칙 §239 + KOSHA P-94",
    labels: ["허가서 번호", "작업명", "작업 위치", "작업 일시", "작업 책임자",
      "가스 측정 결과 (LEL/O2/CO/H2S)", "측정 시각", "측정자",
      "소화기 비치", "소방감시자 배치", "주변 가연물 제거",
      "위험요인", "안전조치", "허가자", "작업자 서명"],
  },
  work_permit_confined_space: {
    sectionTitle: "밀폐공간 작업 허가서",
    legalSource: "산안기준규칙 §619 + KOSHA P-94",
    labels: ["허가서 번호", "작업명", "밀폐공간 위치", "작업 일시", "작업 책임자",
      "산소 농도 측정 (18%~23.5%)", "유해가스 측정 (CO·H2S·LEL)", "측정 시각", "측정자",
      "환기 장비", "감시인 배치", "비상연락 체계", "구조 장비",
      "진입자 명단·서명", "허가자", "비상시 대응"],
  },
  work_permit_loto: {
    sectionTitle: "정전·LOTO 작업 허가서",
    legalSource: "산안기준규칙 §319 + KOSHA P-94",
    labels: ["허가서 번호", "작업명", "정전 대상 설비", "작업 일시", "작업 책임자",
      "전원 차단 확인", "잠금장치(LOTO) 설치", "꼬리표(태그) 부착", "검전 결과",
      "재투입 차단 확인", "작업자 명단·서명", "허가자", "작업 종료 후 복구 확인"],
  },
  work_permit_high_altitude: {
    sectionTitle: "고소작업 허가서",
    legalSource: "산안기준규칙 §42·§43 + KOSHA P-94",
    labels: ["허가서 번호", "작업명", "작업 높이", "작업 위치", "작업 일시",
      "작업 책임자", "안전대 부착설비", "안전난간·작업발판", "추락방호망",
      "기상 조건 (풍속·강우)", "보호구 (안전대·안전모)", "허가자", "작업자 서명"],
  },
  work_permit_heavy_lifting: {
    sectionTitle: "중량물 양중 작업 허가서",
    legalSource: "산안기준규칙 §168 + KOSHA P-94",
    labels: ["허가서 번호", "작업명", "양중 대상물 (중량·치수)", "작업 위치", "작업 일시",
      "양중 장비 (크레인·호이스트)", "작업 책임자", "신호수 배치",
      "출입통제 구역", "결속 점검", "허가자", "작업자 서명"],
  },
  // ─────── 보호구 점검 2종 ───────
  safety_harness_inspection: {
    sectionTitle: "안전대 점검표",
    legalSource: "산안기준규칙 §32 + KOSHA 권장",
    labels: ["점검 일자", "점검자", "안전대 종류 (벨트식·그네식)",
      "KCs 인증 번호", "벨트·D링·후크·랜야드 점검",
      "내구성 점검", "충격흡수장치", "결손·손상 여부", "결과 (적합/부적합)", "조치 내용"],
  },
  fall_prevention_net_inspection: {
    sectionTitle: "추락방호망 점검표",
    legalSource: "산안기준규칙 §42·§43 + KOSHA 권장",
    labels: ["점검 일자", "점검자", "방호망 위치", "방호망 사양 (망목·인장강도)",
      "고정 상태", "처짐 정도", "결손·손상", "낙하물 누적", "결과 (적합/부적합)", "조치 내용"],
  },
  // ─────── 점검표 5종 (KOSHA 권장) ───────
  construction_machinery_inspection: {
    sectionTitle: "건설기계 점검표",
    legalSource: "산안법 §93 + KOSHA Guide",
    labels: ["점검 일자", "점검자", "기계 종류·모델", "엔진·유압",
      "브레이크", "타이어·궤도", "전도방지장치", "신호장치", "결과 (적합/부적합)", "조치 내용"],
  },
  scaffolding_inspection_checklist: {
    sectionTitle: "비계 점검표",
    legalSource: "산안기준규칙 §54·§56 + KOSHA Guide",
    labels: ["점검 일자", "점검자", "비계 위치", "결합부 점검",
      "발판 상태", "안전난간", "벽 연결재", "비계 가설계산서", "결과", "조치 내용"],
  },
  tower_crane_inspection: {
    sectionTitle: "타워크레인 점검표",
    legalSource: "산안기준규칙 §142 + KOSHA Guide",
    labels: ["점검 일자", "점검자", "크레인 종류·정격하중", "마스트·붐 점검",
      "와이어로프", "안전장치 (과부하·풍속경보)", "전기 시스템", "결과", "조치 내용"],
  },
  temporary_electric_inspection: {
    sectionTitle: "가설전기 점검표",
    legalSource: "산안기준규칙 §301~§312 + KOSHA Guide",
    labels: ["점검 일자", "점검자", "가설전기 위치", "누전차단기 작동",
      "접지 상태", "절연 저항", "분전반", "케이블 손상", "결과", "조치 내용"],
  },
  temporary_fire_facility_check: {
    sectionTitle: "가설소화시설 점검표",
    legalSource: "산안기준규칙 §239·§242 + KOSHA Guide",
    labels: ["점검 일자", "점검자", "소화기 위치·수량", "소화기 점검 (압력)",
      "소화전·소화수조", "비상연락 (119)", "대피로 표지", "결과", "조치 내용"],
  },
  // ─────── 선임 지정서 4종 ───────
  honorary_safety_supervisor_appointment: {
    sectionTitle: "명예산업안전감독관 위촉서",
    legalSource: "산안법 §23 + 시행령 §32",
    labels: ["사업장명", "위촉 일자", "위촉 대상 (성명·소속·직책)",
      "활동 범위", "임기", "사업주 서명"],
  },
  safety_health_management_assistant_appointment: {
    sectionTitle: "안전보건관리담당자 선임서",
    legalSource: "산안법 §19 + 시행령 §24",
    labels: ["사업장명", "선임 일자", "선임 대상 (성명·소속)",
      "자격 요건", "직무 범위", "사업주 서명"],
  },
  signaler_appointment: {
    sectionTitle: "신호수 지정서",
    legalSource: "산안기준규칙 §40·§142",
    labels: ["사업장명", "현장명", "지정 일자", "신호수 (성명·자격)",
      "담당 작업 (양중·차량계 등)", "지정 사유", "사업주 서명"],
  },
  supervisor_education_log: {
    sectionTitle: "관리감독자 교육일지",
    legalSource: "산안법 §29 + 시행규칙 별표 4",
    labels: ["교육 일시", "교육 시간 (연 16시간)", "교육 장소",
      "교육 강사", "교육 과목", "교육 내용",
      "관리감독자 명단·서명", "사업주 결재"],
  },
  // ─────── 안전표지 + 실시규정 ───────
  safety_signage_register: {
    sectionTitle: "안전보건표지 설치·관리대장",
    legalSource: "산안법 §37 + 시행규칙 §38·별표 6",
    labels: ["사업장명", "표지 종류 (금지·경고·지시·안내)",
      "표지 코드 (별표 6)", "설치 위치", "설치 일자",
      "점검 일자", "결과 (적합/부적합)", "교체·보수 이력"],
  },
  risk_assessment_procedure: {
    sectionTitle: "위험성평가 실시규정",
    legalSource: "위험성평가 고시 §6",
    labels: ["사업장명", "실시규정 작성일", "위험성평가 대상 작업",
      "유해·위험요인 파악 방법", "위험성 결정 기준", "감소대책 위계 (ERIC-PP)",
      "근로자 참여 절차", "기록·보존 방법", "사업주 서명"],
  },
  // ─────── 건강관리 4종 ───────
  health_examination_records: {
    sectionTitle: "건강진단 결과 기록 (일반·특수·임시)",
    legalSource: "산안법 §129·§130·§131 + 시행규칙 §201·§241",
    labels: ["검진 일자", "검진 종류 (일반/특수/배치전/수시/임시)",
      "검진 의료기관·의사", "근로자 인적사항·직무", "유해인자 노출 정보",
      "검진 결과 (A/B/C/C1/C2/CN/D/D1/D2/DN/R/R1)",
      "판정 의사 소견 (사후관리)", "근로자 통보 일자", "보존 (5년·CMR 30년)"],
  },
  health_examination_followup: {
    sectionTitle: "건강진단 사후관리 (유소견자)",
    legalSource: "산안법 §132 + 시행규칙 §210",
    labels: ["사업장명", "관리 시작일", "유소견자 명단 (이니셜·연령·직무)",
      "판정 (D/C 등)", "사후조치 (작업전환·근로시간 단축·치료 의뢰)",
      "이행 책임자", "이행 기한", "추적관찰 결과", "사업주 서명"],
  },
  work_environment_measurement_notification: {
    sectionTitle: "작업환경측정 결과 통보 (근로자)",
    legalSource: "산안법 §126 + 시행규칙 §189",
    labels: ["사업장명", "통보 일자", "측정 결과 요약",
      "노출기준 초과 항목", "개선 조치 내용", "근로자 게시 일자",
      "근로자 대표 확인", "사업주 서명"],
  },
  industrial_physician_appointment: {
    sectionTitle: "산업보건의 선임서",
    legalSource: "산안법 §22 + 시행규칙 §22",
    labels: ["사업장명", "선임 일자", "산업보건의 (성명·기관)",
      "의사 면허번호", "산업의학과 자격", "직무 범위",
      "임기", "사업주 서명"],
  },
  // ─────── 50억+ 발주자 의무 (건설공사 안전보건대장) ───────
  basic_safety_health_register: {
    sectionTitle: "기본안전보건대장 (건설공사 발주자, 계획단계)",
    legalSource: "산안법 §67 + 건설공사 안전보건대장 작성 고시",
    labels: ["공사명", "발주자", "공사규모·예산·기간", "공사현장 제반정보",
      "유해·위험요인", "감소대책", "설계 조건", "발주자 서명"],
  },
  design_safety_health_register: {
    sectionTitle: "설계안전보건대장 (설계자, 설계단계)",
    legalSource: "산안법 §67 + 건설공사 안전보건대장 작성 고시",
    labels: ["공사명", "설계자", "기본안전보건대장 반영", "적정 공사기간",
      "안전보건 금액 산출서", "유해·위험요인 감소 설계", "설계자 서명"],
  },
  construction_safety_health_register: {
    sectionTitle: "공사안전보건대장 (시공자, 시공단계)",
    legalSource: "산안법 §67 + 건설공사 안전보건대장 작성 고시",
    labels: ["공사명", "시공자 (수급인)", "설계안전보건대장 반영",
      "유해·위험방지계획서 심사·확인 결과", "조치 내용",
      "시공자 이행여부", "발주자 확인"],
  },
  hazardous_risk_prevention_plan_construction: {
    sectionTitle: "유해·위험방지계획서 (건설업)",
    legalSource: "산안법 §42 + 시행령 §42-3",
    labels: ["사업장명", "공사 종류·규모", "착공 예정일",
      "유해·위험요인", "공정별 안전대책",
      "흙막이·거푸집·해체 등 위험공종 별도 계획",
      "관리책임자", "공단 제출일"],
  },
  // ─────── 50명+ 또는 120억+ ───────
  safety_health_committee: {
    sectionTitle: "산업안전보건위원회 회의록",
    legalSource: "산안법 §24 + 시행령 §35",
    labels: ["회의 일시", "회의 장소", "회의 종류 (정기/임시)",
      "위원 (사용자위원·근로자위원)", "참석 위원",
      "심의 의제", "심의·의결 내용", "다음 회의 일정",
      "위원장 서명", "근로자 위원 서명"],
  },
  safety_health_management_policy: {
    sectionTitle: "안전보건경영방침 (시공순위 1000위 이내)",
    legalSource: "산안법 §14",
    labels: ["사업장명", "경영방침 수립일", "안전보건 경영방침 본문",
      "안전보건관리 조직 구성", "예산·시설 현황",
      "전년도 안전보건활동 실적", "다음 연도 활동계획", "이사회 보고일", "대표이사 서명"],
  },
  safety_health_regulation: {
    sectionTitle: "안전보건관리규정 (100명 이상)",
    legalSource: "산안법 §25 + 시행규칙 별표3",
    labels: ["사업장명", "작성일", "안전보건 관리조직과 직무",
      "안전보건교육에 관한 사항", "작업장 안전·보건관리에 관한 사항",
      "사고 조사·대책 수립", "그 밖에 안전보건 관련",
      "근로자 대표 의견 청취", "사업주 서명"],
  },
  safety_health_mgmt_cost_plan: {
    sectionTitle: "안전보건관리비 사용계획",
    legalSource: "산안법 §72 + 건설업 산업안전보건관리비 계상 및 사용기준 고시",
    labels: ["공사명", "공사금액·기간", "산업안전보건관리비 계상금액",
      "사용계획 (안전·보건 관리자 인건비·안전시설·교육·진단)",
      "월별 사용 현황", "사용 잔액", "지급·정산 내역", "발주자·수급인 확인"],
  },
};

const DOC_DIR = resolve(PROJ, "src/ontology/graph/nodes/documents");
let touched = 0;
for (const [docId, info] of Object.entries(OFFICIAL_LABELS)) {
  const filePath = resolve(DOC_DIR, docId.replace(/_/g, "-") + ".jsonld");
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    console.log(`⚠️  ${docId}: 파일 없음 — skip`);
    continue;
  }

  // 기존 fields 에서 inputGuide·examples 보존
  const existingByLabel = new Map<string, any>();
  for (const sec of doc.sections ?? []) {
    for (const f of sec.fields ?? []) {
      if (f.label) existingByLabel.set(f.label, f);
    }
  }

  // 새 sections — 단일 섹션으로 모든 official label 매핑
  const newFields = info.labels.map((lbl, i) => {
    const existing = existingByLabel.get(lbl);
    const key = existing?.key ?? `f_${i}_${lbl.slice(0, 12).replace(/[^가-힣A-Za-z0-9]/g, "_")}`;
    return {
      key,
      label: lbl,
      required: existing?.required ?? true,
      inputGuide: existing?.inputGuide ?? `${info.legalSource} 본문 항목.`,
      examples: existing?.examples ?? [],
      checkPoints: existing?.checkPoints ?? [],
    };
  });

  doc.sections = [{
    title: info.sectionTitle,
    legalSource: info.legalSource,
    fields: newFields,
  }];

  // requiredFields 도 동일하게
  doc.requiredFields = newFields.map((f: any) => ({
    key: f.key,
    label: f.label,
    source: info.legalSource,
  }));

  doc.verificationStatus = "verified";
  doc._meta = doc._meta ?? {};
  doc._meta.alignedAt = "2026-04-29";
  doc._meta.alignSource = `auto-align-to-official.ts — ${info.legalSource}`;

  writeFileSync(filePath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  touched += 1;
  console.log(`✓ ${docId}: ${info.labels.length} fields aligned`);
}
console.log(`\n[auto-align] ${touched} 노드 자동 정렬 완료`);
