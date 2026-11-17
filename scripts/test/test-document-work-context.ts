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
 *   6. 같은 현장 장면 나란히 측정(2026-11-17)에서 나온 결함
 *      — 낱말 일부만 여러 공종에 똑같이 맞으면 단계표를 붙이지 않고(조건 조치는 싣는다), 단계는 낱말 단위로 짚는다
 *      — 작업명에 공종 이름이 둘이면 두 공종의 단계를 함께 싣는다
 *      — 적용 KOSHA Guide 는 이 작업의 대책 근거 지침을 먼저 싣고, 적용범위가 화학공정인 지침은 싣지 않는다
 *      — 식별된 위험 요소는 작업 단계 자료의 재해유형이다
 *      — 이동식 크레인은 이동식 크레인 조항(제147조~제150조)을, 밀폐공간은 작업 전 확인 각 호·적정공기 기준을 싣는다
 *   7. 서류·안내·서식이 적은 위험성평가 고시 조·항·호는 현행 고시(2026-11-04 전부개정)에 있다 — 옛 번호(제15조 ④ 상시평가 등) 방지
 *
 * 사용: tsx scripts/test/test-document-work-context.ts
 */
import "./isolated-storage.js"; // 저장 폴더를 임시 폴더로 — 사용자 문서 폴더에 파일을 남기지 않는다
import { generateSafetyDocumentTool } from "../../src/tools/generate-safety-document.js";
import { resolveWorkConditions, RULE_SCOPE } from "../../src/lib/work-conditions.js";
import { getWorkSteps, pickFocusSteps } from "../../src/lib/work-steps.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const WORK = "타워크레인 지브 조립";
const CONDITION = "강풍";
const CONDITION_HEADING = "## 작업 조건별 지켜야 할 조치";
const ONTOLOGY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "ontology");
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
/** 위험성평가 고시를 따르는 서류 파일 — 이 안의 맨 "고시" 는 위험성평가 고시 */
const RISK_DOC_FILE = /(risk[-_]assessment|daily[-_]tbm|weekly[-_]joint|worker[-_]complaint)/;
/**
 * 위험성평가 고시 인용 한 덩이 — 조 번호 뒤에 이어지는 항·호 표기를 통째로 잘라 낸다
 * ("위험성평가 고시 제16조제1항제3호", "고시 §15 ②·③ 1~5호", "고시 제15조제1항·제3항", "위험성평가-고시:16:1").
 * 덩이는 연결어(·, 및, 또는 …)를 나열하지 않고 경계로 끊는다 — 다른 조 인용(제N조·§N), 닫는 괄호, 콜론 뒤 목록, 따옴표, 줄바꿈, 마침표, 대시.
 * 덩이 안의 항·호는 아래에서 하나하나 뽑아 모두 대조한다
 */
