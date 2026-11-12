/**
 * work-steps.ts — 공종(ConstructionSubtask 노드)의 작업 단계와 단계별 근거 조회
 *
 * 공종 노드는 참조만 담는다(조문의 항·호·목, 별표, KOSHA Guide 조항, 관련 고시).
 * 읽을 내용은 여기서 조문 노드와 가이드 본문에서 꺼내 붙인다.
 */

import { getNode, listDocuments, listNodesByType, neighborsByEdge } from "./graph-nodes-loader.js";
import { getKoshaGuideMd } from "./kosha-guides-loader.js";

// ── 상수 ────────────────────────────────────────────────────────────
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";
/** 호가 지정되지 않은 근거에서 항·조문 본문을 앞부분만 보여 줄 때의 최대 길이 (호·목 발췌는 자르지 않는다) */
const PARAGRAPH_MAX_CHARS = 220;
/** 한 단계·재해유형에 보여 줄 근거 수 상한 (자주 쓰이는 순으로 정렬돼 있다) */
const MAX_BASIS_PER_HAZARD = 6;
/** 공종 이름 매칭 점수 */
const SCORE_EXACT = 100;
const SCORE_CONTAINS = 60;
const SCORE_TOKEN = 20;
/** 매칭에 쓰지 않는 흔한 낱말 */
const GENERIC_TOKENS: ReadonlySet<string> = new Set(["작업", "공사", "시공", "설치", "해체", "조립"]);
/** 내용으로 찾을 때 낱말 끝에서 떼어 보는 조사·어미 (긴 것부터) */
const PARTICLES = ["으로", "에서", "하는데", "한다", "하고", "를", "을", "로", "에", "이", "가", "은", "는", "의", "와", "과", "도"];
/** 내용으로 찾을 때 쓰는 낱말 — 이보다 많은 공종에 나오는 낱말은 공종을 가리지 못하므로 쓰지 않는다 */
const CONTENT_TOKEN_MAX_WORKS = 8;
/** 내용으로 찾았다고 보려면 맞은 낱말이 이만큼은 있어야 한다 — 낱말 하나로는 우연히 맞는 일이 많다 */
const CONTENT_MIN_WORDS = 2;
/** 공종 하나에 보여 줄 관련 문서 수 상한 */
const MAX_RELATED_DOCUMENTS = 8;

const CONTROL_LEVEL_KO: Record<string, string> = {
  elimination: "제거",
  substitution: "대체",
  engineering: "공학적 대책",
  administrative: "관리적 대책",
  ppe: "보호구",
};

interface BasisRef {
  article?: string;
  paragraph?: number;
  /** 호 번호 (조문·별표 공통) */
  item?: number;
  /** 목 (가·나·다…) */
  subitem?: string;
  annex?: string;
  guide?: string;
  section?: string;
  controlLevel?: string;
}
interface StepHazard {
  hazardLabel: string;
  hazard?: string;
  basis: BasisRef[];
  /** 위험요인과 그 대책 */
  risks?: { statement: string; priority?: string; measures: { measure: string; controlLevel?: string; variant?: string; basis?: BasisRef }[] }[];
}
interface WorkStep {
  name: string;
  hazards: StepHazard[];
}
interface Work {
  /** 공종 노드 IRI */
  iri: string;
  name: string;
  group: string;
  activity?: string;
  /** 관련 고시(법령 노드)와 그 조문 */
  references: string[];
  /** 연결 종류별로 그 연결을 정한 방식 (노드 _meta.linkBasis) */
  linkBasis: Record<string, string>;
  steps: WorkStep[];
}
interface SubtaskNode {
  "@id": string;
  title: string;
  workGroup: string;
  broader?: string;
  references?: string[];
  _meta?: { linkBasis?: Record<string, string> };
  steps: { stepName: string; stepHazards: RawStepHazard[] }[];
}
/** 공종 노드에 적힌 그대로의 근거 참조 — 필드 이름이 문맥의 주소 접두어와 겹치지 않게 돼 있다 */
interface RawBasisRef {
  basisArticle?: string;
  basisAnnex?: string;
  basisGuide?: string;
  guideSection?: string;
  paragraph?: number;
  item?: number;
  subitem?: string;
  controlLevel?: string;
}
interface RawStepHazard {
  hazardLabel: string;
  hasHazard?: string;
  basis?: RawBasisRef[];
  risks?: { statement: string; priority?: string; measures?: { measure: string; controlLevel?: string; variant?: string; basis?: RawBasisRef }[] }[];
}

