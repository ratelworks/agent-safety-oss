// 파일 최상단 상수 — 내장 공식 양식 132 formId (HWP 14 / PDF 23 / XLSX 1 / md 94, forms-map.json SSoT) 직접 반환
// 사용자가 별도 다운로드 없이 즉시 활용 가능. 공공누리 출처 표시.
import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// build/ontology/forms 에서 양식 로드 (build 시 src/ontology/forms 가 복사됨)
const FORMS_DIR = resolve(__dirname, "..", "ontology", "forms");

interface FormMeta {
  formId: string;
  docId: string;
  title: string;
  officialName: string;
  filename: string;
  format: "hwp" | "hwpx" | "pdf" | "xlsx" | "md";
  size_bytes: number;
  source: string;
  sourceUrl: string;
  originalDownloadUrl: string;
  license: string;
}

interface FormsMap {
  _meta: { version: string; compiled: string; license: string; description: string; sources: string[] };
  forms: FormMeta[];
}

let cachedMap: FormsMap | null = null;
function loadFormsMap(): FormsMap {
  if (cachedMap) return cachedMap;
  const path = resolve(FORMS_DIR, "forms-map.json");
  cachedMap = JSON.parse(readFileSync(path, "utf8")) as FormsMap;
  return cachedMap;
}

const inputSchema = z.object({
  formId: z
    .string()
    .optional()
    .describe(
      "받을 양식의 formId (예: 'annex30_industrial_accident_report'). 미입력 시 전체 양식 목록 반환.",
    ),
  docId: z
    .string()
    .optional()
    .describe(
      "MCP docId 로 양식 검색 (예: 'industrial_accident_report'). 해당 docId 의 모든 양식 반환.",
    ),
  format: z
    .enum(["hwp", "hwpx", "pdf", "xlsx", "md"])
    .optional()
    .describe("형식 필터 (hwp / hwpx / pdf / xlsx / md). md 는 forms/auto/ 자동 생성 양식."),
  encoding: z
    .enum(["base64", "path", "list_only"])
    .default("path")
    .describe(
      "응답 형식: 'path' = 파일 경로만 반환 (사용자가 직접 읽음, 기본값) / 'base64' = 본문 base64 인코딩 / 'list_only' = 메타만 (본문 X)",
    ),
});

type Input = z.infer<typeof inputSchema>;

function formatList(forms: FormMeta[]): string {
  const lines = ["# 내장 공식 안전관리 양식 (License: 공공누리)\n"];
  for (const f of forms) {
    lines.push(`## ${f.title}`);
    lines.push(`- **formId**: \`${f.formId}\``);
    lines.push(`- **docId**: \`${f.docId}\` (MCP 노드)`);
    lines.push(`- **공식 명**: ${f.officialName}`);
    lines.push(`- **파일**: \`${f.filename}\` (${f.format.toUpperCase()}, ${(f.size_bytes / 1024).toFixed(1)}KB)`);
    lines.push(`- **출처**: ${f.source}`);
    lines.push(`- **다운로드 URL**: ${f.sourceUrl}`);
    lines.push(`- **라이선스**: ${f.license}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const { forms, _meta } = loadFormsMap();

  // 1. 필터링
  let filtered = forms;
  if (input.formId) {
    filtered = filtered.filter((f) => f.formId === input.formId);
    if (filtered.length === 0) {
      const available = forms.map((f) => f.formId).join("\n  - ");
      return {
        content: [
          {
            type: "text",
            text: `[NOT_FOUND] formId='${input.formId}' 양식 없음.\n\n사용 가능 formId:\n  - ${available}`,
          },
        ],
        structuredContent: { error: "form_not_found", formId: input.formId, availableFormIds: forms.map((f) => f.formId) },
        isError: true,
      } as McpToolResult;
    }
  }
  if (input.docId) {
    filtered = filtered.filter((f) => f.docId === input.docId);
  }
  if (input.format) {
    filtered = filtered.filter((f) => f.format === input.format);
  }

  // 2. 응답 구성
  // 목록 반환 조건: list_only 명시 OR (formId 미지정 AND 매칭 결과 != 1개)
  const shouldReturnList =
    input.encoding === "list_only" ||
    (!input.formId && filtered.length !== 1);
  if (shouldReturnList) {
    return {
      content: [{ type: "text", text: formatList(filtered) }],
      structuredContent: {
        meta: _meta,
        count: filtered.length,
        forms: filtered,
      },
    };
  }

  // 3. 단일 양식 (formId 지정 또는 docId 매칭 결과 1개) — path 또는 base64
  const f = filtered[0];
  const filePath = resolve(FORMS_DIR, f.filename);

  if (input.encoding === "path") {
    return {
      content: [
        {
          type: "text",
          text: `# ${f.title}\n\n**파일 경로**: \`${filePath}\`\n\n## 출처 표기 (필수)\n${f.source}\n\n원본 다운로드: ${f.sourceUrl}\n라이선스: ${f.license}\n\n사용자가 위 경로의 파일을 직접 읽어 사용. 다른 응용 사용 시 출처 표기 의무.`,
        },
      ],
      structuredContent: {
        formId: f.formId,
        docId: f.docId,
        title: f.title,
        officialName: f.officialName,
        filePath,
        format: f.format,
        size_bytes: f.size_bytes,
        source: f.source,
        sourceUrl: f.sourceUrl,
        license: f.license,
      },
    };
  }

  // 4. base64 인코딩
  const buffer = readFileSync(filePath);
  const base64 = buffer.toString("base64");

  return {
    content: [
      {
        type: "text",
        text: `# ${f.title}\n\n${f.format.toUpperCase()} 본문 (base64, ${(f.size_bytes / 1024).toFixed(1)}KB)\n\n## 출처\n${f.source} — ${f.sourceUrl}\n라이선스: ${f.license}\n\n클라이언트는 base64 디코딩 후 \`${f.filename}\` 으로 저장하여 사용.`,
      },
    ],
    structuredContent: {
      formId: f.formId,
      docId: f.docId,
      title: f.title,
      filename: f.filename,
      format: f.format,
      size_bytes: f.size_bytes,
      base64,
      source: f.source,
      sourceUrl: f.sourceUrl,
      license: f.license,
    },
  };
}

export const getOfficialFormTool: ToolDefinition = {
  name: "get_official_form",
  title: "내장 공식 안전관리 양식 (HWP·PDF·XLSX)",
  description:
    "본 MCP 에 내장된 공식 안전관리 양식 132 formId 를 반환한다 (forms-map.json SSoT — HWP 14 / PDF 23 / XLSX 1 / md 94). 산재조사표 별지 30호·선임 보고서(일반·건설업)·보호구 지급대장·KOSHA TBM·안전보건교육일지(XLSX/HWP)·작업환경측정 결과보고서·결과표(별지 82·83호)·산안법시행령 PDF 등 + 자동 생성 .md 94 (legal-duty-master 94 docId 1대1 매핑). 사용자는 다운로드 없이 즉시 활용 가능 (공공누리 라이선스). formId/docId/format(hwp|hwpx|pdf|xlsx|md) 필터 지원, encoding=path(기본)·base64·list_only.",
  inputSchema,
  handler,
};
