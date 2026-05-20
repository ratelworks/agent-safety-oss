/**
 * list_downloadable_forms
 *
 * 132종 양식(공식 hwp/pdf/xlsx 38 + 자동생성 .md 94)을 카테고리·포맷·docId 기준으로 인덱스 제공.
 * docs/LEGAL-DUTY-LIFECYCLE.md §1.2 작성 단계의 양식 진입점.
 *
 * get_official_form 은 docId 단일 조회. 이 도구는 전체 인덱스·필터.
 */
import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { loadMaster } from "../lib/master-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORMS_PATH = (() => {
  const candidates = [
    resolve(__dirname, "../ontology/forms/forms-map.json"),
    resolve(__dirname, "../../src/ontology/forms/forms-map.json"),
  ];
  for (const p of candidates) {
    try { readFileSync(p, "utf8"); return p; } catch {}
  }
  throw new Error("forms-map.json not found");
})();

interface FormMeta {
  formId: string;
  docId: string;
  title: string;
  officialName: string;
  filename: string;
  format: string;
  size_bytes: number;
  source: string;
  sourceUrl: string;
  originalDownloadUrl: string;
  license: string;
}

interface FormsMap {
  _meta: Record<string, unknown>;
  forms: FormMeta[];
}

let formsCache: FormsMap | null = null;
function loadForms(): FormsMap {
  if (!formsCache) formsCache = JSON.parse(readFileSync(FORMS_PATH, "utf8"));
  return formsCache!;
}

const inputSchema = z.object({
  format: z.enum(["all", "hwp", "hwpx", "pdf", "xlsx", "md", "official", "autonomous"]).default("all").describe(
    "official=공식 양식(hwp/pdf/xlsx) / autonomous=자율 양식(md) / all=전체",
  ),
  category: z.string().optional().describe("마스터 SSoT 카테고리 (예: K_사고)"),
  query: z.string().optional().describe("docId 또는 title 부분일치"),
});


async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);
  const forms = loadForms().forms;
  const master = loadMaster().documents;
  const docIdToCat = new Map(master.map((d) => [d.docId, d.category] as const));

  let filtered = forms;
  if (args.format !== "all") {
    if (args.format === "official") filtered = filtered.filter((f) => ["hwp", "hwpx", "pdf", "xlsx"].includes(f.format));
    else if (args.format === "autonomous") filtered = filtered.filter((f) => f.format === "md");
    else filtered = filtered.filter((f) => f.format === args.format);
  }
  if (args.category) {
    filtered = filtered.filter((f) => docIdToCat.get(f.docId) === args.category);
  }
  if (args.query) {
    const q = args.query.toLowerCase();
    filtered = filtered.filter((f) =>
      f.docId.toLowerCase().includes(q) ||
      f.title.toLowerCase().includes(q) ||
      f.officialName.toLowerCase().includes(q),
    );
  }

  const byCategory: Record<string, FormMeta[]> = {};
  for (const f of filtered) {
    const cat = docIdToCat.get(f.docId) ?? "(분류 없음)";
    (byCategory[cat] ??= []).push(f);
  }

  const lines: string[] = [];
  lines.push(`# 다운로드 가능 양식 ${filtered.length}건`);
  lines.push("");
  lines.push(`**필터**: format=${args.format}${args.category ? ` / category=${args.category}` : ""}${args.query ? ` / query="${args.query}"` : ""}`);
  lines.push(`**전체 인벤토리**: 132종 (hwp 14 / pdf 23 / xlsx 1 / md 94)`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const [cat, items] of Object.entries(byCategory).sort()) {
    lines.push(`## ${cat} (${items.length}건)`);
    lines.push("");
    for (const f of items) {
      const formatBadge = f.format === "hwp" ? "📄 HWP" : f.format === "pdf" ? "📕 PDF" : f.format === "xlsx" ? "📊 XLSX" : f.format === "md" ? "📝 MD" : `[${f.format}]`;
      lines.push(`- ${formatBadge} **${f.title}** — \`${f.docId}\``);
      lines.push(`  - 파일: ${f.filename} (${(f.size_bytes / 1024).toFixed(0)} KB)`);
      lines.push(`  - 출처: ${f.source}`);
    }
    lines.push("");
  }

  if (filtered.length === 0) {
    lines.push("*조건 매칭 없음. format/category/query 를 조정하세요.*");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      total: filtered.length,
      counts: {
        official: filtered.filter((f) => ["hwp", "hwpx", "pdf", "xlsx"].includes(f.format)).length,
        autonomous: filtered.filter((f) => f.format === "md").length,
      },
      forms: filtered.map((f) => ({
        formId: f.formId,
        docId: f.docId,
        title: f.title,
        format: f.format,
        category: docIdToCat.get(f.docId) ?? null,
        sourceUrl: f.sourceUrl,
        originalDownloadUrl: f.originalDownloadUrl,
      })),
      nextActions: [
        "특정 양식 다운로드는 `get_official_form({docId: \"<docId>\"})` — 본 OSS 내장 본문 즉시 반환",
        "양식 작성은 `generate_safety_document({docId, useProfile: true})`",
      ],
    },
  };
}

export const listDownloadableFormsTool: ToolDefinition = {
  name: "list_downloadable_forms",
  title: "다운로드 가능 양식 목록",
  description:
    "132종 양식(공식 hwp/pdf/xlsx 38 + 자동생성 .md 94)을 format·category·query 로 필터·인덱스. 라이프사이클 §1.2 작성 단계의 양식 진입점. 단일 양식 본문은 get_official_form 도구 사용.",
  inputSchema,
  handler,
};
