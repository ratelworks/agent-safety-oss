/**
 * osh-cost.ts — 건설업 산업안전보건관리비 계상 계산
 *
 * 요율·기초액은 코드에 두지 않는다 — 관리비 사용계획서 문서 노드(safety_health_mgmt_cost_plan)의
 * calculationBasis.rateTable(고시 별표 1)에서 읽어 계산만 한다 (그래프가 법적 사실의 SSoT).
 *
 * 근거: 건설업 산업안전보건관리비 계상 및 사용기준(고용노동부 고시) 제4조제1항
 *   1. 대상액 5억 원 미만 또는 50억 원 이상: 대상액 × 별표 1 비율
 *   2. 대상액 5억 원 이상 50억 원 미만: 대상액 × 별표 1 비율 + 기초액
 *   3. 대상액이 명확하지 않은 경우: 총공사금액의 10분의 7 을 대상액으로 한다
 * 금액은 원 단위 정수로 다룬다(비율은 만분율 정수로 곱해 부동소수 오차를 피한다).
 */

// ── 상수 ────────────────────────────────────────────────────────────
const FIVE_HUNDRED_MILLION = 500_000_000;
const FIVE_BILLION = 5_000_000_000;
/** 대상액이 명확하지 않을 때 총공사금액에 곱하는 비율 (고시 제4조제1항제3호: 10분의 7) */
const UNCLEAR_BASE_NUMERATOR = 7;
const UNCLEAR_BASE_DENOMINATOR = 10;

/** 고시 별표 1 한 줄 — 비율은 % 값(예: 2.28) */
export interface OshCostRateRow {
  type: string; // 건축공사·토목공사·중건설공사·특수건설공사
  keywords: string[]; // 공사 종류 문자열 판별용
  matchOrder?: number; // 판별 우선순위 (작을수록 먼저)
  under500M: number;
  from500MTo5B: number;
  baseAmount: number; // 5억~50억 구간 기초액(원)
  over5B: number;
  healthManagerSite: number; // 영 별표 5 보건관리자 선임 대상 건설공사
}

export interface OshCostResult {
  type: string;
  baseAmount: number; // 대상액(원)
  baseEstimated: boolean; // 총공사금액 × 7/10 으로 추정했는지
  ratePercent: number;
  fixedAmount: number; // 기초액(원) — 해당 구간이 아니면 0
  total: number; // 계상액(원)
  bracket: "5억 원 미만" | "5억 원 이상 50억 원 미만" | "50억 원 이상";
}

/** % 값을 만분율 정수로 (2.28 → 228) */
function toBasisPoints(percent: number): number {
  return Math.round(percent * 100);
}

/** 공사 종류 문자열에서 별표 1 공사종류를 찾는다 — 못 찾으면 undefined (추측해 채우지 않는다) */
export function matchRateRow(constructionType: string | undefined, table: OshCostRateRow[]): OshCostRateRow | undefined {
  if (!constructionType) return undefined;
  const t = constructionType.replace(/\s+/g, "");
  // 판별 순서는 노드의 matchOrder(작을수록 먼저) — 별표 5 상 더 구체적인 공사종류(중건설·특수건설)를 먼저 본다
  const ordered = [...table].sort((a, b) => (a.matchOrder ?? 99) - (b.matchOrder ?? 99));
  return ordered.find((row) => row.keywords.some((k) => t.includes(k.replace(/\s+/g, ""))));
}

/** 총공사금액 → 대상액 추정 (대상액이 명확하지 않은 경우, 10분의 7) */
export function estimateBaseFromContract(contractAmount: number): number {
  return Math.floor((contractAmount * UNCLEAR_BASE_NUMERATOR) / UNCLEAR_BASE_DENOMINATOR);
}

export function computeOshCost(
  row: OshCostRateRow,
  baseAmount: number,
  options: { healthManagerSite?: boolean; baseEstimated?: boolean } = {},
): OshCostResult {
  const base = Math.max(0, Math.floor(baseAmount));
  let ratePercent: number;
  let fixedAmount = 0;
  let bracket: OshCostResult["bracket"];
  if (base < FIVE_HUNDRED_MILLION) {
    ratePercent = row.under500M;
    bracket = "5억 원 미만";
  } else if (base < FIVE_BILLION) {
    ratePercent = row.from500MTo5B;
    fixedAmount = row.baseAmount;
    bracket = "5억 원 이상 50억 원 미만";
  } else {
    ratePercent = options.healthManagerSite ? row.healthManagerSite : row.over5B;
    bracket = "50억 원 이상";
  }
  const total = Math.floor((base * toBasisPoints(ratePercent)) / 10_000) + fixedAmount;
  return {
    type: row.type,
    baseAmount: base,
    baseEstimated: options.baseEstimated ?? false,
    ratePercent,
    fixedAmount,
    total,
    bracket,
  };
}

/** 문서 노드의 calculationBasis 에서 요율표를 꺼낸다 (형식이 맞지 않으면 빈 배열) */
export function readRateTable(node: unknown): OshCostRateRow[] {
  const basis = (node as { calculationBasis?: { rateTable?: unknown } } | undefined)?.calculationBasis;
  if (!basis || !Array.isArray(basis.rateTable)) return [];
  return (basis.rateTable as OshCostRateRow[]).filter(
    (r) =>
      typeof r?.type === "string" &&
      Array.isArray(r.keywords) &&
      [r.under500M, r.from500MTo5B, r.baseAmount, r.over5B, r.healthManagerSite].every((v) => typeof v === "number"),
  );
}
