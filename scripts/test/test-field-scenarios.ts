#!/usr/bin/env tsx
/**
 * test-field-scenarios.ts
 *
 * user-personas.json 의 8개 현장 시나리오를 field_safety_briefing 도구로 직접 호출 → 결과 검증.
 * 각 시나리오의 expectedOutputs 키워드가 결과에 포함되는지 정량 측정.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fieldSafetyBriefingTool } from "../../src/tools/field-safety-briefing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSONAS = resolve(__dirname, "..", "..", "src", "ontology", "user-personas.json");

interface Scenario {
  id: string; persona: string; title: string;
  input: string; expectedOutputs: string[];
}

(async () => {
  const data = JSON.parse(await readFile(PERSONAS, "utf-8")) as { scenarios: Scenario[] };
  const scenarios = data.scenarios;

  console.log(`╔══ 현장 시나리오 ${scenarios.length}건 통합 검증 ══╗\n`);

  let totalPass = 0, totalKeywords = 0, totalMatched = 0;

  for (const scn of scenarios) {
    const result = await fieldSafetyBriefingTool.handler({
      workOrTopic: scn.input,
      persona: scn.persona,
    });
    const text = result.content[0]?.text ?? "";

    // expectedOutputs 키워드 매칭
    let matched = 0;
    const matches: string[] = [];
    const misses: string[] = [];
    for (const kw of scn.expectedOutputs) {
      // 키워드의 핵심부 추출 (예: "법령 근거 (기준규칙 §337-§339)" → "기준규칙" + "337" 등)
      const coreKw = kw.replace(/\([^)]*\)/, "").trim().split(/\s+/);
      const found = coreKw.some(t => t.length >= 2 && text.includes(t));
      if (found) { matched++; matches.push(kw); }
      else misses.push(kw);
    }

    const pct = ((matched / scn.expectedOutputs.length) * 100).toFixed(0);
    const status = matched === scn.expectedOutputs.length ? "✅ FULL" : matched >= scn.expectedOutputs.length / 2 ? "⚠️  PARTIAL" : "❌ FAIL";
    console.log(`[${scn.id}] ${status} ${matched}/${scn.expectedOutputs.length} (${pct}%)  ${scn.title}`);
    if (misses.length > 0) {
      console.log(`         미매칭: ${misses.slice(0, 3).join(" / ")}`);
    }

    totalKeywords += scn.expectedOutputs.length;
    totalMatched += matched;
    if (matched >= scn.expectedOutputs.length * 0.7) totalPass++;
  }

  const overallPct = ((totalMatched / totalKeywords) * 100).toFixed(1);
  console.log(`\n=== 종합 ===`);
  console.log(`  통과 (>=70%): ${totalPass}/${scenarios.length}`);
  console.log(`  전체 정확도:   ${totalMatched}/${totalKeywords} = ${overallPct}%`);
})();
