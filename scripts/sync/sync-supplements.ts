#!/usr/bin/env tsx
/**
 * sync-supplements.ts — 산업안전보건법·시행령·시행규칙·안전보건규칙의 부칙(시행일·적용례·경과조치)을 법제처 원문으로 받아 그래프 노드로 만든다
 *
 * 법제처 lawService.do?target=eflaw (현행판 MST·시행일 — reconcile-article-editions.ts 의 EDITIONS) 응답의 <부칙단위> 를 읽어
 *   - 부칙 조마다 노드 하나  src/ontology/graph/nodes/supplements/{법령키}-부칙-{공포번호}-{조}.jsonld
 *     (조로 나뉘지 않은 부칙은 "본문" 노드 하나)
 * 를 쓴다. 본문은 원문 줄을 그대로 둔다.
 *
 * 결정론으로 정하는 것
 *   - 부칙 성격(supplementKind): 부칙 조 제목의 낱말로 정한다 — 시행일·적용례·경과조치·특례·다른 법령의 개정 …
 *   - 언급한 본칙 조문(references): 부칙 본문 속 "제N조" 를 이 법령(또는 "법"=산업안전보건법, "영"=시행령)의 조문 노드로 잇는다.
 *     「다른 법령」 뒤의 조문, "다른 법령의 개정" 부칙 조의 조문은 잇지 않는다. 노드가 없는 조문은 _meta.unresolvedRefs 에 남긴다.
 *
 * 사용
 *   LAW_OC=... tsx scripts/sync/sync-supplements.ts
 *   tsx scripts/sync/sync-supplements.ts --from <XML 폴더>   # 받아 둔 {법령키}.xml 로 갱신
 */
import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITIONS } from "./reconcile-article-editions.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const ACTS = resolve(NODES, "acts");
const OUT = resolve(NODES, "supplements");
const BASE = "https://www.law.go.kr/DRF";
const LICENSE_HINT = "저작권법 제7조 비보호 (자유 인용)";
const TIMEOUT_MS = 60000;
/** 시행령·시행규칙·안전보건규칙 본문의 "법" 은 산업안전보건법, 시행규칙의 "영" 은 시행령 */
const PARENT_LAW: Record<string, { 법?: string; 영?: string }> = {
  산안법시행령: { 법: "산안법" },
  산안법시행규칙: { 법: "산안법", 영: "산안법시행령" },
  기준규칙: { 법: "산안법" },
};
/** 부칙 조 제목 → 성격. 앞에 있는 것이 먼저 맞는다 */
const KIND_BY_HEADING: [RegExp, string][] = [
  [/^삭제$/, "deleted"],
  [/다른\s*(?:법령|법률)의?\s*개정/, "other-law-amendment"],
  [/다른\s*법령과의\s*관계/, "relation-to-other-laws"],
  [/다른\s*법령의?\s*폐지|폐지/, "repeal"],
  [/시행일/, "effective-date"],
  [/유효기간/, "validity-period"],
  [/적용례/, "application"],
  [/경과\s*(?:조치|규정)/, "transitional"],
  [/특례/, "special-case"],
];
/** 두 조문 표기 사이가 이것만으로 이어지면 앞 조문과 같은 법령으로 본다 */
/** 앞 조문 표기와 같은 법령으로 잇는 사이말 — "같은 조 제5항"은 바로 앞 조문(같은 법령·같은 옛 번호 여부)을 가리킨다 */
const CHAIN_GAP = /^(?:\s|,|ㆍ|·|및|또는|부터|까지|와|과|같은\s*조|제\d+항|제\d+호(?:의\d+)?|[가-하]목(?:의\d+)?|본문|단서|전단|후단|각\s*호|외의|의)*$/;
const ARTICLE_REF = /제(\d+)조(?:의(\d+))?/g;
/** 조문 표기 앞을 이만큼 거슬러 본다 — 「법령명」(긴 설명) 을 넘어 "종전의" 를 찾을 수 있게 */
const LOOKBACK_CHARS = 120;
/** "제2조 및 제3조 생략" · "<단서 생략>" — 줄여 옮긴 줄 */
const OMITTED_LINE = /생략\s*>?\s*$/;
/** 조문 표기 바로 앞이 이 말이면 이 법령 본칙이 아니다 — 부칙 자신, 앞서 든 다른 법("같은 법"), 고시·훈령 등 */
const OTHER_REFERENT = /(?:부칙|같은\s*(?:법|영|규칙)|규칙|고시|훈령|예규|지침|조례|협약)\s*$/;
/** "종전의 제N조" · "종전의 법(…) 제N조" · "종전의 「…」(…) 제N조" · "종전 법 제N조" — 개정 전 옛 조문 */
const FORMER_PROVISION = /종전(?:의)?\s*(?:(?:법|영|규칙)\s*)?(?:\([^)]*\)\s*)?(?:「[^」]*」\s*(?:\([^)]*\))?\s*)?$/;
/** 고치는 문구를 따옴표로 든 부분 — 중 "「의료법」 제78조"를 "「간호법」 제5조"로 한다 */
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g;
/** 다른 법령 부칙 속 "○○ 일부를 다음과 같이 개정한다" 문단의 끝 — 다음 항 번호·생략 줄 */
const AMENDMENT_SEGMENT_END = /^(?:[①-⑳]|<\d+>|제\d+조\s*생략)|생략\s*$/;

