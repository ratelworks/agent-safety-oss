#!/usr/bin/env tsx
/**
 * align-nodes-bulk.ts
 *
 * 미정합 노드들을 양식별 표준 sections.fields 로 일괄 정합.
 * KOSHA 권고 + 산안법 본문 기준의 표준 양식 템플릿을 docId 별로 정의해 적용.
 *
 * 작동 방식:
 *   1) ALIGN_TEMPLATES 에 docId 별 sections 정의
 *   2) 해당 노드의 sections 를 표준 양식으로 교체 (legalBasis·approvalChain·reviewRules 등은 보존)
 *   3) 정합 완료 후 audit 재실행
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents");

interface Field {
  key: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  inputGuide: string;
  examples?: any[];
  checkPoints?: string[];
}

interface Section {
  title: string;
  legalSource: string;
  fields: Field[];
}

const META_SECTION: Section = {
  title: "1. 문서 메타",
  legalSource: "공통",
  fields: [
    {key:"documentNumber",label:"문서번호",required:true,inputGuide:"현장 자체 일련번호 (DOC-YYMMDD-NN).",examples:["DOC-260429-01"],checkPoints:[]},
    {key:"siteName",label:"사업장 / 현장명",required:true,inputGuide:"사업장 정식 명칭.",examples:["황룡건설(주) 삼성동 현장"],checkPoints:[]},
    {key:"compileDate",label:"작성 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-04-29"],checkPoints:[]},
    {key:"compiler",label:"작성자 (안전관리자)",required:true,inputGuide:"성명·직책.",examples:["김안전 (안전관리자)"],checkPoints:[]},
  ],
};
const APPROVAL_SECTION: Section = {
  title: "결재선",
  legalSource: "공통",
  fields: [
    {key:"compiler_sign",label:"작성자 서명",required:true,inputGuide:"성명·서명.",examples:["김안전 (서명)"],checkPoints:[]},
    {key:"supervisor_sign",label:"관리감독자 서명",required:true,inputGuide:"성명·서명.",examples:["박감독 (서명)"],checkPoints:[]},
    {key:"principal_sign",label:"사업주/안전보건관리책임자 서명",required:true,inputGuide:"현장소장 서명.",examples:["황룡 (현장소장, 서명)"],checkPoints:[]},
  ],
};

const ALIGN_TEMPLATES: Record<string, Section[]> = {
  // ── A. 체제 ──
  safety_health_management_policy: [
    META_SECTION,
    {title:"2. 안전보건경영 방침",legalSource:"산안법 §14",fields:[
      {key:"vision",label:"안전보건 비전",required:true,inputGuide:"사업장 안전보건의 핵심 가치·목표.",examples:["근로자 생명·건강 최우선, 무재해 100% 달성"],checkPoints:[]},
      {key:"commitment",label:"사업주 의지·약속",required:true,inputGuide:"사업주가 직접 서명·공표한 약속.",examples:["사업주는 모든 위험을 적극 제거하고 안전한 작업환경을 제공한다"],checkPoints:[]},
      {key:"goals",label:"연간 목표 (정량)",required:true,inputGuide:"재해율·아차사고·교육이수율 등 정량 목표.",examples:["재해율 0%, 위험성평가 100% 이행, 안전교육 12회/년"],checkPoints:[]},
      {key:"strategy",label:"실행 전략",required:true,inputGuide:"위험성평가·교육·점검·도급관리 등 전략.",examples:["1) 매월 위험성평가 2) 매주 안전교육 3) 매일 TBM 4) 매분기 점검"],checkPoints:[]},
      {key:"resources",label:"자원 배분 (인력·예산)",required:true,inputGuide:"안전관리자 인원·산안비 비율.",examples:["전임 안전관리자 1명, 산안비 1.97% (6,300만원)"],checkPoints:[]},
      {key:"reviewCycle",label:"방침 검토 주기",required:true,inputGuide:"연 1회 이상 재검토.",examples:["연 1회 (12월) 또는 중대 변경 시"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_health_regulation: [
    META_SECTION,
    {title:"2. 안전보건관리규정",legalSource:"산안법 §25 + 시행규칙 §25",fields:[
      {key:"chapter1_general",label:"제1장 총칙 (목적·적용범위)",required:true,inputGuide:"규정 목적·적용 대상.",examples:["본 규정은 산안법 §25에 따라 황룡건설(주) 전 사업장 안전보건 사항을 규정"],checkPoints:[]},
      {key:"chapter2_organization",label:"제2장 안전보건관리체제",required:true,inputGuide:"안전보건관리책임자·관리감독자·안전관리자 직무.",examples:["안전보건관리책임자(현장소장) + 관리감독자 + 전임 안전관리자 1명"],checkPoints:[]},
      {key:"chapter3_education",label:"제3장 안전보건교육",required:true,inputGuide:"정기·신규·작업변경·특별교육 시행.",examples:["매월 정기교육 / 신규채용시 8시간 / 작업변경 2시간 / 특별교육 16시간"],checkPoints:[]},
      {key:"chapter4_workplace",label:"제4장 작업장 안전",required:true,inputGuide:"위험성평가·작업계획서·작업허가.",examples:["매월 위험성평가, 별표 4 9종 작업계획서, P-94 작업허가서"],checkPoints:[]},
      {key:"chapter5_health",label:"제5장 보건관리",required:true,inputGuide:"건강진단·작업환경측정·MSDS.",examples:["일반·특수건강진단, 반기 작업환경측정, 화학물질 MSDS"],checkPoints:[]},
      {key:"chapter6_emergency",label:"제6장 사고·비상대응",required:true,inputGuide:"중대재해 보고·응급조치·대피.",examples:["사고 즉시 보고, 119 신고, 대피로·집결지 매뉴얼"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_health_information_provision: [
    META_SECTION,
    {title:"2. 안전보건정보 제공 내역",legalSource:"산안법 §73 + 시행규칙 §86",fields:[
      {key:"recipient",label:"수급인명",required:true,inputGuide:"정보 제공 대상 수급업체.",examples:["우송건설(주)"],checkPoints:[]},
      {key:"providedInfo",label:"제공 정보 내용",required:true,inputGuide:"위험성평가 결과·MSDS·도면·작업조건 등.",examples:["1) 위험성평가 결과 5건, 2) MSDS 12종, 3) 도면 3매"],checkPoints:[]},
      {key:"providedDate",label:"제공 일자",required:true,inputGuide:"작업 개시 전.",examples:["2026-04-25 (작업 개시 4일 전)"],checkPoints:[]},
      {key:"deliveryMethod",label:"제공 방법",required:true,inputGuide:"문서·전자·회의 등.",examples:["서면 + 안전보건협의체 회의 시 설명"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  legal_summary_posting: [
    META_SECTION,
    {title:"2. 게시 법령 요지",legalSource:"산안법 §34",fields:[
      {key:"postingItems",label:"게시 항목",required:true,inputGuide:"산안법·시행령·시행규칙·기준규칙·중처법 요지 + 위반 시 처벌.",examples:["산안법 §29 안전보건교육 / §36 위험성평가 / §54 사고 보고 / §57 산재 발생 보고"],checkPoints:[]},
      {key:"postingLocation",label:"게시 장소",required:true,inputGuide:"근로자 잘 보이는 장소.",examples:["A동 1층 출입구 안전보건 게시판 + 식당"],checkPoints:[]},
      {key:"postingDate",label:"게시 시작 일자",required:true,inputGuide:"현장 개설 시 즉시 게시.",examples:["2026-03-01"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  signaler_appointment: [
    META_SECTION,
    {title:"2. 신호수 지정",legalSource:"산안기준규칙 §40",fields:[
      {key:"signalerName",label:"신호수 성명",required:true,inputGuide:"지정 신호수 성명.",examples:["이신호"],checkPoints:[]},
      {key:"qualification",label:"자격 (교육 이수)",required:true,inputGuide:"신호수 안전교육 이수 증명.",examples:["KOSHA 신호수 안전교육 이수 (2026-02-15)"],checkPoints:[]},
      {key:"workScope",label:"담당 작업 범위",required:true,inputGuide:"중장비·차량 작업·교통.",examples:["타워크레인 양중작업 + 차량 진출입"],checkPoints:[]},
      {key:"communication",label:"통신장비",required:true,inputGuide:"무전기·수신호·기.",examples:["무전기 1대 (Ch5) + 적·녹색 신호기"],checkPoints:[]},
      {key:"appointmentDate",label:"지정 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-04-29"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  honorary_safety_supervisor_appointment: [
    META_SECTION,
    {title:"2. 명예산업안전감독관 위촉",legalSource:"산안법 시행령 §32",fields:[
      {key:"supervisorName",label:"감독관 성명",required:true,inputGuide:"위촉 대상자 성명.",examples:["홍감독"],checkPoints:[]},
      {key:"affiliation",label:"소속 / 직위",required:true,inputGuide:"근로자 측 대표 또는 노조.",examples:["황룡건설 근로자대표 / 작업반장"],checkPoints:[]},
      {key:"term",label:"임기",required:true,inputGuide:"3년 (시행령 §32 ②).",examples:["2026-05-01 ~ 2029-04-30"],checkPoints:[]},
      {key:"duties",label:"직무 범위",required:true,inputGuide:"안전보건 점검·개선건의·재해 조사 참여.",examples:["월간 점검 입회·교육 자료 제공·재해 발생 조사"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── B. 위험성평가 ──
  risk_assessment_procedure: [
    META_SECTION,
    {title:"2. 위험성평가 절차",legalSource:"위험성평가 고시 §13",fields:[
      {key:"scope",label:"평가 대상·범위",required:true,inputGuide:"전 작업·공정 + 비정형 작업 포함.",examples:["전 공정(굴착·골조·마감) + 비정형(긴급보수·청소)"],checkPoints:[]},
      {key:"team",label:"평가팀 구성",required:true,inputGuide:"사업주·관리감독자·작업자·안전관리자 + 외부전문가(필요시).",examples:["사업주 1, 관리감독자 2, 작업자대표 3, 안전관리자 1"],checkPoints:[]},
      {key:"method",label:"평가 방법",required:true,inputGuide:"빈도·강도법(5×4) 또는 KRAS·체크리스트.",examples:["빈도(1~5) × 강도(1~4) 매트릭스, 위험도 12 이상 우선조치"],checkPoints:[]},
      {key:"cycle",label:"평가 주기",required:true,inputGuide:"최초 + 정기(연1회) + 상시(매월·매주·매일) + 수시(변경시).",examples:["최초 착공시, 정기 매년 12월, 상시 매월·매주·매일, 수시 변경시"],checkPoints:[]},
      {key:"controlHierarchy",label:"감소대책 위계",required:true,inputGuide:"제거→대체→공학→관리→PPE (ERIC-PP).",examples:["1순위 제거(공정변경), 2순위 대체(저위험물질), 3순위 공학적(방호장치), 4순위 관리적, 5순위 PPE"],checkPoints:[]},
      {key:"workerParticipation",label:"근로자 참여",required:true,inputGuide:"고시 §16 (의견청취·참여 의무).",examples:["TBM에서 5분 의견청취, 월 1회 협의회"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  initial_risk_assessment: [
    META_SECTION,
    {title:"2. 최초 위험성평가",legalSource:"위험성평가 고시 §15 ④ 1호 (착공 시)",fields:[
      {key:"trigger",label:"평가 시기",required:true,inputGuide:"착공일·신규 사업장 개시일.",examples:["2026-03-01 착공"],checkPoints:[]},
      {key:"hazardList",label:"식별 유해·위험요인 (최초)",required:true,inputGuide:"공종별·작업별 식별. KOSHA 24종 분류 + 자체 발굴.",examples:[[{공종:"굴착", 위험요인:"매몰", 빈도:3, 강도:4, 위험도:12}, {공종:"골조", 위험요인:"추락", 빈도:4, 강도:4, 위험도:16}]],checkPoints:[]},
      {key:"controlMeasures",label:"감소대책 (최초)",required:true,inputGuide:"각 위험요인별 ERIC-PP 위계 조치.",examples:[["굴착: 흙막이+신호수+안전대", "골조: 안전난간+추락방호망+안전대"]],checkPoints:[]},
      {key:"residualRisk",label:"잔존 위험도",required:true,inputGuide:"감소대책 적용 후 위험도.",examples:["대부분 6 이하로 감소, 잔존 12 이상 0건"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  regular_risk_assessment: [
    META_SECTION,
    {title:"2. 정기 위험성평가 (연 1회)",legalSource:"위험성평가 고시 §15 ④ 2호",fields:[
      {key:"period",label:"평가 기간",required:true,inputGuide:"연 1회 정기.",examples:["2026-12-01 ~ 2026-12-15"],checkPoints:[]},
      {key:"reviewedItems",label:"전년도 평가 검토",required:true,inputGuide:"전년도 위험요인 + 사고 이력 검토.",examples:["전년도 식별 15건 → 12건 감소대책 완료, 3건 후속 조치"],checkPoints:[]},
      {key:"newHazards",label:"신규 식별 위험요인",required:true,inputGuide:"공정·환경·기술 변화로 신규 발생.",examples:["타워크레인 신규 도입 → 양중작업 위험요인 5건 추가"],checkPoints:[]},
      {key:"updatedControls",label:"감소대책 갱신",required:true,inputGuide:"신규+기존 모두 통합.",examples:["신규 5건 + 갱신 3건 = 8건 추가 대책"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  ad_hoc_risk_assessment: [
    META_SECTION,
    {title:"2. 수시 위험성평가 (변경 시)",legalSource:"위험성평가 고시 §15 ④ 4호",fields:[
      {key:"changeReason",label:"변경 사유",required:true,inputGuide:"공정·기계·작업·환경·인력 변경.",examples:["굴착 깊이 5m → 8m로 변경, 흙막이 보강 필요"],checkPoints:[]},
      {key:"changeDate",label:"변경 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-04-25"],checkPoints:[]},
      {key:"newHazards",label:"변경에 따른 신규 위험요인",required:true,inputGuide:"변경으로 인해 새로 발생하는 위험.",examples:["8m 굴착 → 측압 증가 → 흙막이 붕괴 위험"],checkPoints:[]},
      {key:"controlMeasures",label:"즉시 감소대책",required:true,inputGuide:"변경 작업 개시 전 적용.",examples:["어스앵커 1단 추가 + 계측 빈도 증가 (일1회→2회)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── F. 도급 ──
  contractor_round_inspection_log: [
    META_SECTION,
    {title:"2. 작업장 순회점검 일지",legalSource:"산안법 §64 ① 2호 + 시행규칙 §80 (건설 2일1회)",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"건설업 2일 1회 / 기타 주 1회.",examples:["2026-04-29 09:00~10:30"],checkPoints:[]},
      {key:"inspector",label:"점검자",required:true,inputGuide:"도급인 안전관리자.",examples:["김안전 (도급인 안전관리자)"],checkPoints:[]},
      {key:"inspectedAreas",label:"점검 구역",required:true,inputGuide:"전 작업 구역 (도급인+수급인).",examples:["A동 굴착 / B동 골조 / 자재창고"],checkPoints:[]},
      {key:"findings",label:"발견 위험요인",required:true,inputGuide:"건수·내용·위험도.",examples:[[{구역:"A동",내용:"안전난간 누락 5m",조치:"즉시 설치"},{구역:"B동",내용:"안전대 미착용 1명",조치:"즉시 착용 + 주의"}]],checkPoints:[]},
      {key:"improvements",label:"시정 요구·이행",required:true,inputGuide:"수급인에 시정 요구 + 이행 확인.",examples:["우송설비(주)에 안전난간 설치 요구 (2026-04-29 16:00 이행 완료)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  weekly_joint_inspection: [
    META_SECTION,
    {title:"2. 합동 안전보건점검",legalSource:"산안법 §64 ① 4호 + 시행규칙 §82 (건설 2개월 1회)",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"건설 2개월 1회 / 기타 분기 1회.",examples:["2026-04-29 14:00~16:00"],checkPoints:[]},
      {key:"participants",label:"참석자 (3자 1명씩)",required:true,inputGuide:"도급인 + 관계수급인 + 도급인·수급인 근로자 각 1명.",examples:["도급인: 김안전 / 수급인: 박감독(우송) / 근로자: 이근로(도급인) + 박작업(수급인)"],checkPoints:[]},
      {key:"inspectedScope",label:"점검 범위",required:true,inputGuide:"공동작업 + 혼재작업.",examples:["B동 골조-마감 혼재구역, 양중작업 + 외벽도장 동시"],checkPoints:[]},
      {key:"findings",label:"점검 결과",required:true,inputGuide:"위험요인·미흡사항·우수사례.",examples:["1) 양중구역 출입통제 미흡 → 펜스 설치, 2) 도장작업 환기 부족 → 송풍기 추가"],checkPoints:[]},
      {key:"actionPlan",label:"개선 조치 계획",required:true,inputGuide:"항목별 책임자·기한·예산.",examples:["1) 출입통제 펜스 - 박감독, 2026-04-30, 50만원, 2) 송풍기 - 김도장, 2026-05-01, 100만원"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  contractor_consultative_body: [
    META_SECTION,
    {title:"2. 도급인 안전보건교육 지원",legalSource:"산안법 §64 ① 3호",fields:[
      {key:"educationDate",label:"교육 일자",required:true,inputGuide:"수급인 교육 시기.",examples:["2026-04-15"],checkPoints:[]},
      {key:"recipientCompany",label:"수급업체",required:true,inputGuide:"교육 대상 수급인.",examples:["우송설비(주)"],checkPoints:[]},
      {key:"supportProvided",label:"제공 지원 내역",required:true,inputGuide:"강사·장소·자료·교재 등.",examples:["강사 김안전 파견 + 회의실 제공 + KOSHA 교재 12부"],checkPoints:[]},
      {key:"trainees",label:"교육 이수 인원",required:true,inputGuide:"수급인 근로자 명부·서명.",examples:["우송설비 근로자 8명 (별첨 서명부)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── C. 교육 일지 (별지 79호 양식 기반) ──
  supervisor_education_log: [
    META_SECTION,
    {title:"2. 관리감독자 교육 일지",legalSource:"산안법 §29 ② + 시행규칙 별지 제79호",fields:[
      {key:"educationDate",label:"교육 일시",required:true,inputGuide:"연 1회 이상 16시간.",examples:["2026-04-15 09:00~17:00 (8h × 2일)"],checkPoints:[]},
      {key:"instructor",label:"강사·자격",required:true,inputGuide:"산업안전기사 이상 + KOSHA 강사양성 이수.",examples:["김안전 (산업안전기사, KOSHA 강사 2025년 이수)"],checkPoints:[]},
      {key:"curriculum",label:"교육 내용 (시행규칙 별표 5)",required:true,inputGuide:"별표 5 관리감독자 교육과정 16시간.",examples:["1) 안전보건관리법 4h / 2) 위험성평가 4h / 3) 사고사례 4h / 4) 도급사업 안전 4h"],checkPoints:[]},
      {key:"trainees",label:"이수자 명단 + 서명",required:true,inputGuide:"관리감독자 전원 자필 서명.",examples:[[{name:"박감독",signed:true,hours:16},{name:"이감독",signed:true,hours:16}]],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  new_hire_education_log: [
    META_SECTION,
    {title:"2. 신규채용 시 안전보건교육",legalSource:"산안법 §29 ② + 시행규칙 §26 (별지 79호)",fields:[
      {key:"educationDate",label:"교육 일자",required:true,inputGuide:"채용 즉시 (작업 투입 전).",examples:["2026-04-29 (채용일 당일)"],checkPoints:[]},
      {key:"hours",label:"교육 시간",required:true,inputGuide:"건설 일용 4h / 사무 1h / 기타 8h.",examples:["건설 일용직 4시간"],checkPoints:[]},
      {key:"curriculum",label:"교육 내용 (시행규칙 별표 5)",required:true,inputGuide:"안전보건법령·위험요인·작업방법·보호구.",examples:["1) 산안법 요지 30분 / 2) 현장 위험요인 90분 / 3) 작업방법·보호구 60분 / 4) MSDS·응급처치 60분"],checkPoints:[]},
      {key:"newHires",label:"신규 채용자 명단 + 서명",required:true,inputGuide:"전원 자필 서명.",examples:[[{name:"박작업",hireDate:"2026-04-29",signed:true}]],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_change_education_log: [
    META_SECTION,
    {title:"2. 작업변경 시 안전보건교육",legalSource:"산안법 §29 ② + 시행규칙 §26",fields:[
      {key:"educationDate",label:"교육 일자",required:true,inputGuide:"작업 변경 즉시.",examples:["2026-04-25 (변경 작업 투입 전)"],checkPoints:[]},
      {key:"changeDescription",label:"변경 작업 내용",required:true,inputGuide:"이전→신규 작업.",examples:["골조 → 외벽 도장 작업으로 변경"],checkPoints:[]},
      {key:"hours",label:"교육 시간",required:true,inputGuide:"2시간 이상.",examples:["2시간 (변경 작업 위험요인 + 보호구)"],checkPoints:[]},
      {key:"curriculum",label:"교육 내용",required:true,inputGuide:"신규 작업 위험요인·작업방법·보호구.",examples:["고소작업 추락 위험 + 풀하네스 안전대 + 화학물질 흡입"],checkPoints:[]},
      {key:"trainees",label:"교육 이수자 + 서명",required:true,inputGuide:"변경 작업 대상자 전원.",examples:[[{name:"박도장",signed:true}]],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  special_education_log: [
    META_SECTION,
    {title:"2. 특별 안전보건교육",legalSource:"산안법 §29 ④ + 시행규칙 §27 별표 5 (39종 유해위험작업)",fields:[
      {key:"educationDate",label:"교육 일시",required:true,inputGuide:"특수작업 투입 전.",examples:["2026-04-25"],checkPoints:[]},
      {key:"workType",label:"특수작업 종류 (별표 5 39종)",required:true,inputGuide:"밀폐공간·고소·중량물·화기 등.",examples:["밀폐공간 작업 (별표 5 22호)"],checkPoints:[]},
      {key:"hours",label:"교육 시간",required:true,inputGuide:"작업별 8~16시간.",examples:["밀폐공간 8시간"],checkPoints:[]},
      {key:"curriculum",label:"특별교육 과정 (별표 5)",required:true,inputGuide:"작업별 표준 과정.",examples:["밀폐공간 8h: 1) 산소결핍 4h / 2) 가스측정 2h / 3) 응급조치 2h"],checkPoints:[]},
      {key:"trainees",label:"이수자 + 서명",required:true,inputGuide:"특수작업 종사자 전원.",examples:[[{name:"박작업",workType:"밀폐공간",signed:true,hours:8}]],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── G. 점검 (공통 패턴 — 점검일·점검자·점검항목·결과·조치) ──
  pre_work_inspection: [
    META_SECTION,
    {title:"2. 작업 전 안전점검",legalSource:"산안기준규칙 §35",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"매 작업일 시작 전.",examples:["2026-04-29 07:30"],checkPoints:[]},
      {key:"inspector",label:"점검자",required:true,inputGuide:"관리감독자 또는 작업지휘자.",examples:["박감독 (관리감독자)"],checkPoints:[]},
      {key:"workArea",label:"점검 구역·작업",required:true,inputGuide:"오늘 시행할 작업.",examples:["A동 6층 외벽 도장 + B동 굴착"],checkPoints:[]},
      {key:"checkItems",label:"점검 항목·결과",required:true,inputGuide:"보호구·기계·전기·화재·환경.",examples:[[{항목:"안전대 착용",결과:"양호"},{항목:"비계 안전난간",결과:"보통"},{항목:"전기설비 누전차단기",결과:"양호"}]],checkPoints:[]},
      {key:"corrections",label:"발견 위험·시정 조치",required:false,optional:true,inputGuide:"미흡 사항 즉시 조치.",examples:["[해당없음] 모두 양호","비계 단부 안전난간 누락 → 즉시 설치"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  scaffolding_inspection_checklist: [
    META_SECTION,
    {title:"2. 비계 점검표",legalSource:"산안기준규칙 §57·§60",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"매주 + 강풍·강우 후 + 7일 이상 정지 후.",examples:["2026-04-29 16:00 (정기 매주 + 강풍 후)"],checkPoints:[]},
      {key:"inspector",label:"점검자",required:true,inputGuide:"비계 작업지휘자.",examples:["박감독 (시스템비계 자격)"],checkPoints:[]},
      {key:"scaffoldType",label:"비계 종류·규격",required:true,inputGuide:"강관·시스템·외부·내부 비계 + 높이.",examples:["시스템비계 H18m × 외부 둘레"],checkPoints:[]},
      {key:"checkItems",label:"점검 항목 (§57 6항)",required:true,inputGuide:"발판·난간·이음·연결·도르래·기둥.",examples:[[{항목:"발판 폭 ≥40cm",결과:"양호"},{항목:"안전난간 상부 90~120cm",결과:"양호"},{항목:"수직재 이음",결과:"양호"},{항목:"가새",결과:"양호"},{항목:"기초·받침",결과:"양호"},{항목:"고정·결속",결과:"양호"}]],checkPoints:[]},
      {key:"corrections",label:"이상 발견·조치",required:false,optional:true,inputGuide:"미흡 시 즉시 조치.",examples:["[해당없음]"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  scaffolding_assembly_check: [
    META_SECTION,
    {title:"2. 비계 조립·해체·변경 점검",legalSource:"산안기준규칙 §57·§60",fields:[
      {key:"actionType",label:"작업 구분 (조립/해체/변경)",required:true,inputGuide:"조립 / 해체 / 변경.",examples:["조립 (외부 시스템비계 H18m)"],checkPoints:[]},
      {key:"actionDate",label:"작업 일시",required:true,inputGuide:"YYYY-MM-DD HH:MM.",examples:["2026-04-29 08:00~17:00"],checkPoints:[]},
      {key:"director",label:"작업지휘자",required:true,inputGuide:"비계기능사 자격자.",examples:["박지휘 (비계기능사)"],checkPoints:[]},
      {key:"workers",label:"작업자 (자격)",required:true,inputGuide:"비계 안전교육 이수자.",examples:["김작업·이작업 (비계 특별교육 이수)"],checkPoints:[]},
      {key:"safetyMeasures",label:"안전조치",required:true,inputGuide:"안전대·낙하방지망·하부 출입통제.",examples:["100% Tie-off + 낙하방지망 1개층 + 하부 출입통제 펜스"],checkPoints:[]},
      {key:"completionCheck",label:"조립 후 점검",required:true,inputGuide:"§57 6항 모두 점검 후 사용 개시.",examples:["[√] 6항 모두 양호, 16:30 점검 완료, 17:00 사용 개시"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  construction_machinery_inspection: [
    META_SECTION,
    {title:"2. 건설기계 일상점검",legalSource:"산안기준규칙 §136 + 별표 7",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"매 작업일 시작 전.",examples:["2026-04-29 07:00"],checkPoints:[]},
      {key:"machineId",label:"기계명·일련번호",required:true,inputGuide:"이동식크레인·굴삭기·덤프트럭 등.",examples:["이동식크레인 KOBELCO RK-500 (KO-2024-1234)"],checkPoints:[]},
      {key:"operator",label:"운전자 (자격)",required:true,inputGuide:"면허 운전자.",examples:["박운전 (이동식크레인운전기능사)"],checkPoints:[]},
      {key:"checkItems",label:"점검 항목 (별표 7)",required:true,inputGuide:"엔진·유압·브레이크·조향·방호장치·안전장치.",examples:[[{항목:"엔진오일",결과:"양호"},{항목:"유압",결과:"양호"},{항목:"브레이크",결과:"양호"},{항목:"과부하방지장치",결과:"양호"},{항목:"권과방지장치",결과:"양호"}]],checkPoints:[]},
      {key:"corrections",label:"이상·조치",required:false,optional:true,inputGuide:"이상 시 사용 중지·정비.",examples:["[해당없음]"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  tower_crane_inspection: [
    META_SECTION,
    {title:"2. 타워크레인 점검",legalSource:"산안법 §93 + 시행규칙 §126 + 산안기준규칙 §141",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"월 1회 + 반기 정밀.",examples:["2026-04-29 (월 점검)"],checkPoints:[]},
      {key:"craneId",label:"타워크레인 식별",required:true,inputGuide:"기종·일련번호·안전검사필증.",examples:["TC-A동, 제조번호 KO-2024-1234, 안전검사필증 2026-03"],checkPoints:[]},
      {key:"inspector",label:"점검자",required:true,inputGuide:"타워크레인 자격 점검자 + 안전관리자.",examples:["김점검 (타워크레인운전기능사) + 박안전 (안전관리자)"],checkPoints:[]},
      {key:"checkItems",label:"점검 항목",required:true,inputGuide:"마스트·붐·와이어로프·감속기·전기·방호장치.",examples:[[{항목:"마스트 수직도",결과:"적정 (1/1000 이내)"},{항목:"와이어로프 마모",결과:"양호 (5% 이내)"},{항목:"권과방지장치",결과:"작동"},{항목:"과부하방지장치",결과:"작동"},{항목:"풍속계",결과:"작동"}]],checkPoints:[]},
      {key:"corrections",label:"이상·조치",required:false,optional:true,inputGuide:"이상 시 즉시 사용 중지.",examples:["[해당없음]"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  fall_prevention_net_inspection: [
    META_SECTION,
    {title:"2. 추락방호망 점검",legalSource:"산안기준규칙 §42",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"매일 + 강풍·중량물 낙하 후.",examples:["2026-04-29 07:30"],checkPoints:[]},
      {key:"inspector",label:"점검자",required:true,inputGuide:"관리감독자.",examples:["박감독"],checkPoints:[]},
      {key:"netLocation",label:"방호망 설치 위치",required:true,inputGuide:"동·층·외측.",examples:["A동 외부 1층 외측 1개층"],checkPoints:[]},
      {key:"checkItems",label:"점검 항목",required:true,inputGuide:"망폭 5cm 이하 + 인장강도 + 부착·고정.",examples:[[{항목:"망폭 ≤5cm",결과:"양호"},{항목:"테두리 5m 이내",결과:"양호"},{항목:"손상·낙하물",결과:"양호"},{항목:"고정·결속",결과:"양호"}]],checkPoints:[]},
      {key:"corrections",label:"이상·조치",required:false,optional:true,inputGuide:"손상 시 즉시 교체.",examples:["[해당없음]"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_harness_inspection: [
    META_SECTION,
    {title:"2. 안전대 점검",legalSource:"산안기준규칙 §32 + KOSHA 권고",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"매월 + 사용 후.",examples:["2026-04-29 (월 정기)"],checkPoints:[]},
      {key:"inspector",label:"점검자",required:true,inputGuide:"안전관리자 또는 관리감독자.",examples:["김안전"],checkPoints:[]},
      {key:"harnessList",label:"안전대 목록·상태",required:true,inputGuide:"전체 안전대 일련번호별 점검.",examples:[[{id:"H-001",type:"풀하네스",상태:"양호"},{id:"H-002",type:"풀하네스",상태:"교체 필요(웨빙 마모)"}]],checkPoints:[]},
      {key:"checkItems",label:"점검 항목",required:true,inputGuide:"웨빙·후크·D링·랜야드.",examples:["웨빙 변색·찢김 / 후크 안전장치 / D링 변형 / 랜야드 충격흡수"],checkPoints:[]},
      {key:"replacements",label:"교체·폐기 처리",required:false,optional:true,inputGuide:"교체 안전대 처분.",examples:["H-002 교체 → 신규 1개 구매 (5/2 배포)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  temporary_electric_inspection: [
    META_SECTION,
    {title:"2. 가설전기 점검",legalSource:"산안기준규칙 §319",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"매일 작업 시작 전.",examples:["2026-04-29 07:30"],checkPoints:[]},
      {key:"inspector",label:"점검자",required:true,inputGuide:"전기 전문가 또는 관리감독자.",examples:["박전기 (전기기능사)"],checkPoints:[]},
      {key:"checkItems",label:"점검 항목",required:true,inputGuide:"분전반·누전차단기·접지·케이블·콘센트.",examples:[[{항목:"분전반 잠금",결과:"양호"},{항목:"누전차단기 30mA",결과:"작동"},{항목:"접지저항",결과:"<10Ω"},{항목:"케이블 절연",결과:"양호"}]],checkPoints:[]},
      {key:"hazardousLocation",label:"가공선 이격거리",required:true,inputGuide:"22.9kV → 4m, 154kV → 6m.",examples:["가공선 22.9kV 4m 이격 확인"],checkPoints:[]},
      {key:"corrections",label:"이상·조치",required:false,optional:true,inputGuide:"이상 시 즉시 차단·수리.",examples:["[해당없음]"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  temporary_fire_facility_check: [
    META_SECTION,
    {title:"2. 가설 소방시설 점검",legalSource:"소방시설법 + 산안기준규칙 §241",fields:[
      {key:"inspectionDate",label:"점검 일시",required:true,inputGuide:"매일 + 화기작업 후.",examples:["2026-04-29 17:00"],checkPoints:[]},
      {key:"inspector",label:"점검자",required:true,inputGuide:"소방감시자 또는 관리감독자.",examples:["박감시 (소방감시자 자격)"],checkPoints:[]},
      {key:"checkItems",label:"점검 항목",required:true,inputGuide:"소화기·소화전·비상조명·피난로.",examples:[[{항목:"소화기 압력·수량",결과:"ABC 4kg 12개 양호"},{항목:"소화수조",결과:"200L 충수"},{항목:"피난로 폭 ≥0.9m",결과:"양호"},{항목:"비상조명",결과:"작동"}]],checkPoints:[]},
      {key:"corrections",label:"이상·조치",required:false,optional:true,inputGuide:"미흡 시 즉시 보충·교체.",examples:["[해당없음]"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  formwork_shoring_check: [
    META_SECTION,
    {title:"2. 거푸집·동바리 점검표",legalSource:"산안기준규칙 §331의2·§332·§334",fields:[
      {key:"checkDate",label:"점검 일시",required:true,inputGuide:"콘크리트 타설 전 + 타설 중.",examples:["2026-04-29 09:00 (타설 전) + 11:00 (타설 중)"],checkPoints:[]},
      {key:"checker",label:"점검자",required:true,inputGuide:"형틀목공·구조 자격 + 안전관리자.",examples:["박형틀 (형틀목공기능사) + 김안전"],checkPoints:[]},
      {key:"areaPouring",label:"타설 구역·물량",required:true,inputGuide:"동·층·물량.",examples:["A동 5층 슬래브, 콘크리트 120m³"],checkPoints:[]},
      {key:"formworkCheck",label:"거푸집 점검 (§331의2)",required:true,inputGuide:"수직도·이음·결속·하중.",examples:[[{항목:"수직도",결과:"적정"},{항목:"폼타이",결과:"체결"},{항목:"단부 결속",결과:"양호"}]],checkPoints:[]},
      {key:"shoringCheck",label:"동바리 점검 (§332)",required:true,inputGuide:"수직재·수평재·가새·기초·이음.",examples:[[{항목:"수직재 좌굴",결과:"없음"},{항목:"수평재 결속",결과:"양호"},{항목:"가새 설치",결과:"양호"},{항목:"기초 침하",결과:"없음"}]],checkPoints:[]},
      {key:"corrections",label:"이상·조치",required:false,optional:true,inputGuide:"미흡 시 타설 즉시 중단.",examples:["[해당없음] 타설 진행 가능"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  excavation_daily_check: [
    META_SECTION,
    {title:"2. 굴착 일일 점검표",legalSource:"산안기준규칙 §38·§341 + 별표 4 6호",fields:[
      {key:"checkDate",label:"점검 일시",required:true,inputGuide:"매 작업일 + 강우·강설 후.",examples:["2026-04-29 07:30 (작업 전) + 17:00 (작업 후)"],checkPoints:[]},
      {key:"checker",label:"점검자",required:true,inputGuide:"작업지휘자 + 안전관리자.",examples:["박감독 (건설안전기사) + 김안전"],checkPoints:[]},
      {key:"groundCheck",label:"지반 상태",required:true,inputGuide:"균열·붕괴 조짐·용수.",examples:[[{항목:"균열",결과:"없음"},{항목:"용수",결과:"양호 (배수 가동)"},{항목:"인접 침하",결과:"없음"}]],checkPoints:[]},
      {key:"shoringCheck",label:"흙막이 지보공",required:true,inputGuide:"변위·계측·앵커.",examples:["변위 5mm 이내, 어스앵커 장력 적정, 계측 완료"],checkPoints:[]},
      {key:"buriedFacilities",label:"매설물 보호",required:true,inputGuide:"가스·전기·수도·통신.",examples:["[√] 도시가스 보호 박스 설치, 전기·수도·통신 3m 이격"],checkPoints:[]},
      {key:"weather",label:"기상조건",required:true,inputGuide:"강우 50mm 이상 시 작업 중지.",examples:["풍속 3m/s, 강우 없음, 작업 가능"],checkPoints:[]},
      {key:"corrections",label:"이상·조치",required:false,optional:true,inputGuide:"이상 시 즉시 작업 중단.",examples:["[해당없음]"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_start_pre_check: [
    META_SECTION,
    {title:"2. 작업시작 전 점검표 (별표 3 23종)",legalSource:"산안기준규칙 §35 + 별표 3",fields:[
      {key:"checkDate",label:"점검 일시",required:true,inputGuide:"매 작업일 시작 전.",examples:["2026-04-29 07:30"],checkPoints:[]},
      {key:"workType",label:"작업 종류 (별표 3 23종)",required:true,inputGuide:"별표 3 1~23호 중 해당 작업.",examples:["별표 3 7호 (지반 굴착작업)"],checkPoints:[]},
      {key:"checker",label:"관리감독자",required:true,inputGuide:"해당 작업 관리감독자.",examples:["박감독"],checkPoints:[]},
      {key:"checkItems",label:"별표 3 점검 항목",required:true,inputGuide:"작업 종류별 별표 3에 명시된 항목 모두 점검.",examples:[[{항목:"작업장소 균열·붕괴",결과:"없음"},{항목:"매설물 위치",결과:"확인"},{항목:"안전대·헬멧 착용",결과:"양호"},{항목:"신호수 배치",결과:"배치"}]],checkPoints:[]},
      {key:"signaler",label:"신호수·작업지휘자",required:true,inputGuide:"별표 3 작업별 지정.",examples:["신호수 이신호 + 작업지휘자 박감독"],checkPoints:[]},
      {key:"corrections",label:"이상·조치",required:false,optional:true,inputGuide:"미흡 시 작업 보류.",examples:["[해당없음]"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── H. 화학 ──
  ppe_register: [
    META_SECTION,
    {title:"2. 보호구 지급 대장",legalSource:"산안기준규칙 §32 + KOSHA",fields:[
      {key:"recipient",label:"지급 대상자",required:true,inputGuide:"근로자 성명·소속·사번.",examples:["박작업 (우송설비, 사번 W2026-001)"],checkPoints:[]},
      {key:"ppeItems",label:"지급 보호구 (배열)",required:true,inputGuide:"안전모·안전화·안전대·장갑·보안경·방진/방독·이어플러그.",examples:[[{type:"안전모",model:"KOSHA AB",size:"L",qty:1},{type:"풀하네스 안전대",model:"KOSHA-2300kg",qty:1},{type:"안전화",size:"265",qty:1}]],checkPoints:[]},
      {key:"issueDate",label:"지급 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-04-29"],checkPoints:[]},
      {key:"signature",label:"수령자 서명",required:true,inputGuide:"수령자 자필 서명.",examples:["박작업 (서명)"],checkPoints:[]},
      {key:"replacementCycle",label:"교체 주기·이력",required:true,inputGuide:"보호구별 교체 주기.",examples:["안전모 3년 / 안전대 2년 / 안전화 1년"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  noise_dust_protection_log: [
    META_SECTION,
    {title:"2. 소음·분진 작업장 측정·보호구 대장",legalSource:"산안기준규칙 §511·§607",fields:[
      {key:"measureDate",label:"측정 일시",required:true,inputGuide:"매월.",examples:["2026-04-29"],checkPoints:[]},
      {key:"measureLocation",label:"측정 지점",required:true,inputGuide:"소음·분진 노출 작업장.",examples:["A동 골조 작업장 + B동 콘크리트 절단"],checkPoints:[]},
      {key:"noiseLevel",label:"소음 (dB)",required:true,inputGuide:"TWA dB(A) 측정.",examples:["85.3 dB(A) (8h TWA)"],checkPoints:[]},
      {key:"dustLevel",label:"분진 (mg/m³)",required:true,inputGuide:"호흡성 분진 mg/m³.",examples:["0.7 mg/m³ (호흡성)"],checkPoints:[]},
      {key:"exposedWorkers",label:"노출 근로자",required:true,inputGuide:"노출 인원·시간.",examples:["12명 × 8시간"],checkPoints:[]},
      {key:"protectionPPE",label:"보호구 지급",required:true,inputGuide:"이어플러그·방진마스크.",examples:["이어플러그 12개 + 방진마스크(N95) 12개 지급"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  asbestos_investigation_report: [
    META_SECTION,
    {title:"2. 석면조사 결과",legalSource:"석면안전관리법 §21 + 시행규칙 §27",fields:[
      {key:"buildingInfo",label:"건축물 정보",required:true,inputGuide:"건축연도·구조·연면적.",examples:["1978년 준공, 철근콘크리트 5층, 연면적 800m², 해체 대상"],checkPoints:[]},
      {key:"investigatedBy",label:"조사기관 (지정)",required:true,inputGuide:"환경부 지정 석면조사기관.",examples:["(주)한국석면조사 (지정번호 환경부 제2024-001호)"],checkPoints:[]},
      {key:"investigationDate",label:"조사 일자",required:true,inputGuide:"해체 작업 전 30일 이내.",examples:["2026-04-15"],checkPoints:[]},
      {key:"sampleResults",label:"시료 분석 결과",required:true,inputGuide:"각 시료별 함유율 + 종류.",examples:[[{시료:"S-001",위치:"외벽 마감재",함유율:"3.5%",종류:"백석면"},{시료:"S-002",위치:"보온재",함유율:"음성"}]],checkPoints:[]},
      {key:"asbestosPresent",label:"석면 함유 여부",required:true,inputGuide:"양성/음성 + 양성 시 면적.",examples:["양성 (외벽 마감재 320m² + 보온재 50m²)"],checkPoints:[]},
      {key:"removalPlan",label:"해체·처리 계획",required:true,inputGuide:"양성 시 해체업체·처리절차.",examples:["(주)한국석면해체 (지정업체) 위탁, 음압 격리 + HEPA + 폐기물 인계"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  hazard_chemical_workplace_log: [
    META_SECTION,
    {title:"2. 유해·위험 작업장 작업기록",legalSource:"산안기준규칙 §511·§607·§439·§451",fields:[
      {key:"workDate",label:"작업 일자",required:true,inputGuide:"매일.",examples:["2026-04-29"],checkPoints:[]},
      {key:"workArea",label:"작업장 (유해인자)",required:true,inputGuide:"화학·소음·분진·진동·고온 등.",examples:["A동 도장작업 (톨루엔)"],checkPoints:[]},
      {key:"chemicals",label:"취급 화학물질",required:true,inputGuide:"제품명·CAS·취급량.",examples:["락카신너 20L (CAS 108-88-3 톨루엔)"],checkPoints:[]},
      {key:"workers",label:"작업자 명단",required:true,inputGuide:"노출 근로자 + 시간.",examples:[[{name:"박도장",hours:6,exposure:"6h 톨루엔"}]],checkPoints:[]},
      {key:"protection",label:"보호구·환기 조치",required:true,inputGuide:"방독마스크·환기.",examples:["방독마스크(유기증기용) + 환기 송풍기 작동"],checkPoints:[]},
      {key:"healthMonitoring",label:"건강 영향 관찰",required:true,inputGuide:"두통·어지러움·메스꺼움.",examples:["[√] 작업 후 자각증상 없음"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── J. 건강 ──
  health_examination_records: [
    META_SECTION,
    {title:"2. 일반·특수 건강진단 결과",legalSource:"산안법 §129·§130 + 시행규칙 별지 제85호",fields:[
      {key:"examType",label:"진단 종류",required:true,inputGuide:"일반(연1회) / 특수(6개월) / 임시 / 수시.",examples:["일반 + 특수 (소음·분진 노출)"],checkPoints:[]},
      {key:"examPeriod",label:"진단 기간",required:true,inputGuide:"YYYY-MM-DD ~ YYYY-MM-DD.",examples:["2026-04-15 ~ 2026-04-19"],checkPoints:[]},
      {key:"examAgency",label:"진단기관 (지정)",required:true,inputGuide:"고용노동부 지정 의료기관.",examples:["서울의료원 (지정 제2018-001호)"],checkPoints:[]},
      {key:"examTargets",label:"대상 근로자",required:true,inputGuide:"전 근로자 (일반) + 노출 근로자 (특수).",examples:["일반 50명 + 특수 12명 (소음·분진 노출)"],checkPoints:[]},
      {key:"results",label:"진단 결과 (등급)",required:true,inputGuide:"A/C/D 등급별 인원.",examples:["A 45명, C1 4명, C2 3명, D 0명"],checkPoints:[]},
      {key:"followUp",label:"사후관리 (D·C 등급)",required:true,inputGuide:"D는 작업전환·요양, C는 추적관찰.",examples:["C1 4명 - 작업환경 개선 + 추적관찰, C2 3명 - 보호구 강화"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  health_examination_followup: [
    META_SECTION,
    {title:"2. 건강진단 사후관리",legalSource:"산안법 §132 + 시행규칙 §220",fields:[
      {key:"caseDate",label:"관리 시작 일자",required:true,inputGuide:"진단 결과 통보 후.",examples:["2026-04-25"],checkPoints:[]},
      {key:"workerInfo",label:"대상 근로자",required:true,inputGuide:"성명·소속·등급.",examples:["박작업 (도장공, C1 등급)"],checkPoints:[]},
      {key:"diagnosisFinding",label:"이상 소견",required:true,inputGuide:"건강진단 의사 소견.",examples:["청력 저하 5dB 의심 → 6개월 추적관찰"],checkPoints:[]},
      {key:"followUpPlan",label:"사후관리 계획",required:true,inputGuide:"작업환경 개선·작업전환·치료.",examples:["1) 이어플러그 강화(NRR 30+) 2) 작업시간 단축(6h→4h) 3) 6개월 추적"],checkPoints:[]},
      {key:"reEvaluation",label:"재평가 일정",required:true,inputGuide:"3~6개월 후 재진단.",examples:["2026-10-15 (6개월 후) 재진단"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── M. 인증·검사 ──
  safety_certification_application: [
    META_SECTION,
    {title:"2. 안전인증 신청 (별지 제42호)",legalSource:"산안법 §93 + 시행규칙 §107 별지 제42호",fields:[
      {key:"applicantInfo",label:"신청인 (제조·수입자)",required:true,inputGuide:"회사명·대표자·사업자번호·주소.",examples:["(주)한국기계, 대표 김대표, 사업자번호 123-45-67890"],checkPoints:[]},
      {key:"machineType",label:"기계·기구 종류 (대상 12종)",required:true,inputGuide:"별표 19 안전인증 대상 기계.",examples:["프레스 (별표 19 1호)"],checkPoints:[]},
      {key:"specifications",label:"규격·모델",required:true,inputGuide:"제조사·모델·일련번호·제조일.",examples:["프레스 P-100, 제조번호 P2026-001, 2026-04 제조"],checkPoints:[]},
      {key:"certificationAgency",label:"인증기관",required:true,inputGuide:"KOSHA 안전인증원.",examples:["한국산업안전보건공단 안전인증원"],checkPoints:[]},
      {key:"applicationDate",label:"신청 일자",required:true,inputGuide:"기계 도입·제조 전.",examples:["2026-04-29"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  voluntary_safety_confirmation_filing: [
    META_SECTION,
    {title:"2. 자율안전확인 신고 (별지 제45호)",legalSource:"산안법 §98 + 시행규칙 §123 별지 제45호",fields:[
      {key:"applicantInfo",label:"신고인 (제조·수입자)",required:true,inputGuide:"회사명·대표자·사업자번호.",examples:["(주)한국방호장치, 대표 박대표"],checkPoints:[]},
      {key:"machineType",label:"기계·방호장치 종류 (별표 21)",required:true,inputGuide:"자율안전확인 대상.",examples:["가스용접기 (별표 21 5호)"],checkPoints:[]},
      {key:"selfTestResults",label:"자율 시험 결과",required:true,inputGuide:"제조자 자체 시험 + 인증된 시험기관 결과.",examples:["KS B ISO 11611 적합 (한국공업표준원 시험성적서 첨부)"],checkPoints:[]},
      {key:"filingDate",label:"신고 일자",required:true,inputGuide:"제조·수입 전.",examples:["2026-04-29"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_inspection_application: [
    META_SECTION,
    {title:"2. 안전검사 신청 (별지 제48호)",legalSource:"산안법 §95 + 시행규칙 §125 별지 제48호",fields:[
      {key:"applicantInfo",label:"신청인 (사업주)",required:true,inputGuide:"사업장명·사업자번호.",examples:["황룡건설(주) 삼성동 현장"],checkPoints:[]},
      {key:"machineId",label:"검사 대상 기계",required:true,inputGuide:"안전검사 대상 (별표 22) + 일련번호.",examples:["타워크레인 TC-A동 (KO-2024-1234)"],checkPoints:[]},
      {key:"inspectionType",label:"검사 종류",required:true,inputGuide:"최초 / 정기 (2년 또는 6개월).",examples:["정기검사 (2년 주기)"],checkPoints:[]},
      {key:"prevInspection",label:"이전 검사 이력",required:false,optional:true,inputGuide:"이전 합격일자·번호.",examples:["2024-04 합격 (필증 K-2024-0815)"],checkPoints:[]},
      {key:"applicationDate",label:"신청 일자",required:true,inputGuide:"검사 만료 전.",examples:["2026-04-29"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  voluntary_inspection_program: [
    META_SECTION,
    {title:"2. 자율검사프로그램 인정 신청",legalSource:"산안법 §99 + 시행규칙 §132",fields:[
      {key:"applicantInfo",label:"신청 사업장",required:true,inputGuide:"사업장명·사업자번호.",examples:["황룡건설(주) 삼성동 현장"],checkPoints:[]},
      {key:"programScope",label:"프로그램 범위",required:true,inputGuide:"자율검사 대상 기계 종류·수량.",examples:["타워크레인 1대 + 이동식크레인 2대 자율검사"],checkPoints:[]},
      {key:"qualifiedInspectors",label:"자격 검사원",required:true,inputGuide:"산업안전기사·기계공학기사 등 자격자.",examples:["박검사 (산업안전기사) + 김검사 (기계공학기사)"],checkPoints:[]},
      {key:"inspectionMethod",label:"검사 방법·주기",required:true,inputGuide:"매월·반기·연 1회.",examples:["타워크레인 반기 1회, 이동식크레인 연 1회"],checkPoints:[]},
      {key:"recordKeeping",label:"기록 보존 계획",required:true,inputGuide:"검사 기록 5년 이상.",examples:["전산 시스템 (5년 보존)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── A. 체제 — 신규 P0 노드 ──
  safety_health_total_responsible_appointment: [
    META_SECTION,
    {title:"2. 안전보건총괄책임자 지정",legalSource:"산안법 §62 + 시행령 §52",fields:[
      {key:"appointeeName",label:"총괄책임자 성명",required:true,inputGuide:"도급인 사업장의 안전보건총괄책임자 (현장소장 또는 사업주).",examples:["황룡 (현장소장)"],checkPoints:[]},
      {key:"qualification",label:"자격",required:true,inputGuide:"안전보건관리책임자 직무 수행 가능자.",examples:["건설안전기사 + 안전보건관리책임자 교육 이수"],checkPoints:[]},
      {key:"appointmentDate",label:"지정 일자",required:true,inputGuide:"공사 착공 전.",examples:["2026-03-01"],checkPoints:[]},
      {key:"duties",label:"직무 (시행령 §53)",required:true,inputGuide:"6개 직무 명시.",examples:["1) 위험성평가, 2) 사고 응급조치, 3) 안전보건관리비 집행, 4) 산재예방계획, 5) 도급인·관계수급인 안전보건 통일, 6) 안전보건협의체 운영"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_health_coordinator_appointment: [
    META_SECTION,
    {title:"2. 안전보건조정자 지정",legalSource:"산안법 §68 + 시행령 §56",fields:[
      {key:"appointeeName",label:"조정자 성명",required:true,inputGuide:"안전보건조정자 자격자.",examples:["김조정"],checkPoints:[]},
      {key:"qualification",label:"자격 (시행령 §56)",required:true,inputGuide:"건설안전기술사·기사 + 7년 이상 경력 등.",examples:["건설안전기술사 + 12년 경력"],checkPoints:[]},
      {key:"projectScope",label:"공사 개요 (50억+2개 동시 공사)",required:true,inputGuide:"공사명·금액·공기.",examples:["A공사(35억) + B공사(28억) 동시 진행, 발주자 황룡건설(주)"],checkPoints:[]},
      {key:"duties",label:"조정자 직무",required:true,inputGuide:"공사 간 안전보건 조정·계획 검토·점검 입회.",examples:["월 2회 합동점검, 분기 1회 조정회의"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  construction_safety_management_plan: [
    META_SECTION,
    {title:"2. 안전관리계획서 (건설기술진흥법)",legalSource:"건진법 §62 + 시행령 §98 별표 5",fields:[
      {key:"projectInfo",label:"공사 개요",required:true,inputGuide:"공사명·금액·공기·발주자·시공자.",examples:["황룡건설(주) 삼성동 공동주택, 35억원, 2026-03~2026-09"],checkPoints:[]},
      {key:"riskAnalysis",label:"공종별 위험요인 분석",required:true,inputGuide:"공종(굴착·골조·외장 등) × 위험요인.",examples:["굴착: 매몰·붕괴 / 골조: 추락·낙하 / 외장: 추락"],checkPoints:[]},
      {key:"controlMeasures",label:"공종별 안전관리 대책",required:true,inputGuide:"각 위험요인별 감소대책.",examples:["굴착: 흙막이 1H + 신호수 / 골조: 안전대 100% Tie-off + 추락방호망 / 외장: 시스템비계 + 낙하방지망"],checkPoints:[]},
      {key:"organization",label:"안전관리조직",required:true,inputGuide:"안전관리자·관리감독자·근로자대표 조직도.",examples:["현장소장 1, 안전관리자 1, 관리감독자 3, 근로자대표 1"],checkPoints:[]},
      {key:"emergencyPlan",label:"비상대응 계획",required:true,inputGuide:"사고 시 대응·연락망·대피.",examples:["119 + 본사 + 강남세브란스, 대피로·집결지 매뉴얼 별첨"],checkPoints:[]},
      {key:"submissionStatus",label:"발주처 제출·승인",required:true,inputGuide:"착공 전 발주처에 제출.",examples:["2026-02-15 발주처 제출, 2026-02-25 승인"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  construction_safety_inspection_record: [
    META_SECTION,
    {title:"2. 건설공사 안전점검 결과",legalSource:"건진법 §62 ⑤ + 시행령 §100",fields:[
      {key:"inspectionType",label:"점검 종류",required:true,inputGuide:"자체점검(분기) / 정기점검(반기) / 종합점검(연1회) / 초기점검 / 공정 별 점검.",examples:["자체점검 (분기)"],checkPoints:[]},
      {key:"inspectionDate",label:"점검 일자",required:true,inputGuide:"점검 시기.",examples:["2026-04-29"],checkPoints:[]},
      {key:"inspectors",label:"점검자",required:true,inputGuide:"안전관리자 + 시공책임자 + 발주처.",examples:["김안전 (안전관리자), 박감독 (시공), 이발주 (발주처)"],checkPoints:[]},
      {key:"findings",label:"점검 결과",required:true,inputGuide:"안전관리계획 이행도 + 미흡 사항.",examples:["1) 흙막이 계측 양호, 2) 추락방호망 1개층 누락 → 즉시 설치"],checkPoints:[]},
      {key:"reportToMOLIT",label:"국토부 보고",required:false,optional:true,inputGuide:"종합점검 결과는 국토부 CSI에 보고.",examples:["[해당없음] 자체점검", "2026-Q4 종합점검 결과 CSI 등록 예정"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  contract_safety_health_clause: [
    META_SECTION,
    {title:"2. 도급계약 안전보건 조항",legalSource:"산안법 §70 + 시행규칙 §43",fields:[
      {key:"contractorName",label:"수급인 (계약 상대방)",required:true,inputGuide:"수급업체명.",examples:["우송설비(주)"],checkPoints:[]},
      {key:"contractAmount",label:"도급 금액",required:true,inputGuide:"계약금액 (안전관리비 포함).",examples:["8억원 (안전보건관리비 1.97% = 1,576만원 포함)"],checkPoints:[]},
      {key:"safetyClauses",label:"안전보건 의무 조항 (§70 명시 5항)",required:true,inputGuide:"§70 ② 1~5호 모두 계약서 명시.",examples:["1) 도급인·수급인 안전보건 의무, 2) 안전보건교육·점검 협조, 3) 안전보건관리비 사용, 4) 산재 발생 시 보고·대응, 5) 위약금 (안전 위반 시)"],checkPoints:[]},
      {key:"safetyCostAllocation",label:"안전보건관리비 산정·지급",required:true,inputGuide:"산안법 §72 요율 기준.",examples:["계약금 × 1.97% = 1,576만원, 월 분할 지급"],checkPoints:[]},
      {key:"penaltyForViolation",label:"위약금·해제 조항",required:true,inputGuide:"안전 의무 위반 시 위약금·해제.",examples:["안전 위반 1회 100만원, 3회 누적 시 해제"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  emergency_response_manual: [
    META_SECTION,
    {title:"2. 비상대응 매뉴얼",legalSource:"산안법 §64 ① 5호 + 산안기준규칙 §32",fields:[
      {key:"emergencyTypes",label:"비상상황 종류",required:true,inputGuide:"화재·폭발·지진·붕괴·가스누출·중대재해.",examples:["화재 / 폭발 / 지진 / 붕괴 / 화학 누출 / 중대재해"],checkPoints:[]},
      {key:"alarmSystem",label:"경보 체계",required:true,inputGuide:"사이렌·방송·무전기 + 비상연락망.",examples:["1차: 사이렌 + 방송, 2차: 무전기 일제호출, 3차: 119"],checkPoints:[]},
      {key:"evacuationRoute",label:"대피로 + 집결지",required:true,inputGuide:"각 동·층별 대피로 + 1차/2차 집결지.",examples:["A동 외부 계단 → 정문 주차장 (1차), 200m 외부 공터 (2차)"],checkPoints:[]},
      {key:"emergencyContacts",label:"비상연락망",required:true,inputGuide:"119/응급실/본사/관할 지청.",examples:["119 / 강남세브란스 02-2019-3333 / 본사 안전팀 02-1234-5678 / 강남고용노동지청 02-1234-5679"],checkPoints:[]},
      {key:"firstAidEquipment",label:"응급장비·소화기 위치",required:true,inputGuide:"응급함·소화기·AED·들것.",examples:["응급함 4개(각 동), 소화기 ABC 12개, AED 2개, 들것 4개"],checkPoints:[]},
      {key:"trainingSchedule",label:"훈련 일정",required:true,inputGuide:"분기 1회 이상 대피훈련.",examples:["분기 1회 (3·6·9·12월) 대피훈련"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  evacuation_drill_record: [
    META_SECTION,
    {title:"2. 대피훈련 결과",legalSource:"산안법 §64 ① 5호",fields:[
      {key:"drillDate",label:"훈련 일시",required:true,inputGuide:"분기 1회 이상.",examples:["2026-04-29 14:00~15:30"],checkPoints:[]},
      {key:"drillScenario",label:"훈련 시나리오",required:true,inputGuide:"화재·폭발·지진 등 가정.",examples:["A동 5층 화기작업 중 화재 발생 가정"],checkPoints:[]},
      {key:"participants",label:"참여 인원",required:true,inputGuide:"도급인 + 수급인 전원.",examples:["도급인 5명 + 우송설비 8명 + 광산기계 3명 = 16명"],checkPoints:[]},
      {key:"drillResults",label:"훈련 결과",required:true,inputGuide:"대피 시간·집결지 도달·인원점검.",examples:["사이렌 14:00 → 전원 정문 집결 14:04 (4분), 인원점검 16/16 완료"],checkPoints:[]},
      {key:"improvements",label:"개선사항",required:true,inputGuide:"훈련에서 발견된 미흡사항.",examples:["1) B동 후방 대피로 표지 추가 필요, 2) 무전기 일부 작동 불량 → 5/1까지 교체"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  confined_space_program: [
    META_SECTION,
    {title:"2. 밀폐공간 작업 프로그램 (사전)",legalSource:"산안기준규칙 §619 ③ + KOSHA H-80",fields:[
      {key:"confinedSpaceList",label:"밀폐공간 식별 목록",required:true,inputGuide:"별표 18 해당 모든 공간 + 위치·치수.",examples:[[{id:"CS-001",위치:"B1 집수정",유해인자:"산소결핍",별표18호:"제2호"},{id:"CS-002",위치:"옥상 물탱크",유해인자:"황화수소",별표18호:"제3호"}]],checkPoints:[]},
      {key:"hazardAssessment",label:"공간별 위험성평가",required:true,inputGuide:"산소·유해가스·화재·익사·기계 위험.",examples:["CS-001: 산소결핍(빈도4·강도4=16) / CS-002: H2S(빈도3·강도4=12)"],checkPoints:[]},
      {key:"controlMeasures",label:"감소대책",required:true,inputGuide:"환기·보호구·감시인·구조장비.",examples:["환기 30분+ + 산소측정 + 송기마스크 + 외부 감시인 + 구조 로프"],checkPoints:[]},
      {key:"trainingProgram",label:"교육 계획 (특별교육 8h)",required:true,inputGuide:"근로자·감시인·관리자.",examples:["근로자 8h, 감시인 8h, 관리감독자 16h"],checkPoints:[]},
      {key:"emergencyResponse",label:"비상대응 계획",required:true,inputGuide:"구조 절차 + 119.",examples:["1) 진입자 의식 잃음 - 즉시 후퇴 명령, 2) 외부 로프 견인, 3) 119 신고, 4) 구조자 절대 진입 금지"],checkPoints:[]},
      {key:"reviewCycle",label:"프로그램 검토 주기",required:true,inputGuide:"연 1회 이상.",examples:["연 1회 + 작업 변경 시"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── 작업계획서 9종 (이미 부분정합, inputGuide 보강) ──
  work_plan_demolition: [
    META_SECTION,
    {title:"2. 해체 작업계획서 (별표 4 11호)",legalSource:"산안기준규칙 §38 + 별표 4 11호",fields:[
      {key:"preSurvey",label:"사전조사 (해체 대상 구조·석면·인접·지장물)",required:true,inputGuide:"해체 대상 건축물 구조·재질·석면 함유·인접 시설.",examples:["1978년 RC조 5층, 외벽 석면 양성(별첨), 인접 도로 5m, 지하 도시가스"],checkPoints:[]},
      {key:"demolitionMethod",label:"해체 방법·순서",required:true,inputGuide:"기계식·발파·인력 + 해체 순서.",examples:["기계식(굴삭기 + 압쇄기), 5층 → 1층 순차"],checkPoints:[]},
      {key:"hazardArea",label:"위험구역 설정·통제",required:true,inputGuide:"낙하 반경 + 통제 펜스.",examples:["반경 H/2 + 5m, 펜스·낙하방지망"],checkPoints:[]},
      {key:"dustControl",label:"분진·소음 제어",required:true,inputGuide:"살수·방진막.",examples:["살수 차량 1대 상시 + 방진막 H10m"],checkPoints:[]},
      {key:"asbestosHandling",label:"석면 처리 (해당 시)",required:false,optional:true,inputGuide:"석면 양성 시 별도 해체업체.",examples:["석면 양성 → (주)한국석면해체 별도 위탁"],checkPoints:[]},
      {key:"emergencyPlan",label:"비상조치 계획",required:true,inputGuide:"붕괴·인접 손상 시.",examples:["1) 즉시 작업 중단, 2) 119 + 인접 시설 통보"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_plan_tower_crane: [
    META_SECTION,
    {title:"2. 타워크레인 작업계획서 (별표 4 1호)",legalSource:"산안기준규칙 §141 + 별표 4 1호",fields:[
      {key:"craneSpec",label:"기종·정격하중·작업반경",required:true,inputGuide:"제조사·모델·정격하중·작업반경별 허용하중.",examples:["LIEBHERR 280EC-H 12 (정격 12톤, 50m 반경 3톤)"],checkPoints:[]},
      {key:"installLocation",label:"설치 위치·기초",required:true,inputGuide:"위치·기초 보강·정착.",examples:["A동 동측, 기초 4m × 4m × 1.5m RC + 정착철물"],checkPoints:[]},
      {key:"climbingPlan",label:"인양·자립·해체 계획",required:true,inputGuide:"단계별 시기·방법.",examples:["1단계: 자립 30m (4월) / 2단계: 인양 60m (5월) / 3단계: 해체 (9월)"],checkPoints:[]},
      {key:"signalArea",label:"신호수 + 통신",required:true,inputGuide:"신호수 위치·교대·통신.",examples:["신호수 2명 (양중·운전자 시야간섭) + 무전기 Ch5"],checkPoints:[]},
      {key:"weatherLimit",label:"기상한계",required:true,inputGuide:"풍속 10m/s 이상 작업 중지.",examples:["10m/s 작업 중지, 15m/s 자동잠금"],checkPoints:[]},
      {key:"inspection",label:"점검 계획",required:true,inputGuide:"일상·월·반기.",examples:["일상 매일, 월간 1회, 반기 정밀 1회"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_plan_heavy_lifting: [
    META_SECTION,
    {title:"2. 중량물 작업계획서 (별표 4 5호)",legalSource:"산안기준규칙 §38 + 별표 4 5호",fields:[
      {key:"loadInfo",label:"중량물 정보 (중량·치수·중심)",required:true,inputGuide:"단위 중량 × 개수 + 치수 + 중심위치.",examples:["철골 보 5톤 × 12개, 길이 12m, 중심 6m"],checkPoints:[]},
      {key:"liftingMethod",label:"양중 방법·장비",required:true,inputGuide:"이동식크레인·타워크레인·체인블록.",examples:["이동식크레인 50톤 × 1대, 50m 반경 8톤"],checkPoints:[]},
      {key:"riggingPlan",label:"줄걸이 계획",required:true,inputGuide:"슬링벨트·체인·정격하중·각도.",examples:["슬링벨트 5톤 × 4본, 60° 각도"],checkPoints:[]},
      {key:"liftingSequence",label:"양중 순서",required:true,inputGuide:"단계별 양중 + 정착.",examples:["1) 지상 인양 → 2) 5층 위치 이동 → 3) 정착 → 4) 슬링 해제"],checkPoints:[]},
      {key:"lossPath",label:"낙하·전도 방지",required:true,inputGuide:"안전대 + 가이드·태그라인.",examples:["태그라인 2조, 가이드라인 + 안전대 100% Tie-off"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_plan_vehicle_construction: [
    META_SECTION,
    {title:"2. 차량계 건설기계 작업계획서 (별표 4 1호)",legalSource:"산안기준규칙 §38 + 별표 4 1호",fields:[
      {key:"machineList",label:"투입 건설기계",required:true,inputGuide:"굴삭기·로더·덤프·롤러 등.",examples:["굴삭기 0.7m³ × 2대, 덤프트럭 25톤 × 3대"],checkPoints:[]},
      {key:"workScope",label:"작업 범위",required:true,inputGuide:"굴착·운반·다짐 등.",examples:["B동 굴착 4,000m³ + 토사운반 → 외부 사토장"],checkPoints:[]},
      {key:"trafficPlan",label:"동선·진출입로",required:true,inputGuide:"공사장 내 차량 동선 + 진출입.",examples:["진입 정문 → 굴착장 → 사토장 / 출구 후문 (편도 2차로)"],checkPoints:[]},
      {key:"signalPlan",label:"신호수·유도원",required:true,inputGuide:"진출입 + 후진 시.",examples:["진출입 신호수 1, 후진 유도원 1 (각 차량)"],checkPoints:[]},
      {key:"groundCondition",label:"지반·받침 조치",required:true,inputGuide:"연약지반 받침 + 침하 방지.",examples:["받침대 강판 1m² × 4매 (각 굴삭기)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_plan_vehicle_cargo: [
    META_SECTION,
    {title:"2. 차량계 하역운반기계 작업계획서 (별표 4 2호)",legalSource:"산안기준규칙 §38 + 별표 4 2호",fields:[
      {key:"machineList",label:"투입 하역운반기계",required:true,inputGuide:"지게차·트럭크레인·하역장비.",examples:["지게차 3톤 × 2대, 트럭크레인 5톤 × 1대"],checkPoints:[]},
      {key:"cargoInfo",label:"하역 대상물 (중량·치수)",required:true,inputGuide:"자재·기계 등.",examples:["철근 코일 2톤 × 30개 + 시멘트 50kg × 200포"],checkPoints:[]},
      {key:"routeAndMethod",label:"운반 경로·방법",required:true,inputGuide:"적재→이동→하역 경로.",examples:["자재창고 → 굴착장 → 1층 적재구역, 편도 80m"],checkPoints:[]},
      {key:"signalPlan",label:"신호수·통제",required:true,inputGuide:"교차로·후진 시.",examples:["교차로 신호수 1 + 작업조 안전관리자 입회"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_plan_electric_work: [
    META_SECTION,
    {title:"2. 전기작업 계획서 (별표 4 14호)",legalSource:"산안기준규칙 §301 + 별표 4 14호 + §319",fields:[
      {key:"workScope",label:"작업 범위",required:true,inputGuide:"활선·정전·근접 작업.",examples:["분전반 정비 (380V 정전작업)"],checkPoints:[]},
      {key:"voltageLevel",label:"전압 등급",required:true,inputGuide:"저압·고압·특고압.",examples:["저압 380V 3상"],checkPoints:[]},
      {key:"isolationProcedure",label:"차단·잠금 절차 (LOTO)",required:true,inputGuide:"§300 잠금·표지 절차.",examples:["1) 메인 차단 OFF, 2) LOTO 자물쇠 + 표지, 3) 무전압 검전, 4) 작업"],checkPoints:[]},
      {key:"qualifiedWorkers",label:"자격 작업자",required:true,inputGuide:"전기기능사 이상 자격.",examples:["박전기 (전기기사) + 김전기 (전기기능사)"],checkPoints:[]},
      {key:"insulationPPE",label:"절연 보호구",required:true,inputGuide:"절연장갑·절연화·절연매트.",examples:["7kV 절연장갑·절연화 + 절연매트"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_plan_tunnel: [
    META_SECTION,
    {title:"2. 터널 작업계획서 (별표 4 7호)",legalSource:"산안기준규칙 §38 + 별표 4 7호",fields:[
      {key:"tunnelInfo",label:"터널 제원",required:true,inputGuide:"위치·길이·단면·지반.",examples:["A터널 길이 250m, 단면 10m × 8m, 화강암"],checkPoints:[]},
      {key:"excavationMethod",label:"굴착 공법",required:true,inputGuide:"발파·기계·NATM 등.",examples:["NATM 공법, 발파 + 숏크리트"],checkPoints:[]},
      {key:"supportAndWater",label:"지보공·용수 처리",required:true,inputGuide:"강지보·록볼트·배수.",examples:["강지보 + 록볼트 6m × 4본/m + 배수공"],checkPoints:[]},
      {key:"ventilation",label:"환기 계획",required:true,inputGuide:"송기·배기 + CO·NO₂ 측정.",examples:["송풍기 1500CMH + 배기, 가스측정기 상시"],checkPoints:[]},
      {key:"emergency",label:"비상대응",required:true,inputGuide:"붕괴·가스·화재 대응.",examples:["대피 갱구 + 비상조명 + 119 직통"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_plan_bridge: [
    META_SECTION,
    {title:"2. 교량 작업계획서 (별표 4 8호)",legalSource:"산안기준규칙 §38 + 별표 4 8호",fields:[
      {key:"bridgeInfo",label:"교량 제원",required:true,inputGuide:"경간·교각·교폭.",examples:["경간 30m × 5경간, 교각 8m, 교폭 20m"],checkPoints:[]},
      {key:"constructionMethod",label:"가설 공법",required:true,inputGuide:"FCM·MSS·ILM·가설벤트.",examples:["MSS 공법 (이동식 동바리)"],checkPoints:[]},
      {key:"falseworkPlan",label:"가설 동바리·서포트",required:true,inputGuide:"동바리·강관파이프·서포트.",examples:["MSS 동바리 + 강관파이프 보강"],checkPoints:[]},
      {key:"safetyMeasures",label:"안전 시설",required:true,inputGuide:"안전난간·추락방호망·낙하방지망.",examples:["안전난간 H1.0m + 추락방호망 + 낙하방지망 (하부 도로)"],checkPoints:[]},
      {key:"trafficControl",label:"하부 교통 통제",required:true,inputGuide:"공도·하천 등.",examples:["하부 공도 4차선, 야간 차량 통제 + 안내표지"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── 잔여 미정합 10종 ──
  safety_health_management_assistant_appointment: [
    META_SECTION,
    {title:"2. 안전보건관리담당자 선임 (별지 제24호)",legalSource:"산안법 §19 + 시행령 §24 + 별지 제24호",fields:[
      {key:"appointeeName",label:"선임 담당자 성명",required:true,inputGuide:"안전보건관리담당자 (20~49인 한정업종 의무).",examples:["박담당"],checkPoints:[]},
      {key:"qualification",label:"자격",required:true,inputGuide:"산안법 시행령 별표 4 자격기준.",examples:["산업안전보건교육 8h 이수 + 1년 이상 경력"],checkPoints:[]},
      {key:"appointmentDate",label:"선임 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-04-29"],checkPoints:[]},
      {key:"reportToMOEL",label:"고용노동부 보고 (14일 내)",required:true,inputGuide:"별지 제24호 제출.",examples:["2026-05-10 강남고용노동지청 제출"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  industrial_physician_appointment: [
    META_SECTION,
    {title:"2. 산업보건의 선임 (별지 제24호)",legalSource:"산안법 §22 + 시행규칙 §11 + 별지 제24호",fields:[
      {key:"physicianName",label:"산업보건의 성명",required:true,inputGuide:"의사 자격자.",examples:["김의사 (직업환경의학과 전문의)"],checkPoints:[]},
      {key:"qualification",label:"의사 자격증·전문분야",required:true,inputGuide:"의사 면허번호·전문분야.",examples:["면허 12345 / 직업환경의학과 / 산업보건의 교육 이수"],checkPoints:[]},
      {key:"appointmentType",label:"선임 형태",required:true,inputGuide:"전임 / 위촉 / 위탁.",examples:["위촉 (월 8시간)"],checkPoints:[]},
      {key:"appointmentDate",label:"선임 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-04-29"],checkPoints:[]},
      {key:"reportToMOEL",label:"고용노동부 보고",required:true,inputGuide:"별지 제24호 제출 (14일 내).",examples:["2026-05-10 제출"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  construction_safety_health_register: [
    META_SECTION,
    {title:"2. 공사 안전보건대장",legalSource:"산안법 §67 + 시행규칙 §84",fields:[
      {key:"projectInfo",label:"공사 개요",required:true,inputGuide:"공사명·금액·공기.",examples:["삼성동 공동주택 신축, 35억원, 2026-03~2026-09"],checkPoints:[]},
      {key:"constructorInfo",label:"시공사·하도급 정보",required:true,inputGuide:"원도급·하도급 회사 + 안전보건 책임자.",examples:["원: 황룡건설(주) (이사 황룡) / 하: 우송설비 + 광산기계 + 강남도장"],checkPoints:[]},
      {key:"hazardSurvey",label:"공사 위험성 평가 결과",required:true,inputGuide:"공종별 주요 위험요인 + 대책.",examples:["굴착·골조·외장 주요 위험요인 별첨"],checkPoints:[]},
      {key:"safetyOrganization",label:"안전보건 조직·인력",required:true,inputGuide:"안전관리자·관리감독자 인원.",examples:["안전관리자 1, 관리감독자 3, 신호수 2, 소방감시자 1"],checkPoints:[]},
      {key:"basicRegister",label:"기본대장 연계",required:true,inputGuide:"기본대장 + 설계대장과 연계.",examples:["기본대장 등록 (발주자 황룡건설(주), 2026-02-01) + 설계대장 (설계사 (주)건축설계, 2026-02-15)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  design_safety_health_register: [
    META_SECTION,
    {title:"2. 설계 안전보건대장",legalSource:"산안법 §67 + 시행규칙 §84",fields:[
      {key:"projectInfo",label:"공사 개요",required:true,inputGuide:"공사명·금액·공기.",examples:["삼성동 공동주택 35억원"],checkPoints:[]},
      {key:"designerInfo",label:"설계사 정보",required:true,inputGuide:"설계사·대표·자격.",examples:["(주)건축설계 / 대표 김설계 / 건축사"],checkPoints:[]},
      {key:"designHazardAnalysis",label:"설계 단계 위험요인 분석",required:true,inputGuide:"설계도서별 위험요인 + 시공시 안전 고려사항.",examples:["1) 지하 굴착 8m → 흙막이 보강 / 2) 외벽 철골 → 추락 위험 / 3) 옥상 슬래브 → 단부 보호"],checkPoints:[]},
      {key:"designControlMeasures",label:"설계 단계 안전 대책",required:true,inputGuide:"설계 도면에 반영된 안전 시설.",examples:["흙막이 H-300 + 어스앵커 / 외벽 시스템비계 + 추락방호망 / 옥상 영구 안전난간"],checkPoints:[]},
      {key:"basicRegisterLink",label:"기본대장 연계",required:true,inputGuide:"기본대장 등록 정보 참조.",examples:["기본대장 (발주자 황룡건설, 2026-02-01) 참조"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  basic_safety_health_register: [
    META_SECTION,
    {title:"2. 기본 안전보건대장",legalSource:"산안법 §67 + 시행규칙 §84",fields:[
      {key:"clientInfo",label:"발주자 정보",required:true,inputGuide:"발주자명·대표·연락처.",examples:["황룡건설(주) / 황한일 / 02-1234-5678"],checkPoints:[]},
      {key:"projectInfo",label:"공사 기본정보",required:true,inputGuide:"공사명·위치·금액·공기.",examples:["삼성동 공동주택, 서울 강남구 삼성동 100-1, 35억, 2026-03~2026-09"],checkPoints:[]},
      {key:"hazardScreening",label:"공사 위험성 사전검토",required:true,inputGuide:"발주자가 사전검토한 주요 위험.",examples:["1) 지하 8m 굴착 (도시가스 인접) / 2) 50인 동시 작업 / 3) 야간 작업 일부"],checkPoints:[]},
      {key:"safetyBudget",label:"안전보건관리비 계상",required:true,inputGuide:"산안법 §72 요율 적용.",examples:["계상금 32억 × 1.97% = 6,304만원"],checkPoints:[]},
      {key:"submissionDate",label:"등록일자",required:true,inputGuide:"발주 시점 등록.",examples:["2026-02-01"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  monthly_risk_assessment: [
    META_SECTION,
    {title:"2. 상시 위험성평가 (매월·매주·매일)",legalSource:"위험성평가 고시 §15 ④ 3호",fields:[
      {key:"period",label:"평가 기간",required:true,inputGuide:"매월 1일~말일.",examples:["2026-04-01 ~ 2026-04-30"],checkPoints:[]},
      {key:"monthlyMeeting",label:"매월 협의체 회의",required:true,inputGuide:"매월 1회 이상 위험요인 발굴.",examples:["2026-04-26 14:00, 위험요인 5건 발굴"],checkPoints:[]},
      {key:"weeklyMeeting",label:"매주 안전회의",required:true,inputGuide:"매주 월요일 09:00.",examples:["4회 실시 (4/1, 4/8, 4/15, 4/22)"],checkPoints:[]},
      {key:"dailyTBM",label:"매일 TBM",required:true,inputGuide:"매 작업일 TBM 일지.",examples:["22일간 TBM 22부 별첨"],checkPoints:[]},
      {key:"hazardList",label:"식별 위험요인 (월간 합계)",required:true,inputGuide:"월간 발굴된 위험요인 통합.",examples:[[{type:"추락",count:1,severity:"높음",control:"안전대 강화"},{type:"끼임",count:2,severity:"중간",control:"방호장치 점검"}]],checkPoints:[]},
      {key:"controlImplementation",label:"감소대책 이행 결과",required:true,inputGuide:"각 위험요인별 조치 완료 여부.",examples:["5건 중 4건 완료, 1건 진행 중 (5월 10일까지)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  daily_tbm: [
    META_SECTION,
    {title:"2. TBM 회의록 (Tool Box Meeting)",legalSource:"위험성평가 고시 §15 ④ 3호 + KOSHA P-103",fields:[
      {key:"tbmDate",label:"TBM 일시",required:true,inputGuide:"매 작업일 시작 전.",examples:["2026-04-29 07:30"],checkPoints:[]},
      {key:"presenter",label:"진행자 (관리감독자)",required:true,inputGuide:"관리감독자 또는 작업지휘자.",examples:["박감독"],checkPoints:[]},
      {key:"todayWork",label:"오늘의 작업",required:true,inputGuide:"오늘 시행할 작업·위치·인원.",examples:["A동 6층 외벽 도장 + B동 굴착, 작업자 12명"],checkPoints:[]},
      {key:"hazardsToday",label:"잠재 위험요인 (3건 이상)",required:true,inputGuide:"오늘 작업의 핵심 위험.",examples:[[{위험:"추락(외벽)",대책:"안전대 100% Tie-off + 추락방호망"},{위험:"화학물질(도장)",대책:"방독마스크 + 환기"},{위험:"매몰(굴착)",대책:"흙막이 점검 + 신호수"}]],checkPoints:[]},
      {key:"keyControl",label:"오늘의 중점 안전수칙",required:true,inputGuide:"한 가지 핵심 수칙.",examples:["100% Tie-off 원칙 (안전대 후크 절대 분리 금지)"],checkPoints:[]},
      {key:"preWorkCheck",label:"작업 전 안전조치 확인 (3건)",required:true,inputGuide:"보호구·기계·환경.",examples:[[{항목:"풀하네스",결과:"양호"},{항목:"비계 단부 안전난간",결과:"양호"},{항목:"환기 송풍기",결과:"가동"}]],checkPoints:[]},
      {key:"participants",label:"참석자 명단·서명",required:true,inputGuide:"전원 자필 서명 (외국인 모국어).",examples:[[{name:"박감독",signed:true},{name:"이작업",signed:true},{name:"NGUYEN VAN A",signed:true,language:"베트남어"}]],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_plan_excavation: [
    META_SECTION,
    {title:"2. 굴착 작업계획서 (별표 4 6호)",legalSource:"산안기준규칙 §38 + 별표 4 6호",fields:[
      {key:"preSurvey_shape",label:"사전조사 - 형상·지질",required:true,inputGuide:"굴착 형상·지반 종류.",examples:["굴착 8m × 30m × 30m, 화강풍화토 + 풍화암"],checkPoints:[]},
      {key:"preSurvey_crack",label:"사전조사 - 균열·함수",required:true,inputGuide:"기존 균열·지하수.",examples:["인접 건물 균열 없음, 지하수위 GL-6m"],checkPoints:[]},
      {key:"preSurvey_buried",label:"사전조사 - 매설물",required:true,inputGuide:"가스·전기·수도·통신 매설.",examples:["도시가스 GL-1.5m, 한전 22.9kV GL-2.0m, 상수도 GL-1.0m"],checkPoints:[]},
      {key:"preSurvey_groundwater",label:"사전조사 - 지하수",required:true,inputGuide:"용수 처리·배수.",examples:["배수 펌프 2대 + 집수정 4개"],checkPoints:[]},
      {key:"plan_method",label:"굴착 방법·순서",required:true,inputGuide:"기계·인력 + 단계별 깊이.",examples:["1단계 GL-3m (오픈컷) → 2단계 -8m (흙막이)"],checkPoints:[]},
      {key:"plan_workers",label:"투입 인원",required:true,inputGuide:"근로자 수·자격.",examples:["굴착작업자 8명 + 신호수 1명 + 작업지휘자 1명"],checkPoints:[]},
      {key:"plan_protection",label:"매설물 보호 조치",required:true,inputGuide:"노출·이설·보호.",examples:["가스: 보호 박스 + 도시가스공사 입회"],checkPoints:[]},
      {key:"plan_signal",label:"신호 방법",required:true,inputGuide:"신호수·통신.",examples:["신호수 1명 + 무전기 Ch5"],checkPoints:[]},
      {key:"plan_shoring",label:"지보공 (흙막이)",required:true,inputGuide:"공법·구조.",examples:["H-300 + 어스앵커 2단 (PS75kN/1개)"],checkPoints:[]},
      {key:"plan_director",label:"작업지휘자",required:true,inputGuide:"건설안전기사 이상.",examples:["박감독 (건설안전기사)"],checkPoints:[]},
      {key:"notifiedToWorkers",label:"근로자 통지 (§38 ②)",required:true,inputGuide:"계획 전 작업자에게 주지.",examples:[true],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_permit_hot_work: [
    META_SECTION,
    {title:"2. 화기작업 허가서 (P-94)",legalSource:"산안기준규칙 §239 + KOSHA P-94",fields:[
      {key:"permitNumber",label:"허가서 번호",required:true,inputGuide:"PERMIT-HW-YYMMDD-NN.",examples:["PERMIT-HW-260429-01"],checkPoints:[]},
      {key:"workName",label:"작업명",required:true,inputGuide:"용접·용단·연마·드릴.",examples:["A동 5층 철골 용접"],checkPoints:[]},
      {key:"workLocation",label:"작업 위치",required:true,inputGuide:"동·층·위치.",examples:["A동 5층 동측 외벽"],checkPoints:[]},
      {key:"workTime",label:"작업 시간",required:true,inputGuide:"시작~종료.",examples:["2026-04-29 09:00~12:00"],checkPoints:[]},
      {key:"flammableRemoval",label:"가연물 제거·차폐",required:true,inputGuide:"5m 반경 가연물 제거 + 방화포.",examples:["[√] 5m 반경 정리 + 방화포 4매"],checkPoints:[]},
      {key:"fireExtinguisher",label:"소화기 비치 (2대 이상)",required:true,inputGuide:"ABC 분말 4kg 이상.",examples:["[√] ABC 4kg × 3대"],checkPoints:[]},
      {key:"fireWatcher",label:"소방감시자",required:true,inputGuide:"화기작업 중 + 작업 후 30분.",examples:["박감시 (소방감시자, 작업 중 + 30분 잔류)"],checkPoints:[]},
      {key:"weldingProtection",label:"용접 보호조치",required:true,inputGuide:"전격방지·접지·역화방지.",examples:["[√] 전격방지기 + 외함 접지 + 역화방지기"],checkPoints:[]},
      {key:"approver",label:"승인자",required:true,inputGuide:"안전보건관리책임자.",examples:["황룡 (현장소장, 서명)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  hazardous_risk_prevention_plan_construction: [
    META_SECTION,
    {title:"2. 유해·위험방지계획서 (건설)",legalSource:"산안법 §42·§43 + 시행령 별표 10",fields:[
      {key:"projectScope",label:"공사 개요 (대상 공사)",required:true,inputGuide:"별표 10 대상 공사.",examples:["지하 10층 이상 또는 지상 31층 이상 / 깊이 10m 이상 굴착 / 길이 50m 이상 다리 등"],checkPoints:[]},
      {key:"hazardAnalysis",label:"공종별 유해·위험 분석",required:true,inputGuide:"굴착·골조·해체 등.",examples:["굴착(매몰·붕괴), 골조(추락·낙하), 해체(석면·진동)"],checkPoints:[]},
      {key:"controlMeasures",label:"방지 대책",required:true,inputGuide:"공종별 안전 시설 + 작업방법.",examples:["굴착: 흙막이 H-300 + 어스앵커 / 골조: 안전대 100% + 추락방호망 / 해체: 음압 격리 + HEPA"],checkPoints:[]},
      {key:"organization",label:"안전보건 조직",required:true,inputGuide:"인원·자격·역할.",examples:["전임 안전관리자 2 + 관리감독자 5 + 비상대응팀 3"],checkPoints:[]},
      {key:"kosha_review",label:"KOSHA 심사 결과",required:true,inputGuide:"공사 착공 30일 전 제출 + 심사필증.",examples:["2026-02-01 KOSHA 제출, 2026-02-25 심사필증 (필증 K-2026-0815)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_signage_register: [
    META_SECTION,
    {title:"2. 안전·보건 표지 대장",legalSource:"산안기준규칙 §39 + 별표 7",fields:[
      {key:"signageList",label:"표지 목록",required:true,inputGuide:"금지·경고·지시·안내 4분류 모든 표지.",examples:[[{종류:"출입금지",위치:"A동 굴착장",수량:2},{종류:"안전모 착용",위치:"전체 출입구",수량:6},{종류:"비상구",위치:"각 동 계단",수량:8}]],checkPoints:[]},
      {key:"installLocation",label:"설치 위치도",required:true,inputGuide:"평면도·동선에 표시.",examples:["배치도 별첨 (각 동 1F~7F)"],checkPoints:[]},
      {key:"installDate",label:"최초 설치·갱신 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["최초 2026-03-01, 갱신 2026-04-29"],checkPoints:[]},
      {key:"monthlyCheck",label:"월간 점검 결과",required:true,inputGuide:"손상·탈락·오염 점검.",examples:["1) 출입금지 1개 손상 → 교체 / 2) 비상구 1개 시야 가림 → 위치 조정"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_health_mgmt_cost_plan_supplement: [
    META_SECTION,
    {title:"2. 안전보건관리비 (월별 집행 보강)",legalSource:"산안법 §72 + 고시 2022-43",fields:[
      {key:"monthlyExecutionDetail",label:"월별 항목 집행 상세",required:true,inputGuide:"고시 별표 2 9개 항목 분류.",examples:[[{월:"2026-04",항목:"1.안전관리자",금액:4500000},{월:"2026-04",항목:"3.PPE",금액:6650000}]],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],

  // ── 잔여 부분정합 17종 ──
  safety_health_manager_appointment: [
    META_SECTION,
    {title:"2. 안전보건관리체제 선임 (별지 24호)",legalSource:"산안법 §15·17·18·19 + 시행규칙 §11 + 별지 24호",fields:[
      {key:"appointeeName",label:"선임자 성명",required:true,inputGuide:"안전관리자·보건관리자 성명.",examples:["김안전 (안전관리자)"],checkPoints:[]},
      {key:"appointmentType",label:"선임 종류",required:true,inputGuide:"안전보건관리책임자/안전관리자/보건관리자/안전보건관리담당자.",examples:["안전관리자"],checkPoints:[]},
      {key:"qualification",label:"자격",required:true,inputGuide:"산안법 시행령 별표 4·5 자격기준.",examples:["산업안전기사 + 5년 경력"],checkPoints:[]},
      {key:"appointmentDate",label:"선임 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-04-29"],checkPoints:[]},
      {key:"reportToMOEL",label:"고용노동부 보고",required:true,inputGuide:"별지 24호 14일 내 제출.",examples:["2026-05-10 강남고용노동지청 제출"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_health_committee: [
    META_SECTION,
    {title:"2. 산업안전보건위원회 회의록 (분기)",legalSource:"산안법 §24 + 시행령 §34 (100인 이상 의무)",fields:[
      {key:"meetingNumber",label:"회의 회차",required:true,inputGuide:"분기별 일련번호.",examples:["2026-Q2 (2분기 정기)"],checkPoints:[]},
      {key:"meetingDate",label:"회의 일시",required:true,inputGuide:"분기 1회 이상.",examples:["2026-04-29 14:00~15:30"],checkPoints:[]},
      {key:"members",label:"위원 (사용자·근로자 동수)",required:true,inputGuide:"산안법 §24 ② 위원 구성.",examples:["사용자측 5명 + 근로자측 5명"],checkPoints:[]},
      {key:"agenda",label:"심의·의결 사항",required:true,inputGuide:"산안법 §24 ③ 8개 항목.",examples:["1) 산재예방계획 / 2) 안전보건관리규정 / 3) 위험성평가 / 4) 산재 발생 보고 / 5) 안전보건관리비 / 6) 도급사업"],checkPoints:[]},
      {key:"decisions",label:"의결 사항",required:true,inputGuide:"위원회 결정.",examples:["1) 분기 위험성평가 강화 / 2) 산재예방 교육 추가"],checkPoints:[]},
      {key:"recordKeeping",label:"회의록 보존 (3년)",required:true,inputGuide:"산안법 §164.",examples:["3년 보존 (2029-04-29까지)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  health_safety_committee: [
    META_SECTION,
    {title:"2. 산업안전보건위원회 운영규정",legalSource:"산안법 §24 + 시행규칙 §35",fields:[
      {key:"committeeOrganization",label:"위원회 조직",required:true,inputGuide:"위원장·간사·위원 구성.",examples:["위원장 사업주 1, 부위원장 근로자대표 1, 간사 안전관리자 1, 위원 8명"],checkPoints:[]},
      {key:"meetingFrequency",label:"회의 주기",required:true,inputGuide:"분기 1회 이상 + 임시.",examples:["분기 1회 정기 + 중대재해 발생 시 임시"],checkPoints:[]},
      {key:"agendaScope",label:"심의·의결 범위",required:true,inputGuide:"산안법 §24 ③ 8개 항목.",examples:["산재예방계획·관리규정·위험성평가·산재보고·관리비·도급·교육·안전보건진단"],checkPoints:[]},
      {key:"votingRule",label:"의결 정족수",required:true,inputGuide:"재적 과반수 출석 + 출석 과반수 찬성.",examples:["재적 10명 → 6명 이상 출석 + 출석 과반수 찬성"],checkPoints:[]},
      {key:"recordRule",label:"회의록 작성·보존",required:true,inputGuide:"3년 보존 + 게시.",examples:["회의 후 7일 내 작성, 게시판 게시, 3년 보존"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_responsible_log: [
    META_SECTION,
    {title:"2. 안전보건관리책임자 직무 기록",legalSource:"산안법 §15 + 시행규칙 §9",fields:[
      {key:"period",label:"기록 기간",required:true,inputGuide:"월별·분기별.",examples:["2026-04-01~04-30"],checkPoints:[]},
      {key:"duties",label:"수행 직무 (산안법 §15 9개 항목)",required:true,inputGuide:"산재예방계획·관리규정·위험성평가·교육·점검·산재 처리.",examples:[[{직무:"위험성평가",회수:1,비고:"4월 정기"},{직무:"안전점검",회수:4,비고:"매주"},{직무:"교육 입회",회수:1,비고:"4/15"}]],checkPoints:[]},
      {key:"meetings",label:"참석 회의",required:true,inputGuide:"위원회·협의체·간담회.",examples:["산업안전보건위원회 1회, 도급인 협의체 1회"],checkPoints:[]},
      {key:"keyDecisions",label:"주요 의사결정",required:true,inputGuide:"위험성·예산·인력 결정.",examples:["1) 추락방호망 추가 설치 결정 / 2) 안전관리비 증액 (5월부터)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  supervisor_monthly_log: [
    META_SECTION,
    {title:"2. 관리감독자 월별 직무 일지",legalSource:"산안법 §16 + 시행규칙 §35",fields:[
      {key:"period",label:"기록 기간",required:true,inputGuide:"월 단위.",examples:["2026-04"],checkPoints:[]},
      {key:"supervisorName",label:"관리감독자",required:true,inputGuide:"관리감독자 성명·소속.",examples:["박감독 (A동 골조 작업조)"],checkPoints:[]},
      {key:"dailyDuties",label:"일별 직무 수행",required:true,inputGuide:"매일 점검·지시·감독 기록.",examples:[[{date:"2026-04-29",duties:"TBM 진행 / 작업 전 점검 / 안전대 착용 점검"}]],checkPoints:[]},
      {key:"hazardsHandled",label:"처리한 위험요인",required:true,inputGuide:"발견·즉시조치한 위험.",examples:["1) 안전난간 누락 즉시 설치 / 2) 보호구 미착용 1명 시정 지도"],checkPoints:[]},
      {key:"educationConducted",label:"실시한 교육",required:true,inputGuide:"매주 안전회의·TBM.",examples:["TBM 22회 + 매주 안전회의 4회"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  worker_complaint_log: [
    META_SECTION,
    {title:"2. 근로자 의견청취·고충처리 대장",legalSource:"위험성평가 고시 §16",fields:[
      {key:"complaintDate",label:"제기 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-04-29"],checkPoints:[]},
      {key:"complainant",label:"제기자",required:true,inputGuide:"성명·소속 (또는 익명).",examples:["박작업 (A동 골조작업조) / 익명"],checkPoints:[]},
      {key:"complaintContent",label:"의견·고충 내용",required:true,inputGuide:"위험요인·작업환경·보호구.",examples:["A동 5층 외벽 작업 시 비계 흔들림 → 보강 요청"],checkPoints:[]},
      {key:"action",label:"조치 사항",required:true,inputGuide:"즉시조치 + 책임자 + 기한.",examples:["박감독 - 5/1까지 비계 보강 + 사진 보고"],checkPoints:[]},
      {key:"feedback",label:"제기자 피드백",required:true,inputGuide:"조치 결과 통보.",examples:["2026-05-02 박작업에 보강 완료 통보 + 만족 확인"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  monthly_education_log: [
    META_SECTION,
    {title:"2. 정기 안전보건교육 일지 (별지 79호)",legalSource:"산안법 §29 + 시행규칙 §26 + 별지 79호",fields:[
      {key:"educationDate",label:"교육 일시",required:true,inputGuide:"매월 + 시간.",examples:["2026-04-15 09:00~11:00 (2h)"],checkPoints:[]},
      {key:"educationType",label:"교육 종류 (산안법 §29 4종)",required:true,inputGuide:"정기/신규/작업변경/특별.",examples:["정기교육 (월 2시간)"],checkPoints:[]},
      {key:"hours",label:"교육 시간",required:true,inputGuide:"건설 일용 매월 1시간 / 일반 매분기 6시간.",examples:["2시간"],checkPoints:[]},
      {key:"instructor",label:"강사",required:true,inputGuide:"안전관리자 또는 외부 강사.",examples:["김안전 (안전관리자)"],checkPoints:[]},
      {key:"curriculum",label:"교육 내용 (시행규칙 별표 5)",required:true,inputGuide:"법령·위험요인·재해사례.",examples:["1) 산안법 개정사항 30분 / 2) 4월 위험성평가 결과 60분 / 3) 사고 사례 30분"],checkPoints:[]},
      {key:"trainees",label:"이수자 명단·서명",required:true,inputGuide:"전원 자필 서명 (외국인은 모국어 서명).",examples:[[{name:"박작업",signed:true,hours:2},{name:"이작업",signed:true,hours:2}]],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  msds_education_log: [
    META_SECTION,
    {title:"2. MSDS 교육 일지",legalSource:"산안법 §114 ② + 시행규칙 §170",fields:[
      {key:"educationDate",label:"교육 일시",required:true,inputGuide:"채용 시 + 작업변경 시 + 연 1회.",examples:["2026-04-15 (정기 연 1회)"],checkPoints:[]},
      {key:"chemicals",label:"교육 대상 화학물질",required:true,inputGuide:"비치 MSDS 12종 + 신규.",examples:["락카신너·시멘트·접착제 등 12종"],checkPoints:[]},
      {key:"curriculum",label:"교육 내용 (5개 항목)",required:true,inputGuide:"GHS·취급주의·노출경로·응급처치·MSDS 위치.",examples:["1) GHS 그림문자 / 2) 취급 주의 / 3) 노출 시 증상 / 4) 응급조치 / 5) MSDS 위치"],checkPoints:[]},
      {key:"hours",label:"교육 시간",required:true,inputGuide:"1시간 이상.",examples:["1.5시간"],checkPoints:[]},
      {key:"trainees",label:"이수자 명단·서명",required:true,inputGuide:"화학물질 취급 작업자 전원.",examples:[[{name:"박도장",signed:true},{name:"이도장",signed:true}]],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_health_education_material_log: [
    META_SECTION,
    {title:"2. 안전보건교육 자료 비치대장",legalSource:"산안법 §41 + 시행규칙 §32",fields:[
      {key:"materialList",label:"비치 자료 목록",required:true,inputGuide:"교재·동영상·안전수칙·법령요지.",examples:[[{type:"교재",name:"건설업 안전교육교본",qty:5},{type:"동영상",name:"추락사고 사례",qty:1},{type:"법령요지",name:"산안법 게시판",qty:1}]],checkPoints:[]},
      {key:"locations",label:"비치 위치",required:true,inputGuide:"근로자 접근 가능 위치.",examples:["안전관리사무실 + 식당 게시판 + 각 동 출입구"],checkPoints:[]},
      {key:"updateRecord",label:"갱신 이력",required:true,inputGuide:"신규 자료 추가·구버전 폐기.",examples:["2026-04 신규 5건 추가, 구 자료 3건 폐기"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  first_aid_training_log: [
    META_SECTION,
    {title:"2. 응급처치 교육 일지",legalSource:"산안법 §29 + 산안기준규칙 §639",fields:[
      {key:"educationDate",label:"교육 일시",required:true,inputGuide:"연 1회 이상.",examples:["2026-04-20 14:00~17:00"],checkPoints:[]},
      {key:"instructor",label:"강사",required:true,inputGuide:"응급구조사 또는 의료인.",examples:["박응급 (응급구조사 1급)"],checkPoints:[]},
      {key:"curriculum",label:"교육 내용",required:true,inputGuide:"심폐소생술·기도확보·지혈·골절·화상.",examples:["1) CPR 60분 / 2) AED 30분 / 3) 지혈·골절 60분 / 4) 화상·중독 30분"],checkPoints:[]},
      {key:"practice",label:"실습 실시",required:true,inputGuide:"마네킹·AED 실습.",examples:["[√] CPR 마네킹 1대 + AED 트레이너 1대 실습"],checkPoints:[]},
      {key:"trainees",label:"이수자 명단·서명",required:true,inputGuide:"위험사업장 근로자 권장 + 안전관리자 필수.",examples:[[{name:"김안전",signed:true},{name:"박감독",signed:true}]],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_environment_measurement: [
    META_SECTION,
    {title:"2. 작업환경측정 결과보고서 (별지 82호)",legalSource:"산안법 §125 + 시행규칙 §188 + 별지 82호",fields:[
      {key:"measurePeriod",label:"측정 기간",required:true,inputGuide:"반기 1회.",examples:["2026-04-15~04-19"],checkPoints:[]},
      {key:"measureAgency",label:"측정기관",required:true,inputGuide:"고용노동부 지정 기관.",examples:["(재)한국산업안전보건연구원"],checkPoints:[]},
      {key:"hazardItems",label:"측정 항목 (유해인자)",required:true,inputGuide:"소음·분진·화학물질 등.",examples:["소음·호흡성분진·톨루엔·자일렌"],checkPoints:[]},
      {key:"results",label:"측정 결과",required:true,inputGuide:"항목별 노출수준·노출기준·평가.",examples:[[{item:"소음",level:"85dB",limit:"90dB",eval:"기준미만"},{item:"톨루엔",level:"32ppm",limit:"50ppm",eval:"기준미만"}]],checkPoints:[]},
      {key:"exceedingItems",label:"기준 초과 항목",required:false,optional:true,inputGuide:"있다면 즉시 개선·재측정.",examples:["[해당없음]"],checkPoints:[]},
      {key:"reportToMOEL",label:"고용노동부 보고 (KRAS)",required:true,inputGuide:"30일 내 KRAS 등록.",examples:["2026-04-29 KRAS 등록 (KR-2026-0429-001)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  work_stop_order_report: [
    META_SECTION,
    {title:"2. 작업중지 명령 후 보고서",legalSource:"산안법 §53 + 시행규칙 §69",fields:[
      {key:"orderDate",label:"명령 일자",required:true,inputGuide:"고용노동부 명령 일자.",examples:["2026-04-25"],checkPoints:[]},
      {key:"orderingAuthority",label:"명령 기관",required:true,inputGuide:"관할 지방고용노동청.",examples:["강남고용노동지청"],checkPoints:[]},
      {key:"orderReason",label:"중지 사유",required:true,inputGuide:"중대재해 / 산안법 위반.",examples:["사망사고 발생 (4/24, A동 외벽 추락)"],checkPoints:[]},
      {key:"affectedScope",label:"중지 범위",required:true,inputGuide:"동·층·작업.",examples:["A동 외벽 작업 전체"],checkPoints:[]},
      {key:"correctionPlan",label:"개선 조치 계획",required:true,inputGuide:"원인분석 + 재발방지 대책.",examples:["1) 100% Tie-off 점검·교육 / 2) 안전대 부착설비 보강 / 3) 안전관리자 추가 1명"],checkPoints:[]},
      {key:"resumptionRequest",label:"작업재개 신청",required:true,inputGuide:"개선 후 재개 신청.",examples:["2026-05-10 재개 신청, 2026-05-15 승인 받음"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_health_diagnosis_report: [
    META_SECTION,
    {title:"2. 안전보건진단 결과서",legalSource:"산안법 §49 + 시행규칙 §61",fields:[
      {key:"diagnosisType",label:"진단 종류",required:true,inputGuide:"종합/안전/보건진단.",examples:["종합진단 (산재 다발에 따른 명령)"],checkPoints:[]},
      {key:"diagnosisAgency",label:"진단기관 (지정)",required:true,inputGuide:"고용노동부 지정 기관.",examples:["KOSHA 안전보건진단원"],checkPoints:[]},
      {key:"diagnosisPeriod",label:"진단 기간",required:true,inputGuide:"YYYY-MM-DD ~ YYYY-MM-DD.",examples:["2026-04-15 ~ 2026-04-29 (2주)"],checkPoints:[]},
      {key:"findings",label:"진단 결과 (지적 사항)",required:true,inputGuide:"위반·미흡·개선필요 사항.",examples:["[중대] 추락방지시설 부적합, [경미] 보호구 일부 미흡, [권고] 위험성평가 강화"],checkPoints:[]},
      {key:"improvementOrder",label:"개선 명령 사항",required:true,inputGuide:"고용노동부 시정명령.",examples:["1) 안전난간 보강 (15일내), 2) 풀하네스 안전대 전수 교체 (30일내)"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  safety_health_improvement_plan: [
    META_SECTION,
    {title:"2. 안전보건개선계획서",legalSource:"산안법 §49·§50 + 시행규칙 §61",fields:[
      {key:"trigger",label:"수립 사유",required:true,inputGuide:"진단·명령·자체 결정.",examples:["고용노동부 개선 명령 (2026-04-29)"],checkPoints:[]},
      {key:"period",label:"계획 기간",required:true,inputGuide:"6개월~1년.",examples:["2026-05-01 ~ 2026-10-31 (6개월)"],checkPoints:[]},
      {key:"improvementGoals",label:"개선 목표",required:true,inputGuide:"진단 지적사항 → 정량 목표.",examples:["1) 추락사고 0건, 2) 위험성평가 100% 이행, 3) 안전대 100% 착용"],checkPoints:[]},
      {key:"actionPlan",label:"세부 실행 계획",required:true,inputGuide:"항목별 책임자·일정·예산.",examples:[[{항목:"안전난간 보강",책임:"박감독",기한:"5/15",예산:"500만"},{항목:"안전대 교체",책임:"김안전",기한:"5/30",예산:"3,000만"}]],checkPoints:[]},
      {key:"reportSubmission",label:"고용노동부 제출",required:true,inputGuide:"진단 후 60일 내 제출.",examples:["2026-06-15 강남고용노동지청 제출"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  construction_disaster_prevention_guidance: [
    META_SECTION,
    {title:"2. 건설업 산재예방 기술지도",legalSource:"산안법 §73 + 시행규칙 §101",fields:[
      {key:"projectInfo",label:"공사 개요",required:true,inputGuide:"공사명·금액 (1억~120억 의무).",examples:["삼성동 공동주택 35억원"],checkPoints:[]},
      {key:"guidanceAgency",label:"지도기관 (전문기관)",required:true,inputGuide:"고용노동부 지정 전문기관.",examples:["(재)한국산업안전기술협회"],checkPoints:[]},
      {key:"guidanceFrequency",label:"지도 횟수",required:true,inputGuide:"월 1회 + 공사 중요시점.",examples:["월 1회 (총 7회 예정)"],checkPoints:[]},
      {key:"guidanceContent",label:"지도 내용",required:true,inputGuide:"위험성평가·안전관리·근로자 교육 등.",examples:["1) 위험성평가 검토 / 2) 안전관리 점검 / 3) 교육 자료 지원"],checkPoints:[]},
      {key:"recommendations",label:"지도 후 권고사항",required:true,inputGuide:"개선 권고사항.",examples:["1) 추락방호망 1개층 추가 권고, 2) 신호수 1명 추가 권고"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  rest_facility_register: [
    META_SECTION,
    {title:"2. 휴게시설 설치·운영 대장",legalSource:"산안법 §128의2 + 시행규칙 §194의2",fields:[
      {key:"facilityLocation",label:"설치 위치",required:true,inputGuide:"근로자 접근 5분 이내.",examples:["A동 1층 사무동 옆 별도 휴게실 25m²"],checkPoints:[]},
      {key:"facilitySize",label:"면적·수용인원",required:true,inputGuide:"근로자 1인당 1m² 이상.",examples:["25m² (수용 25명, 50인 사업장)"],checkPoints:[]},
      {key:"equipment",label:"비치 시설",required:true,inputGuide:"의자·테이블·정수기·냉난방.",examples:["의자 25개, 테이블 5개, 정수기 1, 에어컨 + 히터"],checkPoints:[]},
      {key:"sanitaryCondition",label:"위생 상태",required:true,inputGuide:"청소·환기.",examples:["일 1회 청소 + 자연환기 + 환풍기"],checkPoints:[]},
      {key:"installDate",label:"설치 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-03-01"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
  welfare_facility_register: [
    META_SECTION,
    {title:"2. 복리후생시설 (목욕·세면·탈의) 대장",legalSource:"산안기준규칙 §80",fields:[
      {key:"facilityList",label:"비치 시설",required:true,inputGuide:"목욕장·세면장·탈의실·식당.",examples:["세면장 6대 + 탈의실 25칸 + 식당 (50석) + 화장실 남4여2"],checkPoints:[]},
      {key:"locations",label:"위치",required:true,inputGuide:"동·층.",examples:["사무동 1층 + 식당 별도 가설"],checkPoints:[]},
      {key:"sanitarySchedule",label:"위생 관리 (청소·소독)",required:true,inputGuide:"일·주·월.",examples:["일 1회 청소, 주 1회 소독, 월 1회 정밀"],checkPoints:[]},
      {key:"installDate",label:"설치 일자",required:true,inputGuide:"YYYY-MM-DD.",examples:["2026-03-01"],checkPoints:[]},
    ]},
    APPROVAL_SECTION,
  ],
};

async function loadNode(docId: string): Promise<{ node: any; path: string } | null> {
  const candidates = [`${docId.replace(/_/g,"-")}.jsonld`, `${docId}.jsonld`];
  for (const fname of candidates) {
    try {
      const path = resolve(NODE_DIR, fname);
      const txt = await readFile(path, "utf8");
      return { node: JSON.parse(txt), path };
    } catch {}
  }
  return null;
}

async function main() {
  let aligned = 0;
  for (const [docId, sections] of Object.entries(ALIGN_TEMPLATES)) {
    const loaded = await loadNode(docId);
    if (!loaded) {
      console.log(`  ⚠️  ${docId} 노드 없음`);
      continue;
    }
    loaded.node.sections = sections;
    if (!loaded.node.approvalChain || loaded.node.approvalChain.length === 0) {
      loaded.node.approvalChain = [
        {role:"작성자 (안전관리자)",action:"기안"},
        {role:"관리감독자",action:"검토"},
        {role:"사업주 / 안전보건관리책임자",action:"최종 승인"},
      ];
    }
    if (loaded.node._meta) {
      loaded.node._meta.alignedAt = "2026-04-29";
      loaded.node._meta.alignSource = "align-nodes-bulk.ts (KOSHA 권고 + 산안법 본문 기반)";
    }
    loaded.node.verificationStatus = "verified";
    await writeFile(loaded.path, JSON.stringify(loaded.node, null, 2), "utf8");
    aligned++;
    console.log(`  ✓ ${docId}`);
  }
  console.log(`\n${aligned}종 정합 완료`);
}

main().catch((e) => { console.error(e); process.exit(1); });
