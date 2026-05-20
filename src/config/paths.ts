/**
 * paths.ts — 로컬 저장소 경로 단일 출처 (SSoT)
 *
 * 외부 평가 보고서 (2026-05-20) — 저장소 경로 불일치 해소:
 *   이전: src/lib/local-storage.ts:28 (`STORAGE_ROOT = ~/.agent-safety-oss` 고정),
 *         src/lib/site-profile.ts, src/lib/photo-storage.ts, src/lib/safety-issue-storage.ts,
 *         src/lib/corrective-action-storage.ts, src/lib/company-key.ts, src/lib/trace-recorder.ts
 *         가 각자 동일 로직을 중복 정의 → SAFETY_LOCAL_DIR 환경변수 반영이 모듈마다 달랐음.
 *
 *   이후: 본 모듈의 함수만 사용. 모든 로컬 storage 모듈이 동일 root 를 본다.
 *
 * 환경변수:
 *   SAFETY_LOCAL_DIR — 비어있지 않으면 그 절대경로를 root 로 사용 (테스트 격리·portable install·
 *                      회사 정책에 따른 비-홈 디렉토리 사용 등).
 *                      미설정 시 ~/.agent-safety-oss.
 *
 * 호출 시점 평가:
 *   모듈 load 시점 1회가 아니라 함수 호출 시점에 process.env 를 읽는다 — 테스트가 setUp 에서
 *   환경변수를 바꿔도 즉시 반영되도록.
 */
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_DIR_NAME = ".agent-safety-oss";
const ENV_NAME = "SAFETY_LOCAL_DIR";

/** 로컬 저장소 root. SAFETY_LOCAL_DIR 우선, 미설정 시 ~/.agent-safety-oss. */
export function getStorageRoot(): string {
  const override = process.env[ENV_NAME]?.trim();
  return override ? resolve(override) : resolve(homedir(), DEFAULT_DIR_NAME);
}

export function getDraftsDir(): string {
  return join(getStorageRoot(), "drafts");
}

export function getDocumentsDir(): string {
  return join(getStorageRoot(), "documents");
}

export function getActivityLogPath(): string {
  return join(getStorageRoot(), "activity.log");
}

export function getProfileFilePath(): string {
  return join(getStorageRoot(), "profile.jsonld");
}

export function getCompanyKeyPath(): string {
  return join(getStorageRoot(), "company-key.json");
}

export function getTracesDir(): string {
  return join(getStorageRoot(), "traces");
}

export function getPhotosDir(): string {
  return join(getStorageRoot(), "photos");
}

export function getIssuesDir(): string {
  return join(getStorageRoot(), "issues");
}

export function getActionsDir(): string {
  return join(getStorageRoot(), "actions");
}

export function getReportsDir(): string {
  return join(getStorageRoot(), "reports");
}
