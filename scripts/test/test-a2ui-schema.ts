#!/usr/bin/env tsx
/**
 * test-a2ui-schema.ts — A2UI 출력이 1.0 공식 스키마·기본 카탈로그를 통과하는지 검증 (네트워크 없음)
 *
 *   1. 검증기 자체 확인: 공식 예제는 통과, 잘못된 입력(대조군)은 실패
 *   2. 문서 전 종류 × render_a2ui_form 출력
 *   3. render_profile_input_form 출력
 *   4. 부분 갱신(a2uiUpdate)을 돌려주는 도구의 대표 출력
 *   5. 데이터 모델 → 문서 초안 변환
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../../src/tool-registry.js";
import type { McpToolResult } from "../../src/lib/types.js";
import { A2UI_VERSION, A2UI_BASIC_CATALOG_ID, ASSIST_PANEL_ID, dataModelToDraft, draftPath } from "../../src/lib/a2ui.js";
import {
  validateA2uiJsonl,
  validateA2uiMessage,
  A2UI_VERSION as SCHEMA_VERSION,
  BASIC_CATALOG_ID,
} from "./a2ui-schema-validator.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src/ontology/graph/nodes/documents");
const OFFICIAL_EXAMPLE = resolve(__dirname, "fixtures/a2ui-1.0/contact_form_example.jsonl");
const SAMPLE_DOC_ID = "daily_tbm";
const SURFACE = "safety-form";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function callTool(name: string, input: Record<string, unknown>): Promise<McpToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool.handler(input);
}

function textOf(result: McpToolResult): string {
  return result.content?.[0]?.text ?? "";
}

function allDocIds(): string[] {
  const ids: string[] = [];
  for (const f of readdirSync(DOCS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(readFileSync(resolve(DOCS_DIR, f), "utf8")) as { docId?: string };
    if (node.docId) ids.push(node.docId);
  }
  return ids.sort();
}

interface Component {
  id: string;
  component: string;
  [key: string]: unknown;
}

function componentsOf(jsonl: string): Component[] {
  return jsonl
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => (JSON.parse(l) as { updateComponents?: { components: Component[] } }).updateComponents?.components ?? []);
}

/** 뿌리(root)에서 자식 참조를 따라 닿는 컴포넌트 id 집합 */
function reachableFromRoot(components: Component[]): Set<string> {
  const byId = new Map(components.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    const c = byId.get(id);
    if (!c) return;
    seen.add(id);
    if (typeof c.child === "string") walk(c.child);
    if (Array.isArray(c.children)) for (const ch of c.children) if (typeof ch === "string") walk(ch);
  };
  walk("root");
  return seen;
}

// ── 1. 검증기 자체 ──────────────────────────────────────────────────
function testValidatorItself(): void {
  check("상수 일치(version)", A2UI_VERSION === SCHEMA_VERSION);
  check("상수 일치(catalogId)", A2UI_BASIC_CATALOG_ID === BASIC_CATALOG_ID);
  check("공식 예제 통과", validateA2uiJsonl(readFileSync(OFFICIAL_EXAMPLE, "utf8")).valid);

  const text = (extra: Record<string, unknown>) => ({
    version: "1.0",
    updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Text", text: "x", ...extra }] },
  });
  check("정상 Text 통과", validateA2uiMessage(text({ variant: "caption" })).valid);
  // 대조군 — 아래는 모두 실패해야 한다
  check("대조군: version 없음", !validateA2uiMessage({ createSurface: { surfaceId: "s" } }).valid);
  check("대조군: 옛 version", !validateA2uiMessage({ version: "v0.9", createSurface: { surfaceId: "s", catalogId: "standard" } }).valid);
  check("대조군: usageHint", !validateA2uiMessage(text({ usageHint: "h1" })).valid);
  check("대조군: 제목 variant", !validateA2uiMessage(text({ variant: "h1" })).valid);
  check(
    "대조군: updateComponents.root",
    !validateA2uiMessage({ version: "1.0", updateComponents: { surfaceId: "s", root: "root", components: [] } }).valid,
  );
  check(
    "대조군: TextField value 없음",
    !validateA2uiMessage({
      version: "1.0",
      updateComponents: { surfaceId: "s", components: [{ id: "root", component: "TextField", label: "x" }] },
    }).valid,
  );
  check(
    "대조군: 옛 action 형식",
    !validateA2uiMessage({
      version: "1.0",
      updateComponents: {
        surfaceId: "s",
        components: [{ id: "root", component: "Button", child: "t", action: { name: "submit", payload: {} } }],
      },
    }).valid,
  );
  check("대조군: 빈 JSONL", !validateA2uiJsonl("").valid);
}

