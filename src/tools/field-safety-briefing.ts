import { isUnreviewedRegulation, UNREVIEWED_NOTE } from "../lib/unreviewed-links.js";
import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { getWorkSteps } from "../lib/work-steps.js";
import { searchArticles } from "../lib/article-search.js";

// 파일 최상단 상수 — 현장 사용자(현장소장·안전관리자) 친화 통합 brief
// 작업명 입력 → 5초 안에 위험·통제·법령·의무문서·KOSHA 한 화면 요약
// synonyms.json 동의어 사전 + doc.searchKeywords + activity.searchKeywords + penaltyMap 활용
/** 조문이 답에 들어온 길의 무게 — 찾은 공종의 근거 조문 > 작업·문서에 이어진 조문 > 유해요인에 이어진 조문 */
const WEIGHT_SUBTASK = 2000;
const WEIGHT_ACTIVITY = 1000;
const WEIGHT_HAZARD = 500;
const MAX_ARTICLES = 15;  // expansion IRI 모두 포함 가능 수준
/** 문장 검색으로 후보에 넣는 조문 수 */
const SEARCH_LIMIT = 30;
/** 순위 합치기 상수 — 클수록 두 순위표의 앞자리 차이가 덜 벌어진다 */
const RANK_FUSION_K = 10;
/** 순위를 합칠 때 길마다 주는 무게 — 용어 사전, 그래프 연결, 문장 검색 */
const FUSION_WEIGHT_DICTIONARY = 1;
const FUSION_WEIGHT_GRAPH = 1;
const FUSION_WEIGHT_SEARCH = 2;
/** 고시·지침의 법령 종류 값 */
const NOTIFICATION_TYPE = "Notification";
const SIMILAR_SECTION_HEAD = "## 🔎 문장이 비슷한 조문 (관련 여부 확인 필요)";
const SIMILAR_SECTION_NOTE = "작업·위험·문서 이름으로는 찾지 못해, 질문 문장과 글이 비슷한 조문만 보여 줍니다. 건설 안전과 관계없는 질문이면 맞지 않습니다.";
const SIMILAR_MARK = " _(비슷한 문장)_";
const SIMILAR_NOTE = "비슷한 문장 — 질문과 글이 비슷해서 찾은 조문입니다. 상황에 맞는지 확인하세요";
const MAX_GUIDES = 5;
const MAX_DOCS = 10;
const ACTIVITY_THRESHOLD = 50;  // 활동 매칭 score 하한 (false positive 방지)
/** 작업 이름 가산점 — 질의의 고유 낱말이 작업 이름·검색어에 있으면 더한다 ("수장 작업" → 수장·내부마감 작업) */
const ACTIVITY_NAME_BONUS = 30;
/** 어느 작업·조문에나 나오는 낱말 — 다른 낱말이 함께 있으면 매칭 근거로 쓰지 않는다 ("수장 작업"의 "작업"이 잠수작업 조문을 끌어오지 않게) */
const GENERIC_TOKENS: ReadonlySet<string> = new Set(["작업", "공사", "시공", "업무"]);
/** 여러 작업 이름에 두루 나오는 행위 낱말 — 매칭에는 쓰되 작업 이름 가산점은 주지 않는다 ("석면 해체"의 "해체"가 교량 해체를 끌어오지 않게) */
const ACTION_TOKENS: ReadonlySet<string> = new Set(["설치", "해체", "조립", "점검", "정비", "보수", "취급", "사용", "변경"]);
const DOC_THRESHOLD = 60;  // 의무문서 매칭 score 하한

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "ontology", "graph", "nodes");
const SYNONYMS_PATH = resolve(__dirname, "..", "ontology", "synonyms.json");

/** 공종 노드에서 읽는 부분 */
interface SubtaskNode {
  hasHazard?: string[];
  regulatedBy?: string[];
  steps?: { stepHazards?: { risks?: { measures?: { basis?: { basisArticle?: string } }[] }[] }[] }[];
}
interface SynonymGroup {
  id: string;
  primary: string;
  synonyms: string[];
  expandsTo: string[];
  explicitlyExcludes?: string[];  // 동의어 그룹 매칭되더라도 제외할 IRI
  exclusionNote?: string;
  applicabilityNote?: string;
  timingNote?: string;
  userMisuseNote?: string;
}

