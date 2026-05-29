// ─────────────────────────────────────────────────────────────────────────────
// law-body-extractor.ts (v0.8 결함 #2 정정)
//
// 7 법령 .md 본문에서 §N 섹션을 추출하여 generate 출력에 발췌 포함.
// IRI → 본문 텍스트 매핑.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// build 환경 우선, src fallback
const ROOT = resolve(__dirname, "..", "..");
const LAWS_DIR_BUILD = resolve(ROOT, "build", "ontology", "safety-laws");
const LAWS_DIR_SRC = resolve(ROOT, "src", "ontology", "safety-laws");

// 교차 검증 재평가 정정: 중처법시행령 별도 .md 미보유 → KNOWN_NOT_INCLUDED 처리 (본법 오매핑 제거)
const LAW_FILE_MAP: Record<string, string> = {
  "기준규칙": "산업안전보건기준에-관한-규칙.md",
  "산안법": "산업안전보건법.md",
  "산안법시행령": "산업안전보건법-시행령.md",
  "산안법시행규칙": "산업안전보건법-시행규칙.md",
  "중처법": "중대재해처벌법.md",
  "위험성평가-고시": "위험성평가-고시-2024-76.md",
};

// 본 OSS 7 법령 .md 에 미수록된 조문 (있다고 알려져 있어도 본문 발췌 불가)
// 중처법시행령은 별도 .md 미보유 → 모든 §N 미수록 처리 (prefix 매칭)
const KNOWN_NOT_INCLUDED: Set<string> = new Set([
  "art:중처법시행령:4", // 중처법 시행령 §4 (안전보건경영방침)
  "art:중처법시행령:5", // 중처법 시행령 §5 (9대 의무)
  // v0.11 추가 — 현장 작성 5종 신규 시드 후 본문 미수록 조문
  "art:산안법:19", "art:산안법:32", "art:산안법:34", "art:산안법:37", "art:산안법:75",
  "art:산안법시행규칙:35", "art:산안법시행규칙:38", "art:산안법시행규칙:43", "art:산안법시행규칙:74",
  "art:산안법:175", // 처벌 조항 (산안법.md에 §175 본문 미수록 — penaltyOnMissing 으로 처리)
  "art:산안법:167",
  "art:기준규칙:242",
  "art:기준규칙:319",
  "art:기준규칙:35",
  "art:기준규칙:30",
  "art:기준규칙:32",
  "art:기준규칙:241",
  "art:기준규칙:620",
  "art:산안법:54",
  "art:산안법:62",
  "art:산안법:64",
  "art:산안법:72",
  "art:산안법:110",
  "art:산안법:125",
  "art:산안법:129",
  "art:산안법:130",
  "art:산안법:131",
  "art:산안법:44",
  "art:산안법:15",
  "art:산안법:17",
  "art:산안법:18",
]);

