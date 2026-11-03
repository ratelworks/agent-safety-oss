/**
 * schema-introspection.ts
 *
 * Issue #3 / #4 (2026-05-21) — CLI 가 도구 inputSchema 의 expected type 을 알 수 있도록
 * Zod schema 를 단순 JSON 메타로 변환. 의존성 0 원칙 — 별도 JSON Schema 변환기 미사용.
 *
 * 두 가지 사용처:
 *   1. Issue #3 — parseKeyValueArgs 에서 각 키의 expected type 확인 후 coerce 결정.
 *      예: industryCode: ZodString 이면 "41" 을 string 으로 보존 (Number 변환 X).
 *   2. Issue #4 — tools --json / describe 출력에 properties · required 노출.
 *
 * zod 4 기준: 스키마 종류는 `_zod.def.type`, 설명은 `schema.description`(전역 메타 레지스트리).
 *   - .preprocess() 와 .transform() 은 모두 pipe(in → out) 로 표현된다.
 *     preprocess = pipe(transform → 실제 스키마), transform = pipe(실제 스키마 → transform).
 *     본질 타입은 transform 이 아닌 쪽이다.
 *   - .refine() 은 래퍼를 만들지 않고 같은 스키마에 검사로 붙는다.
 */
import type { z } from "zod";

// 파일 최상단 상수 — 래퍼 해제 최대 깊이
const MAX_UNWRAP_DEPTH = 8;
const MAX_DEFAULT_DEPTH = 4;
const OPTIONAL_WRAPPERS = new Set(["optional", "default", "nullable"]);

type AnySchema = z.ZodType;

interface ZodDefLike {
  type?: string;
  innerType?: AnySchema;
  in?: AnySchema;
  out?: AnySchema;
  shape?: Record<string, AnySchema>;
  entries?: Record<string, string | number>;
  options?: readonly AnySchema[];
  element?: AnySchema;
  defaultValue?: unknown;
}

function getDef(schema: AnySchema | undefined | null): ZodDefLike | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  return (schema as unknown as { _zod?: { def?: ZodDefLike } })._zod?.def;
}

function getOwnDescription(schema: AnySchema | undefined): string | undefined {
  if (!schema) return undefined;
  const d = (schema as unknown as { description?: unknown }).description;
  return typeof d === "string" ? d : undefined;
}

// pipe 의 본질 쪽 — transform 이 아닌 쪽 (preprocess 는 out, transform 은 in)
function pipeEssence(def: ZodDefLike): AnySchema | undefined {
  const outType = getDef(def.out)?.type;
  if (outType === "transform") return def.in;
  return def.out;
}

// Optional/Default/Nullable/pipe(preprocess·transform) 래핑을 모두 풀어 본질 타입을 반환.
export function unwrapZodType(schema: AnySchema): AnySchema {
  let cur: AnySchema | undefined = schema;
  for (let i = 0; i < MAX_UNWRAP_DEPTH && cur; i += 1) {
    const def = getDef(cur);
    if (!def) break;
    if (def.type && OPTIONAL_WRAPPERS.has(def.type) && def.innerType) {
      cur = def.innerType;
      continue;
    }
    if (def.type === "pipe") {
      const next = pipeEssence(def);
      if (next) {
        cur = next;
        continue;
      }
    }
    break;
  }
  return cur ?? schema;
}

// 필드가 optional 인지 (Optional 또는 Default 또는 Nullable 래퍼)
export function isOptional(schema: AnySchema): boolean {
  const def = getDef(schema);
  if (!def || !def.type) return false;
  return OPTIONAL_WRAPPERS.has(def.type);
}

// CLI coerce 용 expected type
export type FieldKind = "string" | "number" | "boolean" | "array" | "object" | "enum" | "unknown";

export function getFieldKind(schema: AnySchema): FieldKind {
  const unwrapped = unwrapZodType(schema);
  const def = getDef(unwrapped);
  if (!def) return "unknown";
  switch (def.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
    case "record":
      return "object";
    case "enum":
    case "literal":
      return "enum";
    case "union":
      // union 의 첫 옵션을 따라감 (CLI 단순화)
      if (def.options && def.options.length > 0) return getFieldKind(def.options[0]);
      return "unknown";
    default:
      return "unknown";
  }
}

// description 추출 (Optional/Default/Nullable·pipe 래퍼 통과 — 바깥 설명 우선)
export function getDescription(schema: AnySchema): string | undefined {
  let cur: AnySchema | undefined = schema;
  for (let i = 0; i < MAX_UNWRAP_DEPTH && cur; i += 1) {
    const own = getOwnDescription(cur);
    if (own) return own;
    const def = getDef(cur);
    if (!def) break;
    if (def.type && OPTIONAL_WRAPPERS.has(def.type) && def.innerType) {
      cur = def.innerType;
      continue;
    }
    if (def.type === "pipe") {
      const next = pipeEssence(def);
      if (next) {
        cur = next;
        continue;
      }
    }
    break;
  }
  return undefined;
}

// ZodObject shape 추출 (pipe·optional 래핑 포함)
export function getObjectShape(schema: AnySchema): Record<string, AnySchema> | null {
  const unwrapped = unwrapZodType(schema);
  const def = getDef(unwrapped);
  if (!def || def.type !== "object" || !def.shape) return null;
  return def.shape;
}

// 단일 필드 → 단순 JSON 메타
export interface FieldMeta {
  type: FieldKind;
  optional: boolean;
  description?: string;
  enumValues?: readonly string[];
  default?: unknown;
  itemsType?: FieldKind;
}

export function fieldToMeta(schema: AnySchema): FieldMeta {
  const optional = isOptional(schema);
  const unwrapped = unwrapZodType(schema);
  const def = getDef(unwrapped);
  const kind = getFieldKind(unwrapped);
  const description = getDescription(schema);

  // Default 값 추출 (바깥 Optional/Nullable 은 통과)
  let defaultValue: unknown | undefined;
  let cur: AnySchema | undefined = schema;
  for (let i = 0; i < MAX_DEFAULT_DEPTH && cur; i += 1) {
    const d = getDef(cur);
    if (!d) break;
    if (d.type === "default") {
      try {
        defaultValue = (cur as unknown as { _zod: { def: { defaultValue: unknown } } })._zod.def.defaultValue;
      } catch {}
      break;
    }
    if (d.type === "optional" || d.type === "nullable") {
      cur = d.innerType;
      continue;
    }
    break;
  }

  const meta: FieldMeta = { type: kind, optional, description };
  if (defaultValue !== undefined) meta.default = defaultValue;

  // 열거값은 z.enum 만 노출 (literal 은 단일값이라 노출하지 않음 — 기존 동작 유지)
  if (kind === "enum" && def?.type === "enum" && def.entries) {
    meta.enumValues = Object.values(def.entries).map((v) => String(v));
  }
  if (kind === "array" && def?.element) meta.itemsType = getFieldKind(def.element);

  return meta;
}

// 도구 전체 inputSchema → 단순 JSON 메타
export interface ToolInputMeta {
  type: "object";
  properties: Record<string, FieldMeta>;
  required: string[];
}

export function toolInputToMeta(schema: AnySchema): ToolInputMeta {
  const shape = getObjectShape(schema);
  if (!shape) return { type: "object", properties: {}, required: [] };
  const properties: Record<string, FieldMeta> = {};
  const required: string[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const meta = fieldToMeta(fieldSchema);
    properties[key] = meta;
    if (!meta.optional) required.push(key);
  }
  return { type: "object", properties, required };
}