// Issue #6 — 자연어 필드 alias (topic / workName / 작업명 입력도 받아들임)
const baseInputSchema = z.object({
  workOrTopic: z
    .string()
    .describe(
      "작업명 또는 위험·의무 토픽 (예: '거푸집 해체', '비계 설치', '추락방지', 'MSDS 등록', '재해 발생 보고', '분기 정기교육', '신규 도료 반입'). alias 허용: topic / workName / 작업명.",
    ),
  persona: z
    .enum(["site_manager", "safety_manager", "auto"])
    .default("auto")
    .describe(
      "현장 페르소나 — site_manager(현장소장·실무 즉시 이해), safety_manager(안전관리자·법령 인용 포함), auto(워크 키워드로 추정)",
    ),
});

// alias 매핑: 다양한 입력 키를 workOrTopic 으로 정규화
const inputSchema = z.preprocess((v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };
  if (!("workOrTopic" in obj)) {
    const aliasKeys = ["topic", "workName", "work", "작업명", "작업", "task"];
    for (const k of aliasKeys) {
      if (k in obj && typeof obj[k] === "string") {
        out.workOrTopic = obj[k];
        delete out[k];
        break;
      }
    }
  }
  return out;
}, baseInputSchema);

type Input = z.infer<typeof inputSchema>;

let synonymsCache: SynonymGroup[] | null = null;
async function loadSynonyms(): Promise<SynonymGroup[]> {
  if (synonymsCache) return synonymsCache;
  const data = JSON.parse(await readFile(SYNONYMS_PATH, "utf-8")) as { groups: SynonymGroup[] };
  synonymsCache = data.groups;
  return synonymsCache;
}

let nodesCache: Record<string, unknown>[] | null = null;
async function loadAllNodes(): Promise<Record<string, unknown>[]> {
  if (nodesCache) return nodesCache;
  const nodes: Record<string, unknown>[] = [];
  async function walk(dir: string) {
    for (const e of await readdir(dir)) {
      const p = resolve(dir, e);
      const { stat } = await import("node:fs/promises");
      const st = await stat(p);
      if (st.isDirectory()) await walk(p);
      else if (e.endsWith(".jsonld")) {
        try { nodes.push(JSON.parse(await readFile(p, "utf-8"))); } catch {}
      }
    }
  }
  await walk(NODES);
  nodesCache = nodes;
  return nodes;
}

// 동의어 확장 → query에서 매칭되는 그룹의 expandsTo IRI 반환
// strongTerms (score 가중) = query 직접 토큰 + 매칭 그룹의 primary
// weakTerms (참고만) = 매칭 그룹의 synonyms (false positive 방지 위해 score 가중 X)
// excluded = explicitlyExcludes 의 합집합 (다른 그룹에서 매칭되어도 출력 차단)
// notes = 사용자에게 표시할 법적 정확성 안내 (timingNote / applicabilityNote / userMisuseNote)
function expandQueryToIris(query: string, groups: SynonymGroup[]): {
  iris: Set<string>;
  excluded: Set<string>;
  strongTerms: Set<string>;
  weakTerms: Set<string>;
  notes: string[];
} {
  const iris = new Set<string>();
  const excluded = new Set<string>();
  const strong = new Set<string>();
  const weak = new Set<string>();
  const notes: string[] = [];
  strong.add(query);
  const queryTokens = query.split(/[\s.,()·]+/).filter(t => t.length >= 2);
  const specificTokens = queryTokens.filter(t => !GENERIC_TOKENS.has(t));
  // 고유 낱말이 하나라도 있으면 흔한 낱말은 뺀다. 흔한 낱말뿐인 질의는 그대로 쓴다.
  for (const tok of specificTokens.length > 0 ? specificTokens : queryTokens) strong.add(tok);
  for (const g of groups) {
    let matched = false;
    if (query.includes(g.primary)) matched = true;
    if (!matched) {
      for (const s of g.synonyms) {
        if (query.includes(s)) {
          matched = true;
          break;
        }
        const tokens = s.split(/\s+/).filter(t => t.length >= 2);
        if (tokens.length > 1 && tokens.every(t => query.includes(t))) {
          matched = true;
          break;
        }
      }
    }
    if (matched) {
      for (const iri of g.expandsTo) iris.add(iri);
      for (const ex of g.explicitlyExcludes ?? []) excluded.add(ex);
      strong.add(g.primary);
      for (const s of g.synonyms) weak.add(s);
      // 법적 안내문 수집
      if (g.applicabilityNote) notes.push(`📋 적용 조건: ${g.applicabilityNote}`);
      if (g.timingNote) notes.push(`⏰ 시기 정의: ${g.timingNote}`);
      if (g.userMisuseNote && /분기|분기별|3개월/.test(query)) notes.push(`⚠️ 용어 정정: ${g.userMisuseNote}`);
      if (g.exclusionNote) notes.push(`🚫 제외 사유: ${g.exclusionNote}`);
    }
  }
  return { iris, excluded, strongTerms: strong, weakTerms: weak, notes };
}

