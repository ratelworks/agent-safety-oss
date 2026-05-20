// SPDX-License-Identifier: MIT
// 출처: 이 도구는 저장소 내 JSON-LD 그래프 사실만 사용한다.
import { z } from "zod";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 파일 최상단 상수 - 그래프 노드 위치와 ERIC 분류 라벨
const NODE_DIR_RELATIVE_CANDIDATES = [
  "../ontology/graph/nodes",
  "../../src/ontology/graph/nodes",
] as const;

const ERIC_LEVEL_LABELS: Record<number, string> = {
  1: "제거",
  2: "대체",
  3: "공학적 통제",
  4: "관리적 통제",
  5: "개인보호구",
};

const MATCH_SCORE = {
  EXACT_ID: 100,
  EXACT_LABEL: 90,
  EXACT_KEYWORD: 84,
  LABEL_CONTAINS: 70,
  KEYWORD_CONTAINS: 64,
  SLUG_CONTAINS: 54,
} as const;

const MAX_MARKDOWN_MEASURES = 12;
const MAX_MARKDOWN_SOURCES = 6;

// 매일 사이클 흐름: Hazard → Control 조회 후 → PPE 매핑 / KOSHA Guide 검색 / 문서 검수.
const SUGGESTED_NEXT_TOOLS = [
  "get_ppe_by_task",
  "get_kosha_guide_md",
  "review_safety_document",
] as const;

export interface GraphNode extends Record<string, unknown> {
  "@id"?: string;
  "@type"?: string | string[];
  label?: string;
  title?: string;
  description?: string;
}

export interface GraphRef {
  iri: string;
  label: string;
}

export interface GraphMatch {
  node: GraphNode;
  iri: string;
  label: string;
  score: number;
  matchedBy: string;
}

export interface SourceLink {
  iri: string;
  label: string;
  sourceType: "kosha_guide" | "law_article" | "graph_node";
  sourceUrl?: string;
  guideNo?: string;
  articleNumber?: string;
  legislationIdentifier?: string;
  legalWeight: "mandatory" | "recommended" | "reference";
}

export interface ControlMeasure {
  iri: string;
  label: string;
  description?: string;
  ericLevel?: number;
  ericLevelLabel: string;
  category?: string;
  controlSpecificity?: string;
  appliesToActivity: string[];
  chain: {
    fromHazard: GraphRef;
    relation: "mitigatedBy";
    toControl: GraphRef;
  };
  sourceRefs: string[];
}

const inputSchema = z
  .object({
    hazardId: z
      .string()
      .optional()
      .describe("위험요인 IRI (예: hazard:fall_from_height)"),
    hazardLabel: z
      .string()
      .optional()
      .describe("위험요인 한글 라벨 또는 키워드 (예: 추락, 붕괴)"),
  })
  .refine((v) => Boolean(v.hazardId || v.hazardLabel), {
    message: "hazardId 또는 hazardLabel 중 하나는 필요합니다.",
  });

type Input = z.infer<typeof inputSchema>;

const nodeCache = new Map<string, GraphNode>();
let cacheBuilt = false;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const hazardMatch = findHazard(input);

  if (!hazardMatch) {
    const payload = {
      query: input,
      found: false,
      message: "그래프에서 입력 위험요인을 찾지 못했습니다.",
      candidates: listHazardCandidates(input.hazardLabel ?? input.hazardId ?? ""),
      suggestedNextTools: SUGGESTED_NEXT_TOOLS,
    };
    return {
      content: [{ type: "text", text: renderNotFoundMarkdown(payload.message, payload.candidates) }],
      structuredContent: payload,
    };
  }

  const measures = buildControlMeasuresForHazard(hazardMatch.node);
  const sourceLinks = resolveSourceLinks(hazardMatch.node);
  const payload = {
    query: input,
    found: true,
    matchedHazard: {
      iri: hazardMatch.iri,
      label: hazardMatch.label,
      score: hazardMatch.score,
      matchedBy: hazardMatch.matchedBy,
      specificity: readString(hazardMatch.node.specificity),
      category: readString(hazardMatch.node.category),
    },
    graphTraversal: {
      start: hazardMatch.iri,
      relation: "mitigatedBy",
      targets: measures.map((m) => m.iri),
    },
    measures,
    sourceLinks,
    license: "MIT. 그래프 노드의 출처·라이선스는 각 node._meta.licenseHint 및 sourceUrl을 따른다.",
    suggestedNextTools: SUGGESTED_NEXT_TOOLS,
  };

  return {
    content: [{ type: "text", text: renderMeasuresMarkdown(payload) }],
    structuredContent: payload,
  };
}

