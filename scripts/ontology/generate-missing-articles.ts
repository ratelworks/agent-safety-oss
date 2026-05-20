#!/usr/bin/env tsx
/**
 * generate-missing-articles.ts
 * legal-coverage-audit 가 보고한 13개 누락 조문 + dangling 보강용 추가 조문
 * + dangling annex(별표4-1~13호) + dangling 산안법시행규칙 조문을 stub 노드로 일괄 생성.
 *
 * 본문은 법제처 OpenAPI sync 대상 (Phase 3) — 현재는 schema 채움만.
 * verificationStatus: "stub" 으로 명시 표시.
 */
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "articles");
const ANNEXES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "annexes");

const FETCHED = "2026-04-28";
const NOTE_STUB = "Coverage closure stub (Phase 2.5). 제목·골격만 채움. 본문 verified 는 법제처 lawService.do sync 후 전환.";

interface ArticleStub {
  act: "산안법" | "기준규칙" | "산안법시행규칙";
  num: string;
  title: string;
  partOf: string;
  legalBasisOf?: string[];
  delegates?: string[];
  regulates?: string[];
  appliesTo?: string[];
  description?: string;
}

const ART_STUBS: ArticleStub[] = [
  // 13개 누락 의무문서 근거 조문 (산안법)
  { act: "산안법", num: "11", title: "산업재해 예방시설의 설치·운영 등",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    description: "정부는 산업재해 예방을 위한 시설을 설치·운영하고, 도급사업주에게 안전보건정보 제공을 의무화한다. 도급계약 체결 시 안전보건정보 명시 의무의 모법 근거." },
  { act: "산안법", num: "22", title: "산업보건의",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:ad_hoc/industrial_physician_appointment"],
    description: "사업주는 근로자의 건강관리 등 보건관리자의 업무를 지도하기 위하여 산업보건의를 두어야 한다. 50인 이상 사업장 적용." },
  { act: "산안법", num: "23", title: "명예산업안전감독관",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:ad_hoc/honorary_safety_supervisor_appointment"],
    description: "고용노동부장관은 산업재해 예방활동에 대한 참여와 지원을 촉진하기 위하여 근로자, 근로자단체, 사업주단체 및 산업재해 예방 관련 전문단체의 추천을 받아 명예산업안전감독관을 위촉할 수 있다." },
  { act: "산안법", num: "47", title: "안전보건진단",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:ad_hoc/safety_health_diagnosis_report"],
    description: "고용노동부장관은 추락·폭발·붕괴 등 재해 발생 위험이 현저히 높은 사업장의 사업주에게 고용노동부령으로 정하는 안전보건진단을 받을 것을 명할 수 있다." },
  { act: "산안법", num: "73", title: "건설공사의 산업재해 예방지도",
    partOf: "act:산업안전보건법", appliesTo: ["applic:construction_under_50bn"],
    legalBasisOf: ["doc:monthly/construction_disaster_prevention_guidance"],
    description: "대통령령으로 정하는 건설공사의 건설공사도급인은 해당 건설공사를 하는 동안에 고용노동부령으로 정하는 자격을 가진 자로부터 건설재해예방 지도를 받아야 한다. 1억 원 이상 120억 원 미만 건설공사 적용." },
  { act: "산안법", num: "83", title: "안전인증",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:ad_hoc/safety_certification_application"],
    description: "유해하거나 위험한 기계·기구·설비 및 방호장치·보호구를 제조하거나 수입하는 자는 안전인증대상기계등이 안전인증기준에 맞는지에 대하여 고용노동부장관이 실시하는 안전인증을 받아야 한다.",
    delegates: ["art:산안법시행규칙:74"] },
  { act: "산안법", num: "89", title: "자율안전확인의 신고",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:ad_hoc/voluntary_safety_confirmation_filing"],
    description: "안전인증대상기계등이 아닌 유해·위험한 기계·기구·설비 등으로서 대통령령으로 정하는 것을 제조하거나 수입하는 자는 자율안전확인대상기계등의 안전에 관한 성능이 자율안전기준에 맞는 것임을 확인하여 고용노동부장관에게 신고하여야 한다.",
    delegates: ["art:산안법시행규칙:80"] },
  { act: "산안법", num: "93", title: "안전검사",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:ad_hoc/safety_inspection_application"],
    description: "유해하거나 위험한 기계·기구·설비로서 대통령령으로 정하는 것을 사용하는 사업주는 안전검사대상기계등의 안전에 관한 성능이 검사기준에 맞는지에 대하여 고용노동부장관이 실시하는 검사를 받아야 한다.",
    delegates: ["art:산안법시행규칙:86"] },
  { act: "산안법", num: "126", title: "작업환경측정 결과 통지",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:monthly/work_environment_measurement_notification"],
    description: "사업주는 작업환경측정 결과를 해당 작업장의 근로자에게 알려야 하며, 산업안전보건위원회 또는 근로자대표가 요구하면 직접 측정 결과를 설명하여야 한다. 시행규칙 §188 보존 5년." },
  { act: "산안법", num: "134", title: "건강진단에 따른 사후조치",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:annual/health_examination_followup"],
    description: "사업주는 건강진단 결과 근로자의 건강을 유지하기 위하여 필요하다고 인정할 때에는 작업장소의 변경, 작업의 전환, 근로시간의 단축, 야간근로의 제한, 작업환경측정 또는 시설·설비의 설치·개선 등 적절한 조치를 하여야 한다. 질병자 근로 금지 기록의 모법 근거." },
  { act: "산안법", num: "142", title: "석면조사",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:ad_hoc/asbestos_investigation_report"],
    regulates: ["activity:asbestos_removal"],
    description: "건축물 또는 설비의 소유주 등은 해당 건축물이나 설비의 철거·해체 전에 미리 석면조사를 하여야 한다. 일정 면적 이상 건축물은 석면조사기관에 의한 기관석면조사 의무. 산안법시행령 §49 적용 면적·설비 기준." },

  // dangling refs 보강 — 산안법
  { act: "산안법", num: "25", title: "안전보건관리규정의 작성",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:annual/safety_health_regulation"],
    description: "사업주는 사업장의 안전 및 보건을 유지하기 위하여 안전보건관리규정을 작성하여야 한다. 작성 사항: 안전·보건 관리조직, 안전·보건교육, 작업장의 안전·보건관리, 사고 조사 및 대책수립, 그 밖에 안전·보건에 관한 사항.",
    delegates: ["art:산안법시행규칙:25"] },
  { act: "산안법", num: "32", title: "안전보건관리책임자 등에 대한 직무교육",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:annual/supervisor_education_log"],
    description: "사업주는 안전보건관리책임자, 안전관리자, 보건관리자 등에 대하여 정기적으로 직무교육을 하여야 한다. 신규교육 + 보수교육 (2년 주기).",
    delegates: ["art:산안법시행규칙:35"] },
  { act: "산안법", num: "37", title: "안전보건표지의 설치·부착",
    partOf: "act:산업안전보건법", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:monthly/safety_signage_register"],
    description: "사업주는 유해하거나 위험한 장소·시설·물질에 대한 경고, 비상시 조치를 위한 지시, 그 밖에 근로자의 안전 및 보건의식 고취를 위한 사항을 안전보건표지로 만들어 근로자가 쉽게 알아 볼 수 있도록 설치·부착하여야 한다.",
    delegates: ["art:산안법시행규칙:38"] },

  // dangling refs 보강 — 기준규칙
  { act: "기준규칙", num: "30", title: "고소작업대",
    partOf: "act:산업안전보건기준에관한규칙", appliesTo: ["applic:all_workplace"],
    legalBasisOf: ["doc:ad_hoc/work_permit_high_altitude"],
    description: "고소작업대(차량탑재형 포함) 사용 시 안전난간, 작업대 자동상승 방지, 작업대 정격하중 표시, 비상정지장치 등 설치·점검 의무. 작업 시작 전 일일점검 필수." },

  // dangling refs 보강 — 산안법시행규칙
  { act: "산안법시행규칙", num: "25", title: "안전보건관리규정의 세부 작성 사항",
    partOf: "act:산업안전보건법시행규칙",
    description: "산안법 §25 위임. 안전보건관리규정 세부 작성 항목 및 변경·심의 절차." },
  { act: "산안법시행규칙", num: "35", title: "안전보건관리책임자 직무교육 시간",
    partOf: "act:산업안전보건법시행규칙",
    description: "산안법 §32 위임. 안전보건관리책임자 신규교육 6시간, 보수교육 6시간 (2년 주기)." },
  { act: "산안법시행규칙", num: "38", title: "안전보건표지의 종류·형태·색채",
    partOf: "act:산업안전보건법시행규칙",
    description: "산안법 §37 위임. 안전보건표지 종류 (금지·경고·지시·안내) 및 색채 (빨강·노랑·파랑·녹색) 표준." },
  { act: "산안법시행규칙", num: "43", title: "안전보건관리담당자의 선임 등",
    partOf: "act:산업안전보건법시행규칙",
    legalBasisOf: ["doc:ad_hoc/safety_health_management_assistant_appointment"],
    description: "20인 이상 50인 미만 사업장(제조업·임업·하수처리업 등) 안전보건관리담당자 선임 기준 및 직무." },
  { act: "산안법시행규칙", num: "74", title: "안전인증의 신청·심사 절차",
    partOf: "act:산업안전보건법시행규칙",
    description: "산안법 §83 위임. 안전인증 대상 기계·기구·방호장치·보호구의 신청서·심사 항목·인증서 발급 절차." },
];

