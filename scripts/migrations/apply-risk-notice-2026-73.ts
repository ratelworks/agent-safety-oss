#!/usr/bin/env tsx
/**
 * apply-risk-notice-2026-73.ts — 「사업장 위험성평가에 관한 지침」 전부개정(고용노동부고시 제2026-73호, 2026-11-04 시행) 반영
 *
 * 전부개정으로 조 번호가 통째로 바뀌었다(옛 판 29개 조 → 새 판 34개 조). 옛 제13조(공유)가 새 제17조가 되고
 * 새 제13조는 최초평가다. 그래서 동기화 스크립트처럼 "같은 번호에 합치기"를 하면 옛 조에 붙은 연결이 엉뚱한 조로 간다.
 * 이 스크립트는
 *   1. 그래프 안의 옛 조문 참조를 아래 대응표(뜻 기준)로 새 조문으로 옮기고
 *   2. 고시 조문 노드를 새 판 원문으로 다시 쓰며(조문 사이 인용·서식 연결은 새 본문에서 뽑는다)
 *   3. 고시 조문 노드의 역방향 연결(legalBasisOf·regulates·delegationOf)을 옮긴 참조에서 다시 계산하고
 *   4. 법령 노드·서식 노드·번들 고시 문서를 새 판으로 바꾼다.
 * 장(章) 노드는 이 스크립트 뒤에 sync-admin-rules.ts 를 돌려 새 판으로 맞춘다.
 *
 * 사용: tsx scripts/migrations/apply-risk-notice-2026-73.ts --from <{일련번호}.xml 이 있는 폴더>
 *       LAW_OC=... tsx scripts/migrations/apply-risk-notice-2026-73.ts
 */
