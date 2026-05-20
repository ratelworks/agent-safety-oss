/**
 * local-storage-tools.ts
 *
 * 로컬 저장소(~/.agent-safety-oss/) 관리 도구 5개:
 *   - save_form_draft        — 작성 중 폼 데이터 저장 (autosave 포함)
 *   - load_form_draft        — 저장된 초안 복원
 *   - list_form_drafts       — 작성 중인 모든 docId 목록
 *   - archive_safety_document — 완성 본문 영구 보관
 *   - get_storage_stats      — 저장소 상태 진단
 */
import { z } from "zod";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  saveDraft,
  loadDraft,
  listDrafts,
  deleteDraft,
  archiveDocument,
  listArchivedDocuments,
  getStorageStats,
  STORAGE_ROOT,
} from "../lib/local-storage.js";

// === 정규화 보조 — A2UI viewer 와 동일한 input type 추론·정규화 ===
const __dirname_ls = dirname(fileURLToPath(import.meta.url));
const NODES_DIR_LS = (() => {
  const candidates = [
    resolve(__dirname_ls, "../ontology/graph/nodes/documents"),
    resolve(__dirname_ls, "../../src/ontology/graph/nodes/documents"),
  ];
  for (const p of candidates) try { readdirSync(p); return p; } catch {}
  return "";
})();

function classifyByLabel(label: string): "date" | "datetime" | "time" | "number" | "text" {
  const L = (label || "").trim();
  if (/일시|datetime|시점/.test(L)) return "datetime";
  if (/일자|날짜|date|시작일|종료일|작성일|점검일|평가\s*시기|평가\s*실시일|발생일|체결일|만기일|만료일|승인일|등록일|배치일|채용일|선임일|발급일|기준일|결재일|마감일|개최일|준공일/.test(L)) return "date";
  if (/^시각$|^시간$/.test(L) || /시각$/.test(L)) return "time";
  if (/(근로자|작업자|인원|투입\s*인원)\s*수|건수|일수|개수|수량|금액|예산|점수|총점|총액|도급금액|공사금액/.test(L)) return "number";
  return "text";
}

interface FieldMeta { id: string; key: string; label: string; type: string }

function loadFormFieldMeta(docId: string): FieldMeta[] {
  if (!NODES_DIR_LS) return [];
  for (const f of readdirSync(NODES_DIR_LS)) {
    if (!f.endsWith(".jsonld")) continue;
    try {
      const n = JSON.parse(readFileSync(join(NODES_DIR_LS, f), "utf8"));
      if (n.docId !== docId) continue;
      const out: FieldMeta[] = [];
      let idx = 0;
      const push = (key: string, label: string): void => {
        if (!key || !label) return;
        out.push({ id: `field-${idx}-input`, key, label, type: classifyByLabel(label) });
        idx++;
      };
      let pushed = 0;
      if (Array.isArray(n.sections)) {
        for (const sec of n.sections) {
          for (const fld of (sec?.fields || [])) {
            if (fld?.key && fld?.label) {
              push(fld.key, fld.label);
              pushed++;
            }
          }
        }
      }
      if (pushed === 0 && Array.isArray(n.requiredFields)) {
        for (const fld of n.requiredFields) if (fld?.key && fld?.label) push(fld.key, fld.label);
      }
      return out;
    } catch {}
  }
  return [];
}

function normalizeValue(raw: string, type: string): string {
  const v = String(raw == null ? "" : raw).trim();
  if (v === "") return "";
  if (type === "date") {
    const m = v.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    return m ? m[1] : v;
  }
  if (type === "datetime") {
    const m = v.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})[T ]?([0-9]{2}:[0-9]{2})?/);
    return m ? (m[2] ? m[1] + "T" + m[2] : m[1] + "T00:00") : v;
  }
  if (type === "time") {
    const m = v.match(/([0-9]{2}:[0-9]{2})/);
    return m ? m[1] : v;
  }
  if (type === "number") {
    const m = v.match(/-?[0-9]+(?:\.[0-9]+)?/);
    return m ? m[0] : v;
  }
  return v;
}

