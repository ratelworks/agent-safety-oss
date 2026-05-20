#!/usr/bin/env tsx
/**
 * seed-document-cover.ts (P-F)
 *
 * 14종(현 20종) 법정문서 각각의 cover edge 밀도 보강.
 *
 * 핵심: 각 Document별 도메인 키워드 (ground truth, 황룡건설(주) 정의) →
 *       KOSHA 카탈로그 1039건에서 techGdlnNm 매칭 → guidedBy 엣지 자동 생성.
 *
 * 환각 위험 통제:
 *   - 키워드 자체는 도메인 정의 (LLM 분류 아님)
 *   - 매칭은 단순 substring (LLM 추론 아님)
 *   - 각 Document별 매칭 결과 콘솔 출력으로 sample audit 가능
 *
 * 보존: 기존 Document 노드의 다른 필드 (legalBasis·requiredFields·reviewRules 등)는 유지.
 *       guidedBy 만 재계산.
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");
const ACTIVITIES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "activities");

// Document docId → cover 키워드 (ground truth, 도메인 정의)
// 매칭은 KOSHA techGdlnNm substring (모든 키워드 OR)
const DOC_COVER: Record<string, string[]> = {
  work_plan_excavation: [
    "굴착", "흙막이", "토공", "옹벽", "매설물", "발파", "사면", "지반", "터파기",
  ],
  work_plan: [
    "작업계획", "차량계", "건설기계", "지게차", "타워크레인", "이동식크레인",
    "양중", "중량물", "철근", "콘크리트", "거푸집", "동바리", "비계", "작업발판", "해체",
  ],
  work_permit: [
    "화기", "용접", "용단", "밀폐공간", "산소", "유해가스", "정전", "고소", "추락",
  ],
  work_environment_measurement: [
    "작업환경측정", "분진", "소음", "진동", "유기용제", "노출평가", "청력", "소음성난청",
    "근골격", "VDT", "고열", "한랭",
  ],
  msds_register: [
    "MSDS", "물질안전보건자료", "경고표지", "화학물질 관리", "화학물질관리", "유해화학",
  ],
  ppe_register: [
    "보호구", "안전모", "안전대", "안전화", "호흡보호", "청력보호", "절연 보호구", "안전난간",
  ],
  ad_hoc_risk_assessment: [
    "위험성평가", "위험성 평가", "HAZOP", "체크리스트", "JSA", "작업위험성", "정량적 위험",
  ],
  initial_risk_assessment: [
    "위험성평가", "위험성 평가", "HAZOP", "체크리스트", "위험성평가 우선순위",
  ],
  regular_risk_assessment: [
    "위험성평가", "위험성 평가", "정기적인 공정", "정기 위험성", "재평가",
  ],
  monthly_risk_assessment: [
    "위험성평가", "위험성 평가", "수시", "월간", "재평가",
  ],
  daily_tbm: [
    "안전교육", "관리감독자", "TBM", "Tool Box", "작업전", "현장교육",
  ],
  monthly_education_log: [
    "안전교육", "정기교육", "신규교육", "관리감독자", "근로자 교육",
  ],
  pre_work_inspection: [
    "점검", "사전점검", "작업전 점검", "안전점검",
  ],
  weekly_joint_inspection: [
    "점검", "합동점검", "정기점검", "도급사업주",
  ],
  health_examination_records: [
    "건강진단", "건강검진", "특수건강진단", "일반건강진단",
  ],
  health_safety_committee: [
    "산업안전보건위원회", "노사협의", "위원회", "보건관리",
  ],
  contractor_safety_council: [
    "도급", "수급인", "건설공사발주자", "원하청",
  ],
  industrial_accident_report: [
    "산업재해", "재해사례", "재해조사", "사고조사", "재해보고",
  ],
  severe_accident_compliance: [
    "중대재해", "안전보건관리체계", "자율안전보건", "경영방침",
  ],
  safety_health_manager_appointment: [
    "안전관리자", "보건관리자", "안전보건관리책임자", "관리감독자", "선임",
  ],
};

interface KoshaGuide {
  iri: string;
  guideNo: string;
  title: string;
}

interface DocNode {
  filePath: string;
  docId: string;
  iri: string;
  raw: Record<string, unknown>;
}

async function loadKoshaGuides(): Promise<KoshaGuide[]> {
  const out: KoshaGuide[] = [];
  for (const f of await readdir(GUIDES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(
      await readFile(resolve(GUIDES_DIR, f), "utf8"),
    ) as Record<string, unknown> & {
      "@id"?: string;
      title?: string;
      _meta?: { guideNo?: string };
    };
    out.push({
      iri: String(node["@id"] ?? ""),
      guideNo: String(node._meta?.guideNo ?? ""),
      title: String(node.title ?? ""),
    });
  }
  return out;
}

async function loadDocs(): Promise<DocNode[]> {
  const out: DocNode[] = [];
  for (const f of await readdir(DOCS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const filePath = resolve(DOCS_DIR, f);
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown> & {
      "@id"?: string;
      docId?: string;
    };
    out.push({
      filePath,
      docId: String(raw.docId ?? ""),
      iri: String(raw["@id"] ?? ""),
      raw,
    });
  }
  return out;
}

function matchGuides(
  keywords: string[],
  guides: KoshaGuide[],
  excludeKeywords: string[] = [],
): KoshaGuide[] {
  const matched: KoshaGuide[] = [];
  for (const g of guides) {
    const positive = keywords.some((kw) => g.title.includes(kw));
    if (!positive) continue;
    const negative = excludeKeywords.some((kw) => g.title.includes(kw));
    if (negative) continue;
    matched.push(g);
  }
  return matched;
}

(async () => {
  console.log("# P-F — 14종 문서 cover edge 밀도 보강\n");

  const guides = await loadKoshaGuides();
  console.log(`  KOSHA 카탈로그: ${guides.length} 건`);

  const docs = await loadDocs();
  console.log(`  Document 노드: ${docs.length} 종\n`);

  let totalEdges = 0;
  const summary: Array<{ doc: string; matched: number }> = [];

  for (const d of docs) {
    // 우선: Document 노드의 _meta.guidedByKeywords (P-PAPER-2 시드 시 정의)
    // fallback: DOC_COVER 하드코딩 (기존 20 노드)
    const metaCfg = (d.raw._meta as {
      guidedByKeywords?: string[];
      guidedByExcludeKeywords?: string[];
    } | undefined) ?? {};
    const metaKws = metaCfg.guidedByKeywords;
    const keywords = (metaKws && metaKws.length > 0) ? metaKws : DOC_COVER[d.docId];
    const excludeKws = metaCfg.guidedByExcludeKeywords ?? [];
    if (!keywords) {
      console.log(`  ⚠ ${d.docId}: cover 키워드 미정의 — skip (P-F2 검토 필요)`);
      summary.push({ doc: d.docId, matched: -1 });
      continue;
    }
    const matched = matchGuides(keywords, guides, excludeKws);
    const iris = matched.map((g) => g.iri);
    d.raw.guidedBy = iris;
    await writeFile(d.filePath, JSON.stringify(d.raw, null, 2) + "\n", "utf8");
    totalEdges += iris.length;
    summary.push({ doc: d.docId, matched: iris.length });
    const excDisplay = excludeKws.length > 0 ? ` exclude=[${excludeKws.join(", ")}]` : "";
    console.log(`  ✓ ${d.docId.padEnd(40)} matched=${iris.length}  keywords=[${keywords.join(", ")}]${excDisplay}`);
  }

  console.log("\n# 요약");
  console.log(`  총 guidedBy 엣지: ${totalEdges}`);
  console.log(`  매칭 0건 Document: ${summary.filter((s) => s.matched === 0).length}`);
  console.log(`  키워드 미정의: ${summary.filter((s) => s.matched === -1).length}`);

  // Activity 매핑도 KOSHA 흡수로 사라졌으므로 재구성 (기본 키워드 재사용)
  // Activity의 guidedBy 는 Activity 자체의 정의에 따라 별도 매핑 필요
  // 여기서는 Document 매핑이 우선이므로 Activity는 P-G로 미룸

  console.log("\n✓ P-F 완료");
})();
