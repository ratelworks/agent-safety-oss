#!/usr/bin/env tsx
/**
 * check-law-editions.ts — 번들 법령 판본(MST) 점검
 *
 * 날짜(마지막 동기화)가 아니라 판본을 비교한다:
 *   1. 번들 판본 = 법령 파일 머리말의 MST + 조문 노드 _meta.lawServiceMST
 *   2. 법제처 현행 판 = lawSearch.do (target=law) 의 법령일련번호
 *   3. 법제처 시행예정 = lawSearch.do (target=eflaw) 중 현행연혁코드 '시행예정'
 *
 * 결과
 *   - 번들 판본 ≠ 현행 판 → 낡음(exit 1)
 *   - 시행예정 개정은 시행일 순으로 안내만 (exit 에 영향 없음)
 *   - LAW_OC 가 없으면 점검을 건너뛴다고 출력하고 exit 0
 *
 * 사용: LAW_OC=... npm run check:law-editions   (--json 이면 JSON 출력)
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const LAWS_DIR = resolve(ROOT, "src", "ontology", "safety-laws");
const ARTICLES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do";

/** 번들 법령 — 파일·정식 법령명·조문 노드 접두(canonical) */
export const BUNDLED_LAWS = [
  { file: "산업안전보건법.md", name: "산업안전보건법", canonical: "산안법" },
  { file: "산업안전보건법-시행령.md", name: "산업안전보건법 시행령", canonical: "산안법시행령" },
  { file: "산업안전보건법-시행규칙.md", name: "산업안전보건법 시행규칙", canonical: "산안법시행규칙" },
  { file: "산업안전보건기준에-관한-규칙.md", name: "산업안전보건기준에 관한 규칙", canonical: "기준규칙" },
  { file: "중대재해처벌법.md", name: "중대재해 처벌 등에 관한 법률", canonical: "중처법" },
  { file: "중대재해처벌법-시행령.md", name: "중대재해 처벌 등에 관한 법률 시행령", canonical: "중처법시행령" },
  { file: "건설기술진흥법.md", name: "건설기술 진흥법", canonical: "건진법" },
  { file: "건설기술진흥법-시행령.md", name: "건설기술 진흥법 시행령", canonical: "건진법시행령" },
  { file: "건설기술진흥법-시행규칙.md", name: "건설기술 진흥법 시행규칙", canonical: "건진법시행규칙" },
] as const;

interface SearchEntry {
  mst: string;
  status: string; // 현행 | 시행예정 | 연혁
  name: string;
  promulgationNo: string;
  promulgationDate: string;
  effectiveDate: string;
  kind: string;
}

export interface EditionResult {
  name: string;
  file: string;
  bundleMST: string | null;
  nodeMSTs: Record<string, number>;
  current: SearchEntry | null;
  pending: SearchEntry[];
  status: "현행" | "낡음" | "조회 실패" | "판본 표지 없음";
  notes: string[];
}

// ── 번들 판본 읽기 ───────────────────────────────────────────────────
/** 법령 파일 머리말(첫 '---' 전)에서 MST 를 찾는다 */
export function extractHeaderMST(md: string): string | null {
  const header = md.split(/\n---\n/, 1)[0];
  const m = header.match(/MST\s*=?\s*(\d{5,7})/);
  return m ? m[1] : null;
}

async function nodeMSTsByCanonical(): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  for (const f of await readdir(ARTICLES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(ARTICLES_DIR, f), "utf8")) as {
      "@id": string;
      _meta?: { lawServiceMST?: string };
    };
    const canonical = node["@id"].split(":")[1];
    const mst = node._meta?.lawServiceMST ?? "(표지 없음)";
    const counts = out.get(canonical) ?? {};
    counts[mst] = (counts[mst] ?? 0) + 1;
    out.set(canonical, counts);
  }
  return out;
}

// ── 법제처 조회 ──────────────────────────────────────────────────────
function toDate(yyyymmdd: string): string {
  return /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6)}` : yyyymmdd;
}

export function parseSearchXml(xml: string): SearchEntry[] {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, isArray: (n) => n === "law" });
  const root = parser.parse(xml)?.LawSearch;
  if (!root) throw new Error("검색 응답이 법령 목록이 아님(인증키·신청 범위 확인)");
  return (root.law ?? []).map((l: Record<string, unknown>) => ({
    mst: String(l.법령일련번호 ?? ""),
    status: String(l.현행연혁코드 ?? ""),
    name: String(l.법령명한글 ?? "").trim(),
    promulgationNo: String(l.공포번호 ?? "").replace(/^0+/, ""),
    promulgationDate: toDate(String(l.공포일자 ?? "")),
    effectiveDate: toDate(String(l.시행일자 ?? "")),
    kind: String(l.법령구분명 ?? ""),
  }));
}

async function search(oc: string, target: "law" | "eflaw", query: string): Promise<SearchEntry[]> {
  const params = new URLSearchParams({ OC: oc, target, type: "XML", query, display: "100" });
  const res = await fetch(`${SEARCH_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseSearchXml(await res.text());
}

