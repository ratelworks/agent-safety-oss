#!/usr/bin/env tsx
/**
 * test-document-penalties.ts — 서류의 "위반 시 처벌" 이 그 서류 의무를 실제로 처벌하는 조항인지
 *
 *   1. 서류가 가리키는 처벌 노드가 있고, 위반 문구(quote)가 현행 벌칙 조문 노드 원문에 그대로 있다
 *      (시행 예정 조항은 시행 예정으로 표시하고 단계 시행일을 적었다)
 *   2. 서류의 근거 조문(산업안전보건법 제N조)이 처벌 노드의 위반 문구에 나온다 —
 *      안전보건규칙 근거 서류는 안전·보건조치 위반(제168조)을 가리킨다
 *   3. 서류에 찍히는 처벌 표기(금액)가 조문 원문의 금액과 같다
 *
 * 사용: tsx scripts/test/test-document-penalties.ts
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderIri } from "../../src/lib/iri-renderer.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const SAFETY_MEASURE_PENALTY = "penalty:산안법:168";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}
/** 비교용 — 개정 표기·가운뎃점·띄어쓰기 차이를 없앤다 */
const flat = (s: string): string => s.replace(/<(?:개정|신설)[^>]*>/g, "").replace(/ㆍ/g, "·").replace(/\s+/g, "");
/** 조 번호 → 원문 표기 정규식 (128의2 → 제128조의2) */
const articlePattern = (n: string): RegExp => {
  const [main, branch] = n.split("의");
  return new RegExp(branch ? `제${main}조의${branch}(?![0-9])` : `제${main}조(?![의0-9])`);
};

interface Penalty { "@id": string; condition: string; amount?: number; legislationLegalForce?: string; temporalCoverage?: string; articleRef?: string; _meta?: { quote?: string; effectiveSchedule?: string } }

async function main(): Promise<void> {
  const penalties = new Map<string, Penalty>();
  for (const f of await readdir(resolve(NODES, "penalties"))) {
    const p = JSON.parse(await readFile(resolve(NODES, "penalties", f), "utf8")) as Penalty;
    penalties.set(p["@id"], p);
  }
  const articleText = async (iri: string): Promise<string> => {
    const [, law, n] = iri.split(":");
    return (JSON.parse(await readFile(resolve(NODES, "articles", `${law}-§${n}.jsonld`), "utf8")) as { description: string }).description;
  };

  const docs: Array<{ docId: string; legalBasis?: string[]; penaltyOnMissing?: string | string[] }> = [];
  for (const f of (await readdir(resolve(NODES, "documents"))).filter((x) => x.endsWith(".jsonld"))) docs.push(JSON.parse(await readFile(resolve(NODES, "documents", f), "utf8")));

  const used = new Set(docs.flatMap((d) => [].concat((d.penaltyOnMissing ?? []) as never)).filter((x: string) => x.startsWith("penalty:산안법:")));
  // 1. 처벌 노드 — 원문 문구
  const badQuote: string[] = [];
  const badStaged: string[] = [];
  for (const iri of used) {
    const p = penalties.get(iri);
    if (!p) { badQuote.push(`${iri} 노드 없음`); continue; }
    if (p.legislationLegalForce === "NotInForce") {
      if (!p._meta?.effectiveSchedule || !/^20\d\d-\d\d-\d\d\//.test(p.temporalCoverage ?? "")) badStaged.push(iri);
      continue;
    }
    const quote = p._meta?.quote ?? "";
    if (!quote || !p.articleRef || !flat(await articleText(p.articleRef)).includes(flat(quote))) badQuote.push(iri);
  }
  check(`서류가 가리키는 처벌 노드 ${used.size}개 — 위반 문구가 현행 조문 원문 그대로`, badQuote.length === 0, badQuote.join(", "));
  check("시행 예정 처벌 조항은 시행 예정으로 표시하고 단계 시행일을 적었다", badStaged.length === 0, badStaged.join(", "));

  // 2. 서류 근거 ↔ 처벌 문구
  const mismatch: string[] = [];
  let checked = 0;
  for (const d of docs) {
    const pens = [].concat((d.penaltyOnMissing ?? []) as never).filter((x: string) => x.startsWith("penalty:산안법:")) as string[];
    if (pens.length === 0) continue;
    checked += 1;
    const quotes = flat(pens.map((x) => penalties.get(x)?._meta?.quote ?? penalties.get(x)?.condition ?? "").join(" "));
    const actArticles = (d.legalBasis ?? []).filter((x) => /^art:산안법:/.test(x)).map((x) => x.split(":")[2]);
    const standards = (d.legalBasis ?? []).some((x) => x.startsWith("art:기준규칙:"));
    const ok = actArticles.some((n) => articlePattern(n).test(quotes)) || (standards && pens.includes(SAFETY_MEASURE_PENALTY));
    if (!ok) mismatch.push(`${d.docId}(${actArticles.join(",") || "기준규칙"} ↔ ${pens.map((x) => x.split(":")[2]).join(",")})`);
  }
  check(`처벌 조항이 있는 서류 ${checked}종 — 처벌 조항이 서류의 근거 조문 위반을 다룬다`, mismatch.length === 0, mismatch.join(" / "));
  const whole = docs.filter((d) => [].concat((d.penaltyOnMissing ?? []) as never).some((x: string) => x === "penalty:산안법:175" || x === "art:산안법:175")).map((d) => d.docId);
  check("제175조 전체(어느 항·호인지 없음)를 가리키는 서류가 없다", whole.length === 0, whole.join(", "));

  // 3. 표기 금액 ↔ 조문
  const art175 = await articleText("art:산안법:175");
  const wrongAmount: string[] = [];
  for (const iri of used) {
    const m = iri.match(/^penalty:산안법:175-(\d)-/);
    if (!m) continue;
    const para = "①②③④⑤⑥"[Number(m[1]) - 1];
    const amount = art175.slice(art175.indexOf(para)).match(/(\S+) 이하의 과태료/)?.[1] ?? "?";
    if (!renderIri(iri).includes(`${amount} 이하 과태료`)) wrongAmount.push(`${iri}: ${renderIri(iri)} (원문 ${amount})`);
  }
  for (const n of ["167", "168", "169", "170", "172"]) {
    const iri = `penalty:산안법:${n}`;
    if (!used.has(iri)) continue;
    const t = flat(await articleText(`art:산안법:${n}`));
    const label = renderIri(iri).match(/\(([^)]*)\)/)?.[1] ?? "";
    const nums = label.match(/\d+[년천억만]+/g) ?? [];
    if (nums.length === 0 || !nums.every((x) => t.includes(x))) wrongAmount.push(`${iri}: ${label}`);
  }
  check("서류에 찍히는 처벌 금액이 조문 원문 금액과 같다", wrongAmount.length === 0, wrongAmount.join(" / "));

  console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
