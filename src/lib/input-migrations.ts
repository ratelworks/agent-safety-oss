/**
 * input-migrations.ts — 양식 개정으로 없어지거나 형식이 바뀐 입력 칸 처리
 *
 * 문서 노드 _meta.inputMigrations 에 선언된 규칙을 draft 에 적용한다 (규칙은 노드가, 적용은 코드가).
 * 옛 입력 키를 넘긴 호출이 오류로 끝나지 않게 하는 것이 목적이다.
 *
 *   - drop              : 그 칸이 서식에서 사라졌다 — 값을 지우고 무시한 사실을 기록한다
 *   - keepLeadingDigits : 숫자 앞 N 자리만 받는다 — 더 긴 값이 오면 앞 N 자리만 남기고 나머지는 *로 가린다
 *                         (예: 주민등록번호 13자리 → "830101-1******")
 */

// ── 상수 ────────────────────────────────────────────────────────────
const MASK_CHAR = "*";
/** 주민등록번호·외국인등록번호 형태(생년월일 6자리 + 뒷자리)일 때 하이픈을 넣는 위치 */
const BIRTHDATE_DIGITS = 6;

export type InputMigrationRule =
  | { key: string; action: "drop"; reason?: string }
  | { key: string; action: "keepLeadingDigits"; digits: number; reason?: string };

export interface InputMigrationNote {
  key: string;
  action: InputMigrationRule["action"];
  detail: string;
}

/** 노드에서 규칙을 꺼낸다 — 형식이 맞지 않는 규칙은 버린다 */
export function readInputMigrations(doc: unknown): InputMigrationRule[] {
  const rules = (doc as { _meta?: { inputMigrations?: unknown } } | undefined)?._meta?.inputMigrations;
  if (!Array.isArray(rules)) return [];
  return rules.filter((r): r is InputMigrationRule => {
    if (!r || typeof r !== "object" || typeof (r as { key?: unknown }).key !== "string") return false;
    const a = (r as { action?: unknown }).action;
    if (a === "drop") return true;
    return a === "keepLeadingDigits" && Number.isInteger((r as { digits?: unknown }).digits);
  });
}

/** 숫자 앞 N 자리만 남긴 표기 — 6자리 뒤에 하이픈, 남은 자리는 * (13자리 기준) */
export function keepLeadingDigits(value: string, digits: number): string | null {
  const only = value.replace(/\D/g, "");
  if (only.length <= digits) return null; // 이미 N 자리 이하 — 바꾸지 않는다
  const kept = only.slice(0, digits);
  const masked = MASK_CHAR.repeat(only.length - digits);
  if (digits > BIRTHDATE_DIGITS) {
    return `${kept.slice(0, BIRTHDATE_DIGITS)}-${kept.slice(BIRTHDATE_DIGITS)}${masked}`;
  }
  return `${kept}${masked}`;
}

/** draft(와 draft.raw)에 규칙을 적용하고, 바꾼 내용을 돌려준다 */
export function applyInputMigrations(
  draft: Record<string, unknown> | undefined,
  rules: InputMigrationRule[],
): InputMigrationNote[] {
  const notes: InputMigrationNote[] = [];
  if (!draft || rules.length === 0) return notes;
  const containers: Record<string, unknown>[] = [draft];
  if (draft.raw && typeof draft.raw === "object") containers.push(draft.raw as Record<string, unknown>);

  for (const rule of rules) {
    for (const box of containers) {
      if (!(rule.key in box)) continue;
      if (rule.action === "drop") {
        delete box[rule.key];
        notes.push({ key: rule.key, action: rule.action, detail: rule.reason ?? "현행 서식에 없는 칸 — 무시" });
        continue;
      }
      const v = box[rule.key];
      if (typeof v !== "string" && typeof v !== "number") continue;
      const next = keepLeadingDigits(String(v), rule.digits);
      if (next !== null) {
        box[rule.key] = next;
        notes.push({ key: rule.key, action: rule.action, detail: rule.reason ?? `앞 ${rule.digits}자리만 남김` });
      }
    }
  }
  return notes;
}
