/**
 * skeleton-context.ts
 *
 * MCP Resource 등록 — Walking Skeleton + 그래프 fact를 LLM에 노출.
 *
 * essence gate G5: MCP Resource + Tools 양쪽 등록.
 * 본질 (2) LLM 연결 — 그래프 fact를 표준 Resource URI로 직접 노출하여
 * Claude Desktop / Codex CLI / MCP Inspector 어느 하네스에서든 환각 0 인용.
 *
 * Resource URI 체계:
 *   safety://skeleton/tbox          — Walking Skeleton T-Box (6 OWL Class + 13 properties)
 *   safety://skeleton/instances     — Walking Skeleton A-Box (인스턴스 사슬)
 *   safety://operational/profile    — Semantic/Kinetic/Dynamic 운영 온톨로지 프로파일
 *   safety://graph/{category}       — 범주별 그래프 노드 일괄 (하위 폴더 재귀 로딩 지원)
 *     · activities  (41 작업 활동)
 *     · hazards     (38 위험요인 + specificity)
 *     · controls    (45 통제수단 + ericLevel)
 *     · articles    (1,306 법조문)
 *     · annexes     (227 별표)
 *     · documents   (1,135 문서·양식 — guides 1,039 하위 폴더 포함)
 *     · kosha_guides (KOSHA Guide 원천 메타 2 — Guide 본문 노드는 documents/guides)
 *     · facets      (118 — code/group/shp 하위 폴더 포함)
 *     · cycles · methods · events · entities · sources · 등
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 파일 위치 — build 모드 / dev 모드 모두 동작
const __dirname = dirname(fileURLToPath(import.meta.url));

// Resource 루트 경로 (build/resources/ → build/ontology/, src/resources/ → src/ontology/)
const ONTOLOGY_ROOT = resolve(__dirname, "..", "ontology");
const SKELETON_DIR = resolve(ONTOLOGY_ROOT, "skeleton");
const OPERATIONAL_DIR = resolve(ONTOLOGY_ROOT, "operational");
const GRAPH_NODES_DIR = resolve(ONTOLOGY_ROOT, "graph", "nodes");

const ALLOWED_CATEGORIES = new Set([
  "activities",
  "hazards",
  "controls",
  "articles",
  "annexes",
  "documents",
  "kosha_guides",
  "cycles",
  "methods",
  "events",
  "entities",
  "sources",
  "applicabilities",
  "interpretations",
  "patterns",
  "facets",
  "chapters",
  "manuals",
  "statistics",
  "equipment",
  "object_sets",
  "capabilities",
  "work_types",
]);

/**
 * 디렉토리 안의 .jsonld·.json 파일을 재귀로 읽어 단일 @graph 배열로 반환.
 *
 * P0-2 변경: documents/guides/ 1,039건, facets/code·group·shp 118건 등 하위 폴더 재귀 로딩
 * 하위 폴더 노드를 Resource export 에서 누락하던 문제 해결.
 * 이전: readdir 1단계만 → documents 96건만 노출 (실제 1,135)
 */
async function walkJsonldRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true, encoding: "utf8" })) as unknown as Array<{
      name: string;
      isDirectory: () => boolean;
    }>;
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) {
      const sub = await walkJsonldRecursive(full);
      out.push(...sub);
    } else if (e.name.endsWith(".jsonld") || e.name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

async function loadCategory(category: string): Promise<{ "@graph": unknown[]; count: number }> {
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new Error(
      `unknown category: ${category}. allowed: ${Array.from(ALLOWED_CATEGORIES).join(", ")}`,
    );
  }
  const dirPath = resolve(GRAPH_NODES_DIR, category);
  const paths = await walkJsonldRecursive(dirPath);
  const nodes = await Promise.all(
    paths.map(async (p) => {
      const text = await readFile(p, "utf-8");
      return JSON.parse(text) as unknown;
    }),
  );
  return { "@graph": nodes, count: nodes.length };
}

/**
 * MCP Resource 등록 — Walking Skeleton + 큰 그래프 fact를 표준 URI로 노출.
 */
