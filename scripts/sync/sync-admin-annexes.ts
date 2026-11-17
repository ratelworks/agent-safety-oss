#!/usr/bin/env tsx
/**
 * sync-admin-annexes.ts — 고시·지침의 별표·별지 본문을 법제처 원문으로 노드에 싣는다
 *
 * 법제처 lawService.do?target=admrul 응답(XML)의 <별표단위> 에서 별표·별지 번호·제목·본문·파일 링크를 읽어
 *   - 별표 노드  src/ontology/graph/nodes/annexes/{actKey}-별표{N}[의{M}].jsonld   (annex:{actKey}:별표N)
 *   - 별지 노드  src/ontology/graph/nodes/annexes/{actKey}-서식{N}[의{M}].jsonld   (annex:{actKey}:서식N — 법령 별지 서식과 같은 이름)
 * 를 쓰고 법령 노드의 hasAnnex 에 잇는다. 번호 없는 별표(번호 0)는 annex:{actKey}:별표 로 쓴다. 삭제된 별표·별지는 싣지 않는다.
 * 있는 노드는 본문·제목·출처 표지만 고치고(노드에 덧붙인 연결 칸은 그대로), 바뀐 것이 없으면 다시 쓰지 않는다.
 *
 * 싣는 고시·지침과 그 이유는 admin-rules-list.ts 의 ANNEX_RULES.
 *
 * 사용
 *   LAW_OC=... tsx scripts/sync/sync-admin-annexes.ts            # 법제처에서 받아 갱신
 *   tsx scripts/sync/sync-admin-annexes.ts --from <XML 폴더>     # 받아 둔 {일련번호}.xml 로 갱신
 *   --dry-run                                                     # 바뀔 것만 출력
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMRULS, ANNEX_RULES, type AdminRule } from "./admin-rules-list.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const ANNEXES = resolve(NODES, "annexes");
const ACTS = resolve(NODES, "acts");
const LAW_SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";
const LICENSE_HINT = "저작권법 제7조 비보호 (자유 인용)";

interface AdminAnnex {
  key: string;
  kind: "별표" | "서식";
  num: string;
  sub: string;
  title: string;
  body: string;
  hwpUrl?: string;
  pdfUrl?: string;
}

const cdata = (s: string): string => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
const flat = (s: string): string => s.replace(/[\sㆍ·‧]/g, "");

/** 고시 원문 XML 의 별표·별지 — 삭제된 것은 뺀다 */
export function parseAdminAnnexes(xml: string): AdminAnnex[] {
  const out: AdminAnnex[] = [];
  for (const m of xml.matchAll(/<별표단위[^>]*별표키="([^"]+)"[^>]*>([\s\S]*?)<\/별표단위>/g)) {
    const inner = m[2];
    const get = (tag: string): string => cdata(inner.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "");
    const title = get("별표제목");
    const kindRaw = get("별표구분");
    if (!title || /^삭제/.test(title)) continue;
    const kind = kindRaw === "별지" || kindRaw === "서식" ? "서식" : "별표";
    const num = String(Number(get("별표번호") || "0"));
    const subRaw = String(Number(get("별표가지번호") || "0"));
    const body = [...(inner.match(/<별표내용>([\s\S]*?)<\/별표내용>/)?.[1] ?? "").matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((x) => x[1]).join("\n").trim();
    const hwp = inner.match(/<별표서식파일링크>([^<]+)<\/별표서식파일링크>/)?.[1];
    const pdf = inner.match(/<별표서식PDF파일링크>([^<]+)<\/별표서식PDF파일링크>/)?.[1];
    out.push({
      key: m[1],
      kind,
      num,
      sub: subRaw === "0" ? "" : subRaw,
      title,
      body: body || title,
      ...(hwp ? { hwpUrl: `https://www.law.go.kr${hwp.trim()}` } : {}),
      ...(pdf ? { pdfUrl: `https://www.law.go.kr${pdf.trim()}` } : {}),
    });
  }
  return out;
}

/** "별표1의2" · "서식3" · 번호 없는 별표는 "별표" */
function label(a: AdminAnnex): string {
  const n = a.num === "0" ? "" : `${a.num}${a.sub ? `의${a.sub}` : ""}`;
  return `${a.kind}${n}`;
}
/** 사람이 읽는 이름 — "별표 1의2" · "별지 제3호서식" */
function humanLabel(a: AdminAnnex): string {
  const n = `${a.num}${a.sub ? `의${a.sub}` : ""}`;
  if (a.kind === "서식") return `별지 제${n}호서식`;
  return a.num === "0" ? "별표" : `별표 ${n}`;
}

