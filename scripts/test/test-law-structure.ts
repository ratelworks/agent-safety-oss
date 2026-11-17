#!/usr/bin/env tsx
/**
 * test-law-structure.ts — 법령 편·장·절·관·속 구조 노드와 그 연결
 *
 *   1. 안전보건규칙은 편이 있고 장 번호가 편마다 다시 시작한다 — 장 노드가 편 번호를 함께 갖고, 제목이 원문과 같다
 *   2. 조문 노드는 원문 순서대로 제 장에 속한다 (제37조 → 제1편 제5장, 제338조 → 제2편 제4장, 제1속 굴착면의 기울기 등)
 *   3. 조문 노드의 partOf 가 있는 구조 노드이고, 그 구조 노드의 조문 목록에 그 조문이 있다 (항·호 노드는 조문에 속한다)
 *   4. 구조 노드의 위·아래 연결(partOf·hasChapter)이 서로 맞는다
 *   5. KOSHA Guide 의 장 연결(relatedChapter)은 모두 있는 구조 노드를 가리키고, 편이 있는 법령에서 편 없는 장을 가리키지 않는다
 *   6. 구조 인용 해석 — 편·장·절·관을 따라 내려가고, 편이 없으면 원문 제목으로 가리며, 하나로 정해지지 않으면 잇지 않는다
 *
 * 사용: tsx scripts/test/test-law-structure.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStructureIndex, resolveStructureCitation } from "../lib/law-structure-citation.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const CHAPTERS = resolve(NODES, "chapters");
const ARTICLES = resolve(NODES, "articles");
const GUIDES = resolve(NODES, "documents", "guides");
/** 법제처 원문 구조로 만든 법령 — 고시·지침의 장·절은 sync-admin-rules 가 따로 만든다 */
const LAW_KEYS = ["산안법", "산안법시행령", "산안법시행규칙", "기준규칙", "중처법", "중처법시행령"];
/** 원문 머리 (산업안전보건기준에 관한 규칙 현행 판에서 확인) */
const EXPECTED = [
  ["part:기준규칙:2편", "안전기준"],
  ["chapter:기준규칙:1편5장", "관리감독자의 직무, 사용의 제한 등"],
  ["chapter:기준규칙:2편1장9절7관", "양중기의 와이어로프 등"],
  ["chapter:기준규칙:2편4장2절1관1속", "굴착면의 기울기 등"],
  ["chapter:기준규칙:3편8장", "병원체에 의한 건강장해의 예방"],
  ["chapter:산안법:5장2절", "도급인의 안전조치 및 보건조치"],
] as const;

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}
const read = (dir: string): Array<Record<string, unknown>> =>
  readdirSync(dir).filter((f) => f.endsWith(".jsonld")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>);

const units = read(CHAPTERS).filter((n) => LAW_KEYS.includes(String(n["@id"]).split(":")[1]));
const byId = new Map(units.map((u) => [String(u["@id"]), u]));
const articles = read(ARTICLES).filter((n) => LAW_KEYS.includes(String(n["@id"]).split(":")[1]));

// 1. 편·장 이름과 제목
const oldStyle = units.filter((u) => /^chapter:기준규칙:\d+장$/.test(String(u["@id"])));
check("안전보건규칙 장 노드가 편 번호를 함께 갖는다 (편 없는 장 노드 없음)", oldStyle.length === 0, oldStyle.map((u) => String(u["@id"])).join(", "));
const wrongTitle = EXPECTED.filter(([id, title]) => byId.get(id)?.title !== title);
check("구조 노드 제목이 원문 머리와 같다", wrongTitle.length === 0, wrongTitle.map(([id]) => `${id}=${String(byId.get(id)?.title)}`).join(" / "));
const parts = units.filter((u) => String(u["@id"]).startsWith("part:기준규칙:"));
check("안전보건규칙은 편 4개(총칙·안전기준·보건기준·특수형태근로종사자 등)", parts.length === 4, parts.map((p) => String(p.title)).join(", "));

