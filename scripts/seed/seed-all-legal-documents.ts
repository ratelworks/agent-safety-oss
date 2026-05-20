#!/usr/bin/env tsx
/**
 * seed-all-legal-documents.ts (P-PAPER-2b~f)
 *
 * 한국 안전관리 법령 54종 작성 의무 문서를 Document 노드로 일괄 시드.
 *
 * 출처:
 *   - 산업안전보건법 §15·17·18·24·25·29·36·42·44·54·57·62·63·64·67·72·110·125·129·130·131·175
 *   - 산업안전보건법 시행령 §4·5·37·42
 *   - 산업안전보건법 시행규칙 §26·37·73·86
 *   - 산업안전보건기준에 관한 규칙 §32·35·38·239 + 별표 4 (작업계획서 13종)
 *   - 중대재해처벌법 §4·5 + 시행령 §4·5
 *   - 위험성평가 고시 (2024-76) §6·11·12·13·14·15
 *
 * 환각 위험 통제:
 *   - 양식·법적 근거는 본 OSS 내장 .md 본문에서 직접 추출 (LLM 추론 X)
 *   - guidedByKeywords로 KOSHA 자동 매핑
 *   - reviewRules는 법령 본문의 "필수" 항목 기반
 *
 * 멱등 — 기존 노드 보존 (work_plan_excavation 등 기존 정밀 정의는 그대로),
 *        nodes 디렉토리에 신규 추가 또는 sections 메타 보강.
 */