// ── 2. 문서 전 종류 ─────────────────────────────────────────────────
async function testAllDocumentForms(): Promise<void> {
  const ids = allDocIds();
  let ok = 0;
  let rendered = 0;
  for (const docId of ids) {
    const result = await callTool("render_a2ui_form", { docId, format: "jsonl", useProfile: false });
    if (result.isError) {
      // 작성 필드가 없는 문서는 폼이 없다 — 그 사유만 허용
      check(`${docId}: 폼 없음 사유`, textOf(result).startsWith("[NO_FIELDS]"), textOf(result).slice(0, 80));
      continue;
    }
    rendered += 1;
    const jsonl = textOf(result);
    const v = validateA2uiJsonl(jsonl);
    const comps = componentsOf(jsonl);
    const reachable = reachableFromRoot(comps);
    const orphans = comps.filter((c) => !reachable.has(c.id)).map((c) => c.id);
    const lines = jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const model = (lines[0]?.createSurface as { dataModel?: unknown } | undefined)?.dataModel;
    const fieldMap = (result.structuredContent as { fieldPathMap?: Record<string, string> }).fieldPathMap ?? {};
    // 모든 입력 컴포넌트가 데이터 모델 경로에 바인딩되고, 그 경로가 초기 데이터 모델에 있어야 한다
    const draft = dataModelToDraft(model);
    const unbound = Object.entries(fieldMap).filter(([inputId, key]) => {
      const c = comps.find((x) => x.id === inputId);
      const bound = (c?.value as { "@path"?: string } | undefined)?.["@path"];
      return bound !== draftPath(key) || !(key in draft);
    });
    const good = v.valid && orphans.length === 0 && unbound.length === 0 && Object.keys(fieldMap).length > 0;
    if (good) ok += 1;
    check(
      `${docId}: 1.0 스키마·트리·바인딩`,
      good,
      [...v.errors.slice(0, 3), orphans.length ? `트리 밖 ${orphans.slice(0, 3).join(",")}` : "", unbound.length ? `바인딩 누락 ${unbound.length}` : ""]
        .filter(Boolean)
        .join(" | "),
    );
  }
  console.log(`[a2ui-schema] 문서 ${ids.length}종 · 폼 ${rendered}종 · 통과 ${ok}`);
  check("문서가 한 종 이상", ids.length > 0 && rendered > 0);
}

