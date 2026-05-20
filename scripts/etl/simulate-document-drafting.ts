#!/usr/bin/env tsx
/**
 * Phase 2.2 — 건설 핵심 5종 법정문서 작성 시뮬레이션 (정확판).
 *
 * 목표: 각 문서를 실제 작성한다고 가정하고, 그래프가 자동 제공할 수 있는 정보를 측정.
 *
 * 5가지 완결성 지표:
 *   1. legalBasis 노드 매칭 (그래프에 article 존재 여부)
 *   2. 법령 본문 발췌 품질 (article description 길이 + legalBasisDetails 자체 수록)
 *   3. requiredFields 빈칸 가이드 (필드 정의 충실도)
 *   4. relatedTools (MCP 도구 연결)
 *   5. 관련 KOSHA Guide (해당 article을 인용한 가이드)
 *   6. hazard/control 노드 연결 (위험·조치 자동 제안 가능성)
 *
 * 사용성 점수 100점 만점:
 *   - 30 art_coverage (article 노드 존재)
 *   - 25 description_quality (본문 발췌 가능)
 *   - 20 required_fields_defined (빈칸 가이드 정의됨)
 *   - 15 kosha_guides_related (관련 가이드 보유)
 *   - 10 hazard_control_connected (위험·조치 추론 가능)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS_DIR = resolve(ROOT, "src/ontology/guides");
const ARTICLES_DIR = resolve(ROOT, "src/ontology/graph/nodes/articles");
const GUIDES_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
const REPORTS_DIR = resolve(ROOT, "reports");

const TARGET_DOCS: Array<[string, string]> = [
  ["daily-tbm", "매일 TBM 일지"],
  ["pre-work-inspection", "작업시작 전 점검표"],
  ["monthly-risk-assessment", "월 위험성평가표"],
  ["work-permit", "작업허가서"],
  ["work-plan", "작업계획서 13종"],
];

interface SimResult {
  docFile: string;
  title: string;
  legalBasisCount: number;
  articleCoverage: number;
  descriptionFull: number;
  descriptionShort: number;
  descriptionEmpty: number;
  legalBasisDetailsCount: number;
  requiredFieldsCount: number;
  requiredFieldsWithSource: number;
  requiredFieldsWithBlanks: number;
  requiredFieldsWithGuide: number;
  relatedGuidesTotal: number;
  relatedGuidesConstruction: number;
  hazardsInferable: number;
  controlsInferable: number;
  usabilityScore: number;
  autoFillScenarios: string[];
  missingArticles: string[];
}

function main() {
  // article 인덱스
  const articleIdx: Record<string, any> = {};
  for (const f of readdirSync(ARTICLES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const d = JSON.parse(readFileSync(join(ARTICLES_DIR, f), "utf8"));
    if (d["@id"]) articleIdx[d["@id"]] = d;
  }

  // guide 인덱스 + article → guides 역인덱스
  const articleToGuides: Record<string, Array<{ guideId: string; guideTitle: string; scope: string }>> = {};
  const guideIdx: Record<string, any> = {};
  for (const f of readdirSync(GUIDES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const d = JSON.parse(readFileSync(join(GUIDES_DIR, f), "utf8"));
    const gid = d._meta?.guideNo;
    if (gid) guideIdx[gid] = d;
    for (const r of (d.relatedLaw || [])) {
      const aid = r.articleNodeId;
      if (aid) {
        (articleToGuides[aid] ||= []).push({
          guideId: gid,
          guideTitle: d.title || "",
          scope: d._meta?.scope || "",
        });
      }
    }
  }

  console.log(`Phase 2.2 — 건설 현장 핵심 5종 법정문서 작성 시뮬레이션\n`);

  const results: SimResult[] = [];
  for (const [docFile, shortName] of TARGET_DOCS) {
    const path = join(DOCS_DIR, `${docFile}.json`);
    if (!existsSync(path)) continue;
    const doc = JSON.parse(readFileSync(path, "utf8"));

    const title = doc.title || shortName;
    const legalBasis: string[] = doc.legalBasis || [];
    const legalDetails: any[] = doc.legalBasisDetails || [];
    const requiredFields: any[] = doc.requiredFields || [];
    const examples: any[] = doc.examples || [];
    const reviewRules: any[] = doc.reviewRules || [];
    const relatedTools: any[] = doc.relatedTools || [];

    console.log(`\n📄 ${title}`);
    console.log(`   docId: ${docFile}`);
    console.log(`   주기: ${doc.cycle || "?"}  |  보존: ${doc.retention || "?"}`);

    const available = legalBasis.filter((aid) => articleIdx[aid]);
    const missing = legalBasis.filter((aid) => !articleIdx[aid]);
    const covPct = (available.length / Math.max(legalBasis.length, 1)) * 100;

    const descLengths = available.map((aid) => (articleIdx[aid].description || "").length);
    const full = descLengths.filter((l) => l > 500).length;
    const short = descLengths.filter((l) => l > 50 && l <= 500).length;
    const empty = descLengths.filter((l) => l <= 50).length;
    const detailsWithText = legalDetails.filter((d: any) => d.text && (d.text || "").length > 30).length;

    const rfWithSource = requiredFields.filter((f: any) => f.source || f.legalBasis).length;
    const rfWithBlanks = requiredFields.filter((f: any) => f.blanks || f.fields || f.items).length;
    const rfWithGuide = requiredFields.filter((f: any) => f.guidance || f.description || f.note).length;

    const relatedGuideSet: Record<string, any> = {};
    const constructionGuides: Record<string, any> = {};
    for (const aid of available) {
      for (const g of (articleToGuides[aid] || [])) {
        relatedGuideSet[g.guideId] = g;
        if (g.scope === "construction" || g.scope === "construction_partial") {
          constructionGuides[g.guideId] = g;
        }
      }
    }

    const hazards = new Set<string>();
    const controls = new Set<string>();
    for (const gid of Object.keys(constructionGuides)) {
      const gnode = guideIdx[gid] || {};
      for (const h of (gnode.causedBy || [])) hazards.add(h);
      for (const c of (gnode.mitigatedBy || [])) controls.add(c);
    }

    let score = 0;
    score += (covPct / 100) * 30;
    if (available.length > 0) {
      score += (full / available.length) * 12.5;
      score += (short / available.length) * 6;
    }
    if (legalDetails.length > 0) {
      score += Math.min(detailsWithText / Math.max(legalDetails.length, 1), 1) * 6.5;
    }
    if (requiredFields.length > 0) {
      score += ((rfWithSource + rfWithBlanks + rfWithGuide) / (3 * requiredFields.length)) * 20;
    }
    score += Math.min(Object.keys(constructionGuides).length / 5, 1) * 15;
    score += Math.min((hazards.size + controls.size) / 10, 1) * 10;

    console.log(`\n   [완결성 1] legalBasis article 노드: ${available.length}/${legalBasis.length} (${covPct.toFixed(0)}%)`);
    if (missing.length > 0) console.log(`      누락: ${JSON.stringify(missing.slice(0, 3))}`);
    console.log(`\n   [완결성 2] 본문 발췌 품질:`);
    console.log(`      article description: 충실(>500자) ${full}, 간략(50~500) ${short}, 빈약(<50) ${empty}`);
    console.log(`      legalBasisDetails 자체 본문: ${detailsWithText}/${legalDetails.length}`);
    console.log(`\n   [완결성 3] requiredFields 정의: ${requiredFields.length}개 필드`);
    if (requiredFields.length > 0) {
      console.log(`      source 명시: ${rfWithSource}, 빈칸 정의: ${rfWithBlanks}, 가이드 텍스트: ${rfWithGuide}`);
    }
    console.log(`\n   [완결성 4] 관련 KOSHA Guide:`);
    console.log(`      전체: ${Object.keys(relatedGuideSet).length}건  /  건설 도메인 한정: ${Object.keys(constructionGuides).length}건`);
    for (const [gid, g] of Object.entries(constructionGuides).slice(0, 3)) {
      console.log(`        - ${gid}: ${(g.guideTitle || "?").slice(0, 50)}`);
    }
    console.log(`\n   [완결성 5] hazard/control 추론 (건설 가이드 기반):`);
    console.log(`      hazard: ${hazards.size}개  /  control: ${controls.size}개`);
    console.log(`\n   [부수] examples 양식: ${examples.length}건, reviewRules: ${reviewRules.length}건, relatedTools: ${relatedTools.length}건`);
    console.log(`\n   ✦ 사용성 점수: ${score.toFixed(1)}/100`);

    console.log(`\n   [작성 시나리오 — 자동 채움 가능 항목]`);
    const scenarios: string[] = [];
    if (covPct >= 80) scenarios.push("✓ 법령 인용 자동 정확 (article 노드 매칭 완전)");
    if (full >= 1) scenarios.push(`✓ 법령 본문 ${full}개 자동 발췌 (충실 description)`);
    if (Object.keys(constructionGuides).length >= 3) scenarios.push(`✓ 관련 KOSHA Guide ${Object.keys(constructionGuides).length}건 자동 참조`);
    if (hazards.size >= 3) scenarios.push(`✓ hazard ${hazards.size}개 자동 제안 (위험요인 빈칸)`);
    if (controls.size >= 5) scenarios.push(`✓ control ${controls.size}개 자동 제안 (대책 빈칸)`);
    if (rfWithGuide >= 3) scenarios.push(`✓ ${rfWithGuide}개 필드 가이드 텍스트 보유`);
    if (scenarios.length === 0) scenarios.push("✗ 자동 채움 어려움 — 사용자 수동 입력 필요");
    for (const s of scenarios) console.log(`        ${s}`);

    results.push({
      docFile,
      title,
      legalBasisCount: legalBasis.length,
      articleCoverage: available.length,
      descriptionFull: full,
      descriptionShort: short,
      descriptionEmpty: empty,
      legalBasisDetailsCount: legalDetails.length,
      requiredFieldsCount: requiredFields.length,
      requiredFieldsWithSource: rfWithSource,
      requiredFieldsWithBlanks: rfWithBlanks,
      requiredFieldsWithGuide: rfWithGuide,
      relatedGuidesTotal: Object.keys(relatedGuideSet).length,
      relatedGuidesConstruction: Object.keys(constructionGuides).length,
      hazardsInferable: hazards.size,
      controlsInferable: controls.size,
      usabilityScore: Math.round(score * 10) / 10,
      autoFillScenarios: scenarios,
      missingArticles: missing,
    });
  }

  let avg = 0;
  if (results.length > 0) {
    avg = results.reduce((s, r) => s + r.usabilityScore, 0) / results.length;
    console.log(`\n평균 사용성 점수: ${avg.toFixed(1)}/100\n`);

    console.log("문서별 요약:");
    console.log(`${"문서".padEnd(35)} ${"점수".padStart(8)}  ${"art".padStart(6)}  ${"guides".padStart(8)}  ${"hazard".padStart(8)}  ${"control".padStart(8)}`);
    console.log("-".repeat(85));
    for (const r of [...results].sort((a, b) => b.usabilityScore - a.usabilityScore)) {
      console.log(
        `${r.title.slice(0, 33).padEnd(35)} ${r.usabilityScore.toFixed(1).padStart(6)}  ${String(r.articleCoverage).padStart(6)}  ${String(r.relatedGuidesConstruction).padStart(8)}  ${String(r.hazardsInferable).padStart(8)}  ${String(r.controlsInferable).padStart(8)}`,
      );
    }
  }

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(
    join(REPORTS_DIR, "document-drafting-simulation.json"),
    JSON.stringify({ results, avgScore: avg }, null, 2),
    "utf8",
  );
  console.log(`\n저장: reports/document-drafting-simulation.json`);
}

main();
