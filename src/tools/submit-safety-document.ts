/**
 * submit_safety_document
 *
 * A2UI action.name 과 실제 MCP tool contract 를 맞추는 제출 래퍼.
 * 클라이언트가 폼 입력 draft 를 전달하면 결정론적 문서 생성까지 한 번에 수행하고,
 * 요청 시 로컬 보관소에 영구 저장한다.
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { archiveDocument, ARCHIVE_FORMATS, type ArchiveFormat } from "../lib/local-storage.js";
import { escapeHtml } from "../lib/html-escape.js";
import { generateSafetyDocumentTool } from "./generate-safety-document.js";

const HTML_ARCHIVE_STYLE = [
  "body{font-family:'Malgun Gothic',Arial,sans-serif;max-width:920px;margin:32px auto;padding:0 20px;line-height:1.6;color:#1f2933;}",
  "main{border:1px solid #d8dee4;padding:24px;background:#fff;}",
  "pre{white-space:pre-wrap;word-break:break-word;font-family:inherit;margin:0;}",
].join("");

const inputSchema = z.object({
  docId: z.string().regex(/^[a-z][a-z0-9_-]*$/i, "docId — 영숫자·_·- 만").describe("작성할 법정문서 docId"),
  draft: z
    .record(z.unknown())
    .optional()
    .default({})
    .describe("A2UI 또는 사용자가 입력한 draft. fieldPathMap/fieldKey 기반 값을 권장."),
  useProfile: z.boolean().optional().default(true).describe("profile.jsonld 자동 채움 사용 여부"),
  archive: z.boolean().optional().default(false).describe("true이면 생성 결과를 로컬 documents 보관소에 저장"),
  archiveFormat: z.enum(ARCHIVE_FORMATS).optional().default("markdown"),
});

export function formatGeneratedDocumentForArchive(args: {
  docId: string;
  markdown: string;
  format: ArchiveFormat;
  generatedStructuredContent?: unknown;
}): string {
  if (args.format === "markdown") return args.markdown;

  if (args.format === "html") {
    const title = escapeHtml(args.docId);
    return (
      "<!DOCTYPE html>\n" +
      '<html lang="ko">\n' +
      "<head>\n" +
      '<meta charset="UTF-8">\n' +
      `<title>${title}</title>\n` +
      `<style>${HTML_ARCHIVE_STYLE}</style>\n` +
      "</head>\n" +
      "<body>\n" +
      "<main>\n" +
      `<pre>${escapeHtml(args.markdown)}</pre>\n` +
      "</main>\n" +
      "</body>\n" +
      "</html>\n"
    );
  }

  // sourceFormat 은 JSON 보관 파일 안에만 둔다 — 추후 archive 디렉토리만 검사할 때
  // 원본 포맷을 추적하기 위한 forensic 메타. 호출자 반환값에는 노출하지 않는다.
  return JSON.stringify(
    {
      docId: args.docId,
      sourceFormat: "markdown",
      markdown: args.markdown,
      generated: args.generatedStructuredContent ?? {},
    },
    null,
    2,
  );
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput ?? {});
  const generated = await generateSafetyDocumentTool.handler({
    docId: args.docId,
    draft: args.draft,
    useProfile: args.useProfile,
  });
  if (generated.isError) return generated;

  const content = generated.content?.[0]?.text ?? "";
  if (!content.trim()) {
    // dev.md §8 — 빈 결과는 [NOT_FOUND] 마커로 LLM 추측 차단
    return {
      content: [{ type: "text", text: `[NOT_FOUND] generate_safety_document 가 빈 본문을 반환했습니다. docId='${args.docId}'` }],
      isError: true,
    };
  }

  let archiveMeta: Record<string, unknown> | null = null;
  if (args.archive) {
    const archiveBody = formatGeneratedDocumentForArchive({
      docId: args.docId,
      markdown: content,
      format: args.archiveFormat,
      generatedStructuredContent: generated.structuredContent,
    });
    archiveMeta = { ...(await archiveDocument(args.docId, archiveBody, args.archiveFormat)) };
  }

  const nextActions = archiveMeta
    ? [
        `list_archived_documents({ docId: "${args.docId}" })`,
        `load_archived_document({ docId: "${args.docId}", filename: "${archiveMeta.filename}" })`,
      ]
    : [`archive_safety_document({ docId: "${args.docId}", content: "<본문>", format: "${args.archiveFormat}" })`];

  return {
    content: generated.content,
    structuredContent: {
      docId: args.docId,
      submitted: true,
      archived: Boolean(archiveMeta),
      archive: archiveMeta,
      generated: generated.structuredContent ?? {},
      nextActions,
    },
  };
}

export const submitSafetyDocumentTool: ToolDefinition = {
  name: "submit_safety_document",
  title: "A2UI 안전문서 제출·생성",
  description:
    "A2UI 폼 action 과 직접 연결되는 MCP 도구. docId 와 draft 를 받아 generate_safety_document 를 실행하고, archive=true 일 때 Markdown 원본을 archiveFormat 에 맞게 변환해 로컬 documents 보관소에 저장한다.",
  inputSchema,
  handler,
};
