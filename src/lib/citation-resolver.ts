/**
 * citation-resolver.ts — 법령 인용이 수록 자료에 실제로 있는지 세 가지로 판정한다
 *
 *   confirmed     수록 자료(그래프의 조문·별표 노드)에 있다
 *   not_found     그 법령은 전 조문이 수록돼 있는데 해당 조문이 없다 → 존재하지 않는 조문
 *   unverifiable  수록 범위 밖이라 확인할 수 없다 (수록하지 않은 법령, 일부만 수록한 법령, 읽지 못한 표기)
 *
 * "수록 자료에 없음"을 곧 "틀림"으로 보지 않는다. 전 조문이 수록된 법령에서만 없음을 단정한다.
 */

import { ensureGraphBuilt, getNodeSync, listArticleIds } from "./graph-nodes-loader.js";
import { legalRefToIri } from "./article-iri-map.js";

// ── 상수 ────────────────────────────────────────────────────────────
/** "산안법 제36조의2", "기준규칙 §38", "산안기준규칙 별표 4" */
const REFERENCE_PATTERN = /^(.*?)\s*(?:제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|§\s*(\d+)(?:\s*의\s*(\d+))?|(별표\s*\d+(?:\s*\d+호)?))/;

export type CitationOutcome = "confirmed" | "not_found" | "unverifiable";

export interface CitationResolution {
  outcome: CitationOutcome;
  /** 확인된 노드 주소 (confirmed 일 때) */
  iri?: string;
  /** 확인된 조문·별표의 제목 */
  title?: string;
  /** 판정 사유 (confirmed 가 아닐 때) */
  reason?: string;
  /** 대조하지 않은 부분 — 범위의 중간 조문, 항·호 */
  detailNote?: string;
}

let fullCoverage: Set<string> | null = null;

/** 본조 번호가 1번부터 빠짐없이 수록된 법령 — 여기서만 "없는 조문"을 단정할 수 있다 */
async function fullyCoveredLaws(): Promise<Set<string>> {
  if (fullCoverage) return fullCoverage;
  const numbersByLaw = new Map<string, Set<number>>();
  for (const id of await listArticleIds()) {
    const [, law, number] = id.split(":");
    if (!law || !/^\d+$/.test(number ?? "")) continue;
    const set = numbersByLaw.get(law) ?? new Set<number>();
    set.add(Number(number));
    numbersByLaw.set(law, set);
  }
  const covered = new Set<string>();
  for (const [law, numbers] of numbersByLaw) {
    const max = Math.max(...numbers);
    if (numbers.size === max) covered.add(law);
  }
  fullCoverage = covered;
  return covered;
}

/** 법령명과 조문 번호로 판정한다 — article 은 "§36", "§36의2", "별표 4" 형태 */
export async function resolveCitation(law: string, article: string): Promise<CitationResolution> {
  await ensureGraphBuilt();
  const mapped = legalRefToIri(law, article);
  if (!mapped.canonical) {
    return { outcome: "unverifiable", reason: `'${law}' 은(는) 수록하지 않은 법령 — 이 도구의 자료로는 확인할 수 없음 (법제처 원문 확인 필요)` };
  }
  if (!mapped.iri) {
    return { outcome: "unverifiable", reason: `'${article}' 에서 조문 번호를 읽지 못함` };
  }
  // 가지 조문(제36조의2)은 주소에 "의N" 이 붙는다
  const branch = /§\s*\d+\s*의\s*(\d+)/.exec(article);
  const iri = branch && mapped.kind === "Article" ? `${mapped.iri}의${branch[1]}` : mapped.iri;
  const node = getNodeSync(iri) as { title?: string } | undefined;
  if (node) return { outcome: "confirmed", iri, title: node.title };
  if (mapped.kind === "Article" && (await fullyCoveredLaws()).has(mapped.canonical)) {
    return { outcome: "not_found", reason: `${mapped.canonical} 은(는) 전 조문이 수록돼 있으나 '${article}' 조문이 없음 — 존재하지 않는 조문으로 판단` };
  }
  return { outcome: "unverifiable", reason: `${mapped.canonical} 은(는) 일부만 수록돼 있어 '${article}' 의 실존 여부를 확인할 수 없음 (법제처 원문 확인 필요)` };
}

