#!/usr/bin/env tsx
/**
 * test-document-work-context.ts — 서류 초안이 그 작업의 조건과 단계를 담는가
 *
 *   1. 작업명에 작업 조건(강풍)이 있으면 그 조건에서 이 작업이 지켜야 할 법령 조치가 기준값·근거 조문과 함께 실린다
 *      — 타워크레인이면 순간풍속 초당 10미터 초과 시 설치·해체 작업 중지(안전보건규칙 제37조)
 *   2. 다른 작업에만 해당하는 조치는 싣지 않는다
 *   3. 초안의 작업 조건 칸(workConditions)으로 준 조건도 읽는다
 *   4. 작업명이 단계를 가리키면 그 단계가 표 맨 앞에 오고, TBM 은 그 단계만 싣는다
 *   5. 조건·단계가 없는 초안은 조건 구획을 넣지 않는다
 *
 * 사용: tsx scripts/test/test-document-work-context.ts
 */
import { generateSafetyDocumentTool } from "../../src/tools/generate-safety-document.js";
import { resolveWorkConditions, RULE_SCOPE } from "../../src/lib/work-conditions.js";
import { getWorkSteps, pickFocusSteps } from "../../src/lib/work-steps.js";

// ── 상수 ────────────────────────────────────────────────────────────
const WORK = "타워크레인 지브 조립";
const CONDITION = "강풍";
const CONDITION_HEADING = "## 작업 조건별 지켜야 할 조치";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

async function draftText(docId: string, draft: Record<string, unknown>): Promise<string> {
  const out = await generateSafetyDocumentTool.handler({ docId, draft, useProfile: false });
  return out.content.map((c) => ("text" in c ? c.text : "")).join("\n");
}
/** 본문에서 "## 제목" 구획 하나 */
function section(text: string, title: string): string {
  const i = text.indexOf(title);
  if (i < 0) return "";
  const next = text.indexOf("\n## ", i + title.length);
  return text.slice(i, next >= 0 ? next : undefined);
}
/** 단계 표의 첫 열(단계 이름) 목록 — 나온 순서대로, 중복 없이 */
function stepColumn(text: string): string[] {
  const table = section(text, "## 작업 단계별 위험요인·근거");
  const names = table.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 단계")).map((l) => l.split("|")[1].trim());
  return [...new Set(names)];
}

async function main(): Promise<void> {
  const found = await getWorkSteps(WORK);
  if (!found) throw new Error(`공종 없음: ${WORK}`);
  const focus = pickFocusSteps(WORK, found.result);
  const { conditions } = await resolveWorkConditions([CONDITION], { iri: found.result.iri, activity: found.result.activity });
  const rules = conditions.flatMap((c) => c.rules);
  const own = rules.filter((r) => r.scope === RULE_SCOPE.thisWork && r.legalWeight === "mandatory");
  const other = rules.filter((r) => r.scope === RULE_SCOPE.otherWork);
  check("시험 전제 — 강풍에 타워크레인 법령 조치와 다른 작업 조치가 함께 있고, 작업명이 단계를 가리킨다", own.length > 0 && other.length > 0 && focus.length > 0, `이 작업 ${own.length} · 다른 작업 ${other.length} · 단계 ${focus.join(",")}`);

  // 1·2. 작업명에 든 조건
  const adhoc = await draftText("ad_hoc_risk_assessment", { workName: `${WORK} ${CONDITION}` });
  const block = section(adhoc, CONDITION_HEADING);
  const plainText = (t: string): string => t.replace(/\s*<(?:개정|신설)[^>]*>/g, "");
  const missingOwn = own.filter((r) => !block.includes(plainText(r.requirement)) || !block.includes(r.basis) || (r.threshold && !block.includes(r.threshold)));
  check("수시 위험성평가: 강풍에서 타워크레인이 지킬 법령 조치가 기준값·근거와 함께 실린다", block.length > 0 && missingOwn.length === 0, missingOwn.map((r) => r.requirement.slice(0, 40)).join(" / "));
  check("수시 위험성평가: 순간풍속 초당 10미터 초과 시 설치·해체 중지(안전보건규칙 제37조)가 실린다", /10\s*m\/s|초당\s*10\s*미터/.test(block) && /§37|제37조/.test(block), block.slice(0, 200));
  const leaked = other.filter((r) => block.includes(plainText(r.requirement)));
  check("다른 작업에만 해당하는 조치는 싣지 않는다", leaked.length === 0, leaked.map((r) => r.requirement.slice(0, 40)).join(" / "));

  // 3. 작업 조건 칸
  const plan = await draftText("work_plan_tower_crane", { workName: WORK, workConditions: [CONDITION] });
  check("작업계획서: 작업 조건 칸(workConditions)의 강풍도 읽는다", section(plan, CONDITION_HEADING).includes(plainText(own[0].requirement)));

  // 4. 단계
  const planSteps = stepColumn(plan);
  check("작업계획서: 작업명이 가리키는 단계가 표 맨 앞이고 나머지 단계도 남는다", focus.includes(planSteps[0]) && planSteps.length > focus.length, planSteps.slice(0, 3).join(" → "));
  const tbm = await draftText("daily_tbm", { workName: WORK });
  const tbmSteps = stepColumn(tbm);
  check("TBM: 작업명이 가리키는 단계만 싣는다", tbmSteps.length > 0 && tbmSteps.every((s) => focus.includes(s)), tbmSteps.join(", "));

  // 5. 조건 없는 초안
  const plain = await draftText("work_plan_tower_crane", { workName: "타워크레인" });
  check("조건이 없는 초안에는 조건 구획이 없다", !plain.includes(CONDITION_HEADING));

  console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
