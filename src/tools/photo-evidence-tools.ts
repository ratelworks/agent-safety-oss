/**
 * photo-evidence-tools.ts
 *
 * PhotoEvidence 현장 사이클 도구 4종.
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  appendPhotoEvidenceIssue,
  getPhotoStorageDir,
  getSafetyStorageRoot,
  listPhotoEvidence,
  loadPhotoEvidence,
  normalizePhotoId,
  savePhotoEvidence,
  toPhotoIri,
  type SavePhotoEvidenceInput,
  type PhotoEvidenceRecord,
  type PhotoEvidenceType,
} from "../lib/photo-storage.js";
import { listSafetyIssuesByPhotoEvidence, toSafetyIssueIri } from "../lib/safety-issue-storage.js";

const EVIDENCE_TYPES = ["before_action", "after_action", "inspection"] as const;
const GRAPH_RELATIONS = {
  TYPE: "rdf:type",
  RELATED_TASK: "safety:relatedTask",
  RELATED_SITE: "prov:wasDerivedFrom",
  RELATED_RISK: "safety:relatedRisk",
  EVIDENCES: "safety:evidences",
} as const;

// 매일 사이클 흐름: 사진 등록·조회 후 → 이슈 등록 / 조치 기록 / 보고서 합본.
const SUGGESTED_NEXT_TOOLS = {
  upload_photo_evidence: ["register_safety_issue", "list_photos_by_site", "generate_safety_report"],
  list_photos_by_site: ["get_photo_evidence", "register_safety_issue", "generate_safety_report"],
  list_photos_by_task: ["get_photo_evidence", "register_safety_issue", "list_photos_by_site"],
  get_photo_evidence: ["register_safety_issue", "list_photos_by_task", "record_corrective_action"],
} as const;

const dateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "ISO 8601 dateTime 형식이 필요합니다.",
});

const uploadPhotoEvidenceSchema = z
  .object({
    filePath: z.string().optional().describe("로컬 사진 파일 경로"),
    fileUri: z.string().optional().describe("이미 저장된 사진 URI(file://, https:// 등)"),
    relatedTask: z.string().min(1).describe("관련 작업 IRI (예: activity:excavation_2m_plus)"),
    relatedSite: z.string().optional().describe("관련 현장·사업장 IRI"),
    relatedRisk: z.string().optional().describe("관련 위험요인 IRI (예: hazard:fall_from_height)"),
    evidenceType: z.enum(EVIDENCE_TYPES).describe("사진 증빙 유형"),
    capturedAt: dateTimeSchema.describe("촬영 시각 ISO 8601"),
  })
  .refine((value) => Boolean(value.filePath) !== Boolean(value.fileUri), {
    message: "filePath 또는 fileUri 중 정확히 하나만 입력해야 합니다.",
    path: ["filePath"],
  });

const listPhotosBySiteSchema = z
  .object({
    siteId: z.string().optional().describe("현장·사업장 IRI"),
    since: dateTimeSchema.optional().describe("이 시각 이후 촬영·등록된 사진만 조회"),
  })
  .refine((value) => Boolean(value.siteId || value.since), {
    message: "siteId 또는 since 중 하나는 필요합니다.",
  });

const listPhotosByTaskSchema = z.object({
  activityId: z.string().min(1).describe("작업 활동 IRI (예: activity:excavation_2m_plus)"),
});

const getPhotoEvidenceSchema = z.object({
  photoId: z.string().min(1).describe("사진 증빙 ID 또는 IRI"),
});

type UploadPhotoEvidenceInput = z.infer<typeof uploadPhotoEvidenceSchema>;

async function uploadPhotoEvidenceHandler(rawInput: unknown): Promise<McpToolResult> {
  const input: UploadPhotoEvidenceInput = uploadPhotoEvidenceSchema.parse(rawInput ?? {});
  const saveInput: SavePhotoEvidenceInput = {
    ...input,
    evidenceType: input.evidenceType as PhotoEvidenceType,
  } as SavePhotoEvidenceInput;
  const photo = await savePhotoEvidence(saveInput);

  const payload = buildPhotoPayload(photo);
  return {
    content: [
      {
        type: "text",
        text:
          `# 사진 증빙 등록 완료\n\n` +
          `- photoId: \`${photo.photoId}\`\n` +
          `- IRI: \`${photo["@id"]}\`\n` +
          `- 관련 작업: \`${photo.relatedTask}\`\n` +
          `- 촬영 시각: ${photo.capturedAt}\n` +
          `- 저장 위치: \`${getPhotoStorageDir()}\``,
      },
    ],
    structuredContent: { ...payload, suggestedNextTools: SUGGESTED_NEXT_TOOLS.upload_photo_evidence },
  };
}

async function listPhotosBySiteHandler(rawInput: unknown): Promise<McpToolResult> {
  const input = listPhotosBySiteSchema.parse(rawInput ?? {});
  const photos = await listPhotoEvidence({ siteId: input.siteId, since: input.since });
  const lines = [`# 현장 사진 증빙 ${photos.length}건`, ""];
  if (photos.length === 0) lines.push("*조회된 사진 증빙 없음.*");
  for (const photo of photos) {
    lines.push(`- ${photo.label} (\`${photo.photoId}\`) - ${photo.capturedAt}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      iri: input.siteId ?? "safety:photo_evidence",
      label: input.siteId ? `현장 사진 증빙 - ${input.siteId}` : "시각 기준 사진 증빙",
      count: photos.length,
      photos: photos.map((photo) => buildPhotoSummary(photo)),
      graphChain: photos.flatMap((photo) => buildPhotoGraphChain(photo)),
      storageRoot: getSafetyStorageRoot(),
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.list_photos_by_site,
    },
  };
}

async function listPhotosByTaskHandler(rawInput: unknown): Promise<McpToolResult> {
  const input = listPhotosByTaskSchema.parse(rawInput ?? {});
  const photos = await listPhotoEvidence({ activityId: input.activityId });
  const lines = [`# 작업별 사진 증빙 ${photos.length}건`, "", `- 작업: \`${input.activityId}\``];
  if (photos.length === 0) lines.push("", "*조회된 사진 증빙 없음.*");
  for (const photo of photos) {
    lines.push(`- ${photo.label} (\`${photo.photoId}\`) - ${photo.capturedAt}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      iri: input.activityId,
      label: `작업별 사진 증빙 - ${input.activityId}`,
      count: photos.length,
      photos: photos.map((photo) => buildPhotoSummary(photo)),
      graphChain: photos.flatMap((photo) => buildPhotoGraphChain(photo)),
      storageRoot: getSafetyStorageRoot(),
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.list_photos_by_task,
    },
  };
}

async function getPhotoEvidenceHandler(rawInput: unknown): Promise<McpToolResult> {
  const input = getPhotoEvidenceSchema.parse(rawInput ?? {});
  const photo = await loadPhotoEvidence(input.photoId);
  if (!photo) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] photoId="${input.photoId}" 사진 증빙 없음.` }],
      structuredContent: {
        iri: toPhotoIri(input.photoId),
        label: "사진 증빙 없음",
        found: false,
        photoId: normalizePhotoId(input.photoId),
        graphChain: [],
        suggestedNextTools: SUGGESTED_NEXT_TOOLS.get_photo_evidence,
      },
    };
  }

  const linkedIssues = await listSafetyIssuesByPhotoEvidence(photo.photoId);
  const issueIds = linkedIssues.map((issue) => issue.issueId);
  for (const issueId of issueIds) await appendPhotoEvidenceIssue(photo.photoId, issueId);

  return {
    content: [
      {
        type: "text",
        text:
          `# 사진 증빙\n\n` +
          `- photoId: \`${photo.photoId}\`\n` +
          `- IRI: \`${photo["@id"]}\`\n` +
          `- 라벨: ${photo.label}\n` +
          `- 파일: ${photo.fileUri}\n` +
          `- 관련 작업: \`${photo.relatedTask}\`\n` +
          `- 연결 이슈: ${issueIds.length}건`,
      },
    ],
    structuredContent: {
      ...buildPhotoPayload({ ...photo, evidences: uniqueStrings([...photo.evidences, ...issueIds]) }),
      suggestedNextTools: SUGGESTED_NEXT_TOOLS.get_photo_evidence,
    },
  };
}

function buildPhotoPayload(photo: PhotoEvidenceRecord): Record<string, unknown> {
  return {
    iri: photo["@id"],
    label: photo.label,
    photo,
    graphChain: buildPhotoGraphChain(photo),
    storageRoot: getSafetyStorageRoot(),
  };
}

function buildPhotoSummary(photo: PhotoEvidenceRecord): Record<string, unknown> {
  return {
    photoId: photo.photoId,
    iri: photo["@id"],
    label: photo.label,
    fileUri: photo.fileUri,
    relatedTask: photo.relatedTask,
    relatedSite: photo.relatedSite,
    relatedRisk: photo.relatedRisk,
    evidenceType: photo.evidenceType,
    capturedAt: photo.capturedAt,
  };
}

function buildPhotoGraphChain(photo: PhotoEvidenceRecord): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [
    makeEdge(photo["@id"], GRAPH_RELATIONS.TYPE, "safety:PhotoEvidence", "사진 증빙 클래스"),
    makeEdge(photo["@id"], GRAPH_RELATIONS.RELATED_TASK, photo.relatedTask, "사진 증빙 → 관련 작업"),
  ];
  if (photo.relatedSite) {
    chain.push(makeEdge(photo["@id"], GRAPH_RELATIONS.RELATED_SITE, photo.relatedSite, "사진 증빙 → 현장"));
  }
  if (photo.relatedRisk) {
    chain.push(makeEdge(photo.relatedTask, GRAPH_RELATIONS.RELATED_RISK, photo.relatedRisk, "작업 → 관련 위험요인"));
  }
  for (const issueId of photo.evidences) {
    chain.push(makeEdge(photo["@id"], GRAPH_RELATIONS.EVIDENCES, toSafetyIssueIri(issueId), "사진 증빙 → 안전 이슈"));
  }
  return chain;
}

function makeEdge(from: string, relation: string, to: string, label: string): Record<string, string> {
  return { from, relation, to, label };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export const PHOTO_EVIDENCE_TOOLS: ToolDefinition[] = [
  {
    name: "upload_photo_evidence",
    title: "사진 증빙 등록",
    description:
      "현장 사진을 PhotoEvidence 로 등록한다. filePath 입력 시 photos/ 로 복사하고, fileUri 입력 시 URI를 그대로 증빙으로 기록한다. relatedTask·capturedAt 기반 IRI와 그래프 사슬을 반환한다.",
    inputSchema: uploadPhotoEvidenceSchema,
    handler: uploadPhotoEvidenceHandler,
  },
  {
    name: "list_photos_by_site",
    title: "현장별 사진 증빙 목록",
    description:
      "siteId 또는 since 기준으로 photos/ 로컬 저장소의 PhotoEvidence 목록을 조회하고 사진→작업→위험/이슈 그래프 사슬을 함께 반환한다.",
    inputSchema: listPhotosBySiteSchema,
    handler: listPhotosBySiteHandler,
  },
  {
    name: "list_photos_by_task",
    title: "작업별 사진 증빙 목록",
    description:
      "activityId 기준으로 관련 PhotoEvidence 목록을 조회한다. 작업 활동에서 사진 증빙과 안전 이슈로 이어지는 현장 사슬 확인에 사용한다.",
    inputSchema: listPhotosByTaskSchema,
    handler: listPhotosByTaskHandler,
  },
  {
    name: "get_photo_evidence",
    title: "사진 증빙 단건 조회",
    description:
      "photoId 로 PhotoEvidence 단건을 조회하고 fileUri, 관련 작업, 관련 위험요인, 연결된 SafetyIssue 그래프 사슬을 반환한다.",
    inputSchema: getPhotoEvidenceSchema,
    handler: getPhotoEvidenceHandler,
  },
];
