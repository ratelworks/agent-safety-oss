#!/usr/bin/env tsx
/**
 * test-graph-reasoning.ts
 *
 * 온톨로지 그래프가 의미적으로 제대로 작동하는지 multi-hop 추론으로 검증.
 *
 * 5축 추론 쿼리 (각 쿼리는 정답 IRI 셋이 미리 정의됨):
 *   Q1. hazard → mitigatedBy → control     (위험 → 통제)
 *   Q2. control → 역참조 hazard             (통제 → 어떤 위험에 쓰이나)
 *   Q3. doc → hasHazard → mitigatedBy → control  (문서 → 위험 → 통제 chain)
 *   Q4. doc → legalBasis → article → 역참조 docs  (같은 법령 인용 문서들)
 *   Q5. doc → relatedDocs → 양방향 도달성     (문서 간 연결)
 *
 * 각 쿼리에 대해 expected vs actual 비교 → precision / recall / F1
 *
 * 실행: npx tsx scripts/test/test-graph-reasoning.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");

// graph traversal: 전체 그래프 (3,336 노드) 기반 재귀 로딩.
// 이전: documents/articles/annexes/hazards/controls 5개 폴더 1단계만 — 전체 1,712 노드만 인덱싱.
// 변경 후: NODES_DIR 전체 재귀 — KOSHA Guide 1,039 + facets 118 등 모두 포함.
const allNodes = new Map<string, any>();
const subdirNodes: Record<string, any[]> = {};

function walkRecursive(dir: string, category: string): void {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) {
      walkRecursive(p, category);
    } else if (f.endsWith(".jsonld")) {
      try {
        const n = JSON.parse(readFileSync(p, "utf8"));
        if (n["@id"]) {
          allNodes.set(n["@id"], n);
          (subdirNodes[category] ||= []).push(n);
        }
      } catch { /* skip parse error */ }
    }
  }
}

for (const sub of readdirSync(NODES_DIR)) {
  const p = join(NODES_DIR, sub);
  if (statSync(p).isDirectory()) walkRecursive(p, sub);
}

const documents = subdirNodes["documents"] ?? [];
const articles = subdirNodes["articles"] ?? [];
const annexes = subdirNodes["annexes"] ?? [];
const hazards = subdirNodes["hazards"] ?? [];
const controls = subdirNodes["controls"] ?? [];

// Precondition: 전체 노드 수가 audit:graph-v2 기준값과 일치 (현재 3,336).
const EXPECTED_TOTAL_NODES = 3336;
if (allNodes.size < EXPECTED_TOTAL_NODES) {
  console.error(`[PRECONDITION FAIL] 전체 노드 ${allNodes.size} < 기대 ${EXPECTED_TOTAL_NODES}. 그래프 로딩 누락.`);
  process.exit(2);
}

interface ReasoningQuery {
  name: string;
  description: string;
  query: () => string[];
  /** 그래프가 반드시 포함해야 하는 핵심 IRI (recall 검증) */
  mustInclude: string[];
  /** 그래프가 포함해서는 안 되는 IRI (precision 검증, 도메인 부적합) */
  mustExclude?: string[];
}

// ─────────────────────────────────────────────────────────
// Q1. 추락 위험 → mitigatedBy → control
// ─────────────────────────────────────────────────────────
function q1_fall_to_controls(): string[] {
  const hz = allNodes.get("hazard:fall_from_height");
  return Array.isArray(hz?.mitigatedBy) ? hz.mitigatedBy : [];
}
const Q1: ReasoningQuery = {
  name: "Q1. 추락 위험을 통제하는 control 노드",
  description: "hazard:fall_from_height → mitigatedBy (ERIC 모든 단계 적합)",
  query: q1_fall_to_controls,
  mustInclude: ["control:eng_fall_net", "control:ppe_fall_arrester", "control:ppe_harness"],
  mustExclude: ["control:ppe_chemical_suit", "control:eng_ventilation", "control:admin_msds"], // 추락 무관 통제
};