export function registerSkeletonResources(server: McpServer): void {
  // 1) Walking Skeleton T-Box (정적)
  server.registerResource(
    "skeleton-tbox",
    "safety://skeleton/tbox",
    {
      title: "Walking Skeleton T-Box",
      description:
        "한국 건설안전 온톨로지 Walking Skeleton — 6 OWL Class (WorkActivity / Hazard / ControlMeasure / KoshaGuide / Article / Action) + 13 properties + Action Type Contract. BFO 2020 / IAO / PROV-O / Akoma Ntoso / ISO 45001 정렬. LLM 그래프 traversal 시작점.",
      mimeType: "application/ld+json",
    },
    async () => {
      const path = resolve(SKELETON_DIR, "skeleton.jsonld");
      const text = await readFile(path, "utf-8");
      return {
        contents: [
          {
            uri: "safety://skeleton/tbox",
            mimeType: "application/ld+json",
            text,
          },
        ],
      };
    },
  );

  // 2) Walking Skeleton A-Box — 인스턴스 사슬 (정적)
  server.registerResource(
    "skeleton-instances",
    "safety://skeleton/instances",
    {
      title: "Walking Skeleton A-Box (인스턴스 사슬)",
      description:
        "인스턴스 사슬 — Activity → Hazard → Control → Article → KOSHA Guide. 굴착 2m+ 사슬 등 첫 14 인스턴스. 모든 인스턴스에 PROV-O 5필드 (wasGeneratedBy / generatedAtTime / wasDerivedFrom / hadPrimarySource / contentHash) — 환각 0 인용 보장.",
      mimeType: "application/ld+json",
    },
    async () => {
      const path = resolve(SKELETON_DIR, "instances.jsonld");
      const text = await readFile(path, "utf-8");
      return {
        contents: [
          {
            uri: "safety://skeleton/instances",
            mimeType: "application/ld+json",
            text,
          },
        ],
      };
    },
  );

  // 3) 범주별 그래프 노드 (동적 Resource Template)
  server.registerResource(
    "graph-category",
    new ResourceTemplate("safety://graph/{category}", {
      list: async () => ({
        resources: Array.from(ALLOWED_CATEGORIES).map((category) => ({
          uri: `safety://graph/${category}`,
          name: `graph-${category}`,
          mimeType: "application/ld+json",
          description: `범주 '${category}' 의 그래프 노드 일괄`,
        })),
      }),
    }),
    {
      title: "Safety Graph Category",
      description:
        "범주별 그래프 노드 일괄 — activities (41) / hazards (38, specificity 분류) / controls (45, ericLevel) / articles (1,298) / annexes (227) / documents (1,135) / kosha_guides 등. LLM이 도메인 사슬을 traversal로 따라가는 entry point.",
      mimeType: "application/ld+json",
    },
    async (uri, variables) => {
      const category = String(variables.category);
      const { "@graph": nodes, count } = await loadCategory(category);
      const wrapped = {
        "@context": `safety://graph/context`,
        "@id": uri.toString(),
        "@type": "safety:GraphCategory",
        category,
        count,
        "@graph": nodes,
      };
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/ld+json",
            text: JSON.stringify(wrapped, null, 2),
          },
        ],
      };
    },
  );

  // 4) 그래프 @context (정적, 큰 그래프 prefix 매핑)
  server.registerResource(
    "graph-context",
    "safety://graph/context",
    {
      title: "Graph @context (JSON-LD)",
      description:
        "큰 그래프의 JSON-LD @context — prefix 매핑 (safety: → ontology/v1/, schema: → schema.org/, prov: 등) + Activity → safety:WorkActivity 같은 클래스 alias. 모든 graph-category Resource 의 해석 키.",
      mimeType: "application/ld+json",
    },
    async () => {
      const path = resolve(ONTOLOGY_ROOT, "graph", "context.jsonld");
      const text = await readFile(path, "utf-8");
      return {
        contents: [
          {
            uri: "safety://graph/context",
            mimeType: "application/ld+json",
            text,
          },
        ],
      };
    },
  );

  // 5) 운영 온톨로지 프로파일 — Semantic/Kinetic/Dynamic 레이어 계약
  server.registerResource(
    "operational-profile",
    "safety://operational/profile",
    {
      title: "Operational Ontology Profile",
      description:
        "중소 건설사용 경량 운영 온톨로지 프로파일 — Semantic(ObjectType/LinkType), Kinetic(ActionType/MCP tool), Dynamic(LLM harness guardrail) 레이어 계약. 특정 하네스나 모델에 종속되지 않고 MCP Resource 로 노출한다.",
      mimeType: "application/ld+json",
    },
    async () => {
      const path = resolve(OPERATIONAL_DIR, "profile.jsonld");
      const text = await readFile(path, "utf-8");
      return {
        contents: [
          {
            uri: "safety://operational/profile",
            mimeType: "application/ld+json",
            text,
          },
        ],
      };
    },
  );
}
