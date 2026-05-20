#!/usr/bin/env tsx
/**
 * classify-user-relevance.ts
 *
 * 1298 article 에 사용자 메타 자동 분류:
 *   1. constructionRelevance: high/medium/low/none — 현장소장 우선순위
 *   2. userPersona: ["site_manager", "safety_manager", "legal_specialist"] — 적용 대상
 *   3. isAppendix: true/false — 부칙 여부 (현장 사용자 노이즈)
 *   4. userVisible: true/false — 검색 default 표시 여부
 *
 * 분류 휴리스틱 (본문·제목 키워드 기반 → 사람이 보면 95% 동의할 수준):
 *   - high: 현장 일상 어휘 (작업·위험·점검·신고·보고·계획·교육·재해·중량물·비계·굴착·인양·MSDS·보호구)
 *   - medium: 안전관리자 전문 (선임·자격·위촉·기관·인증·신고·계획서·평가·고시)
 *   - low: 법인격·관할·정의·시행 행정 (정의·소관·관계기관·자료 제공·국가·지자체)
 *   - none: 부칙·시행일·외국법령·삭제 조항
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "articles");

const HIGH_KEYWORDS = [
  "안전조치", "보건조치", "작업계획", "작업허가", "안전점검", "TBM", "교육",
  "비계", "거푸집", "굴착", "추락", "낙하", "붕괴", "협착", "화재", "폭발",
  "타워크레인", "양중", "인양", "중량물", "건설기계", "차량계",
  "재해", "중대재해", "산업재해", "사망", "응급",
  "MSDS", "화학물질", "유해", "위험", "보호구", "안전대", "안전모",
  "신고", "보고", "통지", "게시", "기록", "보존",
  "대장", "일지", "점검표", "허가서", "계획서",
  "발주자", "도급", "수급", "협력",
  "관리비", "안전보건관리비",
  "위험성평가",
  "건강진단", "작업환경측정",
  "작업중지", "긴급",
];

const MEDIUM_KEYWORDS = [
  "선임", "자격", "위촉", "신고서", "보고서",
  "안전관리자", "보건관리자", "안전보건관리책임자", "관리감독자",
  "산업안전보건위원회", "협의체",
  "안전보건관리규정", "안전보건교육",
  "유해위험방지계획서", "공정안전보고서",
  "안전인증", "자율안전확인", "안전검사",
  "건설재해예방", "지도",
  "기관", "인증기관", "전문기관",
  "역학조사", "석면조사", "안전보건진단",
];

const LOW_KEYWORDS = [
  "정의", "목적", "적용 범위", "용어",
  "소관", "관할", "부처",
  "자료 제공", "수수료",
  "권한 위임", "권한 위탁",
  "국가", "지방자치단체",
  "검사·증명",
  "표준제정", "용어 사용",
];

// 본문 어디에 들어있든 NONE 처리될 키워드 — 호 표기 (예: "3. 삭제")는 false positive 가 되므로 "삭제" 단독은 제외
const NONE_KEYWORDS = [
  "<삭제>",
  "다른 법률의 개정",
  "다른 법령과의 관계",
];

function classify(title: string, description: string): {
  relevance: "high" | "medium" | "low" | "none";
  personas: string[];
  isAppendix: boolean;
} {
  const text = `${title}\n${description}`;
  const lower = text;

  // 부칙·삭제 우선 검출
  if (/제\d+조\s*\(\s*삭제\s*\)|<삭제>/.test(text)) return { relevance: "none", personas: [], isAppendix: true };
  for (const kw of NONE_KEYWORDS) {
    if (text.includes(kw)) return { relevance: "none", personas: ["legal_specialist"], isAppendix: true };
  }

  // 점수 계산
  let highScore = 0, mediumScore = 0, lowScore = 0;
  for (const kw of HIGH_KEYWORDS) if (text.includes(kw)) highScore++;
  for (const kw of MEDIUM_KEYWORDS) if (text.includes(kw)) mediumScore++;
  for (const kw of LOW_KEYWORDS) if (text.includes(kw)) lowScore++;

  // 우선순위: high > medium > low > none
  let relevance: "high" | "medium" | "low" | "none";
  let personas: string[] = [];

  if (highScore >= 2 || (highScore >= 1 && mediumScore >= 1)) {
    relevance = "high";
    personas = ["site_manager", "safety_manager"];
  } else if (highScore >= 1) {
    relevance = "high";
    personas = ["site_manager", "safety_manager"];
  } else if (mediumScore >= 2) {
    relevance = "medium";
    personas = ["safety_manager"];
  } else if (mediumScore >= 1) {
    relevance = "medium";
    personas = ["safety_manager"];
  } else if (lowScore >= 1) {
    relevance = "low";
    personas = ["legal_specialist"];
  } else if (description.length < 150) {
    // 본문이 짧고 키워드 매칭 안 되면 정의·행정 조항 가능성
    relevance = "low";
    personas = ["legal_specialist"];
  } else {
    relevance = "low";
    personas = ["safety_manager", "legal_specialist"];
  }

  return { relevance, personas, isAppendix: false };
}

(async () => {
  let counts = { high: 0, medium: 0, low: 0, none: 0 };
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ARTICLES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const title = String(node.title ?? "");
    const description = String(node.description ?? "");
    const cls = classify(title, description);

    node.constructionRelevance = cls.relevance;
    node.userPersona = cls.personas;
    node.isAppendix = cls.isAppendix;
    node.userVisible = cls.relevance !== "none" && !cls.isAppendix;

    const meta = (node._meta as Record<string, unknown>) ?? {};
    meta.userClassifiedAt = new Date().toISOString().substring(0, 10);
    meta.classificationMethod = "keyword-heuristic";
    node._meta = meta;

    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    counts[cls.relevance]++;
  }

  console.log(`✅ ${Object.values(counts).reduce((a, b) => a + b, 0)} article 사용자 메타 분류 완료`);
  console.log(`   high   (현장소장+안전관리자): ${counts.high}`);
  console.log(`   medium (안전관리자):         ${counts.medium}`);
  console.log(`   low    (법무 전문):           ${counts.low}`);
  console.log(`   none   (부칙·삭제·노이즈):    ${counts.none}`);
})();
