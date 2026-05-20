#!/usr/bin/env tsx
/**
 * fix-dangling-and-add-docs.ts
 *  · 잘못된 IRI 참조 정정 (act:중대재해처벌법, doc id mismatch)
 *  · 13개 누락 조문 cover 를 위한 stub 의무문서 생성
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const PENALTIES = resolve(NODES, "penalties");
const DOCS = resolve(NODES, "documents");

// ─── 1. IRI 정정 (글로벌 치환) ───
const REPLACEMENTS: Array<[RegExp, string]> = [
  // act 정정
  [/"act:중대재해처벌법"/g, '"act:중대재해처벌등에관한법률"'],
  // doc id mismatch 정정 (article → 실제 doc IRI)
  [/"doc:ad_hoc\/msds_register"/g, '"doc:continuous/msds_register"'],
  [/"doc:ad_hoc\/pre_work_inspection"/g, '"doc:daily/pre_work_inspection"'],
  [/"doc:annual\/severe_accident_compliance"/g, '"doc:semi_annual/severe_accident_compliance"'],
  [/"doc:monthly\/work_environment_measurement"/g, '"doc:semi_annual/work_environment_measurement"'],
];

async function fixFile(path: string): Promise<boolean> {
  const orig = await readFile(path, "utf-8");
  let modified = orig;
  for (const [re, sub] of REPLACEMENTS) modified = modified.replace(re, sub);
  if (modified !== orig) {
    await writeFile(path, modified, "utf-8");
    return true;
  }
  return false;
}

async function walkAndFix(dir: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(dir)) {
    const p = join(dir, entry);
    const st = await stat(p);
    if (st.isDirectory()) count += await walkAndFix(p);
    else if (entry.endsWith(".jsonld")) {
      if (await fixFile(p)) count++;
    }
  }
  return count;
}

// ─── 2. 누락 의무문서 stub 생성 (legal coverage 100% 도달) ───
interface DocStub {
  id: string;
  docId: string;
  title: string;
  cycle: string;
  legalBasis: string[];
  description: string;
  trigger?: string;
}

const FETCHED = "2026-04-28";
const DOC_STUBS: DocStub[] = [
  {
    id: "doc:ad_hoc/safety_health_information_provision",
    docId: "safety_health_information_provision",
    title: "도급 시 안전보건정보 제공서",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:11", "art:산안법시행규칙:73"],
    description: "산안법 §11 도급계약 체결 시 도급인이 수급인에게 제공해야 하는 안전보건정보 (작업환경·유해위험요인·예방조치) 제공서. 시행규칙 §73 별표 11 양식.",
    trigger: "도급계약 체결 시"
  },
  {
    id: "doc:ad_hoc/industrial_physician_appointment",
    docId: "industrial_physician_appointment",
    title: "산업보건의 선임 신고서",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:22", "art:산안법시행령:29"],
    description: "산안법 §22 50인 이상 사업장의 산업보건의 선임 시 14일 이내 고용노동부 관할 지방관서에 신고. 자격(의사)·위촉장·근무 요일 명시.",
    trigger: "산업보건의 신규 선임 시"
  },
  {
    id: "doc:ad_hoc/honorary_safety_supervisor_appointment",
    docId: "honorary_safety_supervisor_appointment",
    title: "명예산업안전감독관 위촉장",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:23", "art:산안법시행령:32"],
    description: "산안법 §23 명예산업안전감독관 위촉. 근로자단체·사업주단체·산업재해 예방 관련 전문단체 추천. 임기 2년·갱신 가능.",
    trigger: "명예감독관 위촉·갱신 시"
  },
  // 고객 폭언등 건강장해 예방 (산안법 §41) — 비건설 (서비스업·감정노동) 도메인
  {
    id: "doc:ad_hoc/safety_health_diagnosis_report",
    docId: "safety_health_diagnosis_report",
    title: "안전보건진단 결과보고서",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:47", "art:산안법시행규칙:55"],
    description: "산안법 §47 고용노동부장관 명령에 따른 종합·안전·보건진단 결과보고서. 사업장 등급, 발견된 위험요인, 개선조치 사항.",
    trigger: "고용노동부 진단명령 후"
  },
  {
    id: "doc:monthly/construction_disaster_prevention_guidance",
    docId: "construction_disaster_prevention_guidance",
    title: "건설재해예방 지도결과서",
    cycle: "cyc:monthly",
    legalBasis: ["art:산안법:73", "art:산안법시행령:59"],
    description: "산안법 §73 1~120억 원 미만 건설공사 도급인이 산업안전보건법령에 따른 자격을 가진 자(건설재해예방전문지도기관)로부터 매월 받는 지도 결과. 위험요인·개선조치 기록.",
    trigger: "공사기간 중 매월"
  },
  {
    id: "doc:ad_hoc/safety_certification_application",
    docId: "safety_certification_application",
    title: "안전인증 신청서·결과서",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:83", "art:산안법시행규칙:74"],
    description: "산안법 §83 안전인증대상 기계·기구·방호장치·보호구 제조·수입 시 안전인증 신청. KCs 마크 부착 근거.",
    trigger: "인증대상 제품 제조·수입 시"
  },
  {
    id: "doc:ad_hoc/voluntary_safety_confirmation_filing",
    docId: "voluntary_safety_confirmation_filing",
    title: "자율안전확인 신고서",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:89", "art:산안법시행규칙:80"],
    description: "산안법 §89 자율안전확인대상 기계·기구·설비를 제조·수입한 자가 안전기준 적합 여부를 확인하여 신고. KCs(s) 마크.",
    trigger: "자율안전확인 대상 제품 제조·수입 시"
  },
  {
    id: "doc:ad_hoc/safety_inspection_application",
    docId: "safety_inspection_application",
    title: "안전검사 신청서·결과서",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:93", "art:산안법시행규칙:86"],
    description: "산안법 §93 안전검사 대상 기계·기구(프레스·전단기·크레인·리프트·압력용기 등) 사용사업주가 정기적으로 받는 검사. 합격 표시(검사필증) 부착.",
    trigger: "검사주기 도래 시 (대상별 1~3년)"
  },
  {
    id: "doc:monthly/work_environment_measurement_notification",
    docId: "work_environment_measurement_notification",
    title: "작업환경측정 결과 통지서",
    cycle: "cyc:monthly",
    legalBasis: ["art:산안법:126", "art:산안법시행규칙:188"],
    description: "산안법 §126 작업환경측정 결과를 해당 작업장 근로자에게 알리는 통지서. 측정 후 30일 이내 게시. 산업안전보건위원회·근로자대표 요구 시 직접 설명 의무.",
    trigger: "작업환경측정 후 30일 이내"
  },
  {
    id: "doc:annual/health_examination_followup",
    docId: "health_examination_followup",
    title: "건강진단 사후조치 기록 (질병자 근로금지 포함)",
    cycle: "cyc:annual",
    legalBasis: ["art:산안법:134", "art:산안법:138", "art:산안법시행규칙:220"],
    description: "산안법 §134 건강진단 결과에 따른 작업전환·근로시간 단축·작업환경 개선 등 사후조치 기록. §138 질병자 근로 금지 결정 포함.",
    trigger: "건강진단 결과 확인 후"
  },
  // 역학조사 결과보고서 (산안법 §141) — 비건설 (산업보건 일반) 도메인
  {
    id: "doc:ad_hoc/asbestos_investigation_report",
    docId: "asbestos_investigation_report",
    title: "석면조사 결과서 (일반·기관)",
    cycle: "cyc:ad_hoc",
    legalBasis: ["art:산안법:142", "art:산안법:119"],
    description: "산안법 §142 건축물·설비 철거·해체 전 석면 함유 여부 조사. 일반석면조사 + 기관석면조사(50㎡ 이상). 석면지도 작성·해체작업계획 첨부.",
    trigger: "건축물·설비 철거·해체 착수 전"
  }
];

(async () => {
  // 1. IRI 정정
  const fixedCount = await walkAndFix(NODES);
  console.log(`✅ IRI 정정: ${fixedCount} 파일`);

  // 2. 누락 의무문서 stub 생성
  let docsCreated = 0;
  for (const d of DOC_STUBS) {
    const fname = d.docId.replace(/_/g, "-") + ".jsonld";
    const path = resolve(DOCS, fname);
    const obj = {
      "@context": "../../context.jsonld",
      "@id": d.id,
      "@type": ["Document", "DigitalDocument"],
      docId: d.docId,
      title: d.title,
      description: d.description,
      cycle: d.cycle,
      ...(d.trigger && { trigger: d.trigger }),
      legalBasis: d.legalBasis,
      verificationStatus: "stub",
      _meta: {
        publishedBy: "라텔웍스 + 황룡건설(주)",
        fetchedAt: FETCHED,
        licenseHint: "저작권법 §7 비보호 (자유 인용)",
        note: "Coverage closure stub (Phase 2.5). 14종 법정문서 외 보조 의무문서. requiredFields/verifications 본문은 Phase 3."
      }
    };
    await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
    docsCreated++;
  }
  console.log(`✅ 의무문서 stub: ${docsCreated} 생성`);
})();
