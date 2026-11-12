/**
 * 공종 단계의 위험요인·감소대책을 거꾸로 찾는다.
 *
 * 공종 노드 안의 단계·위험요인·대책은 주소가 있는 그래프 노드다 (graph-nodes-loader 가 색인).
 *   공종 --hasStep--> 단계 --hasRisk--> 위험요인 --hasHazard--> 유해요인
 *                                        위험요인 --mitigatedBy--> 대책 --basis--> 조문·별표·가이드
 * 여기서는 그 연결을 반대로 따라간다.
 *   - 조문·별표·가이드 → 그것을 근거로 한 대책 → 그 대책이 쓰이는 공종
 *   - 유해요인 → 그 유해요인의 위험요인 → 대책
 */
import { getNode, neighborsByEdge } from "./graph-nodes-loader.js";

// ── 상수 ────────────────────────────────────────────────────────────
/** 대책 위계 표시 순서 (제거 → 대체 → 공학 → 관리 → 보호구) */
export const CONTROL_LEVEL_ORDER = ["elimination", "substitution", "engineering", "administrative", "ppe"] as const;
export const CONTROL_LEVEL_LABEL: Record<string, string> = {
  elimination: "제거",
  substitution: "대체",
  engineering: "공학적 대책",
  administrative: "관리적 대책",
  ppe: "보호구",
};

interface MeasureNode {
  "@id": string;
  measure?: string;
  controlLevel?: string;
  variant?: string;
  basis?: {
    basisArticle?: string;
    basisAnnex?: string;
    basisGuide?: string;
    guideSection?: string;
    paragraph?: number;
    item?: number;
    subitem?: string;
  };
}
interface RiskNode {
  "@id": string;
  statement?: string;
  priority?: string;
  hazardLabel?: string;
  partOf?: string;
  mitigatedBy?: string[];
}

export interface FieldMeasure {
  iri: string;
  measure: string;
  controlLevel?: string;
  /** 공법·조건 구분 */
  variant?: string;
  /** 근거의 세부 위치 — "제2항 제1호", 가이드는 조항 번호 */
  scope?: string;
  /** 이 대책이 쓰이는 공종 이름 */
  works: string[];
}

/** 근거 참조의 세부 위치를 글로 */
function scopeLabel(b: MeasureNode["basis"]): string | undefined {
  if (!b) return undefined;
  if (b.basisGuide) return b.guideSection;
  const parts = [
    b.paragraph ? `제${b.paragraph}항` : "",
    b.item ? `제${b.item}호` : "",
    b.subitem ? `${b.subitem}목` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/** 위험요인 노드가 속한 공종의 이름 (위험요인 → 단계 → 공종) */
async function workNameOfRisk(riskId: string): Promise<string | undefined> {
  const risk = (await getNode(riskId)) as unknown as RiskNode | undefined;
  const step = risk?.partOf ? ((await getNode(risk.partOf)) as unknown as { partOf?: string } | undefined) : undefined;
  const work = step?.partOf ? ((await getNode(step.partOf)) as unknown as { title?: string } | undefined) : undefined;
  return work?.title;
}

async function toFieldMeasure(measureId: string): Promise<FieldMeasure | null> {
  const node = (await getNode(measureId)) as unknown as MeasureNode | undefined;
  if (!node?.measure) return null;
  const works = new Set<string>();
  for (const riskId of await neighborsByEdge(measureId, "mitigatedBy", "in")) {
    const name = await workNameOfRisk(riskId);
    if (name) works.add(name);
  }
  const scope = scopeLabel(node.basis);
  return {
    iri: measureId,
    measure: node.measure,
    ...(node.controlLevel ? { controlLevel: node.controlLevel } : {}),
    ...(node.variant ? { variant: node.variant } : {}),
    ...(scope ? { scope } : {}),
    works: [...works].sort((a, b) => a.localeCompare(b, "ko")),
  };
}

/** 항·호 번호 순으로 정렬하기 위한 키 ("제2항 제10호" → [2, 10]) */
function scopeSortKey(scope: string | undefined): number[] {
  return (scope?.match(/\d+/g) ?? []).map(Number);
}

function compareScope(a: FieldMeasure, b: FieldMeasure): number {
  const ka = scopeSortKey(a.scope);
  const kb = scopeSortKey(b.scope);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d !== 0) return d;
  }
  return b.works.length - a.works.length || a.measure.localeCompare(b.measure, "ko");
}

/** 조문·별표·가이드(IRI)를 근거로 한 감소대책 전부 — 세부 위치 순 */
export async function findMeasuresCiting(basisIri: string): Promise<FieldMeasure[]> {
  const ids = [...new Set(await neighborsByEdge(basisIri, "basis", "in"))];
  const out: FieldMeasure[] = [];
  for (const id of ids) {
    const m = await toFieldMeasure(id);
    if (m) out.push(m);
  }
  return out.sort(compareScope);
}

export interface HazardFieldMeasures {
  /** 이 유해요인으로 분류된 위험요인 수 */
  riskCount: number;
  /** 그 위험요인이 나오는 공종 이름 */
  works: string[];
  /** 대책 — 여러 공종에서 쓰이는 것부터 */
  measures: FieldMeasure[];
}

/** 유해요인(IRI)의 위험요인이 나오는 공종과, 그 위험요인에 붙은 감소대책 전부 */
export async function findFieldMeasuresForHazard(hazardIri: string): Promise<HazardFieldMeasures> {
  const riskIds = (await neighborsByEdge(hazardIri, "hasHazard", "in")).filter((id) => id.startsWith("workrisk:"));
  const works = new Set<string>();
  const measureIds = new Set<string>();
  for (const riskId of riskIds) {
    const name = await workNameOfRisk(riskId);
    if (name) works.add(name);
    const risk = (await getNode(riskId)) as unknown as RiskNode | undefined;
    for (const id of risk?.mitigatedBy ?? []) measureIds.add(id);
  }
  const measures: FieldMeasure[] = [];
  for (const id of measureIds) {
    const m = await toFieldMeasure(id);
    if (m) measures.push(m);
  }
  measures.sort((a, b) => b.works.length - a.works.length || a.measure.localeCompare(b.measure, "ko"));
  return { riskCount: riskIds.length, works: [...works].sort((a, b) => a.localeCompare(b, "ko")), measures };
}
