#!/usr/bin/env tsx
/**
 * sync-admin-rules.ts — 행정규칙(고시·지침) 본문을 법제처에서 받아 그래프 노드로 만든다
 *
 * 법제처 lawService.do?target=admrul 응답(XML)에서 조문과 발령 정보를 읽어
 *   - 조문 노드  src/ontology/graph/nodes/articles/{actKey}-§{조}.jsonld
 *   - 법령 노드  src/ontology/graph/nodes/acts/{파일명}.jsonld (hasArticle 포함)
 *   - 장·절 노드 src/ontology/graph/nodes/chapters/{actKey}-{N}장[{M}절].jsonld (hasArticle 포함)
 * 를 쓴다. 이름·발령번호·발령일·시행일은 응답에 적힌 값을 그대로 쓴다(손으로 적지 않는다).
 *
 * 사용
 *   LAW_OC=... tsx scripts/sync/sync-admin-rules.ts            # 법제처에서 받아 갱신
 *   tsx scripts/sync/sync-admin-rules.ts --from <XML 폴더>     # 받아 둔 {일련번호}.xml 로 갱신
 */
import { readFile, writeFile, access, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const ACTS = resolve(NODES, "acts");
const CHAPTERS = resolve(NODES, "chapters");
const SUBTASKS = resolve(NODES, "subtasks");
const ACTIVITIES = resolve(NODES, "activities");
const LAW_SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";
const LICENSE_HINT = "저작권법 제7조 비보호 (자유 인용)";
/** 법령 위임 단계 — 고시·지침은 법·시행령·시행규칙·규칙 아래 */
const NOTICE_DELEGATION_LEVEL = 5;

interface AdminRule {
  /** 조문 IRI·파일명에 쓰는 짧은 이름 (art:{actKey}:{조}) */
  actKey: string;
  /** 법제처 행정규칙일련번호 */
  id: string;
  /** 법령 노드 IRI 와 파일명 (act:{actSlug}) */
  actSlug: string;
  /** 문서에서 부르는 다른 이름 */
  alternativeNames: string[];
}

/** 수록 대상 — 건설현장 작업에 직접 적용되는 고용노동부 고시 */
const ADMRULS: AdminRule[] = [
  { actKey: "위험성평가-고시", id: "2100000251014", actSlug: "사업장위험성평가에관한지침", alternativeNames: ["위험성평가 고시"] },
  { actKey: "가설공사-지침", id: "2100000186031", actSlug: "가설공사표준안전작업지침", alternativeNames: ["가설공사 표준안전 작업지침"] },
  { actKey: "굴착공사-지침", id: "2100000226002", actSlug: "굴착공사표준안전작업지침", alternativeNames: ["굴착공사 표준안전 작업지침"] },
  { actKey: "발파-지침", id: "2100000226042", actSlug: "발파표준안전작업지침", alternativeNames: ["발파 표준안전 작업지침"] },
  { actKey: "철골공사-지침", id: "2100000186037", actSlug: "철골공사표준안전작업지침", alternativeNames: ["철골공사 표준안전 작업지침"] },
  { actKey: "추락재해방지-지침", id: "2100000186039", actSlug: "추락재해방지표준안전작업지침", alternativeNames: ["추락재해방지 표준안전 작업지침"] },
  { actKey: "콘크리트공사-지침", id: "2100000268994", actSlug: "콘크리트공사표준안전작업지침", alternativeNames: ["콘크리트공사 표준안전 작업지침"] },
  { actKey: "터널공사NATM-지침", id: "2100000226004", actSlug: "터널공사표준안전작업지침NATM공법", alternativeNames: ["터널공사 표준안전 작업지침", "터널공사 표준안전 작업지침-NATM공법"] },
  { actKey: "해체공사-지침", id: "2100000186047", actSlug: "해체공사표준안전작업지침", alternativeNames: ["해체공사 표준안전 작업지침"] },
  { actKey: "운반하역-지침", id: "2100000186124", actSlug: "운반하역표준안전작업지침", alternativeNames: ["운반하역 표준안전 작업지침"] },
  { actKey: "산안비-기준", id: "2100000254546", actSlug: "건설업산업안전보건관리비계상및사용기준", alternativeNames: ["산업안전보건관리비 계상 및 사용기준", "산안비 계상기준"] },
  { actKey: "안전보건대장-고시", id: "2100000243390", actSlug: "건설공사안전보건대장의작성등에관한고시", alternativeNames: ["건설공사 안전보건대장 고시"] },
];

/**
 * 장·절이 다루는 공종(공종 노드 제목)과 작업(작업 노드 이름).
 * 키는 "{actKey}:{장}" 또는 "{actKey}:{장}-{절}". 장·절 제목과 그 안의 조문 내용을 읽고 정한 것으로,
 * 법령이 정한 적용 범위가 아니다 (노드 _meta.scopeNote 에도 적는다). 총칙·보칙처럼 특정 공종을 가리키지 않는 장은 두지 않는다.
 */
const FORMWORKS = ["거푸집작업", "갱폼작업", "벽체 거푸집(유로폼)", "슬립폼작업", "시스템폼작업"];
const CHAPTER_SCOPE: Record<string, { works?: string[]; activities?: string[] }> = {
  "가설공사-지침:2-1": { works: ["강관비계", "강관틀비계", "작업발판"], activities: ["scaffolding_assembly"] },
  "가설공사-지침:2-2": { works: ["강관비계", "강관틀비계", "달비계", "달대비계", "말비계", "이동식비계"], activities: ["scaffolding_assembly"] },
  "가설공사-지침:3": { works: ["가설 경사로", "가설통로 또는 가설계단", "이동식 사다리"] },
  "가설공사-지침:4": { works: ["가설도로작업"] },
  "철골공사-지침:2": { works: ["철골작업"], activities: ["steel_erection", "steel_structure"] },
  "철골공사-지침:3": { works: ["철골작업"], activities: ["steel_erection", "steel_structure"] },
  "철골공사-지침:4-1": { works: ["철골작업"], activities: ["steel_erection", "steel_structure"] },
  "철골공사-지침:4-2": { works: ["철골작업"], activities: ["steel_erection", "steel_structure"] },
  "철골공사-지침:4-3": { works: ["철골작업"], activities: ["steel_erection", "steel_structure"] },
  "철골공사-지침:5": { works: ["철골작업", "추락방지망", "방호선반"], activities: ["steel_erection", "steel_structure"] },
  "추락재해방지-지침:2-1": { works: ["추락방지망"] },
  "추락재해방지-지침:2-2": { works: ["추락방지망"] },
  "추락재해방지-지침:2-3": { works: ["추락방지망"] },
  "추락재해방지-지침:3-5": { works: ["강관틀비계"] },
  "해체공사-지침:2": { works: ["구조물 해체작업"], activities: ["demolition"] },
  "해체공사-지침:3": { works: ["구조물 해체작업"], activities: ["demolition"] },
  "해체공사-지침:4": { works: ["구조물 해체작업", "전도·강구 해체작업", "발파 해체작업"], activities: ["demolition"] },
  "해체공사-지침:5": { works: ["구조물 해체작업"], activities: ["demolition"] },
  "운반하역-지침:2": { activities: ["heavy_lifting"] },
  "운반하역-지침:3-1": { activities: ["lifting_operation"] },
  "운반하역-지침:3-2": { activities: ["lifting_operation"] },
  "운반하역-지침:3-3": { activities: ["lifting_operation"] },
  "운반하역-지침:3-4": { activities: ["lifting_operation"] },
  "운반하역-지침:3-5": { activities: ["lifting_operation"] },
  "운반하역-지침:4-1": { activities: ["vehicle_cargo"] },
  "운반하역-지침:4-2": { activities: ["vehicle_cargo"] },
  "운반하역-지침:4-3": { activities: ["vehicle_cargo"] },
  "굴착공사-지침:2": { works: ["굴착작업"], activities: ["excavation_2m_plus"] },
  "굴착공사-지침:3-1": { works: ["굴착작업"], activities: ["excavation_2m_plus"] },
  "굴착공사-지침:3-2": { works: ["굴착작업"], activities: ["excavation_2m_plus"] },
  "굴착공사-지침:3-3": { works: ["굴착작업", "발파작업"], activities: ["excavation_2m_plus", "blasting"] },
  "굴착공사-지침:3-4": { works: ["굴착작업"], activities: ["excavation_2m_plus"] },
  "굴착공사-지침:3-5": { works: ["굴착작업", "흙막이 공통·부대"], activities: ["excavation_2m_plus"] },
  "굴착공사-지침:4-1": { works: ["지장물조사 및 이설작업", "굴착작업"], activities: ["underground_utility"] },
  "굴착공사-지침:4-2": { works: ["굴착작업"], activities: ["excavation_2m_plus"] },
  "굴착공사-지침:5-1": { works: ["굴착작업"], activities: ["excavation_2m_plus"] },
  "굴착공사-지침:5-2": { works: ["굴착작업"], activities: ["excavation_2m_plus"] },
  "터널공사NATM-지침:2": { works: ["터널굴착작업"], activities: ["tunnel_excavation"] },
  "터널공사NATM-지침:3": { works: ["터널굴착작업"], activities: ["tunnel_excavation"] },
  "터널공사NATM-지침:4": { works: ["터널보강작업"], activities: ["tunnel_excavation"] },
  "터널공사NATM-지침:5": { works: ["터널보강작업"], activities: ["tunnel_excavation"] },
  "터널공사NATM-지침:6": { works: ["터널보강작업"], activities: ["tunnel_excavation"] },
  "터널공사NATM-지침:7": { works: ["라이닝거푸집작업"], activities: ["tunnel_excavation"] },
  "터널공사NATM-지침:8": { activities: ["tunnel_excavation"] },
  "터널공사NATM-지침:9": { works: ["터널배수작업", "터널방수작업"], activities: ["tunnel_excavation"] },
  "터널공사NATM-지침:10": { activities: ["tunnel_excavation"] },
  "발파-지침:2-1": { works: ["발파작업"], activities: ["blasting"] },
  "발파-지침:2-2": { works: ["발파작업"], activities: ["blasting"] },
  "발파-지침:2-3": { works: ["발파작업"], activities: ["blasting"] },
  "발파-지침:3": { works: ["발파작업"], activities: ["blasting"] },
  "발파-지침:4-1": { works: ["발파작업"], activities: ["blasting"] },
  "발파-지침:4-2": { works: ["발파작업"], activities: ["blasting"] },
  "발파-지침:4-3": { works: ["발파작업"], activities: ["blasting"] },
  "발파-지침:5": { works: ["발파작업"], activities: ["blasting"] },
  "콘크리트공사-지침:2-1": { works: FORMWORKS, activities: ["formwork_shoring"] },
  "콘크리트공사-지침:2-2": { works: [...FORMWORKS, "조립강주작업"], activities: ["formwork_shoring"] },
  "콘크리트공사-지침:3": { works: ["철근작업"], activities: ["rc_concrete"] },
  "콘크리트공사-지침:4": { works: ["콘크리트작업"], activities: ["concrete_work", "rc_concrete"] },
  "콘크리트공사-지침:5": { works: FORMWORKS, activities: ["formwork_shoring"] },
  "위험성평가-고시:2": { activities: ["risk_assessment_general"] },
};
const SCOPE_NOTE = "적용 공종·작업 연결은 장·절 제목과 조문 내용을 읽고 정한 것 — 법령이 정한 적용 범위가 아니다";

interface ChapterDraft {
  /** "2" 또는 "2-1" */
  number: string;
  title: string;
  parent?: string;
  articles: string[];
}

/** "총    칙"·"비 계 작 업" 처럼 글자 사이를 띄운 제목은 붙이고, 그 밖에는 겹친 공백만 줄인다 */
function headingTitle(raw: string): string {
  const tokens = raw.split("\n")[0].trim().split(/\s+/);
  return tokens.every((t) => t.length === 1) ? tokens.join("") : tokens.join(" ");
}

/** 공종 제목 → 공종 노드 IRI */
async function loadSubtaskIris(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!(await exists(SUBTASKS))) return out;
  for (const f of await readdir(SUBTASKS)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(SUBTASKS, f), "utf-8")) as { "@id": string; title: string };
    out.set(node.title, node["@id"]);
  }
  return out;
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? m[1].trim() : "";
}

