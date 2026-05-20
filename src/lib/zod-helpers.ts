import { z } from "zod";

// 파일 최상단 상수 — 안전한 boolean coercion
// z.coerce.boolean() 은 Boolean(input) 을 사용해 "false" 같은 비어있지 않은
// 문자열을 전부 true 로 만든다. 안전관리 도구에서는 이 부작용이 치명적이므로
// 별도 헬퍼를 사용한다.

const TRUE_LITERALS = new Set(["true", "1", "yes", "on"]);
const FALSE_LITERALS = new Set(["false", "0", "no", "off"]);

/**
 * 안전한 boolean 파서 — 진짜 boolean, 또는 사전에 정의된 literal 문자열만 허용.
 * 그 외(빈 문자열, 임의 문자열, 숫자 등)는 거절한다.
 */
export const stringBool = z
  .union([z.boolean(), z.string()])
  .transform((v, ctx) => {
    if (typeof v === "boolean") return v;
    const normalized = v.trim().toLowerCase();
    if (TRUE_LITERALS.has(normalized)) return true;
    if (FALSE_LITERALS.has(normalized)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `"${v}" 은 boolean 값이 아님. true/false, 1/0, yes/no 중 하나여야 함.`,
    });
    return z.NEVER;
  });
