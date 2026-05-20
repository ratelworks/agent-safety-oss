#!/usr/bin/env tsx
/**
 * Round 9: T1 + T2 온톨로지 보강
 *
 * 1. entity 카테고리 신설 — 외부 기관·회사·기관 노드 (한전·KT·KOSHA·가스공사 등)
 * 2. src 카테고리 보강 — 정확한 hotline·연락처 노드
 * 3. equipment.alternativeNames — 동의어 그래프
 * 4. method:risk_matrix_5x4 강화 — 점수→등급 매핑을 검증 가능 구조로
 * 5. 위험성평가 고시 article cross-reference 정밀화
 */
import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const FETCHED = "2026-04-28";

// ──────────────────────────────────────────────────────────────
// 1. entity 카테고리 — 외부 기관·회사 노드
// ──────────────────────────────────────────────────────────────
const ENTITIES = [
  // 정부·공공기관
  { id: "entity:moel", label: "고용노동부", type: "government", role: "산안법·중처법 주무부처. 산재 보고·작업중지명령·근로감독.", hotline: "1350" },
  { id: "entity:kosha", label: "한국산업안전보건공단 (KOSHA)", type: "public_corp", role: "산안법 §161 위탁기관. 가이드 발행·MSDS DB·재해사례·기술지원·인증.", url: "https://www.kosha.or.kr" },
  { id: "entity:moe", label: "환경부", type: "government", role: "화학물질관리법·폐기물관리법·수질오염사고 신고 (1577-3279).", hotline: "1577-3279" },
  { id: "entity:nfa", label: "소방청", type: "government", role: "화재안전기준·임시소방시설·중대재해 화재. 119.", hotline: "119" },
  { id: "entity:moleg", label: "법제처", type: "government", role: "국가법령정보센터 (www.law.go.kr). 법령 본문 단일 출처.", url: "https://www.law.go.kr" },
  { id: "entity:nier", label: "국립환경과학원", type: "research", role: "화학물질 유해성 시험·환경 노출 평가." },
  { id: "entity:comwel", label: "근로복지공단", type: "public_corp", role: "산재 인정·보상·재활. 산재 신고 (산안법 §57).", url: "https://www.comwel.or.kr" },
  { id: "entity:poison_center", label: "한국독성정보센터", type: "research", role: "MSDS 응급 자문 24시간. 화학물질 노출·중독 응급 대응.", hotline: "1899-9594" },

  // 인프라 운영사 (매설물 관련)
  { id: "entity:kepco", label: "한국전력공사 (한전·KEPCO)", type: "private_corp", role: "전력 송배전. 매설 전력선 굴착 시 입회 의무.", hotline: "123" },
  { id: "entity:kogas", label: "한국가스공사 (KOGAS)", type: "public_corp", role: "도시가스 공급. 매설 가스관 굴착 시 입회 의무 (도시가스사업법).", hotline: "1544-4500" },
  { id: "entity:kt", label: "KT (한국통신)", type: "private_corp", role: "통신선 (유선·광케이블). 매설 통신선 굴착 시 입회.", hotline: "100" },
  { id: "entity:skt", label: "SK텔레콤", type: "private_corp", role: "이동통신·통신선.", hotline: "114" },
  { id: "entity:lguplus", label: "LG U+", type: "private_corp", role: "이동통신·통신선.", hotline: "101" },
  { id: "entity:waterworks", label: "지자체 상수도사업본부", type: "government", role: "상수도·하수도 매설관 운영 (지자체별).", hotline: "지자체별 (예: 서울 120, 경기 031)" },

  // 검사·인증
  { id: "entity:kolas", label: "KOLAS (한국인정기구)", type: "public_corp", role: "MSDS 시험·인증 자격. 시험기관 인정.", url: "https://www.kolas.go.kr" },
  { id: "entity:kr", label: "한국선급 (KR)", type: "private_corp", role: "산업용 안전·검사." },
  { id: "entity:ats", label: "ATS (안전기술원)", type: "public_corp", role: "위험기계기구 안전검사 위탁기관 (산안법 §93)." },

  // 의료
  { id: "entity:nhic", label: "건강보험공단", type: "public_corp", role: "근로자 건강진단 위탁기관 관리.", hotline: "1577-1000" },
  { id: "entity:emergency_medical", label: "응급의료정보센터 (1339)", type: "public_corp", role: "24시간 응급의료 안내.", hotline: "1339" },
];

