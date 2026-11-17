/**
 * isolated-storage.ts — 시험·개발 스크립트가 문서 파일을 사용자 보관 폴더에 남기지 않게 한다
 *
 * generate_safety_document 는 기본으로 정본(.dclx)을 저장한다. 이 모듈을 스크립트 맨 앞에서 불러오면
 * 저장 폴더(SAFETY_LOCAL_DIR)가 비어 있을 때 임시 폴더로 정한다 — 이미 정해 두었으면 그대로 둔다.
 * 사업장 정보도 같은 폴더에서 읽으므로, 사용자 컴퓨터의 등록 정보에 따라 시험 결과가 달라지지 않는다.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── 상수 ────────────────────────────────────────────────────────────
const ENV_NAME = "SAFETY_LOCAL_DIR";
const TEMP_PREFIX = "agent-safety-oss-script-";

if (!process.env[ENV_NAME]?.trim()) process.env[ENV_NAME] = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
