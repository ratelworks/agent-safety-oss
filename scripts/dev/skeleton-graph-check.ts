#!/usr/bin/env node
// 그래프 연결 무결성 점검 (사용자 입력 X, 그래프 자체)
// excavation_2m_plus 사슬의 의미적 일관성·다중 hop 추론·빠진 연결 식별

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

async function loadNode(prefix, slug) {
  try {
    return JSON.parse(
      await readFile(resolve(ROOT, `src/ontology/graph/nodes/${prefix}/${slug}.jsonld`), "utf8"),
    );
  } catch {
    return null;
  }
}

// ── 1. excavation_2m_plus 로드 ──
const activity = await loadNode("activities", "excavation_2m_plus");
console.log("═══════════════════════════════════════════════════════════════");
console.log("그래프 연결 점검 — excavation_2m_plus 사슬");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("Activity:", activity.title);
console.log("  hasHazard:", (activity.hasHazard || []).length);
console.log("  guidedBy:", (activity.guidedBy || []).length);
console.log("  causedBy:", (activity.causedBy || []).length);
console.log("  regulatedBy:", (activity.regulatedBy || []).length);
console.log("");

// ── 2. 14 hazards 로드 + 매트릭스 ──
const hazardSlugs = (activity.hasHazard || []).map((id) => id.replace("hazard:", ""));
const hazards = [];
for (const s of hazardSlugs) {
  const h = await loadNode("hazards", s);
  if (h) hazards.push({ slug: s, ...h });
}

console.log("[Hazard ↔ Control 매트릭스]");
console.log("");
console.log("Hazard                          | Controls (mitigatedBy) | Guides (guidedBy) | RegulatedBy");
console.log("─".repeat(110));
const allControls = new Set();
const allGuides = new Set();
const allArticles = new Set();
for (const h of hazards) {
  const ctrls = h.mitigatedBy || [];
  const guides = h.guidedBy || [];
  const regBy = h.regulatedBy || [];
  ctrls.forEach((c) => allControls.add(c));
  guides.forEach((g) => allGuides.add(g));
  regBy.forEach((a) => allArticles.add(a));
  console.log(
    `  ${(h.label || h.slug).padEnd(28)} | ${String(ctrls.length).padStart(3)} controls          | ${String(guides.length).padStart(3)} guides         | ${String(regBy.length).padStart(2)} articles`,
  );
}
console.log("─".repeat(110));
console.log(
  `  unique controls: ${allControls.size} / unique guides: ${allGuides.size} / unique articles: ${allArticles.size}`,
);
console.log("");

// ── 3. 다중 hop 추론: WorkActivity → Hazard → Control → Guide ──
console.log("[다중 hop 추론] Activity → Hazard → Control");
console.log("");
const hopMatrix = {};
for (const h of hazards) {
  for (const cIri of h.mitigatedBy || []) {
    const cSlug = cIri.replace("control:", "");
    if (!hopMatrix[cSlug]) hopMatrix[cSlug] = new Set();
    hopMatrix[cSlug].add(h.label || h.slug);
  }
}
const sortedControls = (Object.entries(hopMatrix) as [string, any][]).sort((a, b) => b[1].size - a[1].size);
console.log("Control → 통제하는 Hazard 수 (역방향 추적, 그래프 적합도 지표)");
console.log("");
sortedControls.slice(0, 20).forEach(([c, hSet]: [string, any]) => {
  console.log(`  ${c.padEnd(35)} ← ${hSet.size} hazards`);
});
console.log("");

// ── 4. KOSHA Guide ↔ Hazard 매핑 ──
console.log("[KOSHA Guide ↔ Hazard 매핑]");
console.log("");
const guidedHazards = {};
for (const h of hazards) {
  for (const gIri of h.guidedBy || []) {
    const slug = gIri.replace("doc:kosha_guide/", "");
    if (!guidedHazards[slug]) guidedHazards[slug] = new Set();
    guidedHazards[slug].add(h.label || h.slug);
  }
}
for (const [g, hSet] of Object.entries(guidedHazards) as [string, any][]) {
  console.log(`  ${g.padEnd(20)} ← ${hSet.size} hazards: ${[...hSet].slice(0, 5).join(", ")}`);
}
console.log("");