function normalizeByDocId(docId: string, formValues: Record<string, string>): { normalized: Record<string, string>; report: Array<{ id: string; label: string; type: string; before: string; after: string }> } {
  const meta = loadFormFieldMeta(docId);
  const typeByInputKey = new Map<string, string>();
  const labelByInputKey = new Map<string, string>();
  const canonicalKeyByInputKey = new Map<string, string>();
  for (const m of meta) {
    typeByInputKey.set(m.id, m.type);
    typeByInputKey.set(m.key, m.type);
    labelByInputKey.set(m.id, m.label);
    labelByInputKey.set(m.key, m.label);
    canonicalKeyByInputKey.set(m.id, m.key);
    canonicalKeyByInputKey.set(m.key, m.key);
  }
  const out: Record<string, string> = {};
  const report: Array<{ id: string; label: string; type: string; before: string; after: string }> = [];
  for (const [id, raw] of Object.entries(formValues)) {
    const targetKey = canonicalKeyByInputKey.get(id) ?? id;
    const t = typeByInputKey.get(id) ?? "text";
    const after = normalizeValue(raw, t);
    out[targetKey] = after;
    if (after !== raw && t !== "text") {
      report.push({ id: targetKey, label: labelByInputKey.get(id) ?? "", type: t, before: String(raw), after });
    }
  }
  return { normalized: out, report };
}

// === 1. save_form_draft ===
const saveDraftSchema = z.object({
  docId: z.string().regex(/^[a-z][a-z0-9_-]*$/i, "docId — 영숫자·_·- 만"),
  formValues: z.record(z.string()).describe("폼 입력값 — key:value (빈 값도 보존)"),
  autosave: z.boolean().default(false).describe("true=자동저장 (5초 debounce 등) / false=사용자 명시 저장"),
});

async function saveDraftHandler(input: unknown): Promise<McpToolResult> {
  const args = saveDraftSchema.parse(input);
  // 정규화 — A2UI viewer 와 동일한 룰
  const { normalized, report } = normalizeByDocId(args.docId, args.formValues);
  const draft = await saveDraft(args.docId, normalized, args.autosave);
  const lines: string[] = [];
  lines.push(`# 폼 초안 ${args.autosave ? "자동" : "수동"} 저장 완료`);
  lines.push("");
  lines.push(`- **docId**: \`${draft.docId}\``);
  lines.push(`- **저장 위치**: \`~/.agent-safety-oss/drafts/${draft.docId}.jsonld\``);
  lines.push(`- **필드 수**: ${Object.keys(draft.formValues).length}`);
  lines.push(`- **최종 수정**: ${draft.updatedAt}`);
  if (draft.manualSavedAt) lines.push(`- **마지막 수동 저장**: ${draft.manualSavedAt}`);
  if (report.length > 0) {
    lines.push("");
    lines.push("## 자동 정규화 (A2UI input 표준)");
    lines.push("");
    for (const r of report.slice(0, 8)) {
      lines.push(`- ${r.label} [${r.type}]: \`${r.before}\` → \`${r.after}\``);
    }
    if (report.length > 8) lines.push(`- ... 외 ${report.length - 8}건`);
  }
  lines.push("");
  lines.push(`다음 단계:`);
  lines.push(`- 폼 재방문 시 \`load_form_draft({docId: "${draft.docId}"})\` 로 복원`);
  lines.push(`- 작성 완료 시 \`generate_safety_document({docId: "${draft.docId}", draft: formValues})\` → \`archive_safety_document\``);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      docId: draft.docId,
      fieldCount: Object.keys(draft.formValues).length,
      updatedAt: draft.updatedAt,
      autosave: draft.autosave,
      path: `${STORAGE_ROOT}/drafts/${draft.docId}.jsonld`,
      normalizationReport: report,
    },
  };
}

