#!/usr/bin/env tsx
/**
 * extract-release-notes.ts — GitHub Release 노트·제목 게이트 (oss-publishing 릴리즈 규칙 강제)
 *
 * 본질: 릴리즈 노트의 SSoT 는 CHANGELOG 의 해당 버전 섹션이다.
 * CHANGELOG 는 이미 3중 위생 게이트(pre-commit / CI / prepublishOnly)를 통과한 텍스트이므로,
 * Release 노트를 여기서만 추출하면 손으로 쓴 비검증 노트가 공개되는 경로가 사라진다.
 * `.github/workflows/release.yml` 이 tag push 시 본 스크립트로 노트·제목을 생성한다.
 *
 * 검증 (위반 시 exit 1 — Release 생성 차단):
 *   1. `## [X.Y.Z] — YYYY-MM-DD` 섹션 존재 + package.json version 일치
 *   2. 한 줄 가치 요약 존재 (헤더 바로 다음 일반 문단) — Release 제목의 SSoT, 70자 이내
 *   3. 내부 용어 / 내부 경로 / PII (oss-hygiene-dict 공유 사전)
 *   4. 구현 디테일 — 코드 내부 경로(src/ scripts/ build/) 언급 금지 (사용자 관점 위반.
 *      docs/ 링크·AGENTS.md 등 사용자용 문서는 허용)
 *
 * 출력 모드:
 *   --check          검증만 (CI 게이트)
 *   --title          Release 제목 1줄: "vX.Y.Z — {한 줄 요약}"
 *   (기본)           Release 본문: 섹션 내용 + 표준 footer (설치·업그레이드 / breaking 명시 / 크레딧)
 *   --version X.Y.Z  대상 버전 지정 (생략 시 package.json)
 *   --out <file>     본문을 파일로 저장
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTERNAL_TERMS,
  INTERNAL_PATHS,
  PERSONAL_EMAIL,
  BIZ_NUMBER_RE,
  CORP_NUMBER_RE,
  PLACEHOLDER_PATTERNS,
} from "../verify/oss-hygiene-dict.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ── 상수 ────────────────────────────────────────────────────
const REPO_URL = "https://github.com/ratelworks/agent-safety-oss";
const TITLE_MAX_LEN = 70; // "vX.Y.Z — " 접두 제외 한 줄 요약 길이 상한
// 코드 내부 경로 — Release 노트(사용자 대상)에 등장하면 구현 디테일 누출
const CODE_PATH_RE = /(^|[\s(`])(src|scripts|build)\//;

// ── 인자 파싱 ───────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const version: string = opt("--version") ?? pkg.version;

// ── CHANGELOG 섹션 추출 ─────────────────────────────────────
const changelog = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
const lines = changelog.split("\n");

const headerRe = new RegExp(
  `^## \\[${version.replace(/\./g, "\\.")}\\]\\s*[—-]\\s*(\\d{4}-\\d{2}-\\d{2})`,
);
let start = -1;
let date = "";
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(headerRe);
  if (m) {
    start = i;
    date = m[1];
    break;
  }
}

const errors: string[] = [];

if (start < 0) {
  errors.push(
    `CHANGELOG 에 "## [${version}] — YYYY-MM-DD" 섹션이 없음 — release 전 CHANGELOG 작성이 선행되어야 함 (Unreleased 헤더로는 release 불가)`,
  );
  fail(errors);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^## \[/.test(lines[i])) {
    end = i;
    break;
  }
}
const sectionLines = lines.slice(start + 1, end);
const section = sectionLines.join("\n").trim();

// ── 검증 2: 한 줄 가치 요약 (제목 SSoT) ──────────────────────
// 헤더 바로 다음의 첫 비공백 줄이 "### ..." 소제목이 아닌 일반 문단이어야 한다.
const firstContent = sectionLines.find((l) => l.trim() !== "");
let summary = "";
if (!firstContent || firstContent.trim().startsWith("#")) {
  errors.push(
    `[${version}] 섹션에 한 줄 가치 요약이 없음 — 헤더 바로 다음에 "이 릴리즈로 무엇을 얻나" 한 문장을 사용자 관점으로 작성 (Release 제목으로 사용됨)`,
  );
} else {
  summary = firstContent.trim().replace(/[.。]\s*$/, ""); // 끝 마침표 제거 (제목용)
  if (summary.length > TITLE_MAX_LEN) {
    errors.push(
      `한 줄 요약이 ${summary.length}자 — 제목 상한 ${TITLE_MAX_LEN}자 초과. CHANGELOG 의 첫 문장을 더 짧게 다듬을 것: "${summary.slice(0, 50)}…"`,
    );
  }
}

// ── 검증 3: 위생 사전 (내부 용어 / 내부 경로 / PII) ──────────
const sectionForScan = sectionLines;
sectionForScan.forEach((line, idx) => {
  const lineNo = start + 2 + idx; // CHANGELOG 실제 줄 번호 (1-base)
  for (const term of INTERNAL_TERMS) {
    if (line.includes(term)) {
      errors.push(`L${lineNo}: 내부 용어 "${term}" — 외부 사용자 어휘로 교체`);
    }
  }
  for (const p of INTERNAL_PATHS) {
    if (line.includes(p)) {
      errors.push(`L${lineNo}: 내부 경로 "${p}" 노출`);
    }
  }
  if (line.includes(PERSONAL_EMAIL)) {
    errors.push(`L${lineNo}: 개인 이메일 노출`);
  }
  for (const re of [BIZ_NUMBER_RE, CORP_NUMBER_RE]) {
    const m = line.match(re);
    if (m && !PLACEHOLDER_PATTERNS.some((p) => p.test(m[0]))) {
      errors.push(`L${lineNo}: 사업자/법인번호 패턴 "${m[0]}" 노출`);
    }
  }
  // ── 검증 4: 구현 디테일 (코드 내부 경로) ──
  if (CODE_PATH_RE.test(line)) {
    errors.push(
      `L${lineNo}: 코드 내부 경로(src/·scripts/·build/) 언급 — Release 노트는 사용자 관점("무엇을 얻나")으로. 구현 상세는 commit/PR 로: "${line.trim().slice(0, 60)}…"`,
    );
  }
});

if (errors.length > 0) fail(errors);

// ── 출력 ────────────────────────────────────────────────────
if (flag("--check")) {
  console.log(`✅ release-notes gate PASS — [${version}] (${date}) 섹션 검증 통과`);
  process.exit(0);
}

if (flag("--title")) {
  console.log(`v${version} — ${summary}`);
  process.exit(0);
}

// 상대 링크 → 절대 URL (CHANGELOG 의 ./docs/... 는 Release 페이지 컨텍스트에서 깨짐)
const sectionAbs = section.replace(/\]\(\.\//g, `](${REPO_URL}/blob/main/`);

// breaking change 명시 강제: 섹션에 언급 없으면 "없습니다" 문구 자동 부착
const hasBreaking = /breaking|호환성/i.test(section);
const breakingLine = hasBreaking
  ? ""
  : "\n호환성에 영향을 주는 변경(breaking change)은 없습니다.\n";

const body = `${sectionAbs}

---

## 설치 / 업그레이드

처음 시작 (Node.js 20.19+ 만 있으면 됩니다):

\`\`\`bash
npx -y agent-safety-oss viewer   # 브라우저 입력 폼이 바로 열립니다
\`\`\`

Claude Desktop / Codex CLI 연결은 [README 의 "시작하기"](${REPO_URL}#시작하기)를 따라 하면 됩니다. \`npx\` 로 쓰고 있다면 다음 실행 때 자동으로 최신 버전을 받습니다. 전역 설치 사용자는:

\`\`\`bash
npm install -g agent-safety-oss@latest
\`\`\`
${breakingLine}
---

- **제공**: 황룡건설(주) 안전보건기획부 · **개발**: 주식회사 라텔웍스 (Ratelworks Inc.)
- 전체 변경 내역: [CHANGELOG.md](${REPO_URL}/blob/main/CHANGELOG.md)
`;

const outFile = opt("--out");
if (outFile) {
  writeFileSync(resolve(ROOT, outFile), body, "utf8");
  console.log(`✅ release notes → ${outFile} (제목: v${version} — ${summary})`);
} else {
  process.stdout.write(body);
}

// ── 실패 처리 ───────────────────────────────────────────────
function fail(errs: string[]): never {
  console.error(`✗ release-notes gate FAIL — [${version}] 위반 ${errs.length}건. Release 생성 차단.\n`);
  for (const e of errs) console.error(`  · ${e}`);
  console.error(
    `\n  규칙: 한국어 · 사용자 관점 · 핵심만 · breaking 명시 · 코드 내부 경로/구현 디테일 금지`,
  );
  process.exit(1);
}