function toBasisRef(b: RawBasisRef): BasisRef {
  const { basisArticle, basisAnnex, basisGuide, guideSection, ...rest } = b;
  return {
    ...rest,
    ...(basisArticle ? { article: basisArticle } : {}),
    ...(basisAnnex ? { annex: basisAnnex } : {}),
    ...(basisGuide ? { guide: basisGuide } : {}),
    ...(guideSection ? { section: guideSection } : {}),
  };
}

function toStepHazard(h: RawStepHazard): StepHazard {
  return {
    hazardLabel: h.hazardLabel,
    ...(h.hasHazard ? { hazard: h.hasHazard } : {}),
    basis: (h.basis ?? []).map(toBasisRef),
    risks: (h.risks ?? []).map((r) => ({
      statement: r.statement,
      ...(r.priority ? { priority: r.priority } : {}),
      measures: (r.measures ?? []).map((m) => ({
        measure: m.measure,
        ...(m.controlLevel ? { controlLevel: m.controlLevel } : {}),
        ...(m.variant ? { variant: m.variant } : {}),
        ...(m.basis ? { basis: toBasisRef(m.basis) } : {}),
      })),
    })),
  };
}

export interface ResolvedBasis {
  kind: "law" | "kosha_guide";
  ref: string;
  title: string;
  /** 조문이면 해당 항 본문(발췌), 가이드면 해당 조항 제목 */
  text?: string;
  controlLevel?: string;
  legalWeight: "mandatory" | "recommended";
}
/**
 * 연결을 정한 방식 (노드 _meta.linkBasis)
 *   source    원천 자료에 그대로 있는 연결
 *   mapped    이름 대응표로 이은 연결
 *   editorial 내용을 읽고 정한 연결 — 현장 검토 전
 */
export const LINK_BASIS_LABEL: Record<string, string> = {
  source: "원천 자료에 있는 연결",
  mapped: "이름 대응표로 이은 연결",
  editorial: "내용을 읽고 정한 연결 (현장 검토 전)",
};

export interface RelatedNotice {
  /** 고시 이름 */
  law: string;
  /** 이 공종과 고시를 이은 방식 — LINK_BASIS_LABEL 참조 */
  linkBasis?: string;
  /** 공종·단계 이름과 제목이 맞는 조문. 맞는 조문이 없으면 빈 배열(고시 전체를 살핀다) */
  articles: { ref: string; title: string }[];
  legalWeight: "recommended";
}
export interface RelatedDocument {
  docId: string;
  title: string;
  cycle?: string;
  /** 이 문서를 작성하는 때 (문서 노드에 적힌 조건) — 해당하는지는 현장에서 확인한다 */
  when?: string;
}
export interface ResolvedWorkSteps {
  /** 공종 노드 IRI */
  iri: string;
  group: string;
  work: string;
  activity?: string;
  /** 이 공사를 다루는 표준안전 작업지침(권고 기준) */
  relatedNotices?: RelatedNotice[];
  /** 연결된 작업과 관련된 문서 — 작성 조건(when)에 해당할 때만 필요하다 */
  relatedDocuments?: RelatedDocument[];
  /** 공종 이름이 아니라 자료 안의 낱말로 찾았을 때 그 낱말 — 맞는 공종인지 확인이 필요하다 */
  matchedByContent?: string[];
  /** 연결 종류별로 그 연결을 정한 방식 (예: 상위 작업 = 내용을 읽고 정함) — 값의 뜻은 linkBasisLegend */
  linkBasis?: Record<string, string>;
  linkBasisLegend?: Record<string, string>;
  /** 이 공종 자료에서 이어지지 않은 것 — 없다고 확인된 것이 아니라 연결이 없는 것이다 */
  gaps?: string[];
  steps: {
    name: string;
    hazards: {
      hazardLabel: string;
      hazard?: string;
      /** 위험요인(어떤 상황에서 무슨 재해가 나는가)과 대책. priority 는 중요도 표시(★·★★) */
      risks: ResolvedRisk[];
      basis: ResolvedBasis[];
      omittedBasis?: number;
    }[];
  }[];
}
export interface ResolvedRisk {
  statement: string;
  priority?: string;
  measures: { measure: string; controlLevel?: string; variant?: string; basisRef?: string }[];
}

