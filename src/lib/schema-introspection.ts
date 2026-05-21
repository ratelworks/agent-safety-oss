/**
 * schema-introspection.ts
 *
 * Issue #3 / #4 (2026-05-21) — CLI 가 도구 inputSchema 의 expected type 을 알 수 있도록
 * Zod schema 를 단순 JSON 메타로 변환. 의존성 0 원칙 — `zod-to-json-schema` 미사용.
 *
 * 두 가지 사용처:
 *   1. Issue #3 — parseKeyValueArgs 에서 각 키의 expected type 확인 후 coerce 결정.
 *      예: industryCode: ZodString 이면 "41" 을 string 으로 보존 (Number 변환 X).
 *   2. Issue #4 — tools --json / describe 출력에 properties · required 노출.
 */
import type { z } from "zod";

type ZodTypeName =
  | "ZodString"
  | "ZodNumber"
  | "ZodBoolean"
  | "ZodArray"
  | "ZodObject"
  | "ZodEnum"
  | "ZodLiteral"
  | "ZodUnion"
  | "ZodRecord"
  | "ZodOptional"
  | "ZodDefault"
  | "ZodNullable"
  | "ZodEffects"
  | "ZodPipeline"
  | "ZodUnknown"
  | "ZodAny";

interface ZodDefLike {
  typeName?: ZodTypeName;
  innerType?: z.ZodTypeAny;
  schema?: z.ZodTypeAny;
  shape?: () => Record<string, z.ZodTypeAny> | Record<string, z.ZodTypeAny>;
  values?: readonly string[];
  options?: readonly z.ZodTypeAny[];
  in?: z.ZodTypeAny;
  out?: z.ZodTypeAny;
  type?: z.ZodTypeAny;
  defaultValue?: () => unknown;
  description?: string;
}

function getDef(schema: z.ZodTypeAny | undefined | null): ZodDefLike | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  return (schema as unknown as { _def?: ZodDefLike })._def;
}

// Optional/Default/Nullable/Effects/Pipeline wrapping 을 모두 풀어 본질 타입을 반환.
export function unwrapZodType(schema: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny | undefined = schema;
  for (let i = 0; i < 8 && cur; i += 1) {
    const def = getDef(cur);
    if (!def) break;
    const t = def.typeName;
    if (t === "ZodOptional" || t === "ZodDefault" || t === "ZodNullable") {
      cur = def.innerType;
      continue;
    }
    if (t === "ZodEffects" && def.schema) {
      cur = def.schema;
      continue;
    }
    if (t === "ZodPipeline" && def.out) {
      cur = def.out;
      continue;
    }
    break;
  }
  return cur ?? schema;
}

// 필드가 optional 인지 (Optional 또는 Default 래퍼)
export function isOptional(schema: z.ZodTypeAny): boolean {
  const def = getDef(schema);
  if (!def) return false;
  return def.typeName === "ZodOptional" || def.typeName === "ZodDefault" || def.typeName === "ZodNullable";
}

// CLI coerce 용 expected type
export type FieldKind = "string" | "number" | "boolean" | "array" | "object" | "enum" | "unknown";

export function getFieldKind(schema: z.ZodTypeAny): FieldKind {
  const unwrapped = unwrapZodType(schema);
  const def = getDef(unwrapped);
  if (!def) return "unknown";
  switch (def.typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return "array";
    case "ZodObject":
    case "ZodRecord":
      return "object";
    case "ZodEnum":
    case "ZodLiteral":
      return "enum";
    case "ZodUnion":
      // union 의 첫 옵션을 따라감 (CLI 단순화)
      if (def.options && def.options.length > 0) return getFieldKind(def.options[0]);
      return "unknown";
    default:
      return "unknown";
  }
}

// description 추출 (Optional/Default 래퍼 통과)
export function getDescription(schema: z.ZodTypeAny): string | undefined {
  let cur: z.ZodTypeAny | undefined = schema;
  for (let i = 0; i < 8 && cur; i += 1) {
    const def = getDef(cur);
    if (!def) break;
    if (def.description) return def.description;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault" || def.typeName === "ZodNullable") {
      cur = def.innerType;
      continue;
    }
    if (def.typeName === "ZodEffects" && def.schema) {
      cur = def.schema;
      continue;
    }
    break;
  }
  return undefined;
}

// ZodObject shape 추출 (Effects/Pipeline wrap 포함)
export function getObjectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
  const unwrapped = unwrapZodType(schema);
  const def = getDef(unwrapped);
  if (!def || def.typeName !== "ZodObject" || !def.shape) return null;
  const raw = typeof def.shape === "function" ? def.shape() : def.shape;
  return raw as Record<string, z.ZodTypeAny>;
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

export function fieldToMeta(schema: z.ZodTypeAny): FieldMeta {
  const optional = isOptional(schema);
  const unwrapped = unwrapZodType(schema);
  const def = getDef(unwrapped);
  const kind = getFieldKind(unwrapped);
  const description = getDescription(schema);

  // Default 값 추출
  let defaultValue: unknown | undefined;
  let cur: z.ZodTypeAny | undefined = schema;
  for (let i = 0; i < 4 && cur; i += 1) {
    const d = getDef(cur);
    if (!d) break;
    if (d.typeName === "ZodDefault" && d.defaultValue) {
      try {
        defaultValue = d.defaultValue();
      } catch {}
      break;
    }
    if (d.typeName === "ZodOptional" || d.typeName === "ZodNullable") {
      cur = d.innerType;
      continue;
    }
    break;
  }

  const meta: FieldMeta = { type: kind, optional, description };
  if (defaultValue !== undefined) meta.default = defaultValue;

  if (kind === "enum" && def?.values) meta.enumValues = def.values;
  if (kind === "array" && def?.type) meta.itemsType = getFieldKind(def.type);

  return meta;
}

// 도구 전체 inputSchema → 단순 JSON 메타
export interface ToolInputMeta {
  type: "object";
  properties: Record<string, FieldMeta>;
  required: string[];
}

export function toolInputToMeta(schema: z.ZodTypeAny): ToolInputMeta {
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