export function buildControlMeasuresForHazard(hazardNode: GraphNode): ControlMeasure[] {
  const hazardRef = toGraphRef(hazardNode);
  const sourceRefs = resolveSourceLinks(hazardNode).map((s) => s.iri);
  const seen = new Set<string>();

  return toStringArray(hazardNode.mitigatedBy)
    .map((controlIri) => getGraphNode(controlIri))
    .filter((node): node is GraphNode => Boolean(node))
    .filter((node) => {
      const iri = getNodeId(node);
      if (!iri || seen.has(iri)) return false;
      seen.add(iri);
      return true;
    })
    .map((node) => {
      const ericLevel = readNumber(node.ericLevel);
      const controlRef = toGraphRef(node);
      return {
        iri: controlRef.iri,
        label: controlRef.label,
        description: readString(node.description),
        ericLevel,
        ericLevelLabel: formatEricLevel(ericLevel),
        category: readString(node.category),
        controlSpecificity: readString(node.controlSpecificity),
        appliesToActivity: toStringArray(node.appliesToActivity),
        chain: {
          fromHazard: hazardRef,
          relation: "mitigatedBy" as const,
          toControl: controlRef,
        },
        sourceRefs,
      };
    });
}

export function findHazard(input: { hazardId?: string; hazardLabel?: string }): GraphMatch | null {
  if (input.hazardId) {
    const iri = normalizeIri(input.hazardId, "hazard");
    const node = getGraphNode(iri);
    if (node && typeMatches(node, "Hazard")) {
      return {
        node,
        iri,
        label: getDisplayLabel(node),
        score: MATCH_SCORE.EXACT_ID,
        matchedBy: "hazardId",
      };
    }
  }

  if (!input.hazardLabel) return null;
  return findNodeByLabel("Hazard", input.hazardLabel, "hazardLabel");
}

export function findActivity(input: {
  activityId?: string;
  activityLabel?: string;
}): GraphMatch | null {
  if (input.activityId) {
    const iri = normalizeIri(input.activityId, "activity");
    const node = getGraphNode(iri);
    if (node && typeMatches(node, "Activity")) {
      return {
        node,
        iri,
        label: getDisplayLabel(node),
        score: MATCH_SCORE.EXACT_ID,
        matchedBy: "activityId",
      };
    }
  }

  if (!input.activityLabel) return null;
  return findNodeByLabel("Activity", input.activityLabel, "activityLabel");
}

export function getGraphNode(iri: string): GraphNode | undefined {
  buildCache();
  return nodeCache.get(iri);
}

export function listGraphNodesByType(typeName: string): GraphNode[] {
  buildCache();
  return [...nodeCache.values()].filter((node) => typeMatches(node, typeName));
}

export function resolveSourceLinks(...nodes: GraphNode[]): SourceLink[] {
  const iris = uniqueStrings(
    nodes.flatMap((node) => [
      ...toStringArray(node.guidedBy),
      ...toStringArray(node.supportedByGuide),
      ...toStringArray(node.regulatedBy),
      ...toStringArray(node.legalBasis),
    ]),
  );

  return iris.map(resolveSourceLink);
}

export function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  return typeof value === "string" && value.trim().length > 0 ? [value] : [];
}

export function getDisplayLabel(node: GraphNode | undefined): string {
  if (!node) return "알 수 없음";
  return readString(node.label) ?? readString(node.title) ?? getNodeId(node) ?? "알 수 없음";
}

export function getNodeId(node: GraphNode | undefined): string | undefined {
  return node?.["@id"];
}

