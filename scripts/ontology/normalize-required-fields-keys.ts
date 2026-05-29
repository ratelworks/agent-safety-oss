#!/usr/bin/env tsx
/**
 * normalize-required-fields-keys.ts
 *
 * 19개 자동 변환 Document 노드의 requiredFields[*].key 를 한국어 슬러그 →
 * 영문 표준 슬러그로 일괄 정규화. reviewRules[*].checkFields 도 함께 정합.
 *
 * 외부 LLM 사용자가 자연어 ↔ key 자동 매핑 가능한 표준 패턴.
 * Facade P0-B 정정 (실 사용 시나리오에서 한국어 key 사용 불가 발견).
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

// 한국어 라벨 substring → 영문 표준 슬러그 매핑 (P9 교차 검증 진단 후 80+ 확대)
// 매칭 우선순위: 더 긴 라벨이 먼저 매칭되도록 정렬 후 적용
const LABEL_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  // 기본 메타
  { pattern: /^일자[·\-\s/]?시간|일자.*시간|date.*time/i, key: "dateTime" },
  { pattern: /^일자|작성일|평가.*일|회의일|점검일|작성[·\-]?일|진단\s*일자|선임\s*일자/, key: "date" },
  { pattern: /^시간|작업시간|회의시간/, key: "time" },
  { pattern: /^장소[·\-\s/]?공종|장소.*공종/, key: "locationAndWorkType" },
  { pattern: /^장소|작업장소|회의장소/, key: "location" },
  { pattern: /^공종|작업.*종류|작업명.*공종|작업명·공종/, key: "workType" },
  { pattern: /사업장명|현장명|공사명/, key: "siteName" },
  { pattern: /사업장\s*정보|사업장\s*개요/, key: "siteInfo" },
  // 인원·참여자
  { pattern: /참여\s*인원.*명단|참여인원.*명단|수강자\s*명단|참석자.*명단/, key: "participantsList" },
  { pattern: /^참여\s*인원|참여인원|참석.*인원/, key: "participants" },
  { pattern: /참여자\s*명단[·\-\s]?서명|참여자.*명단/, key: "participantsList" },
  { pattern: /진행자.*관리감독자|관리감독자.*성명|진행자.*성명/, key: "moderator" },
  { pattern: /^위원\s*명단|위원장|간사/, key: "committeeMembers" },
  { pattern: /^참여자\s*서명|^참석자\s*서명|^전원\s*서명|^서명$/, key: "signatures" },
  { pattern: /^인적사항|^근로자\s*인적사항/, key: "personalInfo" },
  // 위험·대책
  { pattern: /당일.*위험요인|당일.*주요.*위험|today.*hazard/i, key: "todayHazards" },
  { pattern: /^위험요인|^유해.*위험요인|^주요.*위험요인|^위험.*요인|추가\s*유해|추가\s*위험/, key: "hazards" },
  { pattern: /감소대책|위험성.*감소|control.*measure/i, key: "controls" },
  { pattern: /핵심.*안전.*수칙|안전수칙|safety.*rule/i, key: "safetyRules" },
  { pattern: /필요.*보호구|개인.*보호구|^보호구/, key: "ppe" },
  // 위험성평가 전용
  { pattern: /위험성.*등급|위험성.*결정|risk.*level|허용.*가능|잔존.*위험성/, key: "riskLevel" },
  { pattern: /빈도|발생.*빈도|frequency/i, key: "frequency" },
  { pattern: /강도|중대성|severity/i, key: "severity" },
  { pattern: /평가\s*방법|평가방법|kras|method/i, key: "assessmentMethod" },
  { pattern: /평가\s*유형|평가유형/, key: "assessmentType" },
  { pattern: /평가월|평가\s*년월/, key: "assessmentMonth" },
  { pattern: /평가단위|평가\s*단위/, key: "assessmentUnit" },
  { pattern: /발굴\s*출처|발굴출처|출처/, key: "discoverySource" },
  { pattern: /이행\s*기한|이행기한|deadline/i, key: "deadline" },
  { pattern: /재평가|재검토|재검토\s*항목/, key: "reReview" },
  // 트리거·변경
  { pattern: /^트리거|trigger|변경\s*사유/, key: "trigger" },
  { pattern: /변경\s*일자|change.*date/i, key: "changeDate" },
  { pattern: /변경\s*내용|change.*content/i, key: "changeContent" },
  { pattern: /실시규정/, key: "operationalRules" },
  { pattern: /사업\s*개시일|실착공일/, key: "businessStartDate" },
  { pattern: /작업\s*재개|재개\s*시점/, key: "resumePoint" },
  // 사고·재해
  { pattern: /재해\s*발생\s*일시|사고\s*발생\s*일시|발생\s*일시/, key: "accidentDateTime" },
  { pattern: /재해\s*발생\s*장소|사고\s*발생\s*장소|발생\s*장소/, key: "accidentLocation" },
  { pattern: /재해\s*유형|재해유형/, key: "accidentType" },
  { pattern: /재해\s*정도|사망.*중상|휴업일수/, key: "accidentSeverity" },
  { pattern: /^사망자|^부상자|재해자/, key: "casualties" },
  { pattern: /발생\s*경위|^사고\s*경위|^재해\s*경위/, key: "accidentNarrative" },
  { pattern: /발생\s*형태|사고\s*발생\s*형태/, key: "accidentForm" },
  { pattern: /기인물/, key: "causingAgent" },
  { pattern: /^사고\s*원인|^재해\s*원인|^발생\s*원인|원인분석|직접.*원인|간접.*원인/, key: "rootCause" },
  { pattern: /^재발.*방지|재발방지대책/, key: "preventiveMeasures" },
  { pattern: /^피해.*규모|피해규모/, key: "damageScope" },
  // 안전보건위·도급·협의체
  { pattern: /안건|회의\s*안건/, key: "agenda" },
  { pattern: /심의[·\-\s]?의결|심의의결|의결\s*사항/, key: "resolutions" },
  { pattern: /표결\s*결과/, key: "voteResult" },
  { pattern: /다음\s*회의|차회\s*회의/, key: "nextMeeting" },
  { pattern: /협의체\s*회의|협의\s*회의/, key: "councilMeeting" },
  { pattern: /합동\s*점검|합동\s*안전.*점검/, key: "jointInspection" },
  { pattern: /혼재작업|혼재\s*작업/, key: "concurrentWork" },
  { pattern: /신호.*통신|통신\s*체계/, key: "communicationSystem" },
  { pattern: /작업\s*시간.*분리|시간\s*장소\s*분리/, key: "timeLocationSeparation" },
  { pattern: /시정조치|이상\s*발견.*조치/, key: "correctiveActions" },
  // 의견·서명
  { pattern: /^근로자\s*질문.*의견|^근로자\s*의견|질문|의견/, key: "questions" },
  // MSDS·화학물질
  { pattern: /^화학물질|^위험물|chemical/i, key: "chemicalName" },
  { pattern: /CAS\s*번호|cas.*number/i, key: "casNumber" },
  { pattern: /공급자\s*정보|제조.*수입/, key: "supplierInfo" },
  { pattern: /화학제품과\s*회사/, key: "productAndCompany" },
  { pattern: /유해성.*위험성|유해성·위험성/, key: "hazardClassification" },
  { pattern: /구성성분|함유량/, key: "composition" },
  { pattern: /응급조치/, key: "emergencyResponse" },
  { pattern: /폭발.*화재.*대처|폭발\s*화재.*대처/, key: "fireExplosionResponse" },
  { pattern: /누출\s*사고|누출.*대처/, key: "leakResponse" },
  { pattern: /취급.*저장|저장방법/, key: "handlingStorage" },
  { pattern: /물리화학적|특성.*안정성|독성|환경.*폐기.*운송/, key: "physChemProperties" },
  { pattern: /물질\s*정보|msds|safety.*data.*sheet/i, key: "msdsInfo" },
  { pattern: /취급\s*부서|취급근로자|취급.*근로자/, key: "handlingDept" },
  { pattern: /교육\s*일지|교육\s*기록/, key: "educationLog" },
  // 보호구 관리
  { pattern: /^지급일|지급.*일자/, key: "issuedDate" },
  { pattern: /^반납일|반납.*일자/, key: "returnedDate" },
  { pattern: /^규격|^모델/, key: "model" },
  { pattern: /안전인증번호|자율안전확인.*번호|certification.*number/i, key: "certificationNumber" },
  { pattern: /수령자/, key: "recipient" },
  { pattern: /^수량|quantity/i, key: "quantity" },
  { pattern: /점검\s*결과|이상\s*유무/, key: "inspectionResult" },
  { pattern: /폐기|교환\s*사유/, key: "disposalReason" },
  // 교육
  { pattern: /^교육\s*시간|교육시간/, key: "educationHours" },
  { pattern: /^교육\s*내용|교육내용|^교육\s*과목|^교육\s*자료|사용\s*교재|ops|동영상/i, key: "educationContent" },
  { pattern: /교육\s*종류|^교육\s*유형|정기.*채용.*변경.*특별/, key: "educationType" },
  { pattern: /^강사|^교육.*강사/, key: "instructor" },
  { pattern: /^수강생|^교육.*대상자|^참여\s*근로자|수강자/, key: "trainees" },
  // 점검·작업허가
  { pattern: /^점검\s*항목|점검항목|inspection.*item|각\s*항목.*적정/i, key: "inspectionItems" },
  { pattern: /^허가.*기간|허가기간/, key: "permitPeriod" },
  { pattern: /^허가.*받은\s*자|허가권자/, key: "permitter" },
  { pattern: /^작업\s*책임자|책임자|supervisor/i, key: "supervisor" },
  // 안전·관리자 선임
  { pattern: /자격\s*증빙|자격\s*증명|자격증/, key: "qualificationProof" },
  { pattern: /선임\s*대상자|선임대상자/, key: "appointee" },
  { pattern: /업무\s*범위|직무\s*범위/, key: "dutyScope" },
  { pattern: /겸직\s*여부|겸직/, key: "concurrentDuty" },
  { pattern: /지방고용노동관서\s*신고|관할.*신고/, key: "labourOfficeNotification" },
  { pattern: /사업주\s*서명|날인/, key: "ownerSignature" },
  // 중처법·점검
  { pattern: /점검\s*기간|점검기간|반기\s*단위/, key: "inspectionPeriod" },
  { pattern: /안전보건관리체계|관리체계|관리체계.*이행/, key: "managementSystem" },
  { pattern: /안전보건\s*목표|경영방침/, key: "safetyGoals" },
  { pattern: /전담조직|업무\s*총괄/, key: "dedicatedOrg" },
  { pattern: /건강진단기관|진단기관/, key: "healthClinic" },
  { pattern: /진단\s*종류|건강진단\s*종류/, key: "examinationType" },
  { pattern: /진단\s*항목|건강진단\s*항목/, key: "examinationItems" },
  { pattern: /결과\s*판정|판정/, key: "resultJudgment" },
  { pattern: /사후관리|작업전환|근로시간\s*단축|치료/, key: "followupAction" },
  { pattern: /유소견자|작업환경\s*재측정/, key: "abnormalFollowup" },
  { pattern: /안전보건정보|사고이력|작업환경|기상/, key: "safetyHealthInfo" },
  // 작성자·승인
  { pattern: /^작성자|^기록자/, key: "author" },
  { pattern: /^확인자|^감독자/, key: "verifier" },
  { pattern: /^결재.*자|^승인.*자/, key: "approver" },
  // 작업환경측정
  { pattern: /측정일자|측정기관|측정\s*기관/, key: "measurementInfo" },
  { pattern: /측정\s*유해인자|측정\s*대상/, key: "measurementTarget" },
  { pattern: /노출기준|exposure.*limit/i, key: "exposureLimit" },
  { pattern: /측정\s*결과|TWA|STEL/, key: "measurementResult" },
  { pattern: /노출기준\s*대비|비율/, key: "exposureRatio" },
  { pattern: /초과\s*여부|개선조치/, key: "exceedanceStatus" },
  { pattern: /재측정|재.측정/, key: "reMeasurement" },
  { pattern: /측정자\s*자격/, key: "measurerQualification" },
  // 작업허가
  { pattern: /허가\s*종류|허가종류/, key: "permitType" },
  { pattern: /작업\s*장소$/, key: "workLocation" },
  { pattern: /작업\s*내용/, key: "workContent" },
  { pattern: /사전\s*조건|사전조건\s*점검/, key: "preConditions" },
  { pattern: /비상\s*절차|비상\s*연락망/, key: "emergencyProcedure" },
  { pattern: /허가자|허가권자/, key: "permitter" },
  // 작업계획서
  { pattern: /작업명$|작업명\s*\(별표/, key: "workName" },
  { pattern: /작업자\s*명단/, key: "workerList" },
  { pattern: /작업방법|작업\s*순서|작업방법.*순서/, key: "workMethod" },
  // 점검·합동점검
  { pattern: /지난주.*위험요인|이전.*위험요인/, key: "previousHazards" },
  { pattern: /지난주.*TBM|TBM\s*결과/, key: "previousTbmResults" },
  { pattern: /미이행/, key: "unfulfilled" },
  { pattern: /신규\s*위험|변경\s*사항/, key: "newHazardsChanges" },
  { pattern: /다음주.*점검|차주.*점검/, key: "nextWeekInspection" },
  // 중처법 9개 의무
  { pattern: /각\s*항목별\s*이행|이행\s*증빙/, key: "complianceEvidence" },
  // 정기 위험성평가
  { pattern: /최초평가.*수시평가|수시평가\s*결과\s*종합/, key: "previousAssessmentSummary" },
  // 산업재해조사
  { pattern: /사업주[·\-\s]?작성자\s*서명|사업주.*서명/, key: "ownerAuthorSignature" },
  // 첨부·기타
  { pattern: /^첨부|attachment/i, key: "attachments" },
  { pattern: /^비고|기타.*사항/, key: "remarks" },
  { pattern: /^기상|날씨|weather/i, key: "weather" },
];

function labelToKey(label: string, idx: number): string {
  for (const { pattern, key } of LABEL_PATTERNS) {
    if (pattern.test(label)) return key;
  }
  // fallback — field_N
  return `field_${idx + 1}`;
}

(async () => {
  const files = (await readdir(DOCS_DIR)).filter((f) => f.endsWith(".jsonld"));
  let updated = 0;
  let skipped = 0;
  for (const f of files) {
    const path = resolve(DOCS_DIR, f);
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      docId: string;
      verificationStatus?: string;
      requiredFields: Array<{ key: string; label: string; source: string }>;
      reviewRules: Array<{ rule: string; checkFields?: string[]; severity: string; legalBasis?: string }>;
    };

    // verified 수동 작성 노드는 영문 key 이미 정확 — skip (work-plan-excavation 등)
    if (node.verificationStatus === "verified") {
      skipped += 1;
      continue;
    }

    // requiredFields key 정규화 + 충돌 처리
    const used = new Set<string>();
    const oldToNew = new Map<string, string>();
    const newFields = node.requiredFields.map((field, idx) => {
      let key = labelToKey(field.label, idx);
      // 충돌 시 _2, _3 suffix
      if (used.has(key)) {
        for (let i = 2; i < 50; i += 1) {
          if (!used.has(`${key}_${i}`)) {
            key = `${key}_${i}`;
            break;
          }
        }
      }
      used.add(key);
      oldToNew.set(field.key, key);
      return { ...field, key };
    });

    // reviewRules.checkFields 도 정규화 (기존 한국어 슬러그 → 영문 매핑)
    const newRules = node.reviewRules.map((rule) => {
      if (!rule.checkFields) return rule;
      return {
        ...rule,
        checkFields: rule.checkFields.map((cf) => oldToNew.get(cf) ?? cf),
      };
    });

    node.requiredFields = newFields;
    node.reviewRules = newRules;
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
    updated += 1;
  }
  console.log(`[done] ${updated} 개 Document 정규화, ${skipped} 개 verified 노드 skip (수동 영문 key 보존)`);
})();