interface SupplementArticle {
  number: string;
  heading: string;
  lines: string[];
}

async function fetchXml(oc: string, mst: string, efYd: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/lawService.do?OC=${oc}&target=eflaw&type=XML&MST=${mst}&efYd=${efYd}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? m[1].trim() : "";
}

/** <부칙내용> 의 CDATA 줄을 원문 순서대로 (빈 줄 제외) */
function contentLines(unit: string): string[] {
  const m = unit.match(/<부칙내용>([\s\S]*?)<\/부칙내용>/);
  if (!m) return [];
  return [...m[1].matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((c) => c[1].trim()).filter(Boolean);
}

/** 머리줄 뒤의 줄들을 부칙 조로 나눈다 — "제N조(제목)" 로 시작하는 줄이 새 조. 없으면 "본문" 하나 */
function splitArticles(lines: string[]): SupplementArticle[] {
  const out: SupplementArticle[] = [];
  for (const line of lines) {
    const m = line.match(/^제(\d+)조(?:의(\d+))?\s*\(([^)]*)\)/);
    // "제3조 삭제 <2022.8.16>" — 제목 없이 지워진 부칙 조도 새 조다 (앞 조에 붙이면 앞 조가 엉뚱한 조문을 가리킨다)
    const deleted = m ? null : line.match(/^제(\d+)조(?:의(\d+))?\s*삭제/);
    if (deleted) out.push({ number: deleted[2] ? `${deleted[1]}의${deleted[2]}` : deleted[1], heading: "삭제", lines: [line] });
    else if (m) out.push({ number: m[2] ? `${m[1]}의${m[2]}` : m[1], heading: m[3].trim(), lines: [line] });
    else if (out.length) out[out.length - 1].lines.push(line);
    else out.push({ number: "본문", heading: "", lines: [line] });
  }
  return out;
}

function kindOf(article: SupplementArticle): string {
  for (const [pattern, kind] of KIND_BY_HEADING) if (pattern.test(article.heading)) return kind;
  if (article.number === "본문" && /시행한다/.test(article.lines.join(" "))) return "effective-date";
  return "other";
}

function isoDate(yyyymmdd: string): string {
  return /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : "";
}

/** 조 번호 비교용 — "13의2" → [13, 2] */
function numKey(n: string): [number, number] {
  const [a, b] = n.split("의");
  return [Number(a), Number(b ?? 0)];
}

