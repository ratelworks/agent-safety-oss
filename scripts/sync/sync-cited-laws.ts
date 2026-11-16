#!/usr/bin/env tsx
/**
 * sync-cited-laws.ts — 건설·산업안전 법령이 인용하는 다른 법령의 조문을 법제처 원문으로 받아 그래프 노드로 만든다
 *
 * 대상 목록: scripts/sync/cited-laws.json — [{ name: 법제처 법령명, key: 조문 주소에 쓰는 짧은 이름, type: Act|Decree|Rule, articles: ["2", "13의2", …] }]
 * 법령 전체가 아니라 인용된 조문만 싣는다(법령 노드 _meta.note 에 그렇게 적는다).
 *
 * 법제처 lawSearch.do 로 법령일련번호(MST)를 찾고, lawService.do?target=law 응답(XML)에서 조문을 읽어
 *   - 조문 노드  src/ontology/graph/nodes/articles/{key}-§{조}.jsonld
 *   - 법령 노드  src/ontology/graph/nodes/acts/{법령명 공백 제거}.jsonld (hasArticle 포함)
 * 를 쓴다. 이미 있는 노드는 덮어쓰지 않고 합친다(사람이 보강한 연결 보존). 본문이 같으면 파일을 건드리지 않는다.
 * 새로 만드는 조문은 userVisible: false — 원문 조회(get_safety_law_article)용이고 현장 브리핑·조문 검색에는 나오지 않는다.
 *
 * 사용
 *   LAW_OC=... tsx scripts/sync/sync-cited-laws.ts
 */
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const ACTS = resolve(NODES, "acts");
const LIST = resolve(__dirname, "cited-laws.json");
const BASE = "https://www.law.go.kr/DRF";
const LICENSE_HINT = "저작권법 제7조 비보호 (자유 인용)";
const TIMEOUT_MS = 20000;
const RETRY = 2;
const CITED_NOTE = "건설·산업안전 법령이 인용하는 조문만 수록했다 — 이 법령의 전체 조문을 담지 않는다.";
/** 목록에서 complete: true 인 법령(산안법이 위임한 부령 등)은 전체 조문을 싣고, 현장 브리핑·조문 검색에도 나온다 */
const COMPLETE_NOTE = "법제처 원문의 전체 조문을 수록했다.";

interface CitedLaw {
  name: string;
  key: string;
  type: "Act" | "Decree" | "Rule";
  articles: string[];
  /** 전체 조문을 실은 법령 — "인용 조문만" 표지와 검색 제외를 붙이지 않는다 */
  complete?: boolean;
}

async function fetchText(url: string, attempt = 0): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (attempt < RETRY) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      return fetchText(url, attempt + 1);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function cdata(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? m[1].trim() : "";
}

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

/** 이름 비교용 — 공백과 가운뎃점 표기(·ㆍ‧)를 뺀다 */
function compact(name: string): string {
  return name.replace(/[\s·ㆍ‧]/g, "");
}

/** 법령명이 같은 현행 법령의 MST·공포일·시행일 — 시행예정판이 아니라 지금 시행 중인 판을 고른다. 없으면 null */
async function findMst(oc: string, name: string): Promise<{ mst: string; promulgated: string; effective: string } | null> {
  const xml = await fetchText(`${BASE}/lawSearch.do?OC=${oc}&target=law&type=XML&display=100&query=${encodeURIComponent(name)}`);
  const want = compact(name);
  const same = [...xml.matchAll(/<law id="\d+">([\s\S]*?)<\/law>/g)].map((m) => m[1]).filter((b) => compact(cdata(b, "법령명한글")) === want);
  const current = same.find((b) => cdata(b, "현행연혁코드") === "현행");
  return current ? { mst: cdata(current, "법령일련번호"), promulgated: isoDate(cdata(current, "공포일자")), effective: isoDate(cdata(current, "시행일자")) } : null;
}

