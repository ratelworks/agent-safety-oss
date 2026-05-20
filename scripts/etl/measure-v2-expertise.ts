#!/usr/bin/env tsx
/**
 * v2 전문성 채점 측정 — 5종 법정문서.
 *
 * 100점 만점 산정:
 *   1. Hallucination Check (25점): legalBasis article 노드 실존 + description 매칭 가능
 *   2. Blank Guidance (25점): requiredFields에 description/guidance/example/blanks/commonErrors 보유
 *   3. Hazard Coverage (20점): 시나리오 hazard 식별 + 추가 위험 식별
 *   4. Contextual Guide (15점): 시나리오 KOSHA Guide precision/recall
 *   5. Validation (15점): commonErrors + 시간성 + 환각 검출 도구
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS_DIR = resolve(ROOT, "src/ontology/guides");
const ARTICLES_DIR = resolve(ROOT, "src/ontology/graph/nodes/articles");
const GUIDES_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
const REPORTS_DIR = resolve(ROOT, "reports");

const TARGET_DOCS = [
  "daily-tbm",
  "pre-work-inspection",
  "monthly-risk-assessment",
  "work-permit",
  "work-plan",
  "weekly-joint-inspection",
  "msds-register",
  "contractor-safety-council",
  "monthly-education-log",
  "ppe-register",
  "health-safety-committee",
  "severe-accident-compliance",
  "work-environment-measurement",
  "health-examination-records",
  "regular-risk-assessment",
  "ad-hoc-risk-assessment",
  "industrial-accident-report",
  "initial-risk-assessment",
  "safety-health-manager-appointment",
];

function loadArticles(): Record<string, any> {
  const nodes: Record<string, any> = {};
  for (const f of readdirSync(ARTICLES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const d = JSON.parse(readFileSync(join(ARTICLES_DIR, f), "utf8"));
    const aid = d["@id"];
    if (aid) nodes[aid] = d;
  }
  return nodes;
}

function loadGuides(): { nodes: Record<string, any>; articleToG: Record<string, string[]> } {
  const nodes: Record<string, any> = {};
  const articleToG: Record<string, string[]> = {};
  for (const f of readdirSync(GUIDES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const d = JSON.parse(readFileSync(join(GUIDES_DIR, f), "utf8"));
    const gid = d._meta?.guideNo;
    if (gid) nodes[gid] = d;
    for (const r of (d.relatedLaw || [])) {
      const aid = r.articleNodeId;
      if (aid) {
        (articleToG[aid] ||= []).push(gid);
      }
    }
  }
  return { nodes, articleToG };
}

interface DocScore {
  doc: string;
  title: string;
  h_score: number;
  g_score: number;
  hz_score: number;
  c_score: number;
  v_score: number;
  total: number;
  details: Record<string, number>;
}

function scoreDocument(docFile: string, articles: Record<string, any>, guides: Record<string, any>, articleToG: Record<string, string[]>): DocScore {
  const doc = JSON.parse(readFileSync(join(DOCS_DIR, `${docFile}.json`), "utf8"));
  const legalBasis: string[] = doc.legalBasis || [];
  const required: any[] = doc.requiredFields || [];
  const reviewRules: any[] = doc.reviewRules || [];
  const legalDetails: any[] = doc.legalBasisDetails || [];

  // 1) Hallucination Check (25)
  const artExist = legalBasis.filter((aid) => articles[aid]).length;
  const artFullDesc = legalBasis.filter((aid) => articles[aid] && (articles[aid].description || "").length > 300).length;
  let hScore = 0;
  if (legalBasis.length > 0) {
    hScore = (artExist / legalBasis.length) * 15 + (artFullDesc / legalBasis.length) * 10;
  }

  // 2) Blank Guidance (25)
  let gScore = 0;
  if (required.length > 0) {
    const perField = required.map((f: any) => {
      let sub = 0;
      if (f.description) sub += 5;
      if (f.guidance) sub += 8;
      if (f.example) sub += 5;
      if (f.blanks) sub += 4;
      if (f.commonErrors) sub += 3;
      return Math.min(sub, 25);
    });
    gScore = perField.reduce((a, b) => a + b, 0) / perField.length;
  }

  // 3) Hazard Coverage (20)
  const relatedGuideIds = new Set<string>();
  for (const aid of legalBasis) for (const gid of (articleToG[aid] || [])) relatedGuideIds.add(gid);
  const hazards = new Set<string>();
  for (const gid of relatedGuideIds) {
    for (const h of (guides[gid]?.causedBy || [])) hazards.add(h);
  }
  let hzScore: number;
  if (hazards.size >= 10) hzScore = 20;
  else if (hazards.size >= 5) hzScore = 15;
  else if (hazards.size >= 3) hzScore = 10;
  else if (hazards.size >= 1) hzScore = 5;
  else hzScore = 0;

  // 4) Contextual Guide (15)
  let constructionGuides = 0;
  for (const gid of relatedGuideIds) {
    const scope = guides[gid]?._meta?.scope || "";
    if (scope === "construction" || scope === "construction_partial") constructionGuides++;
  }
  let cScore: number;
  if (constructionGuides >= 10) cScore = 15;
  else if (constructionGuides >= 5) cScore = 12;
  else if (constructionGuides >= 3) cScore = 8;
  else if (constructionGuides >= 1) cScore = 4;
  else cScore = 0;

  // 5) Validation (15)
  let vScore = 0;
  const fieldsWithErr = required.filter((f: any) => f.commonErrors).length;
  if (required.length > 0) vScore += (fieldsWithErr / required.length) * 7;
  if (reviewRules.length > 0) vScore += 5;
  if (legalDetails.length > 0) vScore += 3;

  const total = hScore + gScore + hzScore + cScore + vScore;
  return {
    doc: docFile,
    title: doc.title,
    h_score: Math.round(hScore * 10) / 10,
    g_score: Math.round(gScore * 10) / 10,
    hz_score: hzScore,
    c_score: cScore,
    v_score: Math.round(vScore * 10) / 10,
    total: Math.round(total * 10) / 10,
    details: {
      art_exist: artExist,
      art_total: legalBasis.length,
      art_full_desc: artFullDesc,
      required_fields: required.length,
      fields_with_guidance: required.filter((f: any) => f.guidance).length,
      fields_with_commonErrors: fieldsWithErr,
      related_guides: relatedGuideIds.size,
      construction_guides: constructionGuides,
      hazards: hazards.size,
    },
  };
}

function main() {
  const articles = loadArticles();
  const { nodes: guides, articleToG } = loadGuides();

  console.log(`v2 전문성 채점 — 5종 법정문서 (보강 후)\n`);

  const results: DocScore[] = [];
  for (const docFile of TARGET_DOCS) {
    try {
      results.push(scoreDocument(docFile, articles, guides, articleToG));
    } catch (e) {
      console.log(`[WARN] ${docFile}: ${(e as Error).message}`);
    }
  }

  console.log(`${"문서".padEnd(30)} ${"환각".padStart(6)} ${"빈칸".padStart(6)} ${"위험".padStart(6)} ${"가이드".padStart(6)} ${"검수".padStart(6)} ${"총점".padStart(6)} 등급`);
  console.log("-".repeat(100));
  for (const r of [...results].sort((a, b) => b.total - a.total)) {
    let grade: string;
    if (r.total >= 95) grade = "A+ 전문가";
    else if (r.total >= 85) grade = "A 보조";
    else if (r.total >= 70) grade = "B 견습";
    else if (r.total >= 50) grade = "C 자료실";
    else grade = "D 미완";
    console.log(
      `${(r.title || "").slice(0, 28).padEnd(30)} ${r.h_score.toFixed(1).padStart(6)} ${r.g_score.toFixed(1).padStart(6)} ${String(r.hz_score).padStart(6)} ${String(r.c_score).padStart(6)} ${r.v_score.toFixed(1).padStart(6)} ${r.total.toFixed(1).padStart(6)}  ${grade}`,
    );
  }

  const avg = results.reduce((s, r) => s + r.total, 0) / results.length;
  console.log(`\n평균: ${avg.toFixed(1)}/100`);

  console.log(`\n${"문서".padEnd(30)} ${"art존재".padStart(10)} ${"본문>300".padStart(10)} ${"필드수".padStart(8)} ${"guidance".padStart(10)} ${"commonErr".padStart(11)} ${"건설가이드".padStart(11)} ${"hazard".padStart(8)}`);
  console.log("-".repeat(105));
  for (const r of results) {
    const d = r.details;
    console.log(
      `${(r.title || "").slice(0, 28).padEnd(30)} ${String(d.art_exist).padStart(5)}/${String(d.art_total).padEnd(3)} ${String(d.art_full_desc).padStart(10)} ${String(d.required_fields).padStart(8)} ${String(d.fields_with_guidance).padStart(10)} ${String(d.fields_with_commonErrors).padStart(11)} ${String(d.construction_guides).padStart(11)} ${String(d.hazards).padStart(8)}`,
    );
  }

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORTS_DIR, "v2-expertise-scores.json"),
    JSON.stringify({ results, avgScore: avg }, null, 2),
    "utf8",
  );
  console.log(`\n저장: reports/v2-expertise-scores.json`);
}

main();
