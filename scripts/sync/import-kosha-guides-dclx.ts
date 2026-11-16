#!/usr/bin/env tsx
/**
 * import-kosha-guides-dclx.ts — 공단 포털 원본 PDF 를 DocLang(.dclx)으로 바꾼 결과를 번들에 들여온다
 *
 * 개발자 전용. 입력은 두 가지다.
 *   --dclx <폴더>      {지침번호}.dclx — 공단 포털 원본 PDF 를 DocLang 0.8 변환기로 바꾼 것 (공식 validator 통과본)
 *   --manifest <파일>  원본 내려받기 기록 — { "<지침번호>": { portalNo, status, ofancYmd, title, url, sha256, bytes } }
 *
 * 하는 일
 *   1. 번들의 가이드마다 .dclx 가 있고, 읽히고, 본문이 비지 않는지 확인한다 (하나라도 어긋나면 아무것도 쓰지 않는다)
 *   2. src/ontology/kosha-guides/{지침번호}.dclx 로 넣고, 같은 번호의 옛 변환본(.md)을 지운다
 *   3. src/ontology/kosha-guides/_SOURCES.json — 가이드마다 공단 포털 제목·상태·공고일·원본 주소·SHA-256·크기
 *
 * 사용: tsx scripts/sync/import-kosha-guides-dclx.ts --dclx <폴더> --manifest <파일> [--dry-run]
 */
import { readFile, writeFile, readdir, copyFile, rm, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { doclangToMarkdown, readDclxDocument } from "../../src/lib/dclx.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "kosha-guides");
const GUIDE_NODES = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");
const SOURCES_FILE = resolve(GUIDES_DIR, "_SOURCES.json");
/** 본문이 이보다 짧으면 변환 실패로 본다 (표지만 남은 경우 등) */
const MIN_BODY_CHARS = 500;
const SOURCE_NOTE =
  "한국산업안전보건공단 포털(portal.kosha.or.kr) 안전보건기술지침 원본 PDF 를 DocLang 0.8(.dclx)로 바꿔 보관한다. 그림 파일은 싣지 않고 자리·캡션·원본 쪽 번호만 남긴다. 정확한 원본은 sourceUrl.";
const LICENSE = "공공누리 출처표시·변경금지 (한국산업안전보건공단)";

interface ManifestEntry {
  portalNo?: string;
  status?: string;
  ofancYmd?: string;
  title?: string;
  url?: string;
  sha256?: string;
  bytes?: number;
  error?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function isoDate(yyyymmdd?: string): string | undefined {
  return yyyymmdd && /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : undefined;
}

async function main(): Promise<void> {
  const dclxDir = arg("dclx");
  const manifestPath = arg("manifest");
  const dryRun = process.argv.includes("--dry-run");
  if (!dclxDir || !manifestPath) {
    console.error("사용: tsx scripts/sync/import-kosha-guides-dclx.ts --dclx <폴더> --manifest <파일> [--dry-run]");
    process.exit(2);
  }
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as Record<string, ManifestEntry>;
  // 번들 가이드 = 그래프의 가이드 노드 (노드 파일 이름은 소문자)
  const nodeFiles = (await readdir(GUIDE_NODES)).filter((f) => f.endsWith(".jsonld"));
  const guideNos: string[] = [];
  for (const f of nodeFiles) {
    const node = JSON.parse(await readFile(resolve(GUIDE_NODES, f), "utf8")) as { _meta?: { guideNo?: string } };
    if (node._meta?.guideNo) guideNos.push(node._meta.guideNo);
  }
  guideNos.sort();

  const problems: string[] = [];
  const guides: Record<string, Record<string, unknown>> = {};
  for (const no of guideNos) {
    const m = manifest[no];
    if (!m || m.error || !m.sha256 || !m.url) {
      problems.push(`${no}: 원본 기록 없음${m?.error ? ` (${m.error})` : ""}`);
      continue;
    }
    const file = resolve(dclxDir, `${no}.dclx`);
    try {
      const body = doclangToMarkdown(readDclxDocument(await readFile(file)));
      if (body.replace(/\s/g, "").length < MIN_BODY_CHARS) problems.push(`${no}: 본문이 너무 짧음 (${body.length}자)`);
    } catch (e) {
      problems.push(`${no}: dclx 를 읽지 못함 — ${(e as Error).message}`);
      continue;
    }
    guides[no] = {
      title: (m.title ?? "").trim(),
      status: m.status ?? "",
      ...(isoDate(m.ofancYmd) ? { publishedAt: isoDate(m.ofancYmd) } : {}),
      ...(m.portalNo && m.portalNo !== no ? { portalNo: m.portalNo } : {}),
      sourceUrl: m.url,
      sha256: m.sha256,
      bytes: m.bytes ?? 0,
    };
  }
  if (problems.length) {
    console.error(`들여오지 않습니다 — 문제 ${problems.length}건:\n  ${problems.slice(0, 30).join("\n  ")}`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const sources = { generatedAt: today, note: SOURCE_NOTE, license: LICENSE, count: guideNos.length, guides };
  if (dryRun) {
    console.log(`(시험 실행) 가이드 ${guideNos.length}건 모두 들여올 수 있습니다.`);
    return;
  }
  let copied = 0;
  let removedMd = 0;
  for (const no of guideNos) {
    await copyFile(resolve(dclxDir, `${no}.dclx`), resolve(GUIDES_DIR, `${no}.dclx`));
    copied += 1;
    const md = resolve(GUIDES_DIR, `${no}.md`);
    if (await stat(md).then(() => true, () => false)) {
      await rm(md);
      removedMd += 1;
    }
  }
  await writeFile(SOURCES_FILE, JSON.stringify(sources, null, 1) + "\n", "utf8");
  const statuses: Record<string, number> = {};
  for (const g of Object.values(guides)) statuses[String(g.status)] = (statuses[String(g.status)] ?? 0) + 1;
  console.log(`가이드 ${copied}건 dclx 로 들여옴 · 옛 md ${removedMd}건 지움 · 공단 상태 ${JSON.stringify(statuses)}`);
}

void main();
