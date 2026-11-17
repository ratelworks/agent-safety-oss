#!/usr/bin/env tsx
/**
 * link-law-citations.ts — 산업안전보건법령·중대재해처벌법령 조문 본문의 인용을 읽어 조문 사이 연결을 채운다
 *
 * 조문 본문(법제처 원문)에서 "제N조" 인용을 찾아 어느 법령의 몇 조인지 정한다.
 *   - 머리말: 「산업안전보건법」·「산업안전보건법 시행령」·「산업안전보건기준에 관한 규칙」 같은 법령 이름,
 *     하위 법령 본문의 "법"(모법)·"영"(시행령), "이 법·이 영·이 규칙"(자기 법령). 머리말이 없으면 자기 법령.
 *   - 목록: 머리말 하나 뒤에 쉼표·ㆍ·및·또는·와·과로 이어지는 "제N조" 는 같은 법령이다 (「산업안전보건법」 제5조, 제16조, …).
 *   - 범위: "제X조부터 제Y조까지" 는 사이 조문을 모두 인용한 것이다.
 *   - 다른 법령(「건축법」 등)·법령 이름이 없는 다른 법은 잇지 않는다.
 * 연결 종류
 *   - 같은 법령 안 → references
 *   - 하위 법령이 상위 법령을 인용(시행령·시행규칙·안전보건규칙 → 법, 시행규칙 → 시행령) → delegationOf (상위 쪽 delegates 는 역관계 채우기가 맞춘다)
 *   - 그 밖(상위가 하위를, 같은 급끼리) → references
 * 이미 있는 연결 가운데 지우는 것은 하나뿐이다 — 본문이 그 조 번호를 다른 법령으로 인용하는데 이 법령 조문에 이어 둔
 * references(예: 「산업재해보상보험법」 제38조 → 산업안전보건법 제38조, "영 제23조" → 시행규칙 제23조). 옛 추출기가 법령을 가리지 않고
 * "제N조" 만 보고 이은 것이다. 본문에 그 번호가 없는 연결(벌칙 조항 연결 등 사람이 정한 것)과 위임(delegationOf)은 건드리지 않는다.
 * 항·호 단위 노드(art:…:29:2)는 조문 노드에 잇는다.
 *
 * 사용: tsx scripts/ontology/link-law-citations.ts [--dry-run]
 *       그다음 tsx scripts/ontology/materialize-inverse-edges.ts (delegates·referencedBy 등 역관계)
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "articles");
/** 법령 키와 위계 — 숫자가 클수록 하위 */
export const LAW_RANK: Record<string, number> = { 산안법: 0, 산안법시행령: 1, 산안법시행규칙: 2, 기준규칙: 2, 중처법: 0, 중처법시행령: 1 };
/** 하위 법령 본문의 "법"·"영" 이 가리키는 법령 */
const PARENT_OF: Record<string, { 법?: string; 영?: string }> = {
  산안법시행령: { 법: "산안법" },
  산안법시행규칙: { 법: "산안법", 영: "산안법시행령" },
  기준규칙: { 법: "산안법", 영: "산안법시행령" },
  중처법시행령: { 법: "중처법" },
};
/** 「법령 이름」 → 법령 키 (긴 이름부터) */
const NAMED: Array<[RegExp, string]> = [
  [/^산업안전보건법\s*시행령$/, "산안법시행령"],
  [/^산업안전보건법\s*시행규칙$/, "산안법시행규칙"],
  [/^산업안전보건기준에\s*관한\s*규칙$/, "기준규칙"],
  [/^산업안전보건법$/, "산안법"],
  [/^중대재해\s*처벌\s*등에\s*관한\s*법률\s*시행령$/, "중처법시행령"],
  [/^중대재해\s*처벌\s*등에\s*관한\s*법률$/, "중처법"],
];
/** 조문 인용 하나 — 제N조[의M][제K항][제L호][가목] */
const CITE = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호(?:\s*의\s*\d+)?)?(?:\s*[가-하]\s*목)?/g;
/** 앞 인용과 같은 법령으로 잇는 사이 글 — 쉼표·ㆍ·및·또는·와·과 (그리고 범위의 "부터") */
const LIST_GAP = /^\s*(?:까지(?:의\s*규정)?\s*)?(?:,|ㆍ|·|및|또는|와|과|부터|∼|~)\s*$/;
/** 머리말 — 인용 바로 앞 */
const PREFIX = /(?:「([^」]+)」|(같은\s*법\s*시행령|같은\s*법\s*시행규칙|같은\s*법|같은\s*영|같은\s*규칙|이\s*법|이\s*영|이\s*규칙|안전보건규칙|(?<![가-힣])법|(?<![가-힣])영))\s*$/;
/** 법 → 그 시행령·시행규칙 ("같은 법 시행령") */
const DECREE_OF: Record<string, { 시행령?: string; 시행규칙?: string }> = { 산안법: { 시행령: "산안법시행령", 시행규칙: "산안법시행규칙" }, 중처법: { 시행령: "중처법시행령" } };

export interface Citation {
  law: string | null; // null = 다른 법령
  num: string; // "15" · "38의2"
}

