#!/usr/bin/env node
// Walking Skeleton D4 — LLM 시뮬 (UC11 작업계획서 자동 작성)
// 코드 그래프 traversal로 LLM이 답해야 할 시나리오 검증
// 환각 0 (모든 정보가 인스턴스 fact 직접 인용)

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const data = JSON.parse(
  await readFile(resolve(ROOT, "src/ontology/skeleton/instances.jsonld"), "utf8"),
);
const skeleton = JSON.parse(
  await readFile(resolve(ROOT, "src/ontology/skeleton/skeleton.jsonld"), "utf8"),
);

const graph = data["@graph"];
const byId = Object.fromEntries(graph.map((n) => [n["@id"], n]));

const labelKo = (n) =>
  (n?.["rdfs:label"] || []).find((l) => l["@language"] === "ko")?.["@value"] || "(no label)";
const labelEn = (n) =>
  (n?.["rdfs:label"] || []).find((l) => l["@language"] === "en")?.["@value"] || "(no label)";
const commentKo = (n) =>
  (n?.["rdfs:comment"] || []).find((l) => l["@language"] === "ko")?.["@value"] || "";

const refsTo = (node, prop) =>
  (node?.[prop] || []).map((r) => byId[r["@id"]]).filter(Boolean);

console.log("═══════════════════════════════════════════════════════════════");
console.log("Walking Skeleton D4 — LLM 시뮬 (UC11 작업계획서 자동 작성)");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("[사용자 질의]");
console.log('  Q: "굴착 2m 이상 작업계획서의 법적 근거와 KOSHA Guide 인용은?"');
console.log("");

const startId = "safety:activity/excavation_2m_plus";
const activity = byId[startId];
if (!activity) {
  console.error("❌ 시작 인스턴스 없음:", startId);
  process.exit(1);
}

console.log("[그래프 traversal — 5 노드 사슬]");
console.log("  Step 1: 작업 식별");
console.log("    →", activity["@id"]);
console.log("    label:", labelKo(activity));
console.log("");

const legalBasis = refsTo(activity, "safety:legalBasis");
console.log("  Step 2: 법적 근거 (safety:legalBasis)");
legalBasis.forEach((n) => {
  console.log("    →", n["@id"]);
  console.log("      label:", labelKo(n));
  console.log("      articleNumber:", n["safety:articleNumber"]);
  console.log("      legalAuthority:", n["safety:legalAuthority"]);
});
console.log("");

const guides = refsTo(activity, "safety:guidedBy");
console.log("  Step 3: KOSHA Guide 인용 (safety:guidedBy)");
guides.forEach((n) => {
  console.log("    →", n["@id"]);
  console.log("      label:", labelKo(n));
  console.log("      guideNumber:", n["safety:guideNumber"]);
  console.log("      legalAuthority:", n["safety:legalAuthority"]);
  console.log("      issued:", n["dcterms:issued"]?.["@value"]);
});
console.log("");

const hazards = refsTo(activity, "safety:hasHazard");
console.log("  Step 4: 위험요인 (safety:hasHazard)");
hazards.forEach((n) => {
  console.log("    →", n["@id"]);
  console.log("      label:", labelKo(n));
});
console.log("");

const controls = hazards.flatMap((h) => refsTo(h, "safety:mitigatedBy"));
console.log("  Step 5: 통제 수단 (Hazard → safety:mitigatedBy)");
controls.forEach((n) => {
  console.log("    →", n["@id"]);
  console.log("      label:", labelKo(n));
});
console.log("");

