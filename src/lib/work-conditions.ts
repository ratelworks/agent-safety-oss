/**
 * 작업 조건 층 — 날씨·시간·장소·동시작업·자재·작업자 조건마다 법령·KOSHA Guide 원문이 정한 조치.
 * 조건 노드(WorkCondition)는 조치 문장을 원문 줄 그대로 가지고, 조문이 특정 작업·공종을 가리키면 그 대상을 적어 둔다.
 * 여기서는 현장 말("강풍", "야간", "우천")을 조건 노드에 맞추고, 지금 작업에 해당하는 조치를 앞에 둔다.
 */
import { listNodesByType, getNode } from "./graph-nodes-loader.js";
import { renderIri } from "./iri-renderer.js";

// ── 상수 ────────────────────────────────────────────────────────────
const WORK_CONDITION_TYPE = "WorkCondition";
/** 이보다 짧은 이름은 질문 속에 들어 있어도 맞추지 않는다 (완전히 같을 때만 맞춘다) — "비"·"눈" */
const MIN_CONTAINED_LENGTH = 2;
/** 조치가 어느 작업에 해당하는지 표시하는 값 */
export const RULE_SCOPE = {
  thisWork: "이 작업에 해당",
  anyWork: "작업 종류와 무관",
  otherWork: "다른 작업에 해당",
} as const;
/** 원문 근거를 찾지 못해 조건 노드로 두지 않은 조건과 그 이유 — 입력이 이 이름이면 "없음"이 아니라 이유를 돌려준다 */
const NOT_COVERED_CONDITIONS: { names: string[]; reason: string }[] = [
  {
    names: ["안개", "시야불량", "시야 불량", "시계 불량"],
    reason: "법령·KOSHA Guide 에 기상 안개에 대한 조치 조문이 없어 수록하지 않았다 (터널 내부 시계 유지 조문은 배기가스·분진에 관한 것).",
  },
  { names: ["협소공간", "협소 공간"], reason: "법령·KOSHA Guide 에 '협소공간' 조건으로 정한 조치가 없어 수록하지 않았다 (밀폐공간은 따로 있다)." },
  {
    names: ["장척 자재", "장척", "비산성 자재", "파손·비산성 자재"],
    reason: "법령·KOSHA Guide 에 이 자재 성질로 정한 조치가 없어 수록하지 않았다.",
  },
];
export const WORK_CONDITIONS_NOTICE =
  "조건별 조치 문장은 법령·KOSHA Guide 원문을 그대로 옮긴 것입니다. 법령 조치는 의무, KOSHA Guide 조치는 권고입니다. 어느 작업에 해당하는지는 조문이 그 작업을 직접 가리키는 경우에만 표시했습니다.";

interface ConditionRuleNode {
  requirement: string;
  basisArticle?: string;
  paragraph?: number;
  item?: number;
  basisGuide?: string;
  guideSection?: string;
  guideClause?: string;
  threshold?: string;
  legalWeight?: string;
  appliesToActivity?: string[];
  appliesTo?: string[];
}
interface ConditionNode {
  "@id": string;
  title: string;
  altLabel?: string[];
  conditionAxis?: string;
  description?: string;
  conditionRules?: ConditionRuleNode[];
}

export interface ResolvedConditionRule {
  requirement: string;
  basis: string;
  basisIri: string;
  threshold?: string;
  legalWeight: string;
  scope: (typeof RULE_SCOPE)[keyof typeof RULE_SCOPE];
  /** 조문이 가리키는 작업·공종 이름 (작업 종류와 무관한 조치는 없음) */
  appliesTo?: string[];
}
export interface ResolvedCondition {
  condition: string;
  title: string;
  axis?: string;
  description?: string;
  /** 입력의 어느 말로 맞췄는지 */
  matchedBy: string;
  rules: ResolvedConditionRule[];
}

let cache: ConditionNode[] | null = null;
async function loadConditions(): Promise<ConditionNode[]> {
  if (cache) return cache;
  cache = (await listNodesByType(WORK_CONDITION_TYPE)) as unknown as ConditionNode[];
  return cache;
}

function normalize(s: string): string {
  return s.replace(/[\s·ㆍ\-_/]/g, "").toLowerCase();
}

