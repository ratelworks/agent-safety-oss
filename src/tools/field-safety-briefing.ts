import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";

// 파일 최상단 상수 — 현장 사용자(현장소장·안전관리자) 친화 통합 brief
// 작업명 입력 → 5초 안에 위험·통제·법령·의무문서·KOSHA 한 화면 요약
// synonyms.json 동의어 사전 + doc.searchKeywords + activity.searchKeywords + penaltyMap 활용
const MAX_ARTICLES = 15;  // expansion IRI 모두 포함 가능 수준
const MAX_GUIDES = 5;
const MAX_DOCS = 10;
const ACTIVITY_THRESHOLD = 50;  // 활동 매칭 score 하한 (false positive 방지)
const DOC_THRESHOLD = 60;  // 의무문서 매칭 score 하한

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "ontology", "graph", "nodes");
const SYNONYMS_PATH = resolve(__dirname, "..", "ontology", "synonyms.json");

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
  for (const tok of query.split(/[\s.,()·]+/)) {
    if (tok.length >= 2) strong.add(tok);
  }
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
      const text = `${a.title}\n${a.description}\n${(a.searchKeywords as string[] ?? []).join(" ")}`;
      let score = scoreMatch(text, strongTerms, weakTerms);
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
  const linkedGuideIris = new Set<string>();
  for (const m of matchedActivities) {
    for (const h of (m.node.hasHazard as string[] | undefined) ?? []) linkedHazardIris.add(h);
    for (const r of (m.node.regulatedBy as string[] | undefined) ?? []) linkedArticleIris.add(r);
    for (const g of (m.node.guidedBy as string[] | undefined) ?? []) linkedGuideIris.add(g);
  }
  // 의무문서에서도 법령 derive
  for (const m of matchedDocs) {
    for (const a of (m.node.legalBasis as string[] | undefined) ?? []) linkedArticleIris.add(a);
    for (const g of (m.node.guidedBy as string[] | undefined) ?? []) linkedGuideIris.add(g);
  }
  // 동의어 확장 IRI 직접 추가
  for (const iri of expandedIris) {
    if (iri.startsWith("art:")) linkedArticleIris.add(iri);
    else if (iri.startsWith("hazard:")) linkedHazardIris.add(iri);
    else if (iri.startsWith("activity:")) {
      // 활동 → hazard·통제 derive
      const act = activities.find(a => a["@id"] === iri);
      if (act) {
        for (const h of (act.hasHazard as string[] | undefined) ?? []) linkedHazardIris.add(h);
        for (const r of (act.regulatedBy as string[] | undefined) ?? []) linkedArticleIris.add(r);
        for (const g of (act.guidedBy as string[] | undefined) ?? []) linkedGuideIris.add(g);
      }
    }
  }
  // 위험요인 → 통제 derive
  for (const hIri of linkedHazardIris) {
    const haz = hazards.find(h => h["@id"] === hIri);
    if (!haz) continue;
    for (const c of (haz.mitigatedBy as string[] | undefined) ?? []) linkedControlIris.add(c);
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

  for (const m of matchedArticles.slice(0, MAX_ARTICLES)) linkedArticleIris.add(m.node["@id"] as string);

  // ─── 5. 매칭된 article 의 penalizedBy 자동 추가 ───
  const penaltyArticles = new Set<string>();
  for (const aIri of linkedArticleIris) {
    const a = articles.find(x => x["@id"] === aIri);
    if (!a) continue;
    for (const p of (a.penalizedBy as string[] | undefined) ?? []) penaltyArticles.add(p);
  }
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
      out += `- **${m.node.title}** (\`${m.node["@id"]}\`)`;
      if (summary) out += ` — ${summary}`;
      if (keywords) out += ` [키워드: ${keywords}]`;
      out += `\n`;
    }
    out += `\n`;
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
    a && a.userVisible !== false && !a.isAppendix && a.constructionRelevance !== "none" && !excluded.has(a["@id"] as string);

  const expansionArts = [...expandedIris]
    .filter(iri => iri.startsWith("art:"))
    .map(iri => articles.find(a => a["@id"] === iri))
    .filter(isVisibleArticle)
    .filter(a => !penaltyArticles.has(a!["@id"] as string));

  const otherArts = [...linkedArticleIris]
    .filter(iri => !expandedIris.has(iri))
    .map(iri => articles.find(a => a["@id"] === iri))
    .filter(isVisibleArticle)
    .filter(a => !penaltyArticles.has(a!["@id"] as string))
    .map(a => {
      const text = `${a!.title}\n${a!.description}`;
      return { node: a!, score: scoreMatch(text, strongTerms, weakTerms) };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.node);

  const seen = new Set<string>();
  const obligationArticles: Record<string, unknown>[] = [];
  for (const a of [...expansionArts, ...otherArts]) {
    const id = a!["@id"] as string;
    if (seen.has(id)) continue;
    seen.add(id);
    obligationArticles.push(a!);
    if (obligationArticles.length >= MAX_ARTICLES) break;
  }
  if (obligationArticles.length > 0) {
    out += `## 📖 법령 근거 (의무 조문)\n`;
    for (const a of obligationArticles) {
      const desc = String(a!.description ?? "");
      const summary = desc.split("\n").find(l => l.trim().length > 20)?.trim().slice(0, 120) ?? "";
      out += `- **${a!["@id"]}** ${a!.title} — ${summary}\n`;
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
      out += `- **${p["@id"]}** ${p.title} — ${summary}\n`;
    }
    out += `\n`;
  }

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
  if (matchedActivities.length === 0 && matchedDocs.length === 0 && matchedArticles.length === 0 && expandedIris.size === 0) {
    out += `매칭된 결과 없음. 다른 키워드로 시도해 보세요.\n`;
    out += `\n**제안 키워드**: "거푸집 해체", "비계 설치", "MSDS 등록", "추락방지", "재해 보고", "분기 정기교육", "위험성평가", "안전관리자 선임"\n`;
  } else {
    out += `\n---\n💡 더 자세한 정보: \`get_safety_law_article\`, \`get_kosha_guide_md\`, \`get_safety_document_guide\` 도구로 조문/가이드/문서 본문 직접 조회.\n`;
  }

  return { content: [{ type: "text", text: out }] };
}

export const fieldSafetyBriefingTool: ToolDefinition = {
  name: "field_safety_briefing",
  description: "🏗️ 현장 안전 통합 brief — 작업명·위험·의무 토픽 한 줄 입력 → 위험요인·필수통제·법령근거·의무문서·KOSHA 가이드·**위반 시 처벌**까지 한 화면 요약. 현장소장(즉시 이해)·안전관리자(법령 인용) 페르소나별 정렬. **동의어 사전 28그룹** 자동 확장 ('분기'≈'정기'·'도료'≈'MSDS'·'사망'≈'중대재해'). 산안법·시행령·시행규칙·기준규칙·중처법·위험성평가-고시(번들 6 본문 + 중처법시행령 그래프 노드)·KOSHA Guide 본문 1,039건 (offline 번들)을 cover. 부칙·법무 전문 조항은 default 제외 (userVisible=false 필터).",
  inputSchema,
  handler,
};