/** 공종 ↔ 고시(장·절·조문) 연결은 모두 내용을 읽고 정한 것이다 */
const NOTICE_LINK_BASIS = "editorial";

let worksCache: Work[] | null = null;

/** 그래프의 공종 노드를 읽는다 (한 번 읽고 재사용) */
async function loadWorks(): Promise<Work[]> {
  if (worksCache) return worksCache;
  const nodes = (await listNodesByType("ConstructionSubtask")) as unknown as SubtaskNode[];
  worksCache = nodes
    .map((n) => ({
      iri: n["@id"],
      name: n.title,
      group: n.workGroup,
      ...(n.broader ? { activity: n.broader } : {}),
      references: n.references ?? [],
      linkBasis: n._meta?.linkBasis ?? {},
      steps: (n.steps ?? []).map((st) => ({ name: st.stepName, hazards: (st.stepHazards ?? []).map(toStepHazard) })),
    }))
    .sort((a, b) => a.iri.localeCompare(b.iri));
  return worksCache;
}

function normalize(s: string): string {
  return s.replace(/[\s·()\-+/]/g, "").toLowerCase();
}

/** 작업명으로 공종을 찾는다. 가장 잘 맞는 하나와, 같은 점수대의 다른 후보 이름을 돌려준다. */
export async function findWork(query: string): Promise<{ work: Work; others: string[]; matchedBy?: string[] } | null> {
  const q = normalize(query);
  if (!q) return null;
  const tokens = query.split(/[\s.,()·]+/).filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
  const scored: { work: Work; score: number }[] = [];
  for (const w of await loadWorks()) {
    const name = normalize(w.name);
    const bare = normalize(w.name.replace(/작업$|공사$/, ""));
    let score = 0;
    if (name === q || bare === q) score = SCORE_EXACT;
    else if (bare.length >= 2 && q.includes(bare)) score = SCORE_CONTAINS + bare.length;
    else if (q.length >= 2 && name.includes(q)) score = SCORE_CONTAINS;
    else score = tokens.filter((t) => name.includes(normalize(t))).length * SCORE_TOKEN;
    if (score >= SCORE_TOKEN) scored.push({ work: w, score });
  }
  if (scored.length === 0) return findWorkByContent(tokens);
  scored.sort((a, b) => b.score - a.score);
  return { work: scored[0].work, others: scored.slice(1, 6).map((x) => x.work.name) };
}

/** 낱말에서 조사·어미를 떼어 본 후보 (원형 포함, 2글자 이상) */
function stems(token: string): string[] {
  const out = new Set([token]);
  for (const p of PARTICLES) {
    if (token.length - p.length >= 2 && token.endsWith(p)) out.add(token.slice(0, -p.length));
  }
  return [...out];
}

let contentCache: Map<string, string> | null = null;

/** 공종마다 단계 이름·위험요인·대책 문장을 한 덩어리 글로 (한 번 만들고 재사용) */
async function loadWorkContents(): Promise<Map<string, string>> {
  if (contentCache) return contentCache;
  contentCache = new Map();
  for (const w of await loadWorks()) {
    const parts: string[] = [];
    for (const st of w.steps) {
      parts.push(st.name);
      for (const h of st.hazards) {
        for (const r of h.risks ?? []) parts.push(r.statement, ...r.measures.map((m) => m.measure));
      }
    }
    contentCache.set(w.iri, parts.join("\n"));
  }
  return contentCache;
}

/**
 * 공종 이름으로 못 찾았을 때, 질문의 낱말이 공종 자료의 문장에 나오는지로 찾는다.
 * ("항타기로 파일을 박는다" → 항타기가 나오는 공종). 몇 안 되는 공종에만 나오는 낱말만 쓰고,
 * 드문 낱말일수록 크게 친다. 무엇으로 찾았는지는 matchedBy 에 적어 응답에 나간다.
 */
