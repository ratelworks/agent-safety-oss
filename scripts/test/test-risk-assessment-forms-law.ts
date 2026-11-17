#!/usr/bin/env tsx
/**
 * test-risk-assessment-forms-law.ts — 위험성평가 서식·실시규정·TBM 이 법령 원문의 기재·이행 항목을 갖췄는지
 *
 * 항목은 조문 노드(법제처 원문)에서 읽는다 — 서식 칸 이름에 원문 문구가 들어 있어야 한다.
 *   1. 최초·정기·수시·상시 서식: 시행규칙 §37의3(실시 전 일정 / 실시 후 4가지) · §37의4 ①(실시 시기·담당자·참여한 근로자·근로자대표)
 *      가 필수 칸이고, 결과 4가지·기록 항목은 검토가 막는다
 *   2. 실시 시기: 시행규칙 §37 ② 1·2·3호의 시기가 최초·정기·수시 서식의 필수 칸에
 *   3. 정기: 고시 §14 ② 고려 사항 3가지 / 수시: 고시 §15 ② 사유 1~5호 / 상시: 고시 §16 ① 매월·매주·매 작업일
 *   4. 실시규정: 고시 §19 6개 항목 / TBM: 시행규칙 §37의3 제2호 사항 + 고시 §16 ① 3호 준수·주의 사항
 *
 * 사용: tsx scripts/test/test-risk-assessment-forms-law.ts
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const RISK_FORMS = ["initial-risk-assessment", "regular-risk-assessment", "ad-hoc-risk-assessment", "monthly-risk-assessment"];

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}
/** 비교용 — 가운뎃점 표기·띄어쓰기 차이를 없앤다 */
const norm = (s: string): string => s.replace(/ㆍ/g, "·").replace(/\s+/g, "");

interface Field { key: string; label: string; required?: boolean; inputGuide?: string }
interface Doc { docId: string; sections: { title: string; fields: Field[] }[]; reviewRules?: { severity: string; checkFields?: string[] }[] }

const article = async (file: string): Promise<string> =>
  (JSON.parse(await readFile(resolve(NODES, "articles", `${file}.jsonld`), "utf8")) as { description: string }).description;
/** 조문의 "N. …" 호 목록 (항 번호 ①… 로 범위를 좁힐 수 있다) */
function items(text: string, paragraph?: string): string[] {
  let body = text;
  if (paragraph) {
    const i = text.indexOf(paragraph);
    const next = text.slice(i + 1).search(/[①-⑳]/);
    body = text.slice(i, next >= 0 ? i + 1 + next : undefined);
  }
  return [...body.matchAll(/(?:^|\n)\s*\d+\.\s*([^\n]+)/g)].map((m) => m[1].trim());
}
const docs = new Map<string, Doc>();
async function doc(file: string): Promise<Doc> {
  if (!docs.has(file)) docs.set(file, JSON.parse(await readFile(resolve(NODES, "documents", `${file}.jsonld`), "utf8")) as Doc);
  return docs.get(file)!;
}
const required = (d: Doc): Field[] => d.sections.flatMap((s) => s.fields).filter((f) => f.required);
/** 원문 문구가 필수 칸 이름 어딘가에 있는가 — 없는 문구 목록 */
function missingIn(d: Doc, phrases: string[]): string[] {
  const labels = required(d).map((f) => norm(f.label));
  return phrases.filter((p) => !labels.some((l) => l.includes(norm(p))));
}
/** 그 문구를 이름에 담은 필수 칸 키 */
const keysFor = (d: Doc, phrases: string[]): string[] =>
  required(d).filter((f) => phrases.some((p) => norm(f.label).includes(norm(p)))).map((f) => f.key);
const blocked = (d: Doc, keys: string[]): boolean =>
  keys.length > 0 && keys.every((k) => (d.reviewRules ?? []).some((r) => r.severity === "blocker" && (r.checkFields ?? []).includes(k)));