const NOTICE_REF = /(위험성평가 고시|위험성평가-고시|고시)\s*(?:제|§|:)\s*(\d+)조?((?:(?!제\s*\d+\s*조|§)[^)"\n.:—])*(?::\d+)?)/g;
/** 덩이 안의 항 — "제2항"·"②"·콜론 형식(":1") */
const PARA_IN = /제?(\d+)항|([①-⑩])|:(\d+)/g;
/** 덩이 안의 호 — "3호"·"1~5호" */
const ITEM_IN = /제?(\d+)(?:~(\d+))?호/g;

/** 서류 노드·안내·서식·동의어·의무 목록에서 위험성평가 고시 인용 중 현행 고시에 없는 조·항·호 */
function staleNoticeRefs(): { checked: number; missing: string[] } {
  const files = [
    ...readdirSync(resolve(ONTOLOGY, "graph/nodes/documents")).map((f) => resolve(ONTOLOGY, "graph/nodes/documents", f)),
    ...readdirSync(resolve(ONTOLOGY, "guides")).map((f) => resolve(ONTOLOGY, "guides", f)),
    ...readdirSync(resolve(ONTOLOGY, "forms/auto")).map((f) => resolve(ONTOLOGY, "forms/auto", f)),
    ...readdirSync(resolve(ONTOLOGY, "kras-methods")).map((f) => resolve(ONTOLOGY, "kras-methods", f)),
    resolve(ONTOLOGY, "synonyms.json"),
    resolve(ONTOLOGY, "legal-duty-master.json"),
  ];
  let checked = 0;
  const missing: string[] = [];
  for (const f of files.filter((x) => /\.(jsonld|json|md)$/.test(x))) {
    const text = readFileSync(f, "utf-8");
    // 개정 전 고시(제2024-76호)는 "이전 판" 이라고 밝힌 줄에서만 쓴다 — 그 판의 조번호·원문을 현행처럼 싣지 않게
    for (const line of text.split("\n")) if (line.includes("2024-76") && !line.includes("이전 판")) missing.push(`${f.split("/").pop()}:개정 전 고시 제2024-76호를 현행처럼 씀`);
    for (const m of text.matchAll(NOTICE_REF)) {
      // 맨 "고시" 는 위험성평가 서류(수시·정기·최초·월·TBM·주간·근로자 의견) 파일 안이거나 앞 40자 안에 "위험성평가" 가 있을 때만(다른 고시와 구분),
      // 고시 번호(제2026-73호)는 조가 아니다
      if (m[1] === "고시" && !RISK_DOC_FILE.test(f) && !text.slice(Math.max(0, m.index! - 40), m.index).includes("위험성평가")) continue;
      if (Number(m[2]) >= 1000) continue;
      const node = resolve(ONTOLOGY, "graph/nodes/articles", `위험성평가-고시-§${m[2]}.jsonld`);
      const where = `${f.split("/").pop()}:${m[0]}`;
      if (!existsSync(node)) { missing.push(`${where}(조 없음)`); continue; }
      checked += 1;
      const body = String((JSON.parse(readFileSync(node, "utf-8")) as { description?: string }).description ?? "");
      const tail = m[3] ?? "";
      // 항마다 그 항의 본문 — 덩이에 적힌 항을 모두("②·③", "제1항·제3항")
      const paras = [...tail.matchAll(PARA_IN)].map((x) => (x[1] ? Number(x[1]) : x[2] ? CIRCLED.indexOf(x[2]) + 1 : Number(x[3])));
      const scopes: string[] = [];
      for (const p of paras) {
        const i = body.indexOf(CIRCLED[p - 1]);
        if (i < 0 && !(p === 1 && !body.includes("②"))) { missing.push(`${where}(${p}항 없음)`); continue; }
        const j = i >= 0 && p < CIRCLED.length ? body.indexOf(CIRCLED[p], i + 1) : -1;
        scopes.push(i >= 0 ? body.slice(i, j > 0 ? j : undefined) : body);
      }
      // 호마다 — 범위("1~5호")는 끝 호까지 하나하나, 적힌 항 가운데 어느 하나에 있으면 된다(항이 없으면 조 전체)
      const itemScope = paras.length > 0 ? scopes.join("\n") : body;
      for (const x of tail.matchAll(ITEM_IN)) {
        const [from, to] = [Number(x[1]), Number(x[2] ?? x[1])];
        for (let k = from; k <= to; k += 1) {
          if (!new RegExp(`(^|\\n)\\s*${k}\\.\\s`).test(itemScope)) { missing.push(`${where}(${k}호 없음)`); break; }
        }
      }
    }
  }
  return { checked, missing };
}

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

  const tbmBoth = stepColumn(await draftText("daily_tbm", { workName: `${WORK} 및 해체` }));
  check("TBM: 작업명이 다른 단계(해체)도 가리키면 단계를 줄이지 않는다", tbmBoth.some((s) => s.includes("해체")) && focus.includes(tbmBoth[0]), tbmBoth.join(", "));

  // 5. 조건 없는 초안
  const plain = await draftText("work_plan_tower_crane", { workName: "타워크레인" });
  check("조건이 없는 초안에는 조건 구획이 없다", !plain.includes(CONDITION_HEADING));

  // 6. 나란히 측정 결함
  const crane = await draftText("ad_hoc_risk_assessment", { workName: "이동식 크레인으로 PC 부재 설치", workConditions: ["야간작업"] });
  const craneSteps = section(crane, "## 작업 단계별 위험요인·근거");
  check("낱말 일부(이동식)만 여러 공종에 똑같이 맞으면 단계표를 붙이지 않고 그 사실을 적는다", craneSteps.includes("공종을 정하지 못함") && !craneSteps.includes("| 설치 및 사용 |") && !crane.includes("사다리가 넘어지거나"), craneSteps.slice(0, 120));
  const craneHazards = section(crane, "## 식별된 위험 요소");
  check("공종을 정하지 못하면 식별된 위험 요소에 서류 종류의 예시 위험을 싣지 않는다", craneHazards.includes("공종을 정하지 못해") && !craneHazards.includes("폭발"), craneHazards.split("\n").slice(0, 3).join(" "));
  const unknown = await draftText("ad_hoc_risk_assessment", { workName: "광케이블 융착" });
  const unknownHazards = section(unknown, "## 식별된 위험 요소");
  check("공종을 못 찾고 작업 조건도 없어도 예시 위험을 싣지 않고 못 찾았다고 적는다", unknownHazards.includes("공종을 정하지 못해") && !unknownHazards.includes("폭발") && unknown.includes("에 맞는 공종을 찾지 못했습니다"), unknownHazards.split("\n").slice(0, 3).join(" "));
  const craneCond = section(crane, CONDITION_HEADING);
  check("공종을 정하지 못해도 작업 조건 조치는 싣는다 — 작업명의 이동식 크레인은 이동식 크레인 조항", craneCond.includes("### 작업 조건 — 야간작업") && craneCond.includes("§149") && craneCond.includes("§150") && !craneCond.includes("§146"), craneCond.match(/§\d+/g)?.join(",") ?? "");
  const tbmBeam = stepColumn(await draftText("daily_tbm", { workName: "고소작업대로 철골 보 볼트 체결" }));
  check("단계는 낱말 단위로 짚는다 — 볼트 체결은 앵커볼트 매립이 아니라 보 설치", tbmBeam.length > 0 && tbmBeam.every((s) => s === "보 설치"), tbmBeam.join(", "));
  const deck = stepColumn(await draftText("daily_tbm", { workName: "철골 보 위에서 데크플레이트 설치" }));
  check("\"보 위에서\" 처럼 자리를 가리키는 낱말로는 단계를 고르지 않는다 — 데크플레이트 설치", deck.length > 0 && deck.every((s) => s.includes("Deck Plate")), deck.join(", "));
  const paint = await draftText("ad_hoc_risk_assessment", { workName: "외부 강관비계 위에서 외벽 도장 작업" });
  const paintSteps = stepColumn(paint);
  check("작업명에 공종 이름이 둘이면 두 공종의 단계를 함께 싣는다", paintSteps.some((s) => s.startsWith("강관비계 · ")) && paintSteps.some((s) => s.startsWith("도장작업 · ")), [...new Set(paintSteps.map((s) => s.split(" · ")[0]))].join(", "));
  const formwork = await draftText("ad_hoc_risk_assessment", { workName: "거푸집 동바리 해체", workConditions: ["강풍"] });
  const guides = section(formwork, "## 적용 KOSHA Guide");
  const PROCESS_GUIDES = ["C-C-22-2026", "C-C-37-2026", "X-78-2018", "E-179-2020", "E-G-17-2026"];
  check("적용 KOSHA Guide: 이 작업의 대책 근거 지침이 먼저, 적용범위가 화학공정인 지침은 없다", /\| D-C-9-2026 \| [^|]+ \| 이 작업의 대책 근거 \|/.test(guides) && PROCESS_GUIDES.every((g) => !guides.includes(g)), guides.split("\n").filter((l) => l.startsWith("| ") && !l.includes("---")).slice(1, 4).join(" / "));
  const hazards = section(formwork, "## 식별된 위험 요소");
  check("식별된 위험 요소는 작업 단계 자료의 재해유형이다", hazards.includes("거푸집작업 작업 단계 자료") && hazards.includes("무너짐") && !hazards.includes("폭발"), hazards.split("\n")[0]);
  const manhole = section(await draftText("ad_hoc_risk_assessment", { workName: "맨홀 내부 작업", workConditions: ["밀폐공간"] }), CONDITION_HEADING);
  check("밀폐공간: 작업 전 확인 각 호와 적정공기 기준·측정·인원 점검을 싣는다", manhole.includes("3. 산소 및 유해가스 농도의 측정결과") && manhole.includes("18퍼센트 이상 23.5퍼센트 미만") && manhole.includes("§619의2") && manhole.includes("§621"), manhole.match(/§[\d의]+/g)?.join(",") ?? "");

  // 7. 위험성평가 고시 인용 — 현행 조·항·호
  const notice = staleNoticeRefs();
  check("서류·안내·서식의 위험성평가 고시 조·항·호 인용이 현행 고시에 있다", notice.checked > 100 && notice.missing.length === 0, `인용 ${notice.checked}건, 없는 것 ${notice.missing.slice(0, 5).join(", ") || 0}`);
  const adhoc2 = await draftText("ad_hoc_risk_assessment", { workName: "거푸집 동바리 해체" });
  check("수시 위험성평가는 상시평가로 갈음된다고 적지 않는다 — 현행 고시 제16조제2항", !adhoc2.includes("갈음 가능") && adhoc2.includes("제16조제2항"), adhoc2.match(/[^\n]*상시평가[^\n]*/)?.[0]?.slice(0, 120) ?? "");

  console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
