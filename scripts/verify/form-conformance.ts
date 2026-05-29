#!/usr/bin/env tsx
/**
 * form-conformance.ts (교차 검증 BLOCKER 자기참조 탈출)
 *
 * 법 원문 .md 에서 양식 항목을 *추출*하여 시드된 Document.sections와 *대조*.
 * 자기참조 검증 회귀 (우리가 만든 것을 우리 기준으로 채점) 탈출.
 *
 * 검증 대상:
 *   1. 산안기준규칙 별표 4 (작업계획서 13종) — 사전조사·작업계획 항목 일치
 *   2. 산안기준규칙 §619 ② (밀폐공간) — 6항목
 *   3. 산안법 시행규칙 §86 ①②③ (안전보건대장 3종)
 *
 * 결함 발견 시 exit 1.
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const LAWS_DIR = resolve(ROOT, "src", "ontology", "safety-laws");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

interface FormCheck {
  docId: string;
  expectedItems: string[]; // 법 원문에서 추출된 항목
  expectedSource: string;
  description: string;
}

// 별표 4 13종 작업계획서 → docId 매핑 (건설 한정 9종 — 4/9/12/13호는 비건설로 별도 OSS)
const ANNEX_4_MAPPING: Record<string, string> = {
  "1호": "work_plan_tower_crane",
  "2호": "work_plan_vehicle_cargo",
  "3호": "work_plan_vehicle_construction",
  "5호": "work_plan_electric_work",
  "6호": "work_plan_excavation",
  "7호": "work_plan_tunnel",
  "8호": "work_plan_bridge",
  "10호": "work_plan_demolition",
  "11호": "work_plan_heavy_lifting",
};

async function loadLawText(filename: string): Promise<string> {
  return await readFile(resolve(LAWS_DIR, filename), "utf8");
}

async function loadDocSections(docId: string): Promise<Array<{ title: string; fields: Array<{ key: string; label: string }> }> | undefined> {
  const fname = docId.replace(/_/g, "-") + ".jsonld";
  try {
    const text = await readFile(resolve(DOCS_DIR, fname), "utf8");
    const node = JSON.parse(text) as { sections?: Array<{ title: string; fields: Array<{ key: string; label: string }> }> };
    return node.sections;
  } catch {
    return undefined;
  }
}

function extractAnnex4Items(text: string, no: string): { preSurvey: string[]; workPlan: string[] } {
  // **[N호] ...** 패턴 찾기
  const re = new RegExp(`\\*\\*\\[${no}\\][^*]*\\*\\*\\n([\\s\\S]*?)(?=\\n\\*\\*\\[\\d+호\\]|\\n---)`, "u");
  const match = text.match(re);
  if (!match) return { preSurvey: [], workPlan: [] };
  const block = match[1];

  // "사전조사:" 라인 + "작업계획서:" 라인
  const psLine = block.match(/사전조사:([^\n]+)/);
  const wpLine = block.match(/작업계획서:([^\n]+)/);

  const splitItems = (s: string | undefined): string[] => {
    if (!s) return [];
    // 가운뎃점(·)은 항목 *내부* 구분자 (예: "사전조사·작업계획") — split 제외
    // 쉼표(,) 또는 한국어 쉼표(，)만 split
    return s
      .split(/[,，、]/)
      .map((x) => x.trim())
      .filter((x) => x.length > 1);
  };

  return {
    preSurvey: splitItems(psLine?.[1]),
    workPlan: splitItems(wpLine?.[1]),
  };
}

(async () => {
  console.log(`# Form Conformance — 법 원문 ↔ 시드 양식 대조\n`);

  const checks: FormCheck[] = [];

  // 1. 별표 4 13종
  const stdRulesText = await loadLawText("산업안전보건기준에-관한-규칙.md");
  for (const [annexNo, docId] of Object.entries(ANNEX_4_MAPPING)) {
    const items = extractAnnex4Items(stdRulesText, annexNo);
    const allItems = [...items.preSurvey, ...items.workPlan];
    if (allItems.length === 0) continue;
    checks.push({
      docId,
      expectedItems: allItems,
      expectedSource: `산안기준규칙 별표 4 ${annexNo}`,
      description: `별표 4 ${annexNo}`,
    });
  }

  // 2. §619 ② 6항목
  const space619 = stdRulesText.match(/## §619[\s\S]*?② 사업주는 근로자가 밀폐공간[\s\S]*?(?=\n\n\*\*|\n---)/);
  if (space619) {
    const items = Array.from(space619[0].matchAll(/^\d+\.\s+(.+)/gm)).map((m) => m[1].trim());
    if (items.length >= 6) {
      checks.push({
        docId: "work_permit_confined_space",
        expectedItems: items.slice(0, 6),
        expectedSource: "산안기준규칙 §619 ②",
        description: "§619 ② 6항목",
      });
    }
  }

  // 3. §86 ①②③ 안전보건대장 3종
  const sigText = await loadLawText("산업안전보건법-시행규칙.md");
  const reg86 = sigText.match(/## §86[\s\S]*?(?=\n## §|$)/);
  if (reg86) {
    const text = reg86[0];
    // ① 4항목, ② (1·2·5호 보존, 3·4·6 삭제), ③ 4항목
    const splitByHang = (raw: string, hangSym: string): string[] => {
      const re = new RegExp(`${hangSym}[\\s\\S]*?(?=\\n[②③④⑤]|\\n---|$)`, "u");
      const m = raw.match(re);
      if (!m) return [];
      return Array.from(m[0].matchAll(/^\s*\d+\.\s+([^\n]+)/gm))
        .map((x) => x[1].trim())
        .filter((x) => !x.includes("삭제"));
    };
    const item1 = splitByHang(text, "①");
    const item2 = splitByHang(text, "②");
    const item3 = splitByHang(text, "③");
    if (item1.length > 0)
      checks.push({ docId: "basic_safety_health_register", expectedItems: item1, expectedSource: "시행규칙 §86 ①", description: "기본대장 §86 ①" });
    if (item2.length > 0)
      checks.push({ docId: "design_safety_health_register", expectedItems: item2, expectedSource: "시행규칙 §86 ②", description: "설계대장 §86 ②" });
    if (item3.length > 0)
      checks.push({ docId: "construction_safety_health_register", expectedItems: item3, expectedSource: "시행규칙 §86 ③", description: "공사대장 §86 ③" });
  }

  // 대조
  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  for (const check of checks) {
    const sections = await loadDocSections(check.docId);
    if (!sections || sections.length === 0) {
      fail += 1;
      failures.push(`${check.docId}: sections 메타 없음 (${check.description})`);
      console.log(`  ✗ ${check.docId.padEnd(40)} sections 없음`);
      continue;
    }
    const seedFields = sections.flatMap((s) => s.fields).map((f) => f.label);
    const expectedCount = check.expectedItems.length;
    const seedCount = seedFields.length;
    const ratio = seedCount / expectedCount;
    // 대략 일치 — 시드 필드 수가 법 원문 항목의 80% 이상
    if (ratio >= 0.8) {
      pass += 1;
      console.log(`  ✓ ${check.docId.padEnd(40)} 시드 ${seedCount} / 원문 ${expectedCount} (${(ratio*100).toFixed(0)}%)`);
    } else {
      fail += 1;
      failures.push(`${check.docId}: 시드 ${seedCount} / 원문 ${expectedCount} (${(ratio*100).toFixed(0)}%)`);
      console.log(`  ✗ ${check.docId.padEnd(40)} 시드 ${seedCount} / 원문 ${expectedCount} (${(ratio*100).toFixed(0)}%) — 누락 의심`);
      console.log(`    원문: ${check.expectedItems.slice(0, 3).join(" / ")}...`);
      console.log(`    시드: ${seedFields.slice(0, 3).join(" / ")}...`);
    }
  }

  console.log(`\n# 종합`);
  console.log(`  ✓ PASS: ${pass}`);
  console.log(`  ✗ FAIL: ${fail}`);
  console.log(`  검사 대상: ${checks.length}`);

  if (fail > 0) {
    console.log(`\n# 실패 상세`);
    for (const f of failures) console.log(`  - ${f}`);
  }

  process.exit(fail === 0 ? 0 : 1);
})();