export function toGraphRef(node: GraphNode): GraphRef {
  return {
    iri: getNodeId(node) ?? "unknown",
    label: getDisplayLabel(node),
  };
}

export function formatEricLevel(level: number | undefined): string {
  if (level === undefined) return "미분류";
  return `${level}. ${ERIC_LEVEL_LABELS[level] ?? "미분류"}`;
}

export function isPpeControl(nodeOrMeasure: GraphNode | ControlMeasure): boolean {
  const measure = isControlMeasure(nodeOrMeasure);
  const iri = measure ? nodeOrMeasure.iri : getNodeId(nodeOrMeasure) ?? "";
  const ericLevel = measure ? nodeOrMeasure.ericLevel : readNumber(nodeOrMeasure.ericLevel);
  const category = measure ? nodeOrMeasure.category : readString(nodeOrMeasure.category);
  if (iri.startsWith("control:eric_")) return false;
  return ericLevel === 5 || category === "ppe" || iri.startsWith("control:ppe_");
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function buildCache(): void {
  if (cacheBuilt) return;
  const nodesDir = locateNodesDir();
  for (const filePath of walkJsonld(nodesDir)) {
    try {
      const node = JSON.parse(readFileSync(filePath, "utf8")) as GraphNode;
      const iri = getNodeId(node);
      if (iri) nodeCache.set(iri, node);
    } catch {
      // 손상된 노드는 도구 응답에서 제외한다. 검증 스크립트가 별도로 다룬다.
    }
  }
  cacheBuilt = true;
}

function locateNodesDir(): string {
  for (const relativePath of NODE_DIR_RELATIVE_CANDIDATES) {
    const candidate = resolve(__dirname, relativePath);
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      // 다음 후보를 확인한다.
    }
  }
  throw new Error("ontology graph nodes directory not found");
}

function walkJsonld(dirPath: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonld(fullPath));
    if (entry.isFile() && entry.name.endsWith(".jsonld")) out.push(fullPath);
  }
  return out;
}

function findNodeByLabel(
  typeName: string,
  query: string,
  matchedBy: "hazardLabel" | "activityLabel",
): GraphMatch | null {
  const q = normalizeText(query);
  if (!q) return null;

  const candidates = listGraphNodesByType(typeName)
    .map((node) => scoreNode(node, q, matchedBy))
    .filter((match): match is GraphMatch => Boolean(match))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "ko"));

  return candidates[0] ?? null;
}

function scoreNode(
  node: GraphNode,
  query: string,
  matchedBy: "hazardLabel" | "activityLabel",
): GraphMatch | null {
  const iri = getNodeId(node) ?? "";
  const label = getDisplayLabel(node);
  const labelNorm = normalizeText(label);
  const slugNorm = normalizeText(readString(node.slug) ?? "");
  const keywords = toStringArray(readMeta(node).matchKeywords).map(normalizeText);

  let score = 0;
  let reason: string = matchedBy;
  if (labelNorm === query) {
    score = MATCH_SCORE.EXACT_LABEL;
    reason = `${matchedBy}:exact-label`;
  } else if (keywords.includes(query)) {
    score = MATCH_SCORE.EXACT_KEYWORD;
    reason = `${matchedBy}:exact-keyword`;
  } else if (labelNorm.includes(query) || query.includes(labelNorm)) {
    score = MATCH_SCORE.LABEL_CONTAINS;
    reason = `${matchedBy}:label-contains`;
  } else if (keywords.some((keyword) => keyword.includes(query) || query.includes(keyword))) {
    score = MATCH_SCORE.KEYWORD_CONTAINS;
    reason = `${matchedBy}:keyword-contains`;
  } else if (slugNorm.includes(query)) {
    score = MATCH_SCORE.SLUG_CONTAINS;
    reason = `${matchedBy}:slug-contains`;
  }

  if (score === 0) return null;
  return { node, iri, label, score, matchedBy: reason };
}

function listHazardCandidates(query: string): GraphRef[] {
  const q = normalizeText(query);
  return listGraphNodesByType("Hazard")
    .filter((node) => {
      if (!q) return true;
      const label = normalizeText(getDisplayLabel(node));
      const keywords = toStringArray(readMeta(node).matchKeywords).map(normalizeText);
      return label.includes(q) || keywords.some((keyword) => keyword.includes(q));
    })
    .slice(0, 10)
    .map(toGraphRef);
}

