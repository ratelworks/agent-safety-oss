#!/usr/bin/env tsx
/**
 * Round 7: 위험성평가 5종 직접 큐레이션 (KRAS 표준 + 위험성평가 고시 2024-76)
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "..", "src/ontology/graph/nodes/documents");

// 공통 fields (regular/initial/monthly/ad_hoc 4종 공유)
const COMMON: Record<string, any> = {
  siteName: {
    inputGuide: "사업장명·소재지. 도급은 원·하도급 모두. 50인 미만은 자율, 50인↑ 의무.",
    standardFormat: "[상호] (사업자 [N-N-N]) / 소재지 [도로명주소] / 공종 [건축/토목]",
    examples: [
      "황룡건설(주) 천안 신축현장 (사업자 123-45-67890) / 충남 천안시 ... / 토목·건축",
      "원도급 황룡건설 + 하도급 ㈜OO철근·㈜XX전기·㈜YY설비",
    ],
    checkPoints: ["산안법 §36 의무 (모든 사업장)", "위험성평가 고시 §3 (50인 미만은 간이 평가 가능)"],
  },
  date: {
    inputGuide: "평가 실시일. 정기는 1년 단위·수시는 변경 시·상시는 매월·최초는 사업 개시 후 1개월 내.",
    standardFormat: "YYYY-MM-DD / 평가 종류 [정기/수시/상시/최초]",
    examples: ["2026-04-28 / 정기 (전년 대비 1년)", "2026-04-28 / 수시 (신규 장비 도입 — 굴삭기 추가)"],
    checkPoints: ["위험성평가 고시 §6 주기", "정기 1년·수시 변경 시·상시 매월·최초 1개월 내"],
  },
  siteInfo: {
    inputGuide: "공종·규모·인력 개요. 작업 단위·공정·근로자 분포·핵심 장비.",
    standardFormat: "공종 [건축·토목·전기 등] / 규모 [공사금액·연면적] / 인력 [총 N명 · 작업별]",
    examples: [
      "건축 (RC조 지하3·지상15층, 연면적 25,000m²). 공사금액 500억. 인력 80명 (정규 30·도급 50). 핵심 장비: 타워크레인 1·굴삭기 2.",
      "토목 (도로 5km). 공사금액 100억. 인력 35명. 장비: 도로롤러·아스팔트 피니셔.",
    ],
    checkPoints: ["50억 이상은 안전보건대장·산업안전보건관리비 의무", "100인 이상은 안전관리자 선임 의무"],
  },
  safetyHealthInfo: {
    inputGuide: "안전보건정보 사전조사. KOSHA 사고통계·기상·작업환경·전년 사고이력. 사전 자료 수집 단계 (위험성평가 고시 §10).",
    standardFormat: "사고이력 [N건]·작업환경 [평가] / 기상 [예보]·매설물 [현황]",
    examples: [
      "전년 경상 3건 (낙하 1·미끄러짐 2). 작업환경측정 분진 2.1 mg/m³ (기준 5.0). 4월 기상 평균. 매설물: 도시가스 인접.",
      "사고이력 무 (3년 연속). 작업환경 양호. 기상: 5월 강우주의보. 신규 화학물질 없음.",
    ],
    checkPoints: ["KOSHA SIF·산재통계 조회", "작업환경측정 결과", "사전 자료 5년 보존"],
  },
  hazards: {
    inputGuide: "위험성평가 고시 §10 6범주 전수 파악 (기계·전기·화학·생물·작업특성·작업환경). 각 범주별 위험요인 식별.",
    standardFormat: "1.기계: [N개]·2.전기: [N개]·3.화학: [N개]·4.생물: [N개]·5.작업특성: [N개]·6.환경: [N개]",
    examples: [
      "1.기계(8): 굴삭기·타워크레인 끼임·낙하 등. 2.전기(3): 가설전기 감전. 3.화학(2): 도료 노출. 4.생물(0). 5.작업특성(5): 추락·낙하·매몰. 6.환경(2): 분진·소음. 총 20개.",
      "1.기계(2): 강관비계 붕괴. 2.전기(1): 누전. 5.작업특성(3): 추락·미끄러짐. 6.환경(1): 분진. 총 7개.",
    ],
    checkPoints: ["고시 §10 6범주 빠짐없이", "근로자 의견 청취 의무 (§9)", "과거 사고·KOSHA SIF 활용"],
  },
  riskLevel: {
    inputGuide: "위험성 결정. KRAS 방법별 빈도·강도 평가 후 등급 (상·중·하 또는 1~20 점수).",
    standardFormat: "[위험요인]: [빈도] × [강도] = [등급]",
    examples: [
      "추락 위험: B (자주) × II (중대) = 8점 = 중위험. 매몰: C × I = 12점 = 고위험.",
      "감전: D (드물게) × II = 6점 = 저위험. 미끄러짐: A (상시) × IV (미미) = 4점 = 저위험.",
    ],
    checkPoints: ["KRAS 빈도·강도 매트릭스 (5×4)", "위험성평가 고시 §11", "근로자 합의 등급"],
  },
  kraasMethod: {
    inputGuide: "선택한 KRAS 7방법 중 하나. 작업·규모에 적합한 방법.",
    standardFormat: "[방법명] / 선택 사유 [규모·도메인]",
    examples: [
      "건설업 4주기 평가 (construction_continuous) / 건설업 의무 적용",
      "빈도·강도법 (frequency_severity) / 중규모 건설업 정량 평가",
      "체크리스트법 (checklist) / 점검표 기반 반복 작업",
    ],
    checkPoints: ["KOSHA KRAS 7방법 (3step·checklist·key_factor·frequency_severity·occupational_health·chemical·construction_continuous)", "건설업은 construction_continuous 의무"],
  },
  controls: {
    inputGuide: "감소대책. ERIC-PP 위계 (1.제거→2.대체→3.공학→4.관리→5.PPE) 우선순위. 잔존위험 명시.",
    standardFormat: "[위험요인]: [위계] [구체조치] / 담당 [성명] / 기한 / 잔존위험 [등급]",
    examples: [
      "추락(중): 3.공학적 — 안전난간·추락방호망 + 4.관리적 — 작업허가 / 박감독 / 4-29 / 잔존 저",
      "매몰(고): 1.제거 — 굴착방법 변경 + 3.공학 — 흙막이 보강 / 김안전 / 5-1 / 잔존 저",
    ],
    checkPoints: ["ERIC-PP 위계 우선", "잔존위험 평가", "근로자 통지 (위험성평가 고시 §13)"],
  },
  supervisor: {
    inputGuide: "이행 책임자·기한·점검 주기. 통제 미이행 시 작업중지 권한.",
    standardFormat: "[성명·직위] / 이행 기한 / 점검 [주기]",
    examples: [
      "박감독 (현장소장) / 2026-05-01 / 일일 점검 + 주간 합동",
      "김안전 (안전관리자) / 즉시 / 매일 + 변경 시",
    ],
    checkPoints: ["통제 책임자 명확", "점검 주기 명시", "미이행 시 작업중지 권한"],
  },
  participantsList: {
    inputGuide: "참여자 명단·서명. 사업주·관리감독자·근로자 대표 모두 서명. 위험성평가 고시 §9 의무.",
    standardFormat: "[N]명 (사업주 [N]·관리감독자 [N]·근로자대표 [N]·근로자 [N])",
    examples: [
      "12명 (사업주 1·관리감독자 3·근로자대표 4·근로자 4). 모두 서명.",
      "8명 (사업주 1·관리감독자 2·근로자대표 3·근로자 2). 서명부 별첨.",
    ],
    checkPoints: ["고시 §9 근로자 참여 의무", "서명부 5년 보존", "근로자 의견 반영 기록"],
  },
};

// 정기 평가 review 항목 (regular/monthly 공유)
const REVIEW: Record<string, any> = {
  review_aging: {
    inputGuide: "기계·기구·설비 기간 경과에 의한 성능 저하 검토. 안전인증·검사 주기 도래 여부.",
    standardFormat: "[장비] / 사용 [N]년 / 성능 [평가] / 다음 검사 [일자]",
    examples: ["타워크레인 5년 사용·정기 안전검사 합격 (2026-03)·다음 2027-03", "굴삭기 8년·교체 검토 중·중간 점검 통과"],
    checkPoints: ["산안법 §93 안전검사 주기", "성능저하 시 즉시 교체"],
  },
  review_workerChange: {
    inputGuide: "근로자 교체에 수반하는 안전·보건 지식·경험 변화. 신규자·경력자·외국인 비율.",
    standardFormat: "신규 [N]명·경력 [N]년 평균·외국인 [N]명",
    examples: ["신규 5명 (전체 80명의 6%)·경력 평균 8년·외국인 12명. 신규 OJT 강화 필요.", "교체 무 (전월 대비 안정)."],
    checkPoints: ["산안법 §29 신규 안전보건교육", "외국인 통역 자료"],
  },
  review_newKnowledge: {
    inputGuide: "안전·보건 새로운 지식 (법령 개정·KOSHA 가이드 신규·사고 사례·신기술). 위험성평가 고시 §11 의무.",
    standardFormat: "[종류]: [구체 항목]",
    examples: [
      "법령 개정: 산안법 §54 중대재해 보고 강화. KOSHA 신규 C-D-1 (해체작업). 신기술: 자동 후방경보. 사고: 4월 동종업계 추락 사망.",
      "신규 지식 무 (다음 분기 재검토).",
    ],
    checkPoints: ["KOSHA·고용노동부 정기 모니터링", "동종 사고 사례 반영"],
  },
  review_controlValidity: {
    inputGuide: "현재 수립된 위험성 감소대책의 유효성 평가. 사고 발생 여부·잔존위험 변화 추적.",
    standardFormat: "통제 [N]개 / 유효 [N]·미흡 [N] / 사고 [N]건",
    examples: [
      "통제 25개 / 유효 22·미흡 3 (안전난간 일부·신호수 1·정전 절차 1). 사고 0. → 미흡 3건 즉시 보강.",
      "통제 모두 유효. 사고 0 (3년 연속).",
    ],
    checkPoints: ["미흡 통제 즉시 보강", "사고 발생 시 통제 재평가"],
  },
};

const PATCHES: Record<string, Record<string, any>> = {
  "regular-risk-assessment": { ...COMMON, ...REVIEW },
  "monthly-risk-assessment": { ...COMMON, ...REVIEW },
  "ad-hoc-risk-assessment": { ...COMMON },
  "initial-risk-assessment": {
    ...COMMON,
    businessStartDate: {
      inputGuide: "사업 개시일 또는 실착공일. 최초 평가는 사업 개시 후 1개월 이내 의무 (위험성평가 고시 §6).",
      standardFormat: "사업 개시 YYYY-MM-DD / 평가 일자 (1개월 내)",
      examples: ["사업 개시 2026-03-15 / 평가 2026-04-10 (26일 후)", "착공 2026-04-01 / 평가 2026-04-28"],
      checkPoints: ["사업 개시 후 1개월 내", "건설업은 실착공일", "고시 §6 ① 1호"],
    },
    operationalRules: {
      inputGuide: "위험성평가 실시규정. KRAS 방법·주관자·주기·근로자 참여·기록 보존 규정. 위험성평가 고시 §5 의무.",
      standardFormat: "방법 [KRAS] / 주관 [성명] / 주기 [정기·수시·상시] / 보존 [N]년",
      examples: [
        "방법: 건설업 4주기 평가. 주관: 안전관리자 김안전. 주기: 정기 1년·수시 변경 시·상시 매월·최초 1개월 내. 보존 3년.",
        "방법: 빈도·강도법 + 체크리스트. 주관: 사업주 황룡. 보존 5년.",
      ],
      checkPoints: ["고시 §5 사전준비 단계", "근로자 대표 협의 의무", "사업주 책임 명시"],
    },
  },
  "risk-assessment-procedure": {
    policy: {
      inputGuide: "위험성평가 정책·목표. 사업주 의지 + 평가 범위·주기·참여 원칙. 위험성평가 고시 §4 의무.",
      standardFormat: "정책 [선언] / 목표 [수치·기한] / 범위 [작업·공정]",
      examples: [
        "사업주 의지: 모든 작업·공정 위험성 사전 평가. 목표: 사망 0·산재율 < 0.3% (전년 대비 50% 감축). 범위: 전 작업.",
        "정책: 위험성평가 KRAS 방법 적용. 목표: 분기별 재평가. 범위: 50인 이상 작업.",
      ],
      checkPoints: ["산안법 §36 사업주 의무", "고시 §4 정책 선언"],
    },
    organization: {
      inputGuide: "조직·역할·책임. 평가팀 구성 (안전관리자·관리감독자·근로자 대표). 의사결정 라인.",
      standardFormat: "[역할]: [성명·직위] / 책임 [내용]",
      examples: [
        "평가위원장: 황룡 (대표이사). 평가팀장: 김안전 (안전관리자). 팀원: 박감독·이근로 (근로자대표). 결정권: 사업주.",
        "전담팀 5명 (사업주 1·안전관리자 1·관리감독자 2·근로자대표 1).",
      ],
      checkPoints: ["근로자 대표 참여 의무 (고시 §9)", "역할·책임 명확"],
    },
    method: {
      inputGuide: "KRAS 7방법 중 선택. 사업장·작업 특성에 적합한 방법. 위험성평가 고시 §11.",
      standardFormat: "[KRAS 방법] / 선택 사유",
      examples: [
        "방법: 건설업 4주기 평가 (construction_continuous). 사유: 건설업 의무 + 정기·상시·수시·최초 통합.",
        "방법: 빈도·강도법 + 체크리스트. 사유: 중규모 + 표준 반복 작업.",
      ],
      checkPoints: ["KOSHA KRAS 7방법 (method:* 노드)", "건설업은 construction_continuous 권장"],
    },
    review: {
      inputGuide: "검토·개정 절차. 정기 검토 주기·개정 트리거 (사고·법령·신기술·근로자 의견).",
      standardFormat: "정기 [주기] / 개정 트리거 [조건]",
      examples: [
        "정기: 연 1회 (4월). 개정: 사고 발생·법령 개정·신규 장비·근로자 요청 즉시.",
        "정기 분기 1회. 개정: 산재 발생·KOSHA 가이드 변경.",
      ],
      checkPoints: ["고시 §6 정기 1년", "개정 시 근로자 통지"],
    },
    record: {
      inputGuide: "결과 기록·보존. 보존 3년 (정기·상시) / 5년 (최초·수시). 종이·전자 모두 가능.",
      standardFormat: "보존 [N]년 / 형식 [종이·전자] / 위치 [장소]",
      examples: [
        "보존: 정기·상시 3년·최초 5년. 형식: 전자 (그룹웨어) + 종이 (현장 사무실). 백업 월 1회.",
        "보존: 5년 통일. 형식: 종이 + 디지털 스캔.",
      ],
      checkPoints: ["고시 §15 보존 의무", "감독관 요청 시 즉시 제출"],
    },
  },
};

async function main() {
  let totalDocs = 0, totalFields = 0;
  for (const [docKey, fieldPatches] of Object.entries(PATCHES)) {
    const path = resolve(DOCS, `${docKey}.jsonld`);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      let updated = 0;
      for (const sec of node.sections ?? []) {
        for (const f of sec.fields ?? []) {
          const patch = fieldPatches[f.key];
          if (!patch) continue;
          Object.assign(f, patch);
          updated += 1;
        }
      }
      if (updated > 0) {
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
        console.log(`  ✓ ${docKey}: ${updated}개 field 직접 큐레이션`);
        totalDocs += 1;
        totalFields += updated;
      }
    } catch (err) {
      console.warn(`  ✗ ${docKey}: ${(err as Error).message}`);
    }
  }
  console.log(`\n[done] ${totalDocs} doc / ${totalFields} fields 보강`);
}

main().catch(console.error);
