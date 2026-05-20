/**
 * export_drafted_document
 *
 * generate_safety_document 또는 사용자가 작성한 draft 를 표현 포맷(html/markdown)으로
 * 결정론적 변환. 의존성 0 — Node 표준 라이브러리만 사용. PDF/HWPX 는 외부 도구로 위임.
 *
 * docs/LEGAL-DUTY-LIFECYCLE.md §1.2 작성 + §1.4 결재 (서명·결재선 포함 표현).
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { findDoc } from "../lib/master-loader.js";
import { escapeHtml } from "../lib/html-escape.js";

const inputSchema = z.object({
  docId: z.string().describe("법정문서 docId (제목·메타 자동 보강용)"),
  draft: z.record(z.unknown()).describe("작성된 draft (key: value). generate_safety_document 의 출력 그대로 가능"),
  format: z.enum(["html", "markdown"]).default("html").describe("출력 포맷 (PDF/HWPX 는 외부 도구 위임)"),
  includeApprovalChain: z.boolean().default(true).describe("결재선 표시 (draft.approvalChain)"),
});

type Input = z.infer<typeof inputSchema>;

function valueToString(v: unknown): string {
  if (v === null || v === undefined) return "(미입력)";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => valueToString(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function renderMarkdown(args: Input): string {
  const doc = findDoc(args.docId);
  const lines: string[] = [];
  lines.push(`# ${doc?.title ?? args.docId}`);
  lines.push("");
  if (doc?.purpose) {
    lines.push(`> ${doc.purpose}`);
    lines.push("");
  }
  lines.push(`**docId**: \`${args.docId}\``);
  if (doc) {
    lines.push(`**법령근거**: ${doc.legalRef.join(", ")}`);
    if (doc.submitTo) lines.push(`**제출처**: ${doc.submitTo}`);
    if (doc.retention) lines.push(`**보관**: ${doc.retention}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // 본문 (approvalChain 제외하고 출력)
  for (const [key, value] of Object.entries(args.draft)) {
    if (key === "approvalChain") continue;
    if (key.startsWith("_")) continue;
    lines.push(`## ${key}`);
    lines.push("");
    lines.push(valueToString(value));
    lines.push("");
  }

  // 결재선
  if (args.includeApprovalChain && Array.isArray(args.draft.approvalChain)) {
    lines.push("---");
    lines.push("");
    lines.push("## 결재선");
    lines.push("");
    lines.push("| 역할 | 성명 | 직책 | 서명 | 일자 |");
    lines.push("|------|------|------|------|------|");
    for (const row of args.draft.approvalChain as any[]) {
      lines.push(`| ${row.role ?? ""} | ${row.name ?? ""} | ${row.title ?? ""} | ${row.signed ? "✅ 서명" : "(미서명)"} | ${row.date ?? ""} |`);
    }
  }
  return lines.join("\n");
}

function renderHtml(args: Input): string {
  const doc = findDoc(args.docId);
  const css = `
<style>
  body { font-family: 'Malgun Gothic', sans-serif; max-width: 880px; margin: 2rem auto; padding: 1rem; line-height: 1.6; color: #1a1a1a; }
  h1 { border-bottom: 2px solid #1a1a1a; padding-bottom: .5rem; }
  h2 { margin-top: 1.5rem; color: #333; border-left: 4px solid #1a1a1a; padding-left: .6rem; }
  .meta { background: #f5f5f5; border-left: 3px solid #888; padding: .8rem 1rem; font-size: .9rem; margin: 1rem 0; }
  .meta strong { color: #555; }
  .field { margin: .8rem 0; padding: .6rem .8rem; background: #fafafa; border-left: 2px solid #ddd; }
  .field-key { font-weight: 600; color: #555; }
  .field-value { white-space: pre-wrap; margin-top: .3rem; }
  .approval { margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: .5rem .8rem; text-align: left; }
  th { background: #f0f0f0; }
  .signed { color: #0a0; font-weight: 600; }
  .unsigned { color: #888; font-style: italic; }
  .footer { margin-top: 3rem; font-size: .8rem; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 1rem; }
</style>
`.trim();

  const meta: string[] = [];
  meta.push(`<strong>docId:</strong> <code>${escapeHtml(args.docId)}</code>`);
  if (doc) {
    meta.push(`<strong>법령근거:</strong> ${escapeHtml(doc.legalRef.join(", "))}`);
    if (doc.submitTo) meta.push(`<strong>제출처:</strong> ${escapeHtml(doc.submitTo)}`);
    if (doc.retention) meta.push(`<strong>보관:</strong> ${escapeHtml(doc.retention)}`);
    if (doc.purpose) meta.push(`<strong>목적:</strong> ${escapeHtml(doc.purpose)}`);
  }

  const fields: string[] = [];
  for (const [key, value] of Object.entries(args.draft)) {
    if (key === "approvalChain") continue;
    if (key.startsWith("_")) continue;
    fields.push(
      `<div class="field"><div class="field-key">${escapeHtml(key)}</div><div class="field-value">${escapeHtml(valueToString(value))}</div></div>`,
    );
  }

  let approvalHtml = "";
  if (args.includeApprovalChain && Array.isArray(args.draft.approvalChain)) {
    const rows = (args.draft.approvalChain as any[])
      .map(
        (r) => `<tr><td>${escapeHtml(r.role ?? "")}</td><td>${escapeHtml(r.name ?? "")}</td><td>${escapeHtml(r.title ?? "")}</td><td class="${r.signed ? "signed" : "unsigned"}">${r.signed ? "✅ 서명" : "(미서명)"}</td><td>${escapeHtml(r.date ?? "")}</td></tr>`,
      )
      .join("\n");
    approvalHtml = `
<div class="approval">
  <h2>결재선</h2>
  <table>
    <thead><tr><th>역할</th><th>성명</th><th>직책</th><th>서명</th><th>일자</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
`;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(doc?.title ?? args.docId)}</title>
${css}
</head>
<body>
<h1>${escapeHtml(doc?.title ?? args.docId)}</h1>
<div class="meta">${meta.join(" · ")}</div>
${fields.join("\n")}
${approvalHtml}
<div class="footer">agent-safety-oss · 황룡건설(주) 제공 · ㈜라텔웍스 개발</div>
</body>
</html>`;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);
  const output = args.format === "html" ? renderHtml(args) : renderMarkdown(args);
  return {
    content: [{ type: "text", text: output }],
    structuredContent: {
      docId: args.docId,
      format: args.format,
      length: output.length,
      title: findDoc(args.docId)?.title ?? args.docId,
      nextActions: [
        "HTML 결과를 브라우저로 열어 인쇄 → PDF 변환 가능",
        "HWPX 변환은 별도 dev/oss/Agent_HWPX 또는 한글 직접 사용",
        `\`get_retention_status({docId: \"${args.docId}\", compileDate: \"YYYY-MM-DD\"})\` 로 보관·갱신 추적`,
      ],
    },
  };
}

export const exportDraftedDocumentTool: ToolDefinition = {
  name: "export_drafted_document",
  title: "작성문서 출력 (HTML / Markdown)",
  description:
    "draft 를 표현 포맷(html/markdown)으로 결정론적 변환. 결재선·메타·법령근거 자동 포함. 의존성 0 (Node 표준만). PDF 는 HTML → 브라우저 인쇄. HWPX 는 Agent_HWPX 별도.",
  inputSchema,
  handler,
};