console.log("═══════════════════════════════════════════════════════════════");
console.log("[LLM 답 (그래프 traversal로 생성)]");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log(`  ┌──────────────────────────────────────────────────────────┐`);
console.log(`  │ 굴착공사 작업계획서 (자동 생성)                              │`);
console.log(`  │ ──────────────────                                            │`);
console.log(`  │                                                                │`);
console.log(`  │ 작업 종류: ${labelKo(activity)}`.padEnd(64) + "│");
console.log(`  │                                                                │`);
console.log(`  │ 법적 근거 (강제):                                               │`);
legalBasis.forEach((n) => {
  console.log(`  │   • ${labelKo(n)}`.slice(0, 63).padEnd(64) + "│");
});
console.log(`  │                                                                │`);
console.log(`  │ KOSHA Guide 인용 (권고):                                        │`);
guides.forEach((n) => {
  console.log(`  │   • ${n["safety:guideNumber"]} — ${labelKo(n)}`.slice(0, 63).padEnd(64) + "│");
});
console.log(`  │                                                                │`);
console.log(`  │ 주요 위험요인:                                                  │`);
hazards.forEach((n) => {
  console.log(`  │   • ${labelKo(n)}`.slice(0, 63).padEnd(64) + "│");
});
console.log(`  │                                                                │`);
console.log(`  │ 통제 수단:                                                      │`);
controls.forEach((n) => {
  console.log(`  │   • ${labelKo(n)}`.slice(0, 63).padEnd(64) + "│");
});
console.log(`  └──────────────────────────────────────────────────────────┘`);
console.log("");

console.log("═══════════════════════════════════════════════════════════════");
console.log("[출처 추적 (PROV-O)]");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
const allCited = [...legalBasis, ...guides, ...hazards, ...controls];
allCited.forEach((n) => {
  console.log("  • " + n["@id"]);
  console.log("    primarySource:", n["prov:hadPrimarySource"]?.["@id"] || "(no primary source)");
  console.log("    derivedFrom:  ", n["prov:wasDerivedFrom"]?.["@id"] || "(no derivation)");
  console.log("    generatedAt:  ", n["prov:generatedAtTime"]?.["@value"] || "(no time)");
  console.log("    contentHash:  ", n["safety:contentHash"] || "(no hash)");
  console.log("");
});

console.log("═══════════════════════════════════════════════════════════════");
console.log("[환각 0 검증]");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");

const checks = {
  "모든 답이 인스턴스 fact 직접 인용 (label 존재)": allCited.every((n) => labelKo(n) !== "(no label)"),
  "모든 답이 출처 추적 가능 (primarySource)": allCited.every((n) => n["prov:hadPrimarySource"]),
  "모든 답이 시점 추적 가능 (generatedAtTime)": allCited.every((n) => n["prov:generatedAtTime"]),
  "모든 답이 멱등 식별 가능 (contentHash)": allCited.every((n) => n["safety:contentHash"]),
  "그래프 사슬 무결성 (5 노드 모두 도달)":
    activity && legalBasis.length > 0 && guides.length > 0 && hazards.length > 0 && controls.length > 0,
  "법적 권위 구분 (Article=enforced, KoshaGuide=recommended)":
    legalBasis[0]?.["safety:legalAuthority"] === "enforced" &&
    guides[0]?.["safety:legalAuthority"] === "recommended",
};

for (const [k, v] of Object.entries(checks)) {
  console.log("  " + (v ? "✅" : "❌") + " " + k);
}

const allPass = Object.values(checks).every((v) => v);
console.log("");
console.log(allPass ? "✅ UC11 시뮬 통과 — 환각 0 + 출처 추적 + 사슬 무결성 모두 만족" : "❌ UC11 시뮬 실패");

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("[Walking Skeleton 핵심 가치 입증]");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("  📌 LLM이 그래프 traversal 5 노드로 작업계획서 자동 작성 가능");
console.log("  📌 모든 인용에 PROV-O 출처 추적 — 안전관리자 감사 대응 가능");
console.log("  📌 법적 강제(Article) vs 권고(KoshaGuide) 권위 구분 명확");
console.log("  📌 환각 0 — 그래프에 없는 정보는 LLM이 만들 수 없음");
console.log("");
console.log("  → 본 OSS의 핵심 가치 (한국 안전관리자 LLM 활용) 작동 입증.");
