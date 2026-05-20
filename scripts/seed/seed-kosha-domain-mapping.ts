#!/usr/bin/env tsx
/**
 * seed-kosha-domain-mapping.ts (P-G-2)
 *
 * KOSHA 1039 Guide → Hazard·Control·Activity 자동 매핑.
 *
 * 메커니즘:
 *   - Hazard 노드의 _meta.matchKeywords ↔ KOSHA techGdlnNm substring 매칭
 *   - Control 노드의 _meta.matchKeywords ↔ 동일
 *   - 결과: KOSHA Guide → causedBy(Hazard), mitigatedBy(Control) 엣지 자동 생성
 *
 * 환각 위험 통제:
 *   - matchKeywords는 Hazard·Control 노드 시드 시 ground truth (LLM X)
 *   - 매칭 알고리즘은 substring (LLM 추론 X)
 *   - 결과 통계 출력으로 sample audit 가능
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");
const HAZARDS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "hazards");
const CONTROLS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "controls");

interface NodeWithKeywords {
  iri: string;
  slug: string;
  label: string;
  matchKeywords: string[];
  excludeKeywords: string[];
}

async function loadKeywordNodes(dir: string): Promise<NodeWithKeywords[]> {
  const out: NodeWithKeywords[] = [];
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(dir, f), "utf8")) as Record<string, unknown> & {
      "@id"?: string;
      slug?: string;
      label?: string;
      _meta?: { matchKeywords?: string[]; excludeKeywords?: string[] };
    };
    const kws = node._meta?.matchKeywords ?? [];
    if (kws.length === 0) continue;
    out.push({
      iri: String(node["@id"]),
      slug: String(node.slug ?? ""),
      label: String(node.label ?? ""),
      matchKeywords: kws,
      excludeKeywords: node._meta?.excludeKeywords ?? [],
    });
  }
  return out;
}

interface KoshaGuide {
  filePath: string;
  iri: string;
  guideNo: string;
  title: string;
  raw: Record<string, unknown>;
}

async function loadGuides(): Promise<KoshaGuide[]> {
  const out: KoshaGuide[] = [];
  for (const f of await readdir(GUIDES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const filePath = resolve(GUIDES_DIR, f);
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown> & {
      "@id"?: string;
      title?: string;
      _meta?: { guideNo?: string };
    };
    out.push({
      filePath,
      iri: String(raw["@id"]),
      guideNo: String(raw._meta?.guideNo ?? ""),
      title: String(raw.title ?? ""),
      raw,
    });
  }
  return out;
}

function matchByKeyword(title: string, nodes: NodeWithKeywords[]): NodeWithKeywords[] {
  const matched: NodeWithKeywords[] = [];
  for (const n of nodes) {
    const positive = n.matchKeywords.some((kw) => title.includes(kw));
    if (!positive) continue;
    const negative = n.excludeKeywords.some((kw) => title.includes(kw));
    if (negative) continue;
    matched.push(n);
  }
  return matched;
}

(async () => {
  console.log(`# P-G-2 — KOSHA 1039 → Hazard·Control 자동 매핑\n`);

  const hazards = await loadKeywordNodes(HAZARDS_DIR);
  const controls = await loadKeywordNodes(CONTROLS_DIR);
  const guides = await loadGuides();

  console.log(`  Hazard nodes (matchKeywords 보유): ${hazards.length}`);
  console.log(`  Control nodes (matchKeywords 보유): ${controls.length}`);
  console.log(`  KOSHA Guides: ${guides.length}\n`);

  let totalCausedBy = 0;
  let totalMitigatedBy = 0;
  let guidesWithHazard = 0;
  let guidesWithControl = 0;
  let guidesUnmapped = 0;

  // Hazard·Control 별 매핑 수 집계
  const hazardCount = new Map<string, number>();
  const controlCount = new Map<string, number>();

  for (const g of guides) {
    const hMatches = matchByKeyword(g.title, hazards);
    const cMatches = matchByKeyword(g.title, controls);

    const causedByIris = hMatches.map((h) => h.iri);
    const mitigatedByIris = cMatches.map((c) => c.iri);

    g.raw.causedBy = causedByIris;
    g.raw.mitigatedBy = mitigatedByIris;

    await writeFile(g.filePath, JSON.stringify(g.raw, null, 2) + "\n", "utf8");

    totalCausedBy += causedByIris.length;
    totalMitigatedBy += mitigatedByIris.length;
    if (hMatches.length > 0) guidesWithHazard += 1;
    if (cMatches.length > 0) guidesWithControl += 1;
    if (hMatches.length === 0 && cMatches.length === 0) guidesUnmapped += 1;

    for (const h of hMatches) hazardCount.set(h.slug, (hazardCount.get(h.slug) ?? 0) + 1);
    for (const c of cMatches) controlCount.set(c.slug, (controlCount.get(c.slug) ?? 0) + 1);
  }

  console.log(`# 결과`);
  console.log(`  causedBy 엣지: ${totalCausedBy}`);
  console.log(`  mitigatedBy 엣지: ${totalMitigatedBy}`);
  console.log(`  Hazard 매핑된 Guide: ${guidesWithHazard} / ${guides.length} (${Math.round(guidesWithHazard/guides.length*100)}%)`);
  console.log(`  Control 매핑된 Guide: ${guidesWithControl} / ${guides.length} (${Math.round(guidesWithControl/guides.length*100)}%)`);
  console.log(`  미매핑 Guide: ${guidesUnmapped} / ${guides.length} (${Math.round(guidesUnmapped/guides.length*100)}%)`);

  console.log(`\n# Hazard 별 매핑 (top 10)`);
  for (const [slug, n] of [...hazardCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${slug.padEnd(30)} ${n}`);
  }
  console.log(`\n# Control 별 매핑 (top 10)`);
  for (const [slug, n] of [...controlCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${slug.padEnd(30)} ${n}`);
  }

  console.log(`\n✓ P-G-2 완료`);
})();
