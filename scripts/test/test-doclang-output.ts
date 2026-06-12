#!/usr/bin/env tsx
/**
 * DocLang 출력 포맷 회귀 테스트.
 *
 * 의존성 추가 없이 현 repo의 tsx 테스트 패턴으로 실행한다.
 */
import { XMLParser } from "fast-xml-parser";
import { TOOLS } from "../../src/tool-registry.js";
import type { McpToolResult } from "../../src/lib/types.js";
import type { DocumentNode } from "../../src/lib/graph-nodes-loader.js";
import {
  DOCLANG_VERSION,
  serializeSafetyDocumentToDoclang,
  tableToOtsl,
} from "../../src/lib/doclang-serializer.js";

const DOC_ID = "daily_tbm";
const TEST_DRAFT = {
  tbmDate: "2026-05-04T07:30",
  todayWork: "A동 굴착 & 양중 <테스트>",
  siteName: "테스트 현장",
  supervisor: "테스트 책임자",
};
const XML_PARSER = new XMLParser({ ignoreAttributes: false });

function requireTool(name: string) {
  const tool = TOOLS.find((candidate) => candidate.name === name);
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

function parseXml(xml: string): Record<string, unknown> {
  return XML_PARSER.parse(xml) as Record<string, unknown>;
}

function testOtslMergedGrid(): void {
  const xml = tableToOtsl({
    hasHeader: true,
    rows: [
      [
        { text: "열1", isHeader: true },
        { text: "열2-3", isHeader: true, colSpan: 2 },
        {},
      ],
      [
        { text: "행병합", rowSpan: 2 },
        { text: "양방향", rowSpan: 2, colSpan: 2 },
        {},
      ],
      [{}, {}, {}],
    ],
  });

  assert(xml.includes("<ched/>열2-3"), "column header must use ched token");
  assert(xml.includes("<lcel/>"), "colSpan covered cell must use lcel token");
  assert(xml.includes("<ucel/>"), "rowSpan covered cell must use ucel token");
  assert(xml.includes("<xcel/>"), "rowSpan+colSpan covered cell must use xcel token");
  assert(xml.includes("<nl/>"), "table rows must end with nl token");
}

function testSerializerStructure(): void {
  const document: DocumentNode = {
    "@id": "doc:test_doclang",
    "@type": "Document",
    docId: "test_doclang",
    title: "테스트 & <문서>",
    description: "설명 & <검증>",
    cycle: "test",
    requiredFields: [
      { key: "filledField", label: "작성 <필드>", source: "test" },
      { key: "emptyField", label: "미작성 <필드>", source: "test" },
    ],
    reviewRules: [],
    sections: [
      {
        title: "섹션 & <A>",
        legalSource: "산안법 & 기준",
        fields: [
          { key: "filledField", label: "작성 <필드>", required: true },
          { key: "emptyField", label: "미작성 <필드>", required: true },
        ],
      },
    ],
    legalBasis: ["art:test:<basis>&1"],
    retention: "3년 & 보관",
  };

  const xml = serializeSafetyDocumentToDoclang({
    document,
    draft: { filledField: "A & B <C> \"D\"" },
    sections: document.sections ?? [],
    kosha: [],
    hazards: [],
    controls: [],
    directControlIris: new Set(),
    legalBodyByIri: new Map(),
    hazardFallbackSuppressed: false,
    documentCategory: "test_category",
    missingRequiredCount: 1,
  });

  assert(xml.startsWith(`<doclang version="${DOCLANG_VERSION}">`), "root must pin DocLang version");
  assert(xml.includes("<head>"), "metadata head must exist");
  assert(xml.includes("<title>테스트 &amp; &lt;문서&gt;</title>"), "head/title must be XML escaped");
  assert(!/<doclang[^>]*>\s*<custom>/.test(xml), "root-level custom must not be emitted");
  assert(xml.includes("<heading level=\"1\"><custom>"), "domain custom must live inside an element");
  assert(xml.includes("<doc_id>test_doclang</doc_id>"), "docId custom metadata must be present");
  assert(
    xml.includes("<legal_basis><iri>art:test:&lt;basis&gt;&amp;1</iri></legal_basis>"),
    "legal basis IRI must be stored in element-level custom",
  );
  assert(xml.includes("<field_region>"), "fillable field region must be emitted");
  assert(
    xml.includes("<field_item><key>미작성 &lt;필드&gt;</key><value class=\"fillable\"></value></field_item>"),
    "missing input must be represented as fillable value",
  );
  assert(xml.includes("A &amp; B &lt;C&gt; &quot;D&quot;"), "field value must be XML escaped");
  assert(parseXml(xml).doclang, "DocLang XML must parse");
}

async function testGenerateSafetyDocumentIntegration(): Promise<void> {
  const defaultMd = await callTool("generate_safety_document", {
    docId: DOC_ID,
    useProfile: false,
    draft: TEST_DRAFT,
  });
  const explicitMd = await callTool("generate_safety_document", {
    docId: DOC_ID,
    useProfile: false,
    format: "md",
    draft: TEST_DRAFT,
  });
  const doclang = await callTool("generate_safety_document", {
    docId: DOC_ID,
    useProfile: false,
    format: "doclang",
    draft: TEST_DRAFT,
  });

  assert(textOf(defaultMd) === textOf(explicitMd), "omitted format must keep existing md output");
  assert(textOf(doclang).startsWith(`<doclang version="${DOCLANG_VERSION}">`), "doclang format must return XML");
  assert(textOf(doclang).includes("<field_region>"), "doclang output must include field_region");
  assert(textOf(doclang).includes("<custom>"), "doclang output must preserve element-level custom metadata");
  assert(textOf(doclang).includes("A동 굴착 &amp; 양중 &lt;테스트&gt;"), "doclang output must escape draft values");
  assert(parseXml(textOf(doclang)).doclang, "generated DocLang XML must parse");

  const mdStructured = explicitMd.structuredContent ?? {};
  const doclangStructured = doclang.structuredContent ?? {};
  for (const key of ["docId", "title", "koshaGuideCount", "hazardCount", "controlCount", "sectionsCount", "legalBasisCount", "bodyMarkdownLength"]) {
    assert(
      mdStructured[key] === doclangStructured[key],
      `structuredContent.${key} must stay identical across formats`,
    );
  }
}

async function main(): Promise<void> {
  testOtslMergedGrid();
  testSerializerStructure();
  await testGenerateSafetyDocumentIntegration();
  console.log(JSON.stringify({
    ok: true,
    version: DOCLANG_VERSION,
    otslMergedGrid: true,
    serializerStructure: true,
    generateSafetyDocumentIntegration: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
