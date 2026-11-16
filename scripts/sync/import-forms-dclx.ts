#!/usr/bin/env tsx
/**
 * import-forms-dclx.ts — 내장 공식 양식 원본(HWP·PDF·XLSX)을 DocLang(.dclx)으로 바꾼 결과를 번들에 들여온다
 *
 * 개발자 전용. 양식 원본은 사용자가 내려받아 채워 쓰는 파일이라 그대로 두고, 같은 내용을 글로 읽을 수 있는
 * DocLang 판을 곁에 둔다 — 에이전트가 한글·PDF 파일을 직접 읽지 못해도 양식의 칸·표·안내문을 볼 수 있게.
 *
 * 입력
 *   --dclx <폴더>   {원본 파일 이름}.dclx (예: 별지30호서식-산업재해조사표.hwp.dclx) — DocLang 0.8 변환기 산출(공식 validator 통과본)
 *
 * 하는 일
 *   1. forms-map.json 의 원본 양식 파일마다 .dclx 가 있고, 읽히고, 본문이 비지 않는지 확인한다 (하나라도 어긋나면 아무것도 쓰지 않는다)
 *   2. src/ontology/forms/dclx/{원본 파일 이름}.dclx 로 넣는다 — document.xml 이 같으면 다시 쓰지 않는다 (아카이브 시각만 다른 교체 방지)
 *   3. forms-map.json 의 그 양식 항목에 textFile(번들 안 상대 경로)·originalSha256(원본 파일 SHA-256)을 적는다
 *
 * 사용: tsx scripts/sync/import-forms-dclx.ts --dclx <폴더> [--dry-run]
 */
import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { doclangToMarkdown, readDclxDocument } from "../../src/lib/dclx.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const FORMS_DIR = resolve(ROOT, "src", "ontology", "forms");
const FORMS_MAP = resolve(FORMS_DIR, "forms-map.json");
const TEXT_SUBDIR = "dclx";
/** 본문이 이보다 짧으면 변환 실패로 본다 (작은 대장 양식도 칸 이름만으로 이보다 길다) */
const MIN_BODY_CHARS = 40;
/** 원본 파일 형식 (md 는 이미 글이라 대상이 아니다) */
const BINARY_FORMATS = new Set(["hwp", "hwpx", "pdf", "xlsx"]);

interface FormEntry {
  formId: string;
  filename: string;
  format: string;
  textFile?: string;
  originalSha256?: string;
  [key: string]: unknown;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const dclxDir = arg("dclx");
  const dryRun = process.argv.includes("--dry-run");
  if (!dclxDir) {
    console.error("사용: tsx scripts/sync/import-forms-dclx.ts --dclx <폴더> [--dry-run]");
    process.exit(2);
  }
  const map = JSON.parse(await readFile(FORMS_MAP, "utf8")) as { forms: FormEntry[] } & Record<string, unknown>;
  const files = [...new Set(map.forms.filter((f) => BINARY_FORMATS.has(f.format)).map((f) => f.filename))].sort();

  // 1. 전부 확인 — 하나라도 어긋나면 쓰지 않는다
  const problems: string[] = [];
  const plan: { filename: string; src: string; dest: string; changed: boolean; sha256: string; chars: number }[] = [];
  for (const filename of files) {
    const src = resolve(dclxDir, `${filename}.dclx`);
    if (!(await exists(src))) {
      problems.push(`${filename}: .dclx 없음`);
      continue;
    }
    let xml: string;
    try {
      xml = readDclxDocument(await readFile(src));
    } catch (e) {
      problems.push(`${filename}: 읽지 못함 (${(e as Error).message})`);
      continue;
    }
    const chars = doclangToMarkdown(xml).trim().length;
    if (chars < MIN_BODY_CHARS) {
      problems.push(`${filename}: 본문 ${chars}자 — 변환 실패로 본다`);
      continue;
    }
    const dest = resolve(FORMS_DIR, TEXT_SUBDIR, `${filename}.dclx`);
    const changed = !(await exists(dest)) || readDclxDocument(await readFile(dest)) !== xml;
    const sha256 = createHash("sha256").update(await readFile(resolve(FORMS_DIR, filename))).digest("hex");
    plan.push({ filename, src, dest, changed, sha256, chars });
  }
  if (problems.length) {
    console.error(`❌ ${problems.length}건 문제 — 아무것도 쓰지 않았습니다\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }

  // 2·3. 쓰기
  for (const p of plan) console.log(`${p.changed ? "✏️" : "＝"} ${p.filename} (본문 ${p.chars}자)`);
  if (dryRun) {
    console.log(`(dry-run) 원본 양식 ${plan.length}건, 바뀌는 .dclx ${plan.filter((p) => p.changed).length}건`);
    return;
  }
  await mkdir(resolve(FORMS_DIR, TEXT_SUBDIR), { recursive: true });
  for (const p of plan) if (p.changed) await copyFile(p.src, p.dest);
  const byFile = new Map(plan.map((p) => [p.filename, p]));
  for (const f of map.forms) {
    const p = byFile.get(f.filename);
    if (!p) continue;
    f.textFile = `${TEXT_SUBDIR}/${f.filename}.dclx`;
    f.originalSha256 = p.sha256;
  }
  await writeFile(FORMS_MAP, JSON.stringify(map, null, 2) + "\n");
  console.log(`✅ 원본 양식 ${plan.length}건 — .dclx ${plan.filter((p) => p.changed).length}건 갱신, forms-map 항목 ${map.forms.filter((f) => f.textFile).length}개에 글 판 연결`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
