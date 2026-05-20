/**
 * applicability-rule.ts — Applicability 노드의 condition 결정론적 evaluator
 *
 * 외부 평가 보고서 (2026-05-20) — 결정론적 추론 규칙 레이어 부재 해소.
 *
 * 평가자 진단:
 *   "산안기준규칙 §42 (높이 2m 이상 → 안전대) 같은 명확한 법적 규칙이
 *    텍스트로만 존재. LLM 추론 의존 → 버전마다 결과 달라짐."
 *
 * 해결:
 *   Applicability 노드에 condition (JSON Logic) 명시. LLM 전에
 *   시스템이 먼저 '법적 필수' 결정론적 확정.
 *
 * Condition schema:
 *   { "all": [...] }                              — 모두 AND
 *   { "any": [...] }                              — 하나라도 OR
 *   { "not": {...} }                              — 부정
 *   { "var": "workforce", "op": ">=", "value": 5 } — 단일 비교
 *
 * Supported ops: ==, !=, >=, <=, >, <, in, not_in, has, exists
 *
 * Example (산안기준규칙 §42 추락방호):
 *   {
 *     "all": [
 *       { "var": "workHeight", "op": ">=", "value": 2, "unit": "m" },
 *       { "var": "edgeOpen", "op": "==", "value": true }
 *     ]
 *   }
 */

export type ConditionLeaf = {
  var: string;
  op: "==" | "!=" | ">=" | "<=" | ">" | "<" | "in" | "not_in" | "has" | "exists";
  value?: unknown;
  unit?: string;
};

export type ConditionGroup =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type Condition = ConditionLeaf | ConditionGroup;

export interface ApplicabilityContext {
  workforce?: number;
  constructionValue?: number; // 억원
  industry?: "construction" | "manufacturing" | "service" | "other";
  workHeight?: number; // m
  workDepth?: number; // m
  edgeOpen?: boolean;
  confinedSpace?: boolean;
  hotWork?: boolean;
  hazardousChemical?: boolean;
  workType?: string;
  contractor?: boolean;
  [k: string]: unknown;
}

/**
 * Condition 평가 — 결정론적 boolean.
 * 누락된 var 는 false (closed-world assumption).
 */
export function evaluateCondition(
  condition: Condition,
  ctx: ApplicabilityContext,
): boolean {
  // Group: all
  if ("all" in condition) {
    return condition.all.every((c) => evaluateCondition(c, ctx));
  }
  // Group: any
  if ("any" in condition) {
    return condition.any.some((c) => evaluateCondition(c, ctx));
  }
  // Group: not
  if ("not" in condition) {
    return !evaluateCondition(condition.not, ctx);
  }

  // Leaf
  const leaf = condition as ConditionLeaf;
  const value = ctx[leaf.var];
  const target = leaf.value;

  switch (leaf.op) {
    case "==":
      return value === target;
    case "!=":
      return value !== target;
    case ">=":
      return typeof value === "number" && typeof target === "number" && value >= target;
    case "<=":
      return typeof value === "number" && typeof target === "number" && value <= target;
    case ">":
      return typeof value === "number" && typeof target === "number" && value > target;
    case "<":
      return typeof value === "number" && typeof target === "number" && value < target;
    case "in":
      return Array.isArray(target) && target.includes(value);
    case "not_in":
      return Array.isArray(target) && !target.includes(value);
    case "has":
      return Array.isArray(value) && value.includes(target);
    case "exists":
      return value !== undefined && value !== null;
    default:
      return false;
  }
}

export interface ApplicabilityNode {
  "@id": string;
  "@type"?: string | string[];
  label?: string;
  condition?: Condition;
  enforces?: string[]; // control IRIs
  legalBasis?: string[]; // article IRIs
  legalWeight?: "mandatory" | "recommended" | "reference";
  exemptionNote?: string;
}

export interface EvaluationResult {
  applicabilityId: string;
  label: string;
  applies: boolean;
  legalBasis: string[];
  legalWeight: "mandatory" | "recommended" | "reference";
  enforces: string[]; // 적용 시 강제되는 control IRIs
  reason?: string;
}

/**
 * Applicability 노드 list 를 context 로 평가 — 모든 룰 결과 반환.
 */
export function evaluateAllApplicabilities(
  nodes: ApplicabilityNode[],
  ctx: ApplicabilityContext,
): EvaluationResult[] {
  return nodes
    .filter((n) => n.condition !== undefined)
    .map((node) => {
      const applies = evaluateCondition(node.condition!, ctx);
      return {
        applicabilityId: node["@id"],
        label: node.label ?? node["@id"],
        applies,
        legalBasis: node.legalBasis ?? [],
        legalWeight: node.legalWeight ?? "reference",
        enforces: applies ? (node.enforces ?? []) : [],
        reason: applies ? undefined : node.exemptionNote,
      };
    });
}