export function isKnownNotIncluded(iri: string): boolean {
  // 항 번호(#N) 제거 후 비교
  const baseIri = iri.replace(/#\d+$/, "");
  return KNOWN_NOT_INCLUDED.has(baseIri);
}

const cache = new Map<string, string>();

async function loadLawText(lawSlug: string): Promise<string | undefined> {
  if (cache.has(lawSlug)) return cache.get(lawSlug);
  const fileName = LAW_FILE_MAP[lawSlug];
  if (!fileName) return undefined;
  for (const dir of [LAWS_DIR_BUILD, LAWS_DIR_SRC]) {
    try {
      const text = await readFile(resolve(dir, fileName), "utf8");
      cache.set(lawSlug, text);
      return text;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * 본문 발췌 — IRI(art:기준규칙:38 또는 art:기준규칙:38#2) → 해당 §N (또는 §N ②항) 본문 첫 N자.
 *
 * @param iri art:lawSlug:articleNo[의M][#N항] 형식
 * @param maxChars 발췌 최대 글자수 (기본 400)
 *
 * 교차 검증 BLOCKER #4: 항 번호(#N) 처리 추가, 미수록 조문 명시
 */
async function loadArticleNodeDescription(iri: string): Promise<string | undefined> {
  // 그래프 노드의 description fallback 로더 (law .md 미수록 조문 보강)
  const m = iri.match(/^art:([^:]+):(\d+)(?:의(\d+))?$/);
  if (!m) return undefined;
  const lawSlug = m[1];
  const articleNo = m[2];
  const branch = m[3];
  const fileName = branch ? `${lawSlug}-§${articleNo}의${branch}.jsonld` : `${lawSlug}-§${articleNo}.jsonld`;
  // build/src 양쪽 시도
  const candidates = [
    resolve(ROOT, "build", "ontology", "graph", "nodes", "articles", fileName),
    resolve(ROOT, "src", "ontology", "graph", "nodes", "articles", fileName),
  ];
  for (const path of candidates) {
    try {
      const text = await readFile(path, "utf8");
      const node = JSON.parse(text) as { description?: string };
      if (node.description && node.description.trim()) return node.description;
    } catch { /* 다음 후보 */ }
  }
  return undefined;
}

export async function extractArticleBody(iri: string, maxChars = 400): Promise<string | undefined> {
  if (!iri.startsWith("art:")) return undefined;
  // 본 OSS .md 에 명시적으로 *수록되지 않은* 조문은 그래프 노드 description fallback
  if (isKnownNotIncluded(iri)) {
    const fromNode = await loadArticleNodeDescription(iri);
    if (fromNode) {
      const body = fromNode.length > maxChars ? fromNode.slice(0, maxChars).trimEnd() + "…" : fromNode;
      return body;
    }
    return `(본 OSS 7 법령 번들에 본문 미수록 — 법제처 국가법령정보센터에서 ${iri.replace(/^art:/, "")} 조회)`;
  }
  const m = iri.match(/^art:([^:]+):(\d+)(?:의(\d+))?(?:#(\d+))?$/);
  if (!m) return undefined;
  const lawSlug = m[1];
  const articleNo = m[2];
  const branch = m[3];
  const hangNo = m[4]; // 항 번호 (#2 → "2")
  const text = await loadLawText(lawSlug);
  if (!text) {
    // .md 자체가 없으면 그래프 노드 fallback
    const fromNode = await loadArticleNodeDescription(iri);
    if (fromNode) return fromNode.length > maxChars ? fromNode.slice(0, maxChars).trimEnd() + "…" : fromNode;
    return undefined;
  }

  // ## §N 또는 ## §N의M (조문 헤더). 교차 검증 BLOCKER 정정: EOF 종결 조건 추가
  const headerKey = branch ? `§${articleNo}의${branch}` : `§${articleNo}`;
  const re = new RegExp(`## ${headerKey}\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n## §|\\n---|$)`, "u");
  const match = text.match(re);
  if (!match) {
    // .md에 § 헤더 없으면 그래프 노드 fallback
    const fromNode = await loadArticleNodeDescription(iri);
    if (fromNode) return fromNode.length > maxChars ? fromNode.slice(0, maxChars).trimEnd() + "…" : fromNode;
    return undefined;
  }
  let body = match[1].trim();
  // 마크다운 메타 라인 제거 (>로 시작, ⚠ 정정 안내 등)
  body = body
    .split("\n")
    .filter((l) => !l.startsWith(">") && l.trim() !== "")
    .join("\n");

  // 항 번호 지정 시 — 해당 항(①②③ 등)부터 다음 항까지만 추출
  if (hangNo) {
    const HANG_SYMBOLS: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤", "6": "⑥", "7": "⑦", "8": "⑧" };
    const hangSym = HANG_SYMBOLS[hangNo];
    if (hangSym) {
      const hangRe = new RegExp(`(${hangSym}[\\s\\S]*?)(?=\\n[②③④⑤⑥⑦⑧]|$)`, "u");
      const hangMatch = body.match(hangRe);
      if (hangMatch) body = hangMatch[1].trim();
    }
  }

  if (body.length > maxChars) {
    body = body.slice(0, maxChars).trimEnd() + "…";
  }
  return body;
}

/**
 * Annex (별표) 본문 발췌 — annex:lawSlug:별표N-M호 형식.
 */
export async function extractAnnexBody(iri: string, maxChars = 400): Promise<string | undefined> {
  if (!iri.startsWith("annex:")) return undefined;
  const m = iri.match(/^annex:([^:]+):별표(\d+)(?:-(.+))?$/);
  if (!m) return undefined;
  const lawSlug = m[1];
  const annexNo = m[2];
  const sub = m[3];
  const text = await loadLawText(lawSlug);
  if (!text) return undefined;

  // [N호] 패턴 찾기 (별표 4 제6호 → [6호])
  if (sub) {
    const subNo = sub.replace(/호$/, "");
    const subRe = new RegExp(`\\*\\*\\[${subNo}호\\][^*]*\\*\\*\\n([\\s\\S]*?)(?=\\n\\*\\*\\[\\d+호\\]|\\n---|\\n## )`, "u");
    const subMatch = text.match(subRe);
    if (subMatch) {
      let body = subMatch[1].trim();
      if (body.length > maxChars) body = body.slice(0, maxChars).trimEnd() + "…";
      return body;
    }
  }
  // 일반 별표 N
  const re = new RegExp(`## §\\d+ \\[별표 ${annexNo}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## §|\\n---)`, "u");
  const match = text.match(re);
  if (!match) return undefined;
  let body = match[1].trim();
  if (body.length > maxChars) body = body.slice(0, maxChars).trimEnd() + "…";
  return body;
}