/** 조문 하나의 본문 — "제N조(제목) 내용" 다음 줄에 항·호·목을 원문 순서대로 */
function articleText(block: string): string {
  const lines: string[] = [];
  const head = cdata(block, "조문내용");
  if (head) lines.push(head);
  for (const hm of block.matchAll(/<항>([\s\S]*?)<\/항>/g)) {
    const hang = hm[1];
    const body = cdata(hang, "항내용");
    if (body) lines.push(body);
    for (const ho of hang.matchAll(/<호>([\s\S]*?)<\/호>/g)) {
      const hoBody = cdata(ho[1], "호내용");
      if (hoBody) lines.push(`  ${hoBody}`);
      for (const mok of ho[1].matchAll(/<목>([\s\S]*?)<\/목>/g)) {
        const mokBody = cdata(mok[1], "목내용");
        if (mokBody) lines.push(...mokBody.split(/\n/).map((l) => `    ${l.trim()}`));
      }
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function main(): Promise<void> {
  const oc = process.env.LAW_OC ?? "";
  if (!oc) {
    console.error("LAW_OC 환경 변수(법제처 OpenAPI 인증값)가 필요합니다.");
    process.exit(2);
  }
  const today = new Date().toISOString().substring(0, 10);
  const laws = JSON.parse(await readFile(LIST, "utf-8")) as CitedLaw[];
  for (const law of laws) {
    const found = await findMst(oc, law.name);
    if (!found) {
      console.error(`[${law.key}] 법제처에서 '${law.name}' 를 찾지 못했습니다 — 건너뜀`);
      process.exitCode = 1;
      continue;
    }
    const { mst } = found;
    // 공포일·시행일은 검색 응답의 현행판 값을 쓴다 — 본문 XML 안에는 시행예정 조문의 시행일자도 섞여 있다
    const xml = await fetchText(`${BASE}/lawService.do?OC=${oc}&target=law&type=XML&MST=${mst}`);
    const official = cdata(xml, "법령명_한글") || law.name;
    const date = found.promulgated;
    const effective = found.effective || date;
    const blocks = [...xml.matchAll(/<조문단위[^>]*>([\s\S]*?)<\/조문단위>/g)].map((m) => m[1]).filter((b) => cdata(b, "조문여부") === "조문");
    const actSlug = official.replace(/[\s·ㆍ]/g, "");
    const actIri = `act:${actSlug}`;
    const sourceBase = `https://www.law.go.kr/법령/${encodeURIComponent(official)}`;
    const note = law.complete ? COMPLETE_NOTE : CITED_NOTE;
    if (law.complete && law.articles.length !== blocks.length) {
      console.error(`[${law.key}] 전체 수록으로 표시했지만 목록 조문 ${law.articles.length}개 ≠ 원문 조문 ${blocks.length}개`);
      process.exitCode = 1;
    }
    const written: string[] = [];
    let added = 0;
    let updated = 0;
    for (const num of law.articles) {
      const [main, branch] = num.split("의");
      const block = blocks.find((b) => cdata(b, "조문번호") === main && (cdata(b, "조문가지번호") || "0") === (branch ?? "0"));
      if (!block) {
        console.error(`[${law.key}] 제${num}조를 원문에서 찾지 못했습니다`);
        process.exitCode = 1;
        continue;
      }
      const iri = `art:${law.key}:${num}`;
      const path = resolve(ARTICLES, `${law.key}-§${num}.jsonld`);
      const node = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": ["Article", "Legislation"],
        articleNumber: num,
        title: cdata(block, "조문제목"),
        partOf: actIri,
        verificationStatus: "verified",
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 sync)",
          sourceUrl: `${sourceBase}/제${main}조${branch ? `의${branch}` : ""}`,
          fetchedAt: today,
          verifiedAt: today,
          verifiedBy: "법제처 lawService.do?target=law (자동 sync)",
          lawServiceMST: mst,
          licenseHint: LICENSE_HINT,
          note,
        },
        description: articleText(block),
        legislationIdentifier: official,
        legislationDate: date,
        legislationType: law.type,
        legislationLegalForce: "InForce",
        jurisdiction: "KR",
        temporalCoverage: `${effective}/..`,
        // 인용 조문은 원문 조회용 — 현장 브리핑·조문 검색 결과에는 나오지 않게 한다 (직접 조회는 된다)
        ...(law.complete ? {} : { userVisible: false }),
      };
      let merged: Record<string, unknown> = node;
      if (await exists(path)) {
        const current = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
        // 들여쓰기·줄바꿈만 다른 본문은 같은 본문으로 본다 (공백 차이로 기존 노드를 다시 쓰지 않는다)
        const squash = (v: unknown): string => String(v ?? "").replace(/\s+/g, "");
        if (squash(current.description) === squash(node.description)) {
          written.push(iri);
          continue;
        }
        // 이미 있는 노드는 본문·출처만 갱신하고 사람이 보강한 필드(제목 보정·연결·관련성 등)는 둔다
        const currentMeta = (current._meta && typeof current._meta === "object" ? current._meta : {}) as Record<string, unknown>;
        merged = { ...node, ...current, description: node.description, _meta: { ...currentMeta, ...node._meta, note: currentMeta.note ?? node._meta.note } };
        updated += 1;
      } else {
        added += 1;
      }
      await writeFile(path, JSON.stringify(merged, null, 2) + "\n", "utf-8");
      written.push(iri);
    }
    // 법령 노드 — 있으면 조문만 더하고, 없으면 만든다 (파일명은 기존 노드를 우선)
    const actPath = resolve(ACTS, `${actSlug}.jsonld`);
    if (await exists(actPath)) {
      const current = JSON.parse(await readFile(actPath, "utf-8")) as Record<string, unknown>;
      const has = Array.isArray(current.hasArticle) ? (current.hasArticle as string[]) : [];
      const missing = written.filter((iri) => !has.includes(iri));
      if (missing.length) await writeFile(actPath, JSON.stringify({ ...current, hasArticle: [...has, ...missing] }, null, 2) + "\n", "utf-8");
    } else {
      const act = {
        "@context": "../../context.jsonld",
        "@id": actIri,
        "@type": ["Act", "Legislation"],
        title: official,
        legislationIdentifier: official,
        legislationType: law.type,
        legislationDate: date,
        temporalCoverage: `${effective}/..`,
        alternativeNames: law.key === actSlug ? [] : [law.key],
        verificationStatus: "verified",
        legislationLegalForce: "InForce",
        jurisdiction: "KR",
        hasArticle: written,
        _meta: { publishedBy: "법제처 국가법령정보센터 (자동 sync)", sourceUrl: sourceBase, lawServiceMST: mst, licenseHint: LICENSE_HINT, note },
      };
      await writeFile(actPath, JSON.stringify(act, null, 2) + "\n", "utf-8");
    }
    console.log(`[${law.key}] ${official} (MST ${mst}, 시행 ${effective}) 조문 +${added} 신규 / ${updated} 갱신 / 요청 ${law.articles.length}`);
  }
}

void main();
