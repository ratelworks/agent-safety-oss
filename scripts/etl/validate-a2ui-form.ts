#!/usr/bin/env tsx
/**
 * A2UI v0.9 폼 검증 + HTML 뷰어 렌더링.
 *
 * 검증 단계:
 *   1. JSONL 파싱 (각 라인 valid JSON)
 *   2. 메시지 타입 분류 (createSurface/updateComponents/updateDataModel)
 *   3. 컴포넌트 스키마 검증 (필수 필드)
 *   4. 무결성 검증 (ID 참조 그래프)
 *   5. HTML 뷰어 생성 (실제 렌더링 가능한 self-contained HTML)
 *   6. 데이터 바인딩 검증 ({path:"..."} 참조가 dataModel에 존재)
 *
 * 함수 export — simulate-user-input.ts 등 다른 ETL 스크립트가 재사용.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JSONL_PATH = resolve(ROOT, "reports/a2ui-work-plan-form.jsonl");
const REPORTS_DIR = resolve(ROOT, "reports");
const VIEWER_HTML = resolve(REPORTS_DIR, "a2ui-work-plan-rendered.html");

const COMPONENT_SCHEMA: Record<string, { required: string[]; optional: string[] }> = {
  Column: { required: [], optional: ["children", "distribution", "alignment"] },
  Row: { required: [], optional: ["children", "distribution", "alignment"] },
  Card: { required: ["child"], optional: [] },
  List: { required: [], optional: ["children", "direction"] },
  Tabs: { required: ["children"], optional: [] },
  Text: { required: ["text"], optional: ["usageHint"] },
  Image: { required: ["url"], optional: ["description", "fit", "usageHint"] },
  Icon: { required: ["icon"], optional: [] },
  Divider: { required: [], optional: ["axis"] },
  TextField: { required: [], optional: ["label", "text", "usageHint"] },
  DateTimeInput: { required: [], optional: ["enableDate", "enableTime"] },
  ChoicePicker: { required: ["options"], optional: ["value", "usageHint"] },
  Slider: { required: ["min", "max"], optional: ["value"] },
  Button: { required: ["child"], optional: ["action"] },
};

interface Surface {
  catalogId: string | null;
  root: string | null;
}

interface Component {
  id: string;
  component?: string;
  children?: string[];
  child?: string;
  text?: any;
  label?: string;
  value?: any;
  options?: any[];
  usageHint?: string;
  enableDate?: boolean;
  action?: any;
  [k: string]: any;
}

export function splitTopLevelObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start: number | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"' && !escape) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== null) {
        objects.push(text.slice(start, i + 1));
        start = null;
      }
    }
  }
  return objects;
}

export function parseJsonl(path: string): {
  surfaces: Record<string, Surface>;
  components: Record<string, Component>;
  dataModel: Record<string, any>;
  errors: string[];
} {
  const surfaces: Record<string, Surface> = {};
  const components: Record<string, Component> = {};
  let dataModel: Record<string, any> = {};
  const errors: string[] = [];

  const text = readFileSync(path, "utf8");
  const rawObjects = splitTopLevelObjects(text);

  rawObjects.forEach((raw, idx) => {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      errors.push(`obj#${idx + 1}: JSON 파싱 실패: ${(e as Error).message}`);
      return;
    }
    if ("createSurface" in msg) {
      const s = msg.createSurface;
      surfaces[s.surfaceId] = { catalogId: s.catalogId || null, root: null };
    } else if ("updateComponents" in msg) {
      const u = msg.updateComponents;
      const sid = u.surfaceId;
      if (surfaces[sid]) surfaces[sid].root = u.root || null;
      for (const c of (u.components || [])) components[c.id] = c;
    } else if ("updateDataModel" in msg) {
      const u = msg.updateDataModel;
      const op = u.op || "replace";
      const path: string = u.path;
      const value = u.value;
      if (op === "replace") {
        const keys = path.split("/").filter(Boolean);
        if (keys.length === 0) {
          dataModel = value;
        } else {
          let target = dataModel;
          for (const k of keys.slice(0, -1)) {
            if (typeof target[k] !== "object" || target[k] === null) target[k] = {};
            target = target[k];
          }
          target[keys[keys.length - 1]] = value;
        }
      }
    }
  });

  return { surfaces, components, dataModel, errors };
}

export function validateComponents(components: Record<string, Component>): string[] {
  const issues: string[] = [];
  for (const [cid, c] of Object.entries(components)) {
    const ctype = c.component;
    if (!ctype) {
      issues.push(`${cid}: component 타입 누락`);
      continue;
    }
    if (!(ctype in COMPONENT_SCHEMA)) {
      issues.push(`${cid}: 알 수 없는 컴포넌트 '${ctype}'`);
      continue;
    }
    for (const req of COMPONENT_SCHEMA[ctype].required) {
      if (!(req in c)) issues.push(`${cid} (${ctype}): 필수 필드 '${req}' 누락`);
    }
  }
  return issues;
}

export function validateIntegrity(surfaces: Record<string, Surface>, components: Record<string, Component>): string[] {
  const issues: string[] = [];
  const referenced = new Set<string>();

  for (const [cid, c] of Object.entries(components)) {
    if (Array.isArray(c.children)) {
      for (const childId of c.children) {
        if (!components[childId]) issues.push(`${cid}.children → '${childId}' 없음 (dangling)`);
        else referenced.add(childId);
      }
    }
    if (typeof c.child === "string") {
      if (!components[c.child]) issues.push(`${cid}.child → '${c.child}' 없음 (dangling)`);
      else referenced.add(c.child);
    }
  }

  for (const [sid, s] of Object.entries(surfaces)) {
    if (s.root) {
      if (!components[s.root]) issues.push(`surface '${sid}'.root → '${s.root}' 없음`);
      else referenced.add(s.root);
    }
  }

  const allIds = new Set(Object.keys(components));
  for (const o of allIds) {
    if (referenced.has(o)) continue;
    const isRoot = Object.values(surfaces).some((s) => s.root === o);
    if (!isRoot) issues.push(`orphan: '${o}' 컴포넌트가 어느 children/child에도 참조되지 않음`);
  }

  return issues;
}

export function validateDataPaths(components: Record<string, Component>, dataModel: Record<string, any>): { paths: string[]; missing: string[] } {
  const paths: string[] = [];

  function walk(obj: any) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        if (k === "path" && typeof v === "string" && v.startsWith("/")) paths.push(v);
        walk(v);
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    }
  }
  for (const c of Object.values(components)) walk(c);

  function exists(p: string, model: any): boolean {
    const keys = p.split("/").filter(Boolean);
    let cur = model;
    for (const k of keys) {
      if (!cur || typeof cur !== "object" || !(k in cur)) return false;
      cur = cur[k];
    }
    return true;
  }

  const missing = paths.filter((p) => !exists(p, dataModel));
  return { paths, missing };
}

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>A2UI work-plan 폼 렌더링</title>
  <link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f5f5f5;
      margin: 0;
      padding: 24px;
      color: #212121;
    }
    .a2ui-root {
      max-width: 920px;
      margin: 0 auto;
      background: #ffffff;
      padding: 28px;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .a2ui-column { display: flex; flex-direction: column; gap: 14px; }
    .a2ui-row { display: flex; flex-direction: row; gap: 14px; }
    .a2ui-row.spaceBetween { justify-content: space-between; }
    .a2ui-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; background: #fafafa; }
    .a2ui-divider { border-top: 1px solid #e0e0e0; margin: 8px 0; }
    .a2ui-text-h1 { font-size: 28px; font-weight: 900; color: #212121; }
    .a2ui-text-h2 { font-size: 22px; font-weight: 700; }
    .a2ui-text-h3 { font-size: 16px; font-weight: 700; color: #1565c0; margin-bottom: 4px; }
    .a2ui-text-body { font-size: 14px; line-height: 1.6; color: #424242; }
    .a2ui-text-caption { font-size: 12px; color: #757575; line-height: 1.6; }
    .a2ui-text-caption.guide { color: #1976d2; font-weight: 500; }
    .a2ui-text-caption.warn { color: #d32f2f; font-weight: 500; }
    .a2ui-text-caption.auto { color: #2e7d32; font-weight: 500; }
    .a2ui-text-caption.example { color: #6a1b9a; font-style: italic; }
    .a2ui-textfield { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
    .a2ui-textfield label { font-size: 13px; color: #424242; font-weight: 600; }
    .a2ui-textfield input, .a2ui-textfield textarea {
      padding: 10px 12px; border: 1.5px solid #bdbdbd; border-radius: 6px;
      font-size: 14px; font-family: inherit; background: #ffffff;
    }
    .a2ui-textfield input:focus { border-color: #1565c0; outline: none; }
    .a2ui-textfield.auto-filled input { background: #e8f5e9; border-color: #66bb6a; }
    .a2ui-textfield.empty input { background: #ffebee; border-color: #ef5350; }
    .a2ui-choice { display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .a2ui-choice select { padding: 10px 12px; border: 1.5px solid #bdbdbd; border-radius: 6px; font-size: 14px; background: #ffffff; }
    .a2ui-datetime { flex: 1; padding: 10px 12px; border: 1.5px solid #bdbdbd; border-radius: 6px; font-size: 14px; }
    .a2ui-button { padding: 10px 20px; border: none; border-radius: 6px; background: #1565c0; color: white; font-size: 14px; font-weight: 600; cursor: pointer; }
    .a2ui-button.secondary { background: #ffffff; color: #1565c0; border: 1.5px solid #1565c0; }
  </style>
</head>
<body>
<div class="a2ui-root">__CONTENT__</div>
</body>
</html>
`;

function getPathValue(path: string, dataModel: any): any {
  const keys = path.split("/").filter(Boolean);
  let cur = dataModel;
  for (const k of keys) {
    if (!cur || typeof cur !== "object" || !(k in cur)) return null;
    cur = cur[k];
  }
  return cur;
}

function resolveValue(val: any, dataModel: any): any {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    if ("path" in val) {
      const v = getPathValue(val.path, dataModel);
      return v !== null ? v : (val.literalString || "");
    }
    if ("literalString" in val) return val.literalString;
  }
  return val;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderComponent(cid: string, components: Record<string, Component>, dataModel: any, depth = 0): string {
  const c = components[cid];
  if (!c) return `<div class="error">missing: ${escapeHtml(cid)}</div>`;
  const ctype = c.component;

  if (ctype === "Column") {
    const ch = (c.children || []).map((child) => renderComponent(child, components, dataModel, depth + 1)).join("");
    return `<div class="a2ui-column">${ch}</div>`;
  }
  if (ctype === "Row") {
    const dist = c.distribution || "";
    const cls = `a2ui-row ${dist}`;
    const ch = (c.children || []).map((child) => renderComponent(child, components, dataModel, depth + 1)).join("");
    return `<div class="${cls}">${ch}</div>`;
  }
  if (ctype === "Card") {
    const inner = c.child ? renderComponent(c.child, components, dataModel, depth + 1) : "";
    return `<div class="a2ui-card">${inner}</div>`;
  }
  if (ctype === "Divider") return `<div class="a2ui-divider"></div>`;
  if (ctype === "Text") {
    const text = String(resolveValue(c.text, dataModel) ?? "");
    const hint = c.usageHint || "body";
    let extra = "";
    if (typeof text === "string") {
      if (text.startsWith("📝")) extra = " guide";
      else if (text.startsWith("⚠")) extra = " warn";
      else if (text.startsWith("✓")) extra = " auto";
      else if (text.startsWith("예시")) extra = " example";
    }
    return `<div class="a2ui-text-${hint}${extra}">${escapeHtml(text)}</div>`;
  }
  if (ctype === "TextField") {
    const label = c.label || "";
    const value = resolveValue(c.text, dataModel);
    const filled = !!value && value !== "";
    const cls = filled ? "a2ui-textfield auto-filled" : "a2ui-textfield empty";
    let inputHtml: string;
    if (c.usageHint === "longText") {
      inputHtml = `<input type="text" value="${escapeHtml(String(value || ""))}" placeholder="(사용자 입력)">`;
    } else if (c.usageHint === "number") {
      inputHtml = `<input type="number" value="${escapeHtml(String(value || ""))}" placeholder="(숫자 입력)">`;
    } else {
      inputHtml = `<input type="text" value="${escapeHtml(String(value || ""))}" placeholder="(입력)">`;
    }
    return `<div class="${cls}"><label>${escapeHtml(label)}</label>${inputHtml}</div>`;
  }
  if (ctype === "ChoicePicker") {
    const opts: any[] = c.options || [];
    const value = resolveValue(c.value, dataModel);
    const optsHtml = opts.map((o) => `<option value="${escapeHtml(String(o))}"${o === value ? " selected" : ""}>${escapeHtml(String(o))}</option>`).join("");
    return `<div class="a2ui-choice"><label>선택</label><select>${optsHtml}</select></div>`;
  }
  if (ctype === "DateTimeInput") {
    const enableDate = c.enableDate !== false;
    return `<input class="a2ui-datetime" type="${enableDate ? "date" : "time"}" placeholder="날짜 선택">`;
  }
  if (ctype === "Button") {
    const action = c.action || {};
    const actionName = typeof action === "object" ? (action.name || "") : "";
    const cls = cid.includes("submit") ? "a2ui-button" : "a2ui-button secondary";
    const inner = c.child ? renderComponent(c.child, components, dataModel, depth + 1) : "";
    return `<button class="${cls}" data-action="${escapeHtml(actionName)}">${inner}</button>`;
  }
  return `<div class="error">unknown: ${escapeHtml(String(ctype || ""))}</div>`;
}

export function renderHtml(surfaces: Record<string, Surface>, components: Record<string, Component>, dataModel: any): string {
  const surface = Object.values(surfaces)[0];
  const rootId = surface.root || "";
  const content = renderComponent(rootId, components, dataModel);
  return HTML_TEMPLATE.replace("__CONTENT__", content);
}

function main(): number {
  console.log(`A2UI v0.9 폼 검증 — work-plan\n`);
  const { surfaces, components, dataModel, errors: parseErrors } = parseJsonl(JSONL_PATH);

  console.log(`\n[1/4] 파싱 결과`);
  console.log(`  surfaces: ${Object.keys(surfaces).length}`);
  console.log(`  components: ${Object.keys(components).length}`);
  console.log(`  dataModel keys: ${JSON.stringify(Object.keys(dataModel))}`);
  console.log(`  파싱 오류: ${parseErrors.length}`);
  for (const e of parseErrors) console.log(`    - ${e}`);

  console.log(`\n[2/4] 컴포넌트 스키마 검증`);
  const schemaIssues = validateComponents(components);
  if (schemaIssues.length > 0) {
    for (const i of schemaIssues.slice(0, 15)) console.log(`  ⚠ ${i}`);
    console.log(`  총 ${schemaIssues.length}건`);
  } else {
    console.log(`  ✅ 통과 — 모든 ${Object.keys(components).length} 컴포넌트가 v0.9 스펙 부합`);
  }

  console.log(`\n[3/4] ID 참조 무결성 검증`);
  const integrityIssues = validateIntegrity(surfaces, components);
  if (integrityIssues.length > 0) {
    for (const i of integrityIssues.slice(0, 15)) console.log(`  ⚠ ${i}`);
    console.log(`  총 ${integrityIssues.length}건`);
  } else {
    console.log(`  ✅ 통과 — 모든 ID 참조 무결성 OK (${Object.keys(components).length} 컴포넌트, dangling/orphan 0)`);
  }

  console.log(`\n[4/4] 데이터 바인딩 검증`);
  const { paths, missing } = validateDataPaths(components, dataModel);
  console.log(`  발견된 {path:...} 참조: ${paths.length}`);
  console.log(`  존재하는 path: ${paths.length - missing.length}`);
  console.log(`  누락된 path: ${missing.length}`);
  if (missing.length > 0) {
    for (const m of missing.slice(0, 10)) console.log(`    ❌ ${m}`);
  } else {
    console.log(`  ✅ 모든 path가 dataModel에 존재`);
  }

  const typesCount: Record<string, number> = {};
  for (const c of Object.values(components)) {
    const t = c.component || "?";
    typesCount[t] = (typesCount[t] || 0) + 1;
  }
  console.log(`\n[부수] 컴포넌트 타입 분포:`);
  for (const [t, n] of Object.entries(typesCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(20)} ${n}`);
  }

  console.log(`\n[5/5] HTML 뷰어 렌더링`);
  const html = renderHtml(surfaces, components, dataModel);
  writeFileSync(VIEWER_HTML, html, "utf8");
  console.log(`  저장: ${VIEWER_HTML}`);
  console.log(`  크기: ${html.length.toLocaleString("en-US")} bytes`);

  const allGood = parseErrors.length === 0 && schemaIssues.length === 0 && integrityIssues.length === 0 && missing.length === 0;
  console.log(`\n종합 결과: ${allGood ? "✅ A2UI v0.9 스펙 완전 부합 + 무결성 OK + 데이터 바인딩 OK" : "⚠ 일부 이슈 발견"}`);
  return allGood ? 0 : 1;
}

// CLI 진입 — 외부 import 시에는 main() 실행 안 함
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^\//, "").split("/").pop() || "");
if (process.argv[1]?.endsWith("validate-a2ui-form.ts") || process.argv[1]?.endsWith("validate-a2ui-form.js")) {
  process.exit(main());
}
