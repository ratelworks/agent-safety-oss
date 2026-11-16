#!/usr/bin/env tsx
/**
 * test-official-forms-text.ts — 내장 공식 양식 원본(HWP·PDF·XLSX)의 글 판(.dclx) 회귀 시험
 *
 *   1. forms-map.json 의 원본 양식 파일마다 글 판(textFile)과 원본 SHA-256 이 있고, 원본 파일의 해시와 맞는다
 *   2. 글 판이 읽히고 본문이 비지 않는다
 *   3. 양식 도구가 encoding=text 로 원본 양식의 칸 글을 돌려준다 (산업재해조사표 — 원본 HWP 의 칸 이름)
 *   4. md 양식은 encoding=text 로 그 글을 그대로 돌려준다
 *
 * 사용: tsx scripts/test/test-official-forms-text.ts   (build/ 를 쓰는 도구 시험이 있어 npm run build 뒤에)
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { doclangToMarkdown, readDclxDocument } from "../../src/lib/dclx.js";
import { getOfficialFormTool } from "../../build/tools/get-official-form.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const FORMS_DIR = resolve(ROOT, "src", "ontology", "forms");
const BINARY_FORMATS = new Set(["hwp", "hwpx", "pdf", "xlsx"]);
const MIN_BODY_CHARS = 40;
/** 산업재해조사표 원본 HWP 에 있는 칸 이름 */
const ACCIDENT_FORM = { formId: "annex30_industrial_accident_report", cells: ["산재관리번호", "사업장명", "재해발생", "재발방지"] };

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

interface FormEntry {
  formId: string;
  filename: string;
  format: string;
  textFile?: string;
  originalSha256?: string;
}

async function main(): Promise<void> {
  const { forms } = JSON.parse(await readFile(resolve(FORMS_DIR, "forms-map.json"), "utf8")) as { forms: FormEntry[] };
  const binary = forms.filter((f) => BINARY_FORMATS.has(f.format));

  // 1·2. 글 판과 원본 해시
  const noText = binary.filter((f) => !f.textFile).map((f) => f.formId);
  check("원본 양식마다 글 판이 연결돼 있다", noText.length === 0, noText.slice(0, 5).join(", ") || `${binary.length}개 항목`);
  const hashMismatch: string[] = [];
  const emptyText: string[] = [];
  for (const file of [...new Set(binary.map((f) => f.filename))]) {
    const entry = binary.find((f) => f.filename === file)!;
    const sha = createHash("sha256").update(await readFile(resolve(FORMS_DIR, file))).digest("hex");
    if (entry.originalSha256 !== sha) hashMismatch.push(file);
    if (!entry.textFile) continue;
    const chars = doclangToMarkdown(readDclxDocument(await readFile(resolve(FORMS_DIR, entry.textFile)))).trim().length;
    if (chars < MIN_BODY_CHARS) emptyText.push(`${file}(${chars}자)`);
  }
  check("글 판이 가리키는 원본 해시가 지금 원본 파일과 같다", hashMismatch.length === 0, hashMismatch.join(", "));
  check("글 판 본문이 비지 않는다", emptyText.length === 0, emptyText.join(", "));

  // 3. 도구 — 원본 양식 글
  const r = (await getOfficialFormTool.handler({ formId: ACCIDENT_FORM.formId, encoding: "text" })) as {
    isError?: boolean;
    structuredContent?: { text?: string; textSource?: string };
  };
  const text = r.structuredContent?.text ?? "";
  const missing = ACCIDENT_FORM.cells.filter((c) => !text.replace(/\s+/g, "").includes(c));
  check("양식 도구가 원본 한글 양식의 칸 글을 돌려준다 (encoding=text)", !r.isError && r.structuredContent?.textSource === "dclx" && missing.length === 0, missing.length ? `없음: ${missing.join(", ")}` : `${text.length}자`);

  // 4. md 양식
  const md = forms.find((f) => f.format === "md");
  if (md) {
    const rm = (await getOfficialFormTool.handler({ formId: md.formId, encoding: "text" })) as { isError?: boolean; structuredContent?: { text?: string; textSource?: string } };
    const raw = await readFile(resolve(FORMS_DIR, md.filename), "utf8");
    check("md 양식은 그 글을 그대로 돌려준다", !rm.isError && rm.structuredContent?.textSource === "md" && rm.structuredContent?.text === raw, md.formId);
  }

  console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
