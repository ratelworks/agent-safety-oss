#!/usr/bin/env tsx
/**
 * seed-delegates.ts
 *
 * 핵심 위임 사슬 30+건 매핑. query_delegation_chain BFS 진짜 가치 발휘.
 * 산안법(상위) → 시행령/시행규칙/기준규칙/고시(하위) + 중처법 → 시행령 등.
 *
 * P9-2 (교차 검증 진단 — 5/336 = 1.5% 엣지 facade 정정).
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");

// 위임 매핑 — Article IRI → delegates 배열
// 법제처 OpenAPI 본문 + 위임 패턴 분석 기반
const DELEGATIONS: Record<string, string[]> = {
  // 산안법 → 시행령
  "art:산안법:15": ["art:산안법시행령:14"],          // 안전보건관리책임자 직무
  "art:산안법:16": ["art:산안법시행령:16"],          // 관리감독자 업무
  "art:산안법:17": ["art:산안법시행령:16", "art:산안법시행령:17", "art:산안법시행령:18"], // 안전관리자
  "art:산안법:18": ["art:산안법시행령:18"],          // 보건관리자
  "art:산안법:24": ["art:산안법시행령:34", "art:산안법시행령:35"], // 산업안전보건위원회
  "art:산안법:42": [], // 유해위험방지계획서 (시행령 §42, 시행규칙 §42)
  "art:산안법:62": [], // 안전보건총괄책임자
  "art:산안법:63": ["art:산안법:64"],                // 도급인의 안전·보건 조치
  "art:산안법:64": ["art:산안법시행규칙:79"],         // 도급인의 안전·보건 조치 (협의체)
  "art:산안법:67": [],                              // 건설공사 안전보건대장 (50억 이상)
  "art:산안법:72": [],                              // 산업안전보건관리비
  "art:산안법:84": [],                              // 자율안전확인 신고
  "art:산안법:110": ["art:산안법:111", "art:산안법:114", "art:산안법:115", "art:산안법시행규칙:167"], // MSDS
  "art:산안법:125": ["art:산안법시행규칙:186", "art:산안법시행령:95"],  // 작업환경측정
  "art:산안법:129": ["art:산안법:130", "art:산안법:131", "art:산안법시행규칙:201"], // 일반·특수 건강진단
  "art:산안법:54": ["art:산안법:57", "art:산안법시행규칙:73"],          // 중대재해 보고
  "art:산안법:164": ["art:산안법시행규칙:241"],       // 서류 보존
  "art:산안법:36": ["art:위험성평가-고시:15"],        // 위험성평가 (이미 매핑)
  "art:산안법:29": ["art:산안법시행규칙:26"],         // 안전보건교육 (이미 매핑)
  "art:산안법:38": [],                              // 안전·보건 정보의 제공
  "art:산안법:57": ["art:산안법시행규칙:73"],         // 산업재해 발생 보고 (이미 매핑)

  // 산안법 시행령 → 별표 (시행령 별표 3 안전관리자 선임 인원)
  "art:산안법시행령:16": ["annex:산안법시행령:별표3"],
  "art:산안법시행령:17": ["annex:산안법시행령:별표3"],
  "art:산안법시행령:34": ["annex:산안법시행령:별표7"], // 산안위 구성

  // 중처법 → 시행령
  "art:중처법:4": ["art:중처법시행령:4", "art:중처법시행령:5"],   // 안전보건 확보의무 (이미)
  "art:중처법:5": ["art:중처법시행령:4"],                       // 도급·용역
  "art:중처법:6": ["art:중처법시행령:13"],                      // 처벌
  "art:중처법:7": [],                                         // 양벌
  "art:중처법:13": [],                                        // 형 확정 사실 통보

  // 위험성평가 고시 — 본법 + 시행규칙 위임
  "art:위험성평가-고시:5": [],                               // 정의
  "art:위험성평가-고시:6": [],                               // 근로자 참여
  "art:위험성평가-고시:13": ["art:위험성평가-고시:14"],         // 위험성 결정
  "art:위험성평가-고시:14": [],                              // 위험성 결정
  "art:위험성평가-고시:7": [],                               // 평가 절차
};

(async () => {
  let updated = 0;
  let edges = 0;
  for (const [articleId, delegateTargets] of Object.entries(DELEGATIONS)) {
    if (delegateTargets.length === 0) continue;
    // 파일명 추출
    const m = articleId.match(/^art:([^:]+):(.+)$/);
    if (!m) continue;
    const file = `${m[1]}-§${m[2]}.jsonld`;
    const path = resolve(ARTICLES, file);
    try {
      const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
        delegates?: string[];
      };
      const cur = node.delegates ?? [];
      const merged = Array.from(new Set([...cur, ...delegateTargets]));
      if (merged.length !== cur.length) {
        node.delegates = merged;
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
        updated += 1;
        edges += merged.length - cur.length;
      }
    } catch {
      // 노드 부재 — skip
    }
  }
  console.log(`[done] ${updated} 개 Article 노드 갱신, ${edges} 신규 delegates 엣지 추가`);
})();
