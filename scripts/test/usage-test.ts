#!/usr/bin/env tsx
/**
 * usage-test.ts (실무 사용 테스트)
 *
 * 현장 실무자(50억 미만 현장 현장소장 + 안전관리자) 시각으로 10 시나리오:
 *   - 실제 입력으로 generate
 *   - 감독관 점검 체크리스트로 출력 평가
 *   - 그대로 인쇄·서명·제출 가능성 판정
 *
 * 자동 검사 + 사람 판단 권장 케이스 분리.
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";

interface ToolResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
}

interface Scenario {
  id: string;
  context: string;
  docId: string;
  input: unknown;
  // 감독관 점검 체크리스트 — 출력에 반드시 포함되어야 할 키워드/항목
  mustInclude: string[];
  // 누락하면 즉시 부적합 처리되는 항목
  blockerCheck: string[];
}

const SCENARIOS: Scenario[] = [
  // ────────────────────────────────────────────
  // S1. 굴착 5m + 도시가스 매설관 인접
  // ────────────────────────────────────────────
  {
    id: "S1_굴착_5m_매설물",
    context: "30억 규모 신축 현장 현장소장이 굴착작업 시작 전 작성. 5m 굴착 + 도시가스 매설관 GL-1.5m 인접",
    docId: "work_plan_excavation",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "홍길동 (건설안전기사)" },
        documentId: "WP-EX-20260428-001",
        approvalChain: [
          { role: "사업주", name: "황룡", signed: true, date: "2026-04-28" },
          { role: "관리감독자", name: "박감독", signed: true, date: "2026-04-28" },
          { role: "근로자대표", name: "이근로", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-04-29 ~ 2026-05-15",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114 단국대병원", owner: "010-1234-5678" },
        workConditions: { depthM: 5.0, location: "도시가스 매설관 GL-1.5m 인접", workforce: 6 },
        preSurvey: {
          shape: "토사 1m + 풍화암 4m",
          crackWater: "함수율 12% 적정",
          buriedObj: "도시가스관 GL-1.5m + 한전 통신선 GL-0.8m",
          groundwater: "GL-4.8m",
        },
        plan: {
          method: "1단계 GL-2m 기계굴착 → 매설물 시굴 → 2단계 인력굴착",
          resources: "굴삭기 1, 작업자 6, 신호수 1",
          protectBuried: "도시가스공사 입회 + 시굴 후 강관 보호",
          signal: "무전기 + 신호수",
          shoring: "H-Pile + 토류판 (변위 1회/일 ±10mm)",
          supervisor: "홍길동 상주",
          other: "TBM 시작 전 5분 + 우천 시 중지",
        },
        workerNotification: { method: "TBM + 게시판 + 서명", date: "2026-04-28", evidence: "TBM 일지" },
      },
      scale: { workforce: 8, constructionValue: 30, industry: "construction" },
    },
    mustInclude: [
      "사전조사", "작업계획", "흙막이", "매설물", "신호", "작업지휘자",
      "산업안전보건기준에 관한 규칙 §38", "비상연락망", "근로자 통지",
    ],
    blockerCheck: ["119", "지방고용노동청"],
  },

  // ────────────────────────────────────────────
  // S2. 타워크레인 설치 (별표 4 1호)
  // ────────────────────────────────────────────
  {
    id: "S2_타워크레인_설치",
    context: "초고층 신축 현장에 타워크레인 설치. 풍속 8m/s, 지지방법 §142 적용",
    docId: "work_plan_tower_crane",
    input: {
      docId: "work_plan_tower_crane",
      draft: {
        metadata: { siteName: "황룡건설 부산 해운대 타워", planDate: "2026-04-28", supervisor: "이전문 (건설기계조종사)" },
        documentId: "WP-TC-20260428-001",
        approvalChain: [
          { role: "사업주", name: "황룡", signed: true, date: "2026-04-28" },
          { role: "관리감독자", name: "타워책임자", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-05-01 ~ 2026-05-03",
        emergencyContacts: { fire: "119", labor: "051-637-0800", hospital: "051-797-3000", owner: "010-1234-5678" },
        raw: {
          windSpeed: "8m/s (10m/s 미만 정상)",
          groundCondition: "강관 파일 기초 + 콘크리트 패드 (15tonf/m²)",
          craneType: "포텐 P50A (해머 50톤급)",
          assemblyOrder: "1) 기초 점검 → 2) 마스트 4단 조립 → 3) 운전실 → 4) 지브 → 5) 지지·고정",
          tools: "기계 굴삭기 1, 신호수 2, 양중용 와이어로프 ⌀36mm",
          personnel: "조립반 5명 (조종사·신호수·작업자) + 작업지휘자 1",
          support: "벽체 지지 §142 (4면 중 2면, 30m 간격)",
        },
      },
      scale: { workforce: 50, constructionValue: 200, industry: "construction" },
    },
    mustInclude: [
      "타워크레인", "풍속", "지지방법", "작업인원",
      "산업안전보건기준에 관한 규칙 §38", "별표 4",
    ],
    blockerCheck: ["119"],
  },

  // ────────────────────────────────────────────
  // S3. 위험성평가 정기 (KRAS 체크리스트)
  // ────────────────────────────────────────────
  {
    id: "S3_정기_위험성평가",
    context: "건설업 30억 현장 안전관리자가 연 1회 정기 위험성평가. KRAS 체크리스트 방법",
    docId: "regular_risk_assessment",
    input: {
      docId: "regular_risk_assessment",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "안전관리자 김전문" },
        documentId: "RA-REG-20260428-001",
        approvalChain: [
          { role: "사업주", name: "황룡", signed: true, date: "2026-04-28" },
          { role: "안전관리자", name: "김전문", signed: true, date: "2026-04-28" },
          { role: "근로자대표", name: "이근로", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-04-28 ~ 2027-04-27 (1년)",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
        sections: {
          "사업장 정보": {
            siteName: "황룡건설 충남 천안 신축현장",
            date: "2026-04-28",
            siteInfo: "신축공사 / 30억 / 50명 / 토목·골조·마감",
          },
          "사전조사 (안전보건정보)": {
            safetyHealthInfo: "전년도 사고 0건, 작업환경측정 분진 PEL 미만, 6월 폭염 주의",
          },
          "유해·위험요인 파악": {
            hazards: "기계(굴삭기 협착) / 전기(가설 누전) / 화학(시멘트 분진) / 작업특성(고소·중량물) / 작업환경(폭염·소음)",
          },
          "위험성 결정": {
            riskLevel: "고위험 0건 / 중위험 5건 / 저위험 12건 (KRAS 매트릭스 3×3)",
            kraasMethod: "체크리스트 + 매트릭스 (KRAS construction_continuous)",
          },
          "위험성 감소대책": {
            controls: "고소작업 추락방호망 (E) + TBM 매일 (A) + 안전대 (PPE)",
            supervisor: "현장소장 (3개월 내 이행)",
          },
          "근로자 참여 (§6)": {
            participantsList: "사업주·관리감독자·안전관리자·근로자대표·반장 5명 서명",
          },
        },
      },
      scale: { workforce: 50, constructionValue: 30, industry: "construction" },
    },
    mustInclude: [
      "위험성평가", "유해·위험요인", "감소대책", "근로자 참여",
      "위험성평가 고시", "산업안전보건법 §36",
    ],
    blockerCheck: ["119"],
  },

  // ────────────────────────────────────────────
  // S4. TBM 매일 (관리감독자 주관)
  // ────────────────────────────────────────────
  {
    id: "S4_TBM_매일",
    context: "관리감독자가 작업 시작 전 5분 TBM. 굴착작업 + 신호수 배치",
    docId: "daily_tbm",
    input: {
      docId: "daily_tbm",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-29", supervisor: "박감독" },
        documentId: "TBM-20260429-001",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
        sections: {
          "TBM 기본 정보": {
            date: "2026-04-29 07:00 ~ 07:05",
            location: "현장 사무실 앞 광장",
            leader: "박감독 (관리감독자)",
          },
          "참여자": {
            participants: "굴삭기 운전자 1, 작업자 6, 신호수 1, 안전관리자 김전문",
            totalCount: "9명",
          },
          "작업 내용·위험요인 공유": {
            workToday: "5층 슬래브 굴착 (5m) + 도시가스관 시굴",
            hazardsToShare: "1) 매설물 손상 → 가스 누출 2) 흙막이 변위 → 붕괴 3) 강관 절단 시 감전",
            controlsToShare: "1) 시굴 시 도시가스공사 입회 2) 변위 ±10mm 초과 시 작업중지 3) LOTO 적용",
          },
          "보호구 + 이상 유무 점검": {
            ppeCheck: "안전모·안전화 9/9 / 안전대 4/4 (고소작업자만)",
            abnormalityCheck: "근로자 전원 건강 양호, 음주 없음 (자가 신고)",
          },
        },
      },
      scale: { workforce: 9, constructionValue: 30, industry: "construction" },
    },
    mustInclude: [
      "TBM", "관리감독자", "위험요인", "보호구", "안전교육",
      "산업안전보건법 §29", "위험성평가 고시 §15",
    ],
    blockerCheck: ["119"],
  },

  // ────────────────────────────────────────────
  // S5. 산업재해 조사표 (별지 30호서식)
  // ────────────────────────────────────────────
  {
    id: "S5_산업재해_조사표",
    context: "현장에서 추락 사망사고 발생 → 1개월 내 시행규칙 §73 별지 30호서식 작성",
    docId: "industrial_accident_report",
    input: {
      docId: "industrial_accident_report",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "박감독" },
        documentId: "AR-20260428-001",
        approvalChain: [
          { role: "사업주", name: "황룡", signed: true, date: "2026-04-28" },
          { role: "관리감독자", name: "박감독", signed: true, date: "2026-04-28" },
          { role: "근로자대표", name: "이근로", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-04-28 발생, 2026-05-28 보고기한",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
        sections: {
          "사업장 정보": {
            siteName: "황룡건설 충남 천안 신축현장",
            industry: "건설업 (종합건설업)",
            ownerName: "황룡 (이사)",
          },
          "재해자 인적사항": {
            injuredName: "김근로 (1984-03-15, 남)",
            occupation: "형틀목공 / 입사 3년 2개월",
            employmentType: "일용근로자",
          },
          "재해 발생 정보": {
            occurrenceDate: "2026-04-28 14:30",
            occurrenceLocation: "5층 슬래브 단부 (지상 14m)",
            circumstances: "안전난간 미설치 구간에서 거푸집 정리 중 추락",
            accidentType: "사망 (즉시) — 중대재해",
          },
          "조치 사항": {
            immediateAction: "119 신고 14:30, 작업중지 14:31, 후송 14:45 단국대병원, 사망확인 15:10",
            preventionPlan: "단부 안전난간 즉시 설치 + 작업발판 일체형 거푸집 + TBM 단부 점검 일상화",
          },
          "근로자대표 확인 (§73 ③)": {
            workerRepConfirm: "이근로 (근로자대표) 확인·서명 2026-04-28",
          },
        },
      },
      scale: { workforce: 50, constructionValue: 30, industry: "construction" },
    },
    mustInclude: [
      "재해자", "발생 일시", "재해 발생 경위", "조치사항", "근로자대표 확인",
      "산업안전보건법 §57", "산업안전보건법 시행규칙 §73",
    ],
    blockerCheck: ["119", "지방고용노동청"],
  },

  // ────────────────────────────────────────────
  // S6. MSDS 등록부 (황산 - CAS 7664-93-9)
  // ────────────────────────────────────────────
  {
    id: "S6_MSDS_황산",
    context: "황룡화학 울산공장에서 황산 (CAS 7664-93-9) 사용 → MSDS 등록부 작성",
    docId: "msds_register",
    input: {
      docId: "msds_register",
      draft: {
        metadata: { siteName: "황룡화학 울산공장", planDate: "2026-04-28", supervisor: "김화학 (화공기사)" },
        documentId: "MSDS-20260428-001",
        emergencyContacts: { fire: "119", labor: "052-228-3850", hospital: "052-250-7000 울산대병원", owner: "010-9999-1111" },
        sections: {
          "화학물질 정보 (16개 항목)": {
            chemicalName: "황산 (Sulfuric Acid, H2SO4)",
            casNo: "CAS 7664-93-9 / UN 1830",
            manufacturer: "한국과학약품 / 02-3000-0000",
            composition: "H2SO4 95~97% + H2O 3~5%",
            hazards: "GHS 그림문자: 부식 + 신호어: 위험 + 급성독성·피부부식·심각한 눈손상",
          },
          "취급·보관·응급": {
            firstAid: "피부 접촉 시 다량의 물 15분 이상 세척 + 의사 진료 / 흡입 시 신선한 공기로 이동 / 119",
            storage: "산성 전용 보관소 (스테인리스·테플론) + 환기 + 알칼리·유기물과 격리",
            exposureControl: "환기 (LEV 2회/시간) + 산성 방호복 + 보호장갑 + 보안경",
            fireFighting: "소화제: CO2·분말 / 물 사용 금지 (열반응) / 119 신고",
          },
          "게시·교육": {
            postedLocation: "황산 저장 탱크 #3 옆 + 작업장 입구",
            trainingDate: "2026-04-15 (전년 대비 갱신, 16명 수료)",
            warningLabel: "용기·배관 모두 GHS 라벨 부착 (적색 다이아몬드)",
          },
        },
      },
      scale: { workforce: 30, constructionValue: 5, industry: "manufacturing" },
    },
    mustInclude: [
      "화학물질명", "CAS", "유해·위험성", "응급조치", "보관·취급",
      "산업안전보건법 §110",
    ],
    blockerCheck: ["119"],
  },

  // ────────────────────────────────────────────
  // S7. 작업허가서 화기 (용접·용단)
  // ────────────────────────────────────────────
  {
    id: "S7_화기작업_허가",
    context: "철골 작업 중 용접·용단 → 화기작업 허가서 + 화재감시인 배치",
    docId: "work_permit_hot_work",
    input: {
      docId: "work_permit_hot_work",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "이용접 (용접기사)" },
        documentId: "WP-HW-20260428-001",
        approvalChain: [
          { role: "관리감독자", name: "박감독", signed: true, date: "2026-04-28" },
          { role: "용접책임자", name: "이용접", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-04-29 09:00 ~ 17:00",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
        raw: {
          workType: "Co2 용접 + 산소 용단",
          location: "5층 철골 보 (BL-5)",
          duration: "09:00 ~ 17:00 (8시간)",
          fireWatch: "화재감시인 1명 (홍길동, 통신무전기 보유)",
          extinguisher: "분말소화기 2개 (10kg) + 물통 50L 배치",
          combustibles: "반경 5m 가연물 제거 완료 + 단열재 차폐막 설치",
        },
      },
      scale: { workforce: 50, constructionValue: 30, industry: "construction" },
    },
    mustInclude: [
      "용접", "화재감시인", "소화기", "가연물",
      // §239는 KNOWN_NOT_INCLUDED이므로 본문에 "기준규칙:239" 안내 형태로 노출
      "기준규칙",
    ],
    blockerCheck: ["119"],
  },

  // ────────────────────────────────────────────
  // S8. 밀폐공간 작업허가서 (맨홀 작업)
  // ────────────────────────────────────────────
  {
    id: "S8_밀폐공간_허가",
    context: "지하 맨홀 정비 작업 → 산소·유해가스 측정 후 허가",
    docId: "work_permit_confined_space",
    input: {
      docId: "work_permit_confined_space",
      draft: {
        metadata: { siteName: "황룡건설 충남 천안 신축현장", planDate: "2026-04-28", supervisor: "정밀폐 (산업안전기사)" },
        documentId: "WP-CS-20260428-001",
        approvalChain: [
          { role: "관리감독자", name: "정밀폐", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-04-29 10:00 ~ 12:00",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
        sections: {
          "사전 확인 사항": {
            workInfo: "지하 맨홀 #3 정비 / 2시간 / 정비 + 청소",
            workers: "관리감독자 정밀폐 / 작업자 김작업·이작업 / 감시인 박감시 (외부)",
            gasMeasurement: "산소 20.8% (정상) / CO 5ppm (양호) / H2S 0.5ppm (양호) — 측정 09:50",
            gasLeakReview: "주변 가스관 부재 + 우수관 차단 → 누출 가능성 낮음",
            ppe: "안전모·안전대·호흡보호구 (전동 송풍식) + 산소 휴대용 검지기",
            emergencyComm: "무전기 (CH-3) + 외부 감시인 → 119 즉시",
          },
          "추가 운영 사항": {
            spaceLocation: "지하 1층 맨홀 #3 (BL-7)",
            ventilation: "송풍기 가동 09:30 ~ 작업 종료 (송풍량 5m³/min)",
            outsideMonitor: "박감시 외부 상시 감시 + 통신",
            rescuePlan: "구조용 안전대·삼각대·정맥 호흡기 배치",
          },
        },
      },
      scale: { workforce: 4, constructionValue: 30, industry: "construction" },
    },
    mustInclude: [
      "산소", "유해가스", "감시인", "환기",
      "산업안전보건기준에 관한 규칙 §619",
    ],
    blockerCheck: ["119"],
  },

  // ────────────────────────────────────────────
  // S9. 안전보건경영방침 (CEO, 중처법)
  // ────────────────────────────────────────────
  {
    id: "S9_경영방침_CEO",
    context: "건설사 대표이사가 연 1회 안전보건경영방침 수립 (중처법 시행령 §4)",
    docId: "safety_health_management_policy",
    input: {
      docId: "safety_health_management_policy",
      draft: {
        metadata: { siteName: "황룡건설(주) 본사", planDate: "2026-04-28", supervisor: "황룡 (이사)" },
        documentId: "POL-2026-001",
        approvalChain: [
          { role: "대표이사", name: "황룡", signed: true, date: "2026-04-28" },
        ],
        workPeriod: "2026-01-01 ~ 2026-12-31",
        emergencyContacts: { fire: "119", labor: "1350", hospital: "1339", owner: "010-1234-5678" },
        raw: {
          commitment: "황룡건설은 안전·보건을 모든 경영 활동의 최우선 가치로 삼고, 사망 0 / 중대재해 0 을 약속합니다. 근로자 의견 청취 + 사업주 책임을 명문화합니다.",
          objectives: "사망 0 / 중대재해 0 / 산재율 < 0.3% (전년 대비 50% 감축)",
          resources: "안전보건 예산 매출 1.5% 확보 + 안전관리자 전 현장 1명 이상 + 분기 1회 CEO 안전보건 점검",
          ceoSign: "황룡 대표이사 (서명)  2026-04-28",
        },
      },
      scale: { workforce: 250, constructionValue: 500, industry: "construction" },
    },
    mustInclude: [
      "안전·보건", "최우선", "구체적 목표", "예산", "인력", "CEO 서명",
      "중대재해처벌법", "안전보건경영방침",
    ],
    blockerCheck: ["119"],
  },

  // ────────────────────────────────────────────
  // S10. 산업안전보건위원회 회의록 (분기 정기)
  // ────────────────────────────────────────────
  {
    id: "S10_산보위_회의록",
    context: "100인 이상 사업장에서 분기 1회 정기 회의 (시행령 §37 ④ 4호)",
    docId: "health_safety_committee",
    input: {
      docId: "health_safety_committee",
      draft: {
        metadata: { siteName: "황룡건설(주) 본사", planDate: "2026-04-28", supervisor: "위원회 의장" },
        documentId: "HSC-Q2-2026",
        emergencyContacts: { fire: "119", labor: "1350", hospital: "1339", owner: "010-1234-5678" },
        sections: {
          "회의 정보 (§37 ④ 1호)": {
            meetingDate: "2026-04-28 14:00 ~ 16:00",
            meetingLocation: "본사 대회의실",
            meetingType: "정기 회의 (Q2 2026)",
          },
          "출석위원 (§37 ④ 2호)": {
            workerMembers: "근로자위원 5명 출석 (위원장 이근로 외 4명, 과반수 충족)",
            employerMembers: "사용자위원 5명 출석 (사업주 황룡 외 4명, 과반수 충족)",
            alternates: "안전관리자 김전문 (대리 1명)",
          },
          "심의·의결 사항 (§37 ④ 3호)": {
            agenda: "1) Q1 안전관리비 결산 / 2) 추락방지 시설 추가 예산 승인 / 3) 신규 위험성평가 보고",
            discussion: "근로자위원: 단부 안전난간 부족 지적 / 사용자위원: 즉시 5천만원 추가 승인",
            decision: "1) Q1 결산 가결 (10명 찬성) / 2) 5천만원 추가 가결 / 3) 신규 평가 승인",
          },
          "기타 (§37 ④ 4호)": {
            otherDiscussion: "전직 근로자 산재신청 진행 상황 공유",
            nextMeeting: "2026-07-28 14:00 (Q3 정기회의)",
          },
        },
      },
      scale: { workforce: 250, constructionValue: 500, industry: "construction" },
    },
    mustInclude: [
      // 실제 출력 라벨: "개최 일시"
      "개최 일시", "출석위원", "심의 내용", "의결",
      "산업안전보건법 §24", "산업안전보건법 시행령 §37",
    ],
    blockerCheck: [],
  },
];

interface ScenarioResult {
  id: string;
  context: string;
  docId: string;
  bodyLength: number;
  isError: boolean;
  mustIncludeFound: string[];
  mustIncludeMissing: string[];
  blockerMissing: string[];
  qualityScore: number;
  notes: string[];
}

(async () => {
  console.log(`# 실무 사용 테스트 — ${SCENARIOS.length} 시나리오\n`);

  const results: ScenarioResult[] = [];
  for (const s of SCENARIOS) {
    try {
      const r = (await generateSafetyDocumentTool.handler(s.input)) as ToolResult;
      const text = r.content?.[0]?.text ?? "";
      const found: string[] = [];
      const missing: string[] = [];
      for (const kw of s.mustInclude) {
        if (text.includes(kw)) found.push(kw);
        else missing.push(kw);
      }
      const blockerMissing: string[] = [];
      for (const kw of s.blockerCheck) {
        if (!text.includes(kw)) blockerMissing.push(kw);
      }
      const notes: string[] = [];
      if (text.includes("(미작성 — 필수)") || text.includes("(미작성)")) {
        notes.push("일부 필드 (미작성) 잔존 — sections에 fields 매핑 확인 필요");
      }
      let score = 10;
      score -= missing.length;
      score -= blockerMissing.length * 2;
      score = Math.max(0, score);

      results.push({
        id: s.id,
        context: s.context,
        docId: s.docId,
        bodyLength: text.length,
        isError: r.isError === true,
        mustIncludeFound: found,
        mustIncludeMissing: missing,
        blockerMissing,
        qualityScore: score,
        notes,
      });
    } catch (err) {
      results.push({
        id: s.id, context: s.context, docId: s.docId,
        bodyLength: 0, isError: true,
        mustIncludeFound: [], mustIncludeMissing: s.mustInclude,
        blockerMissing: s.blockerCheck, qualityScore: 0,
        notes: [`EXCEPTION: ${(err as Error).message}`],
      });
    }
  }

  // 결과
  for (const r of results) {
    const mark = r.qualityScore >= 9 ? "✓" : r.qualityScore >= 6 ? "△" : "✗";
    console.log(`${mark} ${r.id} [${r.qualityScore}] ${r.bodyLength}자`);
    console.log(`   ${r.context}`);
    if (r.mustIncludeMissing.length > 0) {
      console.log(`   ⚠ 누락 키워드 (${r.mustIncludeMissing.length}): ${r.mustIncludeMissing.join(", ")}`);
    }
    if (r.blockerMissing.length > 0) {
      console.log(`   ✗ Blocker 누락 (${r.blockerMissing.length}): ${r.blockerMissing.join(", ")}`);
    }
    if (r.notes.length > 0) {
      for (const n of r.notes) console.log(`   · ${n}`);
    }
    console.log("");
  }

  console.log(`# 종합`);
  const passed = results.filter((r) => r.qualityScore >= 9).length;
  const warning = results.filter((r) => r.qualityScore >= 6 && r.qualityScore < 9).length;
  const failed = results.filter((r) => r.qualityScore < 6).length;
  const avg = results.reduce((s, r) => s + r.qualityScore, 0) / results.length;
  console.log(`  ✓ 그대로 사용 가능 (≥9): ${passed} / ${results.length}`);
  console.log(`  △ 보완 후 사용 (6~8): ${warning}`);
  console.log(`  ✗ 사용 불가 (<6): ${failed}`);
  console.log(`  평균: ${avg.toFixed(2)} / 10`);
})();