// ── 5. Activity의 6 KOSHA Guide vs Hazard의 guidedBy 일치도 ──
const activityGuides = new Set(
  (activity.guidedBy || []).map((id) => id.replace("doc:kosha_guide/", "")),
);
const hazardGuides = new Set(Object.keys(guidedHazards));
console.log("[Activity vs Hazards의 KOSHA Guide 일치도]");
console.log(`  Activity.guidedBy: ${activityGuides.size}개 — ${[...activityGuides].join(", ")}`);
console.log(`  Hazards의 guidedBy 합: ${hazardGuides.size}개 — ${[...hazardGuides].join(", ")}`);
const intersection = [...activityGuides].filter((g: any) => hazardGuides.has(g));
const onlyActivity = [...activityGuides].filter((g: any) => !hazardGuides.has(g));
const onlyHazards = [...hazardGuides].filter((g) => !activityGuides.has(g));
console.log(`  교집합: ${intersection.length}개 — ${intersection.join(", ")}`);
console.log(`  Activity 전용: ${onlyActivity.length}개 — ${onlyActivity.join(", ")}`);
console.log(`  Hazards 전용: ${onlyHazards.length}개 — ${onlyHazards.join(", ")}`);
console.log("");

// ── 6. 의미적 일관성 검토 — 굴착에 부적절할 수 있는 위험·통제 ──
console.log("[의미적 일관성 검토 — 굴착에 진짜 정합?]");
console.log("");
const generalHazards = ["heat_stress", "cold_stress", "ergonomic_overload", "msd_repetitive", "trip_slip", "noise_exposure"];
const inGeneral = hazards.filter((h) => generalHazards.includes(h.slug));
const inSpecific = hazards.filter((h) => !generalHazards.includes(h.slug));
console.log(`  굴착 specific hazards: ${inSpecific.length}개 — ${inSpecific.map((h) => h.label).join(", ")}`);
console.log(`  일반 hazards (모든 작업): ${inGeneral.length}개 — ${inGeneral.map((h) => h.label).join(", ")}`);
console.log("  ⚠ 일반 hazards가 굴착에 hasHazard로 매핑된 게 정확한가?");
console.log("    (예: 소음 노출은 굴착에서 발생하지만 굴착의 핵심 위험 X)");
console.log("");

// ── 7. 빠진 연결 (gap) ──
console.log("[빠진 연결 식별]");
console.log("");
const gaps = [];
for (const h of hazards) {
  if (!h.mitigatedBy || h.mitigatedBy.length === 0) gaps.push(`${h.label}: mitigatedBy 0`);
  if (!h.guidedBy || h.guidedBy.length === 0) gaps.push(`${h.label}: guidedBy 0`);
  if (!h.koshaAccidentType) gaps.push(`${h.label}: koshaAccidentType 미정의`);
}
if (gaps.length > 0) {
  console.log("  ⚠ 빠진 연결:");
  gaps.forEach((g) => console.log(`    ${g}`));
} else {
  console.log("  ✅ 모든 hazard가 mitigatedBy / guidedBy / koshaAccidentType 보유");
}
console.log("");

// ── 8. Activity의 직접 controls vs hazard 사슬 controls 차이 ──
console.log("[Activity 직접 controls (없음?) vs Hazard 사슬 controls]");
console.log(`  Activity.mitigatedBy 직접: ${(activity.mitigatedBy || []).length}개`);
console.log(`  Hazards 사슬 unique controls: ${allControls.size}개`);
console.log(`  → Activity는 통제 직접 매핑 없음. 항상 Hazard를 거쳐서.`);
console.log("");

// ── 9. 종합 그래프 신뢰도 ──
console.log("═══════════════════════════════════════════════════════════════");
console.log("종합 그래프 연결 신뢰도");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
const checks = {
  "WorkActivity → Hazard 연결": (activity.hasHazard || []).length === hazards.length,
  "모든 Hazard가 mitigatedBy 보유": hazards.every((h) => (h.mitigatedBy || []).length > 0),
  "모든 Hazard가 guidedBy 보유": hazards.every((h) => (h.guidedBy || []).length > 0),
  "Activity ↔ Hazards Guide 교집합 ≥ 50%": intersection.length / activityGuides.size >= 0.5,
  "Hazard별 평균 controls ≥ 3": allControls.size / hazards.length >= 3,
  "통제 다양성 (unique ≥ 20)": allControls.size >= 20,
};
for (const [k, v] of Object.entries(checks)) {
  console.log("  " + (v ? "✅" : "❌") + " " + k);
}
const passCount = Object.values(checks).filter((v) => v).length;
console.log("");
console.log(`  ${passCount}/${Object.keys(checks).length} — 그래프 연결 신뢰도`);