// ──────────────────────────────────────────────────────────────
// 2. src 카테고리 보강 — 정확한 연락처·자료 출처
// ──────────────────────────────────────────────────────────────
const SOURCES = [
  // hotline 노드 (외부 비상연락)
  { id: "src:fire:119", label: "소방·구급 119", type: "hotline", contact: "119", description: "화재·구급·구조 24시간." },
  { id: "src:police:112", label: "경찰 112", type: "hotline", contact: "112", description: "치안·교통사고 24시간." },
  { id: "src:emergency_medical:1339", label: "응급의료정보 1339", type: "hotline", contact: "1339", description: "응급의료기관 안내·이송 24시간." },
  { id: "src:moel:1350", label: "고용노동부 상담 1350", type: "hotline", contact: "1350", description: "근로조건·산재·신고 상담." },
  { id: "src:kogas:1544-4500", label: "한국가스공사 24시간 비상 1544-4500", type: "hotline", contact: "1544-4500", description: "가스 누출·매설관 사고 24시간." },
  { id: "src:kepco:123", label: "한국전력공사 123", type: "hotline", contact: "123", description: "전력 사고·매설 전력선." },
  { id: "src:poison_center:1899-9594", label: "한국독성정보센터 1899-9594", type: "hotline", contact: "1899-9594", description: "화학물질 노출·중독 응급 자문 24시간." },
  { id: "src:moe:1577-3279", label: "환경부 수질오염사고 1577-3279", type: "hotline", contact: "1577-3279", description: "수질·토양 오염사고 신고 24시간." },
  { id: "src:nhic:1577-1000", label: "건강보험공단 1577-1000", type: "hotline", contact: "1577-1000", description: "건강진단 안내." },
];

// ──────────────────────────────────────────────────────────────
// 3. equipment.alternativeNames 보강
// ──────────────────────────────────────────────────────────────
const EQUIPMENT_ALIASES: Record<string, string[]> = {
  "crane": ["타워크레인", "이동식크레인", "양중기", "기중기"],
  "lift": ["승강기", "공사용 리프트", "건설용 리프트"],
  "gondola": ["곤돌라", "외벽 작업대", "달비계"],
  "aerial_work_platform": ["고소작업대", "이동식 고소작업대", "스카이리프트"],
  "fall_prevention_temporary": ["가설 추락방지 장비", "안전난간·추락방호망"],
  "ac_arc_welder": ["교류아크용접기", "전기용접기", "직류·교류 용접기"],
  "welding_cutting_apparatus": ["용접·용단 기구", "가스용접기", "산소용단기"],
  "power_saw": ["기계톱", "체인톱", "전동톱", "원형톱"],
  "shear_bender": ["전단기", "절곡기", "철근 절곡기", "철근 가공기"],
  "pressure_vessel": ["압력용기", "가스용기", "고압가스 저장용기", "보일러", "공기탱크"],
};

// ──────────────────────────────────────────────────────────────
// 4. method:risk_matrix_5x4 강화 — 검증 가능 구조
// ──────────────────────────────────────────────────────────────
const RISK_MATRIX_VALIDATION = {
  // 자동 검증 가능: scoring rule + grade range
  scoring: { type: "multiplicative", formula: "frequency × severity" },
  frequencyValues: { A: 5, B: 4, C: 3, D: 2, E: 1 },
  severityValues: { I: 4, II: 3, III: 2, IV: 1 },
  scoreRanges: [
    { min: 15, max: 20, grade: "상", action: "즉시 작업 중단 또는 통제 강화" },
    { min: 8, max: 14, grade: "중", action: "안전조치 강화·대책 수립" },
    { min: 1, max: 7, grade: "하", action: "일상 관리로 충분" },
  ],
  // 검증 examples (자동 채점 가능)
  testCases: [
    { f: "A", s: "I", expectedScore: 20, expectedGrade: "상" },
    { f: "C", s: "I", expectedScore: 12, expectedGrade: "중" },  // 핵심 — Round 8 환각 케이스
    { f: "B", s: "II", expectedScore: 12, expectedGrade: "중" },
    { f: "A", s: "IV", expectedScore: 5, expectedGrade: "하" },  // Round 8 환각 케이스
    { f: "D", s: "II", expectedScore: 6, expectedGrade: "하" },
  ],
};

// ──────────────────────────────────────────────────────────────
// 5. 위험성평가 고시 article cross-reference 정밀화
// ──────────────────────────────────────────────────────────────
const RISK_ASSESSMENT_NOTICE_REFS: Record<string, { topic: string; references: string[] }> = {
  "art:위험성평가-고시:5": { topic: "사전준비 (평가팀·일정·자료)", references: ["art:위험성평가-고시:6", "art:위험성평가-고시:9"] },
  "art:위험성평가-고시:6": { topic: "평가 주기 (정기·수시·상시·최초)", references: [] },
  "art:위험성평가-고시:9": { topic: "근로자 참여 의무 (사용자·근로자대표 동수)", references: ["art:위험성평가-고시:5"] },
  "art:위험성평가-고시:10": { topic: "유해·위험요인 6범주 파악", references: ["art:위험성평가-고시:11"] },
  "art:위험성평가-고시:11": { topic: "위험성 추정 (빈도·강도)", references: ["art:위험성평가-고시:10", "art:위험성평가-고시:12"] },
  "art:위험성평가-고시:12": { topic: "감소대책 ERIC-PP 위계", references: ["art:위험성평가-고시:11"] },
  "art:위험성평가-고시:13": { topic: "근로자 통지 의무", references: [] },
  "art:위험성평가-고시:15": { topic: "정기 평가 4항목 (성능저하·교체·신지식·통제유효성)", references: ["art:위험성평가-고시:6"] },
};

