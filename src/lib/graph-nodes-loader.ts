// ─────────────────────────────────────────────────────────────────────────────
// graph-nodes-loader.ts
//
// JSON-LD 그래프 노드 로더. Document 중심 P0 구현.
// build/ontology/graph/nodes/ 에 복사된 .jsonld 를 읽어 메모리에 캐시.
// 외부 시맨틱 라이브러리(jsonld·graphology) 미사용 — Phase 1 P0 단일 도구
// plain JSON 로딩 + graphology Graph 인스턴스 (`buildGraph()`) 병용.
// neighborsByEdge · bfsByEdge 가 graphology API 를 직접 호출한다.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Graph from "graphology";
import { mapWithConcurrency } from "./concurrency.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES_DIR = resolve(ROOT, "build", "ontology", "graph", "nodes");
const NODES_DIR_DEV = resolve(ROOT, "src", "ontology", "graph", "nodes");

// 노드 타입 (P0 부분, Phase 2에서 확장)
// Document.sections — generic generate renderer 양식 정의 (P-PAPER-2a v0.7)
export interface DocumentSectionField {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  // 작성 가이드 (LLM 빈칸 보조) — gap2-fill-input-guides 가 채움
  inputGuide?: string;
  standardFormat?: string;
  examples?: string[];
  checkPoints?: string[];
}

export interface DocumentSection {
  title: string;
  legalSource?: string;
  fields: DocumentSectionField[];
  notes?: string[];
}

export interface DocumentNode {
  "@id": string;
  "@type": "Document";
  docId: string;
  title: string;
  alternativeNames?: string[];
  description?: string;
  cycle: string;
  trigger?: string;
  applicableWhen?: Record<string, unknown>;
  exemptedWhen?: Record<string, unknown>;
  requiredFields: Array<{ key: string; label: string; source: string }>;
  reviewRules: Array<{
    rule: string;
    severity: "blocker" | "warning" | "info" | "manual_review";
    checkFields?: string[];
    legalBasis?: string;
  }>;
  // generic generate renderer 가 사용하는 양식 정의 (P-PAPER-2a)
  sections?: DocumentSection[];
  penaltyOnMissing?: string | string[]; // 단순 미작성 vs 사망 결과 분리 가능
  retention?: string;
  standardForm?: Record<string, unknown>;
  guidedBy?: string[];
  legalBasis?: string[];
  verificationStatus?: string;
  _meta?: Record<string, unknown>;
}

export interface ArticleNode {
  "@id": string;
  "@type": "Article";
  articleNumber: string;
  title: string;
  partOf: string;
  verificationStatus?: string;
  description?: string;
  hasAnnex?: string[];
  regulates?: string[];
  appliesTo?: string[];
  penalizedBy?: string | string[]; // 단일 또는 다중 (단순 위반 + 사망 결과 등 분리 케이스)
  legalBasisOf?: string[];
  _meta?: Record<string, unknown>;
}

export interface AnnexNode {
  "@id": string;
  "@type": "Annex";
  annexNumber: string;
  title: string;
  partOf: string;
  description?: string;
  specifies?: string[];
  verificationStatus?: string;
  _meta?: Record<string, unknown> & {
    preSurveyItems?: string[];
    workPlanItems?: string[];
  };
}

export interface PenaltyNode {
  "@id": string;
  "@type": "Penalty";
  title?: string;
  partOf: string;
  penaltyType: string;
  amount?: number;
  amountUnit?: string;
  condition?: string;
  _meta?: Record<string, unknown>;
}

export type AnyNode = DocumentNode | ArticleNode | AnnexNode | PenaltyNode;

// 모든 그래프 노드가 가질 수 있는 cross-cutting 필드 (Phase A-2 facet, 그래프 신규 edge)
export type NodeWithFacets = AnyNode & {
  koshaArchiveFacets?: string[];
  mitigatedBy?: string[];
};

// @type 이 string 또는 [string, ...] (multi-type) 모두 매칭.
// 도구가 multi-type 노드(예: Penalty + Legislation)를 직접 `=== "Penalty"` 로 비교해
// silently 누락하는 회귀를 막기 위해 외부에도 노출한다.
export function hasType(node: { "@type"?: unknown }, typeName: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t === typeName;
  if (Array.isArray(t)) return t.includes(typeName);
  return false;
}

