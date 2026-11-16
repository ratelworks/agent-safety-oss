/**
 * secure-fs.ts
 *
 * 로컬 영구 저장소(`~/.agent-safety-oss/`)의 모든 디렉토리·파일 권한을
 * 단일 SSoT 로 강제하는 helper. PII·API 키·audit trail 을 사용자 전용으로 보호한다.
 *
 * 정책: SECURITY.md §3 — PII·키 보호.
 *   · 디렉토리 0o700 — 사용자 전용 read/write/execute
 *   · 파일       0o600 — 사용자 전용 read/write
 *
 * 사용처: local-storage / photo-storage / safety-issue-storage / corrective-action-storage /
 *         safety-report-storage / site-profile / trace-recorder / company-key.
 *
 * 호스트 저장 주입 모드(createSafetyEngine)에서는 모든 쓰기를 막는다 — 그 모드의 자료는 호스트가 준 저장으로만 간다.
 *
 * 의존성 0 — Node 표준만.
 */
import { mkdir, writeFile, appendFile, chmod } from "node:fs/promises";
import { assertLocalWriteAllowed } from "../engine/host-context.js";

// PII·키 보호 디렉토리 권한 — SECURITY.md §3
export const SAFE_DIR_MODE = 0o700;

// PII·키 보호 파일 권한 — SECURITY.md §3
export const SAFE_FILE_MODE = 0o600;

// 사용자 전용 권한(0o700) 디렉토리 생성. 이미 존재하면 권한 변경하지 않음.
export async function ensureSecureDir(path: string): Promise<void> {
  assertLocalWriteAllowed("디렉토리 생성");
  await mkdir(path, { recursive: true, mode: SAFE_DIR_MODE });
}

// 사용자 전용 권한(0o600) JSON 파일 쓰기 (2-space indent).
export async function writeSecureJson(path: string, value: unknown): Promise<void> {
  assertLocalWriteAllowed("JSON 파일 쓰기");
  await writeFile(path, JSON.stringify(value, null, 2), { encoding: "utf8", mode: SAFE_FILE_MODE });
}

// 사용자 전용 권한(0o600) 텍스트 파일 쓰기.
export async function writeSecureText(path: string, content: string): Promise<void> {
  assertLocalWriteAllowed("글 파일 쓰기");
  await writeFile(path, content, { encoding: "utf8", mode: SAFE_FILE_MODE });
}

// 사용자 전용 권한(0o600) 텍스트 파일 쓰기 — 이미 존재하면 EEXIST throw (flag=wx).
// 같은 millisecond 동시 보관 시 덮어쓰기 방지에 사용.
export async function writeSecureTextExclusive(path: string, content: string): Promise<void> {
  assertLocalWriteAllowed("글 파일 쓰기");
  await writeFile(path, content, { encoding: "utf8", mode: SAFE_FILE_MODE, flag: "wx" });
}

// 사용자 전용 권한(0o600) 로그 추가 (append). mode 는 첫 생성 시에만 적용.
export async function appendSecureLog(path: string, line: string): Promise<void> {
  assertLocalWriteAllowed("기록 추가");
  await appendFile(path, line, { encoding: "utf8", mode: SAFE_FILE_MODE });
}

// 기존 파일 권한을 0o600 으로 강제. copyFile 등으로 source mode 가 보존된 경우 사용.
export async function chmodSecureFile(path: string): Promise<void> {
  assertLocalWriteAllowed("권한 변경");
  await chmod(path, SAFE_FILE_MODE);
}