async function findWorkByContent(tokens: string[]): Promise<{ work: Work; others: string[]; matchedBy: string[] } | null> {
  const works = await loadWorks();
  const contents = await loadWorkContents();
  const score = new Map<string, { score: number; words: string[] }>();
  for (const token of tokens) {
    // 조사를 뗀 후보 중 실제로 자료에 나오는 가장 긴 것 하나만 쓴다
    const candidates = stems(token).sort((a, b) => b.length - a.length);
    for (const word of candidates) {
      const hit = works.filter((w) => (contents.get(w.iri) ?? "").includes(word));
      if (hit.length === 0) continue;
      if (hit.length <= CONTENT_TOKEN_MAX_WORKS) {
        for (const w of hit) {
          const cur = score.get(w.iri) ?? { score: 0, words: [] };
          cur.score += 1 / hit.length;
          cur.words.push(word);
          score.set(w.iri, cur);
        }
      }
      break;
    }
  }
  const ranked = works
    .filter((w) => (score.get(w.iri)?.words.length ?? 0) >= CONTENT_MIN_WORDS)
    .sort((a, b) => (score.get(b.iri)?.score ?? 0) - (score.get(a.iri)?.score ?? 0) || a.iri.localeCompare(b.iri));
  if (ranked.length === 0) return null;
  return {
    work: ranked[0],
    others: ranked.slice(1, 6).map((w) => w.name),
    matchedBy: score.get(ranked[0].iri)?.words ?? [],
  };
}

/** 본문 구간에서 "N. …" 호(그리고 "가. …" 목)만 꺼낸다. 찾지 못하면 undefined. */
function extractItem(scope: string, item: number, subitem?: string): string | undefined {
  const start = scope.search(new RegExp(`^\\s*${item}\\.\\s`, "m"));
  if (start < 0) return undefined;
  // 앞 공백을 걷어 낸 뒤 다음 호를 찾는다 — 걷지 않으면 들여쓴 현재 호가 "다음 호"로 잡힌다
  let text = scope.slice(start).trimStart();
  const next = text.slice(1).search(new RegExp(`^\\s*${item + 1}\\.\\s`, "m"));
  if (next >= 0) text = text.slice(0, next + 1);
  if (subitem) {
    const subStart = text.search(new RegExp(`^\\s*${subitem}\\.\\s`, "m"));
    if (subStart >= 0) {
      let sub = text.slice(subStart).trimStart();
      const subNext = sub.slice(1).search(/^\s*[가-하]\.\s/m);
      if (subNext >= 0) sub = sub.slice(0, subNext + 1);
      // 목만 떼면 무엇에 대한 항목인지 알 수 없다 — 호의 머리 문장("다음 각 목의 … 사용해서는 아니 된다")을 앞에 붙인다
      // 머리 문장 = 첫 목이 시작하기 전까지 (앞선 다른 목은 넣지 않는다)
      const firstSub = text.search(/^\s*[가-하]\.\s/m);
      const lead = text.slice(0, firstSub >= 0 ? firstSub : subStart).trim();
      // 머리 문장은 줄이지 않는다 — 단서("다만, …")와 예외가 머리 문장에 들어 있다
      text = lead ? `${lead} — ${sub.trim()}` : sub;
    }
  }
  return text;
}

/** 조문 본문에서 n번째 항 구간(자르지 않은 원문)을 돌려준다. */
function paragraphScope(description: string, paragraph?: number): string {
  const body = description.replace(/\*\*[^*]*\*\*/g, "").trim();
  if (paragraph && paragraph <= CIRCLED.length) {
    const start = body.indexOf(CIRCLED[paragraph - 1]);
    if (start >= 0) {
      const rest = body.slice(start);
      const nextIdx = paragraph < CIRCLED.length ? rest.indexOf(CIRCLED[paragraph], 1) : -1;
      return nextIdx > 0 ? rest.slice(0, nextIdx) : rest;
    }
  }
  return body;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PARAGRAPH_MAX_CHARS ? `${flat.slice(0, PARAGRAPH_MAX_CHARS)}…` : flat;
}