/** 괄호를 감싼 모양 그대로 지운다 — "제63조(제41조에 관한 부분에 한정한다), 제65조" 의 나열을 괄호 너머로 잇기 위해 */
function stripParens(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/\([^()]*\)/g, "");
  } while (s !== prev);
  return s;
}

/** 위치마다 그 위치를 감싼 가장 안쪽 여는 괄호의 위치 (-1 = 괄호 밖) */
function enclosingParen(text: string): number[] {
  const open = new Array<number>(text.length + 1).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i <= text.length; i++) {
    open[i] = stack.length ? stack[stack.length - 1] : -1;
    const ch = text[i];
    if (ch === "(") stack.push(i);
    else if (ch === ")" && stack.length) stack.pop();
  }
  return open;
}

/** 조문 노드 번호 (법령키 → 조 번호들) — 부칙이 가리키는 조문을 이을 때 쓴다 */
export async function loadArticleNumbers(): Promise<Map<string, string[]>> {
  const existing = new Map<string, string[]>();
  for (const f of await readdir(ARTICLES)) {
    const m = f.match(/^(.+)-§(\d+(?:의\d+)?)\.jsonld$/);
    if (!m) continue;
    const list = existing.get(m[1]) ?? [];
    list.push(m[2]);
    existing.set(m[1], list);
  }
  return existing;
}

/** 다른 법령 부칙 가운데 이 법령을 고치는 문단 ("○○ 일부를 다음과 같이 개정한다." 다음 줄부터 다음 항 번호·생략 줄 전까지) */
export function amendedSegment(lines: string[], lawName: string): string[] {
  const want = `${lawName.replace(/\s/g, "")}일부를다음과같이개정한다`;
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const compact = line.replace(/\s/g, "");
    if (/일부를다음과같이개정한다/.test(compact)) {
      inside = compact.includes(want);
      continue;
    }
    if (inside && AMENDMENT_SEGMENT_END.test(line.trim())) inside = false;
    if (inside) out.push(line);
  }
  return out;
}

/** 표기 앞말로 어느 법령 조문인지 정한다 (null = 이 법령 본칙이 아니거나 옛 조문) */
function ownerByContext(text: string, start: number, lawKey: string): string | null {
  const before = text.slice(Math.max(0, start - 3), start);
  const window = text.slice(Math.max(0, start - LOOKBACK_CHARS), start);
  if (FORMER_PROVISION.test(window)) return null; // "종전의 제N조" — 개정 전 옛 번호라 지금 조문과 다를 수 있다
  if (/」\s*(?:\([^)]*\))?\s*$/.test(window)) return null; // 「다른 법령」(설명) 제N조
  // "같은 법 제N조" 가 "법 제N조" 로 읽히지 않도록 다른 대상 판정을 먼저 한다
  if (OTHER_REFERENT.test(window)) return null; // "부칙 제N조"·"같은 법 제N조"·"고시 제N조" — 이 법령 본칙이 아니다
  if (/(?:^|[^가-힣])법\s*$/.test(before)) return PARENT_LAW[lawKey]?.법 ?? lawKey;
  if (/(?:^|[^가-힣])영\s*$/.test(before)) return PARENT_LAW[lawKey]?.영 ?? null;
  return lawKey;
}

/**
 * 부칙 본문 속 본칙 조문 표기를 조문 주소로 바꾼다.
 *   - 쉼표·및·부터…까지 로 이어진 표기는 앞 표기와 같은 법령 (괄호 한정구는 건너뛰고 잇는다)
 *   - 괄호가 조문 표기로 시작하면 괄호 앞 조문과 같은 법령 — "제63조(제41조에 관한 부분에 한정한다)"
 *   - 따옴표 속 고치는 문구는 읽지 않는다
 * 반환: 이은 주소(있는 노드만)와 노드가 없는 표기.
 */
