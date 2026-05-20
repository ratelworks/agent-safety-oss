#!/usr/bin/env tsx
/**
 * A2UI 문서 작성 흐름 회귀 테스트.
 *
 * render_a2ui_form 이 만든 UI 컴포넌트 ID가 실제 온톨로지 필드 키로 매핑되고,
 * 그 입력값이 generate_safety_document 결과 본문에 반영되는지 검증한다.
 */
import { TOOLS } from "../../src/tool-registry.js";
import type { McpToolResult } from "../../src/lib/types.js";
import { formatGeneratedDocumentForArchive } from "../../src/tools/submit-safety-document.js";

const DOC_ID = "daily_tbm";
const TBM_DATE = "2026-05-04T07:30";
const TODAY_WORK = "A동 굴착 작업";
const ARCHIVE_PROBE_MARKDOWN = "# 보관 테스트\n\n<script>alert('x')</script>\n";

function requireTool(name: string) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

async function callTool(name: string, input: Record<string, unknown>): Promise<McpToolResult> {
  const result = await requireTool(name).handler(input);
  if (result.isError) {
    throw new Error(`${name} failed: ${result.content?.[0]?.text ?? "unknown"}`);
  }
  return result;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function textOf(result: McpToolResult): string {
  return result.content?.[0]?.text ?? "";
}

async function main(): Promise<void> {
  const rendered = await callTool("render_a2ui_form", {
    docId: DOC_ID,
    format: "json",
    useProfile: false,
  });
  const structured = rendered.structuredContent as {
    fieldPathMap?: Record<string, string>;
    fieldLabelMap?: Record<string, string>;
    messages?: unknown[];
  };
  const fieldPathMap = structured.fieldPathMap ?? {};

  const tbmDateInputId = Object.entries(fieldPathMap).find(([, key]) => key === "tbmDate")?.[0];
  const todayWorkInputId = Object.entries(fieldPathMap).find(([, key]) => key === "todayWork")?.[0];
  assert(tbmDateInputId, "tbmDate input id must be present in fieldPathMap");
  assert(todayWorkInputId, "todayWork input id must be present in fieldPathMap");
  assert(structured.fieldLabelMap?.todayWork === "오늘의 작업", "fieldLabelMap must keep Korean label");

  const legacyDraft = {
    [tbmDateInputId as string]: TBM_DATE,
    [todayWorkInputId as string]: TODAY_WORK,
    _a2uiFieldPathMap: fieldPathMap,
  };
  const legacyGenerated = await callTool("generate_safety_document", {
    docId: DOC_ID,
    useProfile: false,
    draft: legacyDraft,
  });
  const legacyText = textOf(legacyGenerated);
  assert(legacyText.includes("2026-05-04"), "legacy A2UI component id draft must preserve TBM date");
  assert(legacyText.includes(TODAY_WORK), "legacy A2UI component id draft must preserve todayWork");

  const canonicalGenerated = await callTool("generate_safety_document", {
    docId: DOC_ID,
    useProfile: false,
    draft: {
      tbmDate: TBM_DATE,
      todayWork: TODAY_WORK,
    },
  });
  const canonicalText = textOf(canonicalGenerated);
  assert(canonicalText.includes("2026-05-04"), "canonical field-key draft must preserve TBM date");
  assert(canonicalText.includes(TODAY_WORK), "canonical field-key draft must preserve todayWork");

  const submitted = await callTool("submit_safety_document", {
    docId: DOC_ID,
    useProfile: false,
    archive: false,
    draft: {
      tbmDate: TBM_DATE,
      todayWork: TODAY_WORK,
    },
  });
  const submittedText = textOf(submitted);
  assert(submittedText.includes("2026-05-04"), "submit_safety_document must preserve TBM date");
  assert(submittedText.includes(TODAY_WORK), "submit_safety_document must preserve todayWork");

  const htmlArchive = formatGeneratedDocumentForArchive({
    docId: DOC_ID,
    markdown: ARCHIVE_PROBE_MARKDOWN,
    format: "html",
  });
  assert(htmlArchive.startsWith("<!DOCTYPE html>"), "HTML archive must be a complete HTML document");
  assert(htmlArchive.includes("&lt;script&gt;"), "HTML archive must escape Markdown content");
  assert(!htmlArchive.includes("<script>alert"), "HTML archive must not embed raw script tags");

  const jsonArchive = formatGeneratedDocumentForArchive({
    docId: DOC_ID,
    markdown: ARCHIVE_PROBE_MARKDOWN,
    format: "json",
    generatedStructuredContent: { docId: DOC_ID, bodyMarkdownLength: ARCHIVE_PROBE_MARKDOWN.length },
  });
  const parsedJsonArchive = JSON.parse(jsonArchive) as {
    docId?: string;
    sourceFormat?: string;
    markdown?: string;
    generated?: { bodyMarkdownLength?: number };
  };
  assert(parsedJsonArchive.docId === DOC_ID, "JSON archive must preserve docId");
  assert(parsedJsonArchive.sourceFormat === "markdown", "JSON archive must declare Markdown source");
  assert(parsedJsonArchive.markdown === ARCHIVE_PROBE_MARKDOWN, "JSON archive must preserve Markdown body");
  assert(
    parsedJsonArchive.generated?.bodyMarkdownLength === ARCHIVE_PROBE_MARKDOWN.length,
    "JSON archive must preserve generated metadata",
  );

  console.log(JSON.stringify({
    ok: true,
    docId: DOC_ID,
    mappedFields: Object.keys(fieldPathMap).length,
    legacyInputPreserved: true,
    canonicalInputPreserved: true,
    submitToolRegistered: true,
    archiveFormatConversion: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
