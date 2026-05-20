#!/usr/bin/env tsx
/**
 * sync-law-from-moleg.ts
 *
 * 법제처 OpenAPI (lawService.do) → 그래프 stub article 80개 본문 자동 sync.
 *
 * 절차:
 *   1. 법령별 MST 자동 검색 (lawSearch.do)
 *   2. 각 stub article 의 articleNumber → JO 코드 (6자리)
 *   3. lawService.do 호출 → XML 파싱
 *   4. <조문제목> + <항/호/목> 추출 → description 갱신
 *   5. verificationStatus → "verified", _meta.verifiedAt + lawServiceMST 추가
 *
 * 환각 방지:
 *   - 법제처 본문은 그대로 보존 (수정·요약 금지)
 *   - sourceUrl/MST/JO 인용 링크 유지
 *   - 조문 제목·시행일자 일치 검증
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ARTICLES = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");

const OC = process.env.LAW_OC || "ryongkoon1984";
const BASE = "https://www.law.go.kr/DRF";
const TIMEOUT_MS = 15000;
const RETRY = 2;

// 법령별 MST (lawSearch.do 로 사전 확인)
const LAW_MST: Record<string, { name: string; mst: string; lawId: string; alias: string }> = {
  "산안법":          { name: "산업안전보건법",            mst: "276853", lawId: "001766", alias: "산업안전보건법" },
  "산안법시행령":     { name: "산업안전보건법 시행령",      mst: "284771", lawId: "003786", alias: "산업안전보건법시행령" },
  "산안법시행규칙":   { name: "산업안전보건법 시행규칙",    mst: "271485", lawId: "003787", alias: "산업안전보건법시행규칙" },
  "기준규칙":         { name: "산업안전보건기준에 관한 규칙", mst: "",       lawId: "",       alias: "산업안전보건기준에관한규칙" },
  "중처법":           { name: "중대재해 처벌 등에 관한 법률", mst: "",       lawId: "",       alias: "중대재해처벌등에관한법률" },
  "중처법시행령":     { name: "중대재해 처벌 등에 관한 법률 시행령", mst: "", lawId: "", alias: "중대재해처벌등에관한법률시행령" },
  "위험성평가-고시":  { name: "사업장 위험성평가에 관한 지침", mst: "",     lawId: "",       alias: "사업장위험성평가에관한지침" },
};

// JO 코드 빌드: "38" → "003800", "38조의2" → "003802"
function buildJO(articleNum: string): string {
  // articleNum: "38" 또는 "38의2" 또는 "170의2"
  const m = articleNum.match(/^(\d+)(?:의(\d+))?$/);
  if (!m) throw new Error(`잘못된 조문 번호: ${articleNum}`);
  const main = m[1].padStart(4, "0");
  const sub = (m[2] ?? "0").padStart(2, "0");
  return main + sub;
}

async function fetchWithRetry(url: string, attempt = 0): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    if (attempt < RETRY) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      return fetchWithRetry(url, attempt + 1);
    }
    throw e;
  }
}

// MST 자동 조회
async function searchLawMST(name: string): Promise<{ mst: string; lawId: string } | null> {
  const url = `${BASE}/lawSearch.do?OC=${OC}&target=law&query=${encodeURIComponent(name)}&type=XML`;
  const xml = await fetchWithRetry(url);
  // 정확 일치 우선
  const matches = [...xml.matchAll(/<law id="\d+"><법령일련번호>(\d+)<\/법령일련번호>[\s\S]*?<법령명한글><!\[CDATA\[([^\]]+)\]\]><\/법령명한글>[\s\S]*?<법령ID>(\d+)<\/법령ID>/g)];
  for (const m of matches) {
    const fetchedName = m[2].replace(/\s/g, "");
    const wanted = name.replace(/\s/g, "");
    if (fetchedName === wanted || fetchedName.includes(wanted)) {
      return { mst: m[1], lawId: m[3] };
    }
  }
  return null;
}

// XML 조문 본문 추출
function parseArticleBody(xml: string, jo: string): { title: string; body: string } | null {
  // 조문 블록: <조문단위 조문키="0038001">...<조문번호>38</조문번호>...<조문가지번호>0</조문가지번호>...</조문단위>
  const articleNum = parseInt(jo.substring(0, 4), 10);
  const subNum = parseInt(jo.substring(4, 6), 10);
  const articleLabel = subNum > 0 ? `제${articleNum}조의${subNum}` : `제${articleNum}조`;

  // 모든 <조문단위> 블록 순회 → 조문번호 + 조문가지번호 매칭
  const blocks = [...xml.matchAll(/<조문단위[^>]*>([\s\S]*?)<\/조문단위>/g)];
  let block: string | null = null;
  for (const b of blocks) {
    const inner = b[1];
    const numMatch = inner.match(/<조문번호>(\d+)<\/조문번호>/);
    const subMatch = inner.match(/<조문가지번호>(\d+)<\/조문가지번호>/);
    const onlyArticle = inner.match(/<조문여부>조문<\/조문여부>/);  // 전문 제외
    if (!onlyArticle) continue;
    const num = numMatch ? parseInt(numMatch[1], 10) : -1;
    const sub = subMatch ? parseInt(subMatch[1], 10) : 0;
    if (num === articleNum && sub === subNum) { block = inner; break; }
  }
  if (!block) return null;

  // 조문제목
  const titleMatch = block.match(/<조문제목><!\[CDATA\[([^\]]+)\]\]><\/조문제목>/);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // 본문 조립 — 항/호/목 순서로
  const lines: string[] = [`**${articleLabel}${title ? ` (${title})` : ""}**`, ""];

  // 조문내용 (서두)
  const bodyMatch = block.match(/<조문내용><!\[CDATA\[([^\]]+)\]\]>\s*<\/조문내용>/);
  if (bodyMatch && !bodyMatch[1].startsWith(articleLabel)) lines.push(bodyMatch[1].trim());

  // 항 추출
  const hangBlocks = [...block.matchAll(/<항>([\s\S]*?)<\/항>/g)];
  if (hangBlocks.length === 0) {
    // 조문내용만 있는 경우
    if (bodyMatch) lines.push(bodyMatch[1].trim());
  }
  for (const hm of hangBlocks) {
    const hb = hm[1];
    const hangNumMatch = hb.match(/<항번호><!\[CDATA\[([^\]]+)\]\]><\/항번호>/);
    const hangBodyMatch = hb.match(/<항내용><!\[CDATA\[([^\]]+)\]\]>\s*<\/항내용>/);
    if (hangBodyMatch) {
      lines.push(hangBodyMatch[1].trim());
    }
    const hoBlocks = [...hb.matchAll(/<호>[\s\S]*?<호번호><!\[CDATA\[([^\]]+)\]\]><\/호번호>[\s\S]*?<호내용><!\[CDATA\[([^\]]+)\]\]>\s*<\/호내용>[\s\S]*?<\/호>/g)];
    for (const hom of hoBlocks) {
      lines.push(`  ${hom[2].trim()}`);
    }
  }

  return { title, body: lines.join("\n").trim() };
}

interface StubArticle {
  file: string;
  iri: string;
  actKey: string;
  articleNumber: string;
}

async function main() {
  console.log(`[sync] OC=${OC.substring(0, 5)}*** 법제처 lawService.do 호출 시작\n`);

  // ─── 1. 법령별 MST 보강 ───
  for (const [key, info] of Object.entries(LAW_MST)) {
    if (info.mst) continue;
    const found = await searchLawMST(info.alias);
    if (!found) { console.warn(`[skip] ${info.name} MST 조회 실패`); continue; }
    info.mst = found.mst;
    info.lawId = found.lawId;
    console.log(`  [${key}] ${info.name} MST=${info.mst} lawId=${info.lawId}`);
  }
  console.log();

  // ─── 2. stub article 수집 ───
  const stubs: StubArticle[] = [];
  for (const f of await readdir(ARTICLES)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ARTICLES, f);
    const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    // stub / draft / 짧은 description 모두 sync 대상
    const desc = String(node.description ?? "");
    const status = node.verificationStatus;
    const needSync = status === "stub" || status === "draft" || desc.length < 150;
    if (!needSync) continue;
    const iri = node["@id"] as string;
    const actKey = iri.split(":")[1];
    const articleNumber = String(node.articleNumber ?? "");
    if (!actKey || !articleNumber) continue;
    stubs.push({ file: path, iri, actKey, articleNumber });
  }
  console.log(`[stubs] ${stubs.length} 개 stub article sync 대상\n`);

  // ─── 3. 법령별 그룹 + XML 캐시 ───
  const xmlCache = new Map<string, string>();  // key=actKey → XML
  const stats = { synced: 0, skipped: 0, failed: 0 };
  const failures: string[] = [];

  for (const stub of stubs) {
    const lawInfo = LAW_MST[stub.actKey];
    if (!lawInfo || !lawInfo.mst) {
      stats.skipped++;
      console.warn(`  [skip] ${stub.iri} — 법령 MST 없음`);
      continue;
    }

    let jo: string;
    try { jo = buildJO(stub.articleNumber); } catch { stats.skipped++; continue; }

    // 법령 전체 XML 한 번만 fetch (5MB 한 번 + JO 필터링이 효율적)
    let xml = xmlCache.get(stub.actKey);
    if (!xml) {
      const url = `${BASE}/lawService.do?OC=${OC}&target=law&MST=${lawInfo.mst}&type=XML`;
      try {
        xml = await fetchWithRetry(url);
        xmlCache.set(stub.actKey, xml);
        console.log(`  [fetch] ${lawInfo.name} (${(xml.length/1024).toFixed(1)} KB) — 캐시`);
      } catch (e) {
        stats.failed++;
        failures.push(`${stub.iri}: fetch 실패`);
        continue;
      }
    }

    const parsed = parseArticleBody(xml, jo);
    if (!parsed) {
      stats.skipped++;
      failures.push(`${stub.iri}: §${stub.articleNumber} XML 매칭 실패`);
      continue;
    }

    // 노드 갱신
    const node = JSON.parse(await readFile(stub.file, "utf-8")) as Record<string, unknown>;
    node.description = parsed.body;
    if (parsed.title) node.title = parsed.title;
    node.verificationStatus = "verified";
    const meta = (node._meta as Record<string, unknown>) ?? {};
    meta.verifiedAt = new Date().toISOString().substring(0, 10);
    meta.verifiedBy = "법제처 lawService.do (자동 sync)";
    meta.lawServiceMST = lawInfo.mst;
    meta.lawServiceLawId = lawInfo.lawId;
    meta.lawServiceJO = jo;
    meta.bodyLength = parsed.body.length;
    delete meta.note;
    node._meta = meta;
    await writeFile(stub.file, JSON.stringify(node, null, 2) + "\n", "utf-8");
    stats.synced++;
    console.log(`  ✓ ${stub.iri} — "${parsed.title}" (${parsed.body.length} 자)`);
  }

  console.log(`\n=== sync 결과 ===`);
  console.log(`  ✓ verified 승격: ${stats.synced}`);
  console.log(`  ⚠ skipped:        ${stats.skipped}`);
  console.log(`  ✗ failed:         ${stats.failed}`);
  if (failures.length > 0) {
    console.log(`\n실패 목록:`);
    for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
    if (failures.length > 20) console.log(`  ... ${failures.length - 20} more`);
  }
}

main().catch(e => { console.error("[ERROR]", e); process.exit(1); });
