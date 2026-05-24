#!/usr/bin/env tsx
/**
 * enrich-guide-legal-edges.ts (v1.5.0 — 양방향 그래프 통합)
 *
 * 1,039 KOSHA Guide .md 본문 전체에서 법령 인용 자동 추출 → 각 가이드 .jsonld 노드의
 * `legalBasis` edge 필드에 art:* IRI 배열로 박제. audit-graph-health.ts 의 EDGE_PROPS
 * 표준 채택 — 박제된 edge 는 graph traversal 로 즉시 활용 가능.
 *
 * 핵심:
 *   - 기존 extract-kosha-guide-citations.ts 는 "관련법규" 섹션만 + 비표준 relatedLaw 필드.
 *     본 스크립트는 본문 전체 + EDGE_PROPS 표준 legalBasis 필드 → graph traversal 활용도 ↑↑.
 *   - dangling IRI (art:* 노드 풀에 없는 가지 조문 28건) skip — audit:strict 회귀 차단.
 *   - 기존 legalBasis 값과 병합 (중복 제거).
 *
 * 사용:
 *   tsx scripts/etl/enrich-guide-legal-edges.ts            # dry-run + stats
 *   tsx scripts/etl/enrich-guide-legal-edges.ts --apply    # 실제 .jsonld 갱신
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_MD_DIR = resolve(ROOT, "src/ontology/kosha-guides");
const GUIDES_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
const ARTICLES_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/articles");

// ─── 정규식 매핑 (긴 패턴 우선, 가지 조문 "X조의Y" 포함) ───
// art:* 노드 IRI 형식: art:{법령축약}:{조번호}[의{가지}]
type PatternRule = { pat: RegExp; tpl: string };
const PATTERNS: PatternRule[] = [
  // 정식 명칭 (긴 것 우선 매칭 — 짧은 패턴이 긴 것 잘라먹지 않도록)
  { pat: /산업안전보건기준에\s*관한\s*규칙\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/g, tpl: "art:기준규칙:{}" },
  { pat: /산업안전보건법\s*시행규칙\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/g, tpl: "art:산안법시행규칙:{}" },
  { pat: /산업안전보건법\s*시행령\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/g, tpl: "art:산안법시행령:{}" },
  { pat: /산업안전보건법\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/g, tpl: "art:산안법:{}" },
  { pat: /중대재해\s*처벌\s*등에?\s*관한\s*법률\s*시행령\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/g, tpl: "art:중처법시행령:{}" },
  { pat: /중대재해\s*처벌\s*등에?\s*관한\s*법률\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/g, tpl: "art:중처법:{}" },
  { pat: /위험성평가에?\s*관한\s*고시\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/g, tpl: "art:위험성평가-고시:{}" },
  { pat: /건설기술\s*진흥법\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/g, tpl: "art:건진법:{}" },
  // 약칭 (negative lookbehind 로 단어 경계 보장 — "기준규칙" 같은 명사가 다른 단어 안에 들어가지 않도록)
  { pat: /(?<![\p{L}\p{N}])기준규칙\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/gu, tpl: "art:기준규칙:{}" },
  { pat: /(?<![\p{L}\p{N}])산안법\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/gu, tpl: "art:산안법:{}" },
  { pat: /(?<![\p{L}\p{N}])중처법\s*제\s*(\d+)(?:\s*조의?\s*(\d+))?\s*조?/gu, tpl: "art:중처법:{}" },
];

interface ExtractStats {
  totalGuides: number;
  guidesWithCitations: number;
  guidesUpdated: number;
  uniqueIrisExtracted: Set<string>;
  totalEdgeAdditions: number;
  danglingSkipped: Set<string>;
  byLaw: Record<string, number>;
}

function extractIris(text: string): Set<string> {
  const found = new Set<string>();
  for (const { pat, tpl } of PATTERNS) {
    let m: RegExpExecArray | null;
    pat.lastIndex = 0;
    while ((m = pat.exec(text)) !== null) {
      const base = m[1];
      const sub = m[2] ?? "";
      const num = sub ? `${base}의${sub}` : base;
      found.add(tpl.replace("{}", num));
    }
  }
  return found;
}

function loadArticleIriPool(): Set<string> {
  const pool = new Set<string>();
  for (const f of readdirSync(ARTICLES_NODE_DIR).filter((x) => x.endsWith(".jsonld"))) {
    try {
      const n = JSON.parse(readFileSync(join(ARTICLES_NODE_DIR, f), "utf8")) as Record<string, unknown>;
      const id = n["@id"];
      if (typeof id === "string") pool.add(id);
    } catch {}
  }
  return pool;
}

function main(): void {
  const apply = process.argv.includes("--apply");
  const articleIris = loadArticleIriPool();
  console.log(`[1] art:* 노드 풀 로드: ${articleIris.size}건`);

  const guideMds = readdirSync(GUIDES_MD_DIR).filter((f) => f.endsWith(".md"));
  console.log(`[2] KOSHA Guide .md: ${guideMds.length}건 처리`);

  const stats: ExtractStats = {
    totalGuides: guideMds.length,
    guidesWithCitations: 0,
    guidesUpdated: 0,
    uniqueIrisExtracted: new Set(),
    totalEdgeAdditions: 0,
    danglingSkipped: new Set(),
    byLaw: {},
  };

  for (const md of guideMds) {
    const guideId = md.replace(/\.md$/, "");
    const text = readFileSync(join(GUIDES_MD_DIR, md), "utf8");
    const extracted = extractIris(text);
    if (extracted.size === 0) continue;
    stats.guidesWithCitations++;

    // dangling 필터
    const validIris: string[] = [];
    for (const iri of extracted) {
      stats.uniqueIrisExtracted.add(iri);
      if (articleIris.has(iri)) {
        validIris.push(iri);
        const lawCat = iri.split(":")[1];
        stats.byLaw[lawCat] = (stats.byLaw[lawCat] ?? 0) + 1;
      } else {
        stats.danglingSkipped.add(iri);
      }
    }
    if (validIris.length === 0) continue;

    // 가이드 노드 갱신
    const guideNodePath =
      [join(GUIDES_NODE_DIR, `${guideId.toLowerCase()}.jsonld`), join(GUIDES_NODE_DIR, `${guideId}.jsonld`)]
        .find((p) => existsSync(p));
    if (!guideNodePath) continue;

    const node = JSON.parse(readFileSync(guideNodePath, "utf8")) as Record<string, unknown>;
    const existing = Array.isArray(node.legalBasis) ? (node.legalBasis as string[]) : [];
    const merged = Array.from(new Set([...existing, ...validIris])).sort();
    const additions = merged.length - existing.length;
    if (additions === 0) continue;

    stats.totalEdgeAdditions += additions;
    stats.guidesUpdated++;

    if (apply) {
      node.legalBasis = merged;
      // _meta 에 추출 출처 기록 (감사 추적용)
      const meta = (node._meta as Record<string, unknown> | undefined) ?? {};
      meta.legalBasisExtractedFrom = "guide_body_citation_auto_extract";
      meta.legalBasisExtractedAt = new Date().toISOString().slice(0, 10);
      node._meta = meta;
      writeFileSync(guideNodePath, JSON.stringify(node, null, 2) + "\n", "utf8");
    }
  }

  console.log("");
  console.log("─── 결과 통계 ───");
  console.log(`  법령 인용 보유 가이드 (any):  ${stats.guidesWithCitations} / ${stats.totalGuides} (${(stats.guidesWithCitations / stats.totalGuides * 100).toFixed(1)}%)`);
  console.log(`  edge 갱신 대상 가이드:         ${stats.guidesUpdated}`);
  console.log(`  추출된 unique IRI:             ${stats.uniqueIrisExtracted.size}`);
  console.log(`  art:* 풀 매칭:                ${stats.uniqueIrisExtracted.size - stats.danglingSkipped.size}`);
  console.log(`  dangling skip:                ${stats.danglingSkipped.size} (가지 조문 art:* 미등록)`);
  console.log(`  총 신규 legalBasis edge:       ${stats.totalEdgeAdditions}`);
  console.log("");
  console.log("─── 법령별 분포 ───");
  for (const [law, n] of Object.entries(stats.byLaw).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${law.padEnd(20)} ${n}건`);
  }
  console.log("");
  if (apply) {
    console.log("[--apply] 변경 적용됨. 다음 단계:");
    console.log("  npm run build                              # INVENTORY 자동 갱신");
    console.log("  npm run verify-graph                       # IRI 형식 / dangling 회귀 검증");
    console.log("  npm run audit:strict                       # 그래프 건강성 검증");
  } else {
    console.log("[dry-run] 변경 미적용. --apply 로 실제 갱신.");
  }
}

main();
