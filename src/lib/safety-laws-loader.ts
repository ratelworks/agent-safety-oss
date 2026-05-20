import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 파일 최상단 상수 — 번들된 법령 MD 디렉터리
// src/ontology/safety-laws/ 하위의 *.md 파일을 런타임에 로드해 grep.
// 파일은 build 결과(dist/ontology/...) 에도 복사되어야 함 (tsconfig/package.json 설정)
const __dirname = dirname(fileURLToPath(import.meta.url));

// src/lib 또는 build/lib 중 어느 쪽에서 실행되어도 taxonomy 디렉터리 찾기
function resolveLawsDir(): string {
  // 1차: 현재 실행 파일 기준 상위의 ontology/safety-laws
  const candidates = [
    resolve(__dirname, "..", "ontology", "safety-laws"),
    resolve(__dirname, "..", "..", "src", "ontology", "safety-laws"),
  ];
  return candidates[0];
}

const LAWS_DIR = resolveLawsDir();

// 파일명 → 법령 식별자 매핑 (검색 결과에 노출)
const LAW_FILES: Record<string, { fileName: string; shortName: string; official: string }> = {
  osha: {
    fileName: "산업안전보건법.md",
    shortName: "산안법",
    official: "산업안전보건법",
  },
  "osha-decree": {
    fileName: "산업안전보건법-시행령.md",
    shortName: "산안법 시행령",
    official: "산업안전보건법 시행령",
  },
  "osha-rule": {
    fileName: "산업안전보건법-시행규칙.md",
    shortName: "산안법 시행규칙",
    official: "산업안전보건법 시행규칙",
  },
  "osha-standard": {
    fileName: "산업안전보건기준에-관한-규칙.md",
    shortName: "산안기준규칙",
    official: "산업안전보건기준에 관한 규칙",
  },
  "severe-accident": {
    fileName: "중대재해처벌법.md",
    shortName: "중처법",
    official: "중대재해 처벌 등에 관한 법률",
  },
  "risk-assessment-notice": {
    fileName: "위험성평가-고시-2024-76.md",
    shortName: "위험성평가 고시",
    official: "사업장 위험성평가에 관한 지침 (고용노동부 고시 제2024-76호, 시행 2025-01-02)",
  },
  // 그래프 article 본문 → MD 통일 (a-codex 권고: "MD 6 + graph 2" 분리 표현 제거)
  "severe-accident-decree": {
    fileName: "중대재해처벌법-시행령.md",
    shortName: "중처법 시행령",
    official: "중대재해 처벌 등에 관한 법률 시행령",
  },
  "ctpa-art62": {
    fileName: "건설기술진흥법-§62영역.md",
    shortName: "건진법 §62 영역",
    official: "건설기술 진흥법 — 안전관리 핵심 영역 (§62 + 시행령 §98 + 시행규칙 §58)",
  },
};

export type LawCode = keyof typeof LAW_FILES;

// ───── 캐시 (프로세스 메모리) ─────
const FILE_CACHE = new Map<LawCode, string>();

async function loadLawFile(code: LawCode): Promise<string> {
  if (FILE_CACHE.has(code)) return FILE_CACHE.get(code)!;
  const meta = LAW_FILES[code];
  const path = resolve(LAWS_DIR, meta.fileName);
  const content = await readFile(path, "utf8");
  FILE_CACHE.set(code, content);
  return content;
}

// ───── Public API ─────

export interface LawMeta {
  code: LawCode;
  shortName: string;
  official: string;
  fileName: string;
}

// MD 헤더 인용 블록(> **Key**: Value) 에서 파싱되는 메타
export interface LawHeaderMeta {
  sourceUrl?: string;
  currentLawId?: string; // "현행 법률" / "현행 시행" / "공포일" 등의 원문
  enforcementDate?: string; // 시행일
  lastSyncedAt?: string;
  manualReviewRequired?: string; // "예 (...)" / "아니오 (...)" / "부분 (...)"
  nextReviewDue?: string;
  reviewStatus?: "verified" | "partial" | "needs_review" | "unknown";
}

export interface LawArticle {
  lawCode: LawCode;
  lawShortName: string;
  ref: string;
  title: string;
  body: string; // Markdown 원문 섹션 (## 헤딩 포함)
}

export function listLaws(): LawMeta[] {
  return (Object.keys(LAW_FILES) as LawCode[]).map((code) => ({
    code,
    shortName: LAW_FILES[code].shortName,
    official: LAW_FILES[code].official,
    fileName: LAW_FILES[code].fileName,
  }));
}

