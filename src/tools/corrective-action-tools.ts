/**
 * corrective-action-tools.ts
 *
 * SafetyIssue → CorrectiveAction → PhotoEvidence 조치 사이클 도구.
 */
import { z } from "zod";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import {
  completeCorrectiveAction,
  getActionsDir,
  getCorrectiveActionWithEvidence,
  listPendingCorrectiveActions,
  recordCorrectiveAction,
  type CompleteCorrectiveActionInput,
  type RecordCorrectiveActionInput,
} from "../lib/corrective-action-storage.js";

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ACTION_ID_RE = /^action\.[0-9]{8}\.[0-9]{2,}$/;

// 매일 사이클 흐름: 조치 기록·완료·조회 후 → 사진 증빙 / 이슈 상태 변경 / 보고서 합본.
const SUGGESTED_NEXT_TOOLS = {
  record_corrective_action: ["upload_photo_evidence", "update_issue_status", "list_pending_actions"],
  complete_action: ["upload_photo_evidence", "update_issue_status", "generate_safety_report"],
  list_pending_actions: ["complete_action", "get_corrective_action", "record_corrective_action"],
  get_corrective_action: ["complete_action", "upload_photo_evidence", "update_issue_status"],
} as const;

const assigneeSchema = z.union([
  z.string().min(1).transform((name) => ({ name })),
  z.object({
    name: z.string().min(1).describe("담당자 이름"),
    organization: z.string().optional().describe("담당자 소속"),
  }),
]);

const recordCorrectiveActionSchema = z.object({
  relatedIssue: z.string().min(1).describe("연결할 SafetyIssue issueId"),
  action: z.string().min(1).describe("요청할 개선조치 자유 텍스트"),
  assignee: assigneeSchema.describe("담당자 이름 또는 {name, organization}"),
  dueBy: z
    .string()
    .regex(DATE_RE, "xsd:date 형식(YYYY-MM-DD)")
    .describe("조치 만기일 xsd:date"),
  recommendedMeasure: z.string().optional().describe("권장 안전조치 control IRI"),
});

const completeActionSchema = z.object({
  actionId: z.string().regex(ACTION_ID_RE).describe("완료 처리할 actionId"),
  completionNote: z.string().min(1).describe("완료 메모"),
  photoEvidence: z.string().optional().describe("after_action 사진 ID"),
});

const listPendingActionsSchema = z.object({
  siteId: z.string().optional().describe("특정 현장 ID"),
  dueWithin: z.coerce.number().int().nonnegative().optional().describe("N일 이내 만기 또는 이미 만기"),
});

const getCorrectiveActionSchema = z.object({
  actionId: z.string().regex(ACTION_ID_RE).describe("조회할 actionId"),
});

async function recordCorrectiveActionHandler(input: unknown): Promise<McpToolResult> {
  const args = recordCorrectiveActionSchema.parse(input) as RecordCorrectiveActionInput;
  const record = await recordCorrectiveAction(args);
  const lines: string[] = [];
  lines.push("# 개선조치 기록 완료");
  lines.push("");
  lines.push(`- actionId: \`${record.actionId}\``);
  lines.push(`- 상태: ${record.status}`);
  lines.push(`- 관련 이슈: \`${record.relatedIssue}\` (${record.relatedIssueState})`);
  lines.push(`- 담당: ${formatAssignee(record.assignee)}`);
  lines.push(`- 만기: ${record.dueBy}`);
  lines.push(`- 저장 위치: \`${getActionsDir()}/${record.actionId}.json\``);
  lines.push("");
  lines.push("## 그래프 사슬");
  for (const triple of record.graphChain) {
    lines.push(`- \`${triple.subject}\` → \`${triple.predicate}\` → \`${triple.object}\``);
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      actionId: record.actionId,
      iri: record.iri,
      status: record.status,
      relatedIssue: record.relatedIssue,
      relatedIssueIri: record.relatedIssueIri,
      relatedIssueState: record.relatedIssueState,
      graphChain: record.graphChain,
      action: record,
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.record_corrective_action,
    },
  };
}

async function completeActionHandler(input: unknown): Promise<McpToolResult> {
  const args = completeActionSchema.parse(input) as CompleteCorrectiveActionInput;
  const record = await completeCorrectiveAction(args);
  if (!record) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] actionId="${args.actionId}" 개선조치 없음.` }],
      structuredContent: {
        found: false,
        actionId: args.actionId,
        suggestedNextTools: SUGGESTED_NEXT_TOOLS.complete_action,
      },
    };
  }
  const lines: string[] = [];
  lines.push("# 개선조치 완료 처리");
  lines.push("");
  lines.push(`- actionId: \`${record.actionId}\``);
  lines.push(`- 상태: ${record.status}`);
  lines.push(`- 완료시각: ${record.completedAt}`);
  if (record.afterActionPhotoEvidence) {
    lines.push(`- after 사진: \`${record.afterActionPhotoEvidence}\``);
  }
  lines.push("");
  lines.push("## 그래프 사슬");
  for (const triple of record.graphChain) {
    lines.push(`- \`${triple.subject}\` → \`${triple.predicate}\` → \`${triple.object}\``);
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      found: true,
      actionId: record.actionId,
      iri: record.iri,
      status: record.status,
      completedAt: record.completedAt,
      afterActionPhotoEvidence: record.afterActionPhotoEvidence,
      graphChain: record.graphChain,
      action: record,
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.complete_action,
    },
  };
}