import { readFile, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const LAWS = resolve(ROOT, "src", "ontology", "safety-laws");
const NEW_ID = "2100000288038";
const OLD_MD = "위험성평가-고시-2024-76.md";
const NEW_MD = "위험성평가-고시-2026-73.md";
const KEY = "위험성평가-고시";
const ACT_IRI = "act:사업장위험성평가에관한지침";
const LICENSE_HINT = "저작권법 제7조 비보호 (자유 인용)";
const LAW_SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";
const art = (n: string | number): string => `art:${KEY}:${n}`;

/**
 * 옛 조 → 새 조 (뜻 기준). 쪼개진 조는 기본값으로 관련 새 조 전부를 주고, 쓰임이 분명한 곳은 OVERRIDES 로 좁힌다.
 *   옛 제2조 적용범위 → 제3조 / 옛 제3조 정의 → 제2조
 *   옛 제5조의2 대상 — ② 아차사고 → 제10조③, ③ 중대재해 → 제15조③ (① 대상 범위는 시행규칙 제37조제1항제1호로 올라감)
 *   옛 제7조 방법 — 수행 체계 → 제8조, 기법 → 제9조, 교육 → 제18조 / 옛 제8조 절차 → 시행규칙 제37조제1항(고시에서 빠짐)
 *   옛 제9조 사전준비 — ① 실시규정 → 제19조, ② 판단 기준 → 제11조, ③ 사전조사 → 제20조
 *   옛 제13조 공유 → 제17조 / 옛 제14조 기록 → 제21조
 *   옛 제15조 실시 시기 — ① 최초 → 제13조, ② 수시 → 제15조, ③ 정기 → 제14조, ④ 상시 → 제16조
 *   옛 제16~28조 인정·지원 → 제22~34조
 */
const DEFAULT_MAP: Record<string, string[]> = {
  "1": [art(1)],
  "2": [art(3)],
  "3": [art(2)],
  "4": [art(4)],
  "5": [art(5)],
  "5의2": [art(10)],
  "6": [art(6)],
  "7": [art(8), art(9)],
  "8": ["art:산안법시행규칙:37"],
  "9": [art(19), art(20)],
  "10": [art(10)],
  "11": [art(11)],
  "12": [art(12)],
  "13": [art(17)],
  "14": [art(21)],
  "15": [art(13), art(14), art(15), art(16)],
  ...Object.fromEntries(Array.from({ length: 13 }, (_, i) => [String(16 + i), [art(22 + i)]])),
};

/** "{노드 @id}|{옛 조}" → 새 조 — 그 노드가 옛 조의 어느 부분을 말하는지 읽고 정한 것 */
const OVERRIDES: Record<string, string[]> = {
  // 상시평가 서식: 평가팀(수행 체계)·기법 / 공유 / 기록 / 상시평가
  "doc:monthly/monthly_risk_assessment|7": [art(8), art(9)],
  "doc:monthly/monthly_risk_assessment|15": [art(16)],
  // TBM — 매 작업일 작업 전 안전점검회의(새 제16조제1항제3호)와 공유(제17조)
  "doc:daily/daily_tbm|15": [art(16)],
  // 최초·수시·정기 서식은 각자의 실시 시기 조로
  "doc:ad_hoc/initial_risk_assessment|15": [art(13)],
  "doc:ad_hoc/ad_hoc_risk_assessment|15": [art(15)],
  "doc:annual/regular_risk_assessment|15": [art(14)],
  // 합동 안전보건점검 — 매주 논의·공유·이행상황 점검(새 제16조제1항제2호)
  "doc:weekly/weekly_joint_inspection|15": [art(16)],
  // 상시평가 선택 시 적용
  "applic:ongoing_assessment_selected|15": [art(16)],
  // 근로자 의견청취 — 옛 판에서도 제16조(인정의 신청)를 가리킨 잘못된 연결. 근로자 제안 청취·반영(새 제16조제1항제3호)과 근로자 참여(제6조)
  "doc:as_needed/worker_complaint_log|16": [art(16), art(6)],
  // 위험성평가 단계별 방법 노드 — 단계의 뜻에 맞는 조로 (옛 연결 중 단계와 맞지 않던 것도 바로잡음)
  "method:kras_step_1_prep|5": [art(8), art(19), art(20)],
  "method:kras_step_3_estimate|7": [art(9)],
  "method:risk_matrix_5x4|7": [art(9)],
  "method:kras_step_4_decide|8": [art(11)],
  "method:kras_step_5_control|9": [art(12)],
  // 법 제36조는 이제 시행규칙에 위임하고(제36조제6항), 고시는 시행규칙 제37조제3항이 위임한다 — 아래 EXTRA_DELEGATES
  "art:산안법:36|15": [],
};

/** 검토 규칙(reviewRules)의 근거 — "{노드 @id}|{규칙 번호}|{옛 조}" → 새 조 하나 */
const RULE_OVERRIDES: Record<string, string> = {
  "doc:ad_hoc/initial_risk_assessment|2|15": art(19), // 실시규정
};

/** 시행규칙 제37조제3항 — 위험성평가의 방법·절차·시기 세부는 고시로 (고시 제1조가 이를 정한다고 밝힘) */
const EXTRA_DELEGATES: Record<string, string[]> = {
  "art:산안법시행규칙:37": [9, 10, 11, 12, 13, 14, 15, 16].map(art),
};

/** 새 조 → 옛 조 (조문 노드의 이용자 표시 속성을 이어받을 출처) */
const ATTR_SOURCE: Record<string, string> = {
  "1": "1", "2": "3", "3": "2", "4": "4", "5": "5", "6": "6", "7": "6", "8": "7", "9": "7", "10": "10", "11": "11", "12": "12",
  "13": "15", "14": "15", "15": "15", "16": "15", "17": "13", "18": "7", "19": "9", "20": "9", "21": "14",
  ...Object.fromEntries(Array.from({ length: 13 }, (_, i) => [String(22 + i), String(16 + i)])),
};
const ATTR_KEYS = ["constructionRelevance", "userPersona", "userVisible", "isAppendix"] as const;

/** 조문 본문에서 다른 조문 인용을 읽을 때 앞말 → 그래프 법령 키 */
const CITE_PREFIX: Array<[RegExp, string]> = [
  [/「산업안전보건법」\s*$/, "산안법"],
  [/안전보건규칙\s*$/, "기준규칙"],
  [/(?:^|[^가-힣])(?:시행)?규칙\s*$/, "산안법시행규칙"],
  [/(?:^|[^가-힣])영\s*$/, "산안법시행령"],
  [/(?:^|[^가-힣])법\s*$/, "산안법"],
];

type Node = Record<string, unknown> & { "@id": string };

// ── XML 읽기 ────────────────────────────────────────────────────────
function tags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}\\s*>((?:<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|[^<])*)</${name}\\s*>`, "g"))].map((m) =>
    m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim(),
  );
}
const isoDate = (d: string): string => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d);

interface Article {
  num: string;
  title: string;
  text: string;
  chapter: string;
}

function parseArticles(xml: string): { articles: Article[]; chapters: string[] } {
  const articles: Article[] = [];
  const chapters: string[] = [];
  for (const raw of tags(xml, "조문내용")) {
    const h = raw.match(/^제(\d+)조(?:의(\d+))?\(([^)]+)\)/);
    if (!h) {
      const c = raw.match(/^제(\d+)장\s*(.+)/);
      if (c) chapters.push(`제${c[1]}장 ${c[2].trim()}`);
      continue;
    }
    articles.push({ num: h[2] ? `${h[1]}의${h[2]}` : h[1], title: h[3], text: raw, chapter: chapters[chapters.length - 1] ?? "" });
  }
  return { articles, chapters };
}

// ── 그래프 ──────────────────────────────────────────────────────────
async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const f of await readdir(dir)) {
    const p = join(dir, f);
    if ((await stat(p)).isDirectory()) await walk(p, out);
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}

const OLD_RE = new RegExp(`^art:${KEY}:([0-9]+(?:의[0-9]+)?)$`);

function remapList(nodeId: string, values: string[]): { next: string[]; changed: boolean } {
  const next: string[] = [];
  let changed = false;
  for (const v of values) {
    const m = typeof v === "string" ? v.match(OLD_RE) : null;
    if (!m) {
      if (!next.includes(v)) next.push(v);
      continue;
    }
    changed = true;
    const targets = OVERRIDES[`${nodeId}|${m[1]}`] ?? DEFAULT_MAP[m[1]];
    if (!targets) throw new Error(`${nodeId}: 대응표에 없는 옛 조 ${v}`);
    for (const t of targets) if (!next.includes(t)) next.push(t);
  }
  return { next, changed };
}

function remapScalar(nodeId: string, value: string, ruleIdx?: number): string {
  const m = value.match(OLD_RE);
  if (!m) return value;
  if (ruleIdx !== undefined) {
    const r = RULE_OVERRIDES[`${nodeId}|${ruleIdx}|${m[1]}`];
    if (r) return r;
  }
  const targets = OVERRIDES[`${nodeId}|${m[1]}`] ?? DEFAULT_MAP[m[1]];
  if (!targets || targets.length === 0) throw new Error(`${nodeId}: 단일 값 ${value} 를 옮길 곳이 없음`);
  return targets[0];
}

/** 노드 하나의 옛 고시 참조를 옮긴다 — 배열은 펼치고, 단일 값(검토 규칙 근거·출처 조문)은 첫 대응 */
function remapNode(node: Node): number {
  let n = 0;
  const id = node["@id"];
  const visit = (obj: Record<string, unknown>, ruleIdx?: number): void => {
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        if (v.every((x) => typeof x === "string")) {
          const { next, changed } = remapList(id, v as string[]);
          if (changed) {
            obj[k] = next;
            n += 1;
          }
        } else {
          v.forEach((x, i) => {
            if (x && typeof x === "object") visit(x as Record<string, unknown>, k === "reviewRules" ? i : ruleIdx);
          });
        }
      } else if (typeof v === "string" && OLD_RE.test(v)) {
        obj[k] = remapScalar(id, v, ruleIdx);
        n += 1;
      } else if (v && typeof v === "object") {
        visit(v as Record<string, unknown>, ruleIdx);
      }
    }
  };
  visit(node);
  return n;
}

/** 조문 본문에서 다른 조문 인용 — 그래프에 있는 조문만, 자기 자신 제외 */
function citations(a: Article, known: Set<string>): string[] {
  const body = a.text.replace(/^제\d+조(?:의\d+)?\([^)]+\)\s*/, "");
  const out: string[] = [];
  for (const m of body.matchAll(/제(\d+)조(?:의(\d+))?/g)) {
    const before = body.slice(Math.max(0, m.index! - 24), m.index!);
    const num = m[2] ? `${m[1]}의${m[2]}` : m[1];
    let law = KEY;
    const quoted = before.match(/「([^」]+)」\s*$/);
    if (quoted) law = quoted[1] === "산업안전보건법" ? "산안법" : "";
    else for (const [re, key] of CITE_PREFIX) if (re.test(before)) { law = key; break; }
    if (!law) continue;
    const iri = `art:${law}:${num}`;
    if (iri !== art(a.num) && known.has(iri) && !out.includes(iri)) out.push(iri);
  }
  return out;
}

// ── 번들 문서 ───────────────────────────────────────────────────────
function articleMarkdown(a: Article): string {
  const lines = a.text
    .replace(/^제\d+조(?:의\d+)?\([^)]+\)\s*/, "")
    .replace(/ㆍ/g, "·")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const l of lines) {
    if (/^[①-⑳]/.test(l)) out.push("", l);
    else if (/^[가-하]\.\s/.test(l)) out.push(`  ${l}`);
    else out.push(l);
  }
  return `## §${a.num} ${a.title.replace(/ㆍ/g, "·")}\n\n${out.join("\n").trim()}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf("--from");
  const xml = fromIdx >= 0
    ? await readFile(resolve(args[fromIdx + 1], `${NEW_ID}.xml`), "utf8")
    : await fetch(`${LAW_SERVICE_URL}?OC=${process.env.LAW_OC ?? ""}&target=admrul&ID=${NEW_ID}&type=XML`).then((r) => r.text());
  const name = tags(xml, "행정규칙명")[0];
  const issued = isoDate(tags(xml, "발령일자")[0] ?? "");
  const effective = isoDate(tags(xml, "시행일자")[0] ?? "") || issued;
  const no = tags(xml, "발령번호")[0];
  const kind = tags(xml, "행정규칙종류")[0];
  const revision = tags(xml, "제개정구분명")[0];
  if (!name || !issued || tags(xml, "행정규칙일련번호")[0] !== NEW_ID) throw new Error("응답에서 고시 이름·발령일·일련번호를 읽지 못했습니다");
  const { articles, chapters } = parseArticles(xml);
  if (articles.length !== 34) throw new Error(`조문 수가 34가 아님: ${articles.length}`);
  const today = new Date().toISOString().slice(0, 10);
  // 한 번만 돌린다 — 다시 돌리면 이미 옮긴 새 번호를 옛 번호로 보고 또 옮긴다
  const actNow = JSON.parse(await readFile(resolve(NODES, "acts", "사업장위험성평가에관한지침.jsonld"), "utf8")) as { _meta?: Record<string, unknown> };
  if (actNow._meta?.["행정규칙일련번호"] === NEW_ID) {
    console.log(`이미 반영됨 (법령 노드가 일련번호 ${NEW_ID}) — 아무것도 바꾸지 않음`);
    return;
  }
  const sourceUrl = `https://www.law.go.kr/행정규칙/${encodeURIComponent(name)}`;

  // 1. 그래프 전체 — 고시 조문 노드를 뺀 노드의 옛 참조를 옮긴다
  const files = await walk(NODES);
  const oldArticleFiles = files.filter((p) => p.startsWith(ARTICLES) && p.slice(ARTICLES.length + 1).startsWith(`${KEY}-§`));
  const oldNodes = new Map<string, Node>();
  for (const p of oldArticleFiles) {
    const n = JSON.parse(await readFile(p, "utf8")) as Node;
    oldNodes.set(String(n.articleNumber), n);
  }
  const others = new Map<string, Node>();
  let remapped = 0;
  let touchedFiles = 0;
  for (const p of files) {
    if (oldArticleFiles.includes(p)) continue;
    const raw = await readFile(p, "utf8");
    if (!raw.includes(`art:${KEY}:`)) {
      others.set(p, JSON.parse(raw) as Node);
      continue;
    }
    const node = JSON.parse(raw) as Node;
    const n = remapNode(node);
    others.set(p, node);
    if (n > 0) {
      remapped += n;
      touchedFiles += 1;
      await writeFile(p, JSON.stringify(node, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
    }
  }
  for (const [from, extra] of Object.entries(EXTRA_DELEGATES)) {
    const entry = [...others.entries()].find(([, n]) => n["@id"] === from);
    if (!entry) throw new Error(`위임 출발 조문 노드가 없음: ${from}`);
    const [p, node] = entry;
    const cur = (node.delegates as string[] | undefined) ?? [];
    if (extra.every((x) => cur.includes(x))) continue;
    node.delegates = [...cur, ...extra.filter((x) => !cur.includes(x))];
    await writeFile(p, JSON.stringify(node, null, 2) + "\n");
  }

  // 2. 고시 조문 노드 — 새 판 원문으로 다시 쓴다
  const known = new Set<string>([...others.values()].map((n) => n["@id"]));
  for (const a of articles) known.add(art(a.num));
  const inverse = (field: string, target: string): string[] =>
    [...others.values()].filter((n) => Array.isArray(n[field]) && (n[field] as string[]).includes(target)).map((n) => n["@id"]).sort();
  for (const p of oldArticleFiles) await unlink(p);
  for (const a of articles) {
    const iri = art(a.num);
    const src = oldNodes.get(ATTR_SOURCE[a.num]);
    const attrs = Object.fromEntries(ATTR_KEYS.filter((k) => src && src[k] !== undefined).map((k) => [k, src![k]]));
    const references = citations(a, known);
    const hasAnnex = [...new Set([...a.text.matchAll(/별지 제(\d+)호서식/g)].map((m) => `annex:${KEY}:서식${m[1]}`))];
    const legalBasisOf = inverse("legalBasis", iri);
    const regulates = inverse("regulatedBy", iri);
    const delegationOf = inverse("delegates", iri);
    const node = {
      "@context": "../../context.jsonld",
      "@id": iri,
      "@type": ["Article", "Legislation"],
      articleNumber: a.num,
      title: a.title,
      partOf: ACT_IRI,
      verificationStatus: "verified",
      _meta: {
        publishedBy: "법제처 국가법령정보센터 (자동 sync)",
        sourceUrl,
        fetchedAt: today,
        verifiedAt: today,
        verifiedBy: "법제처 lawService.do?target=admrul (자동 sync)",
        admRulId: NEW_ID,
        admRulNo: no,
        admRulKind: kind,
        licenseHint: LICENSE_HINT,
      },
      description: a.text,
      legislationIdentifier: name,
      legislationDate: issued,
      legislationType: "Notification",
      legislationLegalForce: "InForce",
      jurisdiction: "KR",
      temporalCoverage: `${effective}/..`,
      ...attrs,
      ...(references.length ? { references } : {}),
      ...(hasAnnex.length ? { hasAnnex } : {}),
      ...(legalBasisOf.length ? { legalBasisOf } : {}),
      ...(regulates.length ? { regulates } : {}),
      ...(delegationOf.length ? { delegationOf } : {}),
    };
    await writeFile(resolve(ARTICLES, `${KEY}-§${a.num}.jsonld`), JSON.stringify(node, null, 2) + "\n");
  }

  // 3. 법령 노드
  const actPath = resolve(NODES, "acts", "사업장위험성평가에관한지침.jsonld");
  const act = JSON.parse(await readFile(actPath, "utf8")) as Node;
  const actMeta = (act._meta ?? {}) as Record<string, unknown>;
  Object.assign(act, {
    legislationDate: effective,
    temporalCoverage: `${effective}/..`,
    alternativeNames: ["위험성평가 고시", `위험성평가 고시 (${no}호)`],
    hasArticle: articles.map((a) => art(a.num)),
    _meta: { ...actMeta, 행정규칙일련번호: NEW_ID, 발령번호: `고용노동부${kind} 제${no}호`, 발령일자: issued, 제개정구분: revision, fetchedAt: today },
  });
  await writeFile(actPath, JSON.stringify(act, null, 2) + "\n");

  // 4. 서식 노드 — 별지 제목과 그 서식을 정한 조
  const annexTitles = tags(xml, "별표제목");
  const annexKinds = tags(xml, "별표구분");
  const annexNos = tags(xml, "별표번호");
  for (let i = 0; i < annexTitles.length; i += 1) {
    if (annexKinds[i] !== "별지") continue;
    const n = Number(annexNos[i]);
    const p = resolve(NODES, "annexes", `${KEY}-서식${n}.jsonld`);
    const node = JSON.parse(await readFile(p, "utf8").catch(() => "null")) as Node | null;
    if (!node) throw new Error(`서식 노드가 없음: 서식${n}`);
    const by = articles.filter((a) => a.text.includes(`별지 제${n}호서식`)).map((a) => `제${a.num}조`);
    Object.assign(node, {
      title: `${name} 별지 제${n}호서식 — ${annexTitles[i]}`,
      description: `${name} [별지 제${n}호서식] ${annexTitles[i]} (${by.join("·")}에 따른 서식)`,
      verificationStatus: "verified",
      _meta: { ...((node._meta ?? {}) as Record<string, unknown>), publishedBy: "법제처 국가법령정보센터", sourceUrl, admRulId: NEW_ID, fetchedAt: today, licenseHint: LICENSE_HINT },
    });
    await writeFile(p, JSON.stringify(node, null, 2) + "\n");
  }

  // 5. 번들 고시 문서 — 원문 그대로(가운뎃점만 번들 문서 관례대로 ·), 조문은 모두 싣는다
  const reason = tags(xml, "제개정이유내용")
    .join("\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[가-하]\.\s/.test(l))
    .map((l) => `- ${l.replace(/ㆍ/g, "·")}`);
  const supplement = tags(xml, "부칙내용").join("\n").replace(/ㆍ/g, "·").trim();
  const appendix = annexTitles.map((t, i) => `- ${annexKinds[i] === "별표" ? "별표" : `별지 제${Number(annexNos[i])}호서식`}: ${t}`);
  let md = `# ${name} (고용노동부${kind} 제${no}호)\n\n`;
  md += `> **출처**: 법제처 국가법령정보센터 · 고용노동부\n`;
  md += `> **출처 URL**: https://www.law.go.kr/행정규칙/${name.replace(/\s/g, "")}\n`;
  md += `> **발령**: ${issued} (${revision}, 행정규칙일련번호 ${NEW_ID})\n`;
  md += `> **현행**: 고용노동부${kind} 제${no}호 (발령 ${issued}, ${revision})\n`;
  md += `> **시행일**: **${effective}** (현행)\n`;
  md += `> **이전 판**: 제2024-76호 (2025-01-02 시행) — 전부개정으로 조 번호가 바뀌었다\n`;
  md += `> **저작권**: 저작권법 §7 비보호 저작물 (고시)\n`;
  md += `> **마지막 동기화**: ${today} (법제처 lawService target=admrul 원문 — §1~§${articles[articles.length - 1].num} 전문 + 부칙)\n`;
  md += `> **근거 법령**: 산업안전보건법 §36, 같은 법 시행규칙 §37~§37의4\n`;
  md += `> **검토 필요 여부**: **완료 (${articles.length}조문 전문 법제처 원문 수록)** — 법제처 행정규칙 원문에서 그대로 옮겼다(가운뎃점만 ·로 표기)\n`;
  md += `> **다음 검토 권장**: 2027-04-26 (연 1회 정기 — 고시 개정은 판본 점검이 매주 확인)\n\n`;
  md += `**개정 이유(고시 원문의 제·개정 이유)**: 「산업안전보건법」 제36조 및 같은 법 시행규칙 개정에 따라 위험성평가의 방법·절차·시기 등에 관한 세부사항을 정비\n\n`;
  md += `**주요 내용**\n\n${reason.join("\n")}\n\n---\n`;
  let chapter = "";
  for (const a of articles) {
    if (a.chapter !== chapter) {
      chapter = a.chapter;
      md += `\n## ${chapter.replace(/\s+/g, " ")}\n`;
    }
    md += `\n${articleMarkdown(a)}`;
  }
  md += `\n---\n\n## 부칙\n\n${supplement}\n\n---\n\n## 별표·별지 목록\n\n${appendix.join("\n")}\n\n별표·별지 서식 원문은 법제처 국가법령정보센터에서 받을 수 있다.\n`;
  await writeFile(resolve(LAWS, NEW_MD), md);
  await unlink(resolve(LAWS, OLD_MD)).catch(() => undefined);

  console.log(`옛 참조 ${remapped}건 옮김 (노드 ${touchedFiles}개) · 고시 조문 노드 ${oldArticleFiles.length} → ${articles.length} · 장 ${chapters.length} · 번들 문서 ${NEW_MD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