/** 번들 판본과 현행·시행예정 목록을 비교한다 (네트워크 없이 시험할 수 있게 분리) */
export function judgeEdition(
  law: (typeof BUNDLED_LAWS)[number],
  bundleMST: string | null,
  nodeMSTs: Record<string, number>,
  currentList: SearchEntry[],
  eflawList: SearchEntry[],
): EditionResult {
  const notes: string[] = [];
  const current = currentList.find((e) => e.name === law.name && e.status === "현행") ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const pending = eflawList
    .filter((e) => e.name === law.name && e.status === "시행예정" && e.effectiveDate > today)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const base = { name: law.name, file: law.file, bundleMST, nodeMSTs, current, pending, notes };
  if (!current) return { ...base, status: "조회 실패" };
  if (!bundleMST) return { ...base, status: "판본 표지 없음" };
  const staleNodes = Object.entries(nodeMSTs).filter(([mst]) => mst !== current.mst);
  for (const [mst, n] of staleNodes) notes.push(`조문 노드 ${n}건이 MST ${mst}`);
  const stale = bundleMST !== current.mst || staleNodes.some(([mst]) => mst !== "(표지 없음)");
  return { ...base, status: stale ? "낡음" : "현행" };
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

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json");
  await loadEnv();
  const oc = process.env.LAW_OC;
  if (!oc) {
    // --require-key: 정기 점검에서는 인증키가 없으면 "점검하지 못함"을 실패로 알린다 (건너뛴 것을 통과로 보이지 않게)
    if (process.argv.includes("--require-key")) {
      console.error("❌ LAW_OC 가 없어 법령 판본을 점검하지 못했습니다 — 저장소 비밀값 LAW_OC 에 법제처 OpenAPI 인증키를 넣으세요.");
      process.exit(2);
    }
    console.log(
      "[skip] LAW_OC 환경 변수가 없어 법령 판본 점검을 건너뜁니다 — 법제처 OpenAPI 인증키(open.law.go.kr)를 LAW_OC 로 설정하면 번들 판본을 현행·시행예정 판과 비교합니다.",
    );
    return;
  }

  const nodeMap = await nodeMSTsByCanonical();
  const results: EditionResult[] = [];
  for (const law of BUNDLED_LAWS) {
    const md = await readFile(resolve(LAWS_DIR, law.file), "utf8");
    const bundleMST = extractHeaderMST(md);
    try {
      const [currentList, eflawList] = await Promise.all([search(oc, "law", law.name), search(oc, "eflaw", law.name)]);
      results.push(judgeEdition(law, bundleMST, nodeMap.get(law.canonical) ?? {}, currentList, eflawList));
    } catch (err) {
      results.push({
        name: law.name,
        file: law.file,
        bundleMST,
        nodeMSTs: nodeMap.get(law.canonical) ?? {},
        current: null,
        pending: [],
        status: "조회 실패",
        notes: [(err as Error).message],
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  } else {
    console.log("# 번들 법령 판본 점검 (법제처 현행·시행예정 판과 비교)\n");
    for (const r of results) {
      const sym = r.status === "현행" ? "✅" : r.status === "낡음" ? "❌" : "⚠️";
      const cur = r.current
        ? `현행 MST ${r.current.mst} (${r.current.kind} 제${r.current.promulgationNo}호, 시행 ${r.current.effectiveDate})`
        : "현행 판 조회 실패";
      console.log(`${sym} ${r.name} — 번들 MST ${r.bundleMST ?? "(없음)"} / ${cur} → ${r.status}`);
      for (const n of r.notes) console.log(`    · ${n}`);
      for (const p of r.pending) {
        console.log(`    · 시행예정 ${p.effectiveDate} — 제${p.promulgationNo}호 (공포 ${p.promulgationDate}, MST ${p.mst})`);
      }
    }
  }
  const stale = results.filter((r) => r.status === "낡음");
  const failed = results.filter((r) => r.status !== "현행" && r.status !== "낡음");
  console.log(
    `\n요약: 현행 ${results.length - stale.length - failed.length} · 낡음 ${stale.length} · 조회 실패/표지 없음 ${failed.length} · 시행예정 ${results.reduce((s, r) => s + r.pending.length, 0)}건`,
  );
  if (stale.length > 0) process.exit(1);
  // 정기 점검에서는 조회 실패·표지 없음도 "확인하지 못함"으로 실패시킨다
  if (failed.length > 0 && process.argv.includes("--require-key")) {
    console.error(`❌ ${failed.length}개 법령의 판본을 확인하지 못했습니다 (조회 실패 또는 표지 없음)`);
    process.exit(3);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
