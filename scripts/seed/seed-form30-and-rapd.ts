#!/usr/bin/env tsx
/**
 * seed-form30-and-rapd.ts (v0.14 근본정정 #2·#3)
 *
 * 1. 산업재해조사표 — 시행규칙 별지 제30호서식 정밀 매핑 (30+ 필드)
 * 2. 위험성평가 정기·수시 — 고시 §15 ③ 4항목 표 추가
 *
 * 교차 검증 외부 평가:
 *   - S4 산재조사표 42% → 70%+
 *   - S2 위험성평가 정기 55% → 80%+
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

// ─── 별지 제30호서식 산업재해조사표 (정밀) ───
const ACCIDENT_REPORT_SECTIONS = [
  {
    title: "1. 사업장 정보 (별지 30호서식 ①)",
    legalSource: "시행규칙 §73 + 별지 30호서식",
    fields: [
      { key: "businessRegNo", label: "사업자등록번호", required: true },
      { key: "industryCode", label: "산재관리번호 (고용보험)", required: true },
      { key: "siteName", label: "사업장명·소재지", required: true },
      { key: "industry", label: "업종·세부공종 (KSIC 5자리)", required: true },
      { key: "ownerName", label: "사업주 성명·연락처", required: true },
      { key: "totalWorkforce", label: "근로자 수 (정규·일용 분리)", required: true },
      { key: "workplaceType", label: "원수급/하수급 (원하청 관계)", required: true },
      { key: "developerName", label: "건설공사 발주자 (해당 시)", required: false },
    ],
  },
  {
    title: "2. 재해자 인적사항 (별지 30호서식 ②)",
    legalSource: "별지 30호서식 ②",
    fields: [
      { key: "injuredName", label: "성명", required: true },
      { key: "injuredBirthDate", label: "생년월일", required: true },
      { key: "injuredGender", label: "성별", required: true },
      { key: "injuredNationality", label: "국적 (외국인의 경우 체류자격)", required: true },
      { key: "injuredAddress", label: "주소·연락처", required: true },
      { key: "injuredOccupation", label: "직종 (구체)", required: true },
      { key: "injuredCareer", label: "근무경력 (입사일·총 경력)", required: true },
      { key: "employmentType", label: "고용형태 (정규·계약·일용·파견 등)", required: true },
      { key: "workForm", label: "근무형태 (상용·임시·기간제·파견)", required: true },
      { key: "wageType", label: "임금형태 (월급·시급·도급)", required: false },
    ],
  },
  {
    title: "3. 재해 발생 정보 (별지 30호서식 ③)",
    legalSource: "별지 30호서식 ③",
    fields: [
      { key: "occurrenceDate", label: "발생 일시 (날짜·요일·시각)", required: true },
      { key: "occurrenceLocation", label: "발생 장소 (사업장·작업위치 구체)", required: true },
      { key: "circumstances", label: "재해 발생 경위 (시간 순서)", required: true },
      { key: "directCause", label: "직접 원인", required: true },
      { key: "rootCause", label: "근본 원인 (관리·교육·시설 등)", required: true },
      { key: "accidentType", label: "재해 발생 형태 (떨어짐·끼임·부딪힘 등 KOSHA 분류)", required: true },
      { key: "injuryType", label: "상해 종류 (골절·화상·중독 등)", required: true },
      { key: "injuryPart", label: "상해 부위", required: true },
      { key: "severity", label: "재해 정도 (사망·휴업일수·부상등급)", required: true },
      { key: "agentObject", label: "기인물 (사고를 일으킨 물체·기계)", required: true },
      { key: "sourceObject", label: "가해물 (직접 인체에 가한 물체)", required: true },
    ],
  },
  {
    title: "4. 즉시·재발방지 조치 (별지 30호서식 ④)",
    legalSource: "별지 30호서식 ④ + 산안법 §57 ②",
    fields: [
      { key: "immediateAction", label: "즉시 조치사항 (응급·신고·작업중지 등)", required: true },
      { key: "preventionPlan", label: "재발 방지 대책 (구체적·기한 명시)", required: true },
      { key: "responsiblePerson", label: "이행 책임자·기한", required: true },
    ],
  },
  {
    title: "5. 작성자·확인 (별지 30호서식 ⑤)",
    legalSource: "별지 30호서식 ⑤ + 시행규칙 §73 ③",
    fields: [
      { key: "preparedByName", label: "작성자 성명·직위", required: true },
      { key: "preparedByPhone", label: "작성자 연락처", required: true },
      { key: "workerRepConfirm", label: "근로자대표 확인·서명·일자", required: true },
      { key: "workerRepDissent", label: "근로자대표 이견 (있으면 첨부)", required: false },
      { key: "submitDate", label: "관할 지방고용노동관서 제출일 (1개월 이내)", required: true },
      { key: "submittedTo", label: "제출 관서명·접수번호", required: true },
    ],
  },
];

// ─── 위험성평가 §15 ③ 4항목 정기 평가 추가 섹션 ───
const REGULAR_REVIEW_SECTION = {
  title: "정기 평가 4항목 검토 (위험성평가 고시 §15 ③ 1~4호)",
  legalSource: "위험성평가 고시 §15 ③ 1~4호",
  fields: [
    { key: "review_aging", label: "1. 기계·기구·설비 등의 기간 경과에 의한 성능 저하", required: true },
    { key: "review_workerChange", label: "2. 근로자의 교체 등에 수반하는 안전·보건 지식·경험 변화", required: true },
    { key: "review_newKnowledge", label: "3. 안전·보건과 관련되는 새로운 지식의 습득", required: true },
    { key: "review_controlValidity", label: "4. 현재 수립된 위험성 감소대책의 유효성 등", required: true },
  ],
};

// ─── 수시평가 §15 ② 6항목 ad_hoc 평가 추가 섹션 ───
const ADHOC_REVIEW_SECTION = {
  title: "수시 평가 발생 사유 (위험성평가 고시 §15 ② 1~6호)",
  legalSource: "위험성평가 고시 §15 ② 1~6호",
  fields: [
    { key: "trigger_facility", label: "1. 건설물 설치·이전·변경·해체", required: false },
    { key: "trigger_machinery", label: "2. 기계·기구·설비·원재료 신규 도입·변경", required: false },
    { key: "trigger_maintenance", label: "3. 정비·보수 (반복적 작업 제외)", required: false },
    { key: "trigger_method", label: "4. 작업방법·절차 신규 도입·변경", required: false },
    { key: "trigger_accident", label: "5. 중대산업사고 또는 산업재해 발생 (휴업 이상)", required: false },
    { key: "trigger_other", label: "6. 그 밖에 사업주 필요 판단", required: false },
  ],
};

(async () => {
  // 1. 산업재해조사표 — 별지 30호서식 정밀
  {
    const path = resolve(DOCS_DIR, "industrial-accident-report.jsonld");
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      _meta?: Record<string, unknown>;
    };
    node.sections = ACCIDENT_REPORT_SECTIONS;
    node.requiredFields = ACCIDENT_REPORT_SECTIONS.flatMap((s) =>
      s.fields.map((f) => ({ key: f.key, label: f.label, source: s.legalSource ?? "" })),
    );
    const meta = (node._meta ?? {}) as Record<string, unknown>;
    meta.standardForm = "고용노동부 시행규칙 별지 제30호서식 (2024-08-26 개정)";
    meta.documentCategory = "report";
    meta.coreSectionsUpdatedAt = "2026-04-27";
    node._meta = meta;
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
    const fc = ACCIDENT_REPORT_SECTIONS.reduce((s, sec) => s + sec.fields.length, 0);
    console.log(`✓ industrial_accident_report: 별지 30호서식 ${ACCIDENT_REPORT_SECTIONS.length}섹션 ${fc}필드`);
    console.log(`  이전: 5섹션 14필드 → 이후: ${ACCIDENT_REPORT_SECTIONS.length}섹션 ${fc}필드`);
  }

  // 2. regular_risk_assessment — §15 ③ 4항목 추가
  for (const docId of ["regular_risk_assessment", "monthly_risk_assessment"]) {
    const path = resolve(DOCS_DIR, docId.replace(/_/g, "-") + ".jsonld");
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      sections?: unknown[];
    };
    const sections = (node.sections as Array<{ title: string }> | undefined) ?? [];
    const exists = sections.some((s) => s.title.includes("§15 ③"));
    if (!exists) {
      sections.push(REGULAR_REVIEW_SECTION);
      node.sections = sections;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
      console.log(`✓ ${docId}: §15 ③ 4항목 표 추가`);
    } else {
      console.log(`· ${docId}: 이미 §15 ③ 포함`);
    }
  }

  // 3. ad_hoc_risk_assessment — §15 ② 6항목 추가
  {
    const path = resolve(DOCS_DIR, "ad-hoc-risk-assessment.jsonld");
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      sections?: unknown[];
    };
    const sections = (node.sections as Array<{ title: string }> | undefined) ?? [];
    const exists = sections.some((s) => s.title.includes("§15 ②"));
    if (!exists) {
      sections.push(ADHOC_REVIEW_SECTION);
      node.sections = sections;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
      console.log(`✓ ad_hoc_risk_assessment: §15 ② 6항목 표 추가`);
    } else {
      console.log(`· ad_hoc_risk_assessment: 이미 §15 ② 포함`);
    }
  }

  console.log(`\n✓ 근본정정 #2·#3 완료`);
})();
