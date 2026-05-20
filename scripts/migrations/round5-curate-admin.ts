#!/usr/bin/env tsx
/**
 * Round 5: S7·S8·S9 직접 큐레이션 + S4·S6 일부 보강
 * 산안법 본문 기반 정확한 inputGuide·standardFormat·examples·checkPoints 작성.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "..", "src/ontology/graph/nodes/documents");

const PATCHES: Record<string, Record<string, any>> = {
  // ── S7: 산업보건의 선임 (산안법 §22 + 시행령 §29) ──
  "industrial-physician-appointment": {
    appointmentDate: {
      inputGuide: "산업보건의 선임·교체·해임 일자. 50인 이상 사업장 + 14일 이내 신고 의무 (시행규칙 §13).",
      standardFormat: "YYYY-MM-DD (선임 일자) / 신고 [지방고용노동청] [N]일 후",
      examples: ["2026-04-28 (선임) / 천안고용노동지청 신고 2026-05-09", "2026-04-28 (교체 — 전임 김의사 해임 동시)"],
      checkPoints: ["50인 이상 사업장 의무", "14일 내 지방청 신고 (시행규칙 §13)", "선임 자격 (의사 면허)"],
    },
    siteName: {
      inputGuide: "사업장명·소재지. 도급 사업장은 도급 정보. 50인 이상 상시 근로자 보유 사업장에만 적용.",
      standardFormat: "[상호] (사업자 [N-N-N]) / 소재지 [도로명주소]",
      examples: ["황룡건설(주) 본사 (사업자 123-45-67890) / 서울시 강남구 ...", "황룡건설 천안 신축현장 / 충남 천안시 ..."],
      checkPoints: ["50인 이상 상시 근로자", "건설업 신축현장은 단일 공사 포함"],
    },
    workforce: {
      inputGuide: "상시 근로자 수 (산안법 시행령 §29 50인 이상 의무 기준). 도급은 원·하도급 합산.",
      standardFormat: "총 [N]명 (정규 [N] + 도급 [N] + 일용 [N])",
      examples: ["총 75명 (정규 30 + 도급 35 + 일용 10) → 보건의 선임 의무", "총 45명 → 의무 미적용 (50인 미만)"],
      checkPoints: ["50인 이상 의무", "도급·파견·일용 합산", "월별 평균 산정"],
    },
    name: {
      inputGuide: "산업보건의 성명·생년월일. 의사 면허 보유자 (산안법 §22 ② + 시행령 §29 ②).",
      standardFormat: "[성명] (생년월일 YYYY-MM-DD)",
      examples: ["김보건 (1980-05-15)", "이의사 (1975-09-23)"],
      checkPoints: ["의사 면허 사본 첨부", "전공의는 별도"],
    },
    license: {
      inputGuide: "의사 면허 번호 + 면허 발급기관 (보건복지부) + 산업의학·예방의학·직업환경의학 전문의 권장.",
      standardFormat: "[면허번호] (보건복지부 발급 YYYY-MM-DD) / 전문 [분야]",
      examples: ["면허 12345 (보건복지부 2010-03-15) / 직업환경의학 전문의 (대한의학회 2015)", "면허 67890 / 일반의 + 산업보건 6시간 교육 이수"],
      checkPoints: ["보건복지부 면허 확인", "산업의학·예방의학·직업환경의학 전문의 권장", "산업보건 보수교육 이수 (KOSHA 2년 1회)"],
    },
    specialty: {
      inputGuide: "의사 전공·산업의학 경력. 전문의 자격은 직업환경의학·산업의학·예방의학 우선.",
      standardFormat: "전공 [분야] / 경력 [N]년 / 산업보건 활동 [N]년",
      examples: ["직업환경의학 전문의 / 임상 8년 / 산업보건 5년 (KOSHA 등록)", "내과 전문의 + 산업보건 보수교육 / 임상 10년 / 산업보건 2년"],
      checkPoints: ["전문의 자격 우선", "산업보건 활동 경력", "KOSHA 등록 산업보건의 권장"],
    },
    schedule: {
      inputGuide: "산업보건의 근무일·근무시간. 50~299인 월 1회 이상·300인↑ 월 2회 이상 권장 (산안법 시행규칙 §17 ②).",
      standardFormat: "[주기] [N]회 / [요일·시간] / 위촉 형태 [전임/위촉]",
      examples: ["월 2회 (둘째·넷째 화요일 14:00~17:00) / 위촉 (외부 계약)", "월 1회 (마지막 금요일 종일) / 위촉"],
      checkPoints: ["50~299인 월 1회 이상", "300인↑ 월 2회 이상", "건강진단 결과 검토 + 작업환경 자문 의무"],
    },
    contractor: {
      inputGuide: "외부 위탁 시 수탁 의료기관명·주소·대표자. 산업보건의 위촉계약서 첨부.",
      standardFormat: "[기관명] / [주소] / 계약 산업보건의 [성명] / 대표 [성명]",
      examples: ["충남대병원 산업보건의학센터 / 천안 ... / 김보건 (직업환경의학 전문의) / 대표 이병원", "(전임 산업보건의 — 외부 위탁 없음)"],
      checkPoints: ["KOSHA 등록 의료기관 권장", "위촉계약서 5년 보존"],
    },
    contractTerm: {
      inputGuide: "외부 위탁 계약 기간·갱신 조건. 통상 1년 단위 갱신.",
      standardFormat: "[시작]~[종료] / 갱신 [자동/협의]",
      examples: ["2026-05-01 ~ 2027-04-30 (1년) / 자동갱신 1회 후 협의", "2026-05-01 ~ 2026-12-31 (잔여기간)"],
      checkPoints: ["연 1회 갱신", "산업보건의 변경 시 즉시 재신고"],
    },
  },

  // ── S8: 안전인증 신청서 (산안법 §80·§83 + 시행령 §74·시행규칙 §74) ──
  "safety-certification-application": {
    applicantName: {
      inputGuide: "안전인증 대상 기계·기구·설비의 제조·수입자. 회사명·대표자·소재지·대표 연락처.",
      standardFormat: "[회사명] / 대표 [성명] / 소재지 [주소] / 대표 [전화]",
      examples: ["㈜한국크레인 / 대표 김제조 / 경기 화성시 ... / 031-XXX-XXXX", "BASF Korea (수입사) / 대표 이수입 / 서울 ... / 02-XXX-XXXX"],
      checkPoints: ["국세청 사업자 등록 일치", "건설기계는 건설기계관리법 등록사", "제조·수입 면허 확인"],
    },
    businessNo: {
      inputGuide: "사업자등록번호 (10자리). 법인등록번호 별도 기재.",
      standardFormat: "사업자 [N-N-N] / 법인 [N-N]",
      examples: ["사업자 123-45-67890 / 법인 110111-1234567"],
      checkPoints: ["국세청 정보 일치", "법인은 등기부 등본 첨부"],
    },
    representative: {
      inputGuide: "대표자 성명·대표권 명시. 신청서에 대표자 직인·서명 의무.",
      standardFormat: "[성명] (대표이사 / 대표 / 사주)",
      examples: ["김제조 (대표이사)", "이수입 (한국지사장 — 본사 위임장 별첨)"],
      checkPoints: ["대표권 등기 확인", "위임 시 위임장 첨부"],
    },
    contact: {
      inputGuide: "신청서 담당자 연락처 + 24시간 응급 연락 (사고 시 회수·조치).",
      standardFormat: "담당 [성명·직위] [전화] / 응급 [번호]",
      examples: ["품질관리부 이품질 (031-XXX-XXXX) / 24h 응급 1588-XXXX"],
      checkPoints: ["담당자 변경 시 즉시 재신고"],
    },
    productCategory: {
      inputGuide: "안전인증 대상 13종 분류 (산안법 시행령 §74 별표 21). 프레스·전단기·크레인·리프트·압력용기·롤러기·사출성형기·고소작업대·곤돌라·기계톱·아크용접기·파쇄기·산업용로봇.",
      standardFormat: "[N]호: [품목명]",
      examples: ["3호: 크레인 (정격하중 0.5톤 이상 양중기)", "8호: 고소작업대 (작업대 높이 2m 초과)"],
      checkPoints: ["시행령 별표 21 정확 매칭", "정격하중·용량 기준 충족", "방호장치 의무 (시행령 §74 ②)"],
    },
    productName: {
      inputGuide: "제품명·모델·규격. 카탈로그·사양서와 일치 의무.",
      standardFormat: "[제품명] / 모델 [번호] / 규격 [정격]",
      examples: ["타워크레인 / KCT-50 / 정격 5톤·작업반경 30m·자립고 60m", "고소작업대 / HSP-15 / 작업대 폭 1.5m·높이 15m·전동식"],
      checkPoints: ["사양서·도면 첨부", "제품번호 추적", "카탈로그 일치"],
    },
    specifications: {
      inputGuide: "정격하중·작업반경·동력·전압 등 기술사양. 안전인증 시험 기준값.",
      standardFormat: "정격 [N]톤 / 작업반경 [m] / 전원 [V] / 동력 [kW]",
      examples: ["정격 5톤·작업반경 30m·전원 380V·동력 22kW·풍속 한계 15m/s", "정격 1.0톤·승강 5m·동력 5.5kW·전기식"],
      checkPoints: ["KCs 시험 기준 충족", "사양 변경 시 재인증"],
    },
    safetyDevice: {
      inputGuide: "방호장치·안전장치 (시행령 §74 ②). 과부하방지·권과방지·인터락·비상정지 등 종류·작동방식.",
      standardFormat: "[장치명]: [작동조건] / [시험기준]",
      examples: ["과부하방지장치: 105% 부하 자동정지·경보 / KCs M-XX-2020 시험", "권과방지·충돌방지·비상정지 + 풍속경보 (15m/s)"],
      checkPoints: ["시행령 §74 ② 의무 방호장치 모두 부착", "시험 성적서 첨부"],
    },
    applicationDate: {
      inputGuide: "안전인증 신청 일자. 한국산업안전보건공단(KOSHA) 인증센터에 접수.",
      standardFormat: "신청일 YYYY-MM-DD / 접수번호 [N]",
      examples: ["2026-04-28 / KOSHA 접수 2026-XXX-XXXXX"],
      checkPoints: ["KOSHA 안전인증센터 접수", "사양 변경 시 재신청"],
    },
    result: {
      inputGuide: "안전인증 심사 결과 (적합·부적합·조건부). 부적합 시 사유·재신청.",
      standardFormat: "[적합/부적합/조건부] / [세부]",
      examples: ["적합 (시험 모두 통과)", "조건부 (추가 시험 필요 — 풍속경보 시험)"],
      checkPoints: ["적합 시 KCs 마크 부착 권한", "부적합 시 재신청 절차"],
    },
    kcsNumber: {
      inputGuide: "KCs 안전인증 번호 (KCs 18-XX-NNNNN 형식). 인증서 발급 후 제품·포장에 부착 의무.",
      standardFormat: "KCs [발급년도]-[품목코드]-[일련번호]",
      examples: ["KCs 18-AA-12345 (타워크레인)", "KCs 24-AB-67890 (고소작업대)"],
      checkPoints: ["제품·포장 KCs 마크 부착 의무", "사양 변경 시 신규 번호"],
    },
    validUntil: {
      inputGuide: "인증 유효기간. 갱신·재시험 의무. 통상 5년 단위.",
      standardFormat: "[발급일]~[만료일] / 갱신 [N]년 단위",
      examples: ["2026-05-15 ~ 2031-05-14 / 5년 갱신 (재시험 의무)"],
      checkPoints: ["만료 6개월 전 갱신 신청", "사양 변경 시 즉시 재인증"],
    },
  },

  // ── S9: 도급 안전보건협의체 회의록 (산안법 §75·§64 + 시행령 §63) ──
  "contractor-safety-council": {
    meetingDate: {
      inputGuide: "협의체 회의 일자·시간. 정기 회의 월 1회 이상 의무 (시행령 §63 ④). 임시 회의 산재 발생 후 등.",
      standardFormat: "YYYY-MM-DD HH:MM ~ HH:MM / 회의 종류 [정기/임시]",
      examples: ["2026-04-28 14:00~16:00 / 정기 (4월 정기회의)", "2026-04-29 09:00~11:00 / 임시 (사망사고 발생 후)"],
      checkPoints: ["월 1회 이상 정기 의무 (시행령 §63 ④)", "임시 회의 산재 발생 시 즉시", "회의록 5년 보존"],
    },
    siteName: {
      inputGuide: "도급 사업장명·도급 규모 (도급 인원·하도급사 수). 산안법 §75 도급 대상 (건설업 의무).",
      standardFormat: "[사업장] / 도급 인원 [N]명 / 하도급 [N]사",
      examples: ["황룡건설 천안 신축현장 / 도급 인원 80명 / 하도급 5사 (철근·전기·설비·도장·해체)"],
      checkPoints: ["산안법 §75 도급 의무 사업장 (건설업 100인↑)", "도급 신고 (산안법 §63)"],
    },
    agenda: {
      inputGuide: "회의 의제 (5W1H). 안전보건 이슈·재해 사례·다음달 위험요인·예방대책 등.",
      standardFormat: "1. [의제] / 2. [의제] / 3. [의제]",
      examples: ["1. 4월 재해통계 보고 / 2. 5월 굴착·골조 위험요인 / 3. 안전관리비 사용 검토 / 4. 합동순회점검 결과 / 5. 다음 회의", "1. 사망사고 발생 경위 / 2. 직접·간접 원인 / 3. 재발방지대책 / 4. 책임 소재"],
      checkPoints: ["사전 의제 배포 (3일 전)", "근로자 의견 반영", "회의록 5년 보존"],
    },
    primary: {
      inputGuide: "원도급 대표·관리감독자·안전관리자 모두 참석. 산안법 §75 ② 의무.",
      standardFormat: "[대표 또는 위임자] / 관리감독자 [N]명 / 안전관리자 [N]명",
      examples: ["황룡건설 박감독 (현장소장) + 김안전 (안전관리자) + 이보건 (보건관리자) + 박재해 (관리감독자)"],
      checkPoints: ["산안법 §75 ② 원도급 참여 의무", "안전보건책임자 동석"],
    },
    subContractors: {
      inputGuide: "하도급사별 안전보건책임자·관리감독자 모두 참석. 산안법 §75 ② 의무.",
      standardFormat: "[사명] [안전책임자] [관리감독자]",
      examples: ["㈜OO철근 (이철근 안전책임자 + 박반장 관리감독자) / ㈜XX전기 (김전기 + 이반장) / ㈜YY설비 (박설비 + 이반장)"],
      checkPoints: ["하도급사 모두 참여 의무", "불참 시 사유서 + 다음 회의 보완"],
    },
    totalParticipants: {
      inputGuide: "총 참석 인원·근로자 대표 동수 참여 의무 (산안법 §75 ① + 시행령 §63 ②).",
      standardFormat: "총 [N]명 (사용자 [N] + 근로자 대표 [N] + 안전책임자 [N])",
      examples: ["총 16명 (사용자 4 + 근로자 대표 4 + 안전책임자 5 + 안전관리자 3)"],
      checkPoints: ["근로자 대표 동수 참여", "참석부 5년 보존"],
    },
    discussions: {
      inputGuide: "협의 안건별 내용 요약. 발언자·주요 의견·이견 분리. 객관적 사실 기록.",
      standardFormat: "[의제]: [발언자] [의견] / 이견 [있음/없음]",
      examples: ["1. 4월 재해통계: 황룡건설 김안전 보고 — 경상 2건 (5층 단부 추락 미수, 분전반 잠금 누락). 이견 없음.", "2. 5월 굴착 위험: 박감독 — 도시가스 매설관 인접 → 입회 의무 + 시굴. 근로자 대표 이근로 — 신호수 1명 추가 요청. 합의."],
      checkPoints: ["객관적 사실 기록", "발언자 명시", "이견 별도 기록"],
    },
    decisions: {
      inputGuide: "회의 결정사항·이행 계획·담당자·기한. 차기 회의에서 이행 점검.",
      standardFormat: "[결정사항] / 담당 [성명] / 기한 [일자] / 이행 [점검자]",
      examples: ["신호수 1명 추가 / 박감독·이근로 협의 / 2026-05-01부터 / 다음 회의 점검", "안전관리비 5월 5,000,000원 추가 / 김안전 / 2026-05-15 / 이재무"],
      checkPoints: ["담당자·기한 명시", "차기 회의 이행 점검", "미이행 시 사유서"],
    },
    nextMeeting: {
      inputGuide: "다음 회의 일자. 산안법 §75 + 시행령 §63 ④ 월 1회 의무. 임시 회의는 사고 후 즉시.",
      standardFormat: "YYYY-MM-DD HH:MM (정기 [N]차)",
      examples: ["2026-05-26 14:00 (5월 정기, 통상 매월 마지막 화요일)"],
      checkPoints: ["월 1회 정기 의무", "근로자 대표 사전 통보 (3일 전)"],
    },
    jointInspection: {
      inputGuide: "산안법 §64 ① 1호 합동 순회점검 결과·시정조치. 분기 1회 의무.",
      standardFormat: "점검일 [일자] / 점검 구역 [N] / 발견 [N]건 / 시정 [N]건",
      examples: ["2026-04-25 분기 합동점검 / 1·2·3공구 / 결함 5건 발견 (안전난간 2·분전반 1·소화기 압력 2) / 모두 즉시 시정 완료"],
      checkPoints: ["산안법 §64 ① 1호 분기 1회 의무", "원·하도급 합동", "결과 5년 보존"],
    },
  },

  // ── S6: 정기 위험성평가서 일부 fields 보강 ──
  "regular-risk-assessment": {
    // (이미 직접 큐레이션된 fields는 건너뛰고 부족한 것만)
  },
};

async function main() {
  let totalDocsUpdated = 0, totalFieldsUpdated = 0;
  for (const [docKey, fieldPatches] of Object.entries(PATCHES)) {
    const path = resolve(DOCS, `${docKey}.jsonld`);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      let fieldUpdated = 0;
      for (const sec of node.sections ?? []) {
        for (const f of sec.fields ?? []) {
          const patch = fieldPatches[f.key];
          if (!patch) continue;
          Object.assign(f, patch);
          fieldUpdated += 1;
        }
      }
      if (fieldUpdated > 0) {
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
        console.log(`  ✓ ${docKey}: ${fieldUpdated}개 field 직접 큐레이션`);
        totalDocsUpdated += 1;
        totalFieldsUpdated += fieldUpdated;
      }
    } catch (err) {
      console.warn(`  ✗ ${docKey}: ${(err as Error).message}`);
    }
  }
  console.log(`\n[done] ${totalDocsUpdated} doc / ${totalFieldsUpdated} fields 보강`);
}

main().catch(console.error);