/** 조문 본문의 인용 — 순서대로, 범위는 펼친다 */
export function parseCitations(raw: string, selfLaw: string): Citation[] {
  // "[종전 제10조는 제12조로 이동 <2020.1.16>]"·"<개정 …>" 같은 꼬리표는 옛 번호라 인용이 아니다
  const text = raw.replace(/\[[^\]]*\]/g, " ").replace(/<[^>]*>/g, " ");
  const out: Citation[] = [];
  let prevEnd = -1;
  let prevLaw: string | null = selfLaw;
  let prevNum = "";
  let lastNamed: string | null = null;
  for (const m of text.matchAll(CITE)) {
    const start = m.index ?? 0;
    const num = m[2] ? `${m[1]}의${m[2]}` : m[1];
    const gap = prevEnd >= 0 ? text.slice(prevEnd, start) : "";
    let law: string | null;
    const head = text.slice(Math.max(0, start - 40), start).match(PREFIX);
    if (prevEnd >= 0 && LIST_GAP.test(gap)) {
      law = prevLaw;
      // 범위 — "제X조부터 제Y조까지"
      if (/부터|∼|~/.test(gap) && /^\s*까지/.test(text.slice(m.index! + m[0].length)) && !m[2] && !prevNum.includes("의")) {
        for (let k = Number(prevNum) + 1; k < Number(m[1]); k += 1) out.push({ law, num: String(k) });
      }
    } else if (head?.[1]) {
      const name = head[1].trim();
      law = NAMED.find(([re]) => re.test(name))?.[1] ?? null;
      lastNamed = law;
    } else if (head?.[2]) {
      const p = head[2].replace(/\s+/g, "");
      // "이 법·이 영·이 규칙" 은 문서 종류가 맞을 때만 자기 법령 — 아니면 "이" 는 앞말의 조사다 ("…라 한다)이 영 제89조")
      const selfKind = LAW_RANK[selfLaw] === 0 ? "이법" : LAW_RANK[selfLaw] === 1 ? "이영" : "이규칙";
      if (p === selfKind) law = selfLaw;
      else if (p === "이법" || p === "이영") law = PARENT_OF[selfLaw]?.[p.slice(1) as "법" | "영"] ?? null;
      else if (p === "이규칙") law = null;
      else if (p === "같은법" || p === "같은영" || p === "같은규칙") law = lastNamed;
      else if (p === "같은법시행령" || p === "같은법시행규칙") law = lastNamed ? DECREE_OF[lastNamed]?.[p.slice(3) as "시행령" | "시행규칙"] ?? null : null;
      else if (p === "안전보건규칙") law = "기준규칙";
      else law = PARENT_OF[selfLaw]?.[p as "법" | "영"] ?? (p === "법" && LAW_RANK[selfLaw] === 0 ? selfLaw : null);
    } else {
      law = selfLaw;
    }
    out.push({ law, num });
    prevEnd = start + m[0].length;
    prevLaw = law;
    prevNum = num;
  }
  return out;
}

/** 이 연결의 종류 — 하위가 상위를 인용하면 위임, 그 밖은 참조 */
export function edgeKind(from: string, to: string): "references" | "delegationOf" {
  if (from === to) return "references";
  const parents = PARENT_OF[from];
  const isParent = parents && (parents.법 === to || parents.영 === to);
  return isParent && LAW_RANK[from] > LAW_RANK[to] ? "delegationOf" : "references";
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const files = readdirSync(ARTICLES).filter((f) => f.endsWith(".jsonld"));
  const exists = new Set<string>();
  const nodes = new Map<string, { path: string; raw: string; node: Record<string, unknown> }>();
  for (const f of files) {
    const path = join(ARTICLES, f);
    const raw = readFileSync(path, "utf8");
    const node = JSON.parse(raw) as Record<string, unknown>;
    exists.add(String(node["@id"]));
    nodes.set(String(node["@id"]), { path, raw, node });
  }
  const added = { references: 0, delegationOf: 0 };
  let pruned = 0;
  let touched = 0;
  for (const [iri, entry] of nodes) {
    const [, law, num, ...rest] = iri.split(":");
    if (!(law in LAW_RANK)) continue;
    const self = rest.length ? `art:${law}:${num}` : iri; // 항·호 노드는 조문 노드로
    const text = String(entry.node.description ?? "");
    const add: Record<"references" | "delegationOf", Set<string>> = { references: new Set(), delegationOf: new Set() };
    for (const c of parseCitations(text, law)) {
      if (!c.law) continue;
      const target = `art:${c.law}:${c.num}`;
      if (target === self || !exists.has(target)) continue;
      add[edgeKind(law, c.law)].add(target);
    }
    let changed = false;
    // 본문이 그 번호를 다른 법령으로 인용하는데 이 법령 조문에 이어 둔 references — 오독
    const cites = parseCitations(text, law);
    if (Array.isArray(entry.node.references)) {
      const keep = (entry.node.references as string[]).filter((t) => {
        const [, tl, tn] = t.split(":");
        if (!(tl in LAW_RANK) || add.references.has(t) || add.delegationOf.has(t)) return true;
        const sameNumber = cites.filter((c) => c.num === tn);
        return sameNumber.length === 0 || sameNumber.some((c) => c.law === tl);
      });
      if (keep.length !== (entry.node.references as string[]).length) {
        pruned += (entry.node.references as string[]).length - keep.length;
        entry.node.references = keep;
        changed = true;
      }
    }
    for (const key of ["references", "delegationOf"] as const) {
      if (add[key].size === 0) continue;
      const cur = Array.isArray(entry.node[key]) ? (entry.node[key] as string[]) : [];
      const missing = [...add[key]].filter((t) => !cur.includes(t) && !(key === "references" && ((entry.node.delegationOf as string[] | undefined) ?? []).includes(t)));
      if (missing.length === 0) continue;
      entry.node[key] = [...cur, ...missing];
      added[key] += missing.length;
      changed = true;
    }
    if (changed) {
      touched += 1;
      if (!dryRun) writeFileSync(entry.path, JSON.stringify(entry.node, null, 2) + (entry.raw.endsWith("\n") ? "\n" : ""), "utf8");
    }
  }
  console.log(`조문 인용 연결 — references +${added.references} · delegationOf +${added.delegationOf} · 오독 references 지움 ${pruned} (조문 ${touched}개)${dryRun ? " (dry-run)" : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
