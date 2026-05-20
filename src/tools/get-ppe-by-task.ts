// SPDX-License-Identifier: MIT
// 출처: 이 도구는 저장소 내 JSON-LD 그래프 사실만 사용한다.
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  buildControlMeasuresForHazard,
  findActivity,
  formatEricLevel,
  getGraphNode,
  isPpeControl,
  resolveSourceLinks,
  toGraphRef,
  toStringArray,
  type ControlMeasure,
  type GraphNode,
  type GraphRef,
} from "./get-measures-by-risk.js";

// 파일 최상단 상수 - 작업별 보호구 응답 제한
const MAX_MARKDOWN_PPE = 10;
const MAX_MARKDOWN_SOURCES = 6;
const MAX_STRUCTURED_SOURCES = 12;

// 매일 사이클 흐름: 작업별 PPE 조회 후 → 인증 확인 / 위험요인 통제수단 / TBM 작성.
const SUGGESTED_NEXT_TOOLS = [
  "search_ppe_certification",
  "get_measures_by_risk",
  "generate_tbm_topics",
] as const;

interface PpeItem {
  iri: string;
  label: string;
  description?: string;
  ericLevel?: number;
  ericLevelLabel: string;
  category?: string;
  controlSpecificity?: string;
  appliedTask: {
    iri: string;
    label: string;
    directActivityMatch: boolean;
  };
  appliesToActivity: string[];
  hazards: Array<{
    iri: string;
    label: string;
    chain: {
      activity: GraphRef;
      hasHazard: GraphRef;
      mitigatedBy: GraphRef;
    };
  }>;
}

const inputSchema = z
  .object({
    activityId: z
      .string()
      .optional()
      .describe("작업 활동 IRI (예: activity:excavation_2m_plus)"),
    activityLabel: z
      .string()
      .optional()
      .describe("작업 활동 한글 라벨 또는 키워드 (예: 굴착, 비계 조립)"),
  })
  .refine((v) => Boolean(v.activityId || v.activityLabel), {
    message: "activityId 또는 activityLabel 중 하나는 필요합니다.",
  });

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const activityMatch = findActivity(input);

  if (!activityMatch) {
    const payload = {
      query: input,
      found: false,
      message: "그래프에서 입력 작업 활동을 찾지 못했습니다.",
      suggestedNextTools: SUGGESTED_NEXT_TOOLS,
    };
    return {
      content: [{ type: "text", text: "# 작업별 보호구 검색 결과 없음\n\n" + payload.message }],
      structuredContent: payload,
    };
  }

  const hazards = resolveActivityHazards(activityMatch.node);
  const ppeItems = collectPpe(activityMatch.node, hazards);
  const sourceLinks = resolveSourceLinks(activityMatch.node, ...hazards);
  const payload = {
    query: input,
    found: true,
    matchedActivity: {
      iri: activityMatch.iri,
      label: activityMatch.label,
      score: activityMatch.score,
      matchedBy: activityMatch.matchedBy,
    },
    graphTraversal: {
      start: activityMatch.iri,
      chain: "activity --hasHazard--> hazard --mitigatedBy--> control[ericLevel=5]",
      hazardCount: hazards.length,
      ppeCount: ppeItems.length,
    },
    ppe: ppeItems,
    sourceLinks: sourceLinks.slice(0, MAX_STRUCTURED_SOURCES),
    sourceLinkCount: sourceLinks.length,
    license: "MIT. 그래프 노드의 출처·라이선스는 각 node._meta.licenseHint 및 sourceUrl을 따른다.",
    suggestedNextTools: SUGGESTED_NEXT_TOOLS,
  };

  return {
    content: [{ type: "text", text: renderPpeMarkdown(payload) }],
    structuredContent: payload,
  };
}

function resolveActivityHazards(activityNode: GraphNode): GraphNode[] {
  const hazardIris = uniqueStrings([
    ...toStringArray(activityNode.hasHazard),
    ...toStringArray(activityNode.causedBy),
  ]);

  return hazardIris
    .map((iri) => getGraphNode(iri))
    .filter((node): node is GraphNode => Boolean(node));
}