// ── 3·4. 사업장 정보 폼과 부분 갱신 ─────────────────────────────────
async function testProfileAndUpdates(): Promise<void> {
  const profile = await callTool("render_profile_input_form", { format: "jsonl", prefillFromExisting: false });
  const pv = validateA2uiJsonl(textOf(profile));
  check("render_profile_input_form 1.0 스키마", pv.valid, pv.errors.slice(0, 3).join(" | "));
  const pComps = componentsOf(textOf(profile));
  check("사업장 정보 폼: 트리 밖 컴포넌트 없음", pComps.every((c) => reachableFromRoot(pComps).has(c.id)));

  const form = await callTool("render_a2ui_form", { docId: SAMPLE_DOC_ID, format: "jsonl", useProfile: false });
  const formComps = componentsOf(textOf(form));
  check("폼에 보조 패널 자리가 있음", formComps.some((c) => c.id === ASSIST_PANEL_ID));
  const firstKey = Object.values((form.structuredContent as { fieldPathMap: Record<string, string> }).fieldPathMap)[0];

  const updates: Array<[string, Record<string, unknown>]> = [
    ["analyze_work_context", { docId: SAMPLE_DOC_ID, workName: "굴착 작업", surfaceId: SURFACE }],
    ["request_field_help", { docId: SAMPLE_DOC_ID, fieldKey: firstKey, surfaceId: SURFACE }],
    ["suggest_controls_for_hazard", { docId: SAMPLE_DOC_ID, hazard: "추락", surfaceId: SURFACE }],
    ["preview_review", { docId: SAMPLE_DOC_ID, draft: {}, surfaceId: SURFACE }],
  ];
  for (const [name, input] of updates) {
    const result = await callTool(name, input);
    const update = (result.structuredContent as { a2uiUpdate?: unknown[] } | undefined)?.a2uiUpdate;
    if (!Array.isArray(update) || update.length === 0) {
      check(`${name}: a2uiUpdate 있음`, false, textOf(result).slice(0, 120));
      continue;
    }
    const errors = update.flatMap((m) => validateA2uiMessage(m).errors);
    check(`${name}: a2uiUpdate 1.0 스키마`, errors.length === 0, errors.slice(0, 3).join(" | "));
    // 갱신을 폼에 합친 뒤에도 새 카드가 뿌리에서 닿아야 한다 (화면에 실제로 보임)
    const merged = new Map(formComps.map((c) => [c.id, c]));
    const added = update.flatMap((m) => (m as { updateComponents: { components: Component[] } }).updateComponents.components);
    for (const c of added) merged.set(c.id, c);
    const reachable = reachableFromRoot([...merged.values()]);
    check(`${name}: 갱신 컴포넌트가 폼 트리에 붙음`, added.every((c) => reachable.has(c.id)));
  }
}

// ── 5. 데이터 모델 → 초안 ───────────────────────────────────────────
function testDataModelToDraft(): void {
  const draft = dataModelToDraft({ draft: { a: "값", b: ["예"], c: [], d: ["x", "y"] } });
  check("문자열은 그대로", draft.a === "값");
  check("한 원소 목록은 원소로", draft.b === "예");
  check("빈 목록은 빈 문자열", draft.c === "");
  check("여러 원소는 이어 붙임", draft.d === "x, y");
  check("draft 뿌리가 없으면 빈 초안", Object.keys(dataModelToDraft({})).length === 0);
  check("경로 이스케이프", draftPath("a/b~c") === "/draft/a~1b~0c");
}

// ── 6. 폼 데이터 모델 → 문서 생성 ───────────────────────────────────
async function testDataModelRoundTrip(): Promise<void> {
  const form = await callTool("render_a2ui_form", { docId: SAMPLE_DOC_ID, format: "jsonl", useProfile: false });
  const first = JSON.parse(textOf(form).split("\n")[0]) as { createSurface: { dataModel: { draft: Record<string, unknown> } } };
  const model = first.createSurface.dataModel;
  check("초기 데이터 모델에 todayWork 자리가 있음", "todayWork" in model.draft);
  model.draft.todayWork = "A동 굴착 작업";
  const generated = await callTool("generate_safety_document", {
    docId: SAMPLE_DOC_ID,
    useProfile: false,
    draft: dataModelToDraft(model),
  });
  check("데이터 모델 입력값이 문서 본문에 반영됨", textOf(generated).includes("A동 굴착 작업"));
}

async function main(): Promise<void> {
  testValidatorItself();
  await testDataModelRoundTrip();
  await testAllDocumentForms();
  await testProfileAndUpdates();
  testDataModelToDraft();
  console.log(`\n[a2ui-schema] ${pass} 통과 / ${fail} 실패`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
