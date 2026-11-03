#!/usr/bin/env tsx
/**
 * reconcile-article-editions.ts
 *
 * 산업안전보건법·시행령·시행규칙·안전보건규칙 조문 노드 전체를 법제처 현행 판과 대조한다.
 *
 *   - 본문이 같으면(표기 차이 정규화 후) 판본 표지(_meta.lawServiceMST·검증일)만 현행으로 바꾼다.
 *   - 다르면 본문(description)을 현행 원문으로 바꾼다.
 *   - 대조를 통과한 노드는 needsVerification 을 내리고 bodySource 를 실제 출처로 고친다.
 *   - 조문별 결과(같음/교체/조회 실패)를 기록 파일로 남긴다.
 *
 * 개발자 전용 스크립트 (LAW_OC 환경 변수 필요 — 없으면 건너뛴다고 출력하고 exit 0).
 *
 * 사용:
 *   LAW_OC=... tsx scripts/sync/reconcile-article-editions.ts            # 대조 + 노드 갱신 + 기록
 *   LAW_OC=... tsx scripts/sync/reconcile-article-editions.ts --dry-run  # 기록만, 노드는 그대로
 *   --cache <dir>  : 받은 XML 을 dir 에 저장·재사용 (같은 판을 여러 번 받지 않기)
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const REPORT_DIR = resolve(ROOT, "reports", "law-freshness");
const REPORT_JSON = resolve(REPORT_DIR, "article-editions.json");
const REPORT_MD = resolve(REPORT_DIR, "article-editions.md");
const BUNDLE_DIR = resolve(ROOT, "src", "ontology", "safety-laws");
const LAW_BASE = "https://www.law.go.kr/DRF/lawService.do";

/** 대조 대상 4종 — 현행 판(MST)과 그 판의 현행 시행일(efYd). 시행예정분이 섞이지 않도록 efYd 를 지정한다. */
export const EDITIONS = [
  {
    canonical: "산안법",
    bundleFile: "산업안전보건법.md",
    name: "산업안전보건법",
    mst: "291447",
    efYd: "20261027",
    lawId: "001766",
    label: "법률 제22122호",
  },
  {
    canonical: "산안법시행령",
    bundleFile: "산업안전보건법-시행령.md",
    name: "산업안전보건법 시행령",
    mst: "288347",
    efYd: "20260801",
    lawId: "003786",
    label: "대통령령 제36540호",
  },
  {
    canonical: "산안법시행규칙",
    bundleFile: "산업안전보건법-시행규칙.md",
    name: "산업안전보건법 시행규칙",
    mst: "288431",
    efYd: "20260801",
    lawId: "007364",
    label: "고용노동부령 제477호",
  },
  {
    canonical: "기준규칙",
    bundleFile: "산업안전보건기준에-관한-규칙.md",
    name: "산업안전보건기준에 관한 규칙",
    mst: "273603",
    efYd: "20260302",
    lawId: "007363",
    label: "고용노동부령 제450호",
  },
] as const;

type Edition = (typeof EDITIONS)[number];

// ── 원문 구조 ────────────────────────────────────────────────────────
interface Mok {
  text: string;
}
interface Ho {
  num: string; // "1" "2의2"
  text: string;
  moks: Mok[];
}
interface Hang {
  num: string; // "1" (① → 1)
  text: string;
  hos: Ho[];
}
interface ArticleSrc {
  number: string; // "38" / "175의2"
  title: string;
  head: string; // 조문내용 (제N조(제목) ...)
  hangs: Hang[];
  effective: string; // 조문시행일자
  note: string; // 조문참고자료 — 옮겨 간 자리("[종전 제N조는 …로 이동]")만 본문으로 쓴다
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object" && v !== null && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"]).trim();
  }
  return String(v).trim();
}

/** 항·호·목 내용은 문자열 또는 문자열 배열(줄 단위)로 온다 */
function joinText(v: unknown): string {
  return arr(v as unknown)
    .map((x) => str(x))
    .filter(Boolean)
    .join("\n");
}

