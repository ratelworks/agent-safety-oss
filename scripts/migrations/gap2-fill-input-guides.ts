#!/usr/bin/env tsx
/**
 * GAP-2: 23개 미작성 inputGuide 일괄 보강 → 100% 커버리지
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "..", "src/ontology/graph/nodes/documents");

// key → 가이드 정의 (의무문서 모든 필드의 표준)
const GUIDES: Record<string, { inputGuide: string; standardFormat: string; examples: string[]; checkPoints: string[] }> = {
  businessStartDate: {
    inputGuide: "사업장 또는 공사 개시일을 YYYY-MM-DD 형식으로 기재. 신축·증축의 경우 착공 신고일 기준.",
    standardFormat: "YYYY-MM-DD",
    examples: ["2026-04-29", "2026-03-01"],
    checkPoints: ["착공계 또는 사업자등록증 일자와 일치", "안전관리자 선임 시점과 정합"],
  },
  other: {
    inputGuide: "위 항목에 해당하지 않는 기타 사항을 기재. 자유 서술이나 핵심 사실만 간결히.",
    standardFormat: "[항목명]: [내용] (필요 시 근거)",
    examples: ["기타 특이사항: 인접 학교 통학로 — 등하교 시간 작업 중지"],
    checkPoints: ["사실 기반 서술", "근거 자료 첨부 명시"],
  },
  trigger_facility: {
    inputGuide: "시설물(건축물·구조물)의 신축·증축·개축·이전 등 위험성평가 트리거 사유 명시.",
    standardFormat: "[시설 종류] [공사 단계] — 평가 대상 부위",
    examples: ["RC 슬래브 타설 — 거푸집·동바리 시공 구간"],
    checkPoints: ["산안법 §36 ④ 1호 (시설 변경) 부합", "변경 전·후 위험요소 비교"],
  },
  trigger_machinery: {
    inputGuide: "기계·기구·설비 신규 도입·개조·이전 시 트리거 사유. 모델·제조사·용도 명시.",
    standardFormat: "[기계명] ([제조사] [모델]) — [도입/개조/이전] 사유",
    examples: ["타워크레인 (만도 MC-180) 신규 설치 — 12층 신축 양중"],
    checkPoints: ["산안법 §36 ④ 2호 (기계 변경)", "안전인증·안전검사 일자 일치"],
  },
  trigger_maintenance: {
    inputGuide: "유지·보수·수리 작업 시 위험성평가 트리거. 작업 유형·기간·인원 명시.",
    standardFormat: "[설비명] [정비 종류] — 기간 [N일], 인원 [N명]",
    examples: ["크레인 와이어로프 교체 — 3일, 정비공 4명"],
    checkPoints: ["LOTO 절차 적용 여부", "비정형 작업 추가 위험 식별"],
  },
  trigger_method: {
    inputGuide: "작업 방법·공법 변경 시 트리거. 기존 vs 신규 공법 차이 명시.",
    standardFormat: "[기존 공법] → [신규 공법] (변경 사유)",
    examples: ["인력 양중 → 갠트리크레인 양중 (생산성 향상)"],
    checkPoints: ["산안법 §36 ④ 3호 (작업 방법 변경)", "신규 위험요소 분석"],
  },
  trigger_accident: {
    inputGuide: "재해(중대재해·아차사고 포함) 발생 후 재발방지 위한 위험성평가. 사고 일시·유형 기재.",
    standardFormat: "[발생일] [사고유형] [상해 정도] — [장소·공정]",
    examples: ["2026-04-15 추락 (중상 1명) — 비계 작업발판 미고정"],
    checkPoints: ["산안법 §36 ④ 4호 (재해 발생)", "유사 작업 전체 재평가 범위"],
  },
  trigger_other: {
    inputGuide: "위 4가지 외 기타 트리거 사유. 법령 변경·민원·자체 점검 결과 등.",
    standardFormat: "[사유 종류]: [구체 내용]",
    examples: ["근로자 위험 신고 (안전보건위원회 §4 회의록)"],
    checkPoints: ["트리거 근거 자료 첨부", "수시 위험성평가 절차 준수"],
  },
  replaceDate: {
    inputGuide: "교체·갱신 예정일 (보호구 사용기한, 자격 갱신, 검사 만료 등). YYYY-MM-DD.",
    standardFormat: "YYYY-MM-DD",
    examples: ["2027-04-29 (1년 후)"],
    checkPoints: ["제조사 권장 사용기한 또는 법정 주기", "갱신 30일 전 알림 등록"],
  },
  explosives: {
    inputGuide: "발파 작업 시 사용 화약류 종류·수량·관리책임자. 화약류관리법 적용.",
    standardFormat: "[화약 종류] [수량] kg — 관리: [성명]/[자격번호]",
    examples: ["에멀젼 폭약 25kg + 전기뇌관 50발 — 화약취급 김OO/제2024-XXX호"],
    checkPoints: ["화약류 사용허가증", "발파작업자 국가기술자격 (산업기사 이상)"],
  },
  newAppointmentEducation: {
    inputGuide: "신규 채용 시 안전보건교육 실시 여부·시간·일자. 산안기준규칙 §26 ①.",
    standardFormat: "실시 [Y/N] — 시간 [N]시간, 일자 YYYY-MM-DD",
    examples: ["실시 Y — 8시간, 2026-04-15 (사무직 4시간 + 현장 4시간)"],
    checkPoints: ["사무직 4시간 / 현장직 8시간 이상", "교육일지 및 서명부 비치 3년"],
  },
  changeEducation: {
    inputGuide: "작업내용 변경 시 추가 교육. 산안기준규칙 §26 ②.",
    standardFormat: "변경 사유 [내용] — 교육 [N]시간, 일자 YYYY-MM-DD",
    examples: ["타워크레인 신호수로 변경 — 2시간, 2026-04-20"],
    checkPoints: ["변경 즉시 시행", "특별 안전교육 별도"],
  },
  ventilation: {
    inputGuide: "환기 설비 종류·풍량·작동 확인. 밀폐공간·화학물질 작업 필수.",
    standardFormat: "[설비종류] [풍량 m³/min] — 작동확인 [Y/N]/[측정자]",
    examples: ["국소배기 송풍기 30m³/min — 작동확인 Y/안전관리자 김OO"],
    checkPoints: ["산안기준규칙 §72 (밀폐공간)", "작업 전·중 30분마다 측정"],
  },
  alternates: {
    inputGuide: "회의 대리 출석자 명단·소속·서명. 본 위원이 부득이 불참 시.",
    standardFormat: "[원위원] 대리 [성명/소속/직책] (서명/일자)",
    examples: ["근로자위원 김철수 대리 박영희(전기팀/반장)"],
    checkPoints: ["대리 출석 사전 통보", "의결권 행사 자격 확인"],
  },
  otherDiscussion: {
    inputGuide: "안건 외 자유 토론 사항. 다음 회의 사전 검토용으로 기록.",
    standardFormat: "[토픽]: [의견 요지] — 발의자 [성명]",
    examples: ["하절기 폭염 대응: 작업 시간 조정 검토 — 김반장"],
    checkPoints: ["다음 회의 안건으로 등록", "결정 사항 vs 토론 사항 구분"],
  },
  nextMeeting: {
    inputGuide: "다음 정기·임시 회의 일정. 산업안전보건위원회 분기 정기 + 수시.",
    standardFormat: "YYYY-MM-DD HH:MM — 장소 [회의실], 안건 [예정 토픽]",
    examples: ["2026-07-29 14:00 — 본관 3F 회의실, 안건: 하절기 안전대책"],
    checkPoints: ["분기 1회 이상 (산안법 §24)", "회의 7일 전 사전 통보"],
  },
  developerName: {
    inputGuide: "발주자 또는 시행자 명칭. 법인명·대표자 명시. 도급계약서와 일치.",
    standardFormat: "[법인명] (대표자: [성명], 사업자번호: [10자리])",
    examples: ["㈜한국개발 (대표자: 홍길동, 사업자번호: 123-45-67890)"],
    checkPoints: ["사업자등록증 또는 법인등기부와 일치", "공사도급계약서 갑(발주자) 동일"],
  },
  wageType: {
    inputGuide: "근로자 임금 형태 (월급제·일급제·시급제·도급). 산재보상보험 적용 형태와 정합.",
    standardFormat: "[월급/일급/시급/도급] — 임금 [금액]원",
    examples: ["일급제 — 250,000원"],
    checkPoints: ["근로계약서와 일치", "산재 신고 시 평균임금 산정 기준"],
  },
  workerRepDissent: {
    inputGuide: "근로자대표 반대 의견. 의결 안건에 대해 근로자 측 우려 사항 기록.",
    standardFormat: "[안건명]: [반대 사유] — 대표 [성명] 서명",
    examples: ["휴게시간 변경 안건: 옥외 근로자 휴게 부족 우려 — 김근로 (서명)"],
    checkPoints: ["반대 의견 회의록 명문 기록 (산안법 §25 ②)", "사용자 측 답변 다음 회의에 반영"],
  },
  workProhibition: {
    inputGuide: "작업 중지·금지 조치 내용. 안전·보건상 필요 시 즉시 발효.",
    standardFormat: "[중지 일시] [중지 사유] — 발령자 [성명/직책]",
    examples: ["2026-04-29 14:30 강풍 12m/s — 안전관리자 김OO"],
    checkPoints: ["산안법 §51 (사업주 작업중지) 또는 §52 (근로자 작업중지권)", "재개 조건 명시"],
  },
};

async function main() {
  let updated = 0, filled = 0;
  for (const f of await readdir(DOCS)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOCS, f);
    const node = JSON.parse(await readFile(path, "utf-8"));
    let dirty = false;
    for (const sec of node.sections ?? []) {
      for (const fld of sec.fields ?? []) {
        if (fld.inputGuide) continue;
        const guide = GUIDES[fld.key];
        if (guide) {
          fld.inputGuide = guide.inputGuide;
          fld.standardFormat = guide.standardFormat;
          fld.examples = guide.examples;
          fld.checkPoints = guide.checkPoints;
          filled++;
          dirty = true;
        }
      }
    }
    if (dirty) {
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      updated++;
    }
  }
  console.log(`[done] ${updated}개 doc / ${filled} 필드 inputGuide 추가`);
}

main().catch((e) => { console.error(e); process.exit(1); });