// ─────────────────────────────────────────────────────────
// Q2. 안전대 → 역참조 어떤 hazard들이 사용?
// ─────────────────────────────────────────────────────────
function q2_harness_reverse_hazards(): string[] {
  const hz_using = [];
  for (const h of hazards) {
    const refs = Array.isArray(h.mitigatedBy) ? h.mitigatedBy : [];
    if (refs.includes("control:ppe_harness") || refs.includes("control:ppe_fall_arrester")) {
      hz_using.push(h["@id"]);
    }
  }
  return hz_using;
}
const Q2: ReasoningQuery = {
  name: "Q2. 안전대(harness/fall_arrester) 사용 hazard",
  description: "control:ppe_harness/fall_arrester → 역참조 (추락·익수 모두 가능)",
  query: q2_harness_reverse_hazards,
  mustInclude: ["hazard:fall_from_height"],
  mustExclude: ["hazard:dust", "hazard:noise", "hazard:chemical_exposure"], // 안전대와 무관
};

// ─────────────────────────────────────────────────────────
// Q3. 화기작업 허가서 → hasHazard → mitigatedBy 체인
// ─────────────────────────────────────────────────────────
function q3_hot_work_chain(): string[] {
  const doc = documents.find((d) => d.docId === "work_permit_hot_work");
  if (!doc) return [];
  const hzs = Array.isArray(doc.hasHazard) ? doc.hasHazard : [];
  const cts = new Set<string>();
  for (const hzIri of hzs) {
    const hz = allNodes.get(hzIri);
    if (hz?.mitigatedBy) for (const c of hz.mitigatedBy) cts.add(c);
  }
  return [...cts];
}
const Q3: ReasoningQuery = {
  name: "Q3. 화기작업허가 → hazards → controls (2-hop chain)",
  description: "work_permit_hot_work → hasHazard → mitigatedBy",
  query: q3_hot_work_chain,
  mustInclude: ["control:eng_fire_suppression", "control:eng_alarm"],
  // 화기작업 + 인화성 MSDS는 적합 → admin_msds 제외. 추락(eng_shoring)·소음(hearing_protection)만 무관
  mustExclude: ["control:eng_shoring", "control:ppe_hearing_protection"],
};

// ─────────────────────────────────────────────────────────
// Q4. 산안법 §57 (산재보고)을 인용하는 모든 문서
// ─────────────────────────────────────────────────────────
function q4_law57_reverse_docs(): string[] {
  const docs_using = [];
  for (const d of documents) {
    const refs = Array.isArray(d.legalBasis) ? d.legalBasis : [];
    if (refs.includes("art:산안법:57")) docs_using.push(d.docId);
  }
  return docs_using;
}
const Q4: ReasoningQuery = {
  name: "Q4. 산안법 §57(산재보고) 인용 문서",
  description: "art:산안법:57 → 역참조 documents",
  query: q4_law57_reverse_docs,
  mustInclude: ["industrial_accident_report"],
  mustExclude: ["daily_tbm", "ppe_register", "msds_register"], // §57 과 무관
};

// ─────────────────────────────────────────────────────────
// Q5. 매일 TBM ↔ 작업 전 점검 양방향 연결
// ─────────────────────────────────────────────────────────
function q5_tbm_bidirectional(): string[] {
  const tbm = documents.find((d) => d.docId === "daily_tbm");
  if (!tbm) return [];
  const fwd = Array.isArray(tbm.relatedDocs) ? tbm.relatedDocs : [];
  // 역참조 — pre_work_inspection 의 relatedDocs 에 daily_tbm 포함?
  const pre = documents.find((d) => d.docId === "pre_work_inspection");
  const back = Array.isArray(pre?.relatedDocs) ? pre.relatedDocs : [];
  // forward + backward 합집합
  const all = new Set<string>([...fwd, ...back]);
  return [...all];
}
const Q5: ReasoningQuery = {
  name: "Q5. 매일 TBM ↔ 작업 전 점검 양방향 도달성",
  description: "daily_tbm.relatedDocs ∪ pre_work_inspection.relatedDocs",
  query: q5_tbm_bidirectional,
  mustInclude: ["doc:daily/pre_work_inspection", "doc:daily/daily_tbm", "doc:daily/work_start_pre_check"],
  mustExclude: [
    "doc:on_construction_open/safety_health_management_policy", // 현장개설 무관
    "doc:on_accident/industrial_accident_report",
  ],
};

