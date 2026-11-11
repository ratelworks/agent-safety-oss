/**
 * a2ui-schema-validator.ts — A2UI 1.0 공식 스키마로 메시지를 검증한다 (네트워크 없음)
 *
 * 스키마 출처: github.com/a2ui-project/a2ui (Apache-2.0) — fixtures/a2ui-1.0/SOURCE.md 참조.
 * 상류 시험 실행기와 같은 방식으로, 기본 카탈로그의 $id 를 agent_to_renderer.json 이
 * 가리키는 `catalog.json` 으로 바꿔 등록한다.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "fixtures", "a2ui-1.0");
export const A2UI_VERSION = "1.0";
export const BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
const CATALOG_ALIAS_ID = "https://a2ui.org/specification/v1_0/catalog.json";
const AGENT_TO_RENDERER_ID = "https://a2ui.org/specification/v1_0/agent_to_renderer.json";
const SCHEMA_FILES = ["common_types.json", "agent_to_renderer.json"] as const;

export interface A2uiValidation {
  valid: boolean;
  errors: string[];
}

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), "utf8")) as Record<string, unknown>;
}

function buildValidator(): (message: unknown) => A2uiValidation {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const addFormats = (addFormatsModule as unknown as { default?: (a: unknown) => void }).default
    ?? (addFormatsModule as unknown as (a: unknown) => void);
  addFormats(ajv);
  for (const file of SCHEMA_FILES) ajv.addSchema(readJson(file));
  const catalog = readJson("basic_catalog.json");
  if (catalog.$id !== BASIC_CATALOG_ID) {
    throw new Error(`기본 카탈로그 $id 가 예상과 다름: ${String(catalog.$id)}`);
  }
  ajv.addSchema({ ...catalog, $id: CATALOG_ALIAS_ID });
  const validate = ajv.getSchema(AGENT_TO_RENDERER_ID);
  if (!validate) throw new Error("agent_to_renderer 스키마를 찾지 못함");
  return (message: unknown) => {
    const valid = validate(message) as boolean;
    const errors = valid
      ? []
      : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""} ${JSON.stringify(e.params)}`);
    return { valid, errors };
  };
}

let cached: ((message: unknown) => A2uiValidation) | null = null;

/** 메시지 한 건을 agent→renderer 스키마와 기본 카탈로그로 검증 */
export function validateA2uiMessage(message: unknown): A2uiValidation {
  cached ??= buildValidator();
  return cached(message);
}

/** JSONL(한 줄에 메시지 하나) 전체를 검증 — 줄 번호를 붙여 오류를 모은다 */
export function validateA2uiJsonl(jsonl: string): A2uiValidation {
  const errors: string[] = [];
  const lines = jsonl.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) errors.push("메시지가 없음");
  lines.forEach((line, i) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push(`줄 ${i + 1}: JSON 이 아님`);
      return;
    }
    const r = validateA2uiMessage(parsed);
    for (const e of r.errors.slice(0, 5)) errors.push(`줄 ${i + 1}: ${e}`);
  });
  return { valid: errors.length === 0, errors };
}
