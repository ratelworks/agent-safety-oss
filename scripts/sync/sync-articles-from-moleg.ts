#!/usr/bin/env tsx
/**
 * sync-articles-from-moleg.ts
 *
 * 법제처 OpenAPI lawService.do(target=eflaw|admrul) → 7종 법령/고시 XML 다운로드 →
 * 조문 본문 추출 → src/ontology/graph/nodes/articles/*.jsonld 의 stub 노드 description 채움 + verified 승급.
 *
 * 개발자 전용 스크립트 (LAW_OC 환경 변수 필요). 외부 사용자 런타임 불필요.
 *
 * 7종 매핑 (MST/ID):
 *   산안법 276853 / 시행령 284771 / 시행규칙 271485 / 기준규칙 273603
 *   중처법 228817 / 중처법시행령 277417 / 위험성평가-고시 admrul ID=2100000251014
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const ANNEXES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "annexes");

// .env 직접 로드 (외부 dotenv 의존 없이)
async function loadEnv(): Promise<void> {
  try {
    const envPath = resolve(ROOT, ".env");
    const txt = await readFile(envPath, "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // .env 없음 — process.env 만 사용
  }
}

const LAW_BASE = "https://www.law.go.kr/DRF/lawService.do";

interface LawMeta {
  canonical: string;
  target: "eflaw" | "admrul";
  mst?: string;
  id?: string;
}

const LAWS: LawMeta[] = [
  { canonical: "산안법", target: "eflaw", mst: "276853" },
  { canonical: "산안법시행령", target: "eflaw", mst: "284771" },
  { canonical: "산안법시행규칙", target: "eflaw", mst: "271485" },
  { canonical: "기준규칙", target: "eflaw", mst: "273603" },
  { canonical: "중처법", target: "eflaw", mst: "228817" },
  { canonical: "중처법시행령", target: "eflaw", mst: "277417" },
  { canonical: "위험성평가-고시", target: "admrul", id: "2100000251014" },
];

async function fetchLawXml(law: LawMeta, oc: string): Promise<string> {
  const params = new URLSearchParams({ OC: oc, target: law.target, type: "XML" });
  if (law.mst) params.set("MST", law.mst);
  if (law.id) params.set("ID", law.id);
  const url = `${LAW_BASE}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${law.canonical} ${res.status}`);
  return await res.text();
}

interface ArticleBody {
  number: string; // "38" 또는 "175의2"
  title: string;
  body: string;
}

interface AnnexBody {
  number: string; // "별표4" 등
  title: string;
  body: string;
}

function extractArticles(xml: string): { articles: ArticleBody[]; annexes: AnnexBody[] } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => ["조문단위", "별표단위", "항", "호", "목"].includes(name),
  });
  const parsed = parser.parse(xml);

  const articles: ArticleBody[] = [];
  const annexes: AnnexBody[] = [];

  // eflaw root: 법령. admrul root: AdmRulService
  const root = parsed.법령 ?? parsed.AdmRulService;
  if (!root) return { articles, annexes };

  // 조문 추출
  const 조문List = root.조문?.조문단위 ?? [];
  const 조문Arr = Array.isArray(조문List) ? 조문List : [조문List];
  for (const jo of 조문Arr) {
    if (!jo) continue;
    const 여부 = jo.조문여부;
    const 번호 = String(jo.조문번호 ?? "").trim();
    const 가지번호 = String(jo.조문가지번호 ?? "").trim();
    if (여부 !== "조문") continue;
    if (!번호) continue;

    const number = 가지번호 && 가지번호 !== "0" ? `${번호}의${가지번호}` : 번호;
    const title = String(jo.조문제목 ?? "").trim();
    const bodyParts: string[] = [];
    if (jo.조문내용) bodyParts.push(String(jo.조문내용).trim());
    const 항Arr = Array.isArray(jo.항) ? jo.항 : jo.항 ? [jo.항] : [];
    for (const h of 항Arr) {
      if (!h) continue;
      if (h.항내용) bodyParts.push(String(h.항내용).trim());
      const 호Arr = Array.isArray(h.호) ? h.호 : h.호 ? [h.호] : [];
      for (const ho of 호Arr) {
        if (ho?.호내용) bodyParts.push(String(ho.호내용).trim());
      }
    }
    articles.push({ number, title, body: bodyParts.filter(Boolean).join("\n") });
  }

  // admrul (행정규칙) — 조문내용 평면 배열
  if (parsed.AdmRulService) {
    const arr = parsed.AdmRulService.조문내용;
    const 조문List2 = Array.isArray(arr) ? arr : arr ? [arr] : [];
    let curIdx = 0;
    for (const text of 조문List2) {
      const t = String(text ?? "").trim();
      if (!t) continue;
      const m = t.match(/^제(\d+)조(?:의(\d+))?\s*\(([^)]+)\)\s*([\s\S]*)$/);
      if (m) {
        const number = m[2] ? `${m[1]}의${m[2]}` : m[1];
        articles.push({ number, title: m[3].trim(), body: m[4].trim() });
        curIdx += 1;
      }
    }
  }

  // 별표 추출
  const 별표List = root.별표?.별표단위 ?? [];
  const 별표Arr = Array.isArray(별표List) ? 별표List : [별표List];
  for (const byl of 별표Arr) {
    if (!byl) continue;
    const num = String(byl.별표번호 ?? "").trim();
    if (!num) continue;
    const cleanNum = num.replace(/^0+/, "") || "0";
    const title = String(byl.별표제목 ?? "").trim();
    const body = String(byl.별표내용 ?? "").trim();
    annexes.push({ number: `별표${cleanNum}`, title, body });
  }

  return { articles, annexes };
}

async function processStubs(
  dir: string,
  kind: "Article" | "Annex",
  byCanonical: Map<string, { articles: ArticleBody[]; annexes: AnnexBody[] }>,
): Promise<{ promoted: number; missing: number; alreadyVerified: number }> {
  const entries = await readdir(dir);
  let promoted = 0;
  let missing = 0;
  let alreadyVerified = 0;

  for (const file of entries) {
    if (!file.endsWith(".jsonld")) continue;
    const path = resolve(dir, file);
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      "@id": string;
      verificationStatus?: string;
      description?: string;
      title?: string;
      _meta?: Record<string, unknown>;
    };

    if (node.verificationStatus === "verified") {
      alreadyVerified += 1;
      continue;
    }

    const m = node["@id"].match(/^(art|annex):([^:]+):(.+)$/);
    if (!m) continue;
    const canonical = m[2];
    const tail = m[3];
    const lawData = byCanonical.get(canonical);
    if (!lawData) {
      missing += 1;
      continue;
    }

    if (kind === "Article") {
      const found = lawData.articles.find((a) => a.number === tail);
      if (!found) {
        missing += 1;
        continue;
      }
      node.description = found.body || node.description;
      if (found.title && (!node.title || String(node.title).includes("미확정"))) {
        node.title = found.title;
      }
      node.verificationStatus = "verified";
      const meta = (node._meta ?? {}) as Record<string, unknown>;
      node._meta = {
        ...meta,
        promotedAt: new Date().toISOString().slice(0, 10),
        bodySource: "법제처 lawService.do (자동 sync)",
        bodyLength: (found.body || "").length,
      };
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
      promoted += 1;
    } else if (kind === "Annex") {
      const m2 = tail.match(/^별표(\d+)/);
      if (!m2) continue;
      const found = lawData.annexes.find((a) => a.number === `별표${m2[1]}`);
      if (!found) {
        missing += 1;
        continue;
      }
      node.description = found.body || node.description;
      if (found.title && (!node.title || String(node.title).includes("미확정"))) {
        node.title = found.title;
      }
      node.verificationStatus = "verified";
      const meta = (node._meta ?? {}) as Record<string, unknown>;
      node._meta = {
        ...meta,
        promotedAt: new Date().toISOString().slice(0, 10),
        bodySource: "법제처 lawService.do (자동 sync)",
        bodyLength: (found.body || "").length,
      };
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
      promoted += 1;
    }
  }

  return { promoted, missing, alreadyVerified };
}

(async () => {
  await loadEnv();
  const oc = process.env.LAW_OC;
  if (!oc) {
    console.error("LAW_OC 환경 변수 필요. .env 또는 export LAW_OC=...");
    process.exit(2);
  }

  const byCanonical = new Map<string, { articles: ArticleBody[]; annexes: AnnexBody[] }>();
  for (const law of LAWS) {
    process.stdout.write(`[fetch] ${law.canonical} ... `);
    try {
      const xml = await fetchLawXml(law, oc);
      const data = extractArticles(xml);
      byCanonical.set(law.canonical, data);
      console.log(`articles=${data.articles.length}, annexes=${data.annexes.length}`);
    } catch (err) {
      console.log(`fail: ${(err as Error).message}`);
    }
  }

  console.log("\n# Article stub 승급");
  const ar = await processStubs(ARTICLES_DIR, "Article", byCanonical);
  console.log(
    `  promoted=${ar.promoted}, missing=${ar.missing}, alreadyVerified=${ar.alreadyVerified}`,
  );

  console.log("\n# Annex stub 승급");
  const an = await processStubs(ANNEXES_DIR, "Annex", byCanonical);
  console.log(
    `  promoted=${an.promoted}, missing=${an.missing}, alreadyVerified=${an.alreadyVerified}`,
  );

  console.log(
    `\n[done] 총 promoted ${ar.promoted + an.promoted}건 verified 승급. missing 은 법제처 응답에 본문 부재.`,
  );
})();