/** 입력 말 하나가 조건에 맞으면 맞춘 이름, 아니면 null — 같으면 맞고, 두 글자 이상 이름은 말 속에 들어 있어도 맞는다 */
function matchName(input: string, cond: ConditionNode): string | null {
  const q = normalize(input);
  if (!q) return null;
  for (const name of [cond.title, ...(cond.altLabel ?? [])]) {
    const n = normalize(name);
    if (!n) continue;
    if (n === q) return name;
    if (n.length >= MIN_CONTAINED_LENGTH && q.includes(n)) return name;
  }
  return null;
}

async function labelOf(iri: string): Promise<string> {
  const node = (await getNode(iri)) as { title?: string; label?: string } | undefined;
  return node?.title ?? node?.label ?? iri;
}

async function basisLabel(rule: ConditionRuleNode): Promise<{ label: string; iri: string }> {
  if (rule.basisArticle) {
    const base = renderIri(rule.basisArticle);
    const para = rule.paragraph ? ` 제${rule.paragraph}항` : "";
    const item = rule.item ? ` 제${rule.item}호` : "";
    return { label: `${base}${para}${item}`, iri: rule.basisArticle };
  }
  const no = (rule.basisGuide ?? "").split("/").pop() ?? "";
  const where = [rule.guideSection, rule.guideClause].filter(Boolean).join(" ");
  return { label: `KOSHA Guide ${no}${where ? ` ${where}` : ""}`, iri: rule.basisGuide ?? "" };
}

/**
 * 조건 이름들을 조건 노드에 맞추고, 조건마다 조치를 정리한다.
 * work 를 주면 조치를 이 작업에 해당 → 작업 종류와 무관 → 다른 작업에 해당 순으로 둔다.
 */
export async function resolveWorkConditions(
  inputs: string[],
  work?: { iri?: string; activity?: string },
): Promise<{ conditions: ResolvedCondition[]; unmatched: string[]; notCovered: { input: string; reason: string }[] }> {
  const conds = await loadConditions();
  const out: ResolvedCondition[] = [];
  const unmatched: string[] = [];
  const notCovered: { input: string; reason: string }[] = [];
  const seen = new Set<string>();
  const targets = new Set([work?.iri, work?.activity].filter((x): x is string => Boolean(x)));
  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) continue;
    const hits = conds
      .map((c) => ({ c, name: matchName(input, c) }))
      .filter((h): h is { c: ConditionNode; name: string } => h.name !== null);
    if (hits.length === 0) {
      const known = NOT_COVERED_CONDITIONS.find((n) => n.names.some((name) => normalize(input).includes(normalize(name))));
      if (known) notCovered.push({ input, reason: known.reason });
      else unmatched.push(input);
      continue;
    }
    for (const { c, name } of hits) {
      if (seen.has(c["@id"])) continue;
      seen.add(c["@id"]);
      const rules: ResolvedConditionRule[] = [];
      for (const r of c.conditionRules ?? []) {
        const scoped = [...(r.appliesToActivity ?? []), ...(r.appliesTo ?? [])];
        const scope =
          scoped.length === 0
            ? RULE_SCOPE.anyWork
            : scoped.some((t) => targets.has(t))
              ? RULE_SCOPE.thisWork
              : RULE_SCOPE.otherWork;
        const basis = await basisLabel(r);
        rules.push({
          requirement: r.requirement,
          basis: basis.label,
          basisIri: basis.iri,
          ...(r.threshold ? { threshold: r.threshold } : {}),
          legalWeight: r.legalWeight ?? (r.basisArticle ? "mandatory" : "recommended"),
          scope,
          ...(scoped.length ? { appliesTo: [...new Set(await Promise.all(scoped.map(labelOf)))] } : {}),
        });
      }
      const order = [RULE_SCOPE.thisWork, RULE_SCOPE.anyWork, RULE_SCOPE.otherWork];
      rules.sort((a, b) => order.indexOf(a.scope) - order.indexOf(b.scope));
      out.push({
        condition: c["@id"],
        title: c.title,
        ...(c.conditionAxis ? { axis: c.conditionAxis } : {}),
        ...(c.description ? { description: c.description } : {}),
        matchedBy: name,
        rules,
      });
    }
  }
  return { conditions: out, unmatched, notCovered };
}

/** 번들에 있는 작업 조건 이름 (입력 안내용) */
export async function listWorkConditionTitles(): Promise<string[]> {
  return (await loadConditions()).map((c) => c.title).sort((a, b) => a.localeCompare(b, "ko"));
}