export function extractRefs(
  rawText: string,
  lawKey: string,
  existing: Map<string, string[]>,
): { refs: string[]; unresolved: string[] } {
  const text = rawText.replace(QUOTED, "〃");
  const open = enclosingParen(text);
  const refs = new Set<string>();
  const unresolved = new Set<string>();
  // 같은 괄호 안(또는 괄호 밖)에서 마지막으로 읽은 표기 — 괄호마다 따로 둔다
  const last = new Map<number, { end: number; owner: string | null; num: string }>();
  for (const m of text.matchAll(ARTICLE_REF)) {
    const start = m.index ?? 0;
    const num = m[2] ? `${m[1]}의${m[2]}` : m[1];
    const group = open[start];
    const prev = last.get(group);
    let owner: string | null;
    let rangeFrom: string | null = null;
    const gap = prev ? stripParens(text.slice(prev.end, start)) : null;
    if (prev && gap !== null && CHAIN_GAP.test(gap)) {
      owner = prev.owner; // 앞 표기와 같은 법령 (제1조, 제2조 및 제3조 / 법 제3조부터 제5조까지)
      if (/부터\s*$/.test(gap)) rangeFrom = prev.num;
    } else if (!prev && group >= 0 && text.slice(group + 1, start).trim() === "" && last.has(open[group])) {
      const outer = last.get(open[group])!;
      owner = CHAIN_GAP.test(stripParens(text.slice(outer.end, group))) ? outer.owner : ownerByContext(text, start, lawKey);
    } else {
      owner = ownerByContext(text, start, lawKey);
    }
    if (owner) {
      const nums = existing.get(owner) ?? [];
      // 범위 "제A조부터 제B조까지" — 사이의 조문 노드를 잇는다.
      // 범위 안의 가지 조문(제N조의M)은 그 부칙 뒤에 생겼을 수 있어 잇지 않는다 —
      // 양 끝과 본 번호가 같은 가지 조문만 잇는다 ("제221조의2부터 제221조의4까지" 의 제221조의3)
      const targets = rangeFrom
        ? nums.filter((n) => {
            const k = numKey(n);
            const lo = numKey(rangeFrom!);
            const hi = numKey(num);
            if (k[1] !== 0 && k[0] !== lo[0] && k[0] !== hi[0]) return false;
            return (k[0] > lo[0] || (k[0] === lo[0] && k[1] >= lo[1])) && (k[0] < hi[0] || (k[0] === hi[0] && k[1] <= hi[1]));
          })
        : nums.includes(num)
          ? [num]
          : [];
      if (targets.length) for (const t of targets) refs.add(`art:${owner}:${t}`);
      else unresolved.add(`${owner} 제${m[1]}조${m[2] ? `의${m[2]}` : ""}`);
    }
    last.set(group, { end: start + m[0].length, owner, num });
  }
  return { refs: [...refs], unresolved: [...unresolved] };
}