// ─────────────────────────────────────────────────────────
function evaluate(q: ReasoningQuery): {
  actual: string[];
  recall: number; // mustInclude 모두 포함 비율
  precisionDomain: number; // mustExclude 미포함 비율 (도메인 부적합 확인)
  pass: boolean;
  missing: string[]; // mustInclude 중 누락
  violations: string[]; // mustExclude 중 위반 (실제 포함됨)
} {
  const actual = q.query();
  const actualSet = new Set(actual);
  const missing = q.mustInclude.filter((x) => !actualSet.has(x));
  const violations = (q.mustExclude ?? []).filter((x) => actualSet.has(x));
  const recall = q.mustInclude.length > 0 ? (q.mustInclude.length - missing.length) / q.mustInclude.length : 1;
  const precisionDomain =
    (q.mustExclude?.length ?? 0) > 0 ? (q.mustExclude!.length - violations.length) / q.mustExclude!.length : 1;
  return {
    actual,
    recall,
    precisionDomain,
    pass: missing.length === 0 && violations.length === 0,
    missing,
    violations,
  };
}

function main(): void {
  console.log("=".repeat(78));
  console.log("Multi-hop 그래프 추론 검증");
  console.log("=".repeat(78));
  console.log(`전체 노드 인덱스: ${allNodes.size}`);
  console.log("");

  const queries = [Q1, Q2, Q3, Q4, Q5];
  let passCount = 0;
  let totalRecall = 0;
  let totalPrecDomain = 0;

  for (const q of queries) {
    const r = evaluate(q);
    const badge = r.pass ? "🟢 PASS" : "🔴 FAIL";
    console.log(`${badge}  ${q.name}`);
    console.log(`        ${q.description}`);
    console.log(`        actual size=${r.actual.length}`);
    console.log(`        recall (mustInclude 포함률):   ${(r.recall * 100).toFixed(0)}% (${q.mustInclude.length - r.missing.length}/${q.mustInclude.length})`);
    console.log(`        precision (mustExclude 회피): ${(r.precisionDomain * 100).toFixed(0)}% (${(q.mustExclude?.length ?? 0) - r.violations.length}/${q.mustExclude?.length ?? 0})`);
    if (r.missing.length > 0) console.log(`        ❌ missing: ${r.missing.join(", ")}`);
    if (r.violations.length > 0) console.log(`        ⚠️  도메인 위반: ${r.violations.join(", ")}`);
    console.log("");
    if (r.pass) passCount++;
    totalRecall += r.recall;
    totalPrecDomain += r.precisionDomain;
  }

  const n = queries.length;
  console.log("=".repeat(78));
  console.log(`📊 그래프 의미적 추론 검증 결과`);
  console.log(`   PASS:                 ${passCount}/${n} 쿼리`);
  console.log(`   평균 mustInclude 포함률 (recall):    ${((totalRecall / n) * 100).toFixed(1)}%`);
  console.log(`   평균 mustExclude 회피 (precision):  ${((totalPrecDomain / n) * 100).toFixed(1)}%`);
  console.log("=".repeat(78));
  console.log(`\n해석:`);
  console.log(`  • recall 100% = 그래프가 의미적 정답을 모두 포함`);
  console.log(`  • precision 100% = 그래프에 도메인 부적합 매핑 0건`);
  console.log(`  • 둘 다 100% = 그래프가 의미적으로 정확하고 완전`);

  if (passCount < n) process.exit(1);
}

main();