/** 가이드 본문에서 조항 번호로 시작하는 제목 줄을 찾는다. */
function findSectionTitle(body: string, section: string): string | undefined {
  const escaped = section.replace(/\./g, "\\.");
  const m = body.match(new RegExp(`^\\s*(?:#+\\s*)?${escaped}\\.?\\s+(\\S[^\\n]{0,60})`, "m"));
  return m ? `${section} ${m[1].trim()}` : undefined;
}

async function resolveBasis(b: BasisRef): Promise<ResolvedBasis | null> {
  const controlLevel = b.controlLevel ? CONTROL_LEVEL_KO[b.controlLevel] : undefined;
  if (b.article) {
    const node = (await getNode(b.article)) as { title?: string; description?: string; penalizedBy?: string | string[] } | undefined;
    if (!node) return null;
    const num = b.article.split(":").pop() ?? "";
    const m = num.match(/^(\d+)(?:의(\d+))?$/);
    const articleLabel = m ? `제${m[1]}조${m[2] ? `의${m[2]}` : ""}` : num;
    const scope = paragraphScope(node.description ?? "", b.paragraph);
    // 호·목이 지정돼 있으면 그 부분만, 아니면 항(또는 조문 앞부분)을 보여 준다
    const itemText = b.item ? extractItem(scope, b.item, b.subitem) : undefined;
    const detail = `${b.paragraph ? ` 제${b.paragraph}항` : ""}${b.item ? ` 제${b.item}호` : ""}${b.subitem ? ` ${b.subitem}목` : ""}`;
    return {
      kind: "law",
      ref: `산업안전보건기준에 관한 규칙 ${articleLabel}${detail}`,
      title: node.title ?? "",
      // 호·목으로 좁힌 발췌는 자르지 않는다 (법령 문장을 길이로 자르면 조건·예외가 빠진다).
      // 호가 지정되지 않아 항·조문 전체를 보여 줄 때만 앞부분으로 줄이고, 줄였다는 표시(…)를 남긴다.
      text: itemText ? itemText.replace(/\s+/g, " ").trim() : clip(scope),
      controlLevel,
      legalWeight: "mandatory",
    };
  }
  if (b.annex) {
    const node = (await getNode(b.annex)) as { title?: string } | undefined;
    if (!node) return null;
    const label = b.annex.split(":").pop() ?? "";
    return {
      kind: "law",
      ref: `산업안전보건기준에 관한 규칙 ${label.replace(/^별표(\d+)/, "별표 $1").replace(/-(\d+)호$/, " 제$1호")}${b.item ? ` 제${b.item}호` : ""}`,
      // 별표 노드 제목이 "별표 4 제10호 — 건물 등의 해체작업" 꼴이면 번호 부분은 ref 에 이미 있다
      title: (node.title ?? "").replace(/^별표\s*\d+(?:\s*제\d+호)?\s*[—-]\s*/, ""),
      controlLevel,
      legalWeight: "mandatory",
    };
  }
  if (b.guide) {
    const guideNo = b.guide.split("/").pop() ?? "";
    const md = await getKoshaGuideMd(guideNo);
    if (!md) return null;
    return {
      kind: "kosha_guide",
      ref: `KOSHA Guide ${guideNo}${b.section ? ` ${b.section}` : ""}`,
      title: md.title,
      text: b.section ? findSectionTitle(md.body, b.section) : undefined,
      controlLevel,
      legalWeight: "recommended",
    };
  }
  return null;
}

/**
 * 공종과 관련된 고시(표준안전 작업지침)와 그 조문을 고시별로 묶는다.
 *   - 공종 노드의 references (고시 법령 노드, 제목이 공종 이름과 맞는 조문)
 *   - 이 공종을 다룬다고 연결된 고시의 장·절(appliesTo) 에 속한 조문
 */