// === 2. load_form_draft ===
const loadDraftSchema = z.object({
  docId: z.string(),
});

async function loadDraftHandler(input: unknown): Promise<McpToolResult> {
  const { docId } = loadDraftSchema.parse(input);
  const draft = await loadDraft(docId);
  if (!draft) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] docId="${docId}" 초안 없음. save_form_draft 로 생성 가능.` }],
      structuredContent: { docId, found: false },
    };
  }
  return {
    content: [
      {
        type: "text",
        text: `# 초안 복원\n\n- docId: \`${docId}\`\n- 필드: ${Object.keys(draft.formValues).length}\n- 최종 수정: ${draft.updatedAt}\n- 자동저장 only: ${!draft.manualSavedAt}\n`,
      },
    ],
    structuredContent: {
      found: true,
      ...draft,
    },
  };
}

// === 3. list_form_drafts ===
async function listDraftsHandler(): Promise<McpToolResult> {
  const drafts = await listDrafts();
  const lines: string[] = [];
  lines.push(`# 작성 중인 초안 ${drafts.length}건`);
  lines.push("");
  if (drafts.length === 0) {
    lines.push("*저장된 초안 없음.*");
  } else {
    lines.push("| docId | 필드 | 최종 수정 | 마지막 수동 저장 |");
    lines.push("|---|---:|---|---|");
    for (const d of drafts) {
      lines.push(
        `| \`${d.docId}\` | ${d.fieldCount} | ${d.updatedAt} | ${d.manualSavedAt ?? "(자동저장만)"} |`,
      );
    }
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { drafts, count: drafts.length },
  };
}

// === 4. archive_safety_document ===
const archiveSchema = z.object({
  docId: z.string().regex(/^[a-z][a-z0-9_-]*$/i),
  content: z.string().min(10).describe("완성된 문서 본문 (HTML/Markdown/JSON)"),
  format: z.enum(["html", "markdown", "json"]).default("html"),
  /** 보관 후 draft 삭제 여부 */
  cleanupDraft: z.boolean().default(false),
});

async function archiveHandler(input: unknown): Promise<McpToolResult> {
  const args = archiveSchema.parse(input);
  const meta = await archiveDocument(args.docId, args.content, args.format);
  let draftDeleted = false;
  if (args.cleanupDraft) {
    draftDeleted = await deleteDraft(args.docId);
  }
  return {
    content: [
      {
        type: "text",
        text:
          `# 문서 보관 완료\n\n` +
          `- **docId**: \`${args.docId}\`\n` +
          `- **파일**: ${meta.filename}\n` +
          `- **포맷**: ${args.format}\n` +
          `- **크기**: ${(meta.byteSize / 1024).toFixed(1)} KB\n` +
          `- **보관 위치**: \`~/.agent-safety-oss/documents/${args.docId}/${meta.filename}\`\n` +
          `${draftDeleted ? "- **초안**: 정리 완료\n" : ""}`,
      },
    ],
    structuredContent: { ...meta, draftDeleted, path: `${STORAGE_ROOT}/documents/${args.docId}/${meta.filename}` },
  };
}

// === 5. get_storage_stats ===
async function statsHandler(): Promise<McpToolResult> {
  const stats = await getStorageStats();
  const lines: string[] = [];
  lines.push(`# 로컬 저장소 상태`);
  lines.push("");
  lines.push(`**위치**: \`${stats.storageRoot}\``);
  lines.push("");
  lines.push(`| 항목 | 값 |`);
  lines.push(`|---|---:|`);
  lines.push(`| profile.jsonld | ${stats.profileExists ? "✅ 존재" : "❌ 없음"} |`);
  lines.push(`| 작성 중 초안 | ${stats.draftCount} |`);
  lines.push(`| 보관된 문서 | ${stats.archivedDocCount} |`);
  lines.push(`| 활동 로그 | ${(stats.activityLogBytes / 1024).toFixed(1)} KB |`);
  lines.push(`| 최근 이벤트 | ${stats.recentActivityCount} |`);
  lines.push("");
  if (Object.keys(stats.archivedDocByDocId).length > 0) {
    lines.push(`## docId별 보관 문서 수`);
    lines.push("");
    for (const [k, v] of Object.entries(stats.archivedDocByDocId).sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${k}\`: ${v}건`);
    }
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: stats,
  };
}

