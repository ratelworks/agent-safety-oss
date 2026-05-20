/**
 * extend-master-keys.ts
 *
 * legal-duty-master.json 94종에 라이프사이클 8개 키 일괄 추가:
 *   purpose · submitTo · submitDeadline · electronicSubmission ·
 *   templateUrl · koshaGuideRef · relatedDocsByLifecycle · nextDueRule
 *
 * 카테고리·frequency 기반 룰로 보수적 default 설정.
 * 명확하지 않은 값은 sourceStatus="pending" 마커로 남김.
 *
 * 실행: npx tsx scripts/ontology/extend-master-keys.ts
 *
 * docs/LEGAL-DUTY-LIFECYCLE.md §3 데이터 모델 SSoT.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MASTER_PATH = resolve(__dirname, "../../src/ontology/legal-duty-master.json");
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/documents");

// docId → 노드 파일 경로 매핑 (한 번 빌드)
const DOCID_TO_PATH = new Map<string, string>();
function buildDocIdMap(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      buildDocIdMap(p);
    } else if (entry.endsWith(".jsonld")) {
      try {
        const node = JSON.parse(readFileSync(p, "utf8"));
        if (typeof node.docId === "string") {
          DOCID_TO_PATH.set(node.docId, p);
        }
      } catch {
        // skip
      }
    }
  }
}
buildDocIdMap(NODES_DIR);

interface MasterDoc {
  docId: string;
  title: string;
  category: string;
  legalRef: string[];
  formStrictness: string;
  formSource: string;
  frequency: string;
  applicableScope: string;
  retention: string;
  penaltyOnMissing: string;
  // 신규 키 (이 스크립트가 추가)
  purpose?: string | null;
  submitTo?: string | null;
  submitDeadline?: string | null;
  electronicSubmission?: { available: boolean; url?: string; system?: string } | null;
  templateUrl?: string | null;
  koshaGuideRef?: string[];
  relatedDocsByLifecycle?: { before: string[]; during: string[]; after: string[] };
  nextDueRule?: string | null;
  sourceStatus?: { keys: Record<string, "rule-default" | "manual" | "pending"> };
}

// === 카테고리 → 제출처·마감 룰 ===
const CATEGORY_SUBMIT_RULES: Record<string, { submitTo: string; submitDeadline: string }> = {
  A_체제: {
    submitTo: "자체 게시·비치 (사업장 내)",
    submitDeadline: "현장 개설 시 즉시 / 변경 시 14일 이내 갱신",
  },
  B_위평: {
    submitTo: "자체 보관 (감독관 요구 시 즉시 제시)",
    submitDeadline: "각 평가 시점 (최초 1개월 내 / 정기 매년 / 수시 변경 시)",
  },
  C_교육: {
    submitTo: "자체 보관 (교육일지·교육실시증빙)",
    submitDeadline: "교육 종료 즉시 작성 / 보관기간 3년",
  },
  D_작업계획: {
    submitTo: "발주처(필요 시) + 자체 보관",
    submitDeadline: "작업 개시 전 (착공 7일 전 권장)",
  },
  E_작업허가: {
    submitTo: "자체 보관 (현장 책임자 결재 후)",
    submitDeadline: "작업 개시 전 매 건",
  },
  F_도급: {
    submitTo: "자체 보관 (도급계약서 첨부)",
    submitDeadline: "도급 계약 체결 시 / 변경 시 즉시",
  },
  G_점검: {
    submitTo: "자체 보관",
    submitDeadline: "점검 주기에 맞춰 즉시 작성",
  },
  H_화학: {
    submitTo: "자체 비치 (사용 장소) + MSDS 게시",
    submitDeadline: "화학물질 입고 시 즉시 / 변경 시 갱신",
  },
  I_측정: {
    submitTo: "관할 노동지청 + 측정기관 + 자체 보관",
    submitDeadline: "측정 후 30일 이내 결과 보고 (산안법 §125)",
  },
  J_건강: {
    submitTo: "검진기관 + 자체 보관 (개인정보 별도 관리)",
    submitDeadline: "검진 후 즉시 / 유소견자 30일 내 사후관리",
  },
  K_사고: {
    submitTo: "관할 노동지청 (고용노동부 e-노동민원)",
    submitDeadline: "산업재해조사표 발생일+1개월 / 중대재해 즉시 보고",
  },
  L_진단: {
    submitTo: "진단기관 발행 + 자체 보관",
    submitDeadline: "진단 명령 후 6개월 이내",
  },
  M_인증: {
    submitTo: "안전보건공단 또는 지정 인증기관",
    submitDeadline: "기계·기구 도입 전 / 자율안전확인 신고 30일 이내",
  },
  N_비용: {
    submitTo: "발주처 + 자체 보관",
    submitDeadline: "착공 전 사용계획 / 매월 정산내역 / 준공 후 정산서",
  },
};

// === frequency → nextDueRule (ISO 8601 duration 또는 사람 가독)
// null = 트리거형(1회성). 정량 산출 불가. 작성 의무는 트리거 발생 시 1회. ===
const FREQUENCY_NEXT_DUE: Record<string, string | null> = {
  매일: "compileDate + P1D",
  매주: "compileDate + P7D",
  매월: "compileDate + P1M",
  분기: "compileDate + P3M",
  반기: "compileDate + P6M",
  연: "compileDate + P1Y",
  "월1회": "compileDate + P1M",
  "월·반기": "compileDate + P1M (월간) / + P6M (반기)",
  "월·정산": "compileDate + P1M",
  "매일·매주·매월": "compileDate + P1D (일일) / + P7D (주간) / + P1M (월간)",
  "건설 2일1회 / 기타 주1회": "건설 compileDate + P2D / 기타 + P7D",
  "건설 2개월1회 / 기타 분기": "건설 compileDate + P2M / 기타 + P3M",
  "매주·강풍후": "compileDate + P7D 또는 강풍 직후",
  "연1회/특수 6개월": "compileDate + P1Y (일반) / + P6M (특수)",
  현장개설: "현장 운영 중 지속 (신규 현장 개설 시 신규 작성)",
  작업단위: "작업 종료 후 보관기간까지",
  선임시: "선임 즉시 / 변경 시 갱신",
  채용시: "채용 후 즉시",
  발주시: "발주 시점",
  설계시: "설계 단계",
  착공: "착공 전",
  공사전: "공사 개시 전",
  타설전: "콘크리트 타설 전 매회",
  해체전: "해체 작업 전 매회",
  조립후: "조립 완료 후 즉시",
  주기검사: "검사 주기에 따라",
  변경시: "변경 발생 시 즉시",
  작업변경시: "작업 방법·내용 변경 시 즉시",
  특수작업시: "특수작업 발생 시 매회",
  특수진단후: "정밀안전진단 후",
  기계도입시: "기계·기구 도입 시",
  지정시: "감독관·발주처 지정 시",
  // 트리거형 — 1회성 작성, 정량 nextDueDate 산출 불가
  // get_retention_status / list_upcoming_duties 가 null 처리하면 작성 의무 없음으로 인식
  수시: null,
  "사고시 즉시": null,
  "사고시 1개월": null,
  사고후: null,
};

// === docId override (실제 docId로 정정) ===
const DOC_OVERRIDES: Record<string, Partial<MasterDoc>> = {
  // K_사고
  industrial_accident_report: {
    submitTo: "관할 지방고용노동(지)청 산재예방지도과",
    submitDeadline: "산업재해 발생일로부터 1개월 이내 (산안법 §57·시행규칙 §73)",
    electronicSubmission: {
      available: true,
      url: "https://minwon.moel.go.kr",
      system: "고용노동부 e-노동민원 (산업재해조사표 신청)",
    },
  },
  severe_accident_immediate_report: {
    submitTo: "관할 지방고용노동(지)청 + 119 + 경찰",
    submitDeadline: "중대재해 발생 즉시 (산안법 §54·중대재해처벌법)",
    electronicSubmission: { available: true, url: "https://minwon.moel.go.kr", system: "고용노동부 e-노동민원" },
  },
  severe_accident_compliance: {
    submitTo: "자체 보관 (대표·경영책임자 결재)",
    submitDeadline: "반기 1회 점검 (중처법 시행령 §4·§5)",
  },
  work_stop_order_report: {
    submitTo: "관할 지방고용노동(지)청 산재예방지도과",
    submitDeadline: "작업중지 명령 후 즉시",
  },
  // I_측정
  work_environment_measurement: {
    submitTo: "관할 지방고용노동(지)청 + 사업주 + 근로자대표 (산안법 §125)",
    submitDeadline: "측정 종료 후 30일 이내 결과 보고",
    electronicSubmission: {
      available: true,
      url: "https://miis.kosha.or.kr",
      system: "안전보건공단 작업환경측정 결과보고 시스템",
    },
  },
  work_environment_measurement_notification: {
    submitTo: "근로자(대표) + 자체 비치 (산안법 §125 ⑥)",
    submitDeadline: "측정 결과 통보 후 30일 이내 게시·통보",
  },
  // J_건강
  health_examination_records: {
    submitTo: "검진기관 → 사업주 (산안법 §129)",
    submitDeadline: "사무직 2년 1회 / 기타 1년 1회 / 특수업무 6개월~2년",
  },
  health_examination_followup: {
    submitTo: "자체 보관 + 유소견자 본인 통보",
    submitDeadline: "건강진단 결과 통보 후 30일 이내 사후관리 (산안법 §132)",
  },
  // M_인증
  safety_certification_application: {
    submitTo: "안전보건공단 (위험기계·기구 안전인증)",
    submitDeadline: "기계·기구 제조·수입 시 사전 신청 (산안법 §84)",
    electronicSubmission: {
      available: true,
      url: "https://miis.kosha.or.kr",
      system: "안전보건공단 위험기계·기구 안전인증 시스템",
    },
  },
  voluntary_safety_confirmation_filing: {
    submitTo: "안전보건공단 (자율안전확인 신고)",
    submitDeadline: "자율안전확인대상 기계·기구 출고 30일 이내 (산안법 §89)",
    electronicSubmission: { available: true, url: "https://miis.kosha.or.kr", system: "안전보건공단 자율안전확인 신고" },
  },
  safety_inspection_application: {
    submitTo: "안전보건공단 (안전검사 기관)",
    submitDeadline: "안전검사 대상 기계·기구는 검사 주기 도래 30일 전 신청 (산안법 §93)",
    electronicSubmission: { available: true, url: "https://miis.kosha.or.kr", system: "안전보건공단 안전검사" },
  },
  voluntary_inspection_program: {
    submitTo: "안전보건공단 (자율검사프로그램 인정)",
    submitDeadline: "안전검사 대체 시 사전 인정 신청 (산안법 §98)",
  },
  // L_진단 — 유해·위험방지계획서
  hazardous_risk_prevention_plan_construction: {
    submitTo: "안전보건공단 (착공 15일 전)",
    submitDeadline: "건설공사 착공 15일 전 (산안법 §42·시행규칙 §42)",
    electronicSubmission: {
      available: true,
      url: "https://miis.kosha.or.kr",
      system: "안전보건공단 유해위험방지계획서 심사 시스템",
    },
  },
};

// === purpose 추출: 노드 description 첫 문장 ===
function extractPurpose(docId: string): string | null {
  const p = DOCID_TO_PATH.get(docId);
  if (!p) return null;
  try {
    const node = JSON.parse(readFileSync(p, "utf8"));
    const desc = node.description || node.purpose;
    if (typeof desc !== "string") return null;
    // 마크다운 헤더(**제목**\n\n)와 트리거가 description 앞에 붙은 경우 제거
    const cleaned = desc.replace(/^\*\*[^*]+\*\*\s*/, "").trim();
    // 첫 문장만 (마침표 또는 줄바꿈 기준)
    const first = cleaned.split(/[.。\n]/, 1)[0].trim();
    return first.length > 0 && first.length < 200 ? first : cleaned.slice(0, 150);
  } catch {
    return null;
  }
}