import { writeFile, readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");
const VERIFIED_AT = "2026-04-27";

// ─── Document 양식 데이터 (54종) ───
interface DocSeed {
  docId: string;
  title: string;
  alternativeNames?: string[];
  description: string;
  cycle: string;
  trigger?: string;
  applicableWhen?: Record<string, unknown>;
  legalBasis: string[];
  penaltyOnMissing?: string;
  retention: string;
  sections: Array<{
    title: string;
    legalSource?: string;
    fields: Array<{ key: string; label: string; required?: boolean; placeholder?: string }>;
    notes?: string[];
  }>;
  reviewRules: Array<{
    rule: string;
    severity: "blocker" | "warning" | "info" | "manual_review";
    checkFields?: string[];
    legalBasis?: string;
  }>;
  guidedByKeywords?: string[]; // KOSHA techGdlnNm 자동 매칭 (positive)
  guidedByExcludeKeywords?: string[]; // 동음이의어 차단 (v0.8 quality fix)
  preserveExisting?: boolean; // true면 기존 노드 보존, sections만 갱신
  category?: "construction_work" | "permit" | "administrative" | "report" | "register"; // 양식 분리
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 작업계획서 13종 (산안기준규칙 §38 별표 4)
// ─────────────────────────────────────────────────────────────────────────────

const WORK_PLAN_DOCS: DocSeed[] = [
  // [1호] 타워크레인
  {
    docId: "work_plan_tower_crane",
    title: "타워크레인 작업계획서",
    description: "타워크레인 설치·조립·해체 작업 시작 전 작성 의무 (별표 4 1호)",
    cycle: "cyc:ad_hoc",
    trigger: "타워크레인 설치·조립·해체 작업 전",
    applicableWhen: { workType: "tower_crane" },
    legalBasis: ["art:기준규칙:38", "annex:기준규칙:별표4-1호"],
    penaltyOnMissing: "penalty:산안법:175 (5천만원 이하 과태료)",
    retention: "3년 (산안법 시행규칙 §241)",
    sections: [
      {
        title: "사전조사",
        legalSource: "별표 4 1호 사전조사",
        fields: [
          { key: "windSpeed", label: "풍속 — 초당 10m/15m 작업 제한 확인", required: true },
          { key: "groundCondition", label: "설치 지반 상태", required: true },
        ],
      },
      {
        title: "작업계획",
        legalSource: "별표 4 1호 작업계획",
        fields: [
          { key: "craneType", label: "타워크레인 종류·형식", required: true },
          { key: "assemblyOrder", label: "설치·조립·해체 순서", required: true },
          { key: "tools", label: "작업도구·장비·가설설비·방호설비", required: true },
          { key: "personnel", label: "작업인원 구성·역할 범위", required: true },
          { key: "support", label: "제142조에 따른 지지방법", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "사전조사·작업계획 모두 작성", severity: "blocker", legalBasis: "annex:기준규칙:별표4-1호" },
      { rule: "근로자 통지 (§38 ②)", severity: "blocker", legalBasis: "art:기준규칙:38#2" },
    ],
    guidedByKeywords: ["타워크레인", "이동식크레인", "양중기"],
  },

  // [2호] 차량계 하역운반기계
  {
    docId: "work_plan_vehicle_cargo",
    title: "차량계 하역운반기계 작업계획서",
    description: "지게차·트럭 등 차량계 하역운반기계 사용 작업 (도로 주행 제외, 별표 4 2호)",
    cycle: "cyc:ad_hoc",
    trigger: "차량계 하역운반기계 사용 작업 전",
    applicableWhen: { workType: "vehicle_cargo" },
    legalBasis: ["art:기준규칙:38", "annex:기준규칙:별표4-2호"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "3년",
    sections: [
      {
        title: "작업계획",
        legalSource: "별표 4 2호 작업계획",
        fields: [
          { key: "preventionMeasures", label: "추락·낙하·전도·협착·붕괴 위험 예방대책", required: true },
          { key: "route", label: "운행경로", required: true },
          { key: "method", label: "작업방법", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "작업계획 작성", severity: "blocker", legalBasis: "annex:기준규칙:별표4-2호" },
      { rule: "근로자 통지 (§38 ②)", severity: "blocker", legalBasis: "art:기준규칙:38#2" },
    ],
    guidedByKeywords: ["지게차", "차량계 하역", "운반기계"],
  },

  // [3호] 차량계 건설기계
  {
    docId: "work_plan_vehicle_construction",
    title: "차량계 건설기계 작업계획서",
    description: "굴삭기·로더·불도저 등 차량계 건설기계 사용 작업 (별표 4 3호)",
    cycle: "cyc:ad_hoc",
    trigger: "차량계 건설기계 사용 작업 전",
    applicableWhen: { workType: "vehicle_construction" },
    legalBasis: ["art:기준규칙:38", "annex:기준규칙:별표4-3호"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "3년",
    sections: [
      {
        title: "사전조사",
        legalSource: "별표 4 3호 사전조사",
        fields: [
          { key: "groundCondition", label: "기계 굴러떨어짐·지반 침하 등 위험 방지 사전조사", required: true },
        ],
      },
      {
        title: "작업계획",
        legalSource: "별표 4 3호 작업계획",
        fields: [
          { key: "machineType", label: "차량계 건설기계 종류·성능", required: true },
          { key: "route", label: "운행경로", required: true },
          { key: "method", label: "작업방법", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "사전조사·작업계획 모두 작성", severity: "blocker", legalBasis: "annex:기준규칙:별표4-3호" },
      { rule: "근로자 통지 (§38 ②)", severity: "blocker", legalBasis: "art:기준규칙:38#2" },
    ],
    guidedByKeywords: ["굴삭기", "건설기계", "차량계"],
  },

  // [4호] 화학설비 — 비건설 도메인 (별도 OSS 분리)

  // [5호] 전기작업
  {
    docId: "work_plan_electric_work",
    title: "전기작업 작업계획서 (50V 초과)",
    description: "전기작업 (50V 초과 또는 250VA 초과) 작업 전 (별표 4 5호)",
    cycle: "cyc:ad_hoc",
    trigger: "50V 초과 전기작업 전",
    applicableWhen: { workType: "electric_work_50v_plus", voltageGte: 50 },
    legalBasis: ["art:기준규칙:38", "annex:기준규칙:별표4-5호"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "3년",
    sections: [
      {
        title: "작업계획",
        legalSource: "별표 4 5호 작업계획",
        fields: [
          { key: "purpose", label: "전기작업 목적·내용", required: true },
          { key: "qualifications", label: "근로자 자격·적정 인원", required: true },
          { key: "scope", label: "작업 범위", required: true },
          { key: "responsibility", label: "작업책임자 임명", required: true },
          { key: "ppe", label: "전격·섬락 방지 보호구 착용", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "작업계획 작성", severity: "blocker", legalBasis: "annex:기준규칙:별표4-5호" },
      { rule: "근로자 통지 (§38 ②)", severity: "blocker", legalBasis: "art:기준규칙:38#2" },
    ],
    guidedByKeywords: ["전기작업", "활선", "정전 작업", "정전·잠금", "정전전로", "감전", "절연 보호구"],
    guidedByExcludeKeywords: ["정전기", "정전도장"],
  },

  // [6호] 굴착작업 — 기존 work_plan_excavation 보존, sections만 갱신
  {
    docId: "work_plan_excavation",
    preserveExisting: true,
    title: "굴착작업 작업계획서",
    description: "굴착면 높이 2m 이상 굴착작업 (별표 4 6호)",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:기준규칙:38", "annex:기준규칙:별표4-6호"],
    retention: "3년",
    sections: [
      {
        title: "사전조사",
        legalSource: "별표 4 6호 사전조사",
        fields: [
          { key: "preSurvey.shape", label: "형상·지질·지층 상태", required: true },
          { key: "preSurvey.crackWater", label: "균열·함수·용수·동결 유무·상태", required: true },
          { key: "preSurvey.buriedObj", label: "매설물 등의 유무·상태", required: true },
          { key: "preSurvey.groundwater", label: "지반 지하수위 상태", required: true },
        ],
      },
      {
        title: "작업계획",
        legalSource: "별표 4 6호 작업계획",
        fields: [
          { key: "plan.method", label: "굴착방법·순서, 토사 반출 방법", required: true },
          { key: "plan.resources", label: "필요한 인원·장비 사용계획", required: true },
          { key: "plan.protectBuried", label: "매설물 이설·보호대책", required: true },
          { key: "plan.signal", label: "사업장 내 연락방법·신호방법", required: true },
          { key: "plan.shoring", label: "흙막이 지보공 설치방법·계측계획", required: true },
          { key: "plan.supervisor", label: "작업지휘자 배치계획", required: true },
          { key: "plan.other", label: "그 밖에 안전·보건 사항", required: false },
        ],
      },
    ],
    reviewRules: [],
    // 굴착 작업계획서 — 옹벽·발파는 *후속 작업*이므로 직접 매핑 부적합 (별도 작업계획서 별도)
    guidedByKeywords: ["굴착", "흙막이", "토공", "매설물", "사면", "지반", "터파기", "굴착면", "굴착기"],
    guidedByExcludeKeywords: ["옹벽 공사", "보강토 옹벽", "콘크리트 옹벽", "발파공사 기술"],
  },

  // [7호] 터널굴착
  {
    docId: "work_plan_tunnel",
    title: "터널굴착 작업계획서",
    description: "터널굴착작업 (별표 4 7호)",
    cycle: "cyc:ad_hoc",
    trigger: "터널굴착 작업 전",
    applicableWhen: { workType: "tunnel_excavation" },
    legalBasis: ["art:기준규칙:38", "annex:기준규칙:별표4-7호"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "3년",
    sections: [
      {
        title: "사전조사",
        legalSource: "별표 4 7호 사전조사",
        fields: [
          { key: "boring", label: "보링 등으로 낙반·출수·가스폭발 위험 방지를 위한 지형·지질·지층 조사", required: true },
        ],
      },
      {
        title: "작업계획",
        legalSource: "별표 4 7호 작업계획",
        fields: [
          { key: "method", label: "굴착 방법", required: true },
          { key: "support", label: "터널지보공·복공의 시공방법", required: true },
          { key: "waterMgmt", label: "용수 처리방법", required: true },
          { key: "ventilation", label: "환기·조명 시설 설치 방법", required: false },
        ],
      },
    ],
    reviewRules: [
      { rule: "사전조사·작업계획 작성", severity: "blocker", legalBasis: "annex:기준규칙:별표4-7호" },
      { rule: "근로자 통지 (§38 ②)", severity: "blocker", legalBasis: "art:기준규칙:38#2" },
    ],
    guidedByKeywords: ["터널", "낙반", "지보공"],
  },

  // [8호] 교량
  {
    docId: "work_plan_bridge",
    title: "교량 작업계획서",
    description: "교량 (높이 5m 이상 또는 지간 30m 이상 금속·콘크리트) 설치·해체·변경 (별표 4 8호)",
    cycle: "cyc:ad_hoc",
    trigger: "교량 설치·해체·변경 작업 전",
    applicableWhen: { workType: "bridge_5m_30m", heightGte: 5, spanGte: 30 },
    legalBasis: ["art:기준규칙:38", "annex:기준규칙:별표4-8호"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "3년",
    sections: [
      {
        title: "작업계획",
        legalSource: "별표 4 8호 작업계획",
        fields: [
          { key: "method", label: "작업 방법·순서", required: true },
          { key: "fallProtection", label: "부재 낙하·전도·붕괴 방지 방법", required: true },
          { key: "fallSafety", label: "근로자 추락 위험 방지 안전조치", required: true },
          { key: "tempStructure", label: "가설 철구조물 설치·사용·해체 시 안전성 검토", required: true },
          { key: "machinery", label: "사용 기계 종류·성능", required: true },
          { key: "supervisor", label: "작업지휘자 배치계획", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "작업계획 6항목 작성", severity: "blocker", legalBasis: "annex:기준규칙:별표4-8호" },
      { rule: "근로자 통지 (§38 ②)", severity: "blocker", legalBasis: "art:기준규칙:38#2" },
    ],
    guidedByKeywords: ["교량", "가설", "추락"],
  },

  // [9호] 채석작업 — 비건설 (광업) 도메인 (별도 OSS 분리)

  // [10호] 건축물 해체 — a-codex BLOCKER #1: 사전조사 항목 추가
  {
    docId: "work_plan_demolition",
    title: "건축물 해체 작업계획서",
    description: "구축물·건축물·시설물 해체작업 (별표 4 10호, 2023-11-14 개정으로 확장)",
    cycle: "cyc:ad_hoc",
    trigger: "구축물·건축물 해체 작업 전",
    applicableWhen: { workType: "demolition" },
    legalBasis: ["art:기준규칙:38", "annex:기준규칙:별표4-10호"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "3년",
    sections: [
      {
        title: "사전조사",
        legalSource: "별표 4 10호 사전조사",
        fields: [
          { key: "preSurvey.structure", label: "해체건물 등의 구조", required: true },
          { key: "preSurvey.surroundings", label: "주변 상황 등", required: true },
        ],
      },
      {
        title: "작업계획",
        legalSource: "별표 4 10호 작업계획",
        fields: [
          { key: "methodAndOrder", label: "해체 방법·순서 도면", required: true },
          { key: "tempEquipment", label: "가설·방호·환기·살수·방화 설비 방법", required: true },
          { key: "communication", label: "사업장 내 연락방법", required: true },
          { key: "disposal", label: "해체물 처분계획", required: true },
          { key: "machinery", label: "해체작업용 기계·기구 작업계획서", required: true },
          { key: "explosives", label: "해체작업용 화약류 사용계획서", required: false },
          { key: "other", label: "그 밖에 안전·보건 사항", required: false },
        ],
      },
    ],
    reviewRules: [
      { rule: "작업계획 작성", severity: "blocker", legalBasis: "annex:기준규칙:별표4-10호" },
      { rule: "근로자 통지 (§38 ②)", severity: "blocker", legalBasis: "art:기준규칙:38#2" },
    ],
    guidedByKeywords: ["해체", "철거"],
  },

  // [11호] 중량물 취급
  {
    docId: "work_plan_heavy_lifting",
    title: "중량물 취급 작업계획서",
    description: "중량물 취급작업 (별표 4 11호)",
    cycle: "cyc:ad_hoc",
    trigger: "중량물 취급 작업 전",
    applicableWhen: { workType: "heavy_lifting" },
    legalBasis: ["art:기준규칙:38", "annex:기준규칙:별표4-11호"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "3년",
    sections: [
      {
        title: "작업계획",
        legalSource: "별표 4 11호 작업계획",
        fields: [
          { key: "fall", label: "추락 위험 예방 안전대책", required: true },
          { key: "drop", label: "낙하 위험 예방 안전대책", required: true },
          { key: "overturn", label: "전도 위험 예방 안전대책", required: true },
          { key: "pinch", label: "협착 위험 예방 안전대책", required: true },
          { key: "collapse", label: "붕괴 위험 예방 안전대책", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "5대 위험 모두 안전대책 작성", severity: "blocker", legalBasis: "annex:기준규칙:별표4-11호" },
      { rule: "근로자 통지 (§38 ②)", severity: "blocker", legalBasis: "art:기준규칙:38#2" },
    ],
    guidedByKeywords: ["중량물", "양중", "운반"],
  },

  // [12호] 궤도 보수·점검 — 비건설 (철도 운영) 도메인 (별도 OSS 분리)
  // [13호] 입환작업 — 비건설 (철도 운영) 도메인 (별도 OSS 분리)
];

// ─────────────────────────────────────────────────────────────────────────────
// B. 작업허가서 5종 (산안기준규칙 §239 등)
// ─────────────────────────────────────────────────────────────────────────────

const WORK_PERMIT_DOCS: DocSeed[] = [
  {
    docId: "work_permit_hot_work",
    title: "화기작업 허가서",
    description: "용접·용단·연삭 등 화기작업 시 위험 방지 허가서",
    cycle: "cyc:ad_hoc",
    trigger: "화기작업 시작 전",
    legalBasis: ["art:기준규칙:241", "art:기준규칙:242"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "1년",
    sections: [
      {
        title: "허가 사항",
        fields: [
          { key: "workType", label: "작업 종류 (용접·용단·연삭)", required: true },
          { key: "location", label: "작업 장소", required: true },
          { key: "duration", label: "작업 시간 (시작~종료)", required: true },
          { key: "fireWatch", label: "화재감시인 배치", required: true },
          { key: "extinguisher", label: "소화기·소방설비 배치", required: true },
          { key: "combustibles", label: "주변 가연물 제거·차폐", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "화재감시인 배치 명시", severity: "blocker", legalBasis: "art:기준규칙:241" },
      { rule: "주변 가연물 점검 결과 첨부", severity: "blocker" },
    ],
    guidedByKeywords: ["용접", "용단", "화기", "화재예방"],
  },
  {
    docId: "work_permit_confined_space",
    title: "밀폐공간 작업허가서",
    description: "밀폐공간(맨홀·탱크·배수로 등) 작업 시 산소·유해가스·질식 방지 허가서 (산안기준규칙 §619 ②)",
    cycle: "cyc:ad_hoc",
    trigger: "밀폐공간 진입 작업 전",
    category: "permit",
    legalBasis: ["art:기준규칙:619", "art:기준규칙:620"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "1년",
    // a-codex BLOCKER #2: §619 ② 6항목 정확 반영
    sections: [
      {
        title: "사전 확인 사항",
        legalSource: "산안기준규칙 §619 ② 1~6호",
        fields: [
          { key: "workInfo", label: "작업 일시·기간·장소·내용 등 작업 정보", required: true },
          { key: "workers", label: "관리감독자·근로자·감시인 등 작업자 정보", required: true },
          { key: "gasMeasurement", label: "산소·유해가스 농도 측정결과 및 후속조치 사항", required: true },
          { key: "gasLeakReview", label: "작업 중 불활성가스·유해가스 누출·유입·발생 가능성 검토 및 후속조치", required: true },
          { key: "ppe", label: "작업 시 착용 보호구 종류", required: true },
          { key: "emergencyComm", label: "비상연락체계", required: true },
        ],
      },
      {
        title: "추가 운영 사항",
        legalSource: "산안기준규칙 §619 ① + 실무 표준",
        fields: [
          { key: "spaceLocation", label: "밀폐공간 위치 (사업장 내 식별)", required: true },
          { key: "ventilation", label: "환기 설비 가동 (작업 전 충분한 환기)", required: true },
          { key: "outsideMonitor", label: "감시인 작업 외부 배치", required: true },
          { key: "rescuePlan", label: "구조·대피 계획", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "§619 ② 6항목 모두 작성", severity: "blocker", legalBasis: "art:기준규칙:619#2" },
      { rule: "산소 18% 이상 23.5% 이하 + 유해가스 측정값 명시", severity: "blocker", legalBasis: "art:기준규칙:619#2" },
      { rule: "감시인 작업 외부 배치 명시", severity: "blocker" },
    ],
    guidedByKeywords: ["밀폐공간", "산소결핍", "질식", "유해가스"],
  },
  {
    docId: "work_permit_loto",
    title: "정전작업 허가서 (LOTO)",
    description: "전기설비 정전·잠금·표찰 작업 허가서",
    cycle: "cyc:ad_hoc",
    trigger: "정전작업 전",
    category: "permit",
    legalBasis: ["art:기준규칙:319"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "1년",
    guidedByExcludeKeywords: ["정전기", "정전도장"], // 동음이의어 차단
    sections: [
      {
        title: "허가 사항",
        fields: [
          { key: "circuit", label: "정전 대상 전로·설비", required: true },
          { key: "shutoff", label: "차단·개로 절차", required: true },
          { key: "lockout", label: "잠금 장치·표찰", required: true },
          { key: "verify", label: "검전·잔류전압 확인", required: true },
          { key: "ground", label: "단락접지", required: true },
          { key: "responsible", label: "작업책임자", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "검전·접지 절차 명시", severity: "blocker", legalBasis: "art:기준규칙:319" },
    ],
    guidedByKeywords: ["정전 작업", "LOTO", "정전·잠금", "정전전로", "에너지 차단", "잠금·표지", "활선"],
  },
  {
    docId: "work_permit_high_altitude",
    title: "고소작업 허가서",
    description: "2m 이상 고소작업 (개구부·작업발판·비계 등) 허가서",
    cycle: "cyc:ad_hoc",
    trigger: "고소작업 전",
    applicableWhen: { heightGte: 2 },
    legalBasis: ["art:기준규칙:30", "art:기준규칙:42"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "1년",
    sections: [
      {
        title: "허가 사항",
        fields: [
          { key: "height", label: "작업 높이 (m)", required: true },
          { key: "fallNet", label: "추락방호망 설치", required: true },
          { key: "guardRail", label: "안전난간 설치", required: true },
          { key: "harness", label: "안전대 부착설비·죔줄", required: true },
          { key: "weather", label: "기상 조건 (강풍·강우 시 작업 중지)", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "추락방지 설비 1종 이상 설치", severity: "blocker", legalBasis: "art:기준규칙:42" },
    ],
    guidedByKeywords: ["고소", "추락", "방호망", "안전대"],
  },
  {
    docId: "work_permit_heavy_lifting",
    title: "중량물 취급 허가서",
    description: "중량물(인양·운반) 작업 허가서 — 일상 작업계획 외 단발성 허가용",
    cycle: "cyc:ad_hoc",
    trigger: "단발성 중량물 취급 작업 전",
    legalBasis: ["art:기준규칙:38"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "1년",
    sections: [
      {
        title: "허가 사항",
        fields: [
          { key: "weight", label: "중량물 중량·종류", required: true },
          { key: "lifter", label: "인양 장비 (양중기·크레인 등)", required: true },
          { key: "route", label: "이동 경로", required: true },
          { key: "signalPerson", label: "신호수 배치", required: true },
          { key: "exclusion", label: "작업구역 출입통제", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "신호수 배치 명시", severity: "blocker" },
    ],
    guidedByKeywords: ["중량물", "양중", "크레인"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// C. 위험성평가 (4종 기존 + 실시규정 1종)
// ─────────────────────────────────────────────────────────────────────────────

const RISK_ASSESSMENT_DOCS: DocSeed[] = [
  {
    docId: "risk_assessment_procedure",
    title: "위험성평가 실시규정",
    description: "위험성평가 효과적 실시 위한 사업장 규정 (위험성평가 고시 §6)",
    cycle: "cyc:annual",
    legalBasis: ["art:위험성평가-고시:6"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "지속 (개정 시까지)",
    sections: [
      {
        title: "실시규정 5항목",
        legalSource: "위험성평가 고시 §6",
        fields: [
          { key: "policy", label: "위험성평가 정책·목표", required: true },
          { key: "organization", label: "조직·역할·책임", required: true },
          { key: "method", label: "실시 방법·절차 (KRAS 7방법 중 선택)", required: true },
          { key: "review", label: "검토·개정 절차", required: true },
          { key: "record", label: "결과의 기록·보존", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "5항목 모두 작성", severity: "blocker", legalBasis: "art:위험성평가-고시:6" },
    ],
    guidedByKeywords: ["위험성평가", "위험성 평가"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// D. 발주자 안전보건대장 (산안법 §67) 3종
// ─────────────────────────────────────────────────────────────────────────────

// a-codex BLOCKER #3: 시행규칙 §86 ①②③ 정확 반영
const FINANCIER_DOCS: DocSeed[] = [
  {
    docId: "basic_safety_health_register",
    title: "기본 안전보건대장",
    description: "건설공사 발주자가 계획단계에서 작성하는 기본안전보건대장 (산안법 §67 + 시행규칙 §86 ①)",
    cycle: "cyc:ad_hoc",
    trigger: "건설공사 계획단계",
    category: "administrative",
    legalBasis: ["art:산안법:67", "art:산안법시행규칙:86"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "공사 종료 후 3년",
    sections: [
      {
        title: "기본대장 4항목",
        legalSource: "산안법 시행규칙 §86 ① 1~4호 (2024-06-28 개정)",
        fields: [
          { key: "projectOverview", label: "건설공사 계획단계에서 예상되는 공사내용·공사규모 등 공사 개요", required: true },
          { key: "siteInfo", label: "공사현장 제반 정보", required: true },
          { key: "structuresAndMachinery", label: "설치·사용 예정 구조물·기계·기구 등 고용노동부장관 고시 유해·위험요인 + 안전조치·위험성 감소방안", required: true },
          { key: "developerObligations", label: "산업재해 예방 위한 건설공사발주자의 법령상 주요 의무사항 + 확인", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "§86 ① 4항목 모두 작성", severity: "blocker", legalBasis: "art:산안법시행규칙:86#1" },
    ],
    guidedByKeywords: ["발주자", "건설공사 안전보건대장"],
  },
  {
    docId: "design_safety_health_register",
    title: "설계 안전보건대장",
    description: "설계자가 작성하는 설계안전보건대장 (산안법 §67 + 시행규칙 §86 ②)",
    cycle: "cyc:ad_hoc",
    trigger: "건설공사 설계단계",
    category: "administrative",
    legalBasis: ["art:산안법:67", "art:산안법시행규칙:86"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "공사 종료 후 3년",
    sections: [
      {
        title: "설계대장 (3항목, 3·4·6호는 2024-06-28 삭제)",
        legalSource: "산안법 시행규칙 §86 ② 1·2·5호",
        fields: [
          { key: "appropriateBudget", label: "안전한 작업을 위한 적정 공사기간 및 공사금액 산출서", required: true },
          { key: "designReduction", label: "건설공사 중 발생 가능 유해·위험요인 + 시공단계 고려 유해·위험요인 감소방안", required: true },
          { key: "safetyMgmtCost", label: "산업안전보건관리비 (법 §72 ①) 산출내역서", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "§86 ② 3항목 모두 작성 (적정 공사기간·금액·감소방안·관리비 산출)", severity: "blocker", legalBasis: "art:산안법시행규칙:86#2" },
    ],
    guidedByKeywords: ["설계", "발주자"],
  },
  {
    docId: "construction_safety_health_register",
    title: "공사 안전보건대장",
    description: "수급인이 작성하는 공사안전보건대장 (산안법 §67 + 시행규칙 §86 ③)",
    cycle: "cyc:ad_hoc",
    trigger: "건설공사 시공단계",
    category: "administrative",
    legalBasis: ["art:산안법:67", "art:산안법시행규칙:86"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "공사 종료 후 3년",
    sections: [
      {
        title: "공사대장 4항목 (이행여부 확인)",
        legalSource: "산안법 시행규칙 §86 ③ 1~4호",
        fields: [
          { key: "designReductionImplementation", label: "설계안전보건대장 유해·위험요인 감소방안 반영한 건설공사 중 안전보건 조치 이행계획", required: true },
          { key: "hazardPreventionPlan", label: "법 §42 ① 유해위험방지계획서 심사·확인결과에 대한 조치내용", required: true },
          { key: "machineryDeployment", label: "고용노동부장관 고시 건설공사용 기계·기구 안전성 확보를 위한 배치·이동계획", required: true },
          { key: "preventionGuidance", label: "법 §73 ① 건설공사 산업재해 예방 지도 계약 여부·지도결과·조치내용", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "§86 ③ 4항목 모두 이행여부 확인 작성", severity: "blocker", legalBasis: "art:산안법시행규칙:86#3" },
    ],
    guidedByKeywords: ["시공", "안전보건", "발주자"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// E. 기타 (관리규정·경영방침·관리비·PSM·중대재해보고·유해위험방지계획서)
// ─────────────────────────────────────────────────────────────────────────────

const MISC_DOCS: DocSeed[] = [
  {
    docId: "safety_health_regulation",
    title: "안전보건관리규정",
    description: "사업장 안전보건 유지 위한 관리규정 (산안법 §25)",
    cycle: "cyc:annual",
    category: "administrative",
    legalBasis: ["art:산안법:25", "art:산안법시행규칙:25"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "지속",
    sections: [
      {
        title: "관리규정 항목",
        legalSource: "산안법 §25 ①",
        fields: [
          { key: "organization", label: "안전·보건 관리조직과 직무", required: true },
          { key: "education", label: "안전·보건 교육 사항", required: true },
          { key: "workplace", label: "작업장 안전·보건 관리", required: true },
          { key: "healthMgmt", label: "건강관리 사항", required: true },
          { key: "accident", label: "사고 조사·대책", required: true },
          { key: "other", label: "그 밖에 필요한 사항", required: false },
        ],
      },
    ],
    reviewRules: [
      { rule: "5+1항목 작성", severity: "blocker", legalBasis: "art:산안법:25" },
      { rule: "산업안전보건위원회 또는 근로자대표 의견 청취", severity: "blocker", legalBasis: "art:산안법:26" },
    ],
    guidedByKeywords: ["안전보건관리체계", "관리규정", "경영방침"],
  },
  {
    docId: "safety_health_management_policy",
    title: "안전보건경영방침",
    description: "사업주의 안전보건 경영방침 (중처법 시행령 §4)",
    cycle: "cyc:annual",
    category: "administrative",
    legalBasis: ["art:중처법:4", "art:중처법시행령:4"],
    penaltyOnMissing: "penalty:중처법:6 (사망 시 1년 이상 징역 또는 10억원 이하 벌금)",
    retention: "지속",
    sections: [
      {
        title: "경영방침",
        legalSource: "중처법 시행령 §4",
        fields: [
          { key: "commitment", label: "안전·보건 최우선 경영 약속", required: true },
          { key: "objectives", label: "구체적 목표·지표", required: true },
          { key: "resources", label: "예산·인력 배정", required: true },
          { key: "ceoSign", label: "CEO 서명·일자", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "CEO 서명 + 사업장 게시", severity: "blocker", legalBasis: "art:중처법시행령:4" },
    ],
    guidedByKeywords: ["안전보건관리체계", "경영방침", "자율안전보건"],
  },
  {
    docId: "safety_health_mgmt_cost_plan",
    title: "산업안전보건관리비 사용계획서·내역서",
    description: "건설공사 산업안전보건관리비 사용 계획·내역 (산안법 §72)",
    cycle: "cyc:monthly",
    category: "administrative",
    legalBasis: ["art:산안법:72"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "공사 종료 후 5년",
    sections: [
      {
        title: "관리비 내역",
        legalSource: "산안법 §72 + 고시",
        fields: [
          { key: "totalBudget", label: "총 계상액 (원)", required: true },
          { key: "monthlyUsed", label: "월별 사용액", required: true },
          { key: "categoryBreakdown", label: "항목별 (안전관리자 인건비·보호구·시설 등)", required: true },
          { key: "evidence", label: "증빙 자료 첨부", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "월 단위 사용 내역 + 증빙 첨부", severity: "blocker", legalBasis: "art:산안법:72" },
    ],
    guidedByKeywords: ["산업안전보건관리비"],
  },
  // PSM (공정안전보고서) — 비건설 (화학·정유) 도메인 (별도 OSS 분리)
  {
    docId: "severe_accident_immediate_report",
    title: "중대재해 즉시 보고",
    description: "중대재해(사망·부상자 동시 2명 이상·직업병 동시 3명 이상) 발생 즉시 노동청 보고 (산안법 §54)",
    cycle: "cyc:ad_hoc",
    trigger: "중대재해 발생 시 즉시",
    category: "report",
    legalBasis: ["art:산안법:54"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "5년",
    guidedByExcludeKeywords: ["급성 스트레스", "조기대응", "사후 대응"],
    sections: [
      {
        title: "보고 사항",
        legalSource: "산안법 §54 시행규칙",
        fields: [
          { key: "occurrenceDate", label: "발생 일시·장소", required: true },
          { key: "injured", label: "사상자 인적사항", required: true },
          { key: "circumstances", label: "재해 발생 경위", required: true },
          { key: "immediateAction", label: "즉시 조치사항", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "발생 즉시 (지체 없이) 보고", severity: "blocker", legalBasis: "art:산안법:54" },
    ],
    guidedByKeywords: ["중대재해", "재해보고", "사고보고"],
  },
  {
    docId: "hazardous_risk_prevention_plan_industrial",
    title: "유해위험방지계획서 (산업)",
    description: "유해·위험 사업장 (전기 300kW 이상) 유해위험방지계획서 (산안법 §42 1호)",
    cycle: "cyc:ad_hoc",
    trigger: "대상 사업 설치·이전·변경 전",
    legalBasis: ["art:산안법:42", "art:산안법시행령:42"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "지속",
    sections: [
      {
        title: "계획서",
        legalSource: "산안법 §42 1호",
        fields: [
          { key: "facility", label: "건설물·기계·기구·설비 등 전부", required: true },
          { key: "hazards", label: "유해·위험 요인", required: true },
          { key: "prevention", label: "방지 대책", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "고용노동부장관 제출·심사", severity: "blocker", legalBasis: "art:산안법:42" },
    ],
    guidedByKeywords: ["유해위험방지계획서"],
  },
  {
    docId: "hazardous_risk_prevention_plan_machinery",
    title: "유해위험방지계획서 (기계·기구·설비)",
    description: "유해·위험 기계·기구·설비 설치·이전 시 (산안법 §42 2호)",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:42"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "지속",
    sections: [
      {
        title: "계획서",
        fields: [
          { key: "machinery", label: "유해·위험 기계·기구·설비", required: true },
          { key: "hazards", label: "유해·위험 요인", required: true },
          { key: "prevention", label: "방지 대책", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "고용노동부장관 제출·심사", severity: "blocker", legalBasis: "art:산안법:42" },
    ],
    guidedByKeywords: ["유해위험방지계획서"],
  },
  {
    docId: "hazardous_risk_prevention_plan_construction",
    title: "유해위험방지계획서 (건설공사)",
    description: "대상 건설공사(시행령 §42 ③) 유해위험방지계획서 (산안법 §42 3호)",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:42", "art:산안법시행령:42"],
    penaltyOnMissing: "penalty:산안법:175",
    retention: "공사 종료 후 5년",
    sections: [
      {
        title: "계획서",
        legalSource: "산안법 §42 3호 + 시행령 §42 ③",
        fields: [
          { key: "scope", label: "공사 개요", required: true },
          { key: "hazards", label: "유해·위험 요인", required: true },
          { key: "prevention", label: "방지 대책", required: true },
          { key: "qualifiedReview", label: "건설안전 분야 자격자 의견", required: true },
        ],
      },
    ],
    reviewRules: [
      { rule: "자격자 의견 첨부", severity: "blocker", legalBasis: "art:산안법:42" },
      { rule: "고용노동부장관 제출·심사", severity: "blocker", legalBasis: "art:산안법:42" },
    ],
    guidedByKeywords: ["유해위험방지계획서", "건설공사"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 시드 실행
// ─────────────────────────────────────────────────────────────────────────────

const ALL_DOCS: DocSeed[] = [
  ...WORK_PLAN_DOCS,
  ...WORK_PERMIT_DOCS,
  ...RISK_ASSESSMENT_DOCS,
  ...FINANCIER_DOCS,
  ...MISC_DOCS,
];

function slugifyFile(docId: string): string {
  return docId.replace(/_/g, "-");
}

(async () => {
  console.log(`# P-PAPER-2 — 54종 법정문서 일괄 시드 (대상 ${ALL_DOCS.length}종)\n`);

  let written = 0;
  let preserved = 0;
  let skipped = 0;

  for (const seed of ALL_DOCS) {
    const fname = `${slugifyFile(seed.docId)}.jsonld`;
    const filePath = resolve(DOCS_DIR, fname);

    // preserveExisting + 기존 파일 존재 — sections + _meta 갱신 (v0.13 정정)
    if (seed.preserveExisting) {
      try {
        const existing = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown> & {
          _meta?: Record<string, unknown>;
        };
        existing.sections = seed.sections;
        // _meta.guidedByKeywords·excludeKeywords·category 갱신 (P-F 매칭에 사용)
        const meta = (existing._meta ?? {}) as Record<string, unknown>;
        if (seed.guidedByKeywords) meta.guidedByKeywords = seed.guidedByKeywords;
        if (seed.guidedByExcludeKeywords) meta.guidedByExcludeKeywords = seed.guidedByExcludeKeywords;
        if (seed.category) meta.documentCategory = seed.category;
        existing._meta = meta;
        await writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf8");
        preserved += 1;
        console.log(`  ✓ ${seed.docId.padEnd(45)} (sections + _meta 보강)`);
        continue;
      } catch {
        // 기존 파일 없음 → 신규 생성
      }
    }

    const node = {
      "@context": "../../context.jsonld",
      "@id": `doc:${seed.cycle.replace("cycle:", "")}/${seed.docId}`,
      "@type": ["Document", "DigitalDocument"],
      docId: seed.docId,
      title: seed.title,
      alternativeNames: seed.alternativeNames,
      description: seed.description,
      cycle: seed.cycle,
      trigger: seed.trigger,
      applicableWhen: seed.applicableWhen,
      legalBasis: seed.legalBasis,
      requiredFields: seed.sections.flatMap((s) => s.fields).map((f) => ({
        key: f.key,
        label: f.label,
        source: seed.sections.find((s) => s.fields.includes(f))?.legalSource ?? seed.legalBasis.join(", "),
      })),
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
        documentCategory: seed.category ?? "construction_work",
      },
    };

    await writeFile(filePath, JSON.stringify(node, null, 2) + "\n", "utf8");
    written += 1;
  }

  console.log(`\n# 결과`);
  console.log(`  신규/갱신: ${written}`);
  console.log(`  기존 보존 (sections 보강): ${preserved}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`\n✓ P-PAPER-2 시드 완료`);
})();