async function findRelatedNotices(work: Work): Promise<RelatedNotice[]> {
  const byAct = new Map<string, RelatedNotice>();
  const seen = new Set<string>();
  const articleIris: string[] = work.references.filter((iri) => iri.startsWith("art:"));
  for (const iri of work.references) {
    if (!iri.startsWith("act:")) continue;
    const act = (await getNode(iri)) as { legislationIdentifier?: string } | undefined;
    if (act) byAct.set(iri, { law: act.legislationIdentifier ?? iri, articles: [], legalWeight: "recommended", linkBasis: NOTICE_LINK_BASIS });
  }
  for (const chapterIri of await neighborsByEdge(work.iri, "appliesTo", "in")) {
    if (!chapterIri.startsWith("chapter:")) continue;
    const chapter = (await getNode(chapterIri)) as unknown as { hasArticle?: string[] } | undefined;
    articleIris.push(...(chapter?.hasArticle ?? []));
  }
  for (const iri of articleIris) {
    if (seen.has(iri)) continue;
    seen.add(iri);
    const node = (await getNode(iri)) as
      | { title?: string; partOf?: string; legislationIdentifier?: string; articleNumber?: string }
      | undefined;
    if (!node?.partOf) continue;
    let notice = byAct.get(node.partOf);
    if (!notice) {
      notice = { law: node.legislationIdentifier ?? node.partOf, articles: [], legalWeight: "recommended", linkBasis: NOTICE_LINK_BASIS };
      byAct.set(node.partOf, notice);
    }
    const num = node.articleNumber ?? "";
    notice.articles.push({
      ref: `${node.legislationIdentifier ?? notice.law} 제${num.replace("의", "조의")}${num.includes("의") ? "" : "조"}`,
      title: node.title ?? "",
    });
  }
  // 조문 번호 순
  const articleNo = (ref: string): number => Number(ref.match(/제(\d+)조/)?.[1] ?? 0);
  for (const n of byAct.values()) n.articles.sort((a, b) => articleNo(a.ref) - articleNo(b.ref));
  return [...byAct.values()];
}

/** 연결된 작업과 관련된 문서(가이드 제외). 작성 조건을 함께 돌려준다 — 조건 확인 없이 의무로 단정하지 않는다 */
async function findRelatedDocuments(activity: string | undefined): Promise<RelatedDocument[]> {
  if (!activity) return [];
  const docs = await listDocuments();
  const out: RelatedDocument[] = [];
  for (const d of docs) {
    const node = d as unknown as { "@id": string; docId?: string; title?: string; cycle?: string; trigger?: string; appliesToActivities?: string[] };
    if (node["@id"].startsWith("doc:kosha_guide")) continue;
    if (!(node.appliesToActivities ?? []).includes(activity)) continue;
    out.push({
      docId: node.docId ?? node["@id"],
      title: node.title ?? "",
      ...(node.cycle ? { cycle: node.cycle } : {}),
      ...(node.trigger ? { when: node.trigger } : {}),
    });
    if (out.length >= MAX_RELATED_DOCUMENTS) break;
  }
  return out;
}

/**
 * 이 공종 자료에서 이어지지 않은 것을 글로 적는다.
 * 빈 곳을 조용히 넘기면 "해당 없음"으로 읽히므로, 연결이 없다는 사실을 그대로 알린다.
 */
function collectGaps(work: Work, steps: ResolvedWorkSteps["steps"], notices: RelatedNotice[]): string[] {
  const gaps: string[] = [];
  if (!work.activity) {
    gaps.push("상위 작업과 이어지지 않았다 — 작업별 문서·유해요인 자료는 이 공종에 붙지 않는다.");
  }
  const unlinked = new Map<string, number>();
  let measures = 0;
  let noBasis = 0;
  for (const st of steps) {
    for (const h of st.hazards) {
      if (!h.hazard) unlinked.set(h.hazardLabel, (unlinked.get(h.hazardLabel) ?? 0) + h.risks.length);
      for (const r of h.risks) {
        for (const m of r.measures) {
          measures += 1;
          if (!m.basisRef) noBasis += 1;
        }
      }
    }
  }
  if (unlinked.size > 0) {
    const labels = [...unlinked.entries()].map(([label, n]) => `${label}(위험요인 ${n}건)`).join(", ");
    gaps.push(`유해요인 분류와 이어지지 않은 재해유형: ${labels} — 유해요인으로 대책을 찾을 때 이 부분은 나오지 않는다.`);
  }
  if (noBasis > 0) {
    gaps.push(`감소대책 ${measures}건 중 ${noBasis}건은 근거 조문·지침이 붙어 있지 않다.`);
  }
  if (notices.length === 0) {
    gaps.push("이 공종과 이어진 표준안전 작업지침(고시)이 없다.");
  } else if (notices.every((n) => n.articles.length === 0)) {
    gaps.push(`${notices.map((n) => n.law).join(", ")}: 고시는 이어졌으나 이 공종을 다루는 조문은 짚지 못했다 — 고시 전체를 살펴야 한다.`);
  }
  return gaps;
}

