#!/usr/bin/env tsx
/**
 * 시나리오별 그래프 컨텍스트 추출.
 *
 * 시나리오: "굴착 작업 (깊이 3m, 흙막이 설치, 인력 굴착)" 작업계획서 작성.
 *
 * 추출:
 *   1. work-plan 문서 정의 (legalBasis, requiredFields, examples)
 *   2. 굴착 관련 KOSHA Guide (kw: 굴착, 흙막이, 토공)
 *   3. 굴착 시 hazard·control 노드
 *   4. 굴착 관련 article 노드 (기준규칙 §38, §339, §340, §341, §342)
 *
 * 출력: reports/scenario-excavation-context.json
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS_DIR = resolve(ROOT, "src/ontology/guides");
const ARTICLES_DIR = resolve(ROOT, "src/ontology/graph/nodes/articles");
const GUIDES_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
const HAZARDS_DIR = resolve(ROOT, "src/ontology/graph/nodes/hazards");
const CONTROLS_DIR = resolve(ROOT, "src/ontology/graph/nodes/controls");
const REPORTS_DIR = resolve(ROOT, "reports");

const SCENARIO = {
  name: "굴착 작업 작업계획서",
  docType: "work-plan",
  workType: "굴착",
  workDetails: {
    depth_m: 3,
    method: "인력굴착 + 백호우 일부 사용",
    shoring: "H-Pile + 토류판",
    location: "도심지 신축 현장",
    duration: "5일",
  },
  keywords: ["굴착", "흙막이", "토공", "굴토", "지반", "노천", "트렌치"],
  expected_hazards: ["지반붕괴", "추락", "매설물", "장비전도", "산소결핍", "낙하물"],
  expected_articles_kijun: [38, 338, 339, 340, 341, 342, 343, 344, 345, 346, 347, 348, 350],
};

function loadJsonldDir(dirpath: string): Record<string, any> {
  const nodes: Record<string, any> = {};
  if (!existsSync(dirpath)) return nodes;
  for (const f of readdirSync(dirpath)) {
    if (!f.endsWith(".jsonld")) continue;
    try {
      const d = JSON.parse(readFileSync(join(dirpath, f), "utf8"));
      const nid = d["@id"];
      if (nid) nodes[nid] = d;
    } catch { /* skip */ }
  }
  return nodes;
}

function main() {
  const docDef = JSON.parse(readFileSync(join(DOCS_DIR, "work-plan.json"), "utf8"));

  const articles = loadJsonldDir(ARTICLES_DIR);
  const hazards = loadJsonldDir(HAZARDS_DIR);
  const controls = loadJsonldDir(CONTROLS_DIR);

  const excavationGuides: any[] = [];
  for (const f of readdirSync(GUIDES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const g = JSON.parse(readFileSync(join(GUIDES_DIR, f), "utf8"));
    const title = g.title || "";
    const scope = g._meta?.scope || "";
    if (SCENARIO.keywords.some((kw) => title.includes(kw)) && (scope === "construction" || scope === "construction_partial")) {
      excavationGuides.push({
        guideId: g._meta?.guideNo,
        title,
        scope,
        relatedLawCount: (g.relatedLaw || []).length,
        causedBy: g.causedBy || [],
        mitigatedBy: g.mitigatedBy || [],
      });
    }
  }

  const excavationArticles: any[] = [];
  for (const [aid, a] of Object.entries(articles)) {
    const m = aid.match(/^art:기준규칙:(\d+)/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (SCENARIO.expected_articles_kijun.includes(num)) {
        const description = (a as any).description || "";
        excavationArticles.push({
          id: aid,
          title: (a as any).title,
          description: description.slice(0, 300),
          descriptionFull: description.length > 500,
        });
      }
    }
  }

  const relatedHazards: Record<string, string> = {};
  const relatedControls: Record<string, string> = {};
  for (const g of excavationGuides) {
    for (const h of g.causedBy) {
      if (hazards[h]) relatedHazards[h] = hazards[h].title || hazards[h].label || h;
    }
    for (const c of g.mitigatedBy) {
      if (controls[c]) relatedControls[c] = controls[c].title || controls[c].label || c;
    }
  }

  const context = {
    scenario: SCENARIO,
    documentDefinition: {
      docId: docDef.docId,
      title: docDef.title,
      cycle: docDef.cycle,
      retention: docDef.retention,
      purpose: docDef.purpose,
      legalBasis: docDef.legalBasis,
      legalBasisDetails: docDef.legalBasisDetails,
      requiredFieldsCount: (docDef.requiredFields || []).length,
      requiredFieldsSample: (docDef.requiredFields || []).slice(0, 3),
      examplesCount: (docDef.examples || []).length,
      examplesSample: (docDef.examples || [])[0] || null,
      writingGuide: docDef.writingGuide,
      reviewRulesCount: (docDef.reviewRules || []).length,
    },
    excavationGuides,
    excavationArticles,
    relatedHazards,
    relatedControls,
    summary: {
      guidesFound: excavationGuides.length,
      articlesFound: excavationArticles.length,
      articlesExpected: SCENARIO.expected_articles_kijun.length,
      hazardNodes: Object.keys(relatedHazards).length,
      controlNodes: Object.keys(relatedControls).length,
    },
  };

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const out = resolve(REPORTS_DIR, "scenario-excavation-context.json");
  writeFileSync(out, JSON.stringify(context, null, 2), "utf8");

  console.log(`시나리오: ${SCENARIO.name}`);
  console.log(`작업 상세: 깊이 ${SCENARIO.workDetails.depth_m}m, ${SCENARIO.workDetails.method}`);
  console.log(`\n문서 정의 (${docDef.title}):`);
  console.log(`  legalBasis: ${(docDef.legalBasis || []).length}개`);
  console.log(`  legalBasisDetails 본문 보유: ${(docDef.legalBasisDetails || []).filter((d: any) => d.text).length}건`);
  console.log(`  requiredFields: ${(docDef.requiredFields || []).length}개`);
  console.log(`  examples: ${(docDef.examples || []).length}건`);
  console.log(`  reviewRules: ${(docDef.reviewRules || []).length}건`);
  console.log(`  writingGuide: ${docDef.writingGuide ? "있음" : "없음"}`);

  console.log(`\n굴착 관련 KOSHA Guide: ${excavationGuides.length}건`);
  for (const g of excavationGuides.slice(0, 7)) {
    console.log(`  - ${(g.guideId || "?").padEnd(15)} ${(g.title || "").slice(0, 50)}`);
  }

  console.log(`\n굴착 관련 article 노드: ${excavationArticles.length}/${SCENARIO.expected_articles_kijun.length}건`);
  for (const a of excavationArticles) {
    const full = a.descriptionFull ? "[충실]" : "[간략]";
    console.log(`  ${full} ${a.id.padEnd(25)} ${a.title}`);
  }

  console.log(`\n관련 hazard 노드: ${Object.keys(relatedHazards).length}개`);
  for (const [hid, name] of Object.entries(relatedHazards).slice(0, 10)) {
    console.log(`  - ${hid.padEnd(30)} ${name}`);
  }

  console.log(`\n관련 control 노드: ${Object.keys(relatedControls).length}개`);
  for (const [cid, name] of Object.entries(relatedControls).slice(0, 10)) {
    console.log(`  - ${cid.padEnd(30)} ${name}`);
  }

  console.log(`\n저장: ${out}`);
}

main();
