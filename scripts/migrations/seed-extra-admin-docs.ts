#!/usr/bin/env tsx
/**
 * seed-extra-admin-docs.ts (v0.11 — 현장 작성 cover 100% 도달)
 *
 * 본 OSS 1차 타겟(현장 안전관리자·현장소장)이 *직접 작성*하는 누락 5종 신규.
 * 외부 기관 산출물(§73 지도결과·§83 안전인증 등)은 본 OSS 범위 밖이므로 제외.
 *
 *   1. supervisor_education_log         §32 + 시행규칙 §35 + 별표 5  관리감독자 직무·교육
 *   2. safety_signage_register           §37 + 시행규칙 §38·39 + 별표 6·7·8  안전보건표지
 *   3. legal_summary_posting             §34 + 시행규칙 §40  법령 요지 게시·교육
 *   4. safety_health_management_assistant_appointment  §19 + 시행규칙 §43  관리담당자 선임 (20~50인)
 *   5. contractor_consultative_body      §75 + 시행규칙 §74  안전보건협의체 (대규모 도급)
 *
 * 현장 작성 의무 cover: 34/36 → 36/36 (100%)
 */

import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");
const VERIFIED_AT = "2026-04-27";

interface ExtraDoc {
  docId: string;
  title: string;
  description: string;
  cycle: string;
  trigger: string;
  category: string;
  legalBasis: string[];
  penaltyOnMissing: string;
  retention: string;
  sections: Array<{
    title: string;
    legalSource?: string;
    fields: Array<{ key: string; label: string; required?: boolean }>;
  }>;
  reviewRules: Array<{
    rule: string;
    severity: "blocker" | "warning" | "info" | "manual_review";
    legalBasis?: string;
  }>;
  guidedByKeywords?: string[];
  guidedByExcludeKeywords?: string[];
}

