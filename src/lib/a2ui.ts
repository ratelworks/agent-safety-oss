/**
 * a2ui.ts — A2UI 1.0 메시지·컴포넌트 조립 (기본 카탈로그만 사용)
 *
 * 규격: https://a2ui.org/specification/v1.0-a2ui/ (github.com/a2ui-project/a2ui, specification/v1_0)
 *   - 모든 메시지에 version "1.0"
 *   - 컴포넌트는 기본 카탈로그(Text·TextField·DateTimeInput·ChoicePicker·Button·Card·Column·Row)만
 *   - 입력값은 데이터 모델 경로({"@path": "/draft/<키>"})에 바인딩
 *   - 기본 카탈로그에 없는 정보(양식 필드 키·입력 종류)는 `@metadata.extensions` 에 싣는다
 *
 * 문서 초안(draft) 값은 문자열이다. 선택형(ChoicePicker)만 문자열 목록으로 바인딩되므로
 * 데이터 모델을 초안으로 옮길 때 한 원소 목록은 그 원소로 푼다(`dataModelToDraft`).
 */

// ── 상수 ────────────────────────────────────────────────────────────
export const A2UI_VERSION = "1.0";
export const A2UI_BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
/** 입력값이 놓이는 데이터 모델 뿌리 */
export const DRAFT_ROOT = "draft";
/** 폼 뿌리 아래의 보조 패널 자리 — 도움말·분석 결과 카드가 여기에 붙는다 */
export const ASSIST_PANEL_ID = "assist-panel";
const HEADING_PREFIX = { h1: "# ", h2: "## " } as const;
const DATE_KINDS: Record<string, { enableDate: boolean; enableTime: boolean }> = {
  date: { enableDate: true, enableTime: false },
  datetime: { enableDate: true, enableTime: true },
  time: { enableDate: false, enableTime: true },
};
const NUMBER_KINDS = new Set(["number", "currency", "percentage"]);
const YES_NO_OPTIONS = [
  { label: "예 / 적합", value: "예" },
  { label: "아니오 / 부적합", value: "아니오" },
  { label: "해당없음", value: "해당없음" },
];
const REQUIRED_MESSAGE = "필수 입력 항목입니다.";
const YES_NO_VALUES = new Set(YES_NO_OPTIONS.map((o) => o.value));

// ── 타입 ────────────────────────────────────────────────────────────
export interface A2UIComponent {
  id: string;
  component: string;
  [key: string]: unknown;
}

export interface A2UIMessage {
  version: typeof A2UI_VERSION;
  createSurface?: {
    surfaceId: string;
    catalogId: string;
    sendDataModel?: boolean;
    dataModel?: Record<string, unknown>;
  };
  updateComponents?: { surfaceId: string; components: A2UIComponent[] };
  updateDataModel?: { surfaceId: string; path?: string; value: unknown };
}

export type TextKind = "h1" | "h2" | "body" | "caption";

export interface FieldSpec {
  id: string;
  /** 양식 필드 키 — 초안(draft) 키이자 데이터 모델 경로의 마지막 마디 */
  fieldKey: string;
  label: string;
  /** 입력 종류 — shortText·longText·date·datetime·time·number·currency·percentage·yesNo·check·signature·phone·email 등 */
  inputKind: string;
  placeholder?: string;
  /** 필수 입력 여부 — 참이면 `@checks` 에 required 검사를 싣는다 */
  required?: boolean;
  /** 사업장 정보 폼 전용 — 저장 위치 */
  profilePath?: string;
}

// ── 메시지 ──────────────────────────────────────────────────────────
/** surface 생성 — 초기 입력값(자동 채움)은 데이터 모델로 함께 보내고, 사용자 동작 때 데이터 모델을 돌려받는다 */
export function createSurfaceMessage(surfaceId: string, draft: Record<string, unknown> = {}): A2UIMessage {
  return {
    version: A2UI_VERSION,
    createSurface: {
      surfaceId,
      catalogId: A2UI_BASIC_CATALOG_ID,
      sendDataModel: true,
      dataModel: { [DRAFT_ROOT]: draft },
    },
  };
}

export function updateComponentsMessage(surfaceId: string, components: A2UIComponent[]): A2UIMessage {
  return { version: A2UI_VERSION, updateComponents: { surfaceId, components } };
}

export function toJsonl(messages: A2UIMessage[]): string {
  return messages.map((m) => JSON.stringify(m)).join("\n");
}

// ── 컴포넌트 ────────────────────────────────────────────────────────
/** 제목은 Markdown 머리표, 본문·주석은 variant 로 표현한다 */
export function textComponent(id: string, text: string, kind: TextKind = "body"): A2UIComponent {
  if (kind === "h1" || kind === "h2") {
    return { id, component: "Text", text: `${HEADING_PREFIX[kind]}${text}` };
  }
  return { id, component: "Text", text, variant: kind };
}

/** JSON Pointer(RFC 6901) 마디 이스케이프 */
function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function draftPath(fieldKey: string): string {
  return `/${DRAFT_ROOT}/${escapePointerSegment(fieldKey)}`;
}

