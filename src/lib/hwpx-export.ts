/**
 * hwpx-export.ts — 문서 본문을 HWPX 파일로 저장한다
 *
 * 저장 위치: <문서 보관 폴더>/<docId>/<docId>-<YYYYMMDD-HHmmss>.hwpx (소유자만 읽고 쓰는 권한)
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocumentsDir } from "../config/paths.js";
import { ensureSecureDir, SAFE_FILE_MODE } from "./secure-fs.js";
import { kstIsoNow } from "./datetime-kst.js";
import { toApprovalCopy } from "./approval-copy.js";
import { markdownToHwpx } from "./hwpx-writer.js";

// ── 상수 ────────────────────────────────────────────────────────────
const SAFE_DOC_ID = /^[a-z][a-z0-9_]*$/;

export interface HwpxExportResult {
  /** 저장한 파일의 절대 경로 */
  path: string;
  bytes: number;
}

/** 결재·제출용으로 정리한 본문을 HWPX 내용으로 바꾼다 */
export function buildHwpx(markdown: string, title: string): Buffer {
  return markdownToHwpx(toApprovalCopy(markdown), { title });
}

/** 본문을 HWPX 파일로 저장하고 경로를 돌려준다 */
export async function saveHwpx(docId: string, markdown: string, title: string): Promise<HwpxExportResult> {
  if (!SAFE_DOC_ID.test(docId)) throw new Error(`HWPX 저장 불가 — docId 형식 오류: ${docId}`);
  const dir = join(getDocumentsDir(), docId);
  await ensureSecureDir(dir);
  const stamp = kstIsoNow().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const path = join(dir, `${docId}-${stamp}.hwpx`);
  const data = buildHwpx(markdown, title);
  await writeFile(path, data, { mode: SAFE_FILE_MODE });
  return { path, bytes: data.length };
}