export function parseLawXml(xml: string): Map<string, ArticleSrc> {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => ["조문단위", "항", "호", "목"].includes(name),
  });
  const parsed = parser.parse(xml);
  const root = parsed.법령;
  const out = new Map<string, ArticleSrc>();
  if (!root) return out;
  for (const jo of arr(root.조문?.조문단위)) {
    if (!jo || str(jo.조문여부) !== "조문") continue;
    const no = str(jo.조문번호);
    const gaji = str(jo.조문가지번호);
    if (!no) continue;
    const number = gaji && gaji !== "0" ? `${no}의${gaji}` : no;
    const hangs: Hang[] = [];
    let implicitHang = 0;
    for (const h of arr(jo.항)) {
      const rawNum = str(h.항번호);
      const ci = CIRCLED.indexOf(rawNum.charAt(0));
      const num = ci >= 0 ? String(ci + 1) : rawNum ? rawNum.replace(/\D/g, "") : String(++implicitHang);
      const hos: Ho[] = [];
      for (const ho of arr(h.호)) {
        const hoNum = str(ho.호번호).replace(/\.$/, "");
        hos.push({
          num: hoNum,
          text: joinText(ho.호내용),
          moks: arr(ho.목).map((m: Record<string, unknown>) => ({ text: joinText(m.목내용) })),
        });
      }
      hangs.push({ num, text: joinText(h.항내용), hos });
    }
    out.set(number, {
      number,
      title: str(jo.조문제목),
      head: joinText(jo.조문내용),
      hangs,
      effective: str(jo.조문시행일자),
      note: joinText(jo.조문참고자료),
    });
  }
  return out;
}

function renderHo(ho: Ho): string[] {
  const lines = [ho.text];
  for (const m of ho.moks) if (m.text) lines.push(m.text);
  return lines.filter(Boolean);
}

function renderHang(h: Hang): string[] {
  const lines = h.text ? [h.text] : [];
  for (const ho of h.hos) lines.push(...renderHo(ho));
  return lines;
}

/** 조문 전체 원문 — "제N조(제목)\n① ...\n1. ...\n가. ..." */
export function renderArticle(a: ArticleSrc): string {
  const lines = a.head ? [a.head] : [];
  for (const h of a.hangs) lines.push(...renderHang(h));
  // 제목·항 없이 번호만 남은 자리(다른 조로 이동)는 참고자료의 이동 안내가 본문이다
  if (!a.title && a.hangs.length === 0 && /이동/.test(a.note)) lines.push(a.note);
  return lines.filter(Boolean).join("\n");
}

/** 표기 차이(굵게·띄어쓰기·가운뎃점 모양·개정 꼬리표)를 지운 비교용 문자열 */
export function normalizeForCompare(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/<(개정|신설|본조신설|전문개정|삭제|제목개정|종전)[^>]*>/g, "")
    .replace(/\[(본조신설|전문개정|제목개정|종전|시행일)[^\]]*\]/g, "")
    .replace(/[ㆍ·∙•]/g, "·")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, "")
    .trim();
}

// ── 노드 대상 해석 ───────────────────────────────────────────────────
interface Target {
  article: string;
  hang?: string;
  ho?: string;
}

/** articleNumber "29" / "29(2)" / "64(1)5" 를 조·항·호로 해석 */
export function parseArticleNumber(articleNumber: string): Target | null {
  const m = articleNumber.match(/^(\d+(?:의\d+)?)(?:\((\d+)\))?(\d+(?:의\d+)?)?$/);
  if (!m) return null;
  return { article: m[1], hang: m[2], ho: m[3] };
}

function resolveBody(src: ArticleSrc, t: Target): string | null {
  if (!t.hang) return renderArticle(src);
  const hang = src.hangs.find((h) => h.num === t.hang);
  if (!hang) return null;
  if (!t.ho) return renderHang(hang).join("\n");
  const ho = hang.hos.find((x) => x.num === t.ho);
  if (!ho) return null;
  return renderHo(ho).join("\n");
}

