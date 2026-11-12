/**
 * work-steps.ts — 공종별 작업 단계와 단계별 근거(조문의 항, KOSHA Guide 조항) 조회
 *
 * 자료(construction-work-steps.json)는 참조만 담는다. 읽을 내용은 여기서 번들 조문 노드와
 * 가이드 본문에서 꺼내 붙인다 — 조문은 해당 항 본문, 가이드는 해당 조항 제목.
 */

import stepData from "../ontology/construction-work-steps.json" with { type: "json" };
import { getNode } from "./graph-nodes-loader.js";
import { getKoshaGuideMd } from "./kosha-guides-loader.js";

// ── 상수 ────────────────────────────────────────────────────────────
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";
/** 항 본문을 잘라 보여 줄 최대 길이 */
const PARAGRAPH_MAX_CHARS = 220;
/** 한 단계·재해유형에 보여 줄 근거 수 상한 (자주 쓰이는 순으로 정렬돼 있다) */
const MAX_BASIS_PER_HAZARD = 6;
/** 공종 이름 매칭 점수 */
const SCORE_EXACT = 100;
const SCORE_CONTAINS = 60;
const SCORE_TOKEN = 20;
/** 매칭에 쓰지 않는 흔한 낱말 */
const GENERIC_TOKENS: ReadonlySet<string> = new Set(["작업", "공사", "시공", "설치", "해체", "조립"]);
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
export interface ResolvedWorkSteps {
  group: string;
  work: string;
  activity?: string;
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

/** 조문 본문에서 n번째 항을 꺼낸다. 항 구분이 없으면 본문 앞부분을 돌려준다. */
function extractParagraph(description: string, paragraph?: number): string {
  const body = description.replace(/\*\*[^*]*\*\*/g, "").trim();
  let text = body;
  if (paragraph && paragraph <= CIRCLED.length) {
    const start = body.indexOf(CIRCLED[paragraph - 1]);
    if (start >= 0) {
      const rest = body.slice(start);
      const nextIdx = paragraph < CIRCLED.length ? rest.indexOf(CIRCLED[paragraph], 1) : -1;
      text = nextIdx > 0 ? rest.slice(0, nextIdx) : rest;
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > PARAGRAPH_MAX_CHARS ? `${text.slice(0, PARAGRAPH_MAX_CHARS)}…` : text;
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
    const node = (await getNode(b.article)) as { title?: string; description?: string } | undefined;
    if (!node) return null;
    const num = b.article.split(":").pop() ?? "";
    const m = num.match(/^(\d+)(?:의(\d+))?$/);
    const articleLabel = m ? `제${m[1]}조${m[2] ? `의${m[2]}` : ""}` : num;
    return {
      kind: "law",
      ref: `산업안전보건기준에 관한 규칙 ${articleLabel}${b.paragraph ? ` 제${b.paragraph}항` : ""}`,
      title: node.title ?? "",
      text: extractParagraph(node.description ?? "", b.paragraph),
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
  return {
    result: { group: found.group, work: found.work.name, activity: found.work.activity, steps },
    otherCandidates: found.others,
  };
}

/** 자료에 있는 공종 이름 전체 (대공종별) */
export function listWorkNames(): { group: string; works: string[] }[] {
  return groups.map((g) => ({ group: g.name, works: g.works.map((w) => w.name) }));
}