// 노드 인덱스: @id → node
let nodeIndex: Map<string, AnyNode> | null = null;
// graphology DirectedGraph 인스턴스 (BFS·DFS·multi-hop 쿼리)
let graphInstance: Graph | null = null;

// 노드 → 엣지 추출 규칙 (필드명 → 엣지 라벨)
// 등록 기준: IRI 또는 IRI 배열 형태의 필드만. literal/object 필드(retention=string,
// standardForm=object, approvalChain=object[], submitTo=field key)는 edge 가 아니므로 제외.
const EDGE_FIELDS: Record<string, string> = {
  delegates: "delegates",
  references: "references",
  hasArticle: "hasArticle",
  partOf: "partOf",
  hasAnnex: "hasAnnex",
  specifies: "specifies",
  regulates: "regulates",
  penalizedBy: "penalizedBy",
  penaltyOnMissing: "penalizedBy",
  appliesTo: "appliesTo",
  requires: "requires",
  mitigatedBy: "mitigatedBy",
  causedBy: "causedBy",
  evaluatedBy: "evaluatedBy",
  cycledAs: "cycledAs",
  legalBasisOf: "legalBasisOf",
  legalBasis: "legalBasis",
  guidedBy: "guidedBy",
  amendedTo: "amendedTo",
  interpretedBy: "interpretedBy",
  auditedBy: "auditedBy",
  informedBy: "informedBy",
  cited_in: "cited_in",
  // ─── v0.6 정규화 (교차 검증 2026-04-30) ───
  // assemble-doc-context.ts / generate-safety-document.ts 가 직접 attribute 로 읽던
  // IRI 배열 5종을 graph edge 로 승격. graphology BFS·multi-hop 쿼리에서 통합 traversal 가능.
  hasHazard: "hasHazard", // Document/Activity → Hazard (246 노드 사용)
  relatedDocs: "relatedDocs", // Document → Document (92 노드 사용)
  annexReference: "annexReference", // Activity/Document → Annex (24 노드, 단일 IRI 도 Array.isArray 처리됨)
  appliesToActivities: "appliesToActivities", // facet/applicability → Activity (589 노드 사용)
  involves: "involves", // Statistic → Event (23 노드 사용)
  // ─── P0-3 보강 ───
  // context.jsonld @type:@id term 64개 중 EDGE_FIELDS 미등록이던 11개 추가.
  // graphology BFS·neighborsByEdge() 가 도구별 결과 불일치 (direct lookup vs graph traversal) 해소.
  regulatedBy: "regulatedBy", // Article → Document/Activity (77 노드)
  supportedByGuide: "supportedByGuide", // Hazard/Control → KOSHA Guide (38 노드)
  appliesToActivity: "appliesToActivity", // Document/Method → Activity 단수형 (74 노드)
  hasTask: "hasTask", // Activity → Task (73 노드)
  hasWorkType: "hasWorkType", // Document/Activity → WorkType (98 노드)
  isPartOf: "isPartOf", // partOf 의 역방향 (24 노드)
  relatedArticles: "relatedArticles", // Document → Article (19 노드)
  relatedKoshaGuide: "relatedKoshaGuide", // Article/Document → KOSHA Guide (911 노드, 최다)
  maps_to_action: "maps_to_action", // Operational ActionType (69 노드)
  producesEntity: "producesEntity", // Activity → Entity (69 노드)
  delegationOf: "delegationOf", // delegates 의 역방향 (296 노드)
  // ─── 외부 평가 P0-2 — verify-edge-context-drift 정합 ───
  hasChapter: "hasChapter", // Act → Chapter (6 노드 사용)
  // ─── v1.3.x (2026-05-20) — 결정론 룰 레이어 (외부 평가 gap #3) ───
  // Applicability 조건 충족 시 강제되는 control IRIs. graph BFS 에서 "이 룰이 활성되면 어떤 통제가 필요한가" 추적.
  enforces: "enforces", // Applicability → Control (15 Applicability 노드 사용)
};

async function discoverNodesDir(): Promise<string> {
  for (const dir of [NODES_DIR, NODES_DIR_DEV]) {
    try {
      await readdir(dir);
      return dir;
    } catch {
      // 다음 후보
    }
  }
  throw new Error(
    `[graph-nodes-loader] nodes 디렉토리를 찾을 수 없습니다 (build/dev 둘 다 부재): ${NODES_DIR} | ${NODES_DIR_DEV}`,
  );
}