async function main(): Promise<void> {
  const fromIdx = process.argv.indexOf("--from");
  const fromDir = fromIdx >= 0 ? process.argv[fromIdx + 1] : null;
  const oc = process.env.LAW_OC ?? "";
  if (!fromDir && !oc) {
    console.error("LAW_OC 환경 변수(법제처 OpenAPI 인증값)가 필요합니다. 받아 둔 XML 로 돌리려면 --from <폴더>.");
    process.exit(2);
  }
  const existing = await loadArticleNumbers();
  const actFiles = await readdir(ACTS);
  await mkdir(OUT, { recursive: true });
  // 이전 실행이 남긴 부칙 노드는 지우고 다시 쓴다 (현행판에서 빠진 부칙이 남지 않게)
  for (const f of await readdir(OUT)) if (f.endsWith(".jsonld")) await rm(resolve(OUT, f));
  const today = new Date().toISOString().substring(0, 10);
  for (const ed of EDITIONS) {
    const xml = fromDir ? await readFile(resolve(fromDir, `${ed.canonical}.xml`), "utf-8") : await fetchXml(oc, ed.mst, ed.efYd);
    const actFile = actFiles.find((f) => f.replace(/\.jsonld$/, "") === ed.name.replace(/\s/g, ""));
    if (!actFile) throw new Error(`법령 노드를 찾지 못했습니다: ${ed.name}`);
    const actIri = (JSON.parse(await readFile(resolve(ACTS, actFile), "utf-8")) as { "@id": string })["@id"];
    const units = [...xml.matchAll(/<부칙단위[^>]*>([\s\S]*?)<\/부칙단위>/g)].map((m) => m[1]);
    let nodes = 0;
    let linked = 0;
    for (const unit of units) {
      const lines = contentLines(unit);
      const header = lines[0] ?? "";
      const promulgationNo = String(Number(tag(unit, "부칙공포번호")));
      const promulgated = isoDate(tag(unit, "부칙공포일자"));
      for (const art of splitArticles(lines.slice(1))) {
        const kind = kindOf(art);
        const text = art.lines.join("\n");
        const { refs, unresolved } =
          kind === "relation-to-other-laws" || kind === "deleted"
            ? { refs: [], unresolved: [] }
            : kind === "other-law-amendment"
              ? // 다른 법령을 고치는 부칙 조는 이 법령을 고치는 문단만 읽는다 (다른 법령 조문을 이 법령 조문으로 잇지 않게)
                extractRefs(amendedSegment(art.lines, ed.name).join("\n"), ed.canonical, existing)
              : // "제2조 및 제3조 생략" 같은 줄은 다른 법령 부칙을 줄여 옮긴 것이라 그 부칙 자신의 조를 가리킨다.
                // 부칙 조 머리말 "제N조(제목)" 의 N 은 부칙 자신의 번호라 빼고 읽는다
                extractRefs(
                  art.lines
                    .filter((line) => !OMITTED_LINE.test(line))
                    .join("\n")
                    .replace(/^제\d+조(?:의\d+)?\s*\([^)]*\)/, ""),
                  ed.canonical,
                  existing,
                );
        const iri = `supp:${ed.canonical}:${promulgationNo}:${art.number}`;
        const label = art.number === "본문" ? header : `${header} 제${art.number.replace("의", "조의").replace(/^(\d+)$/, "$1조")}${art.heading ? `(${art.heading})` : ""}`;
        const node = {
          "@context": "../../context.jsonld",
          "@id": iri,
          "@type": ["SupplementaryProvision"],
          title: label,
          supplementKind: kind,
          partOf: actIri,
          legislationIdentifier: ed.name,
          legislationDate: promulgated,
          ...(refs.length ? { references: refs } : {}),
          description: text,
          verificationStatus: "verified",
          _meta: {
            publishedBy: "법제처 국가법령정보센터 (자동 sync)",
            sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(ed.name)}/부칙`,
            lawServiceMST: ed.mst,
            promulgationNo,
            fetchedAt: today,
            licenseHint: LICENSE_HINT,
            referencesBasis:
              "부칙 본문의 '제N조' 표기를 원문 그대로 읽어 이었다 (법=산업안전보건법, 영=시행령). 다른 법령 조문과 '종전의 제N조'(개정 전 옛 번호)는 잇지 않는다. 다른 법령이 이 법령을 고친 부칙은 '○○ 일부를 다음과 같이 개정한다' 문단의 조문만 잇는다. '제A조부터 제B조까지'는 가지 조문 가운데 양 끝과 본 번호가 같은 것만 잇는다 (다른 가지 조문은 그 부칙 뒤에 생겼을 수 있다).",
            ...(unresolved.length ? { unresolvedRefs: unresolved } : {}),
          },
        };
        const file = `${ed.canonical}-부칙-${promulgationNo}-${art.number}.jsonld`;
        await writeFile(resolve(OUT, file), JSON.stringify(node, null, 2) + "\n", "utf-8");
        nodes += 1;
        if (refs.length) linked += 1;
      }
    }
    console.log(`[${ed.canonical}] 부칙 ${units.length}건 → 부칙 조 노드 ${nodes}개 (본칙 조문과 이은 것 ${linked}개)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