const ANNEX_STUBS = [
  { num: "1", title: "타워크레인 설치·해체·상승작업", doc: "doc:ad_hoc/work_plan_tower_crane" },
  { num: "2", title: "차량계 하역운반기계 운반작업", doc: "doc:ad_hoc/work_plan_vehicle_cargo" },
  { num: "3", title: "차량계 건설기계 작업", doc: "doc:ad_hoc/work_plan_vehicle_construction" },
  // 4호 화학설비 — 비건설 (별도 OSS)
  { num: "5", title: "전기작업", doc: "doc:ad_hoc/work_plan_electric_work" },
  { num: "7", title: "터널 굴착작업", doc: "doc:ad_hoc/work_plan_tunnel" },
  { num: "8", title: "교량 설치·해체·변경작업", doc: "doc:ad_hoc/work_plan_bridge" },
  // 9호 채석작업 — 비건설 (광업, 별도 OSS)
  { num: "10", title: "건물 등의 해체작업", doc: "doc:ad_hoc/work_plan_demolition" },
  { num: "11", title: "중량물 취급작업", doc: "doc:ad_hoc/work_plan_heavy_lifting" },
  // 12호 궤도 보수·점검 / 13호 입환작업 — 비건설 (철도 운영, 별도 OSS)
];

(async () => {
  let created = 0;

  for (const a of ART_STUBS) {
    const safeNum = a.num.replace("/", "_");
    const fname = `${a.act}-§${safeNum}.jsonld`;
    const path = resolve(ARTICLES, fname);
    const obj: Record<string, unknown> = {
      "@context": "../../context.jsonld",
      "@id": `art:${a.act}:${a.num}`,
      "@type": ["Article", "Legislation"],
      articleNumber: a.num,
      title: a.title,
      partOf: a.partOf,
      verificationStatus: "stub",
      ...(a.delegates && { delegates: a.delegates }),
      ...(a.legalBasisOf && { legalBasisOf: a.legalBasisOf }),
      ...(a.regulates && { regulates: a.regulates }),
      ...(a.appliesTo && { appliesTo: a.appliesTo }),
      _meta: {
        publishedBy: "법제처 국가법령정보센터 (자동 stub)",
        sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(
          a.act === "산안법" ? "산업안전보건법" :
          a.act === "기준규칙" ? "산업안전보건기준에관한규칙" :
          "산업안전보건법시행규칙"
        )}/제${a.num}조`,
        fetchedAt: FETCHED,
        licenseHint: "저작권법 §7 비보호 (자유 인용)",
        note: NOTE_STUB,
        coverageGapClosureAt: FETCHED
      },
      description: a.description ?? `${a.title} (Phase 2.5 stub).`,
      legislationIdentifier:
        a.act === "산안법" ? "산업안전보건법" :
        a.act === "기준규칙" ? "산업안전보건기준에 관한 규칙" :
        "산업안전보건법 시행규칙",
      legislationDate: "2025-10-01",
      legislationType: a.act === "산안법" ? "Act" : "Regulation",
      legislationLegalForce: "InForce",
      jurisdiction: "KR",
      temporalCoverage: "2025-10-01/.."
    };
    await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
    created++;
  }

  for (const x of ANNEX_STUBS) {
    const fname = `기준규칙-별표4-${x.num}호.jsonld`;
    const path = resolve(ANNEXES, fname);
    const obj = {
      "@context": "../../context.jsonld",
      "@id": `annex:기준규칙:별표4-${x.num}호`,
      "@type": ["Annex"],
      title: `별표 4 제${x.num}호 — ${x.title}`,
      annexNumber: `4-${x.num}`,
      partOf: "act:산업안전보건기준에관한규칙",
      verificationStatus: "stub",
      legalBasisOf: [x.doc],
      regulatedBy: "art:기준규칙:38",
      _meta: {
        publishedBy: "법제처 국가법령정보센터 (자동 stub)",
        sourceUrl: "https://www.law.go.kr/법령/산업안전보건기준에관한규칙/별표/4",
        fetchedAt: FETCHED,
        licenseHint: "저작권법 §7 비보호 (자유 인용)",
        note: "Coverage closure stub (Phase 2.5). 작업계획서 13종 (별표 4) 중 한 항목."
      },
      description: `산업안전보건기준에 관한 규칙 별표 4 제${x.num}호 (${x.title}). 산안법 §38 작업계획서 13종 작성 의무 근거. 본문 verified 는 법제처 sync 대상.`,
      jurisdiction: "KR"
    };
    await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
    created++;
  }

  console.log(`✅ ${created} stubs created (${ART_STUBS.length} articles + ${ANNEX_STUBS.length} annexes)`);
})();
