#!/usr/bin/env tsx
/**
 * test-work-plan-annex4.ts — 작업계획서 양식이 안전보건규칙 별표 4(사전조사 및 작업계획서 내용) 원문 항목을 갖췄는지
 *
 *   1. 별표 4 제N호 노드(원문)의 사전조사·작업계획서 항목마다 그 호를 근거로 드는 양식에 같은 글의 필수 칸이 있다
 *   2. 검토 규칙이 그 칸들을 차단 항목으로 확인하고, 제38조제2항 근로자 주지 칸도 필수다
 *   3. 번들 법령 문서의 별표 4 구획이 노드와 같은 원문이다 (서류에 인용되는 글)
 *
 * 사용: tsx scripts/test/test-work-plan-annex4.ts
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const LAW_MD = resolve(ROOT, "src", "ontology", "safety-laws", "산업안전보건기준에-관한-규칙.md");
const ITEM_SPLIT = /(?:^|\s)[가-하]\.\s/;

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}
const flat = (s: string): string => s.replace(/\s+/g, "");

interface Field { key: string; label: string; required?: boolean }
interface DocNode { docId: string; legalBasis?: string[]; sections: { title: string; fields: Field[] }[]; reviewRules?: { severity: string; checkFields?: string[] }[] }

async function main(): Promise<void> {
  const md = await readFile(LAW_MD, "utf8");
  const docs: DocNode[] = [];
  for (const f of (await readdir(resolve(NODES, "documents"))).filter((x) => x.endsWith(".jsonld"))) docs.push(JSON.parse(await readFile(resolve(NODES, "documents", f), "utf8")) as DocNode);
  let forms = 0;
  for (let no = 1; no <= 13; no += 1) {
    const annex = JSON.parse(await readFile(resolve(NODES, "annexes", `기준규칙-별표4-${no}호.jsonld`), "utf8")) as { description: string; verificationStatus: string };
    const [, surveyRaw = "", planRaw = ""] = annex.description.match(/사전조사 내용: (.*)\n작업계획서 내용: (.*)$/s) ?? [];
    const survey = surveyRaw.trim() === "-" ? [] : surveyRaw.split(ITEM_SPLIT).map((s) => s.trim()).filter(Boolean);
    const plan = planRaw.split(ITEM_SPLIT).map((s) => s.trim()).filter(Boolean);
    const block = md.match(new RegExp(`\\*\\*\\[${no}호\\][^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*\\[\\d+호\\]|\\n---)`))?.[1] ?? "";
    const mdMissing = [...survey, ...plan].filter((x) => !flat(block).includes(flat(x)));
    check(`별표 4 제${no}호: 노드는 원문이고 번들 법령 문서와 같은 항목`, annex.verificationStatus === "verified" && plan.length > 0 && mdMissing.length === 0, mdMissing.join(" / ") || `사전조사 ${survey.length} · 계획서 ${plan.length}`);
    for (const d of docs.filter((x) => (x.legalBasis ?? []).includes(`annex:기준규칙:별표4-${no}호`) && x.docId.startsWith("work_plan_"))) {
      forms += 1;
      const required = d.sections.flatMap((s) => s.fields).filter((f) => f.required);
      const missing = [...survey, ...plan].filter((x) => !required.some((f) => flat(f.label).includes(flat(x))));
      const lawKeys = required.filter((f) => [...survey, ...plan].some((x) => flat(f.label).includes(flat(x)))).map((f) => f.key);
      const blocked = (d.reviewRules ?? []).some((r) => r.severity === "blocker" && lawKeys.every((k) => (r.checkFields ?? []).includes(k)));
      const notify = required.some((f) => f.key === "notifiedToWorkers");
      check(`${d.docId}: 별표 4 제${no}호 항목이 모두 필수 칸이고 검토가 막는다 + 근로자 주지`, missing.length === 0 && blocked && notify, missing.length ? `빠짐: ${missing.join(" / ")}` : `${lawKeys.length}칸${blocked ? "" : " · 검토 규칙 없음"}${notify ? "" : " · 주지 칸 없음"}`);
    }
  }
  check("별표 4 호를 근거로 드는 작업계획서 양식이 있다", forms >= 9, `${forms}종`);
  console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
