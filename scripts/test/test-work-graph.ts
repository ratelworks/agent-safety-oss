#!/usr/bin/env tsx
/**
 * test-work-graph.ts — 공종 단계·위험요인·대책과 고시 장·절 연결의 구조 시험
 *
 * 지키려는 것
 *   1. 공종 노드 안의 단계·위험요인·대책에 주소가 있고 겹치지 않는다
 *   2. 대책 → 근거(조문·별표·가이드), 위험요인 → 유해요인 연결이 모두 그래프에 있는 노드를 가리킨다
 *   3. 표준 JSON-LD 확장에서 그 연결이 대상 노드와 같은 주소로 풀린다 (필드 이름이 접두어와 겹치면 어긋난다)
 *   4. 조문·대책에서 거꾸로 찾을 수 있다 (조문 → 대책 → 공종)
 *   5. 조문의 법령 종류가 소속 법령과 같다
 *   6. 고시의 장·절이 조문을 빠짐없이 담고, 연결한 공종·작업이 실제 노드다
 *   7. 연결마다 정한 방식(원천·이름 대응·내용 판단)이 적혀 있고, 응답에 그 표기와 빈 곳이 나온다
 *   8. 공종 이름이 없는 질문은 동의어 사전으로 찾는다 (사전에 없는 말은 추측하지 않는다)
 *   9. 유해요인 → 조문 연결은 공종 대책의 근거에서 끌어내고, 끌어낸 것임을 적는다
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";
import { getNode, neighborsByEdge, listNodesByType } from "../../src/lib/graph-nodes-loader.js";
import { findMeasuresCiting, findFieldMeasuresForHazard } from "../../src/lib/field-measures.js";
import { findWork, getWorkSteps, pickFocusSteps, LINK_BASIS_LABEL } from "../../src/lib/work-steps.js";
import { fieldSafetyBriefingTool } from "../../src/tools/field-safety-briefing.js";
import { searchArticles } from "../../src/lib/article-search.js";
import { generateTbmTopicsTool } from "../../src/tools/generate-tbm-topics.js";
import { suggestControlsForHazardTool } from "../../src/tools/suggest-controls-for-hazard.js";
import { analyzeConstructionWorkRisksTool } from "../../src/tools/analyze-construction-work-risks.js";
import { resolveWorkConditions, RULE_SCOPE } from "../../src/lib/work-conditions.js";
import { doclangToMarkdown, readDclxDocument } from "../../src/lib/dclx.js";

/** KOSHA Guide 본문 — 원본 .dclx 를 그린 Markdown (없으면 빈 글) */
async function guideBody(guideNo: string): Promise<string> {
  try {
    return doclangToMarkdown(readDclxDocument(await readFile(resolve(__dirname, "..", "..", "src", "ontology", "kosha-guides", `${guideNo}.dclx`))));
  } catch {
    return "";
  }
}

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH = resolve(__dirname, "..", "..", "src", "ontology", "graph");
const NODES = resolve(GRAPH, "nodes");
const CC = "https://construction.ratelworks.org/ontology/v1/";
const SAFETY = "https://safety.ratelworks.org/ontology/v1/";
/** 조문 주소의 법령 키 → 법령 종류. 조문은 소속 법령의 종류를 따른다 */
const LAW_TYPE: Record<string, string> = {
  산안법: "Act",
  산안법시행령: "Decree",
  산안법시행규칙: "Rule",
  기준규칙: "Rule",
  중처법: "Act",
  중처법시행령: "Decree",
  건진법: "Act",
  건진법시행령: "Decree",
  건진법시행규칙: "Rule",
};
/** 역방향 조회를 확인할 조문 — 굴착 인접 매설물 방호 (여러 흙막이 공종의 대책 근거) */
const SAMPLE_ARTICLE = "art:기준규칙:341";
/**
 * 가이드 근거 위치 정답 — 공단 포털 원본 PDF 에서 확인한 조항 제목과 쪽 (2026-11-16).
 * 본문 글자 맞춤은 C-47-2023 에서 목차 줄("… ⇥10")을, D-C-13-2026 에서 본문에 인용된 법령 항목("6. 안전모를 착용하되 …")을 잡았다.
 */
const KNOWN_GUIDE_LOCATIONS: Record<string, { text: string; page: number }> = {
  "KOSHA Guide C-47-2023 5.2.5": { text: "5.2.5 팽창제에 의한 해체작업", page: 13 },
  "KOSHA Guide D-C-13-2026 6": { text: "6 작업계획서 작성시기 및 승인", page: 16 },
  "KOSHA Guide D-C-7-2026 부록 2": { text: "부록 2 강관비계 및 시스템비계 안전점검표(예)", page: 66 },
  // 본문 끝 참고문헌 목록의 "5. …"·"6. …" 줄을 조항 제목으로 잡지 않는다
  "KOSHA Guide C-66-2016 5": { text: "5 안전작업 공통 사항", page: 5 },
  "KOSHA Guide C-66-2016 6": { text: "6 천장공사 안전관리사항", page: 7 },
  "KOSHA Guide C-11-2012 5": { text: "5 가설계단의 설치기준", page: 4 },
  // 쪽 경계에서 앞 문단에 붙어 판독된 절 제목 — 실제 쪽(13쪽)
  "KOSHA Guide C-6-2015 5.5": { text: "5.5 타일줄눈 및 타일붙이기 작업", page: 13 },
};
const SAMPLE_HAZARD = "hazard:fall_from_height";
/** 정한 방식을 적어야 하는 연결 — 공종 노드 / 고시 장·절 노드 */
/** 조문 낱말("투하")이 없는 현장 문장과, 그 문장으로 찾아야 하는 조문 */
const FIELD_QUERY = "쓰레기 자루를 위층에서 밑으로 내던진다";
const FIELD_QUERY_ARTICLE = "art:기준규칙:15";
const SEARCH_TOP = 15;
const SEARCH_WIDE = 200;
/** 지침 조문과 낱말이 많이 겹치는 문장 — 의무 조문 구획에 지침이 섞이는지 본다 */
const NOTIFICATION_QUERY = "트럭 짐 위에 올라가 작업";
/** 지침 이름이 그대로 든 질문 — 문장 검색 밖의 길로 지침이 들어오는지 본다 */
const NOTIFICATION_QUERY_BY_NAME = "가설공사 안전 작업";
/** 문서 이름으로 찾는 것이 있으면서 문장 검색 결과도 많이 붙는 질문 */
const MIXED_QUERY = "MSDS 등록";
/** 그 질문에 문장 검색으로만 들어오는 조문 (타워크레인 설치·해체업 등록요건) */
const MIXED_SEARCH_ONLY_ARTICLE = "`art:산안법시행령:72`";
const SUBTASK_LINK_KEYS = ["regulatedBy", "guidedBy", "steps", "hasHazard", "broader", "references"];
const CHAPTER_LINK_KEYS = ["partOf", "hasArticle", "appliesTo", "appliesToActivity"];

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
}

