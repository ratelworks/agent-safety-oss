/**
 * hwpx-export.ts — 문서 본문을 HWPX 파일로 저장한다
 *
 * 저장 위치: <문서 보관 폴더>/<docId>/<docId>-<YYYYMMDD-HHmmss>.hwpx (소유자만 읽고 쓰는 권한)
 * 호스트 저장 주입 모드(createSafetyEngine)에서는 파일을 쓰지 않고 결과 파일(files)로 호스트에 넘긴다.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocumentsDir } from "../config/paths.js";
import { ensureSecureDir, SAFE_FILE_MODE } from "./secure-fs.js";
import { kstIsoNow } from "./datetime-kst.js";
import { toApprovalCopy } from "./approval-copy.js";
import { markdownToHwpx } from "./hwpx-writer.js";
import { assertLocalWriteAllowed, currentHost, hostStorageLabel } from "../engine/host-context.js";

// ── 상수 ────────────────────────────────────────────────────────────
const SAFE_DOC_ID = /^[a-z][a-z0-9_]*$/;
const MAX_NAME_ATTEMPTS = 100;
const HWPX_MIME = "application/hwp+zip";

export interface HwpxExportResult {
  /** 저장한 파일의 절대 경로 (호스트 저장 주입 모드: host-storage/file/<파일 이름> — 바이트는 결과 files 에 있다) */
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
  const stamp = kstIsoNow().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const data = buildHwpx(markdown, title);
  const host = currentHost();
  if (host) {
    const fileName = `${docId}-${stamp}.hwpx`;
    host.addFile({ fileName, mimeType: HWPX_MIME, bytes: data, documentKind: docId });
    return { path: hostStorageLabel("file", fileName), bytes: data.length };
  }
  const dir = join(getDocumentsDir(), docId);
  await ensureSecureDir(dir);
  // 같은 초에 다시 내보내도 앞 파일을 덮어쓰지 않는다 — 이미 있으면 번호를 붙인다
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const path = join(dir, `${docId}-${stamp}${attempt === 0 ? "" : `-${attempt + 1}`}.hwpx`);
    try {
      assertLocalWriteAllowed("한글 파일 저장");
      await writeFile(path, data, { mode: SAFE_FILE_MODE, flag: "wx" });
      return { path, bytes: data.length };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error("HWPX 저장 불가 — 같은 시각의 파일이 너무 많습니다");
}
