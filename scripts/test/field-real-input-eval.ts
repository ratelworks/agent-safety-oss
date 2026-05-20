#!/usr/bin/env tsx
/**
 * 실제 입력 반응성 평가.
 *
 * 안전관리자/현장소장이 실제 필수값을 입력했다고 가정하고
 * generate_safety_document / review_safety_document 결과를 저장·점검한다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { reviewSafetyDocumentTool } from "../../build/tools/review-safety-document.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUT = resolve(ROOT, "artifacts", "test-results", "real-input");
const DUMMY_PROFILE_PATTERNS = [
  "999-99-99999",
  "서울특별시 강남구 테헤란로 123",
  "황룡 천안",
  "황룡 도장",
];

interface Scenario {
  id: string;
  title: string;
  persona: string;
  docId: string;
  input: Record<string, unknown>;
  expectedPhrases: string[];
  necessarySections: string[];
}

const approvalChain = [
  { role: "작성자", name: "김안전", title: "안전관리자", signed: true, date: "2026-05-04" },
  { role: "관리감독자", name: "박반장", title: "토공반장", signed: true, date: "2026-05-04" },
  { role: "현장소장", name: "이소장", title: "안전보건관리책임자", signed: true, date: "2026-05-04" },
];

const emergencyContacts = {
  fire: "119",
  labor: "고용노동부 천안지청 041-560-2800",
  hospital: "단국대학교병원 권역응급센터 041-550-6840",
  owner: "이소장 010-1111-2222",
};

const SCENARIOS: Scenario[] = [
  {
    id: "S1_excavation_filled",
    title: "굴착 5m + 도시가스 인접 작업계획서",
    persona: "안전관리자가 작업 전날 작업계획서를 완성",
    docId: "work_plan_excavation",
    input: {
      useProfile: false,
      scale: { workforce: 8, constructionValue: 42, industry: "construction" },
      draft: {
        documentId: "WP-EXC-20260504-01",
        documentNumber: "WP-EXC-20260504-01",
        siteName: "천안 성정동 근린생활시설 신축공사",
        compileDate: "2026-05-04",
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
    expectedPhrases: [
      "천안 성정동 근린생활시설 신축공사",
      "도시가스관 GL-1.5m",
      "GL-5.0m",
      "양수펌프 2대",
      "가스관 1m 이내 인력굴착",
      "TBM에서 작업순서",
      "박반장",
    ],
    necessarySections: ["작업 조건", "식별된 위험 요소", "권장 안전대책", "적용 KOSHA Guide", "법령 근거", "비상연락망"],
  },
  {
    id: "S2_severe_accident_filled",
    title: "추락 중대재해 즉시보고",
    persona: "현장소장이 119 신고 직후 노동청 1차 보고 내용을 정리",
    docId: "severe_accident_immediate_report",
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
          { role: "보고자", name: "김안전", title: "안전관리자", signed: true, date: "2026-05-04" },
          { role: "현장소장", name: "이소장", title: "안전보건관리책임자", signed: true, date: "2026-05-04" },
        ],
        emergencyContacts,
      },
    },
    expectedPhrases: [
      "천안고용노동지청",
      "최작업",
      "시스템비계",
      "5.8m",
      "후크 미체결",
      "사진 18장",
      "산업재해조사표",
    ],
    necessarySections: ["보고 정보", "재해자 정보", "즉시 조치", "첨부 / 후속 보고", "법령 근거", "비상연락망"],
  },
  {
    id: "S3_msds_filled",
    title: "신너 600 MSDS 비치대장",
    persona: "안전관리자가 도장작업 전 MSDS 비치·교육 상태를 등록",
    docId: "msds_register",
    input: {
      useProfile: false,
      scale: { workforce: 12, constructionValue: 18, industry: "construction" },
      draft: {
        documentId: "MSDS-20260504-01",
        siteName: "천안 성정동 근린생활시설 신축공사 도장구간",
        registerNumber: "MSDS-2026-05",
        compileDate: "2026-05-04",
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
    expectedPhrases: [
      "신너 600",
      "톨루엔 108-88-3",
      "유기증기용 방독마스크",
      "MSDS 교육일지",
      "GHS 경고표지",
      "화기 10m",
    ],
    necessarySections: ["화학물질 목록", "MSDS 게시 / 교육", "라벨 / 경고표지", "식별된 위험 요소", "법령 근거"],
  },
  {
    id: "S4_regular_risk_assessment_filled",
    title: "정기 위험성평가",
    persona: "안전관리자가 연 1회 정기평가 결과를 현장소장 결재용으로 작성",
    docId: "regular_risk_assessment",
    input: {
      useProfile: false,
      scale: { workforce: 37, constructionValue: 42, industry: "construction" },
      draft: {
        documentId: "RRA-2026-001",
        documentNumber: "RRA-2026-001",
        siteName: "천안 성정동 근린생활시설 신축공사",
        compileDate: "2026-05-04",
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
          { role: "근로자대표", name: "정근로", title: "근로자대표", signed: true, date: "2026-05-04" },
        ],
        emergencyContacts,
      },
    },
    expectedPhrases: [
      "KRAS 5x4 matrix",
      "가스관 접촉",
      "4x5=20",
      "국소배기",
      "근로자대표 정근로",
      "2026-05-06",
    ],
    necessarySections: ["정기 위험성평가", "식별된 위험 요소", "권장 안전대책", "적용 KOSHA Guide", "법령 근거"],
  },
];

function readText(result: any): string {
  return String(result?.content?.[0]?.text ?? "");
}

function countMissing(text: string): number {
  const match = text.match(/필수 항목\s+(\d+)건 미작성/);
  return match ? Number(match[1]) : 0;
}

function containsAny(text: string, patterns: string[]): string[] {
  return patterns.filter((p) => text.includes(p));
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const rows = [];
  for (const scenario of SCENARIOS) {
    const generated: any = await generateSafetyDocumentTool.handler({
      docId: scenario.docId,
      ...scenario.input,
    });
    const text = readText(generated);
    const review: any = await reviewSafetyDocumentTool.handler({
      docId: scenario.docId,
      draft: (scenario.input.draft ?? {}) as Record<string, unknown>,
      scale: (scenario.input.scale ?? {}) as Record<string, unknown>,
    });

    await writeFile(resolve(OUT, `${scenario.id}.md`), text, "utf8");
    await writeFile(
      resolve(OUT, `${scenario.id}.meta.json`),
      JSON.stringify(generated.structuredContent ?? {}, null, 2),
      "utf8",
    );
    await writeFile(resolve(OUT, `${scenario.id}.review.txt`), readText(review), "utf8");

    const reflected = containsAny(text, scenario.expectedPhrases);
    const sections = containsAny(text, scenario.necessarySections);
    const dummyHits = containsAny(text, DUMMY_PROFILE_PATTERNS);
    rows.push({
      id: scenario.id,
      title: scenario.title,
      persona: scenario.persona,
      bytes: text.length,
      missingRequired: countMissing(text),
      reflected: `${reflected.length}/${scenario.expectedPhrases.length}`,
      missingExpectedPhrases: scenario.expectedPhrases.filter((p) => !reflected.includes(p)),
      necessarySections: `${sections.length}/${scenario.necessarySections.length}`,
      missingNecessarySections: scenario.necessarySections.filter((p) => !sections.includes(p)),
      dummyProfileHits: dummyHits,
      koshaGuideCount: generated.structuredContent?.koshaGuideCount ?? null,
      hazardCount: generated.structuredContent?.hazardCount ?? null,
      controlCount: generated.structuredContent?.controlCount ?? null,
      reviewIsError: review?.isError === true,
      reviewHead: readText(review).slice(0, 240),
    });
  }

  await writeFile(resolve(OUT, "summary.json"), JSON.stringify(rows, null, 2), "utf8");

  console.log("=".repeat(90));
  console.log("실제 입력 반응성 평가");
  console.log("=".repeat(90));
  for (const r of rows) {
    console.log(`\n[${r.id}] ${r.title}`);
    console.log(`  입력 반영: ${r.reflected} | 필수 미작성: ${r.missingRequired} | 필요 섹션: ${r.necessarySections}`);
    console.log(`  그래프: hazard ${r.hazardCount}, control ${r.controlCount}, KOSHA ${r.koshaGuideCount}`);
    console.log(`  더미 프로파일 노출: ${r.dummyProfileHits.length ? r.dummyProfileHits.join(", ") : "없음"}`);
    if (r.missingExpectedPhrases.length) console.log(`  누락 입력: ${r.missingExpectedPhrases.join(" / ")}`);
    if (r.missingNecessarySections.length) console.log(`  누락 섹션: ${r.missingNecessarySections.join(" / ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
