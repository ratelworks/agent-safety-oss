#!/usr/bin/env tsx
/**
 * quality-eval.ts
 *
 * 실제 시나리오 5종으로 generate_safety_document 호출 → 출력 본문 캡처.
 * 사용자(안전관리자/현장소장/감독관) 시각의 객관 품질 평가용.
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";

interface ToolResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
}

interface Scenario {
  id: string;
  desc: string;
  input: unknown;
}

const SCENARIOS: Scenario[] = [
  {
    id: "S1_굴착_5m_매설물",
    desc: "굴착작업 5m + 도시가스 매설관 인접 (work_plan_excavation)",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "홍길동 (건설안전기사)" },
        documentId: "WP-EX-20260428-001",
        approvalChain: [
          { role: "사업주", name: "황룡 (이사)", signed: true, date: "2026-04-28" },
          { role: "관리감독자", name: "박감독 (현장소장)", signed: true, date: "2026-04-28" },
          { role: "근로자대표", name: "이근로 (반장)", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-04-29 ~ 2026-05-15",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114 단국대병원", owner: "010-1234-5678 황룡" },
        workConditions: { depthM: 5.0, locationDetail: "도시가스 매설관 GL-1.5m 인접", workforce: 8 },
        preSurvey: {
          shape: "토사 1m + 풍화암 4m (NX 시추 결과)",
          crackWater: "함수율 12% 적정, 동결 무, 용수 미확인",
          buriedObj: "도시가스관 GL-1.5m 인접 + 한국전력 매설 통신선 GL-0.8m",
          groundwater: "GL-4.8m (강우 시 +0.3m 예상)",
        },
        plan: {
          method: "1단계 GL-2m 기계굴착 (백호 0.7m³) → 매설물 시굴 → 2단계 인력굴착",
          resources: "굴삭기 1대, 백호 1대, 작업자 6명, 신호수 1명",
          protectBuried: "도시가스공사 입회 + 시굴 후 노출관 강관 보호 + 작업중지 기준 ±30cm",
          signal: "무전기 (CH-7) + 신호수 + 호각",
          shoring: "H-Pile + 토류판 (변위 1회/일 ±10mm 초과 시 작업중지)",
          supervisor: "작업지휘자 홍길동 상주",
          other: "TBM 시작 전 5분 + 우천 시 작업중지",
        },
        workerNotification: { method: "TBM (07:00) + 작업장 게시판 + 서명부", date: "2026-04-28", evidence: "TBM 일지 첨부 (별첨 1)" },
      },
      scale: { workforce: 8, constructionValue: 5, industry: "construction" },
    },
  },
  {
    id: "S2_정전작업_LOTO",
    desc: "변전실 정전 점검 (work_permit_loto)",
    input: {
      docId: "work_permit_loto",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "이전기 (전기기사)" },
        documentId: "WP-LOTO-20260428-002",
        approvalChain: [
          { role: "사업주", name: "황룡", signed: true, date: "2026-04-28" },
          { role: "전기책임자", name: "이전기", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-04-29 09:00 ~ 16:00 (1일)",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
        raw: {
          circuit: "변전실 LV-1 차단기 (380V, 1500A)",
          shutoff: "DS-1 개로 → MCCB-1 차단 → 부하 측 단로기 차단",
          lockout: "잠금장치 LO-3 + 적색표찰 (담당: 이전기)",
          verify: "검전기 GL-150 + 잔류전압 5분 대기 후 0V 확인",
          ground: "단락접지 SG-2 (3상 모두)",
          responsible: "이전기 (전기기사 자격)",
        },
      },
      scale: { workforce: 4, constructionValue: 5, industry: "construction" },
    },
  },
  // S3 화학설비 정비 시나리오 — 비건설 도메인 (별도 OSS)
  {
    id: "S4_경영방침_CEO",
    desc: "안전보건경영방침 (safety_health_management_policy, 중처법)",
    input: {
      docId: "safety_health_management_policy",
      draft: {
        metadata: { siteName: "황룡건설(주) 본사", planDate: "2026-04-28", supervisor: "황룡 (이사)" },
        documentId: "POL-2026-001",
        approvalChain: [
          { role: "대표이사", name: "황룡", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-01-01 ~ 2026-12-31",
        emergencyContacts: { fire: "119", labor: "1350", hospital: "응급의료정보 1339", owner: "010-1234-5678" },
        raw: {
          commitment: "황룡건설은 안전·보건을 모든 경영 활동의 최우선 가치로 삼는다",
          objectives: "사망 0 / 중대재해 0 / 산재율 < 0.3% (전년 대비 50% 감축)",
          resources: "안전보건 예산 매출의 1.5% 확보 + 안전관리자 전 현장 1명 이상",
          ceoSign: "황룡 대표이사 (서명)  2026-04-28",
        },
      },
      scale: { workforce: 250, constructionValue: 500, industry: "construction" },
    },
  },
  {
    id: "S5_중대재해_즉시보고",
    desc: "추락 사망사고 즉시보고 (severe_accident_immediate_report)",
    input: {
      docId: "severe_accident_immediate_report",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "박감독 (현장소장)" },
        documentId: "SEV-20260428-001",
        workPeriod: "발생 시각: 2026-04-28 14:30",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
        raw: {
          occurrenceDate: "2026-04-28 14:30 (강우 직후)",
          injured: "김근로 (만 42세, 형틀목공, 입사 3년차) — 사망",
          circumstances: "5층 슬래브 단부 작업 중 안전난간 미설치 구간에서 추락 (높이 약 14m)",
          immediateAction: "119 즉시 신고, 작업 중지, 추락 지점 보존, 119 도착 14:35, 병원 후송 14:45 단국대병원 응급실, 사망 확인 15:10",
        },
      },
      scale: { workforce: 50, constructionValue: 80, industry: "construction" },
    },
  },
];

(async () => {
  for (const s of SCENARIOS) {
    console.log("\n");
    console.log("=".repeat(80));
    console.log(`# ${s.id} — ${s.desc}`);
    console.log("=".repeat(80));
    try {
      const r = (await generateSafetyDocumentTool.handler(s.input)) as ToolResult;
      const text = r.content?.[0]?.text ?? "";
      console.log(text);
      console.log("\n--- 메타 ---");
      console.log(JSON.stringify(r.structuredContent, null, 2));
    } catch (err) {
      console.log(`EXCEPTION: ${(err as Error).message}`);
    }
  }
})();
