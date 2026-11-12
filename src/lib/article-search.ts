/**
 * article-search.ts — 현장 말로 쓴 문장에서 관련 조문을 찾는다
 *
 * 왜 따로 두나
 *   현장 말("아래로 던진다")과 조문 말("물체를 투하")은 낱말이 다르다. 조문 제목·본문만 보면 못 찾는다.
 *   공종 자료에는 현장 말로 쓴 위험·대책 문장과 그 근거 조문이 짝지어 있다 — 그 문장을 조문의 검색 글에 붙인다.
 *   공종 자료가 인용하지 않는 조문은 field-phrases.json 의 현장 말 문장(조문이 걸리는 상황을 현장 말로 적은 것)을 붙인다.
 *   낱말 대신 글자 두 개 단위로 견준다 (조사·어미가 붙어도 겹치는 부분이 남는다).
 *   점수는 BM25 — 어느 조문에나 나오는 글자 쌍은 가볍게, 드문 글자 쌍은 무겁게 센다.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
/** BM25 낱말 빈도 포화 */
const K1 = 1.2;
/** BM25 글 길이 보정 */
const B = 0.75;
/** 제목은 본문보다 무겁게 — 제목을 이만큼 되풀이해 넣는다 */
const TITLE_REPEAT = 2;
/** 조문별 현장 말 문장 — 조문 본문에 없는 현장 표현을 검색 글에 더한다 (편집자가 쓴 글, 현장 검토 전) */
const FIELD_PHRASES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "ontology", "field-phrases.json");
/** 고시·지침(권고 기준)의 법령 종류 값 — 의무 조문 검색에서 뺀다 (지침은 공종 구획의 "함께 볼 지침"으로 따로 나온다) */
const NOTIFICATION_TYPE = "Notification";
/** 조문 주소 머리말 */
const ARTICLE_PREFIX = "art:";
/** 공종 주소 머리말 */
const SUBTASK_PREFIX = "subtask:";

type Node = Record<string, unknown>;

interface SubtaskSteps {
  steps?: {
    stepHazards?: {
      risks?: { statement?: string; measures?: { measure?: string; basis?: { basisArticle?: string } }[] }[];
    }[];
  }[];
}

export interface ArticleHit {
  iri: string;
  score: number;
}

interface ArticleIndex {
  /** 조문별 글자 쌍 빈도 */
  docs: Map<string, Map<string, number>>;
  /** 조문별 글 길이 (글자 쌍 수) */
  lengths: Map<string, number>;
  /** 글자 쌍이 나오는 조문 수 */
  docFreq: Map<string, number>;
  avgLength: number;
}

const indexCache = new WeakMap<Node[], ArticleIndex>();
let fieldPhrasesCache: Record<string, string[]> | null = null;

/** 조문 주소 → 현장 말 문장. 파일이 없거나 깨졌으면 빈 값 (검색은 조문 본문과 공종 문장만으로 돈다) */
export async function loadFieldPhrases(): Promise<Record<string, string[]>> {
  if (fieldPhrasesCache) return fieldPhrasesCache;
  try {
    const data = JSON.parse(await readFile(FIELD_PHRASES_PATH, "utf-8")) as { phrases?: Record<string, string[]> };
    fieldPhrasesCache = data.phrases ?? {};
  } catch {
    fieldPhrasesCache = {};
  }
  return fieldPhrasesCache;
}

/** 글에서 한글·영문·숫자만 남기고 글자 두 개 단위로 자른다 */
function bigrams(text: string): string[] {
  const out: string[] = [];
  // 띄어쓰기·기호로 끊긴 토막 안에서만 자른다 (낱말 경계를 넘는 쌍은 뜻이 없다)
  for (const chunk of text.split(/[^가-힣A-Za-z0-9]+/)) {
    for (let i = 0; i < chunk.length - 1; i++) out.push(chunk.slice(i, i + 2));
  }
  return out;
}

function isSearchable(node: Node): boolean {
  const id = node["@id"];
  return (
    typeof id === "string" &&
    id.startsWith(ARTICLE_PREFIX) &&
    node.legislationType !== NOTIFICATION_TYPE &&
    node.userVisible !== false &&
    !node.isAppendix &&
    node.constructionRelevance !== "none"
  );
}

/** 공종 자료에서 조문별 현장 문장(위험 + 대책)을 모은다 */
function collectFieldText(nodes: Node[]): Map<string, string[]> {
  const byArticle = new Map<string, string[]>();
  for (const node of nodes) {
    const id = node["@id"];
    if (typeof id !== "string" || !id.startsWith(SUBTASK_PREFIX)) continue;
    for (const step of (node as SubtaskSteps).steps ?? []) {
      for (const slot of step.stepHazards ?? []) {
        for (const risk of slot.risks ?? []) {
          for (const m of risk.measures ?? []) {
            const art = m.basis?.basisArticle;
            if (!art) continue;
            const list = byArticle.get(art) ?? [];
            list.push(`${risk.statement ?? ""} ${m.measure ?? ""}`);
            byArticle.set(art, list);
          }
        }
      }
    }
  }
  return byArticle;
}

function buildIndex(nodes: Node[], phrases: Record<string, string[]>): ArticleIndex {
  const fieldText = collectFieldText(nodes);
  const docs = new Map<string, Map<string, number>>();
  const lengths = new Map<string, number>();
  const docFreq = new Map<string, number>();
  let total = 0;
  for (const node of nodes) {
    if (!isSearchable(node)) continue;
    const iri = node["@id"] as string;
    const title = typeof node.title === "string" ? node.title : "";
    const body = typeof node.description === "string" ? node.description : "";
    const text = [...Array<string>(TITLE_REPEAT).fill(title), body, ...(fieldText.get(iri) ?? []), ...(phrases[iri] ?? [])].join("\n");
    const counts = new Map<string, number>();
    const grams = bigrams(text);
    for (const g of grams) counts.set(g, (counts.get(g) ?? 0) + 1);
    docs.set(iri, counts);
    lengths.set(iri, grams.length);
    total += grams.length;
    for (const g of counts.keys()) docFreq.set(g, (docFreq.get(g) ?? 0) + 1);
  }
  return { docs, lengths, docFreq, avgLength: docs.size > 0 ? total / docs.size : 0 };
}

/**
 * 문장과 가까운 조문을 점수 높은 순으로 돌려준다.
 * @param nodes 그래프 노드 전체 (조문과 공종을 함께 본다)
 */
export async function searchArticles(nodes: Node[], query: string, limit: number): Promise<ArticleHit[]> {
  let index = indexCache.get(nodes);
  if (!index) {
    index = buildIndex(nodes, await loadFieldPhrases());
    indexCache.set(nodes, index);
  }
  const queryGrams = new Set(bigrams(query));
  if (queryGrams.size === 0 || index.docs.size === 0) return [];
  const n = index.docs.size;
  const hits: ArticleHit[] = [];
  for (const [iri, counts] of index.docs) {
    const length = index.lengths.get(iri) ?? 0;
    let score = 0;
    for (const g of queryGrams) {
      const tf = counts.get(g);
      if (!tf) continue;
      const df = index.docFreq.get(g) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * length) / index.avgLength));
    }
    if (score > 0) hits.push({ iri, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.iri.localeCompare(b.iri)).slice(0, limit);
}