function resolveSourceLink(iri: string): SourceLink {
  const node = getGraphNode(iri);
  const meta = readMeta(node);
  const sourceUrl = readString(meta.sourceUrl);
  const sourceType = iri.startsWith("doc:kosha_guide/")
    ? "kosha_guide"
    : iri.startsWith("art:")
      ? "law_article"
      : "graph_node";

  return {
    iri,
    label: node ? getDisplayLabel(node) : iri,
    sourceType,
    sourceUrl,
    guideNo: readString(meta.guideNo),
    articleNumber: node ? readString(node.articleNumber) : undefined,
    legislationIdentifier: node ? readString(node.legislationIdentifier) : undefined,
    legalWeight:
      sourceType === "law_article"
        ? "mandatory"
        : sourceType === "kosha_guide"
          ? "recommended"
          : "reference",
  };
}

function normalizeIri(value: string, prefix: "hazard" | "activity"): string {
  const trimmed = value.trim();
  if (trimmed.includes(":")) return trimmed;
  return `${prefix}:${trimmed}`;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function typeMatches(node: GraphNode, typeName: string): boolean {
  const t = node["@type"];
  if (Array.isArray(t)) return t.includes(typeName);
  return t === typeName;
}

function readMeta(node: GraphNode | undefined): Record<string, unknown> {
  const meta = node?._meta;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isControlMeasure(value: GraphNode | ControlMeasure): value is ControlMeasure {
  return "chain" in value && "iri" in value && typeof value.iri === "string";
}

function renderMeasuresMarkdown(payload: {
  matchedHazard: { iri: string; label: string };
  measures: ControlMeasure[];
  sourceLinks: SourceLink[];
}): string {
  const lines = [
    `# 위험요인별 안전조치: ${payload.matchedHazard.label}`,
    "",
    `- 위험요인 IRI: \`${payload.matchedHazard.iri}\``,
    `- 그래프 사슬: \`${payload.matchedHazard.iri}\` --mitigatedBy--> control`,
    "",
    "## 안전조치",
  ];

  for (const measure of payload.measures.slice(0, MAX_MARKDOWN_MEASURES)) {
    const detail = measure.description ? `: ${shorten(measure.description, 90)}` : "";
    lines.push(
      `- ${measure.label} (\`${measure.iri}\`) - ERIC ${measure.ericLevelLabel}${detail}`,
    );
  }

  if (payload.measures.length === 0) {
    lines.push("- 그래프에 연결된 mitigatedBy 통제수단이 없습니다.");
  }

  lines.push("", "## 원문 링크");
  for (const source of payload.sourceLinks.slice(0, MAX_MARKDOWN_SOURCES)) {
    const url = source.sourceUrl ? ` - ${source.sourceUrl}` : "";
    lines.push(`- ${source.label} (\`${source.iri}\`, ${source.legalWeight})${url}`);
  }
  if (payload.sourceLinks.length === 0) lines.push("- 그래프에 guidedBy 또는 regulatedBy 링크가 없습니다.");

  return lines.join("\n");
}

function renderNotFoundMarkdown(message: string, candidates: GraphRef[]): string {
  const lines = [`# 위험요인 검색 결과 없음`, "", message];
  if (candidates.length > 0) {
    lines.push("", "## 후보");
    for (const candidate of candidates) {
      lines.push(`- ${candidate.label} (\`${candidate.iri}\`)`);
    }
  }
  return lines.join("\n");
}

function shorten(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

export const getMeasuresByRiskTool: ToolDefinition = {
  name: "get_measures_by_risk",
  title: "위험요인별 안전조치 조회",
  description:
    "위험요인 IRI 또는 한글 라벨로 그래프를 조회해 hazard --mitigatedBy--> control 사슬의 안전조치, ERIC 위계, KOSHA Guide·법령 원문 링크를 반환한다. 외부 호출 없이 저장소 JSON-LD 사실만 사용한다.",
  inputSchema,
  handler,
};
