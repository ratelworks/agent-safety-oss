#!/usr/bin/env tsx
/**
 * Round 8: 본문 직접 검증에서 발견된 환각·오류 5건 수정.
 *
 * 오류:
 *  1. S6 위험성평가 고시 §6 vs §9 혼동
 *  2. S6 빈도·강도 점수 계산 오류 ("12점 = 고위험" — 실제는 중위험)
 *  3. S6 미끄러짐 "4점" 계산 오류 (A=5 × IV=1 = 5점)
 *  4. S1 굴착 "한전 통신선 KT" 회사 혼동
 *  5. S1 굴착 "1544-XXXX" placeholder → 1544-4500 (한국가스공사 실제)
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "..", "src/ontology/graph/nodes/documents");

const REPLACEMENTS: Array<{ doc: string; field: string; prop: string; from: RegExp; to: string }> = [
  // S6: 점수 계산 오류 수정 (12점 = 중위험, 5점 = 저위험)
  { doc: "regular-risk-assessment", field: "riskLevel", prop: "examples",
    from: /매몰: C × I = 12점 = 고위험/g, to: "매몰: C × I = 12점 = 중위험" },
  { doc: "regular-risk-assessment", field: "riskLevel", prop: "examples",
    from: /A \(상시\) × IV \(미미\) = 4점/g, to: "A (상시) × IV (미미) = 5점" },
  { doc: "monthly-risk-assessment", field: "riskLevel", prop: "examples",
    from: /매몰: C × I = 12점 = 고위험/g, to: "매몰: C × I = 12점 = 중위험" },
  { doc: "monthly-risk-assessment", field: "riskLevel", prop: "examples",
    from: /A \(상시\) × IV \(미미\) = 4점/g, to: "A (상시) × IV (미미) = 5점" },
  { doc: "ad-hoc-risk-assessment", field: "riskLevel", prop: "examples",
    from: /매몰: C × I = 12점 = 고위험/g, to: "매몰: C × I = 12점 = 중위험" },
  { doc: "ad-hoc-risk-assessment", field: "riskLevel", prop: "examples",
    from: /A \(상시\) × IV \(미미\) = 4점/g, to: "A (상시) × IV (미미) = 5점" },
  { doc: "initial-risk-assessment", field: "riskLevel", prop: "examples",
    from: /매몰: C × I = 12점 = 고위험/g, to: "매몰: C × I = 12점 = 중위험" },
  { doc: "initial-risk-assessment", field: "riskLevel", prop: "examples",
    from: /A \(상시\) × IV \(미미\) = 4점/g, to: "A (상시) × IV (미미) = 5점" },

  // S1: 한전·KT 혼동 + placeholder
  { doc: "work-plan-excavation", field: "plan.protectBuried", prop: "examples",
    from: /한전 통신선 KT 입회/g, to: "한전(한국전력공사) 전력선 입회 + KT 통신선 입회 (별도 협의)" },
  { doc: "work-plan-excavation", field: "plan.protectBuried", prop: "examples",
    from: /가스공사 24시간 비상연락 1544-XXXX/g, to: "한국가스공사 24시간 비상연락 1544-4500" },
];

async function main() {
  const docs = await readdir(DOCS);
  let totalFixed = 0;

  for (const r of REPLACEMENTS) {
    const file = `${r.doc}.jsonld`;
    if (!docs.includes(file)) continue;
    const path = resolve(DOCS, file);
    const node = JSON.parse(await readFile(path, "utf-8"));
    let fixed = 0;
    for (const sec of node.sections ?? []) {
      for (const f of sec.fields ?? []) {
        if (f.key !== r.field) continue;
        const cur = f[r.prop];
        if (Array.isArray(cur)) {
          const newArr = cur.map((s: string) => typeof s === "string" ? s.replace(r.from, r.to) : s);
          if (JSON.stringify(newArr) !== JSON.stringify(cur)) {
            f[r.prop] = newArr;
            fixed += 1;
          }
        }
      }
    }
    if (fixed > 0) {
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      console.log(`  ✓ ${r.doc} / ${r.field}.${r.prop}: ${fixed}곳 수정`);
      totalFixed += fixed;
    }
  }
  console.log(`\n[done] 총 ${totalFixed}곳 환각 수정`);
}
main().catch(console.error);