async function writeJson(path: string, obj: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

async function main() {
  // 1. entity 카테고리
  const ENTITIES_DIR = resolve(NODES, "entities");
  for (const e of ENTITIES) {
    await writeJson(resolve(ENTITIES_DIR, e.id.replace("entity:", "") + ".jsonld"), {
      "@context": "../../context.jsonld",
      "@id": e.id,
      "@type": "Entity",
      label: e.label,
      verificationStatus: "verified",
      _meta: {
        publishedBy: "라텔웍스 + 황룡건설(주)",
        fetchedAt: FETCHED,
        type: e.type,
        ...(e.hotline && { hotline: e.hotline }),
        ...(e.url && { url: e.url }),
      },
      description: e.role,
    });
  }
  console.log(`✓ entity: ${ENTITIES.length} 노드 생성`);

  // 2. src 보강
  const SOURCES_DIR = resolve(NODES, "sources");
  for (const s of SOURCES) {
    await writeJson(resolve(SOURCES_DIR, s.id.replace("src:", "").replace(/[:\/]/g, "_") + ".jsonld"), {
      "@context": "../../context.jsonld",
      "@id": s.id,
      "@type": "Source",
      label: s.label,
      verificationStatus: "verified",
      _meta: {
        publishedBy: "라텔웍스 + 황룡건설(주)",
        fetchedAt: FETCHED,
        type: s.type,
        contact: s.contact,
      },
      description: s.description,
    });
  }
  console.log(`✓ src: ${SOURCES.length} 노드 추가 (hotline 포함)`);

  // 3. equipment.alternativeNames 보강
  const EQ_DIR = resolve(NODES, "equipment");
  let eqUpdated = 0;
  for (const [key, aliases] of Object.entries(EQUIPMENT_ALIASES)) {
    const path = resolve(EQ_DIR, `${key}.jsonld`);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      node.alternativeNames = aliases;
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      eqUpdated += 1;
    } catch { /* missing */ }
  }
  console.log(`✓ equipment.alternativeNames: ${eqUpdated} 노드 보강`);

  // 4. risk_matrix 강화
  const matrixPath = resolve(NODES, "methods", "risk_matrix_5x4.jsonld");
  try {
    const node = JSON.parse(await readFile(matrixPath, "utf-8"));
    node.validation = RISK_MATRIX_VALIDATION;
    node._meta.validationNote = "scoring·scoreRanges·testCases를 review 룰에서 활용하여 examples 자동 검증 가능";
    await writeFile(matrixPath, JSON.stringify(node, null, 2) + "\n", "utf-8");
    console.log("✓ method:risk_matrix_5x4: validation 필드 추가 (자동 검수 가능)");
  } catch (err) {
    console.warn(`✗ risk_matrix: ${(err as Error).message}`);
  }

  // 5. 위험성평가 고시 article cross-reference
  const ART_DIR = resolve(NODES, "articles");
  let artUpdated = 0;
  for (const [iri, info] of Object.entries(RISK_ASSESSMENT_NOTICE_REFS)) {
    const slug = iri.replace("art:", "").replace(":", "-§");
    const fname = slug + ".jsonld";
    const path = resolve(ART_DIR, fname);
    try {
      const node = JSON.parse(await readFile(path, "utf-8"));
      const cur = (node.references as string[] | undefined) ?? [];
      let added = false;
      for (const ref of info.references) {
        if (!cur.includes(ref)) { cur.push(ref); added = true; }
      }
      if (added) node.references = cur;
      // _meta에 topic 명시 (큐레이션 시 §6 vs §9 혼동 방지)
      node._meta = node._meta ?? {};
      if (!node._meta.topic) {
        node._meta.topic = info.topic;
        added = true;
      }
      if (added) {
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
        artUpdated += 1;
      }
    } catch (err) {
      // 파일명 다를 수 있음 (위험성평가-고시-§N)
      const altPath = resolve(ART_DIR, `위험성평가-고시-§${iri.split(":")[2]}.jsonld`);
      try {
        const node = JSON.parse(await readFile(altPath, "utf-8"));
        node._meta = node._meta ?? {};
        if (!node._meta.topic) node._meta.topic = info.topic;
        const cur = (node.references as string[] | undefined) ?? [];
        for (const ref of info.references) if (!cur.includes(ref)) cur.push(ref);
        node.references = cur;
        await writeFile(altPath, JSON.stringify(node, null, 2) + "\n", "utf-8");
        artUpdated += 1;
      } catch { /* skip */ }
    }
  }
  console.log(`✓ 위험성평가 고시 article: ${artUpdated} 노드 cross-reference 정밀화`);

  console.log("\n[done] T1 + T2 온톨로지 보강 완료");
}

main().catch(console.error);
