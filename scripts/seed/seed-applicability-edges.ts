#!/usr/bin/env tsx
/**
 * seed-applicability-edges.ts
 *
 * Applicability 노드 → Article.appliesTo 매핑 + KOSHA Guide 일반 카테고리 → Document.guidedBy
 * P10 고립 노드 23건 해소.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const DOCUMENTS = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

// Article.appliesTo ← Applicability 매트릭스
const ARTICLE_APPLICABILITY: Record<string, string[]> = {
  "art:산안법:36": ["applic:all_workplace"], // 위험성평가 — 모든 사업장
  "art:산안법:29": ["applic:all_workplace"], // 안전보건교육
  "art:산안법:17": ["applic:fifty_persons_or_more"], // 안전관리자 선임
  "art:산안법:18": ["applic:fifty_persons_or_more"], // 보건관리자 선임
  "art:산안법:62": ["applic:construction_all"], // 안전보건총괄책임자
  "art:산안법:63": ["applic:construction_all"], // 도급인 안전·보건 조치
  "art:산안법:67": ["applic:construction_50bn_plus"], // 안전보건대장 — 50억 이상
  "art:산안법:72": ["applic:construction_all"], // 산업안전보건관리비
  "art:산안법:24": ["applic:fifty_persons_or_more"], // 산업안전보건위원회
  "art:산안법:54": ["applic:all_workplace"], // 산업재해 보고
  "art:산안법:57": ["applic:all_workplace"], // 산업재해 발생 보고
  "art:산안법:110": ["applic:all_workplace"], // MSDS
  "art:산안법:125": ["applic:all_workplace"], // 작업환경측정
  "art:산안법:129": ["applic:all_workplace"], // 건강진단
  "art:중처법:4": ["applic:five_persons_or_more"], // 중처법 — 5인 이상
  "art:중처법:5": ["applic:five_persons_or_more"],
  "art:위험성평가-고시:15": ["applic:ongoing_assessment_selected"], // 상시평가 선택
};

// 일반 카테고리 KOSHA Guide → 모든 Document에 guidedBy
// (G-46 안전보건관리체계 → severe_accident_compliance, G-141 위험성평가 → 4종 risk_assessment 등)
const KOSHA_GUIDE_DOC_LINKS: Record<string, string[]> = {
  "doc:kosha_guide/G-46-2017": ["doc:semi_annual/severe_accident_compliance"], // 안전보건관리체계
  "doc:kosha_guide/G-141-2019": [
    "doc:ad_hoc/initial_risk_assessment",
    "doc:annual/regular_risk_assessment",
    "doc:ad_hoc/ad_hoc_risk_assessment",
    "doc:monthly/monthly_risk_assessment",
  ], // 위험성평가
  "doc:kosha_guide/G-127-2017": ["doc:monthly/monthly_education_log"], // 안전보건교육
  "doc:kosha_guide/G-170-2018": ["doc:daily/daily_tbm"], // TBM
  "doc:kosha_guide/G-95-2017": ["doc:ad_hoc/industrial_accident_report"], // 재해 사례 분석·재발방지
  "doc:kosha_guide/G-117-2017": ["doc:monthly/ppe_register"], // 보호구 선정·관리
  "doc:kosha_guide/X-44-2018": ["doc:continuous/msds_register"], // MSDS 작성·관리
  "doc:kosha_guide/X-87-2017": ["doc:ad_hoc/work_permit"], // 밀폐공간 작업 안전
  "doc:kosha_guide/H-12-2018": ["doc:semi_annual/work_environment_measurement"], // 근골격계
  "doc:kosha_guide/H-53-2018": ["doc:semi_annual/work_environment_measurement"], // 분진
  "doc:kosha_guide/H-66-2018": ["doc:semi_annual/work_environment_measurement"], // 소음
  "doc:kosha_guide/H-200-2018": ["doc:semi_annual/work_environment_measurement"], // 온열질환
  "doc:kosha_guide/C-104-2017": ["doc:ad_hoc/work_plan"], // 비계
  "doc:kosha_guide/C-118-2018": ["doc:ad_hoc/work_plan"], // 거푸집
  "doc:kosha_guide/C-13-2018": ["doc:ad_hoc/work_permit"], // 화재예방
  "doc:kosha_guide/C-30-2020": [], // 산업안전보건관리비 (Document 미연결, 고립 유지 — 별도 도구로 활용)
  "doc:kosha_guide/M-21-2017": [], // 프레스 (별표 4 13종 외)
  "doc:kosha_guide/M-95-2018": [], // 산업용 로봇
};

(async () => {
  // 1. Article.appliesTo 매핑
  let articleUpdated = 0, applicEdges = 0;
  for (const [articleId, applics] of Object.entries(ARTICLE_APPLICABILITY)) {
    const m = articleId.match(/^art:([^:]+):(.+)$/);
    if (!m) continue;
    const file = `${m[1]}-§${m[2]}.jsonld`;
    try {
      const path = resolve(ARTICLES, file);
      const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & { appliesTo?: string[] };
      const cur = node.appliesTo ?? [];
      const merged = Array.from(new Set([...cur, ...applics]));
      if (merged.length !== cur.length) {
        node.appliesTo = merged;
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
        articleUpdated += 1;
        applicEdges += merged.length - cur.length;
      }
    } catch {}
  }
  console.log(`[appliesTo] ${articleUpdated} Article 갱신, ${applicEdges} 엣지 추가`);

  // 2. KOSHA Guide → Document.guidedBy 양방향 매핑
  // KOSHA Guide의 _meta.linkedDocs 추가 + Document.guidedBy 추가
  let docUpdated = 0, guideEdges = 0;
  for (const [guideId, docs] of Object.entries(KOSHA_GUIDE_DOC_LINKS)) {
    if (docs.length === 0) continue;
    for (const docId of docs) {
      // Document IRI에서 cycle/docId 추출 → 파일명
      const m = docId.match(/^doc:[^/]+\/(.+)$/);
      if (!m) continue;
      const slug = m[1].replace(/_/g, "-");
      const path = resolve(DOCUMENTS, `${slug}.jsonld`);
      try {
        const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & { guidedBy?: string[] };
        const cur = node.guidedBy ?? [];
        if (!cur.includes(guideId)) {
          node.guidedBy = [...cur, guideId];
          await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
          docUpdated += 1;
          guideEdges += 1;
        }
      } catch {}
    }
  }
  console.log(`[guidedBy] ${docUpdated} Document 갱신, ${guideEdges} 엣지 추가`);
})();