/** 20200116 → 2020-01-16 */
function isoDate(yyyymmdd: string): string {
  return /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : "";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadXml(rule: AdminRule, fromDir: string | undefined, oc: string): Promise<string> {
  if (fromDir) return readFile(resolve(fromDir, `${rule.id}.xml`), "utf-8");
  const url = `${LAW_SERVICE_URL}?OC=${oc}&target=admrul&ID=${rule.id}&type=XML`;
  return fetch(url).then((r) => r.text());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf("--from");
  const fromDir = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
  const oc = process.env.LAW_OC ?? "";
  if (!fromDir && !oc) {
    console.error("LAW_OC 환경 변수(법제처 OpenAPI 인증값) 또는 --from <XML 폴더> 가 필요합니다.");
    process.exit(2);
  }
  const today = new Date().toISOString().substring(0, 10);
  const subtaskIris = await loadSubtaskIris();
  const usedScopeKeys = new Set<string>();

  for (const rule of ADMRULS) {
    const xml = await loadXml(rule, fromDir, oc);
    const name = tag(xml, "행정규칙명");
    const date = isoDate(tag(xml, "발령일자"));
    const effective = isoDate(tag(xml, "시행일자")) || date;
    const no = tag(xml, "발령번호");
    if (!name || !date) {
      console.error(`[${rule.actKey}] 응답에서 이름·발령일을 읽지 못했습니다 — 건너뜀`);
      process.exitCode = 1;
      continue;
    }
    const actIri = `act:${rule.actSlug}`;
    const sourceUrl = `https://www.law.go.kr/행정규칙/${encodeURIComponent(name)}`;

    // 조문 — 행정규칙은 <조문내용> 에 "제N조(제목) 본문" 이 통째로 들어 있다 (장 제목은 건너뜀)
    const contents = [...xml.matchAll(/<조문내용><!\[CDATA\[([\s\S]*?)\]\]>\s*<\/조문내용>/g)];
    const articleIris: string[] = [];
    const chapters: ChapterDraft[] = [];
    let chapter: ChapterDraft | undefined;
    let section: ChapterDraft | undefined;
    let added = 0;
    let updated = 0;
    for (const cm of contents) {
      const text = cm[1].trim();
      // "제5조(제목)" 과 "제5조의2(제목)" 을 구분한다 — 가지 조문을 본조 번호로 읽으면 본조 본문을 덮어쓴다
      const titleMatch = text.match(/^제(\d+)조(?:의(\d+))?\(([^)]+)\)/);
      if (!titleMatch) {
        // 장·절 제목 — 뒤따르는 조문이 여기에 속한다
        const head = text.match(/^제(\d+)(장|절)\s*(.+)/);
        if (head && head[2] === "장") {
          chapter = { number: head[1], title: headingTitle(head[3]), articles: [] };
          section = undefined;
          chapters.push(chapter);
        } else if (head && chapter) {
          section = { number: `${chapter.number}-${head[1]}`, title: headingTitle(head[3]), parent: chapter.number, articles: [] };
          chapters.push(section);
        }
        continue;
      }
      const num = titleMatch[2] ? `${titleMatch[1]}의${titleMatch[2]}` : titleMatch[1];
      const iri = `art:${rule.actKey}:${num}`;
      chapter?.articles.push(iri);
      section?.articles.push(iri);
      const path = resolve(ARTICLES, `${rule.actKey}-§${num}.jsonld`);
      const node = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": ["Article", "Legislation"],
        articleNumber: num,
        title: titleMatch[3],
        partOf: actIri,
        verificationStatus: "verified",
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          sourceUrl,
          fetchedAt: today,
          verifiedAt: today,
          verifiedBy: "법제처 lawService.do?target=admrul (자동 sync)",
          admRulId: rule.id,
          admRulNo: no,
          licenseHint: LICENSE_HINT,
        },
        description: text,
        legislationIdentifier: name,
        legislationDate: date,
        legislationType: "Notification",
        legislationLegalForce: "InForce",
        jurisdiction: "KR",
        temporalCoverage: `${effective}/..`,
      };
      // 이미 있는 노드는 덮어쓰지 않고 합친다 — 사람이 보강한 연결(regulates·legalBasisOf 등)을 보존
      let merged: Record<string, unknown> = node;
      if (await exists(path)) {
        const current = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
        // 본문·제목이 그대로면 파일을 건드리지 않는다 (확인 날짜만 바뀌는 변경을 만들지 않음)
        if (current.description === node.description && current.title === node.title) {
          articleIris.push(iri);
          continue;
        }
        const currentMeta = (current._meta && typeof current._meta === "object" ? current._meta : {}) as Record<string, unknown>;
        merged = { ...current, ...node, _meta: { ...currentMeta, ...node._meta, fetchedAt: currentMeta.fetchedAt ?? today } };
        updated += 1;
      } else {
        added += 1;
      }
      await writeFile(path, JSON.stringify(merged, null, 2) + "\n", "utf-8");
      articleIris.push(iri);
    }

    // 장·절 노드 — 조문이 속한 장·절과, 그 장·절이 다루는 공종·작업
    const chapterIri = (n: string): string => `chapter:${rule.actKey}:${n.replace("-", "장")}${n.includes("-") ? "절" : "장"}`;
    let chapterWritten = 0;
    for (const ch of chapters) {
      const key = `${rule.actKey}:${ch.number}`;
      const scope = CHAPTER_SCOPE[key];
      if (scope) usedScopeKeys.add(key);
      const works = (scope?.works ?? []).map((title) => {
        const iri = subtaskIris.get(title);
        if (!iri) throw new Error(`[${key}] 공종 노드가 없습니다: ${title}`);
        return iri;
      });
      const activities: string[] = [];
      for (const slug of scope?.activities ?? []) {
        if (!(await exists(resolve(ACTIVITIES, `${slug}.jsonld`)))) throw new Error(`[${key}] 작업 노드가 없습니다: ${slug}`);
        activities.push(`activity:${slug}`);
      }
      // 장에 딸린 절
      const sections = chapters.filter((c) => c.parent === ch.number).map((c) => chapterIri(c.number));
      const [chapterNo, sectionNo] = ch.number.split("-");
      const label = `제${chapterNo}장${sectionNo ? ` 제${sectionNo}절` : ""}`;
      const file = resolve(CHAPTERS, `${rule.actKey}-${chapterNo}장${sectionNo ? `${sectionNo}절` : ""}.jsonld`);
      const previous = (await exists(file)) ? (JSON.parse(await readFile(file, "utf-8")) as { _meta?: { fetchedAt?: string } }) : undefined;
      const node = {
        "@context": "../../context.jsonld",
        "@id": chapterIri(ch.number),
        "@type": ["Chapter", "Legislation"],
        chapterNumber: ch.number,
        title: ch.title,
        partOf: ch.parent ? chapterIri(ch.parent) : actIri,
        verificationStatus: "verified",
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          sourceUrl,
          fetchedAt: previous?._meta?.fetchedAt ?? today,
          admRulId: rule.id,
          licenseHint: LICENSE_HINT,
          ...(scope ? { scopeNote: SCOPE_NOTE } : {}),
          linkBasis: {
            partOf: "source",
            hasArticle: "source",
            ...(scope?.works?.length ? { appliesTo: "editorial" } : {}),
            ...(scope?.activities?.length ? { appliesToActivity: "editorial" } : {}),
          },
        },
        description: `${name} ${label} ${ch.title}`,
        legislationIdentifier: name,
        jurisdiction: "KR",
        hasArticle: ch.articles,
        ...(sections.length ? { hasChapter: sections } : {}),
        ...(works.length ? { appliesTo: works } : {}),
        ...(activities.length ? { appliesToActivity: activities } : {}),
      };
      const body = JSON.stringify(node, null, 2) + "\n";
      if (!previous || (await readFile(file, "utf-8")) !== body) {
        await writeFile(file, body, "utf-8");
        chapterWritten += 1;
      }
    }
    const topChapters = chapters.filter((c) => !c.parent).map((c) => chapterIri(c.number));

    // 법령 노드 — 이미 있으면 장 목록만 맞춘다 (사람이 보강한 필드 보존). 없을 때만 새로 만든다.
    const actPath = resolve(ACTS, `${rule.actSlug}.jsonld`);
    if ((await exists(actPath)) && topChapters.length) {
      const raw = await readFile(actPath, "utf-8");
      const current = JSON.parse(raw) as Record<string, unknown>;
      if (JSON.stringify(current.hasChapter ?? []) !== JSON.stringify(topChapters)) {
        current.hasChapter = topChapters;
        await writeFile(actPath, JSON.stringify(current, null, 2) + (raw.endsWith("\n") ? "\n" : ""), "utf-8");
      }
    }
    if (!(await exists(actPath))) {
      const act = {
        "@context": "../../context.jsonld",
        "@id": actIri,
        "@type": ["Act", "Legislation"],
        legislationType: "Notice",
        legislationIdentifier: name,
        legislationDate: effective,
        temporalCoverage: `${effective}/..`,
        alternativeNames: rule.alternativeNames,
        verificationStatus: "verified",
        delegationLevel: NOTICE_DELEGATION_LEVEL,
        _meta: {
          publishedBy: "법제처 국가법령정보센터",
          sourceUrl,
          행정규칙일련번호: rule.id,
          발령번호: `${tag(xml, "소관부처명")}고시 제${no}호`,
          발령일자: date,
          관할부처: tag(xml, "소관부처명"),
          법령구분: tag(xml, "행정규칙종류"),
          제개정구분: tag(xml, "제개정구분명"),
          fetchedAt: today,
          licenseHint: LICENSE_HINT,
        },
        legislationLegalForce: "InForce",
        jurisdiction: "KR",
        hasArticle: articleIris,
        ...(topChapters.length ? { hasChapter: topChapters } : {}),
      };
      await writeFile(actPath, JSON.stringify(act, null, 2) + "\n", "utf-8");
      console.log(`[${rule.actKey}] 법령 노드 신설 — ${name} (${no}, 시행 ${effective})`);
    }
    console.log(`[${rule.actKey}] 조문 +${added} 신규 / ${updated} 갱신 · 장·절 ${chapters.length}개 (${chapterWritten}개 기록)`);
  }
  // 연결표의 키가 실제 장·절과 맞지 않으면 조용히 빠지므로 알린다
  const unused = Object.keys(CHAPTER_SCOPE).filter((k) => !usedScopeKeys.has(k));
  if (unused.length) {
    console.error(`장·절 연결표에 있지만 원문에 없는 키: ${unused.join(", ")}`);
    process.exitCode = 1;
  }
}

void main();