// === 6. list_archived_documents ===
const listArchivedSchema = z.object({
  docId: z.string().optional().describe("특정 docId 만 (생략 시 전체)"),
});

async function listArchivedHandler(input: unknown): Promise<McpToolResult> {
  const args = listArchivedSchema.parse(input);
  const docs = await listArchivedDocuments(args.docId);
  const lines: string[] = [];
  lines.push(`# 보관 문서 ${docs.length}건${args.docId ? ` (docId: \`${args.docId}\`)` : ""}`);
  lines.push("");
  if (docs.length === 0) {
    lines.push("*보관된 문서 없음.*");
  } else {
    lines.push("| docId | 파일명 | 포맷 | 크기 | 보관일시 |");
    lines.push("|---|---|---|---:|---|");
    for (const d of docs.slice(0, 50)) {
      lines.push(
        `| \`${d.docId}\` | ${d.filename} | ${d.format} | ${(d.byteSize / 1024).toFixed(1)} KB | ${d.archivedAt} |`,
      );
    }
    if (docs.length > 50) lines.push(`\n... 외 ${docs.length - 50}건`);
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { docs, count: docs.length },
  };
}

export const LOCAL_STORAGE_TOOLS: ToolDefinition[] = [
  {
    name: "save_form_draft",
    title: "폼 초안 저장 (자동/수동)",
    description:
      "작성 중인 폼 입력값을 ~/.agent-safety-oss/drafts/{docId}.jsonld 에 영구 저장. autosave=true 면 5초 debounce 자동저장 마커, false 면 사용자 명시 저장. 기존 값과 머지.",
    inputSchema: saveDraftSchema,
    handler: saveDraftHandler,
  },
  {
    name: "load_form_draft",
    title: "저장된 폼 초안 복원",
    description: "이전에 작성한 폼 초안을 docId 로 복원. 다시 폼 띄울 때 prefill 용.",
    inputSchema: loadDraftSchema,
    handler: loadDraftHandler,
  },
  {
    name: "list_form_drafts",
    title: "작성 중인 초안 목록",
    description: "drafts/ 디렉토리의 모든 docId 와 마지막 수정 시각 나열.",
    inputSchema: z.object({}),
    handler: () => listDraftsHandler(),
  },
  {
    name: "archive_safety_document",
    title: "완성 문서 영구 보관",
    description:
      "generate_safety_document·export_drafted_document 결과를 ~/.agent-safety-oss/documents/{docId}/{YYYY-MM-DD-HHmmss-SSS}.{html,md,json} 에 보관. 같은 millisecond 충돌 시 -01 suffix 로 덮어쓰기를 방지한다. cleanupDraft=true 시 초안 자동 삭제.",
    inputSchema: archiveSchema,
    handler: archiveHandler,
  },
  {
    name: "list_archived_documents",
    title: "보관된 문서 목록",
    description: "documents/ 디렉토리의 모든 보관 문서 (또는 특정 docId 필터).",
    inputSchema: listArchivedSchema,
    handler: listArchivedHandler,
  },
  {
    name: "get_storage_stats",
    title: "로컬 저장소 진단",
    description:
      "~/.agent-safety-oss/ 의 파일 통계 — profile / drafts / 보관문서 / 활동 로그 크기 등.",
    inputSchema: z.object({}),
    handler: () => statsHandler(),
  },
];