/** 표기에서 조문 번호를 모두 뽑는다 — "제36조", "제37조의2", "§38" */
const ARTICLE_TOKEN = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|§\s*(\d+)(?:\s*의\s*(\d+))?/g;
/** 항·호·목 표기 — 수록 자료가 조문 단위라 대조하지 않는다 */
const SUB_ITEM = /제?\s*\d+\s*(항|호)|[①-⑳]|[가-하]목/;
/** 범위 표기 — "부터 …까지", "내지", "~" */
const RANGE_MARK = /부터|내지|~|∼|-\s*(?:제|§)/;
const SUB_ITEM_GLOBAL = /제?\s*\d+\s*(항|호)|[①-⑳]|[가-하]목/g;
/** 조문 사이를 잇는 말 — 법령명이 아니다 */
const CONNECTORS = /부터|까지|내지|및|또는|와|과|[,·ㆍ~∼\-()\s]/g;
const OUTCOME_RANK: Record<CitationOutcome, number> = { confirmed: 0, unverifiable: 1, not_found: 2 };

/**
 * "산안법 제36조" 같은 한 줄 표기를 읽어 판정한다.
 * 표기에 조문이 여러 개(나열·범위의 양 끝)면 모두 확인해 가장 나쁜 결과를 돌려준다.
 * 범위의 중간 조문과 항·호는 대조하지 않으며, 그 사실을 detailNote 로 알린다.
 */
export async function resolveReference(reference: string): Promise<CitationResolution> {
  const text = reference.trim();
  const m = REFERENCE_PATTERN.exec(text);
  if (!m) return { outcome: "unverifiable", reason: `'${reference}' 에서 법령명과 조문 번호를 읽지 못함` };
  const law = m[1].trim();
  if (!law) return { outcome: "unverifiable", reason: `'${reference}' 에 법령명이 없음` };
  if (m[6]) return resolveCitation(law, m[6]);

  // 조문마다 바로 앞에 적힌 법령명을 따른다 — "산안법 제36조, 기준규칙 제38조".
  // 법령명 없이 이어 적은 조문("제36조, 제38조")만 앞 법령을 물려받는다.
  const rest = text;
  const articles: string[] = [];
  let worst: CitationResolution | null = null;
  let first: CitationResolution | null = null;
  let currentLaw = "";
  let cursor = 0;
  const seen = new Set<string>();
  for (const t of text.matchAll(ARTICLE_TOKEN)) {
    const between = text.slice(cursor, t.index).replace(SUB_ITEM_GLOBAL, " ").replace(CONNECTORS, " ").trim();
    cursor = (t.index ?? 0) + t[0].length;
    if (between !== "") currentLaw = between;
    const number = t[1] ?? t[3];
    const sub = t[2] ?? t[4];
    const article = sub ? `§${number}의${sub}` : `§${number}`;
    articles.push(article);
    const key = `${currentLaw}|${article}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved: CitationResolution = currentLaw === "" ? { outcome: "unverifiable", reason: `'${reference}' 에 법령명이 없음` } : await resolveCitation(currentLaw, article);
    first ??= resolved;
    if (!worst || OUTCOME_RANK[resolved.outcome] > OUTCOME_RANK[worst.outcome]) worst = resolved;
  }
  if (!worst || !first) return { outcome: "unverifiable", reason: `'${reference}' 에서 조문 번호를 읽지 못함` };
  const notes: string[] = [];
  if (RANGE_MARK.test(rest) && articles.length > 1) notes.push("범위의 양 끝 조문만 대조함(중간 조문은 대조하지 않음)");
  if (SUB_ITEM.test(rest.replace(ARTICLE_TOKEN, ""))) notes.push("항·호는 대조하지 않음(조문 단위로만 확인)");
  const result = worst.outcome === "confirmed" ? first : worst;
  return notes.length > 0 ? { ...result, detailNote: notes.join(" · ") } : result;
}
