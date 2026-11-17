#!/usr/bin/env tsx
/**
 * extract-chapter-hierarchy.ts — 법령의 편·장·절·관·속 구조를 법제처 원문으로 만든다
 *
 * 법제처 lawService.do(target=eflaw, 현행 MST + 시행일) 응답에서 <조문여부>전문</조문여부> 블록(편·장·절·관·속 머리)을
 * 차례대로 읽어 구조 노드를 쓰고, 조문 노드가 어느 장에 속하는지 원문 순서대로 잇는다.
 *
 *   - 편   part:{actKey}:{P}편                     chapters/{actKey}-{P}편.jsonld
 *   - 장   chapter:{actKey}:{P}편{N}장 · {N}장       chapters/{actKey}-{P}편{N}장.jsonld · {actKey}-{N}장.jsonld
 *   - 절·관·속  chapter:{actKey}:…{M}절[{K}관[{L}속]]  (위 이름 뒤에 이어 붙인다)
 *
 * 장 번호는 편마다 다시 시작한다 — 편이 있는 법령(산업안전보건기준에 관한 규칙)은 편 번호를 함께 써야 장이 하나로 정해진다.
 * 행정규칙(고시·지침)의 편·장·절 이름 규칙(sync-admin-rules.ts)과 같다.
 *
 * 각 구조 노드의 hasArticle 은 그 안의 조문 전부, hasChapter 는 바로 아래 구조 노드다.
 * 조문 노드의 partOf 는 그 조문이 속한 장(장이 없으면 편, 둘 다 없으면 법령)이다.
 * 원문에 없는 예전 구조 노드는 지운다. 바뀐 것이 없는 파일은 다시 쓰지 않는다.
 *
 * 사용:
 *   LAW_OC=... tsx scripts/ontology/extract-chapter-hierarchy.ts
 *   LAW_OC=... tsx scripts/ontology/extract-chapter-hierarchy.ts --dry-run       # 바뀔 것만 출력
 *   tsx scripts/ontology/extract-chapter-hierarchy.ts --cache <dir>              # {MST}-{시행일}.xml 을 저장·재사용
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const CHAPTERS = resolve(NODES, "chapters");
const ACTS = resolve(NODES, "acts");
const LAW_BASE = "https://www.law.go.kr/DRF/lawService.do";
const LICENSE_HINT = "저작권법 제7조 비보호 (자유 인용)";

/** 현행 판 — 판본 점검(check:law-editions)이 현행으로 확인한 MST 와 그 판의 시행일 */
const LAWS = [
  { actKey: "산안법", mst: "291447", efYd: "20261027", actNode: "act:산업안전보건법", name: "산업안전보건법" },
  { actKey: "산안법시행령", mst: "288347", efYd: "20260801", actNode: "act:산업안전보건법시행령", name: "산업안전보건법 시행령" },
  { actKey: "산안법시행규칙", mst: "288431", efYd: "20260801", actNode: "act:산업안전보건법시행규칙", name: "산업안전보건법 시행규칙" },
  { actKey: "기준규칙", mst: "273603", efYd: "20260302", actNode: "act:산업안전보건기준에관한규칙", name: "산업안전보건기준에 관한 규칙" },
  { actKey: "중처법", mst: "228817", efYd: "20220127", actNode: "act:중대재해처벌등에관한법률", name: "중대재해 처벌 등에 관한 법률" },
  { actKey: "중처법시행령", mst: "277417", efYd: "20251001", actNode: "act:중대재해처벌등에관한법률시행령", name: "중대재해 처벌 등에 관한 법률 시행령" },
] as const;
type Law = (typeof LAWS)[number];

/** 구조 단위 — 위에서 아래로 */
const LEVELS = ["편", "장", "절", "관", "속"] as const;
type Level = (typeof LEVELS)[number];
/** 장의 위치 — 조문 노드의 partOf 가 가리키는 단위 */
const CHAPTER_LEVEL = 1;

interface Unit {
  level: number;
  /** 편부터 이 단위까지의 번호 — [{n:"2",l:"편"},{n:"1",l:"장"},…] */
  path: Array<{ n: string; l: Level }>;
  title: string;
  articles: string[];
  children: string[];
}

// ── 원문 읽기 ────────────────────────────────────────────────────────
const cdata = (s: string): string => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();