function collectPpe(activityNode: GraphNode, hazards: GraphNode[]): PpeItem[] {
  const activityRef = toGraphRef(activityNode);
  const activityIri = activityRef.iri;
  const ppeByIri = new Map<string, PpeItem>();

  for (const hazard of hazards) {
    const hazardRef = toGraphRef(hazard);
    for (const measure of buildControlMeasuresForHazard(hazard)) {
      if (!isPpeMeasure(measure)) continue;
      const current = ppeByIri.get(measure.iri);
      const controlNode = getGraphNode(measure.iri);
      const appliesToActivity = controlNode
        ? toStringArray(controlNode.appliesToActivity)
        : measure.appliesToActivity;
      const directActivityMatch = appliesToActivity.includes(activityIri);
      const hazardEntry = {
        iri: hazardRef.iri,
        label: hazardRef.label,
        chain: {
          activity: activityRef,
          hasHazard: hazardRef,
          mitigatedBy: { iri: measure.iri, label: measure.label },
        },
      };

      if (current) {
        if (!current.hazards.some((h) => h.iri === hazardEntry.iri)) {
          current.hazards.push(hazardEntry);
        }
        current.appliedTask.directActivityMatch =
          current.appliedTask.directActivityMatch || directActivityMatch;
        continue;
      }

      ppeByIri.set(measure.iri, {
        iri: measure.iri,
        label: measure.label,
        description: measure.description,
        ericLevel: measure.ericLevel,
        ericLevelLabel: measure.ericLevelLabel,
        category: measure.category,
        controlSpecificity: measure.controlSpecificity,
        appliedTask: {
          iri: activityIri,
          label: activityRef.label,
          directActivityMatch,
        },
        appliesToActivity,
        hazards: [hazardEntry],
      });
    }
  }

  return [...ppeByIri.values()].sort(sortPpe);
}

function isPpeMeasure(measure: ControlMeasure): boolean {
  const node = getGraphNode(measure.iri);
  return isPpeControl(measure) || Boolean(node && isPpeControl(node));
}

function sortPpe(a: PpeItem, b: PpeItem): number {
  const directScore = Number(b.appliedTask.directActivityMatch) - Number(a.appliedTask.directActivityMatch);
  if (directScore !== 0) return directScore;
  return a.label.localeCompare(b.label, "ko");
}

function renderPpeMarkdown(payload: {
  matchedActivity: { iri: string; label: string };
  ppe: PpeItem[];
  sourceLinks: Array<{ iri: string; label: string; sourceUrl?: string; legalWeight: string }>;
}): string {
  const lines = [
    `# 작업별 필요 보호구: ${payload.matchedActivity.label}`,
    "",
    `- 작업 IRI: \`${payload.matchedActivity.iri}\``,
    "- 그래프 사슬: activity --hasHazard--> hazard --mitigatedBy--> PPE",
    "",
    "## 보호구",
  ];

  for (const item of payload.ppe.slice(0, MAX_MARKDOWN_PPE)) {
    const hazards = item.hazards.map((h) => h.label).slice(0, 3).join(", ");
    const direct = item.appliedTask.directActivityMatch ? "직접 적용" : "위험요인 경유 적용";
    lines.push(
      `- ${item.label} (\`${item.iri}\`) - 적용 작업: ${item.appliedTask.label} (${direct}), ERIC ${formatEricLevel(item.ericLevel)}, 관련 위험: ${hazards}`,
    );
  }

  if (payload.ppe.length === 0) {
    lines.push("- 그래프 사슬에서 ericLevel=5 또는 PPE 범주 통제수단을 찾지 못했습니다.");
  }

  lines.push("", "## 원문 링크");
  for (const source of payload.sourceLinks.slice(0, MAX_MARKDOWN_SOURCES)) {
    const url = source.sourceUrl ? ` - ${source.sourceUrl}` : "";
    lines.push(`- ${source.label} (\`${source.iri}\`, ${source.legalWeight})${url}`);
  }
  if (payload.sourceLinks.length === 0) lines.push("- 그래프에 guidedBy 또는 regulatedBy 링크가 없습니다.");

  return lines.join("\n");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export const getPpeByTaskTool: ToolDefinition = {
  name: "get_ppe_by_task",
  title: "작업별 필요 보호구 조회",
  description:
    "작업 활동 IRI 또는 한글 라벨로 activity --hasHazard--> hazard --mitigatedBy--> control 사슬을 따라가며 ERIC 5단계 개인보호구를 집계한다. 각 보호구의 IRI, label, 적용 작업, 관련 위험요인을 함께 반환한다.",
  inputSchema,
  handler,
};
