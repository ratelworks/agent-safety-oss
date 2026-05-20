#!/usr/bin/env tsx
/**
 * seed-core-sections.ts (핵심 문서 정밀화)
 *
 * 실무 빈도 높은 핵심 5종에 sections 메타 추가 (fallback 모드 해소).
 *
 *  1. 위험성평가서 4종 (initial / regular / monthly / ad_hoc) — 위험성평가 고시 §15
 *  2. TBM 일지 — 위험성평가 고시 §15 ④ 3호 + 산안법 §29
 *  3. 산업재해 조사표 — 시행규칙 §73 + 별지 30호서식
 *  4. MSDS 등록부 — 산안법 §110
 *  5. 산업안전보건위원회 회의록 — 시행령 §37 ④ (4항목)
 *
 * 기존 requiredFields·legalBasis·_meta 보존, sections 만 신규 추가.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

interface SectionDef {
  title: string;
  legalSource?: string;
  fields: Array<{ key: string; label: string; required?: boolean; placeholder?: string }>;
  notes?: string[];
}

interface CorePatch {
  docId: string;
  category?: string;
  sections: SectionDef[];
  guidedByExcludeKeywords?: string[];
}

// ─── 위험성평가 4종 공통 sections (위험성평가 고시 §6·§10·§14·§15) ───
function riskAssessmentSections(variant: "initial" | "regular" | "monthly" | "ad_hoc"): SectionDef[] {
  const common: SectionDef[] = [
    {
      title: "사업장 정보",
      legalSource: "위험성평가 고시 §6 (근로자 참여) + 시행규칙 §37",
      fields: [
        { key: "siteName", label: "사업장명·소재지", required: true },
        { key: "businessStartDate", label: "사업 개시일 / 실착공일", required: variant === "initial" },
        { key: "date", label: "평가 실시일", required: true },
        { key: "siteInfo", label: "사업장 개요 (공종·규모·인력)", required: true },
      ],
    },
    {
      title: "사전조사 (안전보건정보)",
      legalSource: "위험성평가 고시 §14 ① 1호",
      fields: [
        { key: "safetyHealthInfo", label: "안전보건정보 사전조사 결과 (사고이력·작업환경·기상)", required: true },
      ],
    },
    {
      title: "유해·위험요인 파악",
      legalSource: "위험성평가 고시 §10 (6범주 전수 파악)",
      fields: [
        { key: "hazards", label: "유해·위험요인 (기계/전기/화학/생물/작업특성/작업환경 6범주)", required: true },
      ],
    },
    {
      title: "위험성 결정",
      legalSource: "시행규칙 §37 ① 2호 + KRAS 방법",
      fields: [
        { key: "riskLevel", label: "위험성 결정 (KRAS 방법명 명시)", required: true },
        { key: "kraasMethod", label: "선택한 KRAS 방법 (체크리스트·매트릭스·HAZOP·JSA·정량적 등)", required: true },
      ],
    },
    {
      title: "위험성 감소대책",
      legalSource: "시행규칙 §37 ① 3호 + 위험성평가 고시 §12 (ERIC-PP 위계)",
      fields: [
        { key: "controls", label: "감소대책 (Eliminate→Substitute→Engineering→Administrative→PPE 위계)", required: true },
        { key: "supervisor", label: "이행 책임자·기한", required: true },
      ],
    },
    {
      title: "근로자 참여 (§6)",
      legalSource: "위험성평가 고시 §6",
      fields: [
        { key: "participantsList", label: "참여자 명단·서명 (사업주·관리감독자·근로자대표)", required: true },
      ],
    },
  ];

  // 최초평가만: 실시규정 추가
  if (variant === "initial") {
    common.push({
      title: "실시규정 (이후 정기·수시·상시 평가 절차)",
      legalSource: "위험성평가 고시 §6 (실시규정)",
      fields: [
        { key: "operationalRules", label: "실시규정 (KRAS 방법·주관자·주기 등)", required: true },
      ],
    });
  }
  return common;
}

const PATCHES: CorePatch[] = [
  // 1. 위험성평가 4종
  { docId: "initial_risk_assessment", category: "report", sections: riskAssessmentSections("initial") },
  { docId: "regular_risk_assessment", category: "report", sections: riskAssessmentSections("regular") },
  { docId: "monthly_risk_assessment", category: "report", sections: riskAssessmentSections("monthly") },
  { docId: "ad_hoc_risk_assessment", category: "report", sections: riskAssessmentSections("ad_hoc") },

  // 2. TBM 일지 (위험성평가 고시 §15 ④ 3호 + 산안법 §29)
  {
    docId: "daily_tbm",
    category: "register",
    sections: [
      {
        title: "TBM 기본 정보",
        legalSource: "위험성평가 고시 §15 ④ 3호",
        fields: [
          { key: "date", label: "일자·시간", required: true },
          { key: "location", label: "작업 장소", required: true },
          { key: "leader", label: "주관자 (관리감독자)", required: true },
        ],
      },
      {
        title: "참여자",
        legalSource: "산안법 §29 (안전보건교육)",
        fields: [
          { key: "participants", label: "참여자 명단·서명", required: true },
          { key: "totalCount", label: "총 인원수", required: true },
        ],
      },
      {
        title: "작업 내용·위험요인 공유",
        legalSource: "위험성평가 고시 §15 ④ 3호",
        fields: [
          { key: "workToday", label: "오늘 작업 내용", required: true },
          { key: "hazardsToShare", label: "예상 위험요인", required: true },
          { key: "controlsToShare", label: "안전대책·주의사항", required: true },
        ],
      },
      {
        title: "보호구 + 이상 유무 점검",
        legalSource: "산안법 §29 + 산안기준규칙 §32",
        fields: [
          { key: "ppeCheck", label: "보호구 착용 점검 (안전모·안전대·안전화)", required: true },
          { key: "abnormalityCheck", label: "근로자 건강·이상 유무 확인", required: true },
        ],
      },
    ],
  },

  // 3. 산업재해 조사표 (시행규칙 §73 + 별지 30호서식)
  {
    docId: "industrial_accident_report",
    category: "report",
    guidedByExcludeKeywords: ["급성 스트레스", "조기대응"],
    sections: [
      {
        title: "사업장 정보",
        legalSource: "시행규칙 §73 (별지 30호서식)",
        fields: [
          { key: "siteName", label: "사업장명·소재지", required: true },
          { key: "industry", label: "업종·공종", required: true },
          { key: "ownerName", label: "사업주 성명", required: true },
        ],
      },
      {
        title: "재해자 인적사항",
        legalSource: "별지 30호서식",
        fields: [
          { key: "injuredName", label: "성명·생년월일·성별", required: true },
          { key: "occupation", label: "직종·근무경력", required: true },
          { key: "employmentType", label: "고용형태 (정규직·계약직·파견 등)", required: true },
        ],
      },
      {
        title: "재해 발생 정보",
        legalSource: "별지 30호서식",
        fields: [
          { key: "occurrenceDate", label: "발생 일시", required: true },
          { key: "occurrenceLocation", label: "발생 장소·작업 위치", required: true },
          { key: "circumstances", label: "재해 발생 경위·원인", required: true },
          { key: "accidentType", label: "재해 종류 (사망·중대재해·휴업 일수)", required: true },
        ],
      },
      {
        title: "조치 사항",
        legalSource: "시행규칙 §73 ① + 산안법 §57 ②",
        fields: [
          { key: "immediateAction", label: "즉시 조치사항 (응급·119·작업중지)", required: true },
          { key: "preventionPlan", label: "재발 방지 대책", required: true },
        ],
      },
      {
        title: "근로자대표 확인 (§73 ③)",
        legalSource: "시행규칙 §73 ③ (근로자대표 확인 또는 재해자 본인 확인)",
        fields: [
          { key: "workerRepConfirm", label: "근로자대표 확인 (없으면 재해자 본인 확인)", required: true },
          { key: "workerRepDissent", label: "이견이 있는 경우 그 내용 첨부", required: false },
        ],
      },
    ],
  },

  // 4. MSDS 등록부 (산안법 §110)
  {
    docId: "msds_register",
    category: "register",
    guidedByExcludeKeywords: ["교통사고", "직무스트레스"],
    sections: [
      {
        title: "화학물질 정보 (16개 항목)",
        legalSource: "산안법 §110 + 화학물질관리법",
        fields: [
          { key: "chemicalName", label: "화학물질명·제품명", required: true },
          { key: "casNo", label: "CAS No.·UN No.", required: true },
          { key: "manufacturer", label: "제조·수입자·연락처", required: true },
          { key: "composition", label: "구성 성분·함량", required: true },
          { key: "hazards", label: "유해·위험성 (GHS 그림문자·신호어)", required: true },
        ],
      },
      {
        title: "취급·보관·응급",
        legalSource: "산안법 §110",
        fields: [
          { key: "firstAid", label: "응급조치 요령", required: true },
          { key: "storage", label: "보관·취급 주의사항", required: true },
          { key: "exposureControl", label: "노출 방지 (환기·보호구)", required: true },
          { key: "fireFighting", label: "폭발·화재 시 대처방법", required: true },
        ],
      },
      {
        title: "게시·교육",
        legalSource: "산안법 §114·115 (작업장 게시 + 근로자 교육)",
        fields: [
          { key: "postedLocation", label: "MSDS 게시 위치", required: true },
          { key: "trainingDate", label: "근로자 MSDS 교육 일자·이수자", required: true },
          { key: "warningLabel", label: "경고표지 부착 여부 (용기·포장)", required: true },
        ],
      },
    ],
  },

  // 5. 산업안전보건위원회 회의록 (시행령 §37 ④)
  {
    docId: "health_safety_committee",
    category: "administrative",
    guidedByExcludeKeywords: ["굴착", "타워크레인", "동물실험윤리위원회", "독성시험"],
    sections: [
      {
        title: "회의 정보 (§37 ④ 1호)",
        legalSource: "시행령 §37 ④ 1호",
        fields: [
          { key: "meetingDate", label: "개최 일시", required: true },
          { key: "meetingLocation", label: "개최 장소", required: true },
          { key: "meetingType", label: "회의 종류 (정기 분기·임시)", required: true },
        ],
      },
      {
        title: "출석위원 (§37 ④ 2호)",
        legalSource: "시행령 §37 ④ 2호 + ② 의결 정족수",
        fields: [
          { key: "workerMembers", label: "출석 근로자위원 (과반수 출석)", required: true },
          { key: "employerMembers", label: "출석 사용자위원 (과반수 출석)", required: true },
          { key: "alternates", label: "대리 출석자 (§37 ③, 1명 지정)", required: false },
        ],
      },
      {
        title: "심의·의결 사항 (§37 ④ 3호)",
        legalSource: "시행령 §37 ④ 3호 + ② 의결 정족수",
        fields: [
          { key: "agenda", label: "심의 안건 (산안법 §24 ① 1~10호)", required: true },
          { key: "discussion", label: "심의 내용", required: true },
          { key: "decision", label: "의결·결정 사항 (출석위원 과반수 찬성)", required: true },
        ],
      },
      {
        title: "기타 (§37 ④ 4호)",
        legalSource: "시행령 §37 ④ 4호",
        fields: [
          { key: "otherDiscussion", label: "그 밖의 토의사항", required: false },
          { key: "nextMeeting", label: "차기 회의 일정", required: false },
        ],
      },
    ],
  },
];

(async () => {
  console.log(`# 핵심 ${PATCHES.length}종 sections 메타 보강\n`);

  let patched = 0;
  for (const p of PATCHES) {
    const fname = p.docId.replace(/_/g, "-") + ".jsonld";
    const filePath = resolve(DOCS_DIR, fname);
    try {
      const node = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown> & {
        _meta?: Record<string, unknown>;
      };
      node.sections = p.sections;
      const meta = (node._meta ?? {}) as Record<string, unknown>;
      if (p.category) meta.documentCategory = p.category;
      if (p.guidedByExcludeKeywords) meta.guidedByExcludeKeywords = p.guidedByExcludeKeywords;
      meta.coreSectionsAddedAt = "2026-04-27";
      node._meta = meta;
      await writeFile(filePath, JSON.stringify(node, null, 2) + "\n", "utf8");
      patched += 1;
      const fieldCount = p.sections.reduce((sum, s) => sum + s.fields.length, 0);
      console.log(`  ✓ ${p.docId.padEnd(40)} sections ${p.sections.length} (총 ${fieldCount} 필드)`);
    } catch (err) {
      console.error(`  ✗ ${p.docId}: ${(err as Error).message}`);
    }
  }
  console.log(`\n# 완료: ${patched} / ${PATCHES.length}`);
})();