async function readDir(dir: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const f of await readdir(resolve(NODES, dir))) {
    if (f.endsWith(".jsonld")) out.push(await readJson(resolve(NODES, dir, f)));
  }
  return out;
}

interface RawMeasure {
  "@id"?: string;
  measure?: string;
  basis?: { basisArticle?: string; basisAnnex?: string; basisGuide?: string };
}
interface RawStep {
  "@id"?: string;
  stepHazards?: { hasHazard?: string; risks?: { "@id"?: string; measures?: RawMeasure[] }[] }[];
}

async function main(): Promise<void> {
  const subtasks = await readDir("subtasks");

  // 1. 주소 — 단계·위험요인은 하나뿐이어야 하고, 같은 주소의 대책은 내용이 같아야 한다
  const stepIds: string[] = [];
  const riskIds: string[] = [];
  const measureBody = new Map<string, string>();
  let measureUses = 0;
  let missingId = 0;
  let measureConflict = 0;
  const targets = new Set<string>();
  for (const sub of subtasks) {
    for (const step of (sub.steps ?? []) as RawStep[]) {
      if (step["@id"]) stepIds.push(step["@id"]);
      else missingId += 1;
      for (const slot of step.stepHazards ?? []) {
        if (slot.hasHazard) targets.add(slot.hasHazard);
        for (const risk of slot.risks ?? []) {
          if (risk["@id"]) riskIds.push(risk["@id"]);
          else missingId += 1;
          for (const m of risk.measures ?? []) {
            measureUses += 1;
            if (!m["@id"]) {
              missingId += 1;
              continue;
            }
            const body = JSON.stringify(m);
            if (measureBody.has(m["@id"]) && measureBody.get(m["@id"]) !== body) measureConflict += 1;
            measureBody.set(m["@id"], body);
            const t = m.basis?.basisArticle ?? m.basis?.basisAnnex ?? m.basis?.basisGuide;
            if (t) targets.add(t);
          }
        }
      }
    }
  }
  check("단계·위험요인·대책에 주소가 있다", missingId === 0, `주소 없는 것 ${missingId}`);
  check("단계 주소가 겹치지 않는다", new Set(stepIds).size === stepIds.length, `${stepIds.length}개`);
  check("위험요인 주소가 겹치지 않는다", new Set(riskIds).size === riskIds.length, `${riskIds.length}개`);
  check("같은 주소의 대책은 내용이 같다", measureConflict === 0, `대책 ${measureUses}건 → 노드 ${measureBody.size}개`);

  // 2. 연결 대상이 그래프에 있다
  const missingTargets: string[] = [];
  for (const t of targets) if (!(await getNode(t))) missingTargets.push(t);
  check("근거·유해요인 연결이 모두 있는 노드를 가리킨다", missingTargets.length === 0, `대상 ${targets.size}개, 없는 것 ${missingTargets.slice(0, 3).join(", ") || 0}`);

  // 그래프에 올라왔는가
  const sampleRisk = riskIds[0];
  check("위험요인이 그래프 노드로 조회된다", Boolean(await getNode(sampleRisk)), sampleRisk);
  check("공종 → 단계 연결이 있다", (await neighborsByEdge(String(subtasks[0]["@id"]), "hasStep")).length > 0);

  // 3. 표준 확장에서 연결이 대상 노드와 같은 주소로 풀린다
  const ctx = await readJson(resolve(GRAPH, "context.jsonld"));
  const prefixes = ctx["@context"] as Record<string, unknown>;
  const expandId = (id: string): string => {
    const i = id.indexOf(":");
    const base = prefixes[id.slice(0, i)];
    return typeof base === "string" ? base + id.slice(i + 1) : id;
  };
  const documentLoader = async (url: string): Promise<{ contextUrl: undefined; document: unknown; documentUrl: string }> => ({
    contextUrl: undefined,
    document: ctx,
    documentUrl: url,
  });
  let expandMismatch = 0;
  let expandChecked = 0;
  for (const sub of subtasks.slice(0, 10)) {
    const expanded = (await jsonld.expand({ ...sub, "@context": "https://safety.ratelworks.org/context.jsonld" } as never, {
      documentLoader: documentLoader as never,
    })) as unknown as Record<string, unknown>[];
    const found = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o)) {
          if ([`${CC}basisArticle`, `${CC}basisAnnex`, `${CC}basisGuide`, `${SAFETY}hasHazard`].includes(k)) {
            for (const x of v as { "@id"?: string }[]) if (x["@id"]) found.add(x["@id"]);
          }
          walk(v);
        }
      }
    };
    walk(expanded);
    const expected = new Set<string>();
    for (const step of (sub.steps ?? []) as RawStep[]) {
      for (const slot of step.stepHazards ?? []) {
        if (slot.hasHazard) expected.add(expandId(slot.hasHazard));
        for (const risk of slot.risks ?? []) {
          for (const m of risk.measures ?? []) {
            const t = m.basis?.basisArticle ?? m.basis?.basisAnnex ?? m.basis?.basisGuide;
            if (t) expected.add(expandId(t));
          }
        }
      }
    }
    for (const id of sub.hasHazard as string[]) expected.add(expandId(id));
    for (const e of expected) {
      expandChecked += 1;
      if (!found.has(e)) expandMismatch += 1;
    }
  }
  check("표준 확장에서 근거·유해요인 연결이 대상 노드 주소로 풀린다", expandChecked > 0 && expandMismatch === 0, `${expandChecked}개 확인, 어긋남 ${expandMismatch}`);

  // 4. 역방향 조회
  const citing = await findMeasuresCiting(SAMPLE_ARTICLE);
  check("조문 → 대책 → 공종을 거꾸로 찾는다", citing.length > 0 && citing.every((m) => m.works.length > 0), `${SAMPLE_ARTICLE}: 대책 ${citing.length}건`);
  const byHazard = await findFieldMeasuresForHazard(SAMPLE_HAZARD);
  check("유해요인 → 위험요인 → 대책을 찾는다", byHazard.riskCount > 0 && byHazard.measures.length > 0, `위험요인 ${byHazard.riskCount}건, 대책 ${byHazard.measures.length}건`);

  // 5. 조문의 법령 종류
  const articles = await readDir("articles");
  const wrongType = articles.filter((a) => {
    const key = String(a["@id"]).split(":")[1];
    return LAW_TYPE[key] !== undefined && a.legislationType !== LAW_TYPE[key];
  });
  check("조문의 법령 종류가 소속 법령과 같다", wrongType.length === 0, `어긋난 조문 ${wrongType.length}개`);

  // 6. 고시 장·절
  // 고시의 장·절만 — 법·시행령·규칙의 장은 대상이 아니다
  const chapters = (await readDir("chapters")).filter((c) => LAW_TYPE[String(c["@id"]).split(":")[1] ?? ""] === undefined);
  const inChapter = new Set<string>();
  const badLinks: string[] = [];
  for (const c of chapters) {
    for (const a of (c.hasArticle ?? []) as string[]) {
      inChapter.add(a);
      if (!(await getNode(a))) badLinks.push(a);
    }
    for (const t of [...((c.appliesTo ?? []) as string[]), ...((c.appliesToActivity ?? []) as string[])]) {
      if (!(await getNode(t))) badLinks.push(t);
    }
  }
  check("고시 장·절의 조문·공종·작업 연결이 모두 있는 노드다", chapters.length > 0 && badLinks.length === 0, `장·절 ${chapters.length}개, 없는 대상 ${badLinks.length}`);
  const chapterActKeys = new Set(chapters.map((c) => String(c["@id"]).split(":")[1]));
  const loose = articles.filter((a) => {
    const key = String(a["@id"]).split(":")[1];
    return chapterActKeys.has(key) && !inChapter.has(String(a["@id"]));
  });
  check("장이 있는 고시의 조문은 모두 장에 속한다", loose.length === 0, `장에 없는 조문 ${loose.length}개 ${loose.slice(0, 3).map((a) => String(a["@id"])).join(", ")}`);

  // 7. 연결을 정한 방식과 빈 곳
  const missingBasis: string[] = [];
  const checkBasis = (node: Record<string, unknown>, keys: string[]): void => {
    const basis = ((node._meta ?? {}) as { linkBasis?: Record<string, string> }).linkBasis ?? {};
    for (const k of keys) {
      const v = node[k];
      const present = Array.isArray(v) ? v.length > 0 : Boolean(v);
      if (present && !LINK_BASIS_LABEL[basis[k] ?? ""]) missingBasis.push(`${String(node["@id"])}.${k}`);
    }
  };
  for (const s of subtasks) checkBasis(s, SUBTASK_LINK_KEYS);
  for (const c of chapters) checkBasis(c, CHAPTER_LINK_KEYS);
  check("연결마다 정한 방식이 적혀 있다", missingBasis.length === 0, `빠진 곳 ${missingBasis.length} ${missingBasis.slice(0, 3).join(", ")}`);

  let withGaps = 0;
  let gapMismatch = 0;
  for (const s of subtasks) {
    const res = await getWorkSteps(String(s.title));
    if (!res || res.result.iri !== s["@id"]) continue;
    if (res.result.gaps?.length) withGaps += 1;
    // 상위 작업이 없는 공종은 그 사실이 응답에 나와야 한다
    const saysNoParent = (res.result.gaps ?? []).some((g) => g.startsWith("상위 작업"));
    if (Boolean(s.broader) === saysNoParent) gapMismatch += 1;
  }
  check("상위 작업이 없는 공종은 응답에 그 사실이 나온다", gapMismatch === 0, `빈 곳을 알린 공종 ${withGaps}개, 어긋남 ${gapMismatch}`);

  // 고시는 이어졌는데 조문을 짚지 못한 공종도 그 사실이 나와야 한다
  // 조문이 없는 고시는 다른 고시에 조문이 있어도 하나하나 알려야 한다
  let silentEmptyNotice = 0;
  let emptyNotices = 0;
  for (const s of subtasks) {
    const res = await getWorkSteps(String(s.title));
    if (!res || res.result.iri !== s["@id"]) continue;
    for (const n of res.result.relatedNotices ?? []) {
      if (n.articles.length > 0) continue;
      emptyNotices += 1;
      if (!(res.result.gaps ?? []).some((g) => g.includes(n.law) && g.includes("짚지 못했다"))) silentEmptyNotice += 1;
    }
  }
  check("조문을 짚지 못한 고시는 응답에 그 사실이 나온다", silentEmptyNotice === 0, `조문 없는 고시 연결 ${emptyNotices}건, 알리지 않은 것 ${silentEmptyNotice}`);

  // 8. 공종 이름이 없는 질문은 동의어 사전으로 찾고, 사전에 없는 말은 찾지 않는다
  const bySynonym = await findWork("항타기로 파일을 박는데 지반이 무르다");
  check("공종 이름이 없는 질문을 동의어 사전으로 찾는다", bySynonym?.work.name === "기초파일작업" && (bySynonym.matchedBy?.length ?? 0) > 0, `${bySynonym?.work.name ?? "없음"} ← ${bySynonym?.matchedBy?.join(", ") ?? ""}`);
  // 사전으로 찾은 공종은 어떤 낱말로 찾았는지 글에 나와야 한다 — 이름으로 찾은 것과 구분하도록
  const SYNONYM_QUERY = "항타기로 파일을 박는데 지반이 무르다";
  const briefingText = (await fieldSafetyBriefingTool.handler({ workOrTopic: SYNONYM_QUERY })).content[0]?.text ?? "";
  const tbmText = (await generateTbmTopicsTool.handler({ activityLabel: SYNONYM_QUERY })).content[0]?.text ?? "";
  // 도구마다 따로 본다 — 공종 이름과, 공종 찾기가 실제로 돌려준 낱말이 그대로 나와야 한다
  const expectedNote = `찾은 낱말: ${(bySynonym?.matchedBy ?? []).join(", ")})`;
  for (const [tool, text] of [["현장 브리핑", briefingText], ["TBM 주제", tbmText]] as const) {
    const ok = (bySynonym?.matchedBy?.length ?? 0) > 0 && text.includes("기초파일작업") && text.includes(expectedNote);
    check(`${tool}: 사전으로 찾은 공종과 찾은 낱말을 글에 적는다`, ok, ok ? expectedNote : `공종 ${text.includes("기초파일작업") ? "있음" : "없음"}, "${expectedNote}" ${text.includes(expectedNote) ? "있음" : "없음"}`);
  }
  const unrelated: string[] = [];
  for (const q of ["점심 메뉴를 추천해 달라", "오늘 날씨가 좋아서 기분이 좋다", "회의실 예약을 도와 달라"]) {
    const hit = await findWork(q);
    if (hit) unrelated.push(`${q} → ${hit.work.name}`);
  }
  check("공사와 무관한 말은 공종에 맞추지 않는다", unrelated.length === 0, unrelated.join(" / "));
  const synonymTargets = (JSON.parse(await readFile(resolve(GRAPH, "..", "synonyms.json"), "utf-8")) as { groups: { expandsTo: string[] }[] }).groups
    .flatMap((g) => g.expandsTo)
    .filter((iri) => iri.startsWith("subtask:") || iri.startsWith("hazard:"));
  const missingSynonymTargets: string[] = [];
  for (const iri of new Set(synonymTargets)) if (!(await getNode(iri))) missingSynonymTargets.push(iri);
  check("동의어 사전이 가리키는 공종·유해요인이 모두 있는 노드다", missingSynonymTargets.length === 0, `대상 ${new Set(synonymTargets).size}개, 없는 것 ${missingSynonymTargets.join(", ") || 0}`);

  // 8-1. 단계 대체 이름(부재·장비 부품)으로 공종과 그 단계를 찾고, 근거는 원문에 있다
  const stepAliasCases: [string, string, string][] = [
    ["지브", "타워크레인", "지브·카운터웨이트 조립"],
    ["폼타이", "벽체 거푸집(유로폼)", "벽체 거푸집 조립"],
    ["복공", "흙막이 공통·부대", "복공설치"],
    ["유니트", "금속·잡철물", "커튼월 설치"],
  ];
  const stepAliasBad: string[] = [];
  for (const [q, work, step] of stepAliasCases) {
    const hit = await findWork(q);
    if (hit?.work.name !== work || hit.matchedStep !== step) stepAliasBad.push(`${q} → ${hit?.work.name ?? "없음"}/${hit?.matchedStep ?? "-"}`);
  }
  check("단계 대체 이름으로 공종과 그 단계를 찾는다", stepAliasBad.length === 0, stepAliasBad.join(" / "));
  const stepAliasNoEvidence: string[] = [];
  let stepAliasCount = 0;
  for (const node of await readDir("subtasks")) {
    const evidence = ((node._meta as { stepAltLabelEvidence?: { step: string; label: string; text: string }[] } | undefined)?.stepAltLabelEvidence ?? []);
    for (const st of (node.steps ?? []) as { "@id": string; altLabel?: string[] }[]) {
      for (const label of st.altLabel ?? []) {
        stepAliasCount += 1;
        const ev = evidence.find((e) => e.step === st["@id"] && e.label === label);
        if (!ev || !ev.text.replace(/\s+/g, "").includes(label.replace(/\s+/g, ""))) stepAliasNoEvidence.push(`${st["@id"]} ${label}`);
      }
    }
  }
  check("단계 대체 이름마다 그 말이 든 원문 근거 문장이 있다", stepAliasCount > 0 && stepAliasNoEvidence.length === 0, `대체 이름 ${stepAliasCount}개, 근거 없는 것 ${stepAliasNoEvidence.join(", ") || 0}`);
  // 현장 맥락 한 문장 — 공종·단계·작업 조건을 함께 읽어 그 단계의 대책과 그 작업에 해당하는 조건 조치를 붙인다
  const ctxText = (await fieldSafetyBriefingTool.handler({ workOrTopic: "내일 타워크레인 지브 조립하는데 강풍 예보가 있다" })).content[0]?.text ?? "";
  const ctxNeeds = ["👉 **지브·카운터웨이트 조립**", "## 🌦️ 작업 조건 — 강풍", "**[이 작업]** ② 사업주는 순간풍속이 초당 10미터를 초과하는 경우 타워크레인의 설치"];
  check("현장 브리핑이 문장의 단계와 작업 조건을 읽어 그 단계 대책과 이 작업의 조건 조치를 붙인다", ctxNeeds.every((n) => ctxText.includes(n)), ctxNeeds.filter((n) => !ctxText.includes(n)).join(" / ") || "단계·조건 모두");
  const hoist = await findWork("호이스트");
  check("KOSHA Guide 가 크레인으로 정의한 호이스트를 건설용 리프트로 잇지 않는다", hoist?.work.name !== "건설용 리프트", hoist?.work.name ?? "없음");
  // 공종 이름이 질문 낱말 사이에 나뉘어 있어도 그 공종 — 이름 일부만 맞는 다른 공종(콘크리트작업)으로 가지 않는다
  const pile = await getWorkSteps("현장타설 콘크리트 말뚝");
  check("\"현장타설 콘크리트 말뚝\" 은 현장타설말뚝이고 가운데 낱말로 단계를 좁히지 않는다", pile?.result.work === "현장타설말뚝" && pickFocusSteps("현장타설 콘크리트 말뚝", pile.result).length === 0, `${pile?.result.work ?? "없음"} [${pile ? pickFocusSteps("현장타설 콘크리트 말뚝", pile.result).join(",") : ""}]`);
  // 한 공종에만 있는 단계 이름은 그 공종·단계 — 여러 공종 단계에 들어 있는 말("자재반입")로는 공종을 정하지 않는다
  const portable = await getWorkSteps("이동식 전기기계기구");
  check("단계 이름 그대로(이동식 전기 기계기구)면 가설전기작업의 그 단계", portable?.result.work === "가설전기작업" && portable.result.matchedStep === "이동식 전기 기계기구", `${portable?.result.work ?? "없음"} / ${portable?.result.matchedStep ?? "-"}`);
  check("여러 공종 단계에 들어 있는 말(자재반입)만으로는 공종을 정하지 않는다", (await findWork("자재반입")) === null);
  // 공종 안에서는 해체·설치·조립이 단계를 가른다
  const formwork = await getWorkSteps("거푸집 해체");
  check("\"거푸집 해체\" 는 거푸집작업의 해체 단계를 짚는다", !!formwork && pickFocusSteps("거푸집 해체", formwork.result).join(",") === "거푸집 동바리 해체", formwork ? pickFocusSteps("거푸집 해체", formwork.result).join(",") : "없음");

  // 8-2. TBM 은 상위 작업이 이어지지 않은 공종도 공종 이름으로 만든다 (공종 노드가 출발점)
  const tbmMissing: string[] = [];
  for (const node of await readDir("subtasks")) {
    const title = String(node.title);
    const sc = (await generateTbmTopicsTool.handler({ activityLabel: title })).structuredContent as
      | { found?: boolean; topics?: { workSteps?: { work?: string } } }
      | undefined;
    if (!sc?.found || sc.topics?.workSteps?.work !== title) tbmMissing.push(title);
  }
  check("TBM 이 모든 공종 이름에서 그 공종의 단계로 만들어진다", tbmMissing.length === 0, tbmMissing.join(", "));

  // 8-3. 통제대책 추천은 위계가 적혀 있지 않은 대책도 묶어서 보인다 — 위계별 묶음의 합 = 전체 수
  const levelGaps: string[] = [];
  for (const node of await readDir("hazards")) {
    const sc = (await suggestControlsForHazardTool.handler({ hazard: String(node["@id"]) })).structuredContent as
      | { fieldMeasures?: { total: number; byLevel: Record<string, unknown[]> } }
      | undefined;
    const fm = sc?.fieldMeasures;
    if (!fm) continue;
    const sum = Object.values(fm.byLevel).reduce((a, l) => a + l.length, 0);
    if (sum !== fm.total) levelGaps.push(`${String(node["@id"])} ${sum}/${fm.total}`);
  }
  check("통제대책 추천의 위계별 묶음이 공종 대책을 빠짐없이 담는다", levelGaps.length === 0, levelGaps.join(", "));

  // 8-4. 대책 근거의 위치는 원문에서 풀린다 — 가이드 조항·부록은 본문 제목으로, 호를 든 조문은 그 호 본문으로.
  //      문장 대조로 정한 위치는 그 사실이 응답에 따라 나온다
  const unresolvedGuide: string[] = [];
  const guideNoPage: string[] = [];
  const guideLocations = new Map<string, { text: string; page?: number }>();
  const unresolvedItem: string[] = [];
  let locatedByText = 0;
  let locatedByTextShown = 0;
  for (const node of await readDir("subtasks")) {
    for (const st of (node.steps as Array<{ stepHazards: Array<{ risks: Array<{ measures: Array<{ basis?: Record<string, unknown> }> }> }> }>) ?? []) {
      for (const h of st.stepHazards) for (const r of h.risks) for (const m of r.measures) if (m.basis?.basisLocatedBy) locatedByText += 1;
    }
    const ws = await getWorkSteps(String(node.title));
    for (const s of ws?.result.steps ?? []) {
      for (const h of s.hazards) {
        for (const b of h.basis) {
          if (b.kind === "kosha_guide" && /^KOSHA Guide \S+ \S/.test(b.ref) && !b.text) unresolvedGuide.push(b.ref);
          if (b.kind === "kosha_guide" && /^KOSHA Guide \S+ \S/.test(b.ref) && !b.page) guideNoPage.push(b.ref);
          if (b.kind === "kosha_guide" && b.text) guideLocations.set(b.ref, { text: b.text, page: b.page });
          if (b.kind === "law" && /제\d+조.*제\d+호/.test(b.ref) && !b.text) unresolvedItem.push(b.ref);
        }
        for (const r of h.risks) for (const m of r.measures) if (m.basisLocatedBy) locatedByTextShown += 1;
      }
    }
  }
  check("가이드 근거의 조항·부록 번호가 모두 본문 제목으로 풀린다", unresolvedGuide.length === 0, unresolvedGuide.slice(0, 5).join(", "));
  check("가이드 근거의 조항·부록마다 원본 쪽 번호가 있다", guideNoPage.length === 0, guideNoPage.slice(0, 5).join(", "));
  // 원본(.dclx) 요소로 찾은 위치 — 목차 줄·본문에 인용된 법령 항목을 조항 제목으로 잡지 않는다 (원본 PDF 쪽 대조)
  const wrongLocations: string[] = [];
  for (const [ref, want] of Object.entries(KNOWN_GUIDE_LOCATIONS)) {
    const got = guideLocations.get(ref);
    if (!got || got.text !== want.text || got.page !== want.page) wrongLocations.push(`${ref} → ${got ? `${got.text} (${got.page}쪽)` : "없음"}`);
  }
  check("가이드 근거 위치가 원본 제목·쪽과 같다 (목차 줄·인용 법령 항목 아님)", wrongLocations.length === 0, wrongLocations.join(", "));
  check("호를 든 조문 근거가 모두 그 호 본문으로 풀린다", unresolvedItem.length === 0, unresolvedItem.slice(0, 5).join(", "));
  check("문장 대조로 정한 근거 위치는 응답에 그 표시가 붙는다", locatedByText > 0 && locatedByTextShown === locatedByText, `노드 ${locatedByText}건, 응답 ${locatedByTextShown}건`);

  // 8-4b. 항을 적지 않은 조문 근거 가운데, 대책 문장이 그 조문의 한 항에만 그대로 있는 것은 없어야 한다 (항 누락 회귀)
  const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";
  const squashLaw = (s: string): string => s.replace(/\s+/g, "").replace(/\([^)]*[\u4e00-\u9fff][^)]*\)/g, "").replace(/\.$/, "");
  const missingParagraph: string[] = [];
  for (const n of subtasks) {
    for (const st of (n as { steps?: { stepHazards?: { risks?: { measures?: { measure: string; basis?: { basisArticle?: string; paragraph?: number } }[] }[] }[] }[] }).steps ?? []) {
      for (const h of st.stepHazards ?? []) {
        for (const r of h.risks ?? []) {
          for (const m of r.measures ?? []) {
            const art = m.basis?.basisArticle;
            if (!art || m.basis?.paragraph !== undefined) continue;
            const body = String(((await getNode(art)) as { description?: string } | undefined)?.description ?? "");
            const marks = [...CIRCLED].map((c) => body.indexOf(c)).filter((i) => i >= 0).sort((x, y) => x - y);
            if (marks.length < 2) continue;
            const paras = marks.map((s, k) => squashLaw(body.slice(s, marks[k + 1] ?? body.length)));
            const t = squashLaw(m.measure);
            if (t.length >= 10 && paras.filter((p) => p.includes(t)).length === 1) missingParagraph.push(`${n.title}:${art}`);
          }
        }
      }
    }
  }
  check("항을 적지 않은 조문 근거 중 대책 문장이 한 항에 그대로 있는 것이 없다", missingParagraph.length === 0, missingParagraph.slice(0, 5).join(", "));

  // 8-5. 공종의 대체 이름은 가이드 원문 근거가 있고, 그 이름으로 그 공종을 찾는다
  const altNoEvidence: string[] = [];
  const altMisrouted: string[] = [];
  let altCount = 0;
  for (const n of subtasks) {
    const alts = (n as { altLabel?: string[] }).altLabel ?? [];
    const evidence = ((n._meta as { altLabelEvidence?: { label: string; guide: string; text: string }[] } | undefined)?.altLabelEvidence ?? []);
    for (const alt of alts) {
      altCount += 1;
      const ev = evidence.find((e) => e.label === alt);
      const body = ev ? await guideBody(ev.guide) : "";
      const flat = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      if (!ev || !flat.includes(ev.text.slice(0, 30))) altNoEvidence.push(`${n.title}:${alt}`);
      const hit = await findWork(alt);
      if (hit?.work.name !== n.title) altMisrouted.push(`${alt} → ${hit?.work.name ?? "없음"} (${n.title})`);
    }
  }
  check("공종 대체 이름마다 가이드 원문 근거 줄이 있다", altCount > 0 && altNoEvidence.length === 0, `대체 이름 ${altCount}개, 근거 없음 ${altNoEvidence.join(", ") || 0}`);
  check("공종 대체 이름으로 그 공종을 찾는다", altMisrouted.length === 0, altMisrouted.slice(0, 5).join(", "));

  // 8-6. 작업 조건의 조치 문장은 원문 그대로이고, 기준값은 그 문장 안에 있으며, 지금 작업에 해당하는 조치가 앞에 온다
  const conditionNodes = (await listNodesByType("WorkCondition")) as unknown as {
    "@id": string;
    title: string;
    conditionRules?: { requirement: string; basisArticle?: string; basisGuide?: string; threshold?: string }[];
  }[];
  const ruleNotInSource: string[] = [];
  const thresholdOutside: string[] = [];
  let ruleCount = 0;
  const squash = (s: string): string => s.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  for (const c of conditionNodes) {
    for (const r of c.conditionRules ?? []) {
      ruleCount += 1;
      let source = "";
      if (r.basisArticle) source = String(((await getNode(r.basisArticle)) as { description?: string } | undefined)?.description ?? "");
      else if (r.basisGuide) source = await guideBody(r.basisGuide.split("/").pop() ?? "");
      const body = squash(source);
      // 머리 문장과 호를 " … " 로 이은 조치는 조각마다 원문에 있어야 한다
      const parts = r.requirement.split(" … ").map(squash);
      if (!source || parts.some((p) => !body.includes(p.replace(/^\*+|\*+$/g, "")))) ruleNotInSource.push(`${c.title}:${r.basisArticle ?? r.basisGuide}`);
      // 기준값이 둘 이상이면(" · " 로 이음 — 설치·해체 10미터, 운전 15미터) 구절마다 조치 문장 안에 있어야 한다
      if (r.threshold && r.threshold.split(" · ").some((t) => !r.requirement.includes(t))) thresholdOutside.push(`${c.title}:${r.threshold}`);
    }
  }
  check("작업 조건 조치 문장이 모두 법령·가이드 원문에 그대로 있다", ruleCount > 0 && ruleNotInSource.length === 0, `조건 ${conditionNodes.length}개·조치 ${ruleCount}건, 원문에 없는 것 ${ruleNotInSource.slice(0, 5).join(", ") || 0}`);
  check("작업 조건 기준값이 그 조치 문장 안에 있다", thresholdOutside.length === 0, thresholdOutside.join(", "));
  const windOnCrane = await resolveWorkConditions(["강풍"], { iri: "subtask:타워크레인", activity: "activity:tower_crane" });
  const firstWindRule = windOnCrane.conditions[0]?.rules[0];
  check(
    "타워크레인 작업의 강풍 조건은 타워크레인 풍속 기준 조문이 맨 앞에 온다",
    firstWindRule?.basisIri === "art:기준규칙:37" && firstWindRule.scope === RULE_SCOPE.thisWork && (firstWindRule.threshold ?? "").includes("10미터"),
    `${firstWindRule?.basis ?? "없음"} · ${firstWindRule?.scope ?? ""}`,
  );
  const fog = await resolveWorkConditions(["안개", "없는조건"]);
  check("원문 근거가 없는 조건은 이유와 함께, 모르는 조건은 따로 돌려준다", fog.notCovered.length === 1 && fog.unmatched.includes("없는조건"), JSON.stringify({ notCovered: fog.notCovered.length, unmatched: fog.unmatched }));
  const fieldConditionNames = ["도로·통행 인접", "경사지", "암반·발파구간", "옥외 작업", "취약 상부재 위 작업", "양중·인양 장비", "굴착·운반 중장비", "작업발판형 기구", "화기·고열 장비", "회전·절삭 공구", "타격·천공 장비", "압송·타설 장비", "인화·위험물", "가연성 자재", "인접 장비 작업"];
  const fieldConditions = await resolveWorkConditions(fieldConditionNames);
  check("현장에서 쓰는 장비·자재·장소 조건 이름을 조건 노드에 맞춘다", fieldConditions.unmatched.length === 0 && fieldConditions.conditions.every((c) => c.rules.length > 0), fieldConditions.unmatched.join(", "));
  const riskWithWeather = (await analyzeConstructionWorkRisksTool.handler({ workType: "철골작업", conditions: { weather: "강풍 및 우천" } })) as {
    structuredContent?: { workConditions?: { conditions: { title: string }[] } };
  };
  const weatherTitles = riskWithWeather.structuredContent?.workConditions?.conditions.map((c) => c.title) ?? [];
  check("작업 위험 분석이 날씨 입력에서 작업 조건 조치를 붙인다", weatherTitles.includes("강풍") && weatherTitles.includes("강우"), weatherTitles.join(", "));

  // 9. 유해요인 → 조문: 공종 자료에서 끌어낸 연결이 있고, 끌어낸 것임이 적혀 있다
  const hazardNodes = await readDir("hazards");
  const derivedBad: string[] = [];
  let derivedCount = 0;
  for (const h of hazardNodes) {
    const meta = (h._meta ?? {}) as { derivedRegulatedBy?: string[]; linkBasis?: Record<string, string> };
    for (const a of meta.derivedRegulatedBy ?? []) {
      derivedCount += 1;
      if (!((h.regulatedBy ?? []) as string[]).includes(a) || meta.linkBasis?.derivedRegulatedBy !== "derived" || !(await getNode(a))) derivedBad.push(`${String(h["@id"])}→${a}`);
    }
  }
  check("유해요인의 끌어낸 조문 연결이 표기와 함께 있다", derivedCount > 0 && derivedBad.length === 0, `끌어낸 연결 ${derivedCount}개, 어긋남 ${derivedBad.length}`);

  // 10. 현장 말 문장 검색: 조문 낱말이 없는 문장으로도 조문을 찾고, 고시·지침은 의무 조문 구획에 섞이지 않는다
  const phrases = (JSON.parse(await readFile(resolve(GRAPH, "..", "field-phrases.json"), "utf-8")) as { phrases: Record<string, string[]> }).phrases;
  const missingPhraseTargets: string[] = [];
  for (const iri of Object.keys(phrases)) if (!(await getNode(iri))) missingPhraseTargets.push(iri);
  check("현장 말 문장이 가리키는 조문이 모두 있는 노드다", Object.keys(phrases).length > 0 && missingPhraseTargets.length === 0, `조문 ${Object.keys(phrases).length}개, 없는 것 ${missingPhraseTargets.join(", ") || 0}`);
  const allNodes = await readDir("articles");
  const thrown = await searchArticles(allNodes, FIELD_QUERY, SEARCH_TOP);
  const thrownRank = thrown.findIndex((h) => h.iri === FIELD_QUERY_ARTICLE) + 1;
  check("조문 낱말이 없는 현장 문장으로 조문을 찾는다", thrownRank > 0, `"${FIELD_QUERY}" → ${FIELD_QUERY_ARTICLE} ${thrownRank || "없음"}위 (앞 ${SEARCH_TOP}개 안)`);
  const notificationHits: string[] = [];
  for (const h of await searchArticles(allNodes, NOTIFICATION_QUERY, SEARCH_WIDE)) {
    const node = await getNode(h.iri);
    if ((node as { legislationType?: string } | undefined)?.legislationType === "Notification") notificationHits.push(h.iri);
  }
  check("문장 검색 결과에 고시·지침 조문이 없다", notificationHits.length === 0, notificationHits.slice(0, 3).join(", "));
  const obligationText = (await fieldSafetyBriefingTool.handler({ workOrTopic: NOTIFICATION_QUERY })).content[0]?.text ?? "";
  // 조문 구획 — 이름으로 찾은 것이 있으면 "법령 근거", 없으면 "문장이 비슷한 조문"
  const sectionOf = (text: string): string => {
    const head = ["## 📖 법령 근거", "## 🔎 문장이 비슷한 조문"].find((h) => text.includes(h));
    return head ? text.slice(text.indexOf(head)).split("\n## ")[0] : "";
  };
  const obligationSection = sectionOf(obligationText);
  const leaked: string[] = [];
  for (const iri of new Set(obligationSection.match(/art:[^\s:`*]+:[0-9의]+/g) ?? [])) {
    const node = await getNode(iri);
    if ((node as { legislationType?: string } | undefined)?.legislationType === "Notification") leaked.push(iri);
  }
  // 문장 검색이 아닌 길(낱말 겹침·그래프)로 지침이 들어오던 질문도 함께 본다
  const otherSection = sectionOf((await fieldSafetyBriefingTool.handler({ workOrTopic: NOTIFICATION_QUERY_BY_NAME })).content[0]?.text ?? "");
  for (const iri of new Set(otherSection.match(/art:[^\s:`*]+:[0-9의]+/g) ?? [])) {
    const node = await getNode(iri);
    if ((node as { legislationType?: string } | undefined)?.legislationType === "Notification") leaked.push(iri);
  }
  check("현장 브리핑의 의무 조문 구획에 고시·지침이 없다", obligationSection.length > 0 && otherSection.length > 0 && leaked.length === 0, `구획 ${obligationSection.length}자·${otherSection.length}자, 섞인 것 ${leaked.join(", ") || 0}`);

  // 작업·문서·공종·용어 사전 어디에도 안 걸린 질문은 "의무 조문"이라 하지 않고 비슷한 조문으로만 보여 준다 (벌칙도 붙이지 않는다)
  const offTopic: string[] = [];
  for (const q of ["점심 메뉴를 추천해 달라", "회의실 예약을 도와 달라", "오늘 날씨가 좋아서 기분이 좋다"]) {
    const text = (await fieldSafetyBriefingTool.handler({ workOrTopic: q })).content[0]?.text ?? "";
    if (text.includes("## 📖 법령 근거") || text.includes("## ⚖️") || !text.includes("관련 여부 확인 필요")) offTopic.push(q);
  }
  check("공사와 무관한 말에는 의무 조문·벌칙을 내지 않는다", offTopic.length === 0, offTopic.join(" / "));

  // 이름으로 찾은 것이 있는 답에서, 문장 검색으로만 들어온 조문은 요약 줄이든 제목 줄이든 표시 없이 나오지 않는다
  const mixedText = (await fieldSafetyBriefingTool.handler({ workOrTopic: MIXED_QUERY })).content[0]?.text ?? "";
  const mixedSection = sectionOf(mixedText);
  // 문장 검색으로만 들어오는 조문(MSDS 와 무관한 타워크레인 등록 조문)이 표시 없는 줄에 나오면 실패
  const plainLines = mixedSection.split("\n").filter((line) => !line.includes("비슷한 문장") && !line.startsWith("- 글이 비슷해서 찾은 조문"));
  const markedLines = mixedSection.split("\n").filter((line) => line.includes("비슷한 문장") || line.startsWith("- 글이 비슷해서 찾은 조문"));
  const inPlain = plainLines.some((line) => line.includes(MIXED_SEARCH_ONLY_ARTICLE));
  const inMarked = markedLines.some((line) => line.includes(MIXED_SEARCH_ONLY_ARTICLE));
  check("글이 비슷해서 찾은 조문은 제목만 나오는 줄에서도 표시와 함께 나온다", inMarked && !inPlain, `${MIXED_SEARCH_ONLY_ARTICLE} — 표시된 줄 ${inMarked ? "있음" : "없음"}, 표시 없는 줄 ${inPlain ? "있음" : "없음"}`);

  const subtaskCount = (await listNodesByType("ConstructionSubtask")).length;
  console.log(`\n공종 ${subtaskCount} · 단계 ${stepIds.length} · 위험요인 ${riskIds.length} · 대책 노드 ${measureBody.size} · 고시 장·절 ${chapters.length}`);
  if (failed > 0) {
    console.error(`\n❌ ${failed}개 실패`);
    process.exit(1);
  }
  console.log("\n✅ 전체 통과");
}

void main();
