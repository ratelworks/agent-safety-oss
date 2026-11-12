/**
 * work-steps.ts — 공종별 작업 단계와 단계별 근거(조문의 항, KOSHA Guide 조항) 조회
 *
 * 자료(construction-work-steps.json)는 참조만 담는다. 읽을 내용은 여기서 번들 조문 노드와
 * 가이드 본문에서 꺼내 붙인다 — 조문은 해당 항 본문, 가이드는 해당 조항 제목.
 */

import stepData from "../ontology/construction-work-steps.json" with { type: "json" };
import { getNode, listArticleIds, listDocuments } from "./graph-nodes-loader.js";
import { getKoshaGuideMd } from "./kosha-guides-loader.js";

// ── 상수 ────────────────────────────────────────────────────────────
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";
/** 항 본문을 잘라 보여 줄 최대 길이 */
const PARAGRAPH_MAX_CHARS = 220;
/** 목 앞에 붙이는 호 머리 문장의 최대 길이 */
const LEAD_MAX_CHARS = 90;
/** 한 단계·재해유형에 보여 줄 근거 수 상한 (자주 쓰이는 순으로 정렬돼 있다) */
const MAX_BASIS_PER_HAZARD = 6;
/** 공종 이름 매칭 점수 */
const SCORE_EXACT = 100;
const SCORE_CONTAINS = 60;
const SCORE_TOKEN = 20;
/** 매칭에 쓰지 않는 흔한 낱말 */
const GENERIC_TOKENS: ReadonlySet<string> = new Set(["작업", "공사", "시공", "설치", "해체", "조립"]);
/** 대공종 → 그 공사를 다루는 고용노동부 고시(표준안전 작업지침)의 법령 키 */
const NOTICES_BY_GROUP: Record<string, string[]> = {
  "가설·비계공사": ["가설공사-지침", "추락재해방지-지침"],
  "거푸집·동바리공사": ["콘크리트공사-지침"],
  "철근공사": ["콘크리트공사-지침"],
  "콘크리트타설공사": ["콘크리트공사-지침"],
  "토공·굴착공사": ["굴착공사-지침"],
  "흙막이공사": ["굴착공사-지침"],
  "발파공사": ["발파-지침"],
  "해체·철거": ["해체공사-지침"],
  "철골공사": ["철골공사-지침", "추락재해방지-지침"],
  "터널공사": ["터널공사NATM-지침"],
};
/** 공종 하나에 보여 줄 고시 조문·법정문서 수 상한 */
const MAX_NOTICE_ARTICLES = 6;
const MAX_RELATED_DOCUMENTS = 8;
/** 고시 조문 제목과 공종·단계 이름을 맞출 때 쓰지 않는 낱말 (어느 조문에나 나온다) */
const NOTICE_MATCH_STOPWORDS: ReadonlySet<string> = new Set([
  "작업", "공사", "시공", "설치", "해체", "조립", "준비", "사용", "관리", "안전", "일반", "기타", "공통", "부대", "자재반입", "반입", "이동식", "가설", "구조물", "벽체", "통로", "또는",
]);

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
}
interface WorkStep {
  name: string;
  hazards: StepHazard[];
}
interface Work {
  name: string;
  activity?: string;
  steps: WorkStep[];
}
interface WorkGroup {
  name: string;
  works: Work[];
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
export interface RelatedNotice {
  /** 고시 이름 */
  law: string;
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
  group: string;
  work: string;
  activity?: string;
  /** 이 공사를 다루는 표준안전 작업지침(권고 기준) */
  relatedNotices?: RelatedNotice[];
  /** 연결된 작업과 관련된 문서 — 작성 조건(when)에 해당할 때만 필요하다 */
  relatedDocuments?: RelatedDocument[];
  steps: {
    name: string;
    hazards: { hazardLabel: string; hazard?: string; basis: ResolvedBasis[]; omittedBasis?: number }[];
  }[];
}

const groups = stepData.groups as WorkGroup[];

function normalize(s: string): string {
  return s.replace(/[\s·()\-+/]/g, "").toLowerCase();
}

/** 작업명으로 공종을 찾는다. 가장 잘 맞는 하나와, 같은 점수대의 다른 후보 이름을 돌려준다. */
export function findWork(query: string): { group: string; work: Work; others: string[] } | null {
  const q = normalize(query);
  if (!q) return null;
  const tokens = query.split(/[\s.,()·]+/).filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
  const scored: { group: string; work: Work; score: number }[] = [];
  for (const g of groups) {
    for (const w of g.works) {
      const name = normalize(w.name);
      const bare = normalize(w.name.replace(/작업$|공사$/, ""));
      let score = 0;
      if (name === q || bare === q) score = SCORE_EXACT;
      else if (bare.length >= 2 && q.includes(bare)) score = SCORE_CONTAINS + bare.length;
      else if (q.length >= 2 && name.includes(q)) score = SCORE_CONTAINS;
      else score = tokens.filter((t) => name.includes(normalize(t))).length * SCORE_TOKEN;
      if (score >= SCORE_TOKEN) scored.push({ group: g.name, work: w, score });
    }
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const others = scored.slice(1, 6).map((s) => s.work.name);
  return { group: best.group, work: best.work, others };
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
      // 머리 문장이 길면 줄인다 — 줄이지 않으면 뒤에서 길이를 자를 때 정작 목 본문이 잘려 나간다
      const flatLead = lead.replace(/\s+/g, " ");
      const shortLead = flatLead.length > LEAD_MAX_CHARS ? `${flatLead.slice(0, LEAD_MAX_CHARS)}…` : flatLead;
      text = shortLead ? `${shortLead} — ${sub.trim()}` : sub;
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
      text: clip(itemText ?? scope),
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

/** 이름에서 고시 조문 제목과 맞춰 볼 낱말을 뽑는다 */
function matchTokens(names: string[]): string[] {
  const tokens = names
    .join(" ")
    .split(/[\s·()\-+/,]+/)
    .map((t) => t.replace(/(작업|공사)$/, ""))
    .filter((t) => t.length >= 2 && !NOTICE_MATCH_STOPWORDS.has(t));
  return [...new Set(tokens)];
}

/** 대공종에 해당하는 고시와, 그 안에서 공종·단계 이름과 제목이 맞는 조문을 찾는다 */
async function findRelatedNotices(group: string, work: Work): Promise<RelatedNotice[]> {
  const keys = NOTICES_BY_GROUP[group] ?? [];
  if (keys.length === 0) return [];
  // 공종 이름의 낱말만 쓴다 — 단계 이름("점검"·"보관"·"조립")까지 쓰면 다른 대상의 조문이 붙는다
  const workTokens = matchTokens([work.name]);
  const ids = await listArticleIds();
  const out: RelatedNotice[] = [];
  for (const key of keys) {
    let lawName = "";
    const articles: RelatedNotice["articles"] = [];
    for (const iri of ids) {
      if (iri.split(":")[1] !== key) continue;
      const node = (await getNode(iri)) as { title?: string; legislationIdentifier?: string; articleNumber?: string } | undefined;
      if (!node) continue;
      lawName ||= node.legislationIdentifier ?? key;
      const title = node.title ?? "";
      if (articles.length < MAX_NOTICE_ARTICLES && workTokens.some((t) => title.includes(t))) {
        articles.push({ ref: `${node.legislationIdentifier ?? key} 제${(node.articleNumber ?? "").replace("의", "조의")}${(node.articleNumber ?? "").includes("의") ? "" : "조"}`, title });
      }
    }
    if (lawName) out.push({ law: lawName, articles, legalWeight: "recommended" });
  }
  return out;
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

/** 작업명에 맞는 공종의 단계별 재해유형과 근거를 읽을 수 있는 형태로 돌려준다. */
export async function getWorkSteps(
  query: string,
): Promise<{ result: ResolvedWorkSteps; otherCandidates: string[] } | null> {
  const found = findWork(query);
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
      hazards.push({
        hazardLabel: h.hazardLabel,
        ...(h.hazard ? { hazard: h.hazard } : {}),
        basis: resolved,
        ...(omitted > 0 ? { omittedBasis: omitted } : {}),
      });
    }
    steps.push({ name: s.name, hazards });
  }
  const relatedNotices = await findRelatedNotices(found.group, found.work);
  const relatedDocuments = await findRelatedDocuments(found.work.activity);
  return {
    result: {
      group: found.group,
      work: found.work.name,
      activity: found.work.activity,
      ...(relatedNotices.length > 0 ? { relatedNotices } : {}),
      ...(relatedDocuments.length > 0 ? { relatedDocuments } : {}),
      steps,
    },
    otherCandidates: found.others,
  };
}

/** 자료에 있는 공종 이름 전체 (대공종별) */
export function listWorkNames(): { group: string; works: string[] }[] {
  return groups.map((g) => ({ group: g.name, works: g.works.map((w) => w.name) }));
}