function scoreMatch(text: string, strongTerms: Set<string>, weakTerms?: Set<string>): number {
  if (!text) return 0;
  let score = 0;
  for (const t of strongTerms) {
    if (t.length < 2) continue;
    if (text.includes(t)) score += t.length >= 4 ? 40 : 20;  // 강한 매칭
  }
  if (weakTerms) {
    for (const t of weakTerms) {
      if (t.length < 2) continue;
      if (text.includes(t)) score += t.length >= 4 ? 5 : 2;  // 약한 참고
    }
  }
  return score;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const persona = input.persona === "auto"
    ? (input.workOrTopic.match(/위험성평가|선임|교육|위원회|진단|관리비|대장|중처법|감독자/) ? "safety_manager" : "site_manager")
    : input.persona;

  const groups = await loadSynonyms();
  const all = await loadAllNodes();
  const articles = all.filter(n => (n["@id"] as string)?.startsWith("art:"));
  const docs = all.filter(n => (n["@id"] as string)?.startsWith("doc:") && !(n["@id"] as string).startsWith("doc:kosha_guide"));
  const guides = all.filter(n => (n["@id"] as string)?.startsWith("doc:kosha_guide"));
  const hazards = all.filter(n => (n["@id"] as string)?.startsWith("hazard:"));
  const controls = all.filter(n => (n["@id"] as string)?.startsWith("control:"));
  const activities = all.filter(n => (n["@id"] as string)?.startsWith("activity:"));

  const q = input.workOrTopic;

  // ─── 0. 동의어 확장 ───
  const { iris: expandedIris, excluded, strongTerms, weakTerms, notes } = expandQueryToIris(q, groups);
  // 제외 IRI 적용
  for (const ex of excluded) expandedIris.delete(ex);

  // ─── 1. 활동 매칭 (description + searchKeywords + 동의어 확장) ───
  const matchedActivities = activities
    .map(a => {
      // 이름은 title 또는 label 에 있다 (초기 노드는 label 만 가진다)
      const name = `${(a.title as string | undefined) ?? ""} ${typeof a.label === "string" ? a.label : ""}`;
      const keywords = (a.searchKeywords as string[] ?? []).join(" ");
      const text = `${name}\n${a.description ?? ""}\n${keywords}`;
      let score = scoreMatch(text, strongTerms, weakTerms);
      for (const t of strongTerms) {
        if (t.length >= 2 && !GENERIC_TOKENS.has(t) && !ACTION_TOKENS.has(t) && !t.includes(" ") && name.includes(t)) score += ACTIVITY_NAME_BONUS;
      }
      // 동의어 확장 IRI에 포함된 활동은 보너스
      if (expandedIris.has(a["@id"] as string)) score += 100;
      return { node: a, score };
    })
    .filter(x => x.score >= ACTIVITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  // ─── 2. 의무문서 매칭 (title + alternativeNames + searchKeywords + 동의어 확장) ───
  const matchedDocs = docs
    .map(d => {
      const text = `${d.title}\n${d.description ?? ""}\n${(d.alternativeNames as string[] ?? []).join(" ")}\n${(d.searchKeywords as string[] ?? []).join(" ")}`;
      let score = scoreMatch(text, strongTerms, weakTerms);
      if (expandedIris.has(d["@id"] as string)) score += 100;
      return { node: d, score };
    })
    .filter(x => x.score >= DOC_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DOCS);

  // ─── 3. 활동에서 위험·통제·법령·가이드 derive ───
  const linkedHazardIris = new Set<string>();
  const linkedControlIris = new Set<string>();
  const linkedArticleIris = new Set<string>();
  // 검토를 거친 경로로 들어온 조문 — 여기에 없는 조문은 "검토 전 연결"로만 들어온 것이다
  const reviewedArticleIris = new Set<string>();
  const addRegulated = (activityIri: string, articleIris: string[]): void => {
    for (const r of articleIris) {
      linkedArticleIris.add(r);
      if (!isUnreviewedRegulation(r, activityIri)) reviewedArticleIris.add(r);
    }
  };
  const linkedGuideIris = new Set<string>();
  for (const m of matchedActivities) {
    for (const h of (m.node.hasHazard as string[] | undefined) ?? []) linkedHazardIris.add(h);
    addRegulated(m.node["@id"] as string, (m.node.regulatedBy as string[] | undefined) ?? []);
    for (const g of (m.node.guidedBy as string[] | undefined) ?? []) linkedGuideIris.add(g);
  }
  // 의무문서에서도 법령 derive
  for (const m of matchedDocs) {
    for (const a of (m.node.legalBasis as string[] | undefined) ?? []) { linkedArticleIris.add(a); reviewedArticleIris.add(a); }
    for (const g of (m.node.guidedBy as string[] | undefined) ?? []) linkedGuideIris.add(g);
  }
  // 동의어 확장 IRI 직접 추가
  for (const iri of expandedIris) {
    if (iri.startsWith("art:")) { linkedArticleIris.add(iri); reviewedArticleIris.add(iri); }
    else if (iri.startsWith("hazard:")) linkedHazardIris.add(iri);
    else if (iri.startsWith("activity:")) {
      // 활동 → hazard·통제 derive
      const act = activities.find(a => a["@id"] === iri);
      if (act) {
        for (const h of (act.hasHazard as string[] | undefined) ?? []) linkedHazardIris.add(h);
        addRegulated(iri, (act.regulatedBy as string[] | undefined) ?? []);
        for (const g of (act.guidedBy as string[] | undefined) ?? []) linkedGuideIris.add(g);
      }
    }
  }
  // 공종 — 작업명이 공종(강관비계·지하연속벽 등)을 가리키면 그 공종의 유해요인과 근거 조문을 잇는다
  const subtask = await getWorkSteps(q);
  /** 조문이 답에 들어온 길의 무게 — 조문 구획의 순서를 정한다 (찾은 공종의 대책이 많이 근거로 든 조문부터) */
  const graphWeight = new Map<string, number>();
  const bump = (iri: string, weight: number): void => {
    graphWeight.set(iri, Math.max(graphWeight.get(iri) ?? 0, weight));
  };
  for (const iri of linkedArticleIris) bump(iri, WEIGHT_ACTIVITY);
  if (subtask) {
    const node = all.find((n) => n["@id"] === subtask.result.iri) as SubtaskNode | undefined;
    for (const h of node?.hasHazard ?? []) linkedHazardIris.add(h);
    const cites = new Map<string, number>();
    for (const step of node?.steps ?? []) {
      for (const slot of step.stepHazards ?? []) {
        for (const risk of slot.risks ?? []) {
          for (const m of risk.measures ?? []) {
            const art = m.basis?.basisArticle;
            if (art) cites.set(art, (cites.get(art) ?? 0) + 1);
          }
        }
      }
    }
    for (const iri of (node?.regulatedBy ?? []).filter((r) => r.startsWith("art:"))) {
      linkedArticleIris.add(iri);
      bump(iri, WEIGHT_SUBTASK + (cites.get(iri) ?? 0));
    }
  }
  // 위험요인 → 통제·조문 derive
  for (const hIri of linkedHazardIris) {
    const haz = hazards.find(h => h["@id"] === hIri);
    if (!haz) continue;
    for (const c of (haz.mitigatedBy as string[] | undefined) ?? []) linkedControlIris.add(c);
    for (const a of ((haz.regulatedBy as string[] | undefined) ?? []).filter((r) => r.startsWith("art:"))) {
      linkedArticleIris.add(a);
      bump(a, WEIGHT_HAZARD);
    }
  }

  // ─── 4. 직접 article 검색 (fallback + 가중) ───
  const matchedArticles = articles
    .map(a => {
      const text = `${a.title}\n${a.description}`;
      let baseScore = scoreMatch(text, strongTerms, weakTerms);
      if (expandedIris.has(a["@id"] as string)) baseScore += 100;
      const relevanceBoost = a.constructionRelevance === "high" ? 30
        : a.constructionRelevance === "medium" ? 10 : 0;
      return { node: a, score: baseScore + relevanceBoost };
    })
    .filter(x => x.score > 30 && x.node.userVisible !== false && !x.node.isAppendix)
    .sort((a, b) => b.score - a.score);

  /** 작업·문서·공종·용어 사전·유해요인으로 이어져 들어온 조문 (글 겹침으로 들어온 것은 빼고) */
  const anchoredIris = new Set(linkedArticleIris);
  for (const m of matchedArticles.slice(0, MAX_ARTICLES)) { linkedArticleIris.add(m.node["@id"] as string); reviewedArticleIris.add(m.node["@id"] as string); }

  const searchOnlyIris = new Set<string>();
  const searchSoleIris = new Set<string>();
  // 문장 검색 — 현장 말로 쓴 문장을 조문 제목·본문과 공종 자료의 현장 문장에 견준다
  const searchRank = new Map<string, number>();
  (await searchArticles(all, q, SEARCH_LIMIT)).forEach((hit, i) => {
    searchRank.set(hit.iri, i + 1);
    // 다른 길(작업·문서·공종·용어 사전)로는 안 들어온 조문 — 글이 비슷할 뿐이라 따로 표시한다
    if (!anchoredIris.has(hit.iri)) searchOnlyIris.add(hit.iri);
    // 낱말 겹침으로도 안 들어온, 문장 검색 하나로만 들어온 조문 — 벌칙을 끌어오지 않는다
    if (!linkedArticleIris.has(hit.iri)) searchSoleIris.add(hit.iri);
    linkedArticleIris.add(hit.iri);
    reviewedArticleIris.add(hit.iri);
  });
  /** 질문이 작업·문서·공종·용어 사전 어디에도 걸리지 않았다 — 조문과 글이 겹친 것(낱말 겹침·문장 검색)만 있다 */
  const unanchored = matchedActivities.length === 0 && matchedDocs.length === 0 && expandedIris.size === 0 && !subtask;

  // ─── 5. 매칭된 article 의 penalizedBy 자동 추가 ───
  const penaltyArticles = new Set<string>();
  for (const aIri of linkedArticleIris) {
    // 문장 검색 하나로만 찾은 조문, 그리고 아무 이름에도 안 걸린 질문에서는 벌칙을 끌어오지 않는다
    if (unanchored || searchSoleIris.has(aIri)) continue;
    const a = articles.find(x => x["@id"] === aIri);
    if (!a) continue;
    for (const p of (a.penalizedBy as string[] | undefined) ?? []) {
      penaltyArticles.add(p);
      // 벌칙은 그 벌칙을 끌어온 조문의 검토 상태를 따른다
      if (reviewedArticleIris.has(aIri)) reviewedArticleIris.add(p);
    }
  }
  const reviewMark = (iri: string): string => (linkedArticleIris.has(iri) && !reviewedArticleIris.has(iri) ? " _(검토 전 연결)_" : "");
  let unreviewedShown = 0;
  // 벌칙도 표시할 article 목록에 추가 (단 별도 섹션)
  for (const pIri of penaltyArticles) linkedArticleIris.add(pIri);

  // ─── 6. 출력 조립 ───
  // 짧은 입력 (3자 이하) 처리: 매칭 너무 광범위해지므로 안내
  if (q.trim().length < 3) {
    return { content: [{ type: "text", text: `# 🏗️  현장 안전 brief\n\n입력이 너무 짧습니다 ("${q}"). 매칭 범위가 너무 넓어 의미 있는 결과 도출 불가.\n\n**제안 입력**:\n- 작업명: "거푸집 해체", "비계 설치", "타워크레인 신호", "굴착 흙막이"\n- 위험: "추락방지", "화재 예방", "감전", "협착"\n- 의무문서: "MSDS 등록", "유해위험방지계획서", "안전보건대장"\n- 사건: "재해 발생 보고", "응급조치", "안전조치 미이행"\n- 교육: "분기 정기교육", "관리감독자 교육", "건설업 기초안전보건교육"\n` }] };
  }

  // 비건설 도메인 키워드 감지 (scope.json out_of_domain)
  const outOfDomainKeywords = ["프레스", "전단기", "사출성형", "혼합기", "파쇄기", "선박", "어선", "농업", "어업", "항만", "급식실", "조리"];
  const outOfDomainHit = outOfDomainKeywords.find(k => q.includes(k));
  if (outOfDomainHit) {
    return { content: [{ type: "text", text: `# 🏗️  현장 안전 brief — "${q}"\n\n⚠️ **건설안전 도메인 외 입력 감지**: "${outOfDomainHit}"\n\n본 OSS는 한국 **건설현장 안전관리** 도메인에 한정 (scope.json 참조).\n${outOfDomainHit} 같은 일반 산업기계는 별도 산업안전 OSS 영역.\n\n**대안 도구**:\n- 산업안전보건법 §80 (안전인증) — \`get_safety_law_article({ lawCode: "osha", articleRef: "§80" })\`\n- KOSHA Guide 검색 — \`get_kosha_guide_md({ keyword: "${outOfDomainHit}" })\`\n- 건설현장 일반 안전관리 — 입력 "사업장 일반 안전" 또는 "통로·계단·표지"\n` }] };
  }

  let out = `# 🏗️  현장 안전 brief — "${q}"\n`;
  out += `> 페르소나: ${persona === "site_manager" ? "현장소장 (즉시 이해)" : "안전관리자 (법령 인용 포함)"}\n`;
  if (strongTerms.size > 1) {
    const expansion = [...strongTerms].filter(t => t !== q).slice(0, 6);
    if (expansion.length > 0) out += `> 동의어 확장: ${expansion.join(" / ")}\n`;
  }
  out += `\n`;

  // 법적 정확성 안내문 (적용조건·시기·용어 정정·제외 사유) — 최상단 표시
  if (notes.length > 0) {
    out += `## ⚠️ 법적 정확성 안내\n`;
    for (const n of notes) out += `- ${n}\n`;
    out += `\n`;
  }

  // 매칭 활동
  if (matchedActivities.length > 0) {
    out += `## 📌 매칭된 작업\n`;
    for (const m of matchedActivities) {
      const desc = String(m.node.description ?? "");
      const summary = desc.split("\n").find(l => l.trim().length > 20)?.trim().slice(0, 100) ?? "";
      const keywords = (m.node.searchKeywords as string[] | undefined)?.slice(0, 6).join(", ") ?? "";
      out += `- **${m.node.title ?? (typeof m.node.label === "string" ? m.node.label : "")}** (\`${m.node["@id"]}\`)`;
      if (summary) out += ` — ${summary}`;
      if (keywords) out += ` [키워드: ${keywords}]`;
      out += `\n`;
    }
    out += `\n`;
  }

  // 공종 노드 — 단계와 관련 지침
  if (subtask) {
    const st = subtask.result;
    out += `## 🧱 공종·작업 단계 — ${st.work} (\`${st.iri}\`)\n`;
    if (st.matchedBySynonym?.length) out += `> 공종 이름이 아니라 현장 용어 사전의 낱말로 찾은 공종입니다 (찾은 낱말: ${st.matchedBySynonym.join(", ")}) — 맞는 공종인지 확인하세요.\n`;
    for (const step of st.steps) {
      out += `- **${step.name}** — ${step.hazards.map((h) => h.hazardLabel).join(", ")}\n`;
    }
    for (const n of st.relatedNotices ?? []) {
      const arts = n.articles.map((x) => `${x.ref.split(" ").pop()} ${x.title}`).join(", ");
      out += `- 함께 볼 지침(권고 기준): ${n.law}${arts ? ` — ${arts}` : ""}\n`;
    }
    out += `- 단계별 근거(조문의 호·목, KOSHA Guide 조항): \`analyze_construction_work_risks({workType: "${st.work}"})\`\n\n`;
  }

  // 위험요인
  if (linkedHazardIris.size > 0) {
    out += `## ⚠️  위험요인\n`;
    for (const hIri of [...linkedHazardIris].slice(0, 8)) {
      const haz = hazards.find(h => h["@id"] === hIri);
      if (!haz) continue;
      const desc = String(haz.description ?? "").slice(0, 80);
      out += `- **${haz.label ?? haz.title ?? hIri}** (${haz.category ?? ""}) — ${desc}\n`;
    }
    out += `\n`;
  }

  // 필수 통제
  if (linkedControlIris.size > 0) {
    out += `## 🛡️  필수 통제 (ERIC-PP)\n`;
    for (const cIri of [...linkedControlIris].slice(0, 8)) {
      const ctl = controls.find(c => c["@id"] === cIri);
      if (!ctl) continue;
      out += `- **${ctl.label ?? ctl.title ?? cIri}** (${ctl.eric ?? ctl.category ?? ""})\n`;
    }
    out += `\n`;
  }

  // 의무문서 (양식·서식 메타 포함)
  if (matchedDocs.length > 0) {
    out += `## 📋 의무문서 (양식·서식)\n`;
    for (const md of matchedDocs) {
      const d = md.node;
      const lb = (d.legalBasis as string[] | undefined) ?? [];
      const lbStr = lb.length > 0 ? ` — ${lb.slice(0, 3).join(", ")}` : "";
      const meta = (d._meta as Record<string, unknown> | undefined) ?? {};
      const formInfo = meta.hwpDownloadUrl ? " 📥 양식 가능" : "";
      out += `- **${d.title}** (\`${d.docId}\`) — ${d.cycle}${lbStr}${formInfo}\n`;
    }
    out += `\n`;
  }

  // 법령 근거 (의무 조문) — expandsTo IRI 무조건 모두 포함 + 나머지는 점수 정렬
  const isVisibleArticle = (a: Record<string, unknown> | undefined) =>
    a && a.userVisible !== false && !a.isAppendix && a.constructionRelevance !== "none" && !excluded.has(a["@id"] as string) &&
    // 고시·지침은 권고 기준이다 — 어느 길로 들어왔든 의무 조문 구획에는 싣지 않는다 (공종 구획의 "함께 볼 지침"으로 나온다)
    a.legislationType !== NOTIFICATION_TYPE;

  const expansionArts = [...expandedIris]
    .filter(iri => iri.startsWith("art:"))
    .map(iri => articles.find(a => a["@id"] === iri))
    .filter(isVisibleArticle)
    .filter(a => !penaltyArticles.has(a!["@id"] as string));

  const expansionRank = new Map<string, number>();
  expansionArts.forEach((a, i) => expansionRank.set(a!["@id"] as string, i + 1));

  // 조문이 답에 들어온 세 길 — 용어 사전이 짚은 조문, 그래프로 이어진 조문(공종 > 작업 > 유해요인), 문장 검색 —
  // 의 순위를 합친다. 여러 길에서 앞선 조문이 맨 앞에 오고, 한 길이 앞자리를 다 차지하지 않는다.
  const rankedArts = [...new Set([...expandedIris, ...linkedArticleIris])]
    .map(iri => articles.find(a => a["@id"] === iri))
    .filter(isVisibleArticle)
    .filter(a => !penaltyArticles.has(a!["@id"] as string))
    .map(a => {
      const text = `${a!.title}\n${a!.description}`;
      return { node: a!, score: scoreMatch(text, strongTerms, weakTerms), weight: graphWeight.get(a!["@id"] as string) ?? 0 };
    })
    .sort((a, b) => b.weight - a.weight || b.score - a.score)
    .map((x, i) => {
      const id = x.node["@id"] as string;
      const part = (rank: number | undefined, weight: number): number => (rank ? weight / (RANK_FUSION_K + rank) : 0);
      const fused =
        part(expansionRank.get(id), FUSION_WEIGHT_DICTIONARY) +
        part(x.weight > 0 ? i + 1 : undefined, FUSION_WEIGHT_GRAPH) +
        part(searchRank.get(id), FUSION_WEIGHT_SEARCH);
      return { node: x.node, fused, order: i };
    })
    .sort((a, b) => b.fused - a.fused || a.order - b.order)
    .map(x => x.node);

  const seen = new Set<string>();
  const obligationArticles: Record<string, unknown>[] = [];
  /** 상한을 넘은 조문 — 버리지 않고 제목만 적는다 */
  const restArticles: Record<string, unknown>[] = [];
  for (const a of rankedArts) {
    const id = a!["@id"] as string;
    if (seen.has(id)) continue;
    seen.add(id);
    if (obligationArticles.length < MAX_ARTICLES) obligationArticles.push(a!);
    else restArticles.push(a!);
  }
  let similarShown = 0;
  if (obligationArticles.length > 0) {
    out += unanchored ? `${SIMILAR_SECTION_HEAD}\n> ${SIMILAR_SECTION_NOTE}\n` : `## 📖 법령 근거 (의무 조문)\n`;
    for (const a of obligationArticles) {
      const desc = String(a!.description ?? "");
      const summary = desc.split("\n").find(l => l.trim().length > 20)?.trim().slice(0, 120) ?? "";
      let mark = reviewMark(a!["@id"] as string);
      if (mark) unreviewedShown += 1;
      if (!unanchored && searchOnlyIris.has(a!["@id"] as string)) {
        mark += SIMILAR_MARK;
        similarShown += 1;
      }
      out += `- **${a!["@id"]}** ${a!.title}${mark} — ${summary}\n`;
    }
    if (similarShown > 0) out += `> ${SIMILAR_NOTE} (${similarShown}건)\n`;
    if (restArticles.length > 0) {
      const restText = restArticles.map((a) => {
        const mark = reviewMark(a["@id"] as string);
        if (mark) unreviewedShown += 1;
        return `\`${a["@id"]}\` ${a.title}${mark}`;
      });
      out += `- 그 밖의 관련 조문 ${restArticles.length}개 (제목만): ${restText.join(" · ")}\n`;
    }
    out += `\n`;
  }

  // 처벌 (별도 섹션 — 현장 사용자가 "벌칙" 직접 보고싶어함)
  // 동의어 그룹 violation_penalty 매칭 시 중처법 벌칙도 포함
  const penaltyOutSet = new Set(penaltyArticles);
  for (const iri of expandedIris) {
    if (iri.startsWith("art:") && (iri.includes("중처법:6") || iri.includes("중처법:7") || iri.includes("중처법:8") || iri.includes("산안법:167") || iri.includes("산안법:168") || iri.includes("산안법:170") || iri.includes("산안법:175"))) {
      penaltyOutSet.add(iri);
    }
  }
  if (penaltyOutSet.size > 0) {
    out += `## ⚖️  위반 시 처벌\n`;
    for (const pIri of [...penaltyOutSet].slice(0, 8)) {
      const p = articles.find(a => a["@id"] === pIri);
      if (!p) continue;
      const desc = String(p.description ?? "");
      const summary = desc.split("\n").find(l => l.trim().length > 20)?.trim().slice(0, 130) ?? p.title;
      const mark = reviewMark(p["@id"] as string);
      if (mark) unreviewedShown += 1;
      out += `- **${p["@id"]}** ${p.title}${mark} — ${summary}\n`;
    }
    out += `\n`;
  }
  if (unreviewedShown > 0) out += `> ${UNREVIEWED_NOTE} (${unreviewedShown}건)\n\n`;

  // KOSHA Guide
  if (linkedGuideIris.size > 0) {
    out += `## 📚 KOSHA Guide\n`;
    const finalGuides = [...linkedGuideIris].slice(0, MAX_GUIDES)
      .map(iri => guides.find(g => g["@id"] === iri))
      .filter(g => g);
    for (const g of finalGuides) {
      out += `- **${g!.title}** (\`${(g!._meta as Record<string, unknown>)?.guideNo ?? ""}\`)\n`;
    }
    out += `\n`;
  }

  // 매칭 0건 처리
  if (unanchored && obligationArticles.length === 0) {
    out += `매칭된 결과 없음. 다른 키워드로 시도해 보세요.\n`;
    out += `\n**제안 키워드**: "거푸집 해체", "비계 설치", "MSDS 등록", "추락방지", "재해 보고", "분기 정기교육", "위험성평가", "안전관리자 선임"\n`;
  } else {
    out += `\n---\n💡 더 자세한 정보: \`get_safety_law_article\`, \`get_kosha_guide_md\`, \`get_safety_document_guide\` 도구로 조문/가이드/문서 본문 직접 조회.\n`;
  }

  return { content: [{ type: "text", text: out }] };
}

export const fieldSafetyBriefingTool: ToolDefinition = {
  name: "field_safety_briefing",
  description: "🏗️ 현장 안전 통합 brief — 작업명·위험·의무 토픽 한 줄 입력 → 위험요인·필수통제·법령근거·의무문서·KOSHA 가이드·**위반 시 처벌**까지 한 화면 요약. 현장소장(즉시 이해)·안전관리자(법령 인용) 페르소나별 정렬. **현장 용어 사전** 자동 확장 ('분기'≈'정기'·'도료'≈'MSDS'·'사망'≈'중대재해') + 현장 말로 쓴 문장과 글이 비슷한 조문 검색. 산안법·시행령·시행규칙·기준규칙·중처법·위험성평가-고시(번들 6 본문 + 중처법시행령 그래프 노드)·KOSHA Guide 본문 1,039건 (offline 번들)을 cover. 부칙·법무 전문 조항은 default 제외 (userVisible=false 필터).",
  inputSchema,
  handler,
};
