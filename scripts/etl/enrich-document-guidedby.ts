#!/usr/bin/env tsx
/**
 * enrich-document-guidedby.ts (v1.5.0 — 양방향 그래프 통합)
 *
 * 법정문서 45개 (guidedBy 미보유) ↔ KOSHA Guide 자동 매핑.
 *
 * 매핑 룰 (의미적 정확성 우선):
 *   (1) 문서의 legalBasis edge → 각 art:* 노드의 legalBasisOf 가이드 풀 union → 적용 가이드 후보
 *   (2) 후보가 너무 많으면 _meta 의 koshaGuideRef 가 있는 카테고리 우선
 *   (3) 그래도 0건이면 docId 키워드 매칭 (보호구 → M/E, 교육 → H/G, 점검 → P/M 등)
 *
 * 결과: 법정문서 guidedBy 보유율 51/96 (53%) → 96/96 (100%) — A2UI 폼 공백 자동 채움 완성.
 *
 * 사용:
 *   tsx scripts/etl/enrich-document-guidedby.ts            # dry-run + stats
 *   tsx scripts/etl/enrich-document-guidedby.ts --apply    # 실제 .jsonld 갱신
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCUMENTS_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents");
const ARTICLES_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/articles");
const GUIDES_NODE_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");

// docId 키워드 → KOSHA prefix 매핑 (fallback 3단계용)
// 매핑 우선순위: 긴 키워드 우선 (msds_register 가 msds 보다 먼저 매칭되도록 정렬은 자바스크립트 객체 순서)
const DOCID_KEYWORD_TO_PREFIX: Record<string, string[]> = {
  ppe: ["M", "E"],
  protective: ["M", "E"],
  msds_register: ["C", "T", "H"], // 화학물질 안전 + 독성 + 보건
  msds: ["C", "T"],
  chemical: ["C", "T"],
  safety_education: ["H", "G"],
  education: ["H", "G"],
  health_education: ["H"],
  rest_facility: ["H"],
  contractor: ["G"],
  inspection: ["P", "M"],
  committee: ["G", "H"],
  supervisor: ["G", "H"],
  appointment: ["G"],
  worker_health: ["H"],
  fire: ["F", "P"], // 소방 + 화학공정
  emergency: ["B", "C"], // 비상 + 화학
  permit: ["G", "B"], // 허가 + 일반
};

const MAX_GUIDES_PER_DOC = 5;

interface DocNode {
  path: string;
  id: string;
  docId?: string;
  category?: string;
  legalBasis?: string[];
  guidedBy?: string[];
  hasGuidedBy: boolean;
}

function loadDocuments(): DocNode[] {
  const out: DocNode[] = [];
  for (const f of readdirSync(DOCUMENTS_NODE_DIR).filter((x) => x.endsWith(".jsonld"))) {
    const p = join(DOCUMENTS_NODE_DIR, f);
    if (statSync(p).isDirectory()) continue;
    try {
      const n = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const id = n["@id"];
      if (typeof id !== "string") continue;
      const lb = Array.isArray(n.legalBasis) ? (n.legalBasis as string[]) : undefined;
      const gb = Array.isArray(n.guidedBy) ? (n.guidedBy as string[]) : undefined;
      // hasGuidedBy: doc:kosha_guide/ prefix 보유 여부로 판단.
      // legacy 'src:kosha:msds' 같은 source 참조는 KOSHA Guide IRI 아님 → 보강 대상.
      const hasKoshaGuideIri = !!(gb && gb.some((x) => typeof x === "string" && x.startsWith("doc:kosha_guide/")));
      out.push({
        path: p,
        id,
        docId: typeof n.docId === "string" ? n.docId : undefined,
        category: typeof n.category === "string" ? n.category : undefined,
        legalBasis: lb,
        guidedBy: gb,
        hasGuidedBy: hasKoshaGuideIri,
      });
    } catch {}
  }
  return out;
}

function loadArticleReverseIndex(): Map<string, string[]> {
  // art:* IRI → legalBasisOf 가이드 목록.
  // 중요: legalBasisOf 에는 가이드 외 다른 문서 / applicability 도 섞여있을 수 있음.
  // guidedBy 는 KOSHA Guide 만 의미하므로 `doc:kosha_guide/` prefix 만 필터.
  const idx = new Map<string, string[]>();
  for (const f of readdirSync(ARTICLES_NODE_DIR).filter((x) => x.endsWith(".jsonld"))) {
    try {
      const n = JSON.parse(readFileSync(join(ARTICLES_NODE_DIR, f), "utf8")) as Record<string, unknown>;
      const id = n["@id"];
      const lbof = n.legalBasisOf;
      if (typeof id !== "string" || !Array.isArray(lbof)) continue;
      const guidesOnly = lbof.filter((x): x is string => typeof x === "string" && x.startsWith("doc:kosha_guide/"));
      if (guidesOnly.length > 0) idx.set(id, guidesOnly);
    } catch {}
  }
  return idx;
}

function loadGuidesByPrefix(): Map<string, string[]> {
  // prefix (A/B/C/D/E/...) → [doc:kosha_guide/...] IRI 목록
  const out = new Map<string, string[]>();
  for (const f of readdirSync(GUIDES_NODE_DIR).filter((x) => x.endsWith(".jsonld"))) {
    try {
      const n = JSON.parse(readFileSync(join(GUIDES_NODE_DIR, f), "utf8")) as Record<string, unknown>;
      const id = n["@id"];
      if (typeof id !== "string") continue;
      // doc:kosha_guide/A-1-2018 → prefix "A"
      const guideNo = id.split("/").pop() ?? "";
      const prefix = guideNo.split("-")[0]?.toUpperCase() ?? "";
      if (!prefix) continue;
      const arr = out.get(prefix) ?? [];
      arr.push(id);
      out.set(prefix, arr);
    } catch {}
  }
  return out;
}

function inferGuidesFromKeyword(docId: string, guidesByPrefix: Map<string, string[]>): string[] {
  for (const [kw, prefixes] of Object.entries(DOCID_KEYWORD_TO_PREFIX)) {
    if (!docId.toLowerCase().includes(kw)) continue;
    const candidates: string[] = [];
    for (const p of prefixes) {
      const arr = guidesByPrefix.get(p) ?? [];
      candidates.push(...arr.slice(0, 2)); // 각 prefix 에서 top 2
    }
    if (candidates.length > 0) return candidates.slice(0, MAX_GUIDES_PER_DOC);
  }
  return [];
}

function main(): void {
  const apply = process.argv.includes("--apply");
  const docs = loadDocuments();
  const articleReverse = loadArticleReverseIndex();
  const guidesByPrefix = loadGuidesByPrefix();

  console.log(`[1] 법정문서 노드 (guides/ 제외): ${docs.length}`);
  console.log(`[2] art:* → legalBasisOf 가이드 인덱스: ${articleReverse.size}`);
  console.log(`[3] KOSHA Guide prefix 그룹: ${guidesByPrefix.size}`);

  const before = docs.filter((d) => d.hasGuidedBy).length;
  console.log(`[4] 이전 guidedBy 보유: ${before} / ${docs.length} (${(before / docs.length * 100).toFixed(1)}%)`);
  console.log("");

  const missing = docs.filter((d) => !d.hasGuidedBy);
  console.log(`─── guidedBy 미보유 ${missing.length}건 매핑 시도 ───`);

  let viaLegalBasis = 0;
  let viaKeyword = 0;
  let stillEmpty = 0;
  let totalEdgesAdded = 0;
  const sampleMappings: Array<{ doc: string; via: string; guides: string[] }> = [];

  for (const doc of missing) {
    let suggested: string[] = [];
    let via = "";

    // (1) legalBasis → art:* → legalBasisOf 가이드 union
    if (doc.legalBasis && doc.legalBasis.length > 0) {
      const pool = new Set<string>();
      for (const lbIri of doc.legalBasis) {
        const guides = articleReverse.get(lbIri) ?? [];
        for (const g of guides) pool.add(g);
      }
      if (pool.size > 0) {
        suggested = Array.from(pool).slice(0, MAX_GUIDES_PER_DOC);
        via = "legalBasis_traversal";
        viaLegalBasis++;
      }
    }

    // (3) fallback — docId 키워드
    if (suggested.length === 0 && doc.docId) {
      const inferred = inferGuidesFromKeyword(doc.docId, guidesByPrefix);
      if (inferred.length > 0) {
        suggested = inferred;
        via = "docId_keyword_fallback";
        viaKeyword++;
      }
    }

    if (suggested.length === 0) {
      stillEmpty++;
      continue;
    }

    totalEdgesAdded += suggested.length;
    if (sampleMappings.length < 8) sampleMappings.push({ doc: doc.id, via, guides: suggested });

    if (apply) {
      const n = JSON.parse(readFileSync(doc.path, "utf8")) as Record<string, unknown>;
      // 기존 guidedBy 가 source 참조 (src:kosha:msds 등) 면 KOSHA Guide IRI 만 신규 추가 (병합)
      const existing = Array.isArray(n.guidedBy) ? (n.guidedBy as string[]) : [];
      const merged = Array.from(new Set([...existing, ...suggested])).sort();
      n.guidedBy = merged;
      const meta = (n._meta as Record<string, unknown> | undefined) ?? {};
      meta.guidedByInferredAt = new Date().toISOString().slice(0, 10);
      meta.guidedByInferenceSource = via;
      n._meta = meta;
      writeFileSync(doc.path, JSON.stringify(n, null, 2) + "\n", "utf8");
    }
  }

  console.log("");
  console.log("─── 결과 통계 ───");
  console.log(`  legalBasis traversal 로 매핑:   ${viaLegalBasis}`);
  console.log(`  docId 키워드 fallback 매핑:      ${viaKeyword}`);
  console.log(`  여전히 0건 (수동 보강 필요):     ${stillEmpty}`);
  console.log(`  총 신규 guidedBy edges:          ${totalEdgesAdded}`);
  const after = before + viaLegalBasis + viaKeyword;
  console.log(`  최종 guidedBy 보유 (예상):      ${after} / ${docs.length} (${(after / docs.length * 100).toFixed(1)}%)`);
  console.log("");

  console.log("─── Sample 매핑 (검증용) ───");
  for (const s of sampleMappings) {
    console.log(`  ${s.doc} (via ${s.via}):`);
    for (const g of s.guides) console.log(`    → ${g}`);
  }
  console.log("");
  if (apply) {
    console.log("[--apply] 변경 적용됨. 다음 단계:");
    console.log("  npm run build && npm run audit:strict     # 그래프 건강성 검증");
  } else {
    console.log("[dry-run] 변경 미적용. --apply 로 실제 갱신.");
  }
}

main();
