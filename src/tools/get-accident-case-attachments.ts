import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { callKoshaApi } from "../lib/api-client.js";
import { KOSHA_ENDPOINTS } from "../config/constants.js";

// 파일 최상단 상수 — 15121008 국내재해사례 첨부파일 조회
// 실제 스펙: /B552468/disaster_attach_api/Disaster_attach_api
// search_accident_cases 결과의 boardno 로 첨부파일(이미지·도면·PDF) 조회
const MAX_ROWS = 50;
const DEFAULT_ROWS = 20;

const inputSchema = z.object({
  boardno: z
    .string()
    .min(1)
    .describe("재해사례 게시판 번호 (search_accident_cases 응답의 boardno, 예: '20260413162017EK5XMP'). 영숫자 혼합 문자열"),
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const endpoint = KOSHA_ENDPOINTS.accidentCaseAttachment;

  const { parsed, url } = await callKoshaApi({
    api: "accidentCaseAttachment",
    base: endpoint.base,
    path: endpoint.path,
    params: {
      ...endpoint.extraParams, // callApiId=1070 (필수)
      pageNo: input.pageNo,
      numOfRows: input.numOfRows,
      boardno: input.boardno,
    },
    responseFormat: endpoint.responseFormat,
  });

  const items = extractItems(parsed);

  const payload = {
    query: input,
    upstream: url,
    dataId: endpoint.dataId,
    total: items.length,
    results: items.map((it) => ({
      boardno: it.boardno ?? input.boardno,
      fileName: it.filenm ?? it.fileName ?? "",
      downloadUrl: it.filepath ?? it.fileUrl ?? "",
      fileType: guessFileType(it.filenm ?? it.fileName ?? ""),
      basisType: "accident_case",
      legalWeight: "reference",
      source: "KOSHA",
    })),
    notes: [
      "다운로드 URL 은 data.go.kr 가 아닌 KOSHA 본체 서버로 리다이렉트될 수 있음.",
      "이미지/도면은 재해 현장 참고용이며, 현장 특정 개인정보는 가려져 있음.",
    ],
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function extractItems(parsed: unknown): Array<Record<string, any>> {
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as Record<string, any>;
  const body =
    root?.response?.body?.items?.item ??
    root?.response?.body?.items ??
    root?.body?.items?.item ??
    root?.items?.item ??
    root?.items ??
    [];
  return Array.isArray(body) ? body : body ? [body] : [];
}

function guessFileType(name: string): "image" | "pdf" | "document" | "video" | "other" {
  const lower = name.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|bmp|webp)$/.test(lower)) return "image";
  if (/\.pdf$/.test(lower)) return "pdf";
  if (/\.(docx?|hwpx?|xlsx?|pptx?)$/.test(lower)) return "document";
  if (/\.(mp4|mov|avi|mkv|webm)$/.test(lower)) return "video";
  return "other";
}

export const getAccidentCaseAttachmentsTool: ToolDefinition = {
  name: "get_accident_case_attachments",
  title: "재해사례 첨부파일 조회 (15121008)",
  description:
    "KOSHA 국내재해사례 첨부파일 서비스(15121008, /disaster_attach_api). 특정 재해사례의 첨부 이미지·도면·PDF URL 목록 반환. **Prerequisite: boardno 파라미터는 search_accident_cases 응답의 results[].boardno 필드값**. 즉 재해사례 검색을 선행 호출해야 사용 가능. 현장 시각화·TBM 교육자료·RAG 보강용.",
  inputSchema,
  handler,
};