/** 작업명에 맞는 공종의 단계별 재해유형과 근거를 읽을 수 있는 형태로 돌려준다. */
export async function getWorkSteps(
  query: string,
): Promise<{ result: ResolvedWorkSteps; otherCandidates: string[] } | null> {
  const found = await findWork(query);
  if (!found) return null;
  const steps: ResolvedWorkSteps["steps"] = [];
  for (const s of found.work.steps) {
    const hazards: ResolvedWorkSteps["steps"][number]["hazards"] = [];
    for (const h of s.hazards) {
      const resolved: ResolvedBasis[] = [];
      for (const b of h.basis.slice(0, MAX_BASIS_PER_HAZARD)) {
        const r = await resolveBasis(b);
        if (r) resolved.push(r);
      }
      const omitted = h.basis.length - Math.min(h.basis.length, MAX_BASIS_PER_HAZARD);
      const risks: ResolvedRisk[] = [];
      for (const r of h.risks ?? []) {
        const measures: ResolvedRisk["measures"] = [];
        for (const m of r.measures) {
          const rb = m.basis ? await resolveBasis(m.basis) : null;
          measures.push({
            measure: m.measure,
            ...(m.controlLevel ? { controlLevel: CONTROL_LEVEL_KO[m.controlLevel] ?? m.controlLevel } : {}),
            ...(m.variant ? { variant: m.variant } : {}),
            ...(rb ? { basisRef: rb.ref } : {}),
          });
        }
        risks.push({ statement: r.statement, ...(r.priority ? { priority: r.priority } : {}), measures });
      }
      hazards.push({
        hazardLabel: h.hazardLabel,
        ...(h.hazard ? { hazard: h.hazard } : {}),
        risks,
        basis: resolved,
        ...(omitted > 0 ? { omittedBasis: omitted } : {}),
      });
    }
    steps.push({ name: s.name, hazards });
  }
  const relatedNotices = await findRelatedNotices(found.work);
  const relatedDocuments = await findRelatedDocuments(found.work.activity);
  const gaps = collectGaps(found.work, steps, relatedNotices);
  return {
    result: {
      iri: found.work.iri,
      group: found.work.group,
      work: found.work.name,
      activity: found.work.activity,
      ...(found.matchedBy ? { matchedByContent: found.matchedBy } : {}),
      ...(relatedNotices.length > 0 ? { relatedNotices } : {}),
      ...(relatedDocuments.length > 0 ? { relatedDocuments } : {}),
      ...(Object.keys(found.work.linkBasis).length > 0 ? { linkBasis: found.work.linkBasis, linkBasisLegend: LINK_BASIS_LABEL } : {}),
      ...(gaps.length > 0 ? { gaps } : {}),
      steps,
    },
    otherCandidates: found.others,
  };
}

/** 공종 전체 (대공종별) */
export async function listWorks(): Promise<{ group: string; works: { iri: string; name: string; activity?: string; steps: string[] }[] }[]> {
  const byGroup = new Map<string, { iri: string; name: string; activity?: string; steps: string[] }[]>();
  for (const w of await loadWorks()) {
    const list = byGroup.get(w.group) ?? [];
    list.push({ iri: w.iri, name: w.name, ...(w.activity ? { activity: w.activity } : {}), steps: w.steps.map((st) => st.name) });
    byGroup.set(w.group, list);
  }
  return [...byGroup.entries()].map(([group, works]) => ({ group, works }));
}
