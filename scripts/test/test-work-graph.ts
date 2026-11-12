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
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";
import { getNode, neighborsByEdge, listNodesByType } from "../../src/lib/graph-nodes-loader.js";
import { findMeasuresCiting, findFieldMeasuresForHazard } from "../../src/lib/field-measures.js";
import { findWork, getWorkSteps, LINK_BASIS_LABEL } from "../../src/lib/work-steps.js";

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
const SAMPLE_HAZARD = "hazard:fall_from_height";
/** 정한 방식을 적어야 하는 연결 — 공종 노드 / 고시 장·절 노드 */
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

  // 8. 공종 이름이 없는 질문은 자료 안의 낱말로 찾고, 무관한 말은 찾지 않는다
  const byContent = await findWork("항타기로 파일을 박는데 지반이 무르다");
  check("공종 이름이 없는 질문을 자료의 낱말로 찾는다", byContent?.work.name === "기초파일작업" && (byContent.matchedBy?.length ?? 0) >= 2, `${byContent?.work.name ?? "없음"} ← ${byContent?.matchedBy?.join(", ") ?? ""}`);
  const repeated = await findWork("항타기 항타기로");
  check("같은 낱말을 되풀이해도 두 낱말로 세지 않는다", repeated === null, repeated ? `${repeated.work.name} ← ${repeated.matchedBy?.join(", ")}` : "");
  const unrelated: string[] = [];
  for (const q of ["점심 메뉴를 추천해 달라", "오늘 날씨가 좋아서 기분이 좋다", "회의실 예약을 도와 달라"]) {
    const hit = await findWork(q);
    if (hit) unrelated.push(`${q} → ${hit.work.name}`);
  }
  check("공사와 무관한 말은 공종에 맞추지 않는다", unrelated.length === 0, unrelated.join(" / "));

  const subtaskCount = (await listNodesByType("ConstructionSubtask")).length;
  console.log(`\n공종 ${subtaskCount} · 단계 ${stepIds.length} · 위험요인 ${riskIds.length} · 대책 노드 ${measureBody.size} · 고시 장·절 ${chapters.length}`);
  if (failed > 0) {
    console.error(`\n❌ ${failed}개 실패`);
    process.exit(1);
  }
  console.log("\n✅ 전체 통과");
}

void main();
