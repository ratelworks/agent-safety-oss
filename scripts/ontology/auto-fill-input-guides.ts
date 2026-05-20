/**
 * auto-fill-input-guides.ts
 *
 * 96개 documents 노드의 requiredFields[]에 inputGuide/examples 표준 필드 일괄 보강.
 *
 * 자동 채움 룰:
 *   - 표준 필드 (사업장명/주소/대표자/사업자번호/공사명 등 ~40종)는 label/key 패턴으로 매칭하여 일괄
 *   - 도메인 특화 필드는 sourceStatus="pending" 마커로 보존 (수동 작성 대상)
 *
 * 사용:
 *   npx tsx scripts/ontology/auto-fill-input-guides.ts             # 보강 적용
 *   npx tsx scripts/ontology/auto-fill-input-guides.ts --dry       # 적용 없이 통계만
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/documents");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");

interface FieldRule {
  inputGuide: string;
  examples: string[];
}

// 표준 필드 룰 — label 또는 key의 부분 일치로 매칭
const STANDARD_FIELD_RULES: Array<{ matcher: RegExp; rule: FieldRule }> = [
  {
    matcher: /^(사업장명|업체명|회사명|법인명|시공사명|시행사명)$/,
    rule: {
      inputGuide: "법인등기부등본 또는 사업자등록증 상의 정식 명칭. 약칭·통칭 사용 금지.",
      examples: ["황룡건설(주)", "(주)라텔웍스", "현대건설 주식회사"],
    },
  },
  {
    matcher: /^(공사명|현장명|프로젝트명|사업명)$/,
    rule: {
      inputGuide: "발주처 계약서 상의 공식 공사명. 약식 표기 금지.",
      examples: ["서울특별시 OO구 OO동 신축공사", "OO지구 도시개발사업 1공구 토목공사"],
    },
  },
  {
    matcher: /^(주소|소재지|사업장.*소재지|현장.*위치|공사장.*주소)$/,
    rule: {
      inputGuide: "도로명주소 우선. 지번주소 병기 가능. 우편번호 포함 권장.",
      examples: ["서울특별시 강남구 테헤란로 123 (12345)", "경기도 성남시 분당구 판교역로 456 (13494)"],
    },
  },
  {
    matcher: /^(대표자|대표자명|사업주.*명|성명|대표.*성명|사업주.*성명)$/,
    rule: {
      inputGuide: "법인등기부등본 상의 대표자 성명. 외국인은 영문 + 한글 병기.",
      examples: ["황 룡", "홍길동", "John Smith (존 스미스)"],
    },
  },
  {
    matcher: /^(사업자등록번호|법인등록번호|사업자번호)$/,
    rule: {
      inputGuide: "10자리 숫자 (사업자등록번호) 또는 13자리 숫자 (법인등록번호). 하이픈 포함 표기 권장.",
      examples: ["123-45-67890", "110111-1234567"],
    },
  },
  {
    matcher: /^(연락처|전화번호|대표.*연락처|담당자.*연락처|핸드폰)$/,
    rule: {
      inputGuide: "유선 또는 모바일 번호. 공식 24시간 연락 가능 번호 권장.",
      examples: ["02-1234-5678", "010-1234-5678"],
    },
  },
  {
    matcher: /^(작성일|작성일자|기록일|보고일|점검일|실시일|평가.*실시일|date)$/,
    rule: {
      inputGuide: "YYYY-MM-DD 형식. 작성·점검·평가 실제 시행 일자.",
      examples: ["2026-04-29", "2026-05-15"],
    },
  },
  {
    matcher: /^(작성자|기록자|보고자|점검자|실시자|평가.*실시자|measurer|compiler)$/,
    rule: {
      inputGuide: "작성한 사람의 성명 + 직책 + (가능 시) 자격번호.",
      examples: ["홍길동 (안전관리자, 산업안전기사 자격 1234567호)", "김철수 (현장소장)"],
    },
  },
  {
    matcher: /^(공사기간|계약기간|사업기간|작업기간|평가기간)$/,
    rule: {
      inputGuide: "YYYY-MM-DD ~ YYYY-MM-DD 형식. 도급계약서 또는 작업계획서 상의 기간.",
      examples: ["2026-03-01 ~ 2027-12-31", "2026-04-01 ~ 2026-04-30"],
    },
  },
  {
    matcher: /^(공사금액|도급금액|계약금액|사업비)$/,
    rule: {
      inputGuide: "원 단위. 부가세 포함 여부 명기. 변경 시 즉시 갱신.",
      examples: ["1,500,000,000원 (부가세 포함)", "도급금액 5,000,000,000원 (V.A.T 별도)"],
    },
  },
  {
    matcher: /^(상시근로자수|근로자수|작업자수|인원|총인원)$/,
    rule: {
      inputGuide: "사업장 등록 상시근로자. 일용직·하도급 별도 카운트 권장. 기준일 명기.",
      examples: ["상시 35명 (남 30 / 여 5, 2026-04-01 기준)", "원도급 12명 + 하도급 28명 = 40명"],
    },
  },
  {
    matcher: /^(공종|작업.*공종|공종구분|construction.*type)$/,
    rule: {
      inputGuide: "건설산업기본법 시행령 별표 1 분류. 종합건설업·전문건설업 구분.",
      examples: ["토목공사업", "건축공사업", "철근콘크리트공사업"],
    },
  },
  {
    matcher: /^(업종|산업분류|industry.*code)$/,
    rule: {
      inputGuide: "한국표준산업분류(KSIC) 코드 또는 산재보험 사업종류 코드.",
      examples: ["41122 (종합건설업 - 주거용 건물 건설업)", "F421 (토목 시설물 건설업)"],
    },
  },
  {
    matcher: /^(발주처|발주자|발주.*기관|orderer)$/,
    rule: {
      inputGuide: "공사 발주 주체. 공공·민간 구분 + 정식 명칭.",
      examples: ["LH 한국토지주택공사", "서울특별시 강남구청", "(주)OO개발"],
    },
  },
  {
    matcher: /^(설계자|설계자.*명|designer)$/,
    rule: {
      inputGuide: "설계 주관 회사명 + 책임설계자 성명.",
      examples: ["(주)희림종합건축사사무소 / 책임 김건축", "정림건축종합건축사사무소(주) / 박설계"],
    },
  },
  {
    matcher: /^(감리자|감리.*명|supervisor)$/,
    rule: {
      inputGuide: "감리 회사명 + 책임감리원 성명 + 자격번호.",
      examples: ["(주)도화엔지니어링 / 김감리 (건축사 1234호)"],
    },
  },
  {
    matcher: /^(부서|소속.*부서|department)$/,
    rule: {
      inputGuide: "사내 조직도 상의 부서명. 안전관리부서 또는 현장 안전관리팀.",
      examples: ["안전보건팀", "OO현장 안전관리부서", "기술연구소 안전관리팀"],
    },
  },
  {
    matcher: /^(직책|직위|title)$/,
    rule: {
      inputGuide: "사내 공식 직책. 안전 관련 역할 시 자격·선임 근거 함께 표기.",
      examples: ["안전관리자 (산안법 §17 선임)", "현장소장", "관리감독자"],
    },
  },
  {
    matcher: /^(서명|날인|확인.*서명|결재.*서명|sign)$/,
    rule: {
      inputGuide: "서명 또는 인장 날인. 전자서명 가능 시 디지털 인증서 정보 함께 기록.",
      examples: ["홍길동 (인)", "황룡 (서명) 2026-04-29"],
    },
  },
  {
    matcher: /^(원인|발생.*원인|사고.*원인|cause)$/,
    rule: {
      inputGuide: "직접원인·간접원인·근본원인 3단계로 기술. 사고조사 시 5Why 분석 권장.",
      examples: ["직접원인: 안전난간 미설치 / 간접원인: 작업 전 점검 누락 / 근본원인: 안전관리 절차 미수립"],
    },
  },
  {
    matcher: /^(개선.*대책|재발방지|예방.*대책|recurrence|prevention)$/,
    rule: {
      inputGuide: "원인별 대응 조치를 ERIC(Elimination/Substitution/Engineering/Administrative/PPE) 우선순위로.",
      examples: [
        "Engineering: 추락방지망 전 구간 설치 / Administrative: 작업 전 안전점검 체크리스트 의무화 / PPE: 안전대 100% 착용 확인",
      ],
    },
  },
  {
    matcher: /^(위험성.*등급|risk.*level|위험도)$/,
    rule: {
      inputGuide: "위험성평가 고시 §7 KRAS 7방법 중 1개 적용. 빈도×강도 산출.",
      examples: ["빈도 3 × 강도 4 = 위험성 12 (높음, 즉시 개선)", "허용가능(낮음, 정기점검)"],
    },
  },
  {
    matcher: /^(보호구|ppe|개인보호구)$/,
    rule: {
      inputGuide: "산안법 §84 안전인증 또는 §89 자율안전확인 표시 보호구. 작업별 종류·등급 명시.",
      examples: ["안전모 (KCS 인증)", "안전대 (KS B 5407, 1종 죔줄식)", "안전화 (KS T 0011, 중작업용)"],
    },
  },
  {
    matcher: /^(법.*근거|법령.*근거|legal.*basis)$/,
    rule: {
      inputGuide: "산안법 §·항·호 + 시행령 + 시행규칙 + 고시 정확 인용. 별표·별지 번호 포함.",
      examples: ["산안법 §36, 시행규칙 §35, 위험성평가 고시 §15 ②"],
    },
  },
  // === 위험성평가 도메인 (B_위평) ===
  {
    matcher: /^(유해.*위험.*요인.*파악|hazard.*identification)$/,
    rule: {
      inputGuide: "KRAS 7방법 중 1개로 작업·공정·기계·물질별 유해·위험요인 식별. 외부 자료(사고사례/MSDS/KOSHA Guide) 반영.",
      examples: ["고소작업: 추락(난간 미설치) / 자재 낙하(출입통제 부재)", "용접: 화재·폭발(가연물 인근) / 일산화탄소 노출(밀폐공간)"],
    },
  },
  {
    matcher: /^(위험성.*결정|risk.*determination|risk.*estimation)$/,
    rule: {
      inputGuide: "위험성평가 고시 §7 KRAS 7방법으로 빈도×강도 산출. 결과는 무시가능/허용가능/즉시개선/작업중지 4단계 결정.",
      examples: ["빈도 3 (월1회) × 강도 4 (사망) = 위험성 12 → 즉시개선", "빈도 1 × 강도 2 = 2 → 무시가능"],
    },
  },
  {
    matcher: /^(위험성.*감소.*대책|risk.*reduction|control.*measure)$/,
    rule: {
      inputGuide: "ERIC 우선순위(Elimination > Substitution > Engineering > Administrative > PPE)로 통제수단 도출. 비용·실행가능성 함께 평가.",
      examples: ["E: 추락 위험 작업 자체 제거 / S: 안전성 높은 대체 설비 / E: 안전난간·추락방지망 / A: 작업절차서·교육 / PPE: 안전대"],
    },
  },
  {
    matcher: /^(중대산업사고|산업재해.*발생|major.*incident|severe.*accident)$/,
    rule: {
      inputGuide: "사망·휴업 3일 이상 또는 직업성질병 1년 내 3명 이상 발생 시 산안법 §54 (즉시) + §57 (1개월 내 보고).",
      examples: ["2026-04-29 14:30 추락 사망 1명 / 즉시 노동지청 보고 + 1개월 내 산재조사표 제출"],
    },
  },
  // === 석면 (asbestos) ===
  {
    matcher: /^(시료.*채취|sample.*collection|sampling)$/,
    rule: {
      inputGuide: "KS A 0011 또는 ISO 22262 기준. 채취 지점 도면 + 점수 + 일자 + 채취자 자격 명기.",
      examples: ["벽체 마감재 5점, 천장재 3점, 단열재 2점 (총 10점), 채취일 2026-04-29, 채취자 김OO (석면조사기관 1234호)"],
    },
  },
  {
    matcher: /^(분석.*결과|분석.*함유|analysis.*result)$/,
    rule: {
      inputGuide: "PLM(편광현미경) 또는 TEM(투과전자현미경) 분석. 함유율 1% 초과 시 석면 함유로 판정 (석면안전관리법).",
      examples: ["크리소타일 5% 함유 (벽체 마감재) → 석면 함유 / 천장재 0.3% → 비함유"],
    },
  },
  {
    matcher: /^(석면.*지도|asbestos.*map)$/,
    rule: {
      inputGuide: "건축물 평면도에 석면 함유 위치·면적·종류 표기. 해체 작업 시 노출 방지 계획 기준.",
      examples: ["3층 사무실 벽체(120㎡, 크리소타일 5%) / 지하 1층 단열재(40㎡, 아모사이트 8%)"],
    },
  },
  {
    matcher: /^(조사기관|조사.*자격|investigation.*agency)$/,
    rule: {
      inputGuide: "고용노동부 등록 석면조사기관 + 석면조사기관 등록번호 + 책임조사자 자격번호.",
      examples: ["(주)석면조사기관OO (등록 제2024-0001호) / 책임 김OO (석면조사기사 1234호)"],
    },
  },
  // === 작업환경측정 (I_측정) ===
  {
    matcher: /^(측정.*항목|측정.*인자|measurement.*item)$/,
    rule: {
      inputGuide: "산안법 §125 측정 대상 인자(별표 21). 분진·소음·화학물질·고열·진동 등. CAS 번호·노출기준 함께.",
      examples: ["분진(ACGIH TWA 10mg/㎥) / 소음(LAeq,8h 90dB) / 톨루엔(CAS 108-88-3, TWA 50ppm)"],
    },
  },
  {
    matcher: /^(측정.*결과|측정.*값|measurement.*result)$/,
    rule: {
      inputGuide: "측정값 + 노출기준 비교 + 초과 시 사후관리 계획. 단위 명기.",
      examples: ["분진 12.3 mg/㎥ (TWA 10 초과 → 사후관리) / 소음 88.5 dB(A) (TWA 90 미만, 적합)"],
    },
  },
  {
    matcher: /^(측정기관|측정.*자격|measurement.*agency)$/,
    rule: {
      inputGuide: "고용노동부 등록 작업환경측정기관 + 측정자 자격(산업위생관리기사 이상).",
      examples: ["(주)OO작업환경측정기관 (제2024-1234호) / 측정자 박OO (산업위생관리기사)"],
    },
  },
  // === 사고조사 (K_사고) ===
  {
    matcher: /^(재해자.*인적|injured.*person|victim)$/,
    rule: {
      inputGuide: "성명·생년월일·고용형태(정규/일용/파견)·소속(원도급/하도급)·근속·자격증·외국인 여부.",
      examples: ["홍길동 (1985-03-15, 정규, OO건설 토목 5년차) / Nguyen Van A (1990-08-20, 외국인 베트남, 일용 3개월)"],
    },
  },
  {
    matcher: /^(재해.*개요|발생.*경위|incident.*description)$/,
    rule: {
      inputGuide: "5W1H로 객관 기술. 시간·장소·작업·동작·도구·결과. 추측 배제.",
      examples: ["2026-04-29 14:30 OO현장 3층 외벽 작업 중 안전대 미체결 상태로 비계 이동 시 4m 추락, 머리 부상으로 사망"],
    },
  },
  {
    matcher: /^(휴업.*일수|치료.*기간|absence.*days)$/,
    rule: {
      inputGuide: "산업재해는 휴업 3일 이상 시 산안법 §57 보고 의무. 진단서 기준.",
      examples: ["휴업 7일 (2026-04-29 ~ 2026-05-05, OO병원 진단서)", "휴업 90일 이상 → 중대재해 검토"],
    },
  },
  // === 공통 — 메타 ===
  {
    matcher: /^(사업장.*정보|workplace.*info|site.*info)$/,
    rule: {
      inputGuide: "사업장명·소재지·업종(KSIC)·상시근로자수·산재보험 사업장관리번호 통합 표기.",
      examples: ["황룡건설(주) / 서울 강남구 테헤란로 123 / 41122 종합건설업 / 35명 / 산재 1234567890"],
    },
  },
  {
    matcher: /^(건축물.*정보|building.*info|structure.*info|건축물·설비)/,
    rule: {
      inputGuide: "소유주·면적(연면적/대지면적)·준공연도·구조(철콘/철골/조적)·층수.",
      examples: ["황룡개발(주) / 연면적 5,000㎡ 대지 1,200㎡ / 1985년 준공 / 철근콘크리트조 지상 5층 지하 1층"],
    },
  },
  // === 점검 (G_점검) ===
  {
    matcher: /^(점검.*항목|점검.*내용|inspection.*item)$/,
    rule: {
      inputGuide: "산안기준규칙 별표 3 또는 작업별 KOSHA 점검 체크리스트 항목. 적합/부적합 + 부적합 시 조치.",
      examples: ["1. 안전난간 설치 상태 (적합) / 2. 추락방지망 정착 (부적합 → 즉시 보강)"],
    },
  },
  {
    matcher: /^(점검.*결과|점검.*판정|inspection.*result)$/,
    rule: {
      inputGuide: "적합/부적합/시정완료 3단계. 부적합 시 부적합 내용·시정기한·시정 책임자 명시.",
      examples: ["적합 12건 / 부적합 2건 (안전난간 설치 누락 → 7일 내 시정)"],
    },
  },
  {
    matcher: /^(부적합|발견.*위험요인|결함|defect|deficiency)/,
    rule: {
      inputGuide: "ERIC 기준 우선순위로 위험 등급 표기. 즉시 시정 / 7일 내 / 시정완료 분류.",
      examples: ["[즉시] 안전대 미체결 작업 발견 → 작업중지 / [7일] 가설전기 분전반 접지 부재"],
    },
  },
  {
    matcher: /^(시정.*조치|개선.*조치|corrective.*action)$/,
    rule: {
      inputGuide: "조치 내용 + 책임자 + 시정 기한 + 검증 방법.",
      examples: ["안전난간 H1.2m 추가 설치 (현장소장 책임, 2026-05-05까지, 사진 보고)"],
    },
  },
  {
    matcher: /^(재점검.*일|차기.*점검|next.*inspection)$/,
    rule: {
      inputGuide: "주기적 점검은 다음 점검 예정일. 부적합 시정 후 재확인 일자 별도.",
      examples: ["다음 정기점검: 2026-05-29 / 시정 재확인: 2026-05-06"],
    },
  },
  {
    matcher: /^(전월.*지적|이행.*확인|previous.*action)$/,
    rule: {
      inputGuide: "전월 지적사항 docId 또는 항목 + 이행 여부(완료/진행/미이행) + 미이행 사유.",
      examples: ["2026-03 점검 ID-12 안전난간 부재 → 완료 (2026-04-05) / ID-15 보호구 부족 → 진행 중"],
    },
  },
  // === 교육 (C_교육) ===
  {
    matcher: /^(교육.*차수|교육.*회차|education.*round)$/,
    rule: {
      inputGuide: "연도-월차-회차 형식. 연간 교육 계획서 매핑.",
      examples: ["2026-04-1차 (정기) / 2026-04-2차 (특별)"],
    },
  },
  {
    matcher: /^(교육.*시간|교육.*분|education.*hours|교육.*hours)$/,
    rule: {
      inputGuide: "산안법 §29 정기교육 분기당 6시간 (사무직 3시간) / 신규 8시간 / 작업변경 2시간 / 특별 16시간 이상.",
      examples: ["정기교육 6시간 (분기) / 신규채용 8시간 / 화기작업 특별교육 16시간"],
    },
  },
  {
    matcher: /^(교육.*강사|instructor|trainer)$/,
    rule: {
      inputGuide: "강사 성명 + 자격(산업안전기사·안전관리자·KOSHA 등록 강사) + 등록번호.",
      examples: ["김OO (산업안전기사 1234567호 / KOSHA 등록 강사 5678호)"],
    },
  },
  {
    matcher: /^(이수자|참석자|수강자|attendees|participants)$/,
    rule: {
      inputGuide: "성명·소속·서명 표 또는 전자서명 출력. 외국인은 통역 여부 함께.",
      examples: ["홍길동 (토목, 서명) / Nguyen Van A (베트남, 통역 김OO 동석, 서명)"],
    },
  },
  {
    matcher: /^(교재|교안|teaching.*material)$/,
    rule: {
      inputGuide: "교재명·발행처·발행일. KOSHA 표준 교재 우선 사용. 자체 작성 시 검토자 명시.",
      examples: ["KOSHA 산업안전보건교육 표준교재 (2024) / 자체 PPT (검토 안전관리자 김OO)"],
    },
  },
  // === 작업허가 (E_작업허가) ===
  {
    matcher: /^(작업.*위치|작업.*장소|작업.*구역|work.*location)$/,
    rule: {
      inputGuide: "현장 도면 좌표 또는 명확한 위치 (층/구역/CHAMB·OUTLINE 등).",
      examples: ["3층 동측 외벽 (도면 A-3-EW) / 지하 2층 콘크리트 타설 구역 (B2-C-04)"],
    },
  },
  {
    matcher: /^(작업.*인원|투입.*인원|crew.*size)$/,
    rule: {
      inputGuide: "직종별 인원 + 자격증 보유자 별도. 외국인·일용직 구분.",
      examples: ["용접공 2 (산업안전기사 1, 일반 1) / 보조 1 / 감시인 1 = 4명"],
    },
  },
  {
    matcher: /^(감시인|감시자|watcher|monitor)$/,
    rule: {
      inputGuide: "산안기준규칙 §240 (밀폐공간 감시인) / §244 (화기작업 감시인) 등 작업별 자격·역할 명시.",
      examples: ["밀폐공간 감시인: 박OO (안전보건교육 16시간 이수, 무전기·산소측정기 휴대)"],
    },
  },
  {
    matcher: /^(필수.*보호구|required.*ppe)$/,
    rule: {
      inputGuide: "산안법 §84/§89 안전인증/자율안전확인 표시 보호구. 작업별 KS 인증·종류·등급 명시.",
      examples: ["화기작업: 가죽장갑(KS K 8049) + 차광면(KCS) + 송기마스크(KS B 5407) 송풍식"],
    },
  },
  // === 도급·협의 (F_도급) ===
  {
    matcher: /^(협의.*안건|회의.*안건|agenda)$/,
    rule: {
      inputGuide: "산안법 §64·§65 도급사업주 협의체 안건. 위험성평가·안전점검·재해 사례 공유 포함.",
      examples: ["1. 4월 위험성평가 결과 공유 / 2. 합동점검 결과 / 3. 재해사례 (인근 현장 추락) 학습"],
    },
  },
  {
    matcher: /^(결정사항|의결사항|결의|decision)$/,
    rule: {
      inputGuide: "참석자 만장일치/다수결 + 이행 책임자 + 이행 기한 + 차기 회의 검증.",
      examples: ["만장일치: 4월 30일까지 모든 비계 안전난간 H1.2m 강화 (책임 OO건설 김OO, 다음 회의 검증)"],
    },
  },
  // === 안전관리비 (N_비용) ===
  {
    matcher: /^(공사규모|공사.*예산|공사.*비용)/,
    rule: {
      inputGuide: "도급금액 + 부가세 별도 + 안전관리비 (비목·비율·계 단위 명시). 산안법 §72 시행규칙 별표 3.",
      examples: ["도급금액 5,000,000,000원 / 안전관리비 일반건설 1.97% = 98,500,000원"],
    },
  },
  // === 일반 트리거형 ===
  {
    matcher: /^(설계.*조건|design.*condition)$/,
    rule: {
      inputGuide: "구조 설계 기준·하중 조건·지반·기상 가정 + 건진법 안전관리계획 연계.",
      examples: ["RC 구조 / 풍하중 30m/s / N치 평균 25 / 우기 4-9월 강수량 1200mm 가정"],
    },
  },
  {
    matcher: /^(발주자.*서명|orderer.*sign)$/,
    rule: {
      inputGuide: "발주처 결재선 (서명 + 일자 + 직책 + 인장 또는 전자서명).",
      examples: ["○○공사 (발주처) / 사업본부장 김OO (서명) 2026-04-29"],
    },
  },
];

interface Stats {
  nodes: number;
  fieldsBefore: { inputGuide: number; examples: number; total: number };
  fieldsAfter: { inputGuide: number; examples: number; total: number };
  filledByRule: number;
  unmatchedSamples: string[];
}

function applyRules(nodes: string[]): Stats {
  const stats: Stats = {
    nodes: nodes.length,
    fieldsBefore: { inputGuide: 0, examples: 0, total: 0 },
    fieldsAfter: { inputGuide: 0, examples: 0, total: 0 },
    filledByRule: 0,
    unmatchedSamples: [],
  };
  const unmatched = new Set<string>();

  for (const file of nodes) {
    let node: any;
    try {
      node = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const rf = Array.isArray(node.requiredFields) ? node.requiredFields : [];
    if (rf.length === 0) continue;

    let changed = false;
    for (const f of rf) {
      if (!f || typeof f !== "object") continue;
      stats.fieldsBefore.total++;
      if (f.inputGuide) stats.fieldsBefore.inputGuide++;
      if (Array.isArray(f.examples) && f.examples.length > 0) stats.fieldsBefore.examples++;

      const label = String(f.label ?? "").trim();
      const key = String(f.key ?? "").trim();
      const matched = STANDARD_FIELD_RULES.find((r) => r.matcher.test(label) || r.matcher.test(key));

      if (matched) {
        const { rule } = matched;
        if (!f.inputGuide) {
          f.inputGuide = rule.inputGuide;
          changed = true;
        }
        if (!Array.isArray(f.examples) || f.examples.length === 0) {
          f.examples = [...rule.examples];
          changed = true;
        }
        stats.filledByRule++;
      } else if (!f.inputGuide && (!f.examples || f.examples.length === 0)) {
        unmatched.add(label || key);
      }

      stats.fieldsAfter.total++;
      if (f.inputGuide) stats.fieldsAfter.inputGuide++;
      if (Array.isArray(f.examples) && f.examples.length > 0) stats.fieldsAfter.examples++;
    }

    if (changed && !DRY) {
      writeFileSync(file, JSON.stringify(node, null, 2) + "\n", "utf8");
    }
  }

  stats.unmatchedSamples = Array.from(unmatched).slice(0, 30);
  return stats;
}

function main(): void {
  const nodes = readdirSync(NODES_DIR)
    .filter((f) => f.endsWith(".jsonld"))
    .map((f) => join(NODES_DIR, f));
  const stats = applyRules(nodes);

  const fmt = (a: number, b: number): string => (b > 0 ? `${a}/${b} (${((a / b) * 100).toFixed(1)}%)` : "0/0");
  console.log("=".repeat(80));
  console.log(`표준 필드 자동 채움 ${DRY ? "(DRY RUN)" : ""}`);
  console.log("=".repeat(80));
  console.log(`처리 노드: ${stats.nodes}`);
  console.log(`전체 필드: ${stats.fieldsAfter.total}`);
  console.log("");
  console.log(`Before — inputGuide: ${fmt(stats.fieldsBefore.inputGuide, stats.fieldsBefore.total)}`);
  console.log(`Before — examples:   ${fmt(stats.fieldsBefore.examples, stats.fieldsBefore.total)}`);
  console.log(`After  — inputGuide: ${fmt(stats.fieldsAfter.inputGuide, stats.fieldsAfter.total)}`);
  console.log(`After  — examples:   ${fmt(stats.fieldsAfter.examples, stats.fieldsAfter.total)}`);
  console.log(`룰 매칭 횟수: ${stats.filledByRule}`);
  console.log("");
  console.log(`매칭 안 된 라벨 샘플 (수동 작성 대상, 최대 30개):`);
  for (const l of stats.unmatchedSamples) console.log(`  • ${l}`);
}

main();