async function listPendingActionsHandler(input: unknown): Promise<McpToolResult> {
  const args = listPendingActionsSchema.parse(input ?? {});
  const actions = await listPendingCorrectiveActions(args);
  const lines: string[] = [];
  const suffix = [
    args.siteId ? `siteId=${args.siteId}` : "",
    args.dueWithin !== undefined ? `dueWithin=${args.dueWithin}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  lines.push(`# 미완료 개선조치 ${actions.length}건${suffix ? ` (${suffix})` : ""}`);
  lines.push("");
  if (actions.length === 0) {
    lines.push("*미완료 개선조치 없음.*");
  } else {
    lines.push("| actionId | 관련 이슈 | 상태 | 담당 | 만기 |");
    lines.push("|---|---|---|---|---|");
    for (const action of actions) {
      lines.push(
        `| \`${action.actionId}\` | \`${action.relatedIssue}\` | ${action.status} | ${escapeTable(formatAssignee(action.assignee))} | ${action.dueBy} |`,
      );
    }
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      count: actions.length,
      filters: args,
      actions: actions.map((action) => ({
        actionId: action.actionId,
        iri: action.iri,
        relatedIssue: action.relatedIssue,
        relatedIssueIri: action.relatedIssueIri,
        relatedIssueState: action.relatedIssueState,
        status: action.status,
        assignee: action.assignee,
        dueBy: action.dueBy,
        siteId: action.siteId,
        graphChain: action.graphChain,
      })),
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.list_pending_actions,
    },
  };
}

async function getCorrectiveActionHandler(input: unknown): Promise<McpToolResult> {
  const args = getCorrectiveActionSchema.parse(input);
  const action = await getCorrectiveActionWithEvidence(args.actionId);
  if (!action) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] actionId="${args.actionId}" 개선조치 없음.` }],
      structuredContent: {
        found: false,
        actionId: args.actionId,
        suggestedNextTools: SUGGESTED_NEXT_TOOLS.get_corrective_action,
      },
    };
  }
  const lines: string[] = [];
  lines.push("# 개선조치 조회");
  lines.push("");
  lines.push(`- actionId: \`${action.actionId}\``);
  lines.push(`- IRI: \`${action.iri}\``);
  lines.push(`- 상태: ${action.status}`);
  lines.push(`- 관련 이슈: \`${action.relatedIssue}\` (${action.relatedIssueState})`);
  lines.push(`- 담당: ${formatAssignee(action.assignee)}`);
  lines.push(`- 만기: ${action.dueBy}`);
  if (action.completedAt) lines.push(`- 완료: ${action.completedAt}`);
  lines.push(`- before 사진: ${action.photos.before.length}건`);
  lines.push(`- after 사진: ${action.photos.after.length}건`);
  lines.push("");
  lines.push("## 그래프 사슬");
  for (const triple of action.graphChain) {
    lines.push(`- \`${triple.subject}\` → \`${triple.predicate}\` → \`${triple.object}\``);
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      found: true,
      actionId: action.actionId,
      iri: action.iri,
      relatedIssue: action.issueSnapshot,
      photos: action.photos,
      graphChain: action.graphChain,
      action,
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.get_corrective_action,
    },
  };
}

function formatAssignee(assignee: { name: string; organization?: string }): string {
  return assignee.organization ? `${assignee.name} (${assignee.organization})` : assignee.name;
}

function escapeTable(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const CORRECTIVE_ACTION_TOOLS: ToolDefinition[] = [
  {
    name: "record_corrective_action",
    title: "개선조치 기록",
    description:
      "SafetyIssue issueId 에 대한 개선조치를 요청 상태로 기록하고 safety:CorrectiveAction 그래프 사슬(resolves, recommendedMeasure)을 로컬 저장소에 저장한다.",
    inputSchema: recordCorrectiveActionSchema,
    handler: recordCorrectiveActionHandler,
  },
  {
    name: "complete_action",
    title: "개선조치 완료 처리",
    description:
      "개선조치 actionId 를 resolved 로 전환하고 완료 메모 및 after_action 사진 증빙을 연결한다.",
    inputSchema: completeActionSchema,
    handler: completeActionHandler,
  },
  {
    name: "list_pending_actions",
    title: "미완료 개선조치 목록",
    description:
      "requested 또는 in_progress 상태의 개선조치를 만기일 오름차순으로 조회한다. siteId 또는 dueWithin 필터를 사용할 수 있다.",
    inputSchema: listPendingActionsSchema,
    handler: listPendingActionsHandler,
  },
  {
    name: "get_corrective_action",
    title: "개선조치 단건 조회",
    description:
      "개선조치 단건을 relatedIssue, before/after PhotoEvidence, safety:resolves 그래프 사슬과 함께 조회한다.",
    inputSchema: getCorrectiveActionSchema,
    handler: getCorrectiveActionHandler,
  },
];
