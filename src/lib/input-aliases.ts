/**
 * input-aliases.ts
 *
 * Issue #6 (2026-05-21) — enum / 필드명 자연어 alias 지원.
 *
 * 한국어 도메인 도구이므로 영문 + 한국어 동의어 모두 받아들임.
 * 첫 시도 실패율을 낮춰 onboarding 마찰 감소.
 *
 * 사용 패턴:
 *   import { z } from "zod";
 *   import { aliasedEnum, aliasedField } from "../lib/input-aliases.js";
 *
 *   severity: aliasedEnum(["fatal", "serious", "minor"], {
 *     fatality: "fatal", death: "fatal", 사망: "fatal",
 *     critical: "serious", major: "serious", 중상: "serious",
 *     light: "minor", slight: "minor", 경상: "minor",
 *   }).describe(...)
 *
 *   inputSchema = aliasedField(
 *     z.object({ workOrTopic: z.string() }),
 *     { topic: "workOrTopic", workName: "workOrTopic", 작업명: "workOrTopic" }
 *   )
 */
import { z } from "zod";

// enum alias — z.preprocess 로 alias 값을 canonical 로 변환 후 z.enum 평가.
// canonical 값은 그대로 통과. alias 값은 매핑 후 통과. 그 외는 enum 거부.
// 반환 타입은 ZodTypeAny — z.infer 는 호출처에서 z.enum 의 union 으로 잘 좁혀짐.
export function aliasedEnum<T extends readonly [string, ...string[]]>(
  canonical: T,
  aliasMap: Record<string, T[number]>,
): z.ZodType<T[number]> {
  const innerEnum = z.enum(canonical as unknown as [string, ...string[]]);
  return z.preprocess((v) => {
    if (typeof v !== "string") return v;
    if (aliasMap[v]) return aliasMap[v];
    const lower = v.toLowerCase();
    for (const [k, target] of Object.entries(aliasMap)) {
      if (k.toLowerCase() === lower) return target;
    }
    return v;
  }, innerEnum) as unknown as z.ZodType<T[number]>;
}

// 필드명 alias — 객체 입력에서 alias 키를 canonical 키로 매핑.
// 예: { topic: "굴착" } → { workOrTopic: "굴착" }
// alias 와 canonical 이 모두 들어오면 canonical 우선.
export function withFieldAliases<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  aliasMap: Record<string, keyof T & string>,
): z.ZodType<z.infer<z.ZodObject<T>>> {
  return z.preprocess((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = { ...obj };
    for (const [aliasKey, canonicalKey] of Object.entries(aliasMap)) {
      if (aliasKey in obj && !(canonicalKey in obj)) {
        out[canonicalKey] = obj[aliasKey];
        delete out[aliasKey];
      }
    }
    return out;
  }, schema) as unknown as z.ZodType<z.infer<z.ZodObject<T>>>;
}

// 자주 쓰는 사전들
export const SEVERITY_ALIASES: Record<string, "fatal" | "serious" | "minor"> = {
  // 영문
  fatality: "fatal",
  death: "fatal",
  deceased: "fatal",
  killed: "fatal",
  critical: "serious",
  major: "serious",
  severe: "serious",
  light: "minor",
  slight: "minor",
  minor_injury: "minor",
  // 한국어
  사망: "fatal",
  사망자: "fatal",
  중대재해: "fatal",
  중상: "serious",
  중상자: "serious",
  중대: "serious",
  경상: "minor",
  경미: "minor",
  경미사고: "minor",
};

// 업종 alias — assess_my_obligations / query_applicability 등 진입점
export const INDUSTRY_ALIASES: Record<string, "construction" | "manufacturing" | "service" | "other"> = {
  // 영문 변형
  build: "construction",
  building: "construction",
  civil: "construction",
  manufacture: "manufacturing",
  factory: "manufacturing",
  services: "service",
  // 한국어
  건설: "construction",
  건설업: "construction",
  토목: "construction",
  건축: "construction",
  제조: "manufacturing",
  제조업: "manufacturing",
  공장: "manufacturing",
  서비스: "service",
  서비스업: "service",
  기타: "other",
  그외: "other",
};

// 공사 단계 alias — get_construction_stage_duties
export const STAGE_ALIASES: Record<string, "pre" | "active" | "post"> = {
  // 영문 변형
  before: "pre",
  prepare: "pre",
  preparation: "pre",
  preconstruction: "pre",
  ongoing: "active",
  during: "active",
  inprogress: "active",
  in_progress: "active",
  after: "post",
  completion: "post",
  completed: "post",
  // 한국어
  착공전: "pre",
  착공_전: "pre",
  사전: "pre",
  준비: "pre",
  시공: "active",
  시공중: "active",
  진행: "active",
  진행중: "active",
  준공: "post",
  완공: "post",
  완료: "post",
  사후: "post",
};

// 보고 주기 alias — safety_report.period
export const PERIOD_ALIASES: Record<string, "weekly" | "monthly"> = {
  // 영문 변형
  week: "weekly",
  weeks: "weekly",
  per_week: "weekly",
  month: "monthly",
  months: "monthly",
  per_month: "monthly",
  // 한국어
  주: "weekly",
  주간: "weekly",
  주별: "weekly",
  매주: "weekly",
  월: "monthly",
  월간: "monthly",
  월별: "monthly",
  매월: "monthly",
};
