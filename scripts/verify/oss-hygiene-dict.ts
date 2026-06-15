/**
 * oss-hygiene-dict.ts — 공개 위생 검사 사전 (공유 모듈)
 *
 * check-oss-hygiene.ts (publish/merge 게이트) 와
 * release/extract-release-notes.ts (GitHub Release 노트 게이트) 가 같은 사전을 사용한다.
 * 사전 갱신은 이 파일 한 곳에서만 한다.
 */

// ── 내부 용어 사전 ──────────────────────────────────────────
// 운영 에이전트명 / 내부 문서 체계 / 내부 git 트레일러.
// 회사명(황룡건설·라텔웍스·㈜라텔웍스)·Co-Authored-By 는 크레딧 맥락이므로 사전에 없음 (허용).
export const INTERNAL_TERMS = [
  // 자기학습 메모리 / 내부 운영 용어 · 내부 전략 언어
  "박제",
  "서브웨이",
  "만다라트",
  "해자",
  "영속 자산",
  // 운영 에이전트명 (a-* 계열)
  "a-dev",
  "a-git",
  "a-deploy",
  "a-qa",
  "a-prep",
  "a-codex",
  "a-labs",
  "a-biz",
  "a-gpt",
  "a-medium",
  "a-proposal",
  "a-dogfooding",
  "a-frontend",
  "a-backend",
  // 내부 문서 체계 (파일명 — 'testsuite' 일반어 아님, '.md' 만)
  "prep.md",
  "dev.md",
  "plan.md",
  "testsuite.md",
  // 내부 git 트레일러
  "Session-Id",
  "Work-Scope",
  "Agent-Source",
  "Interruption-Reason",
  "Continues",
];

// ── 내부 경로 ───────────────────────────────────────────────
export const INTERNAL_PATHS = ["/Users/", "dev/A_/", "dev/Agent_HQ/", "~/.claude"];

// ── PII ─────────────────────────────────────────────────────
// 개인 이메일 (회사 공식 alphamale@ratelworks.co.kr 은 검사 안 함)
export const PERSONAL_EMAIL = "ryongkoon1984@gmail.com";
// 사업자번호 XXX-XX-XXXXX / 법인번호 XXXXXX-XXXXXXX
export const BIZ_NUMBER_RE = /\b\d{3}-\d{2}-\d{5}\b/;
export const CORP_NUMBER_RE = /\b\d{6}-\d{7}\b/;
// placeholder 는 PII 가 아님 (예시 표기) — 매칭되어도 위반에서 제외
export const PLACEHOLDER_PATTERNS = [
  /^0{3}-0{2}-0{5}$/, // 000-00-00000
  /^[xX]{3}-[xX]{2}-[xX]{5}$/, // XXX-XX-XXXXX
  /^0{6}-0{7}$/, // 000000-0000000
  /^[xX]{6}-[xX]{7}$/, // XXXXXX-XXXXXXX
];
