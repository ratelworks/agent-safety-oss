#!/usr/bin/env tsx
/**
 * generate-host-tool-table.ts — docs/HOST-STORAGE.md 의 도구 표를 도구 특성 목록에서 만든다
 *
 *   npm run docs:host-tools   → 문서의 표 자리(HOST-TOOLS 표지 사이)를 다시 쓴다
 *
 * 표의 정답은 src/engine/tool-catalog.ts 다. 손으로 고치지 않는다 — 시험(test-host-storage)이 어긋남을 잡는다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TOOLS } from "../../src/tool-registry.js";
import { TOOL_TRAITS, type SafetyToolTraits } from "../../src/engine/tool-catalog.js";

// ── 상수 ────────────────────────────────────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOC_PATH = resolve(ROOT, "docs", "HOST-STORAGE.md");
const START = "<!-- HOST-TOOLS:START -->";
const END = "<!-- HOST-TOOLS:END -->";
const ACCESS_LABEL: Record<SafetyToolTraits["access"], string> = { none: "없음", read: "읽기", write: "쓰기" };
const HUMAN_LABEL: Record<string, string> = { approve: "승인", register: "등록", auth: "인증", judge: "판단" };

function storageCell(t: SafetyToolTraits): string {
  if (t.storage === "local-only") return "단독 사용 전용";
  return ACCESS_LABEL[t.access];
}

function humanCell(t: SafetyToolTraits): string {
  if (!t.human) return "";
  const when = t.human.when ? ` (${t.human.when})` : "";
  return `${HUMAN_LABEL[t.human.kind] ?? t.human.kind} — ${t.human.reason}${when}`;
}

/** 표 Markdown (등록 순서) */
export function renderHostToolTable(): string {
  const rows: string[] = [];
  let reads = 0;
  let writes = 0;
  let external = 0;
  let files = 0;
  let humans = 0;
  let localOnly = 0;
  for (const tool of TOOLS) {
    const t = TOOL_TRAITS[tool.name];
    if (!t) throw new Error(`도구 특성 목록에 없는 도구: ${tool.name}`);
    if (t.storage === "local-only") localOnly += 1;
    else if (t.access === "write") writes += 1;
    else if (t.access === "read") reads += 1;
    if (t.effects.external) external += 1;
    if (t.effects.files) files += 1;
    if (t.human) humans += 1;
    rows.push(
      `| \`${tool.name}\` | ${storageCell(t)} | ${t.effects.external ? "외부" : ""} | ${t.effects.files ? "냄" : ""} | ${humanCell(t)} | ${t.siteField ? `\`${t.siteField}\`` : ""} |`,
    );
  }
  const none = TOOLS.length - reads - writes - localOnly;
  return [
    `등록 도구 ${TOOLS.length}개 — 저장 없음 ${none} · 읽기 ${reads} · 쓰기 ${writes} · 단독 사용 전용 ${localOnly} / 외부 통신 ${external} · 파일을 냄 ${files} · 사람 몫 ${humans}`,
    "",
    "| 도구 | 저장 | 통신 | 파일 | 사람 몫 | 현장 칸 |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function writeDoc(): void {
  const doc = readFileSync(DOC_PATH, "utf8");
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start < 0 || end < start) throw new Error(`표 자리 표지가 없습니다: ${START} … ${END}`);
  const next = `${doc.slice(0, start + START.length)}\n${renderHostToolTable()}\n${doc.slice(end)}`;
  if (next === doc) {
    console.log("[host-tool-table] 변경 없음");
    return;
  }
  writeFileSync(DOC_PATH, next);
  console.log("[host-tool-table] docs/HOST-STORAGE.md 표를 다시 썼습니다");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeDoc();
}