/** 입력 컴포넌트 — 종류에 따라 TextField·DateTimeInput·ChoicePicker 를 고른다 */
export function fieldComponent(spec: FieldSpec): A2UIComponent {
  const extensions: Record<string, unknown> = { fieldKey: spec.fieldKey, inputKind: spec.inputKind };
  if (spec.profilePath) extensions.profilePath = spec.profilePath;
  const base = {
    id: spec.id,
    label: spec.label,
    value: { "@path": draftPath(spec.fieldKey) },
    "@metadata": { extensions },
    ...(spec.required
      ? { "@checks": [{ condition: { "@call": "required", args: { value: { "@path": draftPath(spec.fieldKey) } } }, message: REQUIRED_MESSAGE }] }
      : {}),
  };
  const dateKind = DATE_KINDS[spec.inputKind];
  if (dateKind) {
    return { ...base, component: "DateTimeInput", ...dateKind };
  }
  if (spec.inputKind === "yesNo") {
    return { ...base, component: "ChoicePicker", variant: "mutuallyExclusive", options: YES_NO_OPTIONS };
  }
  const variant = spec.inputKind === "longText" ? "longText" : NUMBER_KINDS.has(spec.inputKind) ? "number" : "shortText";
  return {
    ...base,
    component: "TextField",
    variant,
    ...(spec.placeholder ? { placeholder: spec.placeholder } : {}),
  };
}

/** 보조 패널 — 부분 갱신은 이 컴포넌트를 다시 보내 새 카드를 폼 트리에 붙인다 */
export function assistPanelComponent(children: string[] = []): A2UIComponent {
  return { id: ASSIST_PANEL_ID, component: "Column", children };
}

/** 버튼 — 누르면 이름 붙은 이벤트와 문맥을 내보낸다 */
export function buttonComponent(
  id: string,
  childId: string,
  eventName: string,
  context: Record<string, unknown> = {},
  variant: "default" | "primary" | "borderless" = "default",
): A2UIComponent {
  return {
    id,
    component: "Button",
    child: childId,
    variant,
    action: { event: { name: eventName, context } },
  };
}

/** 이벤트 문맥에 싣는 입력값 묶음 바인딩 — 렌더러가 버튼을 누를 때 현재 입력값으로 풀어 보낸다 */
export const DRAFT_BINDING = { "@path": `/${DRAFT_ROOT}` } as const;

/** 선택형 필드의 값(문자열 목록)을 초안 문자열로 푼다 — 빈 목록은 빈 문자열, 한 원소는 그 원소 */
export function choiceValueToText(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.length === 0 ? "" : value.length === 1 ? value[0] : value.join(", ");
}

/** 초안에서 선택형 필드 키의 목록 값만 문자열로 푼다 (다른 필드의 목록 값은 건드리지 않는다) */
export function normalizeChoiceValues(draft: Record<string, unknown>, choiceKeys: string[]): Record<string, unknown> {
  const out = { ...draft };
  for (const key of choiceKeys) if (key in out) out[key] = choiceValueToText(out[key]);
  return out;
}

// ── 데이터 모델 ─────────────────────────────────────────────────────
/** JSON Pointer 로 데이터 모델 값을 읽는다 */
export function readPointer(dataModel: unknown, pointer: string): unknown {
  let cur: unknown = dataModel;
  for (const raw of pointer.split("/").slice(1)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[raw.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return cur;
}

/** 이벤트 문맥의 경로 바인딩을 데이터 모델 값으로 푼다 (렌더러가 동작을 보낼 때 하는 일) */
export function resolveEventContext(context: Record<string, unknown>, dataModel: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    const path = value && typeof value === "object" ? (value as Record<string, unknown>)["@path"] : undefined;
    out[key] = typeof path === "string" ? readPointer(dataModel, path) : value;
  }
  return out;
}

/** 자동 채움 값을 입력 종류에 맞는 데이터 모델 값으로 바꾼다 (선택형은 문자열 목록) */
export function initialDraftValue(inputKind: string, value: unknown): unknown {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  if (inputKind === "yesNo") return YES_NO_VALUES.has(text) ? [text] : [];
  return text;
}

/** 데이터 모델의 입력값을 문서 초안으로 옮긴다 — 한 원소 목록은 그 원소, 빈 목록은 빈 문자열 */
export function dataModelToDraft(dataModel: unknown): Record<string, unknown> {
  return draftValuesToDraft((dataModel as Record<string, unknown> | null | undefined)?.[DRAFT_ROOT]);
}

/** 입력값 묶음(데이터 모델의 draft 가지, 또는 이벤트 문맥으로 받은 값)을 문서 초안으로 옮긴다 */
export function draftValuesToDraft(root: unknown): Record<string, unknown> {
  if (!root || typeof root !== "object" || Array.isArray(root)) return {};
  const draft: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      draft[key] = value.length === 0 ? "" : value.length === 1 ? value[0] : value.join(", ");
    } else {
      draft[key] = value;
    }
  }
  return draft;
}
