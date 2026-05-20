/**
 * graph-repository.ts — GraphRepository SSoT (외부 평가 P0-3)
 *
 * 평가자 진단 (2026-05-19): assemble-doc-context, get-measures-by-risk,
 * field-safety-briefing 등이 각자 graph loader / nodeCache / PREFIX_TO_DIR 보유.
 * 같은 docId·hazard·activity 에 대해 도구마다 결과가 달라질 수 있음.
 *
 * 해소: 모든 도구가 본 모듈의 GraphRepository 만 사용.
 * 내부 구현은 graph-nodes-loader.ts (graphology + JSON-LD).
 *
 * 사용 패턴 (도구 handler):
 *   import { graphRepository } from "../lib/graph-repository.js";
 *
 *   async function handler(args) {
 *     await graphRepository.ensureBuilt();
 *     const doc = graphRepository.getDocument(args.docId);  // sync
 *     const hazards = graphRepository.neighbors(doc["@id"], "hasHazard");
 *     ...
 *   }
 */
import {
  ensureGraphBuilt,
  getNode as getNodeAsync,
  getNodeSync,
  getDocument as getDocumentAsync,
  getDocumentSync,
  listDocuments,
  bfsByEdge,
  neighborsByEdge,
  invalidateGraphCache,
  hasType,
  findArticlesAndAnnexesForDocument,
  type AnyNode,
  type DocumentNode,
  type ArticleNode,
  type AnnexNode,
} from "./graph-nodes-loader.js";

export type {
  AnyNode,
  DocumentNode,
  ArticleNode,
  AnnexNode,
};

/**
 * GraphRepository SSoT — 모든 도구가 본 인터페이스만 사용.
 *
 * 외부 평가 P0-3: graph loader 다중 (assemble-doc-context, get-measures-by-risk,
 * field-safety-briefing 각자 자체 cache) 해소. 단일 SSoT.
 */
export const graphRepository = {
  /**
   * graph index build 보장. handler 시작에서 await 1회 호출.
   */
  async ensureBuilt(): Promise<void> {
    await ensureGraphBuilt();
  },

  /**
   * sync 노드 조회. ensureBuilt() 후 호출.
   */
  getNode: getNodeSync,

  /**
   * async 노드 조회 (자동 build).
   */
  getNodeAsync,

  /**
   * sync Document 조회. ensureBuilt() 후 호출.
   */
  getDocument: getDocumentSync,

  /**
   * async Document 조회 (자동 build).
   */
  getDocumentAsync,

  /**
   * 전체 Document 목록.
   */
  listDocuments,

  /**
   * graphology BFS — edgeLabel 만 따라가며 N-hop 추적.
   */
  bfsByEdge,

  /**
   * outgoing/incoming neighbors — edge label 매칭.
   */
  neighbors: neighborsByEdge,

  /**
   * Document → Article/Annex 양방향 reverse lookup.
   */
  findArticlesAndAnnexesForDocument,

  /**
   * 노드 type 확인.
   */
  hasType,

  /**
   * cache 무효화 (테스트·hot reload 용).
   */
  invalidate: invalidateGraphCache,
} as const;

export type GraphRepository = typeof graphRepository;
