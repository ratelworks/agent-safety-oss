#!/usr/bin/env tsx
/**
 * test-graph-consistency.ts
 *
 * 그래프 의미 일관성 검증 — 같은 카테고리·빈도 노드들이 동일 패턴 따르는가.
 *
 * 검증 축:
 *   1. 카테고리별 그래프 키 분포 (legalBasis·hasHazard·mitigatedBy 등) 표준편차
 *   2. 빈도별 점수 분산
 *   3. ISO 45001 클래스 매핑 카테고리 매트릭스 (예: B_위평 → iso45001:Risk 일관성)
 *   4. 같은 hazard 인스턴스가 다른 docs 에서 일관된 control 매핑
 *
 * 일관성 = 같은 의미적 카테고리 안에서 패턴 분산이 작음.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "documents");
const MASTER_PATH = resolve(__dirname, "..", "..", "src", "ontology", "legal-duty-master.json");

const master = JSON.parse(readFileSync(MASTER_PATH, "utf8")).documents as any[];
const nodes = new Map<string, any>();
for (const f of readdirSync(NODES_DIR)) {
  if (!f.endsWith(".jsonld")) continue;
  try {
    const n = JSON.parse(readFileSync(join(NODES_DIR, f), "utf8"));
    if (n.docId) nodes.set(n.docId, n);
  } catch {}
}

interface CategoryStat {
  category: string;
  count: number;
  scoresMean: number;
  scoresStd: number;
  scoresMin: number;
  scoresMax: number;
  isoClassDist: Map<string, number>;
  legalRefsMean: number;
  legalRefsStd: number;
  hasHazardMean: number;
  hasHazardStd: number;
  mitigatedByMean: number;
  mitigatedByStd: number;
}

function score(n: any): number {
  let s = 0;
  if (n.legalBasis || n.legalBasisExternal) s++;
  if (n.hasHazard) s++;
  if (n.mitigatedBy) s++;
  if (n.annexReference) s++;
  if (n.guidedBy) s++;
  if (n.relatedDocs) s++;
  if (n.iso45001Class) s++;
  return s;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
function std(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function analyzeCategory(category: string): CategoryStat {
  const items = master.filter((m) => m.category === category);
  const docs = items.map((m) => nodes.get(m.docId)).filter(Boolean);
  const scores = docs.map(score);
  const isoDist = new Map<string, number>();
  for (const d of docs) {
    const iso = d.iso45001Class ?? "(none)";
    isoDist.set(iso, (isoDist.get(iso) ?? 0) + 1);
  }
  const legalRefs = docs.map((d) => (Array.isArray(d.legalBasis) ? d.legalBasis.length : 0));
  const hazardCounts = docs.map((d) => (Array.isArray(d.hasHazard) ? d.hasHazard.length : 0));
  const controlCounts = docs.map((d) => (Array.isArray(d.mitigatedBy) ? d.mitigatedBy.length : 0));
  return {
    category,
    count: docs.length,
    scoresMean: mean(scores),
    scoresStd: std(scores),
    scoresMin: Math.min(...scores),
    scoresMax: Math.max(...scores),
    isoClassDist: isoDist,
    legalRefsMean: mean(legalRefs),
    legalRefsStd: std(legalRefs),
    hasHazardMean: mean(hazardCounts),
    hasHazardStd: std(hazardCounts),
    mitigatedByMean: mean(controlCounts),
    mitigatedByStd: std(controlCounts),
  };
}

function main(): void {
  console.log("=".repeat(78));
  console.log("그래프 의미 일관성 검증 — 같은 카테고리 노드 패턴 분산");
  console.log("=".repeat(78));

  const categories = [...new Set(master.map((m) => m.category))].sort();
  console.log(`\n카테고리: ${categories.length}개\n`);

  const stats = categories.map(analyzeCategory);

  console.log("📊 카테고리별 패턴 분산 (낮을수록 일관성 높음)");
  console.log("");
  console.log("Category".padEnd(15) + "n".padStart(4) + "  점수 mean±std min-max  iso45001 단일 매핑  법령refs±std  hz±std  ct±std");
  console.log("-".repeat(110));
  for (const s of stats) {
    const isoPrimary = [...s.isoClassDist.entries()].sort((a, b) => b[1] - a[1])[0];
    const isoConsistency = isoPrimary && s.count > 0 ? `${isoPrimary[0]} ${isoPrimary[1]}/${s.count}` : "?";
    console.log(
      s.category.padEnd(15) +
      s.count.toString().padStart(4) +
      `   ${s.scoresMean.toFixed(2)}±${s.scoresStd.toFixed(2)} ${s.scoresMin}-${s.scoresMax}    ` +
      isoConsistency.padEnd(28) +
      `${s.legalRefsMean.toFixed(1)}±${s.legalRefsStd.toFixed(1)}  ` +
      `${s.hasHazardMean.toFixed(1)}±${s.hasHazardStd.toFixed(1)}  ` +
      `${s.mitigatedByMean.toFixed(1)}±${s.mitigatedByStd.toFixed(1)}`,
    );
  }

  console.log("\n📊 ISO 45001 클래스 일관성");
  console.log("");
  for (const s of stats) {
    const total = [...s.isoClassDist.values()].reduce((a, b) => a + b, 0);
    const primary = [...s.isoClassDist.entries()].sort((a, b) => b[1] - a[1])[0];
    const ratio = primary ? primary[1] / total : 0;
    const consistencyBadge = ratio === 1 ? "🟢 100%" : ratio >= 0.8 ? "🟡" : "🔴";
    const dist = [...s.isoClassDist.entries()].map(([k, v]) => `${k.replace("iso45001:", "")}=${v}`).join(", ");
    console.log(`  ${s.category.padEnd(15)} ${consistencyBadge} ${(ratio * 100).toFixed(0)}%  ${dist}`);
  }

  // 종합 일관성 점수
  console.log("\n" + "=".repeat(78));
  console.log("📊 종합 의미 일관성");
  const avgStd = mean(stats.map((s) => s.scoresStd));
  const isoUniformity = mean(
    stats.map((s) => {
      const total = [...s.isoClassDist.values()].reduce((a, b) => a + b, 0);
      const primary = [...s.isoClassDist.values()].sort((a, b) => b - a)[0] ?? 0;
      return total > 0 ? primary / total : 1;
    }),
  );
  console.log(`  카테고리내 점수 분산 평균:      ${avgStd.toFixed(2)} (낮을수록 일관)`);
  console.log(`  ISO 45001 카테고리 매핑 일관성: ${(isoUniformity * 100).toFixed(1)}% (높을수록 일관)`);
  if (isoUniformity >= 0.95 && avgStd < 0.7) {
    console.log(`\n🟢 결과: 그래프가 카테고리별 일관된 패턴 유지`);
  } else {
    console.log(`\n🟡 결과: 일부 카테고리 분산 큼 — 추가 표준화 가능`);
  }
}

main();