// 2. 조문의 장
const partOf = (n: string): string => String(articles.find((a) => a["@id"] === `art:기준규칙:${n}`)?.partOf);
check("제37조(악천후 및 강풍 시 작업 중지)는 제1편 제5장에 속한다", partOf("37") === "chapter:기준규칙:1편5장", partOf("37"));
check("제338조(굴착작업 사전조사 등)는 제2편 제4장에 속한다", partOf("338") === "chapter:기준규칙:2편4장", partOf("338"));
check(
  "제1속 굴착면의 기울기 등에 제338조가 있다",
  ((byId.get("chapter:기준규칙:2편4장2절1관1속")?.hasArticle as string[] | undefined) ?? []).includes("art:기준규칙:338"),
);

// 3. 모든 조문의 partOf
const loose = articles.filter((a) => {
  const p = String(a.partOf ?? "");
  // 법령 바로 아래 조문, 조문에 딸린 항·호 노드(art:…:29:2 → art:…:29)는 구조 노드에 속하지 않는다
  if (p.startsWith("act:") || p.startsWith("art:")) return false;
  const unit = byId.get(p);
  return !unit || !((unit.hasArticle as string[] | undefined) ?? []).includes(String(a["@id"]));
});
check("조문 노드의 partOf 가 있는 구조 노드이고 그 조문 목록에 들어 있다", loose.length === 0, loose.slice(0, 5).map((a) => `${String(a["@id"])}→${String(a.partOf)}`).join(", "));

// 4. 위·아래 연결
const brokenTree = units.filter((u) => {
  const parent = String(u.partOf ?? "");
  if (parent.startsWith("act:")) return false;
  return !((byId.get(parent)?.hasChapter as string[] | undefined) ?? []).includes(String(u["@id"]));
});
check("구조 노드의 partOf 와 상위의 hasChapter 가 맞는다", brokenTree.length === 0, brokenTree.slice(0, 5).map((u) => String(u["@id"])).join(", "));

// 5. 가이드 장 연결
const index = buildStructureIndex(CHAPTERS);
const allIds = new Set([...index.values()].flat().map((u) => u.id));
const badLinks: string[] = [];
let links = 0;
for (const g of read(GUIDES)) {
  for (const r of (g.relatedChapter as Array<{ chapterNodeId: string }> | undefined) ?? []) {
    links += 1;
    if (!allIds.has(r.chapterNodeId) || /^chapter:기준규칙:\d+장$/.test(r.chapterNodeId)) badLinks.push(`${String(g["@id"])}→${r.chapterNodeId}`);
  }
}
check(`KOSHA Guide 장 연결 ${links}건이 모두 있는 구조 노드를 가리킨다`, links > 0 && badLinks.length === 0, badLinks.slice(0, 5).join(", "));

// 6. 인용 해석
const cases: Array<[string, number, string | null]> = [
  ["산업안전보건기준에 관한 규칙 제2편 제1장 제9절 제7관(양중기의 와이어로프 등)", 1, "chapter:기준규칙:2편1장9절7관"],
  ["산업안전보건기준에관한규칙 제8장 병원체에 의한 건강장해의 예방", 8, "chapter:기준규칙:3편8장"],
  ["산업안전보건기준에 관한 규칙 제2장 4절(화학설비 압력용기 등)", 2, "chapter:기준규칙:2편2장4절"],
  ["「산업안전보건기준에 관한 규칙」제1편 제2장 작업장, 제6장 추락 또는 붕괴에", 6, "chapter:기준규칙:1편6장"],
  // 현행 판과 번호가 다른 옛 인용 — 제9장에 근골격계 제목이 없다
  ["산업안전보건기준에 관한 규칙 제9장 근골격계 부담 작업으로 인한 건강", 9, null],
];
for (const [text, num, want] of cases) {
  const got = resolveStructureCitation(index, "기준규칙", text, num)?.id ?? null;
  check(`인용 해석: "${text.slice(0, 40)}…" (제${num}장) → ${want ?? "잇지 않음"}`, got === want, String(got));
}

console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
process.exit(failed ? 1 : 0);