// MD 상단 인용 블록(> **key**: value) 에서 검토 상태 메타를 파싱
export async function getLawHeaderMeta(code: LawCode): Promise<LawHeaderMeta> {
  const md = await loadLawFile(code);
  // 상단부 50줄만 스캔
  const head = md.split(/\r?\n/).slice(0, 50).join("\n");

  const pick = (label: string): string | undefined => {
    // 예: "> **마지막 동기화**: 2026-04-24 (부가 설명)"
    const re = new RegExp(
      `>\\s*\\*\\*${escapeRegex(label)}\\*\\*\\s*:\\s*([^\\n]+)`,
      "m",
    );
    const m = head.match(re);
    return m ? m[1].trim() : undefined;
  };

  const sourceUrl = pick("출처 URL") ?? pick("링크");
  const currentLawId =
    pick("현행 법률") ??
    pick("현행 시행") ??
    pick("현행") ??
    pick("공포일");
  const enforcementDate = pick("시행일") ?? pick("현행 시행");
  const lastSyncedAt = pick("마지막 동기화");
  const manualReviewRequired = pick("검토 필요 여부");
  const nextReviewDue = pick("다음 검토 권장");

  // 상태 플래그 유도 — 마크다운 강조(**), 백틱 등 제거 후 판정
  let reviewStatus: LawHeaderMeta["reviewStatus"] = "unknown";
  if (manualReviewRequired) {
    const s = manualReviewRequired
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .trim()
      .toLowerCase();
    if (s.startsWith("아니오") || s.startsWith("no") || s.startsWith("완료") || s.includes("verified")) reviewStatus = "verified";
    else if (s.startsWith("부분") || s.includes("partial")) reviewStatus = "partial";
    else if (s.startsWith("예") || s.startsWith("yes")) reviewStatus = "needs_review";
  }

  return {
    sourceUrl,
    currentLawId,
    enforcementDate,
    lastSyncedAt,
    manualReviewRequired,
    nextReviewDue,
    reviewStatus,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 단일 법령의 모든 조문 섹션 추출
// "## §N ..." 헤딩 경계로 split 후 각 섹션을 조문으로 인식
export async function extractAllArticles(code: LawCode): Promise<LawArticle[]> {
  const md = await loadLawFile(code);
  const meta = LAW_FILES[code];

  // 첫 헤더(문서 메타) 제외, 각 `## §...` 블록 분리
  // 주의: `## §` 로 시작하는 줄만 경계로 인정 (법령 메타의 "## 적용 범위" 같은 일반 섹션과 구분)
  const parts = md.split(/\n(?=##\s+§)/g);
  const articles: LawArticle[] = [];

  for (const part of parts) {
    if (!part.startsWith("## §")) continue;
    // 헤더 한 줄 + 본문
    const newlineIdx = part.indexOf("\n");
    if (newlineIdx === -1) continue;
    const headerLine = part.slice(0, newlineIdx).trim();
    const bodyInner = part.slice(newlineIdx + 1).trim();

    // "## §38 사전조사 및 ..." → ref=§38, title=사전조사 및 ...
    const headerMatch = headerLine.match(/^##\s+(§[^\s(]+)\s*(.*)$/);
    if (!headerMatch) continue;
    const ref = headerMatch[1];
    const title = headerMatch[2].trim();

    articles.push({
      lawCode: code,
      lawShortName: meta.shortName,
      ref,
      title,
      body: `## ${ref} ${title}\n\n${bodyInner}`.trim(),
    });
  }
  return articles;
}

// 전체 법령에서 조문 검색
export async function searchArticles(
  query: string,
  options: { lawCode?: LawCode; limit?: number } = {},
): Promise<LawArticle[]> {
  const { lawCode, limit = 20 } = options;
  const targetCodes = lawCode ? [lawCode] : (Object.keys(LAW_FILES) as LawCode[]);
  const q = query.trim().toLowerCase();
  const results: LawArticle[] = [];

  for (const code of targetCodes) {
    const articles = await extractAllArticles(code);
    for (const article of articles) {
      const haystack = `${article.ref} ${article.title} ${article.body}`.toLowerCase();
      if (q && !haystack.includes(q)) continue;
      results.push(article);
      if (results.length >= limit) return results;
    }
  }
  return results;
}

// 특정 조문 조회
// ref 는 "산안법 §36", "§36", "산업안전보건법 §36", "산안기준규칙 §38" 등 다양한 표기 허용
export async function getArticle(ref: string, lawHint?: LawCode): Promise<LawArticle | null> {
  const refNormalized = normalizeRef(ref);
  const refSuffix = refNormalized.refShort; // "§36"
  const codeHint = lawHint ?? guessLawCodeFromRef(refNormalized.lawPart);

  const candidateCodes: LawCode[] = codeHint
    ? [codeHint]
    : (Object.keys(LAW_FILES) as LawCode[]);

  for (const code of candidateCodes) {
    const articles = await extractAllArticles(code);
    const hit = articles.find((a) => a.ref === refSuffix);
    if (hit) return hit;
  }
  return null;
}

// ───── ref 파싱 ─────

function normalizeRef(raw: string): { lawPart: string; refShort: string } {
  const trimmed = raw.trim();
  // "§N" 부분 추출
  const m = trimmed.match(/(§[\d가-힣·\-]+)/);
  const refShort = m ? m[1] : trimmed;
  const lawPart = trimmed.replace(refShort, "").trim();
  return { lawPart, refShort };
}

function guessLawCodeFromRef(lawPart: string): LawCode | undefined {
  if (!lawPart) return undefined;
  const lp = lawPart.toLowerCase();
  // 순서 중요 — 더 구체적인 매칭 우선
  if (lp.includes("기준") || lp.includes("standard")) return "osha-standard";
  if (lp.includes("시행령") || lp.includes("decree")) return "osha-decree";
  if (lp.includes("시행규칙") || lp.includes("rule")) return "osha-rule";
  if (lp.includes("중처") || lp.includes("중대재해")) return "severe-accident";
  if (lp.includes("위험성평가") || lp.includes("고시") || lp.includes("2024-76"))
    return "risk-assessment-notice";
  if (lp.includes("산안") || lp.includes("산업안전")) return "osha";
  return undefined;
}
