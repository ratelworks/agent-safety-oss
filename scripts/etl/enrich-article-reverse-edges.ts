#!/usr/bin/env tsx
/**
 * enrich-article-reverse-edges.ts (v1.5.0 — 양방향 그래프 통합)
 *
 * 각 가이드 .jsonld 의 legalBasis (forward) 를 역방향 인덱싱하여 각 art:* 노드에
 * `legalBasisOf` edge 추가. "이 법령 조문은 어떤 문서/가이드의 법적 근거인가?" 자동 발견.
 *
 * 결과: 법령 조문 → 가이드 발견 0% → 매우 큰 비율로 확장. LLM 이 "기준규칙 §38 적용 시
 * 어떤 가이드 참고?" 같은 질의를 그래프 traversal 로 자동 답변 가능.
 *
 * 사용:
 *   tsx scripts/etl/enrich-article-reverse-edges.ts            # dry-run + stats
 *   tsx scripts/etl/enrich-article-reverse-edges.ts --apply    # 실제 .jsonld 갱신
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
const ARTICLES_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/articles");

function main(): void {
  const apply = process.argv.includes("--apply");

  // 1. art:* IRI → 파일 경로 매핑
  const articleByIri = new Map<string, string>();
  for (const f of readdirSync(ARTICLES_NODE_DIR).filter((x) => x.endsWith(".jsonld"))) {
    try {
      const p = join(ARTICLES_NODE_DIR, f);
      const n = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const id = n["@id"];
      if (typeof id === "string") articleByIri.set(id, p);
    } catch {}
  }
  console.log(`[1] art:* 노드 풀: ${articleByIri.size}`);

  // 2. 가이드 → 법령 forward edges 역방향 인덱싱
  const reverseIndex = new Map<string, string[]>(); // art:* → [doc:kosha_guide/...]
  const guideMds = readdirSync(GUIDES_NODE_DIR).filter((f) => f.endsWith(".jsonld"));
  for (const gf of guideMds) {
    try {
      const node = JSON.parse(readFileSync(join(GUIDES_NODE_DIR, gf), "utf8")) as Record<string, unknown>;
      const gid = node["@id"];
      const basis = node.legalBasis;
      if (typeof gid !== "string" || !Array.isArray(basis)) continue;
      for (const iri of basis) {
        if (typeof iri !== "string") continue;
        const arr = reverseIndex.get(iri) ?? [];
        arr.push(gid);
        reverseIndex.set(iri, arr);
      }
    } catch {}
  }
  console.log(`[2] 가이드 → 법령 forward edges 인덱싱: ${reverseIndex.size} art:* 가 가이드들로부터 참조됨`);

  // 3. 각 art:* 노드에 legalBasisOf edge 추가
  let articlesUpdated = 0;
  let totalEdgeAdditions = 0;
  for (const [iri, guides] of reverseIndex.entries()) {
    const path = articleByIri.get(iri);
    if (!path) continue;
    const node = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const existing = Array.isArray(node.legalBasisOf) ? (node.legalBasisOf as string[]) : [];
    const merged = Array.from(new Set([...existing, ...guides])).sort();
    const additions = merged.length - existing.length;
    if (additions === 0) continue;

    articlesUpdated++;
    totalEdgeAdditions += additions;

    if (apply) {
      node.legalBasisOf = merged;
      const meta = (node._meta as Record<string, unknown> | undefined) ?? {};
      meta.legalBasisOfReverseIndexedAt = new Date().toISOString().slice(0, 10);
      meta.legalBasisOfReverseIndexSource = "kosha_guide_legalBasis_reverse_index_v1";
      node._meta = meta;
      writeFileSync(path, JSON.stringify(node, null, 2) + "\n", "utf8");
    }
  }

  console.log("");
  console.log("─── 결과 통계 ───");
  console.log(`  가이드 forward edges 가진 art:* :  ${reverseIndex.size}`);
  console.log(`  편집 대상 art:* (신규 edge 있음):   ${articlesUpdated}`);
  console.log(`  총 신규 legalBasisOf edge:         ${totalEdgeAdditions}`);
  console.log("");

  // 4. 역방향 통합 후 art:* → 가이드 발견 가능 비율 (예상)
  console.log("─── 양방향 그래프 통합 효과 (예상) ───");
  const coverage = (reverseIndex.size / articleByIri.size) * 100;
  console.log(`  법령 조문 → 가이드 발견 가능:  ${reverseIndex.size} / ${articleByIri.size} = ${coverage.toFixed(1)}%`);
  console.log(`  (이전: 0%, 약 ${coverage.toFixed(0)}배 개선)`);
  console.log("");
  if (apply) {
    console.log("[--apply] 변경 적용됨. 다음 단계:");
    console.log("  npm run build                              # INVENTORY 자동 갱신");
    console.log("  npm run audit:strict                       # 그래프 건강성 검증");
  } else {
    console.log("[dry-run] 변경 미적용. --apply 로 실제 갱신.");
  }
}

main();
