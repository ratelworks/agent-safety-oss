/**
 * safety-issue-tools.ts
 *
 * SafetyIssue 현장 사이클 도구 4종.
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  appendPhotoEvidenceIssue,
  getSafetyStorageRoot,
  loadPhotoEvidence,
  normalizePhotoId,
  toPhotoIri,
} from "../lib/photo-storage.js";
import {
  getSafetyIssueStorageDir,
  listSafetyIssues,
  loadSafetyIssue,
  saveSafetyIssue,
  toSafetyIssueIri,
  updateSafetyIssueStatus,
  type RecommendedMeasure,
  type SafetyIssueRecord,
  type SafetyIssueSeverity,
  type SafetyIssueStatus,
} from "../lib/safety-issue-storage.js";
import {
  buildControlMeasuresForHazard,
  findHazard,
  type ControlMeasure,
} from "./get-measures-by-risk.js";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = ["open", "in_progress", "resolved", "verified"] as const;
const GRAPH_RELATIONS = {
  RELATED_TASK: "safety:relatedTask",
  HAS_HAZARD: "safety:hasHazard",
  MITIGATED_BY: "safety:mitigatedBy",
  REQUIRES_ACTION: "safety:requiresAction",
  RESOLVES: "safety:resolves",
  EVIDENCES: "safety:evidences",
} as const;

// 매일 사이클 흐름: 이슈 등록·조회·변경 후 → 조치 기록 / 사진 추가 / 보고서 합본.
const SUGGESTED_NEXT_TOOLS = {
  register_safety_issue: ["record_corrective_action", "upload_photo_evidence", "list_open_issues"],
  list_open_issues: ["get_safety_issue", "record_corrective_action", "update_issue_status"],
  update_issue_status: ["record_corrective_action", "list_open_issues", "generate_safety_report"],
  get_safety_issue: ["record_corrective_action", "update_issue_status", "get_corrective_action"],
} as const;

const registerSafetyIssueSchema = z.object({
  relatedTask: z.string().min(1).describe("관련 작업 IRI (예: activity:excavation_2m_plus)"),
  relatedRisk: z.string().min(1).describe("관련 위험요인 IRI (예: hazard:fall_from_height)"),
  severity: z.enum(SEVERITIES).describe("심각도"),
  description: z.string().min(1).describe("현장에서 확인한 안전 이슈 설명"),
  photoEvidence: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("연결할 PhotoEvidence ID 또는 IRI"),
});

const listOpenIssuesSchema = z.object({
  siteId: z.string().optional().describe("현장·사업장 IRI"),
  severity: z.enum(SEVERITIES).optional().describe("심각도 필터"),
});

const updateIssueStatusSchema = z.object({
  issueId: z.string().min(1).describe("안전 이슈 ID 또는 IRI"),
  status: z.enum(STATUSES).describe("변경할 상태"),
  note: z.string().min(1).describe("상태 변경 메모"),
});

const getSafetyIssueSchema = z.object({
  issueId: z.string().min(1).describe("안전 이슈 ID 또는 IRI"),
});

async function registerSafetyIssueHandler(rawInput: unknown): Promise<McpToolResult> {
  const input = registerSafetyIssueSchema.parse(rawInput ?? {});
  const photoEvidence = normalizePhotoEvidenceInput(input.photoEvidence);
  const relatedSite = await resolveRelatedSite(photoEvidence);
  const recommendedMeasure = inferRecommendedMeasure({
    relatedTask: input.relatedTask,
    relatedRisk: input.relatedRisk,
    description: input.description,
  });

  const issue = await saveSafetyIssue({
    relatedTask: input.relatedTask,
    relatedRisk: input.relatedRisk,
    relatedSite,
    severity: input.severity as SafetyIssueSeverity,
    description: input.description,
    photoEvidence,
    recommendedMeasure,
  });

  for (const photoId of photoEvidence) {
    await appendPhotoEvidenceIssue(photoId, issue.issueId);
  }

  const payload = buildIssuePayload(issue);
  return {
    content: [
      {
        type: "text",
        text:
          `# 안전 이슈 등록 완료\n\n` +
          `- issueId: \`${issue.issueId}\`\n` +
          `- IRI: \`${issue["@id"]}\`\n` +
          `- 심각도: ${issue.severity}\n` +
          `- 상태: ${issue.status}\n` +
          `- 추천 조치: ${issue.recommendedMeasure?.label ?? "그래프 추천 없음"}\n` +
          `- 저장 위치: \`${getSafetyIssueStorageDir()}\``,
      },
    ],
    structuredContent: { ...payload, suggestedNextTools: SUGGESTED_NEXT_TOOLS.register_safety_issue },
  };
}

async function listOpenIssuesHandler(rawInput: unknown): Promise<McpToolResult> {
  const input = listOpenIssuesSchema.parse(rawInput ?? {});
  const issues = await listSafetyIssues({
    siteId: input.siteId,
    severity: input.severity as SafetyIssueSeverity | undefined,
    openOnly: true,
  });
  const lines = [`# 미해결 안전 이슈 ${issues.length}건`, ""];
  if (issues.length === 0) lines.push("*조회된 미해결 이슈 없음.*");
  for (const issue of issues) {
    lines.push(`- ${issue.label} (\`${issue.issueId}\`) - ${issue.status}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      iri: input.siteId ?? "safety:safety_issue",
      label: input.siteId ? `현장 미해결 안전 이슈 - ${input.siteId}` : "미해결 안전 이슈",
      count: issues.length,
      issues: issues.map((issue) => buildIssueSummary(issue)),
      graphChain: issues.flatMap((issue) => buildIssueGraphChain(issue)),
      storageRoot: getSafetyStorageRoot(),
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.list_open_issues,
    },
  };
}

async function updateIssueStatusHandler(rawInput: unknown): Promise<McpToolResult> {
  const input = updateIssueStatusSchema.parse(rawInput ?? {});
  const issue = await updateSafetyIssueStatus(
    input.issueId,
    input.status as SafetyIssueStatus,
    input.note,
  );
  if (!issue) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] issueId="${input.issueId}" 안전 이슈 없음.` }],
      structuredContent: {
        iri: toSafetyIssueIri(input.issueId),
        label: "안전 이슈 없음",
        found: false,
        graphChain: [],
        suggestedNextTools: SUGGESTED_NEXT_TOOLS.update_issue_status,
      },
    };
  }

  return {
    content: [
      {
        type: "text",
        text:
          `# 안전 이슈 상태 변경\n\n` +
          `- issueId: \`${issue.issueId}\`\n` +
          `- 상태: ${issue.status}\n` +
          `- 메모: ${input.note}`,
      },
    ],
    structuredContent: { ...buildIssuePayload(issue), suggestedNextTools: SUGGESTED_NEXT_TOOLS.update_issue_status },
  };
}

async function getSafetyIssueHandler(rawInput: unknown): Promise<McpToolResult> {
  const input = getSafetyIssueSchema.parse(rawInput ?? {});
  const issue = await loadSafetyIssue(input.issueId);
  if (!issue) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] issueId="${input.issueId}" 안전 이슈 없음.` }],
      structuredContent: {
        iri: toSafetyIssueIri(input.issueId),
        label: "안전 이슈 없음",
        found: false,
        graphChain: [],
        suggestedNextTools: SUGGESTED_NEXT_TOOLS.get_safety_issue,
      },
    };
  }

  return {
    content: [
      {
        type: "text",
        text:
          `# 안전 이슈\n\n` +
          `- issueId: \`${issue.issueId}\`\n` +
          `- IRI: \`${issue["@id"]}\`\n` +
          `- 설명: ${issue.description}\n` +
          `- 심각도/상태: ${issue.severity} / ${issue.status}\n` +
          `- 추천 조치: ${issue.recommendedMeasure?.label ?? "그래프 추천 없음"}`,
      },
    ],
    structuredContent: { ...buildIssuePayload(issue), suggestedNextTools: SUGGESTED_NEXT_TOOLS.get_safety_issue },
  };
}

function inferRecommendedMeasure(input: {
  relatedTask: string;
  relatedRisk: string;
  description: string;
}): RecommendedMeasure | undefined {
  const hazardMatch =
    findHazard({ hazardId: input.relatedRisk }) ??
    findHazard({ hazardLabel: input.relatedRisk });
  if (!hazardMatch) return undefined;

  const measures = buildControlMeasuresForHazard(hazardMatch.node)
    .map((measure) => ({
      measure,
      score: scoreMeasure(measure, input.relatedTask, input.description),
    }))
    .sort((a, b) => b.score - a.score || (a.measure.ericLevel ?? 9) - (b.measure.ericLevel ?? 9));
  const selected = measures[0]?.measure;
  if (!selected) return undefined;

  return {
    iri: selected.iri,
    label: selected.label,
    description: selected.description,
    ericLevel: selected.ericLevel,
    ericLevelLabel: selected.ericLevelLabel,
    chain: [
      makeEdge(input.relatedTask, GRAPH_RELATIONS.HAS_HAZARD, hazardMatch.iri, "작업 → 위험요인"),
      makeEdge(hazardMatch.iri, GRAPH_RELATIONS.MITIGATED_BY, selected.iri, "위험요인 → 안전조치"),
    ],
    inference: {
      matchedHazard: {
        iri: hazardMatch.iri,
        label: hazardMatch.label,
        score: hazardMatch.score,
        matchedBy: hazardMatch.matchedBy,
      },
      selectedBy: "relatedRisk --mitigatedBy--> control",
      descriptionKeywordBoost: countDescriptionMatches(selected, input.description),
      activityMatched: selected.appliesToActivity.includes(input.relatedTask),
    },
    alternatives: measures.slice(1, 4).map(({ measure }) => ({
      iri: measure.iri,
      label: measure.label,
      ericLevel: measure.ericLevel,
      ericLevelLabel: measure.ericLevelLabel,
    })),
  };
}

function scoreMeasure(measure: ControlMeasure, relatedTask: string, description: string): number {
  const ericLevel = measure.ericLevel ?? 9;
  const descriptionMatches = countDescriptionMatches(measure, description);
  const activityScore = measure.appliesToActivity.includes(relatedTask) ? 30 : 0;
  const specificityScore = measure.controlSpecificity === "specific" ? 12 : 0;
  const hierarchyScore = Math.max(0, 6 - ericLevel) * 5;
  return descriptionMatches * 80 + activityScore + specificityScore + hierarchyScore;
}

function countDescriptionMatches(measure: ControlMeasure, description: string): number {
  const descriptionText = normalizeKoreanText(description);
  const measureText = normalizeKoreanText(`${measure.label} ${measure.description ?? ""}`);
  const descriptionToMeasure = tokenizeKorean(description).filter((token) => measureText.includes(token)).length;
  const measureToDescription = tokenizeKorean(`${measure.label} ${measure.description ?? ""}`).filter((token) =>
    descriptionText.includes(token),
  ).length;
  return Math.max(descriptionToMeasure, measureToDescription);
}

async function resolveRelatedSite(photoEvidence: string[]): Promise<string | undefined> {
  for (const photoId of photoEvidence) {
    const photo = await loadPhotoEvidence(photoId);
    if (!photo) throw new Error(`연결할 사진 증빙을 찾을 수 없습니다: ${photoId}`);
    if (photo.relatedSite) return photo.relatedSite;
  }
  return undefined;
}

function buildIssuePayload(issue: SafetyIssueRecord): Record<string, unknown> {
  return {
    iri: issue["@id"],
    label: issue.label,
    issue,
    recommendedMeasure: issue.recommendedMeasure,
    graphChain: buildIssueGraphChain(issue),
    storageRoot: getSafetyStorageRoot(),
  };
}

function buildIssueSummary(issue: SafetyIssueRecord): Record<string, unknown> {
  return {
    issueId: issue.issueId,
    iri: issue["@id"],
    label: issue.label,
    severity: issue.severity,
    status: issue.status,
    relatedTask: issue.relatedTask,
    relatedRisk: issue.relatedRisk,
    relatedSite: issue.relatedSite,
    photoEvidence: issue.photoEvidence,
    recommendedMeasure: issue.recommendedMeasure
      ? {
          iri: issue.recommendedMeasure.iri,
          label: issue.recommendedMeasure.label,
          ericLevel: issue.recommendedMeasure.ericLevel,
          ericLevelLabel: issue.recommendedMeasure.ericLevelLabel,
        }
      : undefined,
  };
}

function buildIssueGraphChain(issue: SafetyIssueRecord): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [
    makeEdge(issue["@id"], GRAPH_RELATIONS.RELATED_TASK, issue.relatedTask, "안전 이슈 → 관련 작업"),
    makeEdge(issue.relatedTask, GRAPH_RELATIONS.HAS_HAZARD, issue.relatedRisk, "작업 → 위험요인"),
    makeEdge(issue["@id"], GRAPH_RELATIONS.REQUIRES_ACTION, issue.correctiveAction.iri, "안전 이슈 → 개선조치"),
    makeEdge(issue.correctiveAction.iri, GRAPH_RELATIONS.RESOLVES, issue["@id"], "개선조치 → 안전 이슈 해소"),
  ];

  if (issue.recommendedMeasure) {
    chain.push(makeEdge(issue.relatedRisk, GRAPH_RELATIONS.MITIGATED_BY, issue.recommendedMeasure.iri, "위험요인 → 추천 안전조치"));
  }
  for (const photoId of issue.photoEvidence) {
    chain.push(makeEdge(toPhotoIri(photoId), GRAPH_RELATIONS.EVIDENCES, issue["@id"], "사진 증빙 → 안전 이슈"));
  }
  return chain;
}

function normalizePhotoEvidenceInput(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((photoId) => normalizePhotoId(photoId));
}

function makeEdge(from: string, relation: string, to: string, label: string): Record<string, string> {
  return { from, relation, to, label };
}

function tokenizeKorean(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeKoreanText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

export const SAFETY_ISSUE_TOOLS: ToolDefinition[] = [
  {
    name: "register_safety_issue",
    title: "안전 이슈 등록",
    description:
      "현장에서 발견한 SafetyIssue 를 등록한다. relatedRisk 그래프의 mitigatedBy 사슬을 따라 추천 개선조치를 계산하고, 사진 증빙이 있으면 PhotoEvidence --evidences--> SafetyIssue 로 연결한다.",
    inputSchema: registerSafetyIssueSchema,
    handler: registerSafetyIssueHandler,
  },
  {
    name: "list_open_issues",
    title: "미해결 안전 이슈 목록",
    description:
      "open 또는 in_progress 상태의 SafetyIssue 를 siteId 또는 severity 로 필터링해 조회하고 이슈→작업→위험→조치 그래프 사슬을 반환한다.",
    inputSchema: listOpenIssuesSchema,
    handler: listOpenIssuesHandler,
  },
  {
    name: "update_issue_status",
    title: "안전 이슈 상태 변경",
    description:
      "SafetyIssue 상태를 open/in_progress/resolved/verified 중 하나로 갱신하고 note 를 상태 이력에 남긴다. 연결된 CorrectiveAction 상태도 함께 맞춘다.",
    inputSchema: updateIssueStatusSchema,
    handler: updateIssueStatusHandler,
  },
  {
    name: "get_safety_issue",
    title: "안전 이슈 단건 조회",
    description:
      "issueId 로 SafetyIssue 단건을 조회하고 관련 작업, 위험요인, 추천 개선조치, 사진 증빙 그래프 사슬을 반환한다.",
    inputSchema: getSafetyIssueSchema,
    handler: getSafetyIssueHandler,
  },
];