async function main(): Promise<void> {
  // 시행규칙 §37의3 — "1. 위험성평가 실시 전: …" / "2. 위험성평가 실시 후: …, …, … 및 …"
  const [before, after] = items(await article("산안법시행규칙-§37의3")).map((s) => s.replace(/^[^:]+:\s*/, ""));
  const afterItems = after.split(/,\s*/).flatMap((s) => s.split(/\s+및\s+/));
  // 시행규칙 §37의4 ① — "위험성평가 실시 시기 및 담당자", "위험성평가에 참여한 근로자 및 근로자대표"
  const recordItems = items(await article("산안법시행규칙-§37의4"), "①")
    .slice(0, 2)
    .flatMap((s) => s.split(/\s+및\s+/))
    .map((s) => s.replace(/^위험성평가에?\s+/, ""));
  // 시행규칙 §37 ② — 호마다 시기 문구
  const timing = items(await article("산안법시행규칙-§37"), "②").map((s) => (s.includes("경우에는 ") ? s.split("경우에는 ").pop()! : s.replace(/^[^:]+:\s*/, "").replace(/제\d+호에 따른\s*/, "")));
  check("원문에서 항목을 읽었다", afterItems.length === 4 && recordItems.length === 4 && timing.length === 3, `실시 후 ${afterItems.join(" / ")} · 기록 ${recordItems.join(" / ")}`);

  for (const f of RISK_FORMS) {
    const d = await doc(f);
    const miss = missingIn(d, [before, ...afterItems, ...recordItems]);
    check(`${d.docId}: 시행규칙 §37의3·§37의4 ① 항목이 필수 칸`, miss.length === 0, miss.join(" / "));
    const keys = keysFor(d, [...afterItems, ...recordItems.filter((x) => x !== "실시 시기")]);
    check(`${d.docId}: 결과 4가지·담당자·참여 근로자·근로자대표를 검토가 막는다`, blocked(d, keys), keys.join(","));
  }
  const timingDocs = ["initial-risk-assessment", "regular-risk-assessment", "ad-hoc-risk-assessment"];
  for (let i = 0; i < 3; i += 1) {
    const d = await doc(timingDocs[i]);
    check(`${d.docId}: 시행규칙 §37 ② ${i + 1}호 시기 "${timing[i]}" 가 필수 칸`, missingIn(d, [timing[i]]).length === 0);
  }

  // 고시 §14 ② · §15 ② · §16 ①
  const regular = await doc("regular-risk-assessment");
  const considerations = items(await article("위험성평가-고시-§14"), "②").map((s) => s.replace(/\s*등$/, ""));
  check("정기: 고시 §14 ② 고려 사항 3가지가 필수 칸이고 검토가 막는다", considerations.length === 3 && missingIn(regular, considerations).length === 0 && blocked(regular, keysFor(regular, considerations)), missingIn(regular, considerations).join(" / "));
  const adhoc = await doc("ad-hoc-risk-assessment");
  const reasons = items(await article("위험성평가-고시-§15"), "②");
  const reasonField = required(adhoc).find((f) => f.key === "changeReason");
  const reasonMiss = reasons.filter((r) => !norm(reasonField?.inputGuide ?? "").includes(norm(r)));
  check("수시: 고시 §15 ② 사유 1~5호를 사유 칸이 원문대로 안내하고 검토가 막는다", reasons.length === 5 && reasonMiss.length === 0 && blocked(adhoc, ["changeReason"]), reasonMiss.join(" / "));
  const monthly = await doc("monthly-risk-assessment");
  const tiers = ["매월 1회 이상", "매주", "매 작업일"];
  const tierText = await article("위험성평가-고시-§16");
  const tierMiss = tiers.filter((t) => !norm(tierText).includes(norm(t)) || !monthly.sections.some((s) => norm(s.title).includes(norm(t))));
  check("상시: 고시 §16 ① 매월·매주·매 작업일 구획이 있다", tierMiss.length === 0, tierMiss.join(" / "));

  // 실시규정 — 고시 §19 / TBM — 시행규칙 §37의3 제2호 + 고시 §16 ① 3호
  const procedure = await doc("risk-assessment-procedure");
  const ruleItems = items(await article("위험성평가-고시-§19"));
  check("실시규정: 고시 §19 6개 항목이 필수 칸이고 검토가 막는다", ruleItems.length === 6 && missingIn(procedure, ruleItems).length === 0 && blocked(procedure, keysFor(procedure, ruleItems)), missingIn(procedure, ruleItems).join(" / "));
  const tbm = await doc("daily-tbm");
  const tbmPhrases = [...afterItems, "근로자가 준수하여야 할 사항 및 주의하여야 할 사항"];
  check("TBM: 시행규칙 §37의3 제2호 사항과 준수·주의 사항이 필수 칸이고 검토가 막는다", missingIn(tbm, tbmPhrases).length === 0 && blocked(tbm, keysFor(tbm, tbmPhrases)), missingIn(tbm, tbmPhrases).join(" / "));
  check("TBM: 고시 §16 ① 3호 원문에 그 문구가 있다", norm(tierText).includes(norm("근로자가 준수하여야 할 사항 및 주의하여야 할 사항")));

  console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