/** 머리 제목 — "<개정 2012.5.31>" 같은 꼬리표를 떼고 띄어쓰기를 하나로 */
export function headingTitle(raw: string): string {
  return raw
    .split("\n")[0]
    .replace(/<(개정|신설|전문개정|제목개정|본조신설)[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 단위 이름 — "2편1장9절" (편이 없는 법령은 "2장1절") */
export function unitSuffix(path: Unit["path"]): string {
  return path.map((p) => `${p.n}${p.l}`).join("");
}

export function unitIri(actKey: string, path: Unit["path"]): string {
  return path.length === 1 && path[0].l === "편" ? `part:${actKey}:${path[0].n}편` : `chapter:${actKey}:${unitSuffix(path)}`;
}

/** 원문 순서대로 구조 단위와 조문 소속을 읽는다 */
export function parseStructure(xml: string, actKey: string, hasArticleNode: (num: string) => boolean): { units: Map<string, Unit>; articleChapter: Map<string, string | null> } {
  const units = new Map<string, Unit>();
  const articleChapter = new Map<string, string | null>();
  const stack: Array<Unit | null> = [];
  let deletedDepth = -1;
  for (const m of xml.matchAll(/<조문단위[^>]*>([\s\S]*?)<\/조문단위>/g)) {
    const u = m[1];
    const kind = cdata(u.match(/<조문여부>([\s\S]*?)<\/조문여부>/)?.[1] ?? "");
    const body = cdata(u.match(/<조문내용>([\s\S]*?)<\/조문내용>/)?.[1] ?? "");
    if (kind === "전문") {
      const h = body.match(/^제\s*(\d+)\s*(편|장|절|관|속)\s*([\s\S]*)$/);
      if (!h) continue;
      const level = LEVELS.indexOf(h[2] as Level);
      const title = headingTitle(h[3]);
      // 이 단위와 그 아래를 비운다
      stack.length = level;
      if (/^삭제/.test(title)) {
        deletedDepth = level;
        continue;
      }
      deletedDepth = -1;
      const parentPath = stack.filter((x): x is Unit => !!x).at(-1)?.path ?? [];
      const unit: Unit = { level, path: [...parentPath, { n: h[1], l: h[2] as Level }], title, articles: [], children: [] };
      const iri = unitIri(actKey, unit.path);
      const parent = stack.filter((x): x is Unit => !!x).at(-1);
      if (parent) parent.children.push(iri);
      units.set(iri, unit);
      stack[level] = unit;
      continue;
    }
    if (kind !== "조문") continue;
    const no = cdata(u.match(/<조문번호>([\s\S]*?)<\/조문번호>/)?.[1] ?? "");
    const gaji = cdata(u.match(/<조문가지번호>([\s\S]*?)<\/조문가지번호>/)?.[1] ?? "");
    if (!no) continue;
    const num = gaji && gaji !== "0" ? `${no}의${gaji}` : no;
    if (!hasArticleNode(num)) continue;
    const iri = `art:${actKey}:${num}`;
    const open = deletedDepth >= 0 ? stack.slice(0, deletedDepth) : stack;
    for (const s of open) if (s) s.articles.push(iri);
    // 장 — 없으면 가장 가까운 상위(편)
    const chapter = open[CHAPTER_LEVEL] ?? open.filter((x): x is Unit => !!x).at(-1) ?? null;
    articleChapter.set(num, chapter ? unitIri(actKey, chapter.path) : null);
  }
  return { units, articleChapter };
}

// ── 파일 ────────────────────────────────────────────────────────────
async function fetchXml(law: Law, oc: string, cacheDir: string | null): Promise<string> {
  const cachePath = cacheDir ? resolve(cacheDir, `${law.mst}-${law.efYd}.xml`) : null;
  if (cachePath && existsSync(cachePath)) return readFile(cachePath, "utf8");
  if (!oc) throw new Error("LAW_OC 환경 변수가 없고 받아 둔 원문도 없습니다");
  const url = `${LAW_BASE}?OC=${encodeURIComponent(oc)}&target=eflaw&MST=${law.mst}&efYd=${law.efYd}&type=XML`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!xml.includes("<조문단위")) throw new Error("응답에 조문이 없습니다");
  if (cachePath) await writeFile(cachePath, xml, "utf8");
  return xml;
}

/** 파일 끝 줄바꿈은 원래 모양대로 — 바뀐 것이 없으면 쓰지 않는다 */
async function writeJson(path: string, node: unknown, dryRun: boolean): Promise<boolean> {
  const raw = existsSync(path) ? await readFile(path, "utf8") : null;
  const body = JSON.stringify(node, null, 2) + (raw === null || raw.endsWith("\n") ? "\n" : "");
  if (raw === body) return false;
  if (!dryRun) await writeFile(path, body, "utf8");
  return true;
}

function label(path: Unit["path"]): string {
  return path.map((p) => `제${p.n}${p.l}`).join(" ");
}

/** chapterNumber — 행정규칙과 같은 꼴: 편 아래 장은 "2편1", 그 아래는 "-" 로 잇는다 ("2편1-9-7") */
function chapterNumber(path: Unit["path"]): string {
  const [first, ...rest] = path;
  if (first.l === "편") {
    if (rest.length === 0) return first.n;
    return `${first.n}편${rest.map((p) => p.n).join("-")}`;
  }
  return path.map((p) => p.n).join("-");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const cacheIdx = args.indexOf("--cache");
  const cacheDir = cacheIdx >= 0 ? resolve(args[cacheIdx + 1]) : null;
  if (cacheDir) await mkdir(cacheDir, { recursive: true });
  const oc = process.env.LAW_OC ?? "";
  const today = new Date().toISOString().slice(0, 10);

  const articleFiles = new Set((await readdir(ARTICLES)).filter((f) => f.endsWith(".jsonld")));
  const chapterFiles = (await readdir(CHAPTERS)).filter((f) => f.endsWith(".jsonld"));

  for (const law of LAWS) {
    let xml: string;
    try {
      xml = await fetchXml(law, oc, cacheDir);
    } catch (err) {
      console.log(`[${law.actKey}] 원문을 받지 못함 — 건너뜀: ${(err as Error).message}`);
      continue;
    }
    const { units, articleChapter } = parseStructure(xml, law.actKey, (num) => articleFiles.has(`${law.actKey}-§${num}.jsonld`));
    const sourceUrl = `https://www.law.go.kr/법령/${encodeURIComponent(law.name)}`;
    let written = 0;

    // 구조 노드
    for (const [iri, unit] of units) {
      const path = resolve(CHAPTERS, `${law.actKey}-${unitSuffix(unit.path)}.jsonld`);
      const previous = existsSync(path) ? (JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & { _meta?: Record<string, unknown> }) : undefined;
      const parent = unit.path.length > 1 ? unitIri(law.actKey, unit.path.slice(0, -1)) : law.actNode;
      const isPart = unit.level === 0;
      const node: Record<string, unknown> = {
        ...(previous ?? {}),
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": [isPart ? "Part" : "Chapter", "Legislation"],
        ...(isPart ? { partNumber: unit.path[0].n } : { chapterNumber: chapterNumber(unit.path) }),
        title: unit.title,
        partOf: parent,
        verificationStatus: "verified",
        _meta: {
          ...(previous?._meta ?? {}),
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          sourceUrl,
          fetchedAt: (previous?._meta?.fetchedAt as string | undefined) ?? today,
          lawServiceMST: law.mst,
          verifiedBy: `법제처 lawService.do (target=eflaw, MST=${law.mst}, efYd=${law.efYd}) 편·장·절 머리`,
          licenseHint: LICENSE_HINT,
          linkBasis: { partOf: "source", hasArticle: "source", ...(unit.children.length ? { hasChapter: "source" } : {}) },
        },
        description: `${law.name} ${label(unit.path)} ${unit.title}`,
        legislationIdentifier: law.name,
        jurisdiction: "KR",
        hasArticle: unit.articles,
      };
      delete (node._meta as Record<string, unknown>).note;
      if (unit.children.length) node.hasChapter = unit.children;
      else delete node.hasChapter;
      if (isPart) delete node.chapterNumber;
      if (await writeJson(path, node, dryRun)) written += 1;
    }

    // 원문에 없는 예전 구조 노드
    const removed: string[] = [];
    for (const f of chapterFiles) {
      if (!f.startsWith(`${law.actKey}-`)) continue;
      const node = JSON.parse(await readFile(resolve(CHAPTERS, f), "utf8")) as { "@id"?: string };
      const id = node["@id"] ?? "";
      if (!id.startsWith(`chapter:${law.actKey}:`) && !id.startsWith(`part:${law.actKey}:`)) continue;
      if (units.has(id)) continue;
      removed.push(id);
      if (!dryRun) await unlink(resolve(CHAPTERS, f));
    }

    // 조문 노드 — 속한 장
    let relinked = 0;
    for (const [num, chapter] of articleChapter) {
      const path = resolve(ARTICLES, `${law.actKey}-§${num}.jsonld`);
      const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const partOf = chapter ?? law.actNode;
      if (node.partOf === partOf) continue;
      node.partOf = partOf;
      if (await writeJson(path, node, dryRun)) relinked += 1;
    }

    // 법령 노드 — 바로 아래 편·장
    const actPath = resolve(ACTS, `${law.name.replace(/\s+/g, "")}.jsonld`);
    if (existsSync(actPath)) {
      const act = JSON.parse(await readFile(actPath, "utf8")) as Record<string, unknown>;
      const top = [...units].filter(([, u]) => u.path.length === 1);
      const parts = top.filter(([, u]) => u.level === 0).map(([iri]) => iri);
      const chapters = top.filter(([, u]) => u.level !== 0).map(([iri]) => iri);
      if (parts.length) act.hasPart = parts;
      else delete act.hasPart;
      if (chapters.length) act.hasChapter = chapters;
      else delete act.hasChapter;
      await writeJson(actPath, act, dryRun);
    }

    const byLevel = LEVELS.map((l, i) => `${l} ${[...units.values()].filter((u) => u.level === i).length}`).join(" · ");
    console.log(`[${law.actKey}] ${byLevel} — 쓴 구조 노드 ${written}, 지운 예전 노드 ${removed.length}${removed.length ? ` (${removed.join(", ")})` : ""}, 장 연결을 고친 조문 ${relinked}${dryRun ? " (dry-run)" : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