async function loadXml(rule: AdminRule, fromDir: string | undefined, oc: string): Promise<string> {
  if (fromDir) return readFile(resolve(fromDir, `${rule.id}.xml`), "utf-8");
  const url = `${LAW_SERVICE_URL}?OC=${encodeURIComponent(oc)}&target=admrul&ID=${rule.id}&type=XML`;
  return fetch(url).then((r) => r.text());
}

/** 파일 끝 줄바꿈은 원래 모양대로 — 바뀐 것이 없으면 쓰지 않는다 */
async function writeJson(path: string, node: unknown, dryRun: boolean): Promise<boolean> {
  const raw = existsSync(path) ? await readFile(path, "utf-8") : null;
  const body = JSON.stringify(node, null, 2) + (raw === null || raw.endsWith("\n") ? "\n" : "");
  if (raw === body) return false;
  if (!dryRun) await writeFile(path, body, "utf-8");
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fromIdx = args.indexOf("--from");
  const fromDir = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
  const oc = process.env.LAW_OC ?? "";
  if (!fromDir && !oc) {
    console.error("LAW_OC 환경 변수(법제처 OpenAPI 인증값) 또는 --from <XML 폴더> 가 필요합니다.");
    process.exit(2);
  }
  const today = new Date().toISOString().slice(0, 10);
  let created = 0;
  let updated = 0;

  for (const rule of ADMRULS) {
    if (!ANNEX_RULES.has(rule.actKey)) continue;
    const xml = await loadXml(rule, fromDir, oc);
    const name = cdata(xml.match(/<행정규칙명>([\s\S]*?)<\/행정규칙명>/)?.[1] ?? "");
    if (!name) {
      console.error(`[${rule.actKey}] 응답에서 이름을 읽지 못했습니다 — 건너뜀`);
      process.exitCode = 1;
      continue;
    }
    const actIri = `act:${rule.actSlug}`;
    const sourceUrl = `https://www.law.go.kr/행정규칙/${encodeURIComponent(name)}`;
    const iris: string[] = [];
    for (const a of parseAdminAnnexes(xml)) {
      const iri = `annex:${rule.actKey}:${label(a)}`;
      const path = resolve(ANNEXES, `${rule.actKey}-${label(a)}.jsonld`);
      iris.push(iri);
      const previous = existsSync(path) ? (JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown> & { _meta?: Record<string, unknown> }) : undefined;
      const title = `${name} ${humanLabel(a)} — ${a.title}`;
      if (previous && flat(String(previous.description ?? "")) === flat(a.body) && flat(String(previous.title ?? "")) === flat(title)) continue;
      const node: Record<string, unknown> = {
        ...(previous ?? {}),
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": ["Annex"],
        title,
        annexNumber: a.sub ? `${a.num}-${a.sub}` : a.num,
        annexKind: a.kind,
        partOf: actIri,
        verificationStatus: "verified",
        _meta: {
          ...(previous?._meta ?? {}),
          publishedBy: "법제처 국가법령정보센터",
          sourceUrl,
          fetchedAt: today,
          verifiedAt: today,
          verifiedBy: `법제처 lawService.do (target=admrul, ID=${rule.id}) <별표단위>`,
          admRulId: rule.id,
          annexKey: a.key,
          ...(a.hwpUrl ? { hwpDownloadUrl: a.hwpUrl } : {}),
          ...(a.pdfUrl ? { pdfDownloadUrl: a.pdfUrl } : {}),
          licenseHint: LICENSE_HINT,
        },
        description: a.body,
        legislationIdentifier: name,
        jurisdiction: "KR",
      };
      delete (node._meta as Record<string, unknown>).note;
      if (await writeJson(path, node, dryRun)) {
        if (previous) updated += 1;
        else created += 1;
        console.log(`  [${previous ? "고침" : "신규"}] ${iri} — ${a.title} (본문 ${a.body.length}자)`);
      }
    }
    // 법령 노드의 별표·별지 목록 (사람이 더한 연결은 그대로 둔다)
    const actPath = resolve(ACTS, `${rule.actSlug}.jsonld`);
    if (existsSync(actPath) && iris.length) {
      const act = JSON.parse(await readFile(actPath, "utf-8")) as Record<string, unknown>;
      const has = Array.isArray(act.hasAnnex) ? (act.hasAnnex as string[]) : [];
      const missing = iris.filter((iri) => !has.includes(iri));
      if (missing.length) {
        act.hasAnnex = [...has, ...missing];
        await writeJson(actPath, act, dryRun);
      }
    }
    console.log(`[${rule.actKey}] 별표·별지 ${iris.length}건`);
  }
  console.log(`\n✅ 새로 만든 별표·별지 ${created} · 고친 것 ${updated}${dryRun ? " (dry-run — 파일은 그대로)" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