/** 삭제된 조문("제N조 삭제 <…>") 또는 다른 조로 옮겨 간 자리("제N조\n[종전 제N조는 …로 이동 …]") */
export function isRepealedText(body: string): boolean {
  const t = body.trim();
  return /^제\d+조(의\d+)?\s*삭제/.test(t) || /^제\d+조(의\d+)?\s*\[종전[^\]]*이동/.test(t);
}

/** 옛 본문 앞머리에 "제N조(제목)" 가 두 번 실린 경우(옛 동기화 결함)를 걷어낸 비교 문자열 */
function stripDuplicatedHead(normalized: string): string {
  const m = normalized.match(/^(제\d+조(?:의\d+)?\([^)]*\))\1/);
  return m ? normalized.slice(m[1].length) : normalized;
}

// ── 실행 ────────────────────────────────────────────────────────────
async function loadEnv(): Promise<void> {
  try {
    const txt = await readFile(resolve(ROOT, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // .env 없음
  }
}

async function fetchEdition(ed: Edition, oc: string, cacheDir: string | null): Promise<string> {
  const cachePath = cacheDir ? resolve(cacheDir, `${ed.mst}-${ed.efYd}.xml`) : null;
  if (cachePath && existsSync(cachePath)) return readFile(cachePath, "utf8");
  const params = new URLSearchParams({ OC: oc, target: "eflaw", type: "XML", MST: ed.mst, efYd: ed.efYd });
  const res = await fetch(`${LAW_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!xml.includes("<법령")) throw new Error("법령 XML 아님(인증키·판 번호 확인)");
  if (cachePath) {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, xml, "utf8");
  }
  return xml;
}

type Outcome = "같음" | "교체" | "조회 실패";
interface ResultRow {
  id: string;
  file: string;
  outcome: Outcome;
  detail?: string;
  reason?: string;
  previousMST?: string;
  titleChanged?: { from: string; to: string };
  legalForceChanged?: { from: string; to: string };
}

// ── 번들 법령 본문(safety-laws/*.md) 대조 ─────────────────────────────
interface BundleRow {
  law: string;
  article: string;
  outcome: "같음" | "다름" | "조회 실패";
  bundle?: string;
  current?: string;
}

/** "## §N 제목" 절에서 법령 문장 줄(①…, 1., 가., 또는 항 없는 조문의 첫 문단)만 뽑는다 — 해설·관련 표기는 제외 */
export function extractBundleLawText(section: string): string {
  const lines = section.split("\n").map((l) => l.trim());
  const law: string[] = [];
  for (const l of lines) {
    if (!l || l.startsWith("##") || l.startsWith("**") || l.startsWith(">") || l.startsWith("---") || l.startsWith("|")) continue;
    if (/^[①-⑳]/.test(l) || /^\d+(의\d+)?\.\s/.test(l) || /^[가-하]\.\s/.test(l) || /^\d+\)\s/.test(l)) law.push(l);
    else if (law.length === 0 && !/^[※⚠]/.test(l)) law.push(l);
  }
  return law.join("\n");
}

/** 조문 머리("제N조(제목)")를 뺀 본문 */
function bodyWithoutHead(a: ArticleSrc): string {
  const full = renderArticle(a);
  return full.replace(/^제\d+조(의\d+)?(\([^)]*\))?\s*/, "");
}

async function compareBundles(sources: Map<string, Map<string, ArticleSrc>>): Promise<BundleRow[]> {
  const rows: BundleRow[] = [];
  for (const ed of EDITIONS) {
    const src = sources.get(ed.canonical);
    const md = await readFile(resolve(BUNDLE_DIR, ed.bundleFile), "utf8");
    const parts = md.split(/^(?=## §)/m).filter((p) => p.startsWith("## §"));
    for (const part of parts) {
      const head = part.split("\n", 1)[0];
      const m = head.match(/^## §(\d+(?:의\d+)?)\s+(.*)$/);
      if (!m || /\[별표/.test(m[2])) continue; // 별표 절은 조문 대조 대상 아님
      const article = src?.get(m[1]);
      if (!article) {
        rows.push({ law: ed.name, article: m[1], outcome: "조회 실패" });
        continue;
      }
      const bundle = extractBundleLawText(part);
      const current = bodyWithoutHead(article);
      const same = normalizeForCompare(bundle) === normalizeForCompare(current);
      rows.push(same ? { law: ed.name, article: m[1], outcome: "같음" } : { law: ed.name, article: m[1], outcome: "다름", bundle, current });
    }
  }
  return rows;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const cacheIdx = args.indexOf("--cache");
  const cacheDir = cacheIdx >= 0 ? resolve(args[cacheIdx + 1]) : null;
  const today = new Date().toISOString().slice(0, 10);

  await loadEnv();
  const oc = process.env.LAW_OC;
  if (!oc) {
    console.log("[skip] LAW_OC 환경 변수가 없어 조문 판본 대조를 건너뜁니다 (법제처 OpenAPI 인증키 필요).");
    return;
  }

  const sources = new Map<string, Map<string, ArticleSrc>>();
  for (const ed of EDITIONS) {
    process.stdout.write(`[fetch] ${ed.name} MST=${ed.mst} efYd=${ed.efYd} ... `);
    try {
      const map = parseLawXml(await fetchEdition(ed, oc, cacheDir));
      sources.set(ed.canonical, map);
      console.log(`조문 ${map.size}`);
    } catch (err) {
      console.log(`실패: ${(err as Error).message}`);
    }
  }

  const rows: ResultRow[] = [];
  const files = (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".jsonld")).sort();
  for (const file of files) {
    const path = resolve(ARTICLES_DIR, file);
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      "@id": string;
      _meta?: Record<string, unknown>;
    };
    const idm = node["@id"].match(/^art:([^:]+):/);
    const ed = idm ? EDITIONS.find((e) => e.canonical === idm[1]) : undefined;
    if (!ed) continue;

    const meta = (node._meta ?? {}) as Record<string, unknown>;
    const row: ResultRow = { id: node["@id"], file, outcome: "조회 실패" };
    if (meta.lawServiceMST) row.previousMST = String(meta.lawServiceMST);
    rows.push(row);

    const src = sources.get(ed.canonical);
    if (!src) {
      row.reason = "현행 판 원문을 받지 못함";
      continue;
    }
    const target = parseArticleNumber(String(node.articleNumber ?? ""));
    if (!target) {
      row.reason = `조문 번호 해석 불가: ${String(node.articleNumber)}`;
      continue;
    }
    const article = src.get(target.article);
    if (!article) {
      row.reason = `현행 판에 제${target.article}조 없음`;
      continue;
    }
    const current = resolveBody(article, target);
    if (current === null) {
      row.reason = `현행 판 제${target.article}조에 해당 항·호 없음`;
      continue;
    }

    const before = String(node.description ?? "");
    const nBefore = normalizeForCompare(before);
    const nCurrent = normalizeForCompare(current);
    const same = nBefore === nCurrent;
    row.outcome = same ? "같음" : "교체";
    if (!same) {
      row.detail = stripDuplicatedHead(nBefore) === nCurrent ? "머리 중복 표기 정리(문구 같음)" : "문구 다름";
      node.description = current;
      meta.bodyLength = current.length;
    }

    // 조문 단위 노드의 제목·효력 표지 정합
    if (!target.hang) {
      const repealed = isRepealedText(current);
      const force = repealed ? "Repealed" : "InForce";
      if (node.legislationLegalForce && node.legislationLegalForce !== force) {
        row.legalForceChanged = { from: String(node.legislationLegalForce), to: force };
        node.legislationLegalForce = force;
      }
      if (
        !repealed &&
        article.title &&
        normalizeForCompare(String(node.title ?? "")) !== normalizeForCompare(article.title)
      ) {
        row.titleChanged = { from: String(node.title ?? ""), to: article.title };
        node.title = article.title;
      }
    }

    delete meta.needsVerification;
    meta.bodySource = `법제처 국가법령정보센터 현행 원문 (${ed.label}, MST ${ed.mst})`;
    meta.lawServiceMST = ed.mst;
    meta.lawServiceLawId = ed.lawId;
    meta.verifiedAt = today;
    meta.verifiedBy = `법제처 lawService.do (target=eflaw, MST=${ed.mst}, efYd=${ed.efYd}) 원문 대조`;
    node._meta = meta;
    node.verificationStatus = "verified";
    if (!dryRun) await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
  }

  const bundleRows = await compareBundles(sources);

  // ── 기록 ──
  const summary: Record<string, Record<Outcome, number>> = {};
  for (const ed of EDITIONS) summary[ed.canonical] = { 같음: 0, 교체: 0, "조회 실패": 0 };
  for (const r of rows) {
    const c = r.id.split(":")[1];
    summary[c][r.outcome] += 1;
  }
  const report = {
    checkedAt: today,
    editions: EDITIONS,
    rule: "표기 차이(굵게·띄어쓰기·가운뎃점 모양·<개정> 꼬리표)를 지운 뒤 글자 단위로 같으면 '같음'(판본 표지만 갱신), 다르면 '교체'(본문을 현행 원문으로), 현행 판에서 해당 조·항·호를 찾지 못하면 '조회 실패'",
    dryRun,
    summary,
    results: rows,
    bundle: bundleRows,
  };
  if (dryRun) {
    // dry-run 은 기록 파일을 덮어쓰지 않는다 (실제 반영 기록 보존)
    printSummary(summary, bundleRows, rows.length, true);
    return;
  }
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");

  const md: string[] = [
    "# 조문 노드 판본 대조 기록",
    "",
    `- 대조일: ${today}`,
    `- 기준: ${report.rule}`,
    "",
    "| 법령 | 현행 판 | 같음 | 교체 | 조회 실패 |",
    "|------|--------|----:|----:|--------:|",
    ...EDITIONS.map(
      (e) =>
        `| ${e.name} | ${e.label} (MST ${e.mst}, 시행 ${e.efYd}) | ${summary[e.canonical]["같음"]} | ${summary[e.canonical]["교체"]} | ${summary[e.canonical]["조회 실패"]} |`,
    ),
    "",
    "## 교체·조회 실패·표지 변경 조문",
    "",
    "| 조문 | 결과 | 비고 |",
    "|------|------|------|",
    ...rows
      .filter((r) => r.outcome !== "같음" || r.titleChanged || r.legalForceChanged)
      .map((r) => {
        const notes = [
          r.detail,
          r.reason,
          r.titleChanged ? `제목 '${r.titleChanged.from}' → '${r.titleChanged.to}'` : "",
          r.legalForceChanged ? `효력 ${r.legalForceChanged.from} → ${r.legalForceChanged.to}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return `| ${r.id} | ${r.outcome} | ${notes} |`;
      }),
    "",
    "## 번들 법령 본문(safety-laws) 대조",
    "",
    "| 법령 | 조문 | 결과 |",
    "|------|------|------|",
    ...bundleRows.map((b) => `| ${b.law} | 제${b.article}조 | ${b.outcome} |`),
    "",
    "조문별 전체 결과는 같은 폴더의 `article-editions.json` 에 있습니다.",
    "",
  ];
  await writeFile(REPORT_MD, md.join("\n"), "utf8");

  printSummary(summary, bundleRows, rows.length, false);
}

function printSummary(
  summary: Record<string, Record<Outcome, number>>,
  bundleRows: BundleRow[],
  total: number,
  dryRun: boolean,
): void {
  for (const ed of EDITIONS) {
    const c = summary[ed.canonical];
    console.log(`${ed.name}: 같음 ${c["같음"]} · 교체 ${c["교체"]} · 조회 실패 ${c["조회 실패"]}`);
  }
  const bd = bundleRows.filter((b) => b.outcome !== "같음");
  console.log(
    `번들 본문: ${bundleRows.length}조 중 같음 ${bundleRows.length - bd.length}${bd.length ? ` · 다름/실패 ${bd.map((b) => `${b.law} 제${b.article}조`).join(", ")}` : ""}`,
  );
  console.log(
    `총 ${total}건 — ${dryRun ? "dry-run: 노드·기록 파일 미변경" : "기록: reports/law-freshness/article-editions.{json,md}"}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
