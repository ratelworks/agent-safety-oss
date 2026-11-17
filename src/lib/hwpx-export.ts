/**
 * hwpx-export.ts — 문서를 정본(.dclx — DocLang 아카이브)과 한글(HWPX) 파일로 저장한다
 *
 * 저장 위치: <문서 보관 폴더>/<docId>/<docId>-<YYYYMMDD-HHmmss>.{dclx,hwpx} (소유자만 읽고 쓰는 권한)
 * 한글 파일은 정본(DocLang)에서 만든다 — 글을 Markdown 으로 바꿨다가 다시 읽지 않으므로 값의 기호("10*20*30")가 서식으로 바뀌지 않는다.
 * 본문(Markdown)에서 만드는 길(saveHwpx)은 초안 항목을 그대로 옮기는 내보내기 도구가 쓴다.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocumentsDir } from "../config/paths.js";
import { ensureSecureDir, SAFE_FILE_MODE } from "./secure-fs.js";
import { kstIsoNow } from "./datetime-kst.js";
import { toApprovalCopy } from "./approval-copy.js";
import { docBlocksToHwpx, markdownToHwpx } from "./hwpx-writer.js";
import { packDclx } from "./dclx.js";
import { doclangToBlocks } from "./doclang-reader.js";

// ── 상수 ────────────────────────────────────────────────────────────
const SAFE_DOC_ID = /^[a-z][a-z0-9_]*$/;
const MAX_NAME_ATTEMPTS = 100;

export interface HwpxExportResult {
  /** 저장한 파일의 절대 경로 */
  path: string;
  bytes: number;
}

/** 결재·제출용으로 정리한 본문을 HWPX 내용으로 바꾼다 */
export function buildHwpx(markdown: string, title: string): Buffer {
  return markdownToHwpx(toApprovalCopy(markdown), { title });
}

/** 정본(DocLang 문서)에서 한글 파일 내용을 만든다 — 정본에는 작성 안내·검사 상태가 없다 */
export function buildHwpxFromDoclang(documentXml: string, title?: string): Buffer {
  const read = doclangToBlocks(documentXml);
  return docBlocksToHwpx(read.blocks, { title: title?.trim() || read.title });
}

/** 파일을 문서 보관 폴더에 새로 쓴다. 같은 초에 다시 저장해도 앞 파일을 덮어쓰지 않는다 */
async function saveDocumentBytes(docId: string, extension: string, data: Buffer, label: string): Promise<HwpxExportResult> {
  if (!SAFE_DOC_ID.test(docId)) throw new Error(`${label} 저장 불가 — docId 형식 오류: ${docId}`);
  const dir = join(getDocumentsDir(), docId);
  await ensureSecureDir(dir);
  const stamp = kstIsoNow().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  // 이미 있으면 번호를 붙인다
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const path = join(dir, `${docId}-${stamp}${attempt === 0 ? "" : `-${attempt + 1}`}.${extension}`);
    try {
      await writeFile(path, data, { mode: SAFE_FILE_MODE, flag: "wx" });
      return { path, bytes: data.length };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`${label} 저장 불가 — 같은 시각의 파일이 너무 많습니다`);
}

/** 본문(Markdown)을 HWPX 파일로 저장하고 경로를 돌려준다 */
export async function saveHwpx(docId: string, markdown: string, title: string): Promise<HwpxExportResult> {
  return saveDocumentBytes(docId, "hwpx", buildHwpx(markdown, title), "HWPX");
}

/** 정본(DocLang 문서)을 .dclx 로 저장한다 */
export async function saveDclx(docId: string, documentXml: string): Promise<HwpxExportResult> {
  return saveDocumentBytes(docId, "dclx", packDclx(documentXml), "정본(.dclx)");
}

/** 정본(DocLang 문서)에서 만든 한글 파일을 저장한다 */
export async function saveHwpxFromDoclang(docId: string, documentXml: string, title?: string): Promise<HwpxExportResult> {
  return saveDocumentBytes(docId, "hwpx", buildHwpxFromDoclang(documentXml, title), "HWPX");
}
