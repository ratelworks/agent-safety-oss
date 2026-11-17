/**
 * law-structure-citation.ts — "제2편 제1장 제9절 제7관(…)" 같은 법령 구조 인용을 구조 노드(편·장·절·관·속)로 잇는다
 *
 * 장 번호는 편마다 다시 시작한다. 인용에 편이 없으면(예: "제8장 병원체에 의한 건강장해의 예방")
 * 인용 글에 그 장(또는 그 아래 절)의 원문 제목이 있는 후보 하나만 고른다. 하나로 정해지지 않으면 잇지 않는다 —
 * 틀린 장에 잇는 것보다 잇지 않는 편이 낫다.
 *
 * 가이드 인용 추출(etl/extract-kosha-guide-citations.ts)과 가이드 연결 다시 잇기(ontology/remap-guide-chapters.ts)가 함께 쓴다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── 상수 ────────────────────────────────────────────────────────────
const LEVELS = ["편", "장", "절", "관", "속"] as const;
/** 구조 노드 IRI 뒤쪽 — "2편1장9절7관" */
const SUFFIX = /^(part|chapter):([^:]+):((?:\d+[편장절관속])+)$/;

export interface StructureUnit {
  id: string;
  title: string;
  /** [{n:"2",l:"편"},{n:"1",l:"장"},…] */
  path: Array<{ n: string; l: string }>;
}
/** 법령 키 → 구조 단위 */
export type StructureIndex = Map<string, StructureUnit[]>;

/** 구조 노드 폴더(chapters)를 읽어 법령별 색인을 만든다 */
export function buildStructureIndex(chaptersDir: string): StructureIndex {
  const index: StructureIndex = new Map();
  for (const f of readdirSync(chaptersDir)) {
    if (!f.endsWith(".jsonld")) continue;
    const d = JSON.parse(readFileSync(join(chaptersDir, f), "utf8")) as { "@id"?: string; title?: string };
    const m = (d["@id"] ?? "").match(SUFFIX);
    if (!m) continue;
    const path = [...m[3].matchAll(/(\d+)([편장절관속])/g)].map((x) => ({ n: x[1], l: x[2] }));
    const list = index.get(m[2]) ?? [];
    list.push({ id: d["@id"] as string, title: d.title ?? "", path });
    index.set(m[2], list);
  }
  return index;
}

/** 비교용 — 띄어쓰기·가운뎃점 모양(·ㆍ‧․)·괄호·따옴표 차이를 없앤다 */
const flat = (s: string): string => s.replace(/[\s·ㆍ‧․,()（）「」“”"']/g, "");
/** 제목 대조 길이 — 인용이 잘리거나 조사가 달라져도 맞추되, 다른 장과 겹치지 않을 만큼 */
const TITLE_PREFIX = 4;
const samePath = (a: StructureUnit["path"], b: StructureUnit["path"]): boolean => a.length === b.length && a.every((p, i) => p.n === b[i].n && p.l === b[i].l);

/**
 * 인용 글에서 장 번호 chapterNum 이 가리키는 가장 깊은 구조 단위를 찾는다.
 * 편은 그 장 앞에 나온 마지막 "제P편", 절·관·속은 그 장 뒤에 이어 나온 것(다음 장·편 전까지)을 쓴다.
 */
export function resolveStructureCitation(index: StructureIndex, law: string, text: string, chapterNum: number): StructureUnit | null {
  const units = index.get(law);
  if (!units?.length) return null;
  // 절·관·속은 "제" 없이 "4절" 로 쓴 인용도 있다
  const tokens = [...text.matchAll(/(?:제\s*(\d+)\s*([편장절관속])|(?<![\d제])(\d+)\s*([절관속]))/g)].map((m) => ({ n: m[1] ?? m[3], l: m[2] ?? m[4], at: m.index ?? 0 }));
  const ci = tokens.findIndex((t) => t.l === "장" && Number(t.n) === chapterNum);
  if (ci < 0) return null;
  const part = tokens.slice(0, ci).filter((t) => t.l === "편").at(-1);
  // 장 뒤에 이어지는 절·관·속 — 단위 순서가 맞을 때만
  const tail: Array<{ n: string; l: string }> = [];
  for (const t of tokens.slice(ci + 1)) {
    if (t.l === "편" || t.l === "장") break;
    const want = LEVELS[2 + tail.length];
    if (t.l !== want) break;
    tail.push({ n: t.n, l: t.l });
  }
  const hasParts = units.some((u) => u.path[0]?.l === "편");
  const heads: StructureUnit["path"][] = [];
  if (!hasParts) heads.push([{ n: String(chapterNum), l: "장" }]);
  else if (part) heads.push([{ n: part.n, l: "편" }, { n: String(chapterNum), l: "장" }]);
  else
    for (const u of units) if (u.path.length === 2 && u.path[1].l === "장" && u.path[1].n === String(chapterNum)) heads.push(u.path);

  /** 그 장에서 꼬리(절·관·속)를 따라 내려간 가장 깊은 단위 */
  const deepest = (head: StructureUnit["path"]): StructureUnit | null => {
    let best: StructureUnit | null = null;
    for (let k = 0; k <= tail.length; k += 1) {
      const u = units.find((x) => samePath(x.path, [...head, ...tail.slice(0, k)]));
      if (!u) break;
      best = u;
    }
    return best;
  };
  const candidates = heads.map(deepest).filter((u): u is StructureUnit => !!u);
  if (candidates.length === 1) return hasParts && !part ? (titleHit(units, candidates[0], text) ? candidates[0] : null) : candidates[0];
  // 편이 없는 인용 — 원문 제목이 인용 글에 있는 후보 하나
  const hits = candidates.filter((c) => titleHit(units, c, text));
  return hits.length === 1 ? hits[0] : null;
}

/** 후보의 장(또는 그 아래 단위) 원문 제목이 인용 글에 있는가 */
function titleHit(units: StructureUnit[], unit: StructureUnit, text: string): boolean {
  const t = flat(text);
  for (let k = 2; k <= unit.path.length; k += 1) {
    const u = units.find((x) => samePath(x.path, unit.path.slice(0, k)));
    if (u && u.title && t.includes(flat(u.title).slice(0, TITLE_PREFIX))) return true;
  }
  return false;
}