const DOCS: ExtraDoc[] = [
  // ─── 1. §32 관리감독자 직무·교육 일지 ───
  {
    docId: "supervisor_education_log",
    title: "관리감독자 직무·교육 일지",
    description: "관리감독자의 직무 수행 + 정기·신규채용·변경 시 교육 기록 (산안법 §32 + 시행규칙 §35)",
    cycle: "cyc:annual",
    trigger: "정기교육 분기 4시간(또는 연 16시간) + 신규채용 8시간 + 변경 시 2시간",
    category: "register",
    legalBasis: ["art:산안법:32", "art:산안법시행규칙:35"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "3년",
    sections: [
      {
        title: "관리감독자 정보",
        legalSource: "산안법 §32 ① + 시행규칙 §35",
        fields: [
          { key: "supervisorName", label: "관리감독자 성명·직위", required: true },
          { key: "responsibleArea", label: "담당 부서·작업 범위", required: true },
          { key: "appointmentDate", label: "선임 일자", required: true },
        ],
      },
      {
        title: "직무 수행 (산안법 §32 ① 1~7호)",
        legalSource: "산안법 §32 ① + 시행규칙 §35 별표 4",
        fields: [
          { key: "siteSafetyCheck", label: "사업장 안전 점검·확인", required: true },
          { key: "ppeCheck", label: "보호구·안전장치 점검", required: true },
          { key: "siteCleanup", label: "작업장 정리정돈·통로 확보", required: true },
          { key: "specialistGuidance", label: "산업보건의·안전·보건관리자 지도·조언 시행", required: true },
          { key: "riskAssessmentParticipation", label: "위험성평가 참여", required: true },
          { key: "emergencyResponse", label: "사고 발생 시 응급조치", required: true },
          { key: "workerGuidance", label: "근로자 직무 안전 지도", required: true },
        ],
      },
      {
        title: "교육 이수 (별표 5)",
        legalSource: "산안법 §32 ② + 별표 5 (관리감독자 정기교육 연 16시간 등)",
        fields: [
          { key: "regularEducation", label: "정기교육 (분기 4h 또는 연 16h)", required: true },
          { key: "newAppointmentEducation", label: "신규채용 교육 (8h)", required: false },
          { key: "changeEducation", label: "변경 시 교육 (2h)", required: false },
          { key: "educationDate", label: "교육 일자·이수 시간·강사", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "직무 7항목 모두 수행 기록", severity: "blocker", legalBasis: "art:산안법:32" },
      { rule: "정기교육 분기 4h 또는 연 16h 충족", severity: "blocker", legalBasis: "art:산안법:32" },
    ],
    // 정정: "안전교육"이 너무 넓어 지게차 운전자 등 매칭 → 정확한 키워드만
    guidedByKeywords: ["관리감독자 교육", "관리감독자 직무"],
    guidedByExcludeKeywords: ["지게차", "차량계", "근로자 안전교육"],
  },

  // ─── 2. §37 안전보건표지 부착·관리 ───
  {
    docId: "safety_signage_register",
    title: "안전보건표지 부착·관리 기록",
    description: "사업장 안전보건표지 부착 + 정기 점검·교체 (산안법 §37 + 시행규칙 §38·39 + 별표 6·7·8)",
    cycle: "cyc:monthly",
    trigger: "표지 신규 부착 + 분기 점검 + 훼손·교체 시",
    category: "register",
    legalBasis: ["art:산안법:37", "art:산안법시행규칙:38"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "지속 (점검·교체 이력)",
    sections: [
      {
        title: "표지 부착 정보",
        legalSource: "산안법 §37 + 별표 6 (4종: 금지·경고·지시·안내)",
        fields: [
          { key: "signageType", label: "표지 종류 (금지·경고·지시·안내)", required: true },
          { key: "signageContent", label: "표지 내용 (예: 출입금지·고소위험·보호구착용·비상구)", required: true },
          { key: "location", label: "부착 위치 (구체)", required: true },
          { key: "installDate", label: "부착 일자", required: true },
        ],
      },
      {
        title: "점검·교체",
        legalSource: "시행규칙 §39",
        fields: [
          { key: "lastInspection", label: "최근 점검 일자", required: true },
          { key: "inspector", label: "점검자", required: true },
          { key: "condition", label: "상태 (양호·훼손·교체 필요)", required: true },
          { key: "replaceDate", label: "교체 일자 (해당 시)", required: false },
        ],
      },
    ],
    reviewRules: [
      { rule: "4종 표지 모두 부착 (금지·경고·지시·안내)", severity: "blocker", legalBasis: "art:산안법:37" },
      { rule: "분기 점검 기록", severity: "warning" },
    ],
    guidedByKeywords: ["안전보건표지", "안내표지", "위험표지"],
  },

  // ─── 3. §34 법령 요지 게시·교육 ───
  {
    docId: "legal_summary_posting",
    title: "법령 요지 게시·교육 기록",
    description: "산안법·시행령·시행규칙·기준규칙 요지 사업장 게시 + 근로자 알림 (산안법 §34)",
    cycle: "cyc:annual",
    trigger: "법령 개정 시 + 신규 사업장 + 연 1회 점검",
    category: "register",
    legalBasis: ["art:산안법:34"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "지속",
    sections: [
      {
        title: "게시 내용",
        legalSource: "산안법 §34",
        fields: [
          { key: "lawList", label: "게시 법령 (산안법·시행령·시행규칙·기준규칙·중처법)", required: true },
          { key: "summaryContent", label: "법령 요지 본문 (KOSHA 표준 양식 또는 직접 작성)", required: true },
          { key: "lastUpdate", label: "법령 개정 반영 최종 일자", required: true },
        ],
      },
      {
        title: "게시 위치·근로자 알림",
        legalSource: "산안법 §34 + 시행규칙 §40",
        fields: [
          { key: "postedLocation", label: "게시 위치 (사업장 내 잘 보이는 곳)", required: true },
          { key: "noticeMethod", label: "알림 방법 (TBM·게시판·교육·서면)", required: true },
          { key: "noticeDate", label: "최근 알림 일자", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "산안법·기준규칙 모두 게시", severity: "blocker", legalBasis: "art:산안법:34" },
      { rule: "법령 개정 반영 (1년 내)", severity: "warning" },
    ],
    guidedByKeywords: ["법령 게시", "법령 요지", "근로자 알림"],
  },

  // ─── 4. §19 안전보건관리담당자 선임 (20~50인) ───
  {
    docId: "safety_health_management_assistant_appointment",
    title: "안전보건관리담당자 선임 신고",
    description: "20인 이상 50인 미만 사업장 안전보건관리담당자 선임 (산안법 §19 + 시행규칙 §43)",
    cycle: "cyc:ad_hoc",
    trigger: "사업장 성립·변경·이직 시",
    category: "administrative",
    applicableWhen: { workforceGte: 20, workforceLt: 50 },
    legalBasis: ["art:산안법:19", "art:산안법시행규칙:43"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "지속",
    sections: [
      {
        title: "사업장·담당자 정보",
        legalSource: "산안법 §19 + 시행규칙 §43",
        fields: [
          { key: "workforce", label: "상시근로자 수 (20~50인 범위)", required: true },
          { key: "assistantName", label: "안전보건관리담당자 성명·직위", required: true },
          { key: "qualification", label: "자격 요건 (시행규칙 §43 ②)", required: true },
        ],
      },
      {
        title: "직무·선임 신고",
        legalSource: "산안법 §19 ② + 시행규칙 §43 ③",
        fields: [
          { key: "duties", label: "직무 범위 (안전·보건 일반 관리)", required: true },
          { key: "appointmentDate", label: "선임 일자", required: true },
          { key: "reportDate", label: "관할 노동청 신고 일자", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "20~50인 사업장 의무 (이상은 §17·18 별도)", severity: "blocker", legalBasis: "art:산안법:19" },
      { rule: "자격 요건 충족 명시", severity: "blocker", legalBasis: "art:산안법시행규칙:43" },
    ],
    guidedByKeywords: ["안전보건관리담당자", "선임"],
  } as ExtraDoc & { applicableWhen: Record<string, unknown> },

  // ─── 5. §75 안전보건협의체 (대규모 도급) ───
  {
    docId: "contractor_consultative_body",
    title: "안전보건협의체 회의록 (대규모 도급)",
    description: "50억 이상 건설현장 또는 일정 규모 도급사업 안전보건협의체 (산안법 §75 + 시행규칙 §74)",
    cycle: "cyc:monthly",
    trigger: "월 1회 회의 + 안전 의제 변경 시",
    category: "administrative",
    applicableWhen: { constructionValueGte: 50 },
    legalBasis: ["art:산안법:75", "art:산안법시행규칙:74"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "3년",
    sections: [
      {
        title: "회의 정보",
        legalSource: "산안법 §75 + 시행규칙 §74",
        fields: [
          { key: "meetingDate", label: "회의 일시·장소", required: true },
          { key: "meetingType", label: "정기·임시", required: true },
        ],
      },
      {
        title: "참여자 (도급인 + 수급인)",
        legalSource: "산안법 §75 ② + 시행규칙 §74 ②",
        fields: [
          { key: "ownerSide", label: "도급인 측 참여자", required: true },
          { key: "subcontractorSide", label: "수급인 측 참여자 (각 사 대표)", required: true },
          { key: "workerRep", label: "근로자대표", required: true },
        ],
      },
      {
        title: "심의·결정",
        legalSource: "산안법 §75 ③",
        fields: [
          { key: "agenda", label: "안전·보건 의제", required: true },
          { key: "discussion", label: "심의 내용", required: true },
          { key: "decision", label: "결정 사항·이행 계획", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "월 1회 정기 개최", severity: "blocker", legalBasis: "art:산안법시행규칙:74" },
      { rule: "도급인+수급인+근로자대표 모두 참여", severity: "blocker", legalBasis: "art:산안법:75" },
    ],
    guidedByKeywords: ["안전보건협의체", "도급사업주"],
  } as ExtraDoc & { applicableWhen: Record<string, unknown> },
];

(async () => {
  console.log(`# v0.11 — 현장 작성 누락 ${DOCS.length}종 신규 시드\n`);

  for (const seed of DOCS) {
    const fname = seed.docId.replace(/_/g, "-") + ".jsonld";
    const node = {
      "@context": "../../context.jsonld",
      "@id": `doc:${seed.cycle.replace("cycle:", "")}/${seed.docId}`,
      "@type": ["Document", "DigitalDocument"],
      docId: seed.docId,
      title: seed.title,
      description: seed.description,
      cycle: seed.cycle,
      trigger: seed.trigger,
      applicableWhen: (seed as ExtraDoc & { applicableWhen?: Record<string, unknown> }).applicableWhen,
      legalBasis: seed.legalBasis,
      requiredFields: seed.sections.flatMap((s) =>
        s.fields.map((f) => ({ key: f.key, label: f.label, source: s.legalSource ?? seed.legalBasis.join(", ") })),
      ),
      reviewRules: seed.reviewRules,
      sections: seed.sections,
      penaltyOnMissing: seed.penaltyOnMissing,
      retention: seed.retention,
      guidedBy: [],
      verificationStatus: "verified",
      _meta: {
        publishedBy: "황룡건설(주) + ㈜라텔웍스",
        sourceLaw: seed.legalBasis[0],
        verifiedAt: VERIFIED_AT,
        guidedByKeywords: seed.guidedByKeywords ?? [],
        guidedByExcludeKeywords: seed.guidedByExcludeKeywords ?? [],
        documentCategory: seed.category,
      },
    };

    await writeFile(resolve(DOCS_DIR, fname), JSON.stringify(node, null, 2) + "\n", "utf8");
    const fieldCount = seed.sections.reduce((sum, s) => sum + s.fields.length, 0);
    console.log(`  ✓ ${seed.docId.padEnd(50)} sections ${seed.sections.length} (총 ${fieldCount} 필드)`);
  }
  console.log(`\n✓ ${DOCS.length}종 시드 완료`);
})();
