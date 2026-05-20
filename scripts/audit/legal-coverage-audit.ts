#!/usr/bin/env tsx
/**
 * legal-coverage-audit.ts (실무 cover 감사)
 *
 * 한국 안전관리 법령상 *작성·보존·게시·통지·신고 의무*가 있는 모든 조문을
 * 본 OSS 49 Document와 매핑 → 누락 식별.
 *
 * 출력: 카테고리별 cover / 누락 / 부분 cover 표
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

// ─── 한국 안전관리 법령 작성 의무 조문 (정밀 추출) ───
interface ObligationCheck {
  iri: string;
  description: string;
  category: string;
  priority: "high" | "medium" | "low"; // 실무 빈도 + 처벌 무게
}

const OBLIGATIONS: ObligationCheck[] = [
  // 산안법 작성 의무 (정밀)
  { iri: "art:산안법:11", description: "안전보건정보 제공 (도급 시)", category: "도급·발주", priority: "medium" },
  { iri: "art:산안법:15", description: "안전보건관리책임자 선임", category: "선임", priority: "high" },
  { iri: "art:산안법:17", description: "안전관리자 선임 신고", category: "선임", priority: "high" },
  { iri: "art:산안법:18", description: "보건관리자 선임 신고", category: "선임", priority: "high" },
  { iri: "art:산안법:19", description: "안전보건관리담당자 선임", category: "선임", priority: "medium" },
  { iri: "art:산안법:22", description: "산업보건의 선임", category: "선임", priority: "low" },
  { iri: "art:산안법:23", description: "명예산업안전감독관 위촉", category: "선임", priority: "low" },
  { iri: "art:산안법:24", description: "산업안전보건위원회 회의록", category: "회의·점검", priority: "high" },
  { iri: "art:산안법:25", description: "안전보건관리규정", category: "규정·계획", priority: "high" },
  { iri: "art:산안법:29", description: "안전보건교육 일지 (정기·신규·특별·관리감독자)", category: "교육·훈련", priority: "high" },
  { iri: "art:산안법:32", description: "관리감독자 직무·교육 일지", category: "교육·훈련", priority: "medium" },
  { iri: "art:산안법:34", description: "법령 요지 게시·교육 기록", category: "게시·통지", priority: "medium" },
  { iri: "art:산안법:36", description: "위험성평가서 (4종)", category: "평가·계획", priority: "high" },
  { iri: "art:산안법:37", description: "안전보건표지 부착·관리 기록", category: "게시·통지", priority: "medium" },
  { iri: "art:산안법:41", description: "폭언 등 건강장해 예방계획", category: "보건", priority: "low" },
  { iri: "art:산안법:42", description: "유해위험방지계획서 (3종)", category: "규정·계획", priority: "high" },
  { iri: "art:산안법:44", description: "공정안전보고서 (PSM)", category: "규정·계획", priority: "high" },
  { iri: "art:산안법:47", description: "안전보건진단 결과", category: "진단", priority: "low" },
  { iri: "art:산안법:54", description: "중대재해 발생 즉시 보고", category: "사고·재해", priority: "high" },
  { iri: "art:산안법:57", description: "산업재해 조사표 (별지 30호서식)", category: "사고·재해", priority: "high" },
  { iri: "art:산안법:63", description: "도급사업주 안전보건협의체", category: "도급·발주", priority: "high" },
  { iri: "art:산안법:64", description: "합동안전보건점검 기록", category: "회의·점검", priority: "high" },
  { iri: "art:산안법:67", description: "안전보건대장 3종 (발주자)", category: "발주자", priority: "high" },
  { iri: "art:산안법:72", description: "산업안전보건관리비 사용계획서", category: "관리비·비용", priority: "high" },
  { iri: "art:산안법:73", description: "건설재해예방 지도결과", category: "도급·발주", priority: "medium" },
  { iri: "art:산안법:75", description: "안전보건협의체 (대규모 도급)", category: "도급·발주", priority: "medium" },
  { iri: "art:산안법:83", description: "안전인증 신청서·결과", category: "인증·검사", priority: "medium" },
  { iri: "art:산안법:89", description: "자율안전확인 신고서", category: "인증·검사", priority: "medium" },
  { iri: "art:산안법:93", description: "안전검사 신청서·결과", category: "인증·검사", priority: "medium" },
  { iri: "art:산안법:110", description: "MSDS 등록부", category: "화학물질", priority: "high" },
  { iri: "art:산안법:114", description: "MSDS 게시 기록", category: "화학물질", priority: "high" },
  { iri: "art:산안법:115", description: "MSDS 교육 기록", category: "화학물질", priority: "high" },
  { iri: "art:산안법:125", description: "작업환경측정 결과 보고서", category: "측정·보건", priority: "high" },
  { iri: "art:산안법:126", description: "작업환경측정 결과 통지", category: "측정·보건", priority: "medium" },
  { iri: "art:산안법:129", description: "일반건강진단 결과", category: "측정·보건", priority: "high" },
  { iri: "art:산안법:130", description: "특수건강진단 결과", category: "측정·보건", priority: "high" },
  { iri: "art:산안법:131", description: "임시건강진단 결과", category: "측정·보건", priority: "medium" },
  { iri: "art:산안법:134", description: "질병자 근로 금지 기록", category: "보건", priority: "low" },
  { iri: "art:산안법:141", description: "역학조사", category: "보건", priority: "low" },
  { iri: "art:산안법:142", description: "석면조사 결과서", category: "화학물질", priority: "medium" },

  // 산안기준규칙 (별표 4 + 작업허가 + 보호구 + 점검)
  { iri: "art:기준규칙:32", description: "보호구 지급·관리 기록", category: "보호구", priority: "high" },
  { iri: "art:기준규칙:35", description: "작업장 사전 점검표", category: "회의·점검", priority: "high" },
  { iri: "art:기준규칙:38", description: "작업계획서 13종 (별표 4)", category: "작업계획서", priority: "high" },
  { iri: "art:기준규칙:239", description: "화기작업 허가서", category: "작업허가서", priority: "high" },
  { iri: "art:기준규칙:319", description: "정전작업 허가서 (LOTO)", category: "작업허가서", priority: "high" },
  { iri: "art:기준규칙:619", description: "밀폐공간 작업허가서", category: "작업허가서", priority: "high" },

  // 중처법 + 시행령
  { iri: "art:중처법:4", description: "안전보건관리체계 구축·이행", category: "중처법", priority: "high" },
  { iri: "art:중처법시행령:4", description: "안전보건경영방침", category: "중처법", priority: "high" },
  { iri: "art:중처법시행령:5", description: "9대 의무 이행 점검", category: "중처법", priority: "high" },

  // 위험성평가 고시
  { iri: "art:위험성평가-고시:6", description: "근로자 참여 + 실시규정", category: "평가·계획", priority: "high" },
  { iri: "art:위험성평가-고시:14", description: "기록 보존 (3년)", category: "평가·계획", priority: "medium" },
  { iri: "art:위험성평가-고시:15", description: "실시 시기 (최초·정기·수시·상시)", category: "평가·계획", priority: "high" },

  // ─── 건설안전 특화 의무 (Phase 3 확장) ───
  // 비계·고소·추락
  { iri: "art:기준규칙:13", description: "안전난간 (90cm + 중간대 + 발끝막이)", category: "비계·추락", priority: "high" },
  { iri: "art:기준규칙:55", description: "비계 작업발판 최대적재하중", category: "비계·추락", priority: "high" },
  { iri: "art:기준규칙:56", description: "작업발판 구조 (40cm·틈 3cm)", category: "비계·추락", priority: "high" },
  { iri: "art:기준규칙:57", description: "비계 조립·해체·변경", category: "비계·추락", priority: "high" },
  { iri: "art:기준규칙:58", description: "비계 점검·보수", category: "비계·추락", priority: "high" },
  { iri: "art:기준규칙:72", description: "시스템비계 구조", category: "비계·추락", priority: "high" },
  { iri: "art:기준규칙:73", description: "시스템비계 조립", category: "비계·추락", priority: "high" },
  // 거푸집동바리
  { iri: "art:기준규칙:338", description: "거푸집 해체 (강도시험 후)", category: "거푸집동바리", priority: "high" },
  { iri: "art:기준규칙:339", description: "거푸집동바리 해체 강도", category: "거푸집동바리", priority: "high" },
  // 차량계 건설기계
  { iri: "art:기준규칙:78", description: "차량계 건설기계 정의", category: "건설기계", priority: "high" },
  { iri: "art:기준규칙:79", description: "차량계 건설기계 전조등", category: "건설기계", priority: "medium" },
  { iri: "art:기준규칙:86", description: "운전자 자격·탑승 제한", category: "건설기계", priority: "high" },
  { iri: "art:기준규칙:98", description: "제한속도 지정", category: "건설기계", priority: "medium" },
  { iri: "art:기준규칙:99", description: "운전위치 이탈 시 조치", category: "건설기계", priority: "high" },
  // 양중기
  { iri: "art:기준규칙:134", description: "양중기 방호장치 (권과·과부하·비상정지)", category: "양중기", priority: "high" },
  { iri: "art:기준규칙:135", description: "정격하중 등 표시", category: "양중기", priority: "high" },
  // 신호·통제
  { iri: "art:기준규칙:40", description: "신호수 (양중기·건설기계)", category: "신호·통제", priority: "high" },
  { iri: "art:기준규칙:47", description: "출입 금지 (작업반경)", category: "신호·통제", priority: "high" },
  // 굴착·터널·발파
  { iri: "art:기준규칙:347", description: "굴착작업 점검 (부석·용수·진동)", category: "굴착·터널", priority: "high" },
  { iri: "art:기준규칙:348", description: "발파작업 화약 취급", category: "굴착·터널", priority: "high" },
  { iri: "art:기준규칙:351", description: "낙반 방지 (터널 지보공)", category: "굴착·터널", priority: "high" },
  { iri: "art:기준규칙:352", description: "터널 출입구 붕괴 방지", category: "굴착·터널", priority: "high" },
  // 화기·전기
  { iri: "art:기준규칙:232", description: "용접·용단 화재 위험방지", category: "화기·전기", priority: "high" },
  { iri: "art:기준규칙:306", description: "교류아크용접기 전격방지기", category: "화기·전기", priority: "high" },
  { iri: "art:기준규칙:318", description: "전기작업자 자격 제한", category: "화기·전기", priority: "high" },
  // 보호구
  { iri: "art:기준규칙:31", description: "보호구 제한적 사용 (ERIC-PP)", category: "보호구", priority: "medium" },
  { iri: "art:기준규칙:34", description: "전용 보호구", category: "보호구", priority: "medium" },
  // 가설구조물·통로
  { iri: "art:기준규칙:21", description: "통로 설치", category: "가설·통로", priority: "medium" },
  { iri: "art:기준규칙:23", description: "가설통로 구조 (경사·미끄럼·계단참)", category: "가설·통로", priority: "high" },
  { iri: "art:기준규칙:428", description: "비상문·비상통로", category: "가설·통로", priority: "high" },
  { iri: "art:기준규칙:49", description: "조명 (작업종류별 럭스)", category: "가설·통로", priority: "medium" },
  { iri: "art:기준규칙:50", description: "통로 조명 (75럭스)", category: "가설·통로", priority: "medium" },
  // 항타기·항발기
  { iri: "art:기준규칙:207", description: "항타기·항발기 조립 시 조치", category: "항타기", priority: "high" },
  { iri: "art:기준규칙:210", description: "항타기 도괴 방지", category: "항타기", priority: "high" },
  // 밀폐공간 추가
  { iri: "art:기준규칙:626", description: "밀폐공간 안전작업절차", category: "밀폐공간", priority: "high" },
  { iri: "art:기준규칙:627", description: "밀폐공간 출입 통제", category: "밀폐공간", priority: "high" },
  // 화학물질
  { iri: "art:기준규칙:574", description: "특별관리물질 명부·교육·5년 보존", category: "화학물질·석면", priority: "medium" },
];

(async () => {
  // 49 Document의 legalBasis 수집
  const docFiles = await readdir(DOCS_DIR);
  const docCoverByIri = new Map<string, string[]>();

  for (const f of docFiles) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOCS_DIR, f);
    const stat = await import("node:fs/promises").then((m) => m.stat(path));
    if (stat.isDirectory()) continue;
    try {
      const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
        docId?: string;
        legalBasis?: string[];
      };
      const docId = node.docId ?? f;
      for (const lb of node.legalBasis ?? []) {
        if (!docCoverByIri.has(lb)) docCoverByIri.set(lb, []);
        docCoverByIri.get(lb)!.push(docId);
      }
    } catch {
      // skip
    }
  }

  // 카테고리별 매핑
  const byCategory = new Map<string, ObligationCheck[]>();
  for (const o of OBLIGATIONS) {
    if (!byCategory.has(o.category)) byCategory.set(o.category, []);
    byCategory.get(o.category)!.push(o);
  }

  let totalCovered = 0;
  let totalHigh = 0;
  let totalHighCovered = 0;
  let totalMissing = 0;
  const missing: ObligationCheck[] = [];
  const missingHigh: ObligationCheck[] = [];

  console.log(`# 건설안전 도메인 의무문서 cover 감사 (${OBLIGATIONS.length}건)\n`);
  console.log(`도메인: src/ontology/scope.json — 한국 건설현장 안전관리`);
  console.log(`범위: 산안법 + 시행령 + 시행규칙 + 기준규칙(671조 中 건설 약 200조) + 중처법 + 위험성평가-고시 + KOSHA C/D 시리즈`);
  console.log(`Document 노드: ${docFiles.filter((f) => f.endsWith(".jsonld")).length} (건설 의무문서 + KOSHA Guide 1039 中 건설 522)`);
  console.log(`참고 — 도메인 외(제조업·공정안전·일반보건) 활동 4개·KOSHA 가이드 517개는 _meta.scope: out_of_domain 표기\n`);

  for (const [cat, items] of byCategory) {
    console.log(`## ${cat}`);
    for (const o of items) {
      const docs = docCoverByIri.get(o.iri) ?? [];
      const isCovered = docs.length > 0;
      const mark = isCovered ? "✓" : "✗";
      const priorityMark = o.priority === "high" ? "★" : o.priority === "medium" ? "·" : "○";
      const docList = docs.length > 0 ? docs.slice(0, 3).join(", ") : "—";
      console.log(`  ${mark} ${priorityMark} ${o.iri.padEnd(28)} ${o.description.padEnd(38)} ← ${docList}`);
      if (isCovered) {
        totalCovered += 1;
        if (o.priority === "high") totalHighCovered += 1;
      } else {
        totalMissing += 1;
        missing.push(o);
        if (o.priority === "high") missingHigh.push(o);
      }
      if (o.priority === "high") totalHigh += 1;
    }
    console.log("");
  }

  console.log(`# 종합`);
  console.log(`  Cover: ${totalCovered} / ${OBLIGATIONS.length} (${Math.round(totalCovered/OBLIGATIONS.length*100)}%)`);
  console.log(`  High 우선 cover: ${totalHighCovered} / ${totalHigh} (${Math.round(totalHighCovered/totalHigh*100)}%)`);
  console.log(`  Missing: ${totalMissing}`);
  console.log(`  Missing High 우선: ${missingHigh.length}`);

  if (missingHigh.length > 0) {
    console.log(`\n# ★ 누락 (High 우선) — 즉시 보강 필요`);
    for (const m of missingHigh) {
      console.log(`  ✗ ${m.iri.padEnd(28)} ${m.description}`);
    }
  }
  if (missing.filter((m) => m.priority !== "high").length > 0) {
    console.log(`\n# 누락 (Medium·Low 우선) — 후속 보강`);
    for (const m of missing.filter((x) => x.priority !== "high")) {
      console.log(`  ✗ ${m.iri.padEnd(28)} ${m.description} [${m.priority}]`);
    }
  }
})();
