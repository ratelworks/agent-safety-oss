#!/usr/bin/env tsx
/**
 * 행정·신고·보고 21개 doc에 sections + fields 구축.
 * 카테고리별 표준 양식 (산안법·시행규칙 본문 기반).
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "documents");

const TEMPLATES: Record<string, any[]> = {
  // ── 안전인증·검사·자율안전 신청서 (산안법 §83·§89·§93) ──
  "safety-certification-application": [
    { title: "신청자 정보", legalSource: "산안법 §83 + 시행규칙 §74",
      fields: [
        { key: "applicantName", label: "제조·수입자 회사명·주소", required: true },
        { key: "businessNo", label: "사업자등록번호", required: true },
        { key: "representative", label: "대표자 성명", required: true },
        { key: "contact", label: "연락처 (24시간)", required: true },
      ]},
    { title: "안전인증 대상 제품", legalSource: "산안법 §80 + 시행령 §74 + 별표 21 (13종)",
      fields: [
        { key: "productCategory", label: "안전인증 13종 분류", required: true },
        { key: "productName", label: "제품명·모델", required: true },
        { key: "specifications", label: "정격·규격·성능", required: true },
        { key: "safetyDevice", label: "방호장치·안전장치", required: true },
      ]},
    { title: "심사·결과", legalSource: "산안법 §83 + 시행규칙 §74",
      fields: [
        { key: "applicationDate", label: "신청 일자", required: true },
        { key: "result", label: "인증 결과 (적합/부적합)", required: true },
        { key: "kcsNumber", label: "KCs 인증번호", required: true },
        { key: "validUntil", label: "유효기간", required: true },
      ]},
  ],
  "voluntary-safety-confirmation-filing": [
    { title: "신고자 정보", legalSource: "산안법 §89 + 시행규칙 §80",
      fields: [
        { key: "applicantName", label: "제조·수입자 회사명·주소", required: true },
        { key: "businessNo", label: "사업자등록번호", required: true },
        { key: "representative", label: "대표자", required: true },
      ]},
    { title: "자율안전확인 대상", legalSource: "산안법 §89 + 시행령 §77 (21종)",
      fields: [
        { key: "productCategory", label: "자율안전확인 21종 분류", required: true },
        { key: "productName", label: "제품명·모델·규격", required: true },
        { key: "selfTestReport", label: "자율안전 시험·검사 결과", required: true },
      ]},
    { title: "신고·결과",
      fields: [
        { key: "filingDate", label: "신고 일자", required: true },
        { key: "kcsNumber", label: "KCs(s) 신고번호", required: true },
      ]},
  ],
  "safety-inspection-application": [
    { title: "신청자 정보", legalSource: "산안법 §93 + 시행규칙 §86",
      fields: [
        { key: "applicantName", label: "사용 사업주 회사명·소재지", required: true },
        { key: "siteAddress", label: "검사 대상 사업장", required: true },
        { key: "representative", label: "대표자·안전관리자", required: true },
      ]},
    { title: "검사 대상", legalSource: "산안법 §93 + 시행령 §78 (11종)",
      fields: [
        { key: "machineCategory", label: "안전검사 11종 분류", required: true },
        { key: "machineDetail", label: "기계명·제조사·정격", required: true },
        { key: "installDate", label: "설치 일자·사용 기간", required: true },
      ]},
    { title: "검사 결과",
      fields: [
        { key: "inspectionDate", label: "검사 일자·기관", required: true },
        { key: "result", label: "결과 (합격/부적합)", required: true },
        { key: "certificateNo", label: "검사필증 번호", required: true },
        { key: "nextInspection", label: "차기 검사 예정일", required: true },
      ]},
  ],

  // ── 선임·위촉 (산안법 §17·§19·§22·§23·기준규칙 §200) ──
  "safety-health-manager-appointment": [
    { title: "선임 메타", legalSource: "산안법 §17·§18 + 시행령 §16~§19",
      fields: [
        { key: "appointmentDate", label: "선임 일자", required: true },
        { key: "siteName", label: "사업장명·소재지", required: true },
        { key: "businessNo", label: "사업자등록번호·업종", required: true },
      ]},
    { title: "선임 대상자", legalSource: "산안법 시행령 별표 4 자격",
      fields: [
        { key: "name", label: "성명·생년월일", required: true },
        { key: "qualification", label: "자격증 (안전관리자/보건관리자)", required: true },
        { key: "experience", label: "관련 경력", required: true },
        { key: "role", label: "직위·소속·겸직 여부", required: true },
      ]},
    { title: "선임 사유·신고",
      fields: [
        { key: "reason", label: "선임 사유 (신규·교체)", required: true },
        { key: "previousManager", label: "전임자 (교체 시)", required: true },
        { key: "filingDate", label: "지방고용노동청 신고 일자", required: true },
      ]},
  ],
  "industrial-physician-appointment": [
    { title: "선임 메타", legalSource: "산안법 §22 + 시행령 §29 (50인↑)",
      fields: [
        { key: "appointmentDate", label: "선임 일자", required: true },
        { key: "siteName", label: "사업장명", required: true },
        { key: "workforce", label: "상시 근로자 수", required: true },
      ]},
    { title: "산업보건의 정보",
      fields: [
        { key: "name", label: "성명·생년월일", required: true },
        { key: "license", label: "의사면허번호", required: true },
        { key: "specialty", label: "전공·산업의학 경력", required: true },
        { key: "schedule", label: "근무일·근무시간", required: true },
      ]},
    { title: "위탁계약 (외부 위탁 시)",
      fields: [
        { key: "contractor", label: "수탁 의료기관명", required: true },
        { key: "contractTerm", label: "계약기간·갱신", required: true },
      ]},
  ],
  "honorary-safety-supervisor-appointment": [
    { title: "위촉 메타", legalSource: "산안법 §23 + 시행령 §32",
      fields: [
        { key: "appointmentDate", label: "위촉 일자", required: true },
        { key: "term", label: "임기 (2년)", required: true },
        { key: "scope", label: "위촉 사업장·범위", required: true },
      ]},
    { title: "감독관 정보",
      fields: [
        { key: "name", label: "성명·생년월일", required: true },
        { key: "affiliation", label: "추천 단체·소속", required: true },
        { key: "experience", label: "산업재해 예방활동 경력", required: true },
      ]},
  ],
  "signaler-appointment": [
    { title: "지정 메타", legalSource: "기준규칙 §200·§220 (양중·차량계 신호수 의무)",
      fields: [
        { key: "appointmentDate", label: "지정 일자·작업기간", required: true },
        { key: "workType", label: "작업 종류 (타워크레인·차량계 등)", required: true },
      ]},
    { title: "신호수 정보",
      fields: [
        { key: "name", label: "성명·연락처", required: true },
        { key: "training", label: "신호수 교육 이수 일자·시간", required: true },
        { key: "signalMethod", label: "신호 방법 (무전기·수기·호각)", required: true },
      ]},
  ],

  // ── 보건관리 (산안법 §125~§142) ──
  "health-examination-records": [
    { title: "검진 메타", legalSource: "산안법 §129·§130 (일반·특수건강진단)",
      fields: [
        { key: "examDate", label: "검진 일자", required: true },
        { key: "examType", label: "검진 종류 (일반/특수/임시)", required: true },
        { key: "examiner", label: "검진 의료기관·의사", required: true },
      ]},
    { title: "근로자별 결과",
      fields: [
        { key: "workerInfo", label: "근로자 인적사항·직무", required: true },
        { key: "exposureFactor", label: "유해인자 노출 정보", required: true },
        { key: "result", label: "검진 결과 (정상/요관찰/요치료/근로금지)", required: true },
        { key: "judgment", label: "판정 (산안법 시행규칙 별표 22)", required: true },
      ]},
    { title: "통보·보존",
      fields: [
        { key: "notificationDate", label: "근로자 통보 일자", required: true },
        { key: "retention", label: "보존 (5년·30년 발암성)", required: true },
      ]},
  ],
  "health-examination-followup": [
    { title: "사후조치 메타", legalSource: "산안법 §134·§138 (사후조치·근로금지)",
      fields: [
        { key: "examDate", label: "검진 일자·검진종류", required: true },
        { key: "abnormalCount", label: "이상자 수 / 전체", required: true },
      ]},
    { title: "근로자별 사후조치",
      fields: [
        { key: "workerInfo", label: "근로자 (성명·직무·노출인자)", required: true },
        { key: "judgmentResult", label: "판정 결과·소견", required: true },
        { key: "actionTaken", label: "조치 (작업전환·시간단축·야간제한·시설개선)", required: true },
        { key: "doctorOpinion", label: "산업보건의·의사 소견", required: true },
        { key: "followupDate", label: "사후조치 이행 일자", required: true },
      ]},
    { title: "근로금지 (있는 경우)",
      fields: [
        { key: "workProhibition", label: "질병자 근로금지 (산안법 §138)", required: false },
      ]},
  ],
  "work-environment-measurement": [
    { title: "측정 메타", legalSource: "산안법 §125 + 시행규칙 §186 (6개월·1년)",
      fields: [
        { key: "measureDate", label: "측정 일자·주기", required: true },
        { key: "measureAgency", label: "측정 기관·자격", required: true },
        { key: "siteName", label: "사업장명·작업장", required: true },
      ]},
    { title: "유해인자별 측정 결과",
      fields: [
        { key: "factors", label: "측정 유해인자 (분진·소음·유기용제 등)", required: true },
        { key: "measureResult", label: "측정값·노출기준 비교", required: true },
        { key: "exceedanceCount", label: "노출기준 초과 항목·인원", required: true },
      ]},
    { title: "사후조치",
      fields: [
        { key: "improvement", label: "초과 시 개선조치", required: true },
        { key: "notificationDate", label: "근로자 통보 (산안법 §126)", required: true },
      ]},
  ],
  "work-environment-measurement-notification": [
    { title: "통지 메타", legalSource: "산안법 §126 (근로자 통보 의무)",
      fields: [
        { key: "measureDate", label: "측정 일자·주기", required: true },
        { key: "notificationDate", label: "통지 일자 (측정 후 30일 내)", required: true },
        { key: "method", label: "통지 방법 (게시·서면)", required: true },
      ]},
    { title: "통지 내용",
      fields: [
        { key: "factors", label: "유해인자별 결과", required: true },
        { key: "exceedance", label: "노출기준 초과 항목 + 개선계획", required: true },
        { key: "postedLocation", label: "게시 위치 (잘 보이는 곳)", required: true },
      ]},
  ],
  "asbestos-investigation-report": [
    { title: "조사 메타", legalSource: "산안법 §142 + 시행규칙 §175 (50㎡↑ 기관조사 의무)",
      fields: [
        { key: "buildingInfo", label: "건축물·설비 정보 (소유주·면적·연도)", required: true },
        { key: "investigationDate", label: "조사 일자", required: true },
        { key: "investigator", label: "조사기관·자격", required: true },
        { key: "investigationType", label: "일반조사 / 기관조사", required: true },
      ]},
    { title: "조사 결과",
      fields: [
        { key: "samplingPoint", label: "시료 채취 지점·점수", required: true },
        { key: "analysisResult", label: "분석 결과 (석면 함유 여부·종류·함유율)", required: true },
        { key: "asbestosMap", label: "석면지도 (위치·면적)", required: true },
      ]},
    { title: "후속 조치",
      fields: [
        { key: "demolitionPlan", label: "해체 작업계획 (석면 함유 시)", required: true },
        { key: "workerNotification", label: "근로자 통지", required: true },
      ]},
  ],

  // ── 도급사업 (산안법 §63~§77) ──
  "contractor-safety-council": [
    { title: "회의 메타", legalSource: "산안법 §75 + 시행령 §63 (도급 안전보건협의체)",
      fields: [
        { key: "meetingDate", label: "회의 일자", required: true },
        { key: "siteName", label: "사업장명·도급규모", required: true },
        { key: "agenda", label: "회의 의제", required: true },
      ]},
    { title: "참석자 (원·하도급)",
      fields: [
        { key: "primary", label: "원도급 대표·관리감독자", required: true },
        { key: "subContractors", label: "하도급사 안전책임자 (사별)", required: true },
        { key: "totalParticipants", label: "총 참석 인원", required: true },
      ]},
    { title: "협의 사항·결정",
      fields: [
        { key: "discussions", label: "협의 안건·내용", required: true },
        { key: "decisions", label: "결정·이행 계획", required: true },
        { key: "nextMeeting", label: "다음 회의", required: true },
      ]},
    { title: "합동 순회점검 (산안법 §64 ① 1호)",
      fields: [
        { key: "jointInspection", label: "합동 순회점검 결과·시정조치", required: true },
      ]},
  ],

  // ── 보고서·진단 (산안법 §47·§11·중처법) ──
  "safety-health-diagnosis-report": [
    { title: "진단 메타", legalSource: "산안법 §47 + 시행규칙 §55 (장관 명령)",
      fields: [
        { key: "orderDate", label: "고용노동부 명령 일자·사유", required: true },
        { key: "diagnosticAgency", label: "진단기관·자격", required: true },
        { key: "diagnosticDate", label: "진단 일자·기간", required: true },
      ]},
    { title: "진단 결과",
      fields: [
        { key: "siteRating", label: "사업장 종합 등급", required: true },
        { key: "findings", label: "발견 위험요인·결함 (분야별)", required: true },
        { key: "recommendations", label: "개선조치 권고", required: true },
      ]},
    { title: "이행계획",
      fields: [
        { key: "improvementPlan", label: "개선 계획·기한", required: true },
        { key: "reportSubmission", label: "고용노동부 제출 일자", required: true },
      ]},
  ],
  "safety-health-information-provision": [
    { title: "제공 메타", legalSource: "산안법 §11 + 시행규칙 §73",
      fields: [
        { key: "contractDate", label: "도급계약 체결 일자", required: true },
        { key: "primaryParty", label: "도급인 (원도급)", required: true },
        { key: "subParty", label: "수급인 (하도급)", required: true },
      ]},
    { title: "제공 내용",
      fields: [
        { key: "workEnvironment", label: "작업환경 정보", required: true },
        { key: "hazards", label: "유해·위험요인", required: true },
        { key: "preventiveMeasures", label: "예방조치 사항", required: true },
        { key: "msdsList", label: "취급 화학물질 MSDS 목록", required: true },
      ]},
  ],
  "construction-disaster-prevention-guidance": [
    { title: "지도 메타", legalSource: "산안법 §73 + 시행령 §59 (1억~120억)",
      fields: [
        { key: "guidanceDate", label: "지도 일자·횟수 (월 1회)", required: true },
        { key: "guidanceAgency", label: "건설재해예방전문지도기관·자격", required: true },
        { key: "siteName", label: "건설공사명·공사규모", required: true },
      ]},
    { title: "지도 내용",
      fields: [
        { key: "findings", label: "발견 위험요인·결함", required: true },
        { key: "recommendations", label: "지도·권고 사항", required: true },
        { key: "verifiedActions", label: "전월 지적사항 이행 확인", required: true },
      ]},
    { title: "보고",
      fields: [
        { key: "siteResponse", label: "사업주 시정조치 계획", required: true },
        { key: "nextGuidance", label: "차기 지도 일정", required: true },
      ]},
  ],
  "severe-accident-compliance": [
    { title: "점검 메타", legalSource: "중처법 §4·§5 + 시행령 §4·§5",
      fields: [
        { key: "checkDate", label: "점검 일자·반기 1회", required: true },
        { key: "ceoName", label: "안전보건확보의무자 (CEO·경영책임자)", required: true },
      ]},
    { title: "9대 의무 이행 점검",
      fields: [
        { key: "policy", label: "1. 안전보건방침·목표", required: true },
        { key: "organization", label: "2. 안전보건 전담조직", required: true },
        { key: "riskAssessment", label: "3. 위험성평가 점검", required: true },
        { key: "budget", label: "4. 안전보건 예산 확보·집행", required: true },
        { key: "manager", label: "5. 안전보건관리책임자 권한·예산 부여", required: true },
        { key: "trainingHours", label: "6. 종사자 안전보건교육 점검", required: true },
        { key: "subcontract", label: "7. 도급·용역·위탁 시 평가기준", required: true },
        { key: "communication", label: "8. 종사자 의견 청취 절차", required: true },
        { key: "emergency", label: "9. 비상조치계획 수립·점검", required: true },
      ]},
    { title: "이행 결과·개선",
      fields: [
        { key: "complianceRating", label: "이행 등급 (적합/일부/미흡)", required: true },
        { key: "correctiveAction", label: "개선조치", required: true },
      ]},
  ],

  // ── 보호구·교육 ──
  "ppe-register": [
    { title: "보호구 등록", legalSource: "산안법 §32·기준규칙 §32",
      fields: [
        { key: "ppeName", label: "보호구 종류·등급", required: true },
        { key: "kcsNumber", label: "KCs 안전인증번호", required: true },
        { key: "manufacturer", label: "제조사·모델·구입일", required: true },
        { key: "quantity", label: "수량·재고", required: true },
      ]},
    { title: "지급 기록",
      fields: [
        { key: "recipient", label: "지급 받은 근로자 (성명·서명)", required: true },
        { key: "issueDate", label: "지급 일자", required: true },
        { key: "expectedReplacement", label: "예상 교체 주기", required: true },
      ]},
    { title: "교체·폐기",
      fields: [
        { key: "replacementHistory", label: "교체 이력·사유", required: true },
        { key: "disposalDate", label: "폐기 일자·사유", required: true },
      ]},
  ],
  "monthly-education-log": [
    { title: "교육 메타", legalSource: "산안법 §29 + 시행규칙 §26·별표 4·5",
      fields: [
        { key: "educationDate", label: "교육 일자·시간", required: true },
        { key: "educationType", label: "교육 종류 (정기/신규/특별/관리감독자)", required: true },
        { key: "instructor", label: "강사·자격", required: true },
        { key: "duration", label: "교육 시간 (정기 6시간·신규 8시간·관리감독자 16시간)", required: true },
      ]},
    { title: "교육 대상·내용",
      fields: [
        { key: "trainees", label: "이수자 명단·서명부", required: true },
        { key: "curriculum", label: "교육 내용 (별표 5 표준)", required: true },
        { key: "evaluation", label: "이해도 평가·시험", required: true },
      ]},
    { title: "기록·보존",
      fields: [
        { key: "completionRate", label: "이수율", required: true },
        { key: "retention", label: "이수증 보존 (5년)", required: true },
      ]},
  ],

  // ── 통합 wrapper (작업계획·허가서) ──
  "work-plan": [
    { title: "통합 작업계획서 — 별표 4 13종 중 적용", legalSource: "기준규칙 §38 + 별표 4",
      fields: [
        { key: "workType", label: "작업 종류 (1·2·3·5·6·7·8·10·11호 — 건설 9종)", required: true },
        { key: "subDocId", label: "해당 작업계획서 (work_plan_*)", required: true },
        { key: "siteName", label: "사업장·공사명", required: true },
        { key: "supervisor", label: "작업지휘자", required: true },
      ]},
  ],
  "work-permit": [
    { title: "통합 작업허가서 — 5종 위험작업", legalSource: "기준규칙 §239·§619·§299·§428·§168",
      fields: [
        { key: "permitType", label: "허가 종류 (화기/밀폐공간/정전/고소/중량물)", required: true },
        { key: "subDocId", label: "해당 허가서 (work_permit_*)", required: true },
        { key: "validUntil", label: "허가 유효시간", required: true },
        { key: "responsiblePerson", label: "책임자", required: true },
      ]},
  ],
};

async function main() {
  let updated = 0, skipped = 0;
  for (const [docKey, sections] of Object.entries(TEMPLATES)) {
    const path = resolve(DOCS, `${docKey}.jsonld`);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      node.sections = sections;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      const fc = sections.reduce((s, sec) => s + sec.fields.length, 0);
      console.log(`  ✓ ${docKey}: ${sections.length} sections, ${fc} fields`);
      updated += 1;
    } catch (err) {
      console.warn(`  ✗ ${docKey}: ${(err as Error).message}`);
      skipped += 1;
    }
  }
  console.log(`\n[done] ${updated} 문서 sections 구축 (${skipped} skipped)`);
}

main().catch(console.error);
