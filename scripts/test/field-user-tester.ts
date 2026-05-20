#!/usr/bin/env tsx
/**
 * 현장 사용자 테스터 패킷 생성.
 *
 * 안전관리자/현장소장이 실제 검수자처럼 읽고 평가할 수 있도록
 * 입력값, 생성 문서, 자동 검토 결과, 수기 체크리스트, 피드백 양식을 한 번에 만든다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { reviewSafetyDocumentTool } from "../../build/tools/review-safety-document.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUT = resolve(ROOT, "artifacts", "test-results", "field-user-tester");
const CURRENT_DATE = "2026-05-04";

type Persona = "safety_manager" | "site_manager";

interface Scenario {
  id: string;
  title: string;
  persona: Persona;
  roleLabel: string;
  docId: string;
  context: string;
  task: string;
  input: Record<string, unknown>;
  expectedPhrases: string[];
  necessarySections: string[];
  mustAnswer: string[];
  fieldQuestions: string[];
  acceptCriteria: string[];
}

interface AutoEvaluation {
  id: string;
  title: string;
  roleLabel: string;
  docId: string;
  missingRequired: number;
  reflected: string;
  missingExpectedPhrases: string[];
  necessarySections: string;
  missingNecessarySections: string[];
  koshaGuideCount: number;
  hazardCount: number;
  controlCount: number;
  reviewOverall: string;
  reviewFail: number;
  reviewWarn: number;
  reviewManual: number;
  autoPass: boolean;
}

const approvalChain = [
  { role: "작성자", name: "김안전", title: "안전관리자", signed: true, date: CURRENT_DATE },
  { role: "관리감독자", name: "박반장", title: "토공반장", signed: true, date: CURRENT_DATE },
  { role: "현장소장", name: "이소장", title: "안전보건관리책임자", signed: true, date: CURRENT_DATE },
];

const emergencyContacts = {
  fire: "119",
  labor: "고용노동부 천안지청 041-560-2800",
  hospital: "단국대학교병원 권역응급센터 041-550-6840",
  owner: "이소장 010-1111-2222",
};

const SCENARIOS: Scenario[] = [
  {
    id: "S1_safety_manager_excavation",
    title: "굴착 5m + 도시가스 인접 작업계획서",
    persona: "safety_manager",
    roleLabel: "안전관리자",
    docId: "work_plan_excavation",
    context: "작업 전날, 도시가스관이 인접한 5m 굴착 작업계획서를 결재 전 검토한다.",
    task: "이 문서가 실제 굴착 작업 전 근로자에게 설명하고 현장소장 결재를 받을 수 있는 수준인지 판단한다.",
    input: {
      useProfile: false,
      scale: { workforce: 8, constructionValue: 42, industry: "construction" },
      draft: {
        documentId: "WP-EXC-20260504-01",
        documentNumber: "WP-EXC-20260504-01",
        siteName: "천안 성정동 근린생활시설 신축공사",
        compileDate: CURRENT_DATE,
        compiler: "김안전 (안전관리자)",
        workPeriod: "2026-05-05 08:00 ~ 2026-05-07 17:00",
        approvalChain,
        emergencyContacts,
        workConditions: {
          depthM: 5,
          locationDetail: "A구간 북측 흙막이 라인, 도시가스관 GL-1.5m 인접",
          workforce: 8,
          weather: "맑음, 풍속 3m/s",
        },
        preSurvey_shape: "굴착 폭 8m, 길이 32m, 계획 굴착깊이 GL-5.0m. 상부 풍화토, 하부 풍화암.",
        preSurvey_crack: "인접 상가 외벽 기존 균열 없음. 전일 우천으로 표층 함수비 높아 사면 유실 가능.",
        preSurvey_buried: "도시가스관 GL-1.5m, 상수도관 GL-1.2m, 통신관로 GL-0.8m. 각 관리기관 위치 확인 완료.",
        preSurvey_groundwater: "지하수위 GL-4.2m. 집수정 2개와 양수펌프 2대 설치, 예비펌프 1대 대기.",
        plan_method: "1단계 표토 제거 후 GL-2.0m까지 굴삭기 굴착, 2단계 흙막이 지보공 설치, 3단계 GL-5.0m까지 1m 단위 굴착.",
        plan_workers: "굴삭기 운전원 1명, 토공 6명, 신호수 1명, 작업지휘자 1명.",
        plan_protection: "도시가스공사 입회 하에 가스관 1m 이내 인력굴착. 보호박스 설치, 굴삭기 버킷 접근금지선 1m 표시.",
        plan_signal: "전담 신호수 1명 배치, 무전기 채널 3번, 굴삭기 후방 접근 시 수신호+무전 병행.",
        plan_shoring: "H-300 엄지말뚝 + 토류판, 어스앵커 2단. 계측핀 일 2회 확인, 변위 10mm 초과 시 작업중지.",
        plan_director: "박반장 (토공 관리감독자, 굴착작업 경력 12년)",
        notifiedToWorkers: "2026-05-04 16:30 TBM에서 작업순서·매설물 위치·비상대피로 설명 후 참석자 8명 서명.",
        compiler_sign: "김안전 (안전관리자, 서명)",
        supervisor_sign: "박반장 (관리감독자, 서명)",
        principal_sign: "이소장 (현장소장, 서명)",
      },
    },
    expectedPhrases: ["도시가스관 GL-1.5m", "GL-5.0m", "양수펌프 2대", "가스관 1m 이내 인력굴착", "계측핀 일 2회", "TBM에서 작업순서"],
    necessarySections: ["작업 조건", "식별된 위험 요소", "권장 안전대책", "적용 KOSHA Guide", "법령 근거", "비상연락망"],
    mustAnswer: [
      "굴착 깊이 2m 이상 작업계획서 작성 대상임을 알 수 있어야 한다.",
      "매설물 보호, 흙막이, 지하수, 신호수, 작업지휘자 내용이 빠지지 않아야 한다.",
      "근로자 통지 여부와 결재 가능 여부가 분명해야 한다.",
    ],
    fieldQuestions: [
      "이 문서를 그대로 TBM에서 설명해도 작업자가 위험 위치와 금지선을 이해할 수 있는가?",
      "운영사 입회, 시굴, 계측 기준 같은 첨부 확인이 필요한 항목이 사람 검토로 남는가?",
      "권장 안전대책이 실제 굴착 현장에 맞는가, 너무 일반적인가?",
    ],
    acceptCriteria: [
      "필수 미작성 0건",
      "가스관, 지하수, 흙막이, 신호수, 근로자 통지 반영",
      "review 결과 fail 0건",
      "manual_review가 첨부·정성 확인 항목으로 남음",
    ],
  },
  {
    id: "S2_site_manager_severe_accident",
    title: "추락 중대재해 즉시보고",
    persona: "site_manager",
    roleLabel: "현장소장",
    docId: "severe_accident_immediate_report",
    context: "119 신고 직후 현장소장이 노동청 1차 보고와 현장보존 기록을 급히 정리한다.",
    task: "보고서가 즉시보고, 작업중지, 현장보존, 후속 산재조사표 준비에 충분한지 판단한다.",
    input: {
      useProfile: false,
      scale: { workforce: 37, constructionValue: 42, industry: "construction" },
      draft: {
        documentId: "SAR-20260504-01",
        reportNumber: "SAR-20260504-01",
        reportTime: "2026-05-04 10:42 전화 1차 보고, 11:05 이메일 2차 송부",
        reportMethod: "천안고용노동지청 산재예방지도과 전화 보고 후 이메일 보고서 송부",
        reportTo: "대전지방고용노동청 천안지청 산재예방지도과 041-560-2800",
        siteName: "천안 성정동 근린생활시설 신축공사",
        businessNumber: "312-81-45678",
        siteAddress: "충남 천안시 서북구 성정동 1200-4, 지상 4층 골조구간",
        principalName: "이소장 010-1111-2222",
        victimList: [
          {
            name: "최작업",
            birthDate: "1982-03-12",
            nationality: "한국",
            employer: "대한비계(주)",
            occupation: "비계공",
            employmentType: "일용",
            accidentType: "추락",
            injurySeverity: "의식저하, 우측 대퇴부 골절 의심",
            hospital: "단국대학교병원 권역응급센터",
          },
        ],
        accidentDateTime: "2026-05-04 10:18",
        accidentLocation: "A동 4층 외부 시스템비계 3스팬 구간",
        accidentSummary: "외벽 자재 정리 중 안전대 후크를 옮겨 거는 과정에서 작업발판 단부로 미끄러져 약 5.8m 아래 2층 데크로 추락. 10:20 119 신고, 10:34 구급대 현장 도착, 10:40 병원 이송.",
        accidentType: "추락 (KOSHA 발생형태 01)",
        rootCause: "인적: 이동 중 후크 미체결 / 설비: 단부 중간난간 일부 해체 / 작업환경: 자재 적치로 통로 협소 / 관리적: 비계 변경 후 점검 기록 누락",
        emergencyResponse: "10:18 작업중지 및 접근통제, 10:20 119 신고, 10:22 현장소장 보고, 10:35 전 근로자 대피 및 동일 작업 전면 중지.",
        workSuspension: "A동 외부비계 전 구간 및 고소작업 전면 중지. 비계 재점검, 난간 복구, 작업발판 정리 전까지 재개 금지.",
        preservationOfScene: "사고 위치 출입통제선 설치, 사진 18장·CCTV 10:00~10:30 확보, 임의 정리 금지 공지.",
        attachments: "현장 사진 18장, 사고 동선 스케치 1부, CCTV 파일 1개, 비계 변경 작업허가서 사본",
        subsequentReport: "2026-05-31 전 산업재해조사표 별지 제30호 제출 예정. 원인조사 완료 후 수시 위험성평가 실시.",
        reporterSign: "김안전 (안전관리자, 010-3333-4444, 서명)",
        principalSign: "이소장 (현장소장, 서명)",
        approvalChain: [
          { role: "보고자", name: "김안전", title: "안전관리자", signed: true, date: CURRENT_DATE },
          { role: "현장소장", name: "이소장", title: "안전보건관리책임자", signed: true, date: CURRENT_DATE },
        ],
        emergencyContacts,
      },
    },
    expectedPhrases: ["천안고용노동지청", "최작업", "시스템비계", "5.8m", "후크 미체결", "사진 18장", "산업재해조사표"],
    necessarySections: ["보고 정보", "재해자 정보", "즉시 조치", "첨부 / 후속 보고", "법령 근거", "비상연락망"],
    mustAnswer: [
      "보고 시간, 보고처, 보고 방법이 즉시보고 관점에서 명확해야 한다.",
      "응급조치, 작업중지 범위, 현장보존 조치가 시간순으로 확인되어야 한다.",
      "후속 산재조사표 제출 일정이 빠지지 않아야 한다.",
    ],
    fieldQuestions: [
      "이 문서를 보고 현장소장이 바로 노동청 추가 질문에 답할 수 있는가?",
      "현장보존과 사진/CCTV 확보 내용이 조사 대응에 충분한가?",
      "중대재해 보고 문서에 불필요한 위험성평가 내용이 과하게 섞이지 않았는가?",
    ],
    acceptCriteria: [
      "필수 미작성 0건",
      "재해자, 사고장소, 발생경위, 응급조치, 현장보존, 후속보고 일정 반영",
      "review 결과 fail 0건",
      "KOSHA Guide가 0건이어도 법령과 보고 흐름은 충분히 명확",
    ],
  },
  {
    id: "S3_safety_manager_msds",
    title: "신너 600 MSDS 비치대장",
    persona: "safety_manager",
    roleLabel: "안전관리자",
    docId: "msds_register",
    context: "도장 작업 전 안전관리자가 MSDS 비치, 교육, GHS 라벨, PPE 상태를 등록한다.",
    task: "화학물질 목록과 교육·게시 증빙이 실제 현장 비치대장으로 충분한지 판단한다.",
    input: {
      useProfile: false,
      scale: { workforce: 12, constructionValue: 18, industry: "construction" },
      draft: {
        documentId: "MSDS-20260504-01",
        siteName: "천안 성정동 근린생활시설 신축공사 도장구간",
        registerNumber: "MSDS-2026-05",
        compileDate: CURRENT_DATE,
        compiler: "김안전 (안전관리자)",
        totalChemicals: "2종 (신너 600, 우레탄 방수재)",
        chemicalList: [
          {
            productName: "신너 600",
            casNumber: "혼합물: 톨루엔 108-88-3, 자일렌 1330-20-7 포함",
            manufacturer: "대한화학",
            monthlyVolume: "18L 4통",
            storageLocation: "1층 도료보관함, 방폭 환기팬 설치",
            msdsValidUntil: "2027-12-31",
            exposureLimit: "톨루엔 TWA 50ppm",
            mainHazard: "고인화성 액체 및 증기, 흡입 시 유해",
            requiredPPE: "유기증기용 방독마스크, 니트릴장갑, 보안경",
          },
          {
            productName: "우레탄 방수재 A제",
            casNumber: "혼합물",
            manufacturer: "한빛케미칼",
            monthlyVolume: "20kg 6통",
            storageLocation: "방수자재 창고",
            msdsValidUntil: "2027-08-31",
            exposureLimit: "제품 MSDS 참조",
            mainHazard: "피부자극, 증기 흡입 유해",
            requiredPPE: "방독마스크, 화학보호장갑",
          },
        ],
        msdsAttachment: "MSDS 원본 2부를 안전관리사무실 바인더와 1층 도료보관함에 비치.",
        msdsPosting: "도료보관함 출입문, 3층 도장작업구간 게시판, 안전교육장에 게시.",
        msdsTraining: "2026-05-04 15:00 도장작업자 6명 대상 1시간 교육, 강사 김안전.",
        trainingRecord: "MSDS 교육일지 MSDS-EDU-20260504 및 참석자 자필 서명부 6명 첨부.",
        ghsLabel: "신너 600 소분 용기 4개 모두 GHS 경고표지 부착 완료.",
        containerStandard: "소분용기는 금속 밀폐용기만 사용, 화기 10m 이내 반입금지, 잔량은 지정폐기물 보관함 이동.",
        compiler_sign: "김안전 (안전관리자, 서명)",
        supervisor_sign: "박반장 (관리감독자, 서명)",
        principal_sign: "이소장 (현장소장, 서명)",
        approvalChain,
        emergencyContacts,
      },
    },
    expectedPhrases: ["신너 600", "톨루엔 108-88-3", "유기증기용 방독마스크", "MSDS 교육일지", "GHS 경고표지", "화기 10m"],
    necessarySections: ["화학물질 목록", "MSDS 게시 / 교육", "라벨 / 경고표지", "식별된 위험 요소", "법령 근거"],
    mustAnswer: [
      "물질별 목록이 표 형태로 읽혀야 한다.",
      "MSDS 원본 비치 위치와 교육 증빙이 확인되어야 한다.",
      "GHS 라벨과 소분 용기 관리 기준이 확인되어야 한다.",
    ],
    fieldQuestions: [
      "실제 도장 작업자가 이 문서만 보고 보호구와 보관 위치를 알 수 있는가?",
      "CAS/구성, 취급량, 유효기한, 노출기준 표기가 충분한가?",
      "화학물질 위험요인과 PPE 대책이 현장 감각에 맞는가?",
    ],
    acceptCriteria: [
      "필수 미작성 0건",
      "화학물질 목록이 JSON이 아니라 표로 표시",
      "교육, 게시, GHS, PPE, 보관 위치 반영",
      "review 결과 fail 0건",
    ],
  },
  {
    id: "S4_safety_manager_regular_risk_assessment",
    title: "정기 위험성평가",
    persona: "safety_manager",
    roleLabel: "안전관리자",
    docId: "regular_risk_assessment",
    context: "연 1회 정기 위험성평가를 현장소장 결재용으로 작성한다.",
    task: "평가 범위, KRAS 방법, 근로자대표 참여, 위험성평가 결과표가 결재 가능한지 판단한다.",
    input: {
      useProfile: false,
      scale: { workforce: 37, constructionValue: 42, industry: "construction" },
      draft: {
        documentId: "RRA-2026-001",
        documentNumber: "RRA-2026-001",
        siteName: "천안 성정동 근린생활시설 신축공사",
        compileDate: CURRENT_DATE,
        compiler: "김안전 (안전관리자)",
        period: "2026-05-01 ~ 2026-05-04",
        reviewedItems: "2025년 최초평가 18건 중 완료 15건, 지연 3건. 지연 항목은 비계 단부 난간 보강, 굴착 계측 빈도, 도장작업 환기.",
        newHazards: "시스템비계 고소작업, GL-5m 굴착과 매설가스관 간섭, 신너 600 사용 도장작업, 이동식 크레인 자재 양중.",
        updatedControls: "비계 작업 전 체크리스트 의무화, 굴착 구간 계측 일 2회, 신너 작업 국소배기+방독마스크, 크레인 양중 신호수 전담 배치.",
        assessmentScope: "토공, 골조, 비계, 도장, 양중 작업 전 공정",
        assessmentMethod: "KRAS 5x4 matrix. 위험도 12 이상은 즉시개선, 8~11은 7일 내 개선.",
        assessmentTeam: "김안전, 이소장, 박반장, 근로자대표 정근로",
        riskRows: [
          { task: "굴착", hazard: "가스관 접촉", currentRisk: "4x4=16", control: "가스공사 입회+인력굴착", residualRisk: "2x3=6", owner: "박반장", due: "2026-05-05" },
          { task: "비계", hazard: "단부 추락", currentRisk: "4x5=20", control: "난간 복구+100% 안전대", residualRisk: "2x4=8", owner: "이소장", due: "2026-05-04" },
          { task: "도장", hazard: "유기용제 흡입", currentRisk: "3x4=12", control: "국소배기+방독마스크", residualRisk: "2x3=6", owner: "김안전", due: "2026-05-06" },
        ],
        workerRepSignature: "정근로 (근로자대표, 서명)",
        compiler_sign: "김안전 (안전관리자, 서명)",
        supervisor_sign: "박반장 (관리감독자, 서명)",
        principal_sign: "이소장 (현장소장, 서명)",
        approvalChain: [
          ...approvalChain,
          { role: "근로자대표", name: "정근로", title: "근로자대표", signed: true, date: CURRENT_DATE },
        ],
        emergencyContacts,
      },
    },
    expectedPhrases: ["KRAS 5x4 matrix", "가스관 접촉", "4x5=20", "국소배기", "근로자대표 정근로", "2026-05-06"],
    necessarySections: ["정기 위험성평가", "평가 범위", "위험성평가 결과표", "식별된 위험 요소", "권장 안전대책", "법령 근거"],
    mustAnswer: [
      "평가 기간, 전년도 검토, 신규 위험요인, 감소대책 갱신이 확인되어야 한다.",
      "KRAS 방법과 위험도 기준이 명확해야 한다.",
      "근로자대표 참여와 위험성평가 결과표가 결재용으로 보일 만큼 정리되어야 한다.",
    ],
    fieldQuestions: [
      "이 결과표를 현장소장이 보고 즉시 개선 우선순위를 판단할 수 있는가?",
      "가스관, 추락, 유기용제 위험이 실제 작업별로 구분되어 있는가?",
      "그래프가 제시한 위험요인과 대책이 사용자 입력 riskRows와 충분히 맞물리는가?",
    ],
    acceptCriteria: [
      "필수 미작성 0건",
      "평가 범위, KRAS 방법, 평가 참여자, 근로자대표 서명 반영",
      "위험성평가 결과표가 표로 표시",
      "review 결과 fail 0건",
      "riskRows 기반 동적 hazard 역추론 한계가 발견되면 개선 의견으로 기록",
    ],
  },
];

function readText(result: any): string {
  return String(result?.content?.[0]?.text ?? "");
}

function countMissing(text: string): number {
  const match = text.match(/필수 항목\s+(\d+)건 미작성/);
  return match ? Number(match[1]) : 0;
}

function containsAll(text: string, patterns: string[]): { hit: string[]; missing: string[] } {
  const hit = patterns.filter((p) => text.includes(p));
  return { hit, missing: patterns.filter((p) => !hit.includes(p)) };
}

function parseReviewSummary(review: any): { overall: string; fail: number; warn: number; manual: number } {
  const structured = review?.structuredContent as
    | { overall?: string; summary?: { fail?: number; warn?: number; manual_review?: number } }
    | undefined;
  return {
    overall: structured?.overall ?? "unknown",
    fail: structured?.summary?.fail ?? 0,
    warn: structured?.summary?.warn ?? 0,
    manual: structured?.summary?.manual_review ?? 0,
  };
}

function renderChecklist(s: Scenario, auto: AutoEvaluation): string {
  return [
    `# ${s.title} - 현장 사용자 체크리스트`,
    "",
    `- 테스트 역할: ${s.roleLabel}`,
    `- docId: \`${s.docId}\``,
    `- 상황: ${s.context}`,
    `- 테스트 과제: ${s.task}`,
    "",
    "## 자동 판정",
    "",
    `| 항목 | 결과 |`,
    `|---|---:|`,
    `| 필수 미작성 | ${auto.missingRequired} |`,
    `| 입력 반영 | ${auto.reflected} |`,
    `| 필요 섹션 | ${auto.necessarySections} |`,
    `| Hazard / Control / KOSHA | ${auto.hazardCount} / ${auto.controlCount} / ${auto.koshaGuideCount} |`,
    `| review overall | ${auto.reviewOverall} |`,
    `| review fail / warn / manual | ${auto.reviewFail} / ${auto.reviewWarn} / ${auto.reviewManual} |`,
    `| 자동 통과 | ${auto.autoPass ? "예" : "아니오"} |`,
    "",
    "## 반드시 확인할 내용",
    "",
    ...s.mustAnswer.map((item) => `- [ ] ${item}`),
    "",
    "## 현장 질문",
    "",
    ...s.fieldQuestions.map((item) => `- [ ] ${item}`),
    "",
    "## 합격 기준",
    "",
    ...s.acceptCriteria.map((item) => `- [ ] ${item}`),
    "",
    "## 수기 점수",
    "",
    "| 평가 항목 | 1 | 2 | 3 | 4 | 5 | 메모 |",
    "|---|:---:|:---:|:---:|:---:|:---:|---|",
    "| 입력 내용이 빠짐없이 반영됨 |  |  |  |  |  |  |",
    "| 문서가 실제 결재/보고에 쓸 수 있음 |  |  |  |  |  |  |",
    "| 법령 근거와 보존/제출 흐름이 납득됨 |  |  |  |  |  |  |",
    "| 위험요인과 대책이 현장 상황에 맞음 |  |  |  |  |  |  |",
    "| 부족한 항목을 사람이 보강하기 쉬움 |  |  |  |  |  |  |",
    "",
    "## 발견한 문제",
    "",
    "- ",
    "",
    "## 개선 요청",
    "",
    "- ",
    "",
  ].join("\n");
}

function renderFeedbackTemplate(s: Scenario): string {
  return JSON.stringify(
    {
      scenarioId: s.id,
      role: s.roleLabel,
      testerName: "",
      testedAt: "",
      scores: {
        inputReflection: null,
        practicalUsability: null,
        legalBasis: null,
        hazardControlFit: null,
        easeOfCorrection: null,
      },
      decision: "pass | needs_revision | fail",
      missingContent: [],
      wrongOrUnnecessaryContent: [],
      fieldNotes: "",
      requestedImprovements: [],
    },
    null,
    2,
  );
}

function renderIndex(rows: AutoEvaluation[]): string {
  return [
    "# 현장 사용자 테스터 패킷",
    "",
    "이 패킷은 안전관리자와 현장소장이 실제 업무자 관점에서 MCP 생성 문서를 평가하기 위한 자료다.",
    "",
    "## 사용 순서",
    "",
    "1. 각 시나리오 폴더의 `01-input.json`을 확인한다.",
    "2. `02-generated.md`를 실제 결재/보고 문서처럼 읽는다.",
    "3. `03-review.txt`에서 자동 검토 결과를 확인한다.",
    "4. `04-human-checklist.md`를 채점한다.",
    "5. `05-feedback-template.json`에 실제 의견을 기록한다.",
    "",
    "## 시나리오별 자동 결과",
    "",
    "| 시나리오 | 역할 | 입력 반영 | 필수 미작성 | 필요 섹션 | 그래프 | review | 자동 통과 |",
    "|---|---|---:|---:|---:|---|---|:---:|",
    ...rows.map((r) =>
      `| ${r.title} | ${r.roleLabel} | ${r.reflected} | ${r.missingRequired} | ${r.necessarySections} | H${r.hazardCount}/C${r.controlCount}/K${r.koshaGuideCount} | ${r.reviewOverall}, fail ${r.reviewFail} | ${r.autoPass ? "Y" : "N"} |`,
    ),
    "",
    "## 판정 기준",
    "",
    "- 자동 통과는 필수 미작성 0건, 기대 입력 전부 반영, 필요 섹션 전부 표시, review fail 0건일 때만 표시한다.",
    "- 최종 판정은 사람이 한다. 자동 통과여도 현장 표현이 부정확하거나 불필요한 내용이 많으면 `needs_revision`으로 기록한다.",
    "- 문서가 실제 업무에 쓸 수 있는지, 작업자가 이해할 수 있는지, 현장소장이 결재/보고할 수 있는지를 우선 본다.",
    "",
  ].join("\n");
}

async function runScenario(s: Scenario): Promise<AutoEvaluation> {
  const dir = resolve(OUT, s.id);
  await mkdir(dir, { recursive: true });

  const generated: any = await generateSafetyDocumentTool.handler({
    docId: s.docId,
    ...s.input,
  });
  const text = readText(generated);
  const review: any = await reviewSafetyDocumentTool.handler({
    docId: s.docId,
    draft: (s.input.draft ?? {}) as Record<string, unknown>,
    scale: (s.input.scale ?? {}) as Record<string, unknown>,
  });
  const reviewText = readText(review);
  const reviewSummary = parseReviewSummary(review);
  const phrases = containsAll(text, s.expectedPhrases);
  const sections = containsAll(text, s.necessarySections);

  const auto: AutoEvaluation = {
    id: s.id,
    title: s.title,
    roleLabel: s.roleLabel,
    docId: s.docId,
    missingRequired: countMissing(text),
    reflected: `${phrases.hit.length}/${s.expectedPhrases.length}`,
    missingExpectedPhrases: phrases.missing,
    necessarySections: `${sections.hit.length}/${s.necessarySections.length}`,
    missingNecessarySections: sections.missing,
    koshaGuideCount: Number(generated.structuredContent?.koshaGuideCount ?? 0),
    hazardCount: Number(generated.structuredContent?.hazardCount ?? 0),
    controlCount: Number(generated.structuredContent?.controlCount ?? 0),
    reviewOverall: reviewSummary.overall,
    reviewFail: reviewSummary.fail,
    reviewWarn: reviewSummary.warn,
    reviewManual: reviewSummary.manual,
    autoPass: false,
  };
  auto.autoPass =
    auto.missingRequired === 0 &&
    auto.missingExpectedPhrases.length === 0 &&
    auto.missingNecessarySections.length === 0 &&
    auto.reviewFail === 0;

  await writeFile(resolve(dir, "01-input.json"), JSON.stringify({ docId: s.docId, ...s.input }, null, 2), "utf8");
  await writeFile(resolve(dir, "02-generated.md"), text, "utf8");
  await writeFile(resolve(dir, "03-review.txt"), reviewText, "utf8");
  await writeFile(resolve(dir, "04-human-checklist.md"), renderChecklist(s, auto), "utf8");
  await writeFile(resolve(dir, "05-feedback-template.json"), renderFeedbackTemplate(s), "utf8");
  await writeFile(
    resolve(dir, "06-auto-evaluation.json"),
    JSON.stringify({ ...auto, expectedPhrases: s.expectedPhrases, necessarySections: s.necessarySections }, null, 2),
    "utf8",
  );

  return auto;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const rows: AutoEvaluation[] = [];
  for (const s of SCENARIOS) {
    rows.push(await runScenario(s));
  }
  await writeFile(resolve(OUT, "README.md"), renderIndex(rows), "utf8");
  await writeFile(resolve(OUT, "summary.json"), JSON.stringify(rows, null, 2), "utf8");

  console.log("=".repeat(90));
  console.log("현장 사용자 테스터 패킷 생성 완료");
  console.log("=".repeat(90));
  console.log(`출력: ${OUT}`);
  for (const r of rows) {
    console.log(
      `[${r.autoPass ? "PASS" : "CHECK"}] ${r.id} — ${r.roleLabel} — 입력 ${r.reflected}, 필수 ${r.missingRequired}, review fail ${r.reviewFail}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
