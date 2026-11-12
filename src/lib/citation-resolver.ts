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

/** 인용 한 건 — 조문("제36조", "제37조의2", "§38") 또는 별표("별표 4", "별표 4 6호") */
const CITATION_TOKEN = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|§\s*(\d+)(?:\s*의\s*(\d+))?|(별표\s*\d+(?:\s*\d+호)?)/g;
/** 항·호·목 표기 — 수록 자료가 조문 단위라 대조하지 않는다 */
const SUB_ITEM = /제?\s*\d+\s*(?:항|호)|[①-⑳]|[가-하]목/g;
/** 괄호 안 부연(조문 제목 등) */
const PARENTHETICAL = /\([^()]*\)/g;
/** 인용 사이를 잇는 말과 부호 — 법령명이 아니다 */
const CONNECTORS = /부터|까지|내지|및|또는|[,·ㆍ~∼\s]/g;
const RANGE_MARK = /부터|내지|[~∼]/;
const OUTCOME_RANK: Record<CitationOutcome, number> = { confirmed: 0, unverifiable: 1, not_found: 2 };

/** 인용 사이 글자에서 부연·항호·연결어를 걷어 내고 남는 것(법령명 후보) */
function residue(text: string): { rest: string; hadSubItem: boolean; hadRange: boolean } {
  const withoutParens = text.replace(PARENTHETICAL, " ");
  const hadSubItem = new RegExp(SUB_ITEM.source).test(withoutParens);
  const hadRange = RANGE_MARK.test(withoutParens);
  return { rest: withoutParens.replace(SUB_ITEM, " ").replace(CONNECTORS, " ").trim().replace(/\s+/g, " "), hadSubItem, hadRange };
}

/**
 * "산안법 제36조" 같은 한 줄 표기를 읽어 판정한다.
 *
 * 원칙: 표기 전체를 법령명·조문·별표로 빠짐없이 읽었을 때만 confirmed 를 낸다.
 *   - 인용(조문·별표)마다 바로 앞에 적힌 법령명을 따른다. 법령명 없이 이어 적은 인용만 앞 법령을 물려받는다.
 *   - 인용이 여러 개면 모두 확인해 가장 나쁜 결과를 돌려준다.
 *   - 읽지 못한 글자가 남으면 unverifiable (일부만 확인하고 전체를 확인됨으로 하지 않는다).
 *   - 범위의 중간 조문과 항·호는 대조하지 않으며 detailNote 로 알린다.
 */
export async function resolveReference(reference: string): Promise<CitationResolution> {
  const text = reference.trim();
  let worst: CitationResolution | null = null;
  let first: CitationResolution | null = null;
  let currentLaw = "";
  let cursor = 0;
  let count = 0;
  let hadSubItem = false;
  let hadRange = false;
  let lastTitle = "";
  const consider = (resolved: CitationResolution): void => {
    first ??= resolved;
    if (!worst || OUTCOME_RANK[resolved.outcome] > OUTCOME_RANK[worst.outcome]) worst = resolved;
  };

  for (const t of text.matchAll(CITATION_TOKEN)) {
    const between = residue(text.slice(cursor, t.index));
    cursor = (t.index ?? 0) + t[0].length;
    hadSubItem ||= between.hadSubItem;
    hadRange ||= between.hadRange;
    if (between.rest !== "") currentLaw = between.rest;
    count += 1;
    const number = t[1] ?? t[3];
    const sub = t[2] ?? t[4];
    const article = number ? (sub ? `§${number}의${sub}` : `§${number}`) : t[5];
    const resolved: CitationResolution = currentLaw === "" ? { outcome: "unverifiable", reason: `'${reference}' 에 법령명이 없음` } : await resolveCitation(currentLaw, article);
    lastTitle = resolved.title ?? "";
    consider(resolved);
  }
  if (count === 0) return { outcome: "unverifiable", reason: `'${reference}' 에서 법령명과 조문 번호를 읽지 못함` };

  const tail = residue(text.slice(cursor));
  hadSubItem ||= tail.hadSubItem;
  // 마지막 인용 뒤에 그 조문의 제목을 적은 것은 읽은 것으로 본다 ("산안법 제36조 위험성평가의 실시")
  const compact = (v: string): string => v.replace(/\s+/g, "");
  const isTitle = lastTitle !== "" && compact(lastTitle).includes(compact(tail.rest));
  if (tail.rest !== "" && !isTitle) consider({ outcome: "unverifiable", reason: `'${reference}' 의 '${tail.rest}' 부분을 읽지 못함` });

  const settled = worst as CitationResolution | null;
  const head = first as CitationResolution | null;
  if (!settled || !head) return { outcome: "unverifiable", reason: `'${reference}' 에서 조문 번호를 읽지 못함` };
  const notes: string[] = [];
  if (hadRange && count > 1) notes.push("범위의 양 끝 조문만 대조함(중간 조문은 대조하지 않음)");
  if (hadSubItem) notes.push("항·호는 대조하지 않음(조문 단위로만 확인)");
  const result = settled.outcome === "confirmed" ? head : settled;
  return notes.length > 0 ? { ...result, detailNote: notes.join(" · ") } : result;
}