export async function collectJsonldPaths(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectJsonldPaths(full)));
    else if (entry.name.endsWith(".jsonld")) out.push(full);
  }
  return out;
}

async function loadAllJsonLdRecursive(dir: string): Promise<AnyNode[]> {
  const paths = await collectJsonldPaths(dir);
  return mapWithConcurrency(paths, 32, async (full) => {
    const raw = await readFile(full, "utf8");
    return JSON.parse(raw) as AnyNode;
  });
}

async function buildIndex(): Promise<Map<string, AnyNode>> {
  if (nodeIndex) return nodeIndex;
  const dir = await discoverNodesDir();
  const all = await loadAllJsonLdRecursive(dir);
  // duplicate @id 검출 — Phase 1 P1 교차 검증 권고 반영
  const seen = new Map<string, AnyNode>();
  for (const node of all) {
    if (!node["@id"]) {
      console.warn(`[graph-nodes-loader] @id 없는 노드 발견 (skip):`, JSON.stringify(node).slice(0, 100));
      continue;
    }
    if (!node["@type"]) {
      console.warn(`[graph-nodes-loader] @type 없는 노드 발견 (skip): ${node["@id"]}`);
      continue;
    }
    if (seen.has(node["@id"])) {
      console.warn(`[graph-nodes-loader] duplicate @id (later wins): ${node["@id"]}`);
    }
    seen.set(node["@id"], node);
  }
  nodeIndex = seen;
  return nodeIndex;
}

// graphology DirectedGraph 빌드 — 모든 엣지 자동 인덱싱
export async function buildGraph(): Promise<Graph> {
  if (graphInstance) return graphInstance;
  const idx = await buildIndex();
  const g = new Graph({ multi: true, type: "directed" });

  // 노드 등록
  for (const [id, node] of idx.entries()) {
    g.addNode(id, { type: node["@type"], data: node });
  }

  // 엣지 등록 — EDGE_FIELDS 의 필드를 가진 노드는 해당 IRI 들로 엣지 생성
  for (const [id, node] of idx.entries()) {
    for (const [field, label] of Object.entries(EDGE_FIELDS)) {
      const value = (node as unknown as Record<string, unknown>)[field];
      if (!value) continue;
      const targets = Array.isArray(value) ? value : [value];
      for (const target of targets) {
        if (typeof target !== "string") continue;
        if (!g.hasNode(target)) continue; // dangling IRI 는 skip (predictedLegalBasisIris 등)
        try {
          g.addEdgeWithKey(`${id}--${label}-->${target}`, id, target, { label });
        } catch {
          // 중복 엣지 무시 (multi=true 인데 같은 key 충돌)
        }
      }
    }
  }

  graphInstance = g;
  return g;
}

// BFS — start 에서 특정 엣지 라벨만 따라가며 N-hop 추적
export async function bfsByEdge(
  startId: string,
  edgeLabel: string,
  maxDepth: number = 3,
): Promise<Array<{ id: string; depth: number; data: AnyNode }>> {
  const g = await buildGraph();
  if (!g.hasNode(startId)) return [];
  const visited = new Set<string>();
  const result: Array<{ id: string; depth: number; data: AnyNode }> = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur.id) || cur.depth > maxDepth) continue;
    visited.add(cur.id);
    const data = g.getNodeAttribute(cur.id, "data") as AnyNode;
    result.push({ id: cur.id, depth: cur.depth, data });
    g.forEachOutEdge(cur.id, (_edge, attr, _src, dst) => {
      if (attr.label === edgeLabel && !visited.has(dst)) {
        queue.push({ id: dst, depth: cur.depth + 1 });
      }
    });
  }
  return result;
}

// graphology 기반 양방향 매핑 (모든 query 도구 공통)
// edgeLabel 로 outgoing 엣지 traversal — Map 직접 lookup 보다 일관된 인터페이스
export async function neighborsByEdge(
  startId: string,
  edgeLabel: string,
  direction: "out" | "in" = "out",
): Promise<string[]> {
  const g = await buildGraph();
  if (!g.hasNode(startId)) return [];
  const result: string[] = [];
  const iterator = direction === "out" ? g.forEachOutEdge.bind(g) : g.forEachInEdge.bind(g);
  iterator(startId, (_edge, attr, src, dst) => {
    if (attr.label === edgeLabel) {
      result.push(direction === "out" ? dst : src);
    }
  });
  return result;
}

