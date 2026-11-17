#!/usr/bin/env tsx
/**
 * test-admin-annexes.ts — 고시·지침 별표·별지 노드
 *
 *   1. 싣기로 한 고시·지침마다 별표·별지 노드가 있고, 본문이 제목만이 아니다(원문 본문)
 *   2. 법령 노드의 hasAnnex 가 모두 있는 노드를 가리킨다
 *   3. 산업안전보건관리비 계산이 쓰는 요율표(사용계획서 노드 rateTable)가 고시 별표 1 원문 숫자와 같다
 *   4. 위험성평가 고시 별지 서식에 원문 본문이 있다 (예전에는 제목뿐이었다)
 *
 * 사용: tsx scripts/test/test-admin-annexes.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMRULS, ANNEX_RULES } from "../sync/admin-rules-list.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const ANNEXES = resolve(NODES, "annexes");
const ACTS = resolve(NODES, "acts");
const COST_PLAN = resolve(NODES, "documents", "safety-health-mgmt-cost-plan.jsonld");
/** 요율표 칸 → 별표 1 표의 열 순서 */
const RATE_COLUMNS = ["under500M", "from500MTo5B", "baseAmount", "over5B", "healthManagerSite"] as const;

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const annexes = readdirSync(ANNEXES)
  .filter((f) => f.endsWith(".jsonld"))
  .map((f) => readJson(join(ANNEXES, f)));
const byId = new Map(annexes.map((a) => [String(a["@id"]), a]));

// 1. 고시마다 별표·별지
for (const key of ANNEX_RULES) {
  const own = annexes.filter((a) => String(a["@id"]).startsWith(`annex:${key}:`));
  const titleOnly = own.filter((a) => String(a.description ?? "").length < 40 || String(a.title ?? "").endsWith(String(a.description ?? "")));
  check(`${key}: 별표·별지 노드가 있고 원문 본문이 실려 있다`, own.length > 0 && titleOnly.length === 0, `${own.length}건${titleOnly.length ? ` · 본문 없음 ${titleOnly.map((a) => String(a["@id"])).join(", ")}` : ""}`);
}

// 2. 법령 노드의 hasAnnex
const dangling: string[] = [];
for (const rule of ADMRULS.filter((r) => ANNEX_RULES.has(r.actKey))) {
  const act = readJson(join(ACTS, `${rule.actSlug}.jsonld`));
  for (const iri of (act.hasAnnex as string[] | undefined) ?? []) if (!byId.has(iri)) dangling.push(iri);
}
check("고시·지침 법령 노드의 hasAnnex 가 모두 있는 노드를 가리킨다", dangling.length === 0, dangling.join(", "));

// 3. 산업안전보건관리비 요율표
const table = (() => {
  const doc = readJson(COST_PLAN);
  const find = (x: unknown): unknown[] | undefined => {
    if (Array.isArray(x)) for (const v of x) { const r = find(v); if (r) return r; }
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (Array.isArray(o.rateTable)) return o.rateTable;
      for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
    }
    return undefined;
  };
  return (find(doc) ?? []) as Array<Record<string, unknown>>;
})();
const annex1 = String(byId.get("annex:산안비-기준:별표1")?.description ?? "");
const official = new Map<string, number[]>();
for (const line of annex1.split("\n")) {
  const cells = line.split(/[┃│]/).map((c) => c.trim()).filter(Boolean);
  if (cells.length < 6) continue;
  const nums = cells.slice(1, 6).map((c) => Number(c.replace(/[%,원\s]/g, "")));
  if (nums.every((n) => Number.isFinite(n))) official.set(cells[0].replace(/\s+/g, ""), nums);
}
const mismatch = table.filter((row) => {
  const want = official.get(String(row.type));
  return !want || RATE_COLUMNS.some((k, i) => Number(row[k]) !== want[i]);
});
check(
  "산업안전보건관리비 요율표가 고시 별표 1 원문 숫자와 같다 (공사종류 4 × 비율·기초액 5)",
  table.length === 4 && official.size === 4 && mismatch.length === 0,
  `요율표 ${table.length}행 · 원문 ${official.size}행${mismatch.length ? ` · 다름 ${mismatch.map((r) => String(r.type)).join(", ")}` : ""}`,
);

// 4. 위험성평가 고시 별지
const form1 = String(byId.get("annex:위험성평가-고시:서식1")?.description ?? "");
check("위험성평가 고시 별지 제1호서식에 원문 본문(신청서 칸)이 있다", form1.length > 1000 && form1.includes("신청"), `${form1.length}자`);

console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
process.exit(failed ? 1 : 0);
