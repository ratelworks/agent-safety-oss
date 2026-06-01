#!/usr/bin/env tsx
/**
 * check-oss-hygiene.ts — 외부 공개물 위생 게이트 (publish/CI 강제)
 *
 * 외부 노출 문서에 내부 운영 용어·내부 경로·PII 가 새어나가지 않았는지 검사한다.
 * 가이드라인은 "강제될 때만" 의미가 있으므로 prepublishOnly + CI 에 연결하여
 * npm publish 자체와 PR merge 를 차단한다.
 *
 * self-contained — node 내장 + repo 내부 파일만 사용 (외부 인프라/glob 의존 없음).
 *
 * 검사 대상 (repo 내):
 *   README.md, CHANGELOG.md, CONTRIBUTING.md, docs 하위 *.md, package.json
 *
 * 검사 항목 (하나라도 발견 시 exit 1):
 *   1. 내부 용어 사전 (운영 에이전트명·내부 문서 체계·내부 트레일러)
 *   2. 내부 경로 (/Users/, dev/A_/, dev/Agent_HQ/, ~/.claude)
 *   3. PII (개인 이메일·사업자번호·법인번호) — placeholder 는 제외
 *   4. 내부 문서 체계 파일이 public repo 에 tracked (CLAUDE/dev/plan/prep.md) — git ls-files 기반
 *
 * 버전 일치 검사는 본 게이트 범위 밖 (check:doc-sync / docs:check 가 담당).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ── 검사 대상 ──────────────────────────────────────────────
// repo 루트의 고정 문서 4종 + docs 디렉토리 하위 모든 *.md
const TARGET_ROOT_FILES = ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "package.json"];
const TARGET_DOCS_DIR = "docs";
const DOC_EXTENSION = ".md";

// ── 검사 항목 1: 내부 용어 사전 ─────────────────────────────
// 운영 에이전트명 / 내부 문서 체계 / 내부 git 트레일러.
// 회사명(황룡건설·라텔웍스·㈜라텔웍스)·Co-Authored-By 는 크레딧 맥락이므로 사전에 없음 (허용).
const INTERNAL_TERMS = [
  // 자기학습 메모리 / 내부 운영 용어
  "박제",
  "서브웨이",
  "만다라트",
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
  // 내부 문서 체계
  "prep.md",
  "dev.md",
  "plan.md",
  // 내부 git 트레일러
  "Session-Id",
  "Work-Scope",
  "Agent-Source",
  "Interruption-Reason",
  "Continues",
];

// ── 검사 항목 2: 내부 경로 ──────────────────────────────────
const INTERNAL_PATHS = ["/Users/", "dev/A_/", "dev/Agent_HQ/", "~/.claude"];

// ── 검사 항목 4: 내부 문서 체계 파일 (git tracked) ──────────
// 내부 전용 문서(CLAUDE.md / dev.md / plan.md / prep.md)가 public repo 에 tracked 되면 위반.
// 루트·하위 어디에 있든 매칭 (경로 끝의 파일명만 검사).
const INTERNAL_DOC_RE = /(^|\/)(CLAUDE|dev|plan|prep)\.md$/;

// ── 검사 항목 3: PII ────────────────────────────────────────
// 개인 이메일 (회사 공식 alphamale@ratelworks.co.kr 은 검사 안 함)
const PERSONAL_EMAIL = "ryongkoon1984@gmail.com";
// 사업자번호 XXX-XX-XXXXX / 법인번호 XXXXXX-XXXXXXX
const BIZ_NUMBER_RE = /\b\d{3}-\d{2}-\d{5}\b/;
const CORP_NUMBER_RE = /\b\d{6}-\d{7}\b/;
// placeholder 는 PII 가 아님 (예시 표기) — 매칭되어도 위반에서 제외
const PLACEHOLDER_PATTERNS = [
  /^0{3}-0{2}-0{5}$/, // 000-00-00000
  /^[xX]{3}-[xX]{2}-[xX]{5}$/, // XXX-XX-XXXXX
  /^0{6}-0{7}$/, // 000000-0000000
  /^[xX]{6}-[xX]{7}$/, // XXXXXX-XXXXXXX
];

interface Violation {
  category: "internal_term" | "internal_path" | "pii" | "tracked_internal_doc";
  file: string; // ROOT 기준 상대경로
  line: number; // 1-base (파일 단위 검사는 0)
  found: string; // 발견 토큰
  hint: string;
}

const violations: Violation[] = [];

// placeholder 여부 판정 (PII 정규식 매칭 문자열 대상)
function isPlaceholder(token: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(token));
}

// 한 파일을 라인 단위로 스캔
function scanFile(file: string): void {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  const rel = file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // 1) 내부 용어
    for (const term of INTERNAL_TERMS) {
      if (line.includes(term)) {
        violations.push({
          category: "internal_term",
          file: rel,
          line: lineNo,
          found: term,
          hint: "내부 운영 용어가 외부 공개물에 노출됨. 외부 표현으로 정정하거나 제거.",
        });
      }
    }

    // 2) 내부 경로
    for (const path of INTERNAL_PATHS) {
      if (line.includes(path)) {
        violations.push({
          category: "internal_path",
          file: rel,
          line: lineNo,
          found: path,
          hint: "내부 파일/홈 경로가 노출됨. 외부 사용자 무관 경로는 제거.",
        });
      }
    }

    // 3-a) 개인 이메일
    if (line.includes(PERSONAL_EMAIL)) {
      violations.push({
        category: "pii",
        file: rel,
        line: lineNo,
        found: PERSONAL_EMAIL,
        hint: "개인 이메일 노출. 회사 공식 이메일(alphamale@ratelworks.co.kr) 로 대체.",
      });
    }

    // 3-b) 사업자번호 (placeholder 제외)
    const bizMatch = line.match(BIZ_NUMBER_RE);
    if (bizMatch && !isPlaceholder(bizMatch[0])) {
      violations.push({
        category: "pii",
        file: rel,
        line: lineNo,
        found: bizMatch[0],
        hint: "사업자번호 노출. placeholder(000-00-00000) 가 아니면 제거.",
      });
    }

    // 3-c) 법인번호 (placeholder 제외)
    const corpMatch = line.match(CORP_NUMBER_RE);
    if (corpMatch && !isPlaceholder(corpMatch[0])) {
      violations.push({
        category: "pii",
        file: rel,
        line: lineNo,
        found: corpMatch[0],
        hint: "법인번호 노출. placeholder(000000-0000000) 가 아니면 제거.",
      });
    }
  }
}

// docs 디렉토리 하위 *.md 재귀 수집 (node:fs 만 사용 — glob 의존 없음)
function collectDocs(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectDocs(full, files);
    } else if (st.isFile() && entry.endsWith(DOC_EXTENSION)) {
      files.push(full);
    }
  }
  return files;
}

// 검사 항목 4: git tracked 파일 중 내부 문서 체계 파일 탐지.
// git 은 repo 빌드 환경의 필수 도구이므로 호출 허용 (npm 패키지 의존 아님).
// git 미설치·non-git 디렉토리 등 실패 시 graceful skip (다른 검사는 계속).
function scanTrackedInternalDocs(): void {
  let out: string;
  try {
    out = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" });
  } catch {
    // git 호출 실패 시 본 검사만 생략
    return;
  }
  for (const path of out.split("\n")) {
    const file = path.trim();
    if (file && INTERNAL_DOC_RE.test(file)) {
      violations.push({
        category: "tracked_internal_doc",
        file,
        line: 0,
        found: file,
        hint: `내부 문서 체계 ${file} 가 public repo 에 tracked — .gitignore + git rm, 외부용은 AGENTS.md/ROADMAP.md/CONTRIBUTING.md 로 대체`,
      });
    }
  }
}

// ── 검사 대상 수집 ──────────────────────────────────────────
const targets: string[] = [];
for (const name of TARGET_ROOT_FILES) {
  const full = resolve(ROOT, name);
  if (existsSync(full)) targets.push(full);
}
targets.push(...collectDocs(resolve(ROOT, TARGET_DOCS_DIR)));

// ── 실행 ────────────────────────────────────────────────────
for (const file of targets) scanFile(file);
scanTrackedInternalDocs();

// ── 출력 ────────────────────────────────────────────────────
console.log("OSS hygiene 검증 (내부 용어 / 내부 경로 / PII / 내부 문서 tracked)");
console.log(`검사 대상: ${targets.length} 파일 + git tracked 내부 문서`);
console.log();

if (violations.length === 0) {
  console.log("✅ OSS hygiene PASS");
  process.exit(0);
}

// 카테고리별 그룹 출력
const byCat = violations.reduce(
  (acc, v) => {
    (acc[v.category] ||= []).push(v);
    return acc;
  },
  {} as Record<Violation["category"], Violation[]>,
);

const CATEGORY_LABEL: Record<Violation["category"], string> = {
  internal_term: "내부 용어",
  internal_path: "내부 경로",
  pii: "PII",
  tracked_internal_doc: "내부 문서 tracked",
};

for (const cat of ["internal_term", "internal_path", "pii", "tracked_internal_doc"] as const) {
  const list = byCat[cat];
  if (!list || list.length === 0) continue;
  console.error(`[${CATEGORY_LABEL[cat]}] ${list.length}건`);
  // tracked_internal_doc 은 파일 단위 검사(line=0) — 위치 대신 파일명만 출력
  for (const v of list) {
    console.error(cat === "tracked_internal_doc" ? `  · ${v.file}` : `  · ${v.file}:${v.line} — "${v.found}"`);
  }
  console.error(`  → ${list[0].hint}`);
  console.error();
}

console.error(`✗ OSS hygiene FAIL — 위반 ${violations.length}건. publish/merge 차단.`);
process.exit(1);