// 캐시 무효화 — 단위 테스트, 핫 리로드 시 사용. 일반 런타임 미호출.
// 사용 예시:
//   import { invalidateGraphCache, buildGraph } from "../lib/graph-nodes-loader.js";
//   invalidateGraphCache();   // 디스크 변경 후 강제 재빌드
//   await buildGraph();
export function invalidateGraphCache(): void {
  nodeIndex = null;
  graphInstance = null;
}

// reverse lookup — Document.legalBasis 또는 Article.legalBasisOf, Annex.specifies 양방향 대응
export async function findArticlesAndAnnexesForDocument(
  docId: string,
): Promise<Array<ArticleNode | AnnexNode>> {
  const idx = await buildIndex();
  const doc = await getDocument(docId);
  const out: Array<ArticleNode | AnnexNode> = [];
  if (!doc) return out;

  // 정방향: Document.legalBasis → Article/Annex
  const forwardIds = doc.legalBasis ?? [];
  for (const id of forwardIds) {
    const n = idx.get(id);
    if (n && (hasType(n, "Article") || hasType(n, "Annex"))) {
      out.push(n as ArticleNode | AnnexNode);
    }
  }

  // 역방향: Article.legalBasisOf includes docId, Annex.specifies includes docId
  for (const node of idx.values()) {
    if (hasType(node, "Article")) {
      const lbo = (node as ArticleNode).legalBasisOf ?? [];
      if (lbo.includes(doc["@id"]) && !out.find((x) => x["@id"] === node["@id"])) {
        out.push(node as ArticleNode);
      }
    } else if (hasType(node, "Annex")) {
      const sp = (node as AnnexNode & { specifies?: string[] }).specifies ?? [];
      if (sp.includes(doc["@id"]) && !out.find((x) => x["@id"] === node["@id"])) {
        out.push(node as AnnexNode);
      }
    }
  }

  return out;
}

export async function getNode(id: string): Promise<AnyNode | undefined> {
  const idx = await buildIndex();
  return idx.get(id);
}

// v1.3.0 GraphRepository 단일화 (외부 평가 P0-3) —
// build 완료 후 sync 조회 (도구 handler 내 map() 같은 sync 컨텍스트용)
// 사용 순서: handler 시작에 ensureGraphBuilt() 호출 → 이후 getNodeSync() 사용

/**
 * graph 가 build 됐는지 보장. 미build 시 buildIndex() + buildGraph() 호출.
 * 도구 handler 시작에서 await 1회 호출 후, sync getNodeSync · neighborsByEdge · bfsByEdge 안전 사용.
 *
 * 이전 버전은 buildIndex() 만 호출했지만 함수명 의미와 불일치 (graphology 그래프 미build).
 * neighborsByEdge / bfsByEdge 는 내부에서 buildGraph 를 lazy 호출하지만, 이름 부합을 위해
 * 본 함수가 한 번에 양쪽을 build 한다.
 */
export async function ensureGraphBuilt(): Promise<void> {
  await buildIndex();
  await buildGraph();
}

/**
 * sync 노드 조회. ensureGraphBuilt() 후 호출.
 * 미build 시 undefined 반환 (예외 던지지 않음 — 도구 fallback).
 */
export function getNodeSync(id: string): AnyNode | undefined {
  if (!nodeIndex) return undefined;
  return nodeIndex.get(id);
}

export async function getDocument(docId: string): Promise<DocumentNode | undefined> {
  const idx = await buildIndex();
  for (const node of idx.values()) {
    if (hasType(node, "Document") && (node as DocumentNode).docId === docId) {
      return node as DocumentNode;
    }
  }
  return undefined;
}

/**
 * sync Document 조회 — ensureGraphBuilt() 후 호출.
 * GraphRepository 단일화 (P0-3) — assemble-doc-context 등의 readdirSync 패턴 대체.
 */
export function getDocumentSync(docId: string): DocumentNode | undefined {
  if (!nodeIndex) return undefined;
  for (const node of nodeIndex.values()) {
    if (hasType(node, "Document") && (node as DocumentNode).docId === docId) {
      return node as DocumentNode;
    }
  }
  return undefined;
}

export async function listDocuments(): Promise<DocumentNode[]> {
  const idx = await buildIndex();
  const docs: DocumentNode[] = [];
  for (const node of idx.values()) {
    if (hasType(node, "Document")) docs.push(node as DocumentNode);
  }
  return docs;
}
