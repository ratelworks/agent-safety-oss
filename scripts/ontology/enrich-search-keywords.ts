#!/usr/bin/env tsx
/**
 * enrich-search-keywords.ts
 *
 * 1. 활동 노드 description 보강 (사용자 키워드 추가)
 * 2. 의무문서 노드 searchKeywords 필드 추가
 * 3. 산안법 핵심 조문 cross-link 강화 (penalizedBy)
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ACTIVITIES = resolve(ROOT, "src", "ontology", "graph", "nodes", "activities");
const DOCS = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");
const ARTICLES = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");

// ─── 활동 description 보강용 키워드 ───
const ACTIVITY_KEYWORDS: Record<string, string[]> = {
  "safety_education": [
    "안전보건교육", "교육시간", "교육내용", "정기교육", "신규교육", "특별교육",
    "관리감독자교육", "직무교육", "보수교육", "건설업 기초안전보건교육",
    "4시간", "6시간", "분기 정기교육", "TBM", "조회",
  ],
  "tbm_daily": [
    "TBM", "Tool Box Meeting", "도구상자 회의", "작업 전 안전점검회의",
    "조회", "일일조회", "매일 작업 전", "일일점검",
  ],
  "risk_assessment_general": [
    "위험성평가", "유해위험요인", "리스크 평가", "Risk Assessment", "RA",
    "최초평가", "정기평가", "수시평가", "상시평가",
    "분기 정기 위험성평가", "분기별 위험성평가",
    "KRAS", "OPS", "체크리스트", "3단계 판단법", "빈도 강도법", "Bow-Tie",
    "절차", "사전준비", "유해위험요인 파악", "위험성 결정", "감소대책", "기록 보존 3년",
  ],
  "chemical_facility": [
    "화학물질", "MSDS", "물질안전보건자료", "유해물질",
    "도료", "페인트", "시너", "용제", "신너", "에폭시", "우레탄",
    "신규 도료 반입", "신규 화학물질", "반입", "게시", "등록",
    "위험물", "인화성", "유기용제",
  ],
  "scaffolding_assembly": [
    "비계", "강관비계", "시스템비계", "달비계", "이동식비계",
    "강관비계 설치", "비계 설치", "비계 점검", "안전난간", "작업발판",
    "고소작업", "추락방지", "벽이음",
  ],
  "asbestos_removal": [
    "석면", "석면해체", "석면조사", "발암물질", "기관석면조사", "석면지도",
  ],
  "demolition": ["해체", "철거", "구조물 해체", "건축물 해체"],
  "rc_concrete": ["철근콘크리트", "RC", "콘크리트 타설", "양생", "압축강도"],
  "tower_crane": ["타워크레인", "TC", "타워크레인 일일점검", "양중", "인양"],
  "vehicle_construction": ["굴삭기", "로더", "덤프트럭", "롤러", "차량계 건설기계"],
};

// ─── 의무문서 searchKeywords ───
const DOC_SEARCH_KEYWORDS: Record<string, string[]> = {
  "industrial_accident_report": [
    "산업재해 조사표", "별지 30호서식", "산재 보고", "사고 보고", "사고 신고",
    "추락사고", "사망사고", "중대재해 발생", "재해 발생", "조사보고",
  ],
  "severe_accident_immediate_report": [
    "중대재해 즉시 보고", "24시간 이내 보고", "사망사고 보고", "치명상 보고",
    "중대재해 발생 즉시", "고용노동부 보고",
  ],
  "monthly_education_log": [
    "정기 안전보건교육", "분기 정기교육", "월간 교육 일지", "분기 교육 일지",
    "안전보건교육 기록", "교육 일지", "교육 결과",
  ],
  "supervisor_education_log": [
    "관리감독자 교육", "관리감독자 직무교육", "관리감독자 보수교육",
  ],
  "msds_register": [
    "MSDS 등록부", "물질안전보건자료", "화학물질 관리대장", "MSDS 게시",
    "신규 도료 반입", "신규 화학물질", "MSDS 교육", "유해물질 등록",
  ],
  "basic_safety_health_register": [
    "기본안전보건대장", "안전보건대장 3종", "발주자 의무", "50억 이상 건설",
    "기본 단계", "사업개요",
  ],
  "design_safety_health_register": [
    "설계안전보건대장", "안전보건대장 3종", "설계 단계", "발주자 의무",
  ],
  "construction_safety_health_register": [
    "공사안전보건대장", "안전보건대장 3종", "공사 단계", "발주자 의무",
  ],
  "safety_health_mgmt_cost_plan": [
    "산업안전보건관리비", "안전관리비", "사용계획서", "사용내역", "안전관리비 계상",
    "건설공사 안전관리비",
  ],
  "hazardous_risk_prevention_plan_construction": [
    "유해위험방지계획서", "건설공사", "착공 30일 전", "심사 신청",
    "지상 31m 이상", "연면적 3만㎡ 이상",
  ],
  "construction_disaster_prevention_guidance": [
    "건설재해예방 지도결과서", "건설재해예방 지도", "전문지도기관",
    "1억-120억 건설공사", "매월 1회 이상",
  ],
  "safety_health_management_policy": [
    "안전보건경영방침", "중처법", "안전보건관리체계", "9대 의무", "경영책임자",
  ],
  "severe_accident_compliance": [
    "중대재해처벌법", "중처법 안전보건관리체계", "중처법 §6", "중처법 §7",
    "안전보건 9대 의무 이행 점검", "반기 점검",
  ],
  "ad_hoc_risk_assessment": ["수시 위험성평가", "ad-hoc"],
  "initial_risk_assessment": ["최초 위험성평가", "신규 사업장"],
  "monthly_risk_assessment": ["월간 위험성평가", "수시"],
  "regular_risk_assessment": ["정기 위험성평가", "연간 위험성평가", "분기 정기 위험성평가"],
  "daily_tbm": ["TBM", "Tool Box Meeting", "조회", "일일점검", "작업 전 안전점검회의"],
  "weekly_joint_inspection": ["합동안전보건점검", "주간 점검", "합동점검"],
  "work_permit": ["작업허가서", "허가서"],
  "work_plan": ["작업계획서", "별표 4", "13종 작업계획서"],
  "scaffolding_inspection_checklist": ["비계 점검표", "비계 안전점검"],
  "fall_prevention_net_inspection": ["추락방지망 점검", "안전방망 점검"],
  "safety_harness_inspection": ["안전대 점검", "Full Body Harness", "Lanyard"],
  "tower_crane_inspection": ["타워크레인 일일점검", "TC 점검"],
  "construction_machinery_inspection": ["건설기계 일일점검", "굴삭기 점검", "차량계 점검"],
  "ppe_register": ["보호구 지급대장", "안전모 지급", "안전화 지급", "보호구 관리"],
  "health_safety_committee": ["산업안전보건위원회 회의록", "산안위 회의록", "노사 협의"],
  "safety_health_manager_appointment": ["안전관리자 선임", "보건관리자 선임", "안전보건관리책임자 선임"],
  "asbestos_investigation_report": ["석면조사 결과서", "기관석면조사", "일반석면조사"],
};

// ─── 산안법 핵심 cross-link (수동 매핑) ───
const PENALTY_LINKS: Array<{ article: string; penalty: string; severity?: string }> = [
  { article: "art:산안법:38",   penalty: "art:산안법:167", severity: "사망 결과" },
  { article: "art:산안법:38",   penalty: "art:산안법:168", severity: "기본" },
  { article: "art:산안법:39",   penalty: "art:산안법:167", severity: "사망 결과" },
  { article: "art:산안법:39",   penalty: "art:산안법:168", severity: "기본" },
  { article: "art:산안법:42",   penalty: "art:산안법:169", severity: "유해위험방지계획서" },
  { article: "art:산안법:54",   penalty: "art:산안법:170", severity: "보고 위반" },
  { article: "art:산안법:57",   penalty: "art:산안법:170의2", severity: "보고 위반" },
  { article: "art:산안법:57",   penalty: "art:산안법:171", severity: "조사표 위반" },
  { article: "art:산안법:51",   penalty: "art:산안법:168", severity: "작업중지 위반" },
  { article: "art:산안법:110",  penalty: "art:산안법:175", severity: "MSDS 작성 위반" },
  { article: "art:산안법:114",  penalty: "art:산안법:175", severity: "MSDS 게시 위반" },
  { article: "art:산안법:115",  penalty: "art:산안법:175", severity: "MSDS 교육 위반" },
  { article: "art:산안법:117",  penalty: "art:산안법:168", severity: "유해작업 도급 위반" },
  { article: "art:산안법:118",  penalty: "art:산안법:168", severity: "유해작업 도급 위반" },
  { article: "art:산안법:122",  penalty: "art:산안법:168", severity: "석면 해체 위반" },
  { article: "art:산안법:36",   penalty: "art:산안법:170의2", severity: "위험성평가 미실시" },
  { article: "art:산안법:24",   penalty: "art:산안법:175", severity: "산안위 미운영" },
  { article: "art:산안법:25",   penalty: "art:산안법:175", severity: "안전보건관리규정 미작성" },
  { article: "art:산안법:29",   penalty: "art:산안법:175", severity: "안전보건교육 미이행" },
  { article: "art:산안법:67",   penalty: "art:산안법:175", severity: "안전보건대장 미이행" },
  { article: "art:산안법:72",   penalty: "art:산안법:175", severity: "산업안전보건관리비 미계상" },
  { article: "art:산안법:125",  penalty: "art:산안법:175", severity: "작업환경측정 미실시" },
  { article: "art:산안법:129",  penalty: "art:산안법:175", severity: "건강진단 미실시" },
  { article: "art:산안법:130",  penalty: "art:산안법:175", severity: "특수건강진단 미실시" },
  // 중처법
  { article: "art:중처법:4",    penalty: "art:중처법:6",   severity: "중대산업재해" },
  { article: "art:중처법:4",    penalty: "art:중처법:7",   severity: "양벌규정" },
];

function addToArrayUnique(node: Record<string, unknown>, key: string, values: string[]) {
  const cur = (node[key] as string[] | undefined) ?? [];
  const set = new Set([...cur, ...values]);
  if (set.size > cur.length) node[key] = [...set];
}

(async () => {
  // 1. 활동 description 키워드 보강
  let actUpdated = 0;
  for (const f of await readdir(ACTIVITIES)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ACTIVITIES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const id = node["@id"] as string;
    const slug = id.split(":")[1];
    const keywords = ACTIVITY_KEYWORDS[slug];
    if (!keywords) continue;

    const cur = String(node.description ?? "");
    // 키워드 중 description에 없는 것만 추가
    const missing = keywords.filter(k => !cur.includes(k));
    if (missing.length === 0) continue;
    node.description = `${cur}\n\n**관련 키워드**: ${missing.join(", ")}.`;
    node.searchKeywords = keywords;
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    actUpdated++;
  }
  console.log(`[activity] description 키워드 보강: ${actUpdated}`);

  // 2. doc searchKeywords 필드 추가
  let docUpdated = 0;
  for (const f of await readdir(DOCS)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOCS, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const docId = String(node.docId ?? "");
    const keywords = DOC_SEARCH_KEYWORDS[docId];
    if (!keywords) continue;
    node.searchKeywords = keywords;
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    docUpdated++;
  }
  console.log(`[doc] searchKeywords 추가: ${docUpdated}`);

  // 3. 산안법 cross-link (penalizedBy 강화)
  let penaltyUpdated = 0;
  const articleIndex = new Map<string, { path: string; node: Record<string, unknown> }>();
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ARTICLES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    if (node["@id"]) articleIndex.set(node["@id"] as string, { path, node });
  }
  for (const link of PENALTY_LINKS) {
    const entry = articleIndex.get(link.article);
    if (!entry) continue;
    addToArrayUnique(entry.node, "penalizedBy", [link.penalty]);
    // severity 메타 (article._meta.penaltyMap)
    const meta = (entry.node._meta as Record<string, unknown>) ?? {};
    const penMap = (meta.penaltyMap as Record<string, string> | undefined) ?? {};
    penMap[link.penalty] = link.severity ?? "";
    meta.penaltyMap = penMap;
    entry.node._meta = meta;
  }
  for (const { path, node } of articleIndex.values()) {
    if (node._meta && (node._meta as Record<string, unknown>).penaltyMap) {
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      penaltyUpdated++;
    }
  }
  console.log(`[penalty] cross-link 추가: ${penaltyUpdated} article`);
})();