// === 메인 ===
function main(): void {
  const masterRaw = readFileSync(MASTER_PATH, "utf8");
  const master = JSON.parse(masterRaw) as { _meta: Record<string, unknown>; documents: MasterDoc[] };

  let extended = 0;
  let purposeFilled = 0;

  for (const doc of master.documents) {
    const sourceStatus: MasterDoc["sourceStatus"] = doc.sourceStatus ?? { keys: {} };

    // purpose
    if (!doc.purpose) {
      const p = extractPurpose(doc.docId);
      if (p) {
        doc.purpose = p;
        sourceStatus.keys.purpose = "rule-default";
        purposeFilled++;
      } else {
        doc.purpose = null;
        sourceStatus.keys.purpose = "pending";
      }
    }

    // submitTo / submitDeadline (override 우선, 없으면 카테고리 룰)
    const override = DOC_OVERRIDES[doc.docId] ?? {};
    const catRule = CATEGORY_SUBMIT_RULES[doc.category];
    if (!doc.submitTo) {
      doc.submitTo = override.submitTo ?? catRule?.submitTo ?? null;
      sourceStatus.keys.submitTo = override.submitTo ? "manual" : catRule ? "rule-default" : "pending";
    }
    if (!doc.submitDeadline) {
      doc.submitDeadline = override.submitDeadline ?? catRule?.submitDeadline ?? null;
      sourceStatus.keys.submitDeadline = override.submitDeadline
        ? "manual"
        : catRule
        ? "rule-default"
        : "pending";
    }

    // electronicSubmission (override만 명시, 그 외 null = "전자제출 불가/불필요")
    if (!doc.electronicSubmission) {
      doc.electronicSubmission = override.electronicSubmission ?? null;
      sourceStatus.keys.electronicSubmission = override.electronicSubmission ? "manual" : "rule-default";
    }

    // templateUrl (formStrictness=법령강제+formSource=별지N호 인 경우만 추후 채움)
    if (!doc.templateUrl) {
      doc.templateUrl = null;
      sourceStatus.keys.templateUrl =
        doc.formStrictness === "법령강제" && doc.formSource?.startsWith("별지") ? "pending" : "rule-default";
    }

    // koshaGuideRef
    if (!doc.koshaGuideRef) {
      doc.koshaGuideRef = [];
      sourceStatus.keys.koshaGuideRef = "pending";
    }

    // relatedDocsByLifecycle
    if (!doc.relatedDocsByLifecycle) {
      doc.relatedDocsByLifecycle = { before: [], during: [], after: [] };
      sourceStatus.keys.relatedDocsByLifecycle = "pending";
    }

    // nextDueRule (frequency 기반)
    if (!doc.nextDueRule) {
      doc.nextDueRule = FREQUENCY_NEXT_DUE[doc.frequency] ?? null;
      sourceStatus.keys.nextDueRule = doc.nextDueRule ? "rule-default" : "pending";
    }

    doc.sourceStatus = sourceStatus;
    extended++;
  }

  // _meta 갱신
  master._meta.version = "0.5.0";
  master._meta.lastExtendedAt = new Date().toISOString();
  master._meta.extendedKeys = [
    "purpose",
    "submitTo",
    "submitDeadline",
    "electronicSubmission",
    "templateUrl",
    "koshaGuideRef",
    "relatedDocsByLifecycle",
    "nextDueRule",
  ];

  writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n", "utf8");

  // 통계
  const stats = {
    total: master.documents.length,
    extended,
    purposeFilled,
    submitToFilled: master.documents.filter((d) => d.submitTo).length,
    submitDeadlineFilled: master.documents.filter((d) => d.submitDeadline).length,
    electronicSubmissionFilled: master.documents.filter((d) => d.electronicSubmission).length,
    templateUrlFilled: master.documents.filter((d) => d.templateUrl).length,
    koshaGuideRefFilled: master.documents.filter((d) => (d.koshaGuideRef ?? []).length > 0).length,
    nextDueRuleFilled: master.documents.filter((d) => d.nextDueRule).length,
  };

  console.log("=== legal-duty-master.json 8개 키 확장 완료 ===");
  console.log(JSON.stringify(stats, null, 2));
  console.log(`\n저장: ${MASTER_PATH}`);
  console.log("\n다음: scripts/audit/audit-legal-duty-coverage.ts 로 정합성 재확인");
}

main();
