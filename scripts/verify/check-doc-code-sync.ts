#!/usr/bin/env tsx
/**
 * check-doc-code-sync.ts — 문서·코드 SSoT drift 자동 검출
 *
 * 코드에서 직접 추출한 정답값과 docs/README/주석의 표기를 비교.
 * release 전 prepublishOnly 에 추가하여 drift 차단.
 *
 * 검출 항목:
 *   1. package.json version vs README badges / SECURITY.md / docs/*
 *   2. 도구 수 (실측 vs description / docs / 주석)
 *   3. 제거된 도구 이름 잔존 (get_kosha_guide_content, search_kosha_guides 등)
 *   4. KOSHA Guide 번들 정책 (v1.1.17+ "번들" vs 옛 "Live API only")
 *   5. 옛 host 표기 잔존 (Cursor)
 *   6. 황룡건설 ↔ 라텔웍스 직책 표기 (이사 / 대표이사)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

interface DriftIssue {
  severity: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  file: string;
  line?: number;
  expected: string;
  found: string;
  hint?: string;
}

const issues: DriftIssue[] = [];

// ============================================================
// 1) SSoT 정답값 추출 (코드에서 직접)
// ============================================================
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const SSoT = {
  version: pkg.version as string,
  // 도구 수: tool-registry 의 TOOLS 배열 실측 — build/ 컴파일된 결과를 import
  // 빌드 전이면 정확하지 않을 수 있어 description 기준 표기만 검증
  toolCountFromDesc: (() => {
    const m = pkg.description.match(/(\d+)\s+MCP\s+tools/);
    return m ? parseInt(m[1]) : null;
  })(),
  // KOSHA Guide 번들 — src/ontology/kosha-guides/*.md 카운트
  koshaGuideBundleCount: readdirSync(resolve(ROOT, "src/ontology/kosha-guides"))
    .filter((f) => f.endsWith(".md")).length,
};

// 제거된 도구 (v1.1.19 통합)
const REMOVED_TOOLS = ["get_kosha_guide_content", "search_kosha_guides"];

// 메인 host (v1.1.19 정합)
const MAIN_HOSTS = ["Claude Desktop", "OpenAI Codex CLI"];

// 직책 매핑 SSoT
const TITLE_MAP = {
  "라텔웍스 황룡": "대표이사",
  "황룡건설 황룡": "이사",
};

// ============================================================
// 2) 파일 순회
// ============================================================
function walk(dir: string, files: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      // 검사 제외 디렉토리 (자동 생성된 산출물·git·archive)
      if (["node_modules", "build", "dist", ".git", "_archive", "artifacts"].includes(e)) continue;
      if (full.includes("docs/archive")) continue;
      if (full.includes(".internal/archive")) continue;
      if (full.includes(".internal")) continue;
      walk(full, files);
    } else {
      // 검사 대상 확장자 — reports/*.md 도 검사 (수동 작성 리포트 drift 검출)
      // reports/ 안의 자동 생성 .json 은 제외
      if (full.includes("/reports/") && !e.endsWith(".md")) continue;
      if (/\.(md|json|jsonld|ts|yml)$/.test(e)) files.push(full);
    }
  }
  return files;
}

function scanFile(file: string) {
  if (file.includes("CHANGELOG.md")) return; // 히스토리는 정합 제외
  if (file.includes(".bak")) return;
  // 검증 스크립트 자체는 정규식 패턴이 자기 매칭되므로 제외
  if (file.includes("check-doc-code-sync.ts")) return;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = text.split("\n");
  const rel = file.replace(ROOT + "/", "");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // === 검출 1: 제거된 도구 잔존 ===
    for (const removed of REMOVED_TOOLS) {
      if (line.includes(removed)) {
        // 의도적 deprecation 주석은 제외 (release marker 또는 deprecation 키워드 보유)
        if (
          /v1\.[12]\.\d+/.test(line) || // release marker (v1.1.x / v1.2.x)
          line.includes("제거") ||
          line.includes("deprecated") ||
          line.includes("DEPRECATED") ||
          line.includes("통합") ||
          line.includes("종전") ||
          // 함수 내부 변수명 (searchKoshaGuidesMd 는 별개)
          line.includes("searchKoshaGuidesMd")
        ) continue;
        issues.push({
          severity: "HIGH",
          category: "removed_tool_residual",
          file: rel,
          line: lineNo,
          expected: "get_kosha_guide_md (v1.1.19 통합)",
          found: removed,
          hint: "v1.1.19 에서 제거된 도구 이름 잔존. 의도적 deprecation 표기가 아니라면 정정 필요.",
        });
      }
    }

    // === 검출 2: 잘못된 KOSHA 번들 정책 ===
    if (
      /KOSHA Guide 본문.*미배포|KOSHA Guide 본문.*Live API 로만|본문.*번들 제외|본문은 Live API/.test(line)
    ) {
      issues.push({
        severity: "HIGH",
        category: "stale_kosha_policy",
        file: rel,
        line: lineNo,
        expected: "v1.1.17+ 부터 1,039건 번들 포함",
        found: line.trim().slice(0, 100),
        hint: "v1.1.17 부터 KOSHA Guide 본문 1,039건이 번들 포함됨. 옛 'Live API only' 정책 표기.",
      });
    }

    // === 검출 4 (v1.3.0+): 현재 release version 자동 매치 (HIGH) ===
    // README badge / SECURITY 현재 안정판 → SSoT.version 정확 일치
    // 매 release 시 sed 빼먹어도 CI 차단 (사용자 비판: "여전히 문서 정리 안 됨" 자동화)

    // README badge: [![Release](https://img.shields.io/badge/release-vN.N.N-...)]
    const badgeMatch = line.match(/release-v(\d+\.\d+\.\d+)/);
    if (badgeMatch && badgeMatch[1] !== SSoT.version) {
      issues.push({
        severity: "HIGH",
        category: "stale_release_badge",
        file: rel,
        line: lineNo,
        expected: `release-v${SSoT.version}`,
        found: `release-v${badgeMatch[1]}`,
        hint: "README badge release-v 가 package.json version 과 불일치. 매 release bump 시 동기화 필수.",
      });
    }

    // SECURITY 현재 안정판 (vN.N.N)
    const stableMatch = line.match(/현재 안정판\s*\(v(\d+\.\d+\.\d+)\)/);
    if (stableMatch && stableMatch[1] !== SSoT.version) {
      issues.push({
        severity: "HIGH",
        category: "stale_release_marker",
        file: rel,
        line: lineNo,
        expected: SSoT.version,
        found: stableMatch[1],
        hint: "SECURITY 의 '현재 안정판' 표기가 package.json 과 불일치.",
      });
    }

    // SECURITY supported 표 행 (| 1.X.x | ✅ ...) — minor 가 SSoT.minor 와 일치
    const supportedRowMatch = line.match(/^\|\s*(\d+\.\d+)\.x\s*\|\s*✅/);
    if (supportedRowMatch) {
      const ssotMinor = SSoT.version.split(".").slice(0, 2).join(".");
      if (supportedRowMatch[1] !== ssotMinor) {
        issues.push({
          severity: "HIGH",
          category: "stale_supported_minor",
          file: rel,
          line: lineNo,
          expected: `${ssotMinor}.x`,
          found: `${supportedRowMatch[1]}.x`,
          hint: "SECURITY 지원 버전 표의 ✅ minor 가 package.json minor 와 불일치.",
        });
      }
    }

    // === 검출 3: 옛 버전 표기 (1.1.18 이하) ===
    const oldVerMatch = line.match(/v?1\.1\.(1[0-7]|[0-9])\b/);
    if (oldVerMatch) {
      const oldVer = oldVerMatch[0];
      // 히스토리 표기는 OK (예: "v1.1.10 ~ v1.1.18 변경")
      if (
        line.includes("이전") ||
        line.includes("~") ||
        line.includes("부터") ||
        line.includes("이후") ||
        line.includes("측정 기준") ||
        line.includes("기준일") ||
        line.includes("until") ||
        line.includes("from") ||
        line.includes("v1.1.17 부터") ||
        line.includes("v1.1.18 ") ||
        line.includes("(v0") ||  // v0.x 변경 히스토리
        line.includes("이력") ||
        rel.match(/scripts\/migrations/) ||
        rel.match(/(prep|dev|README)/) && line.includes("v1.1.10") // 측정 기준 표기 허용
      ) continue;
      // 단일 "v1.1.11 (현재 안정판)" 같은 직접 표기만
      if (/현재|안정판|stable|latest|^\| 1\.1/.test(line)) {
        issues.push({
          severity: "MEDIUM",
          category: "stale_version",
          file: rel,
          line: lineNo,
          expected: `v${SSoT.version}`,
          found: oldVer,
          hint: "release SSoT 보다 옛 버전이 '현재' 또는 '안정판' 으로 표기됨.",
        });
      }
    }

    // === 검출 4: Cursor 메인 host 표기 (v1.1.19 제거) ===
    if (
      /Cursor.*MCP host|MCP host.*Cursor|메인.*Cursor|Cursor.*메인|Cursor.*대등|cursor\.manual\.md|Cursor 와 대등/.test(
        line,
      )
    ) {
      // 의도적 기록 (REMOVED v1.1.19 등) 제외
      if (line.includes("v1.1.19") || line.includes("제거")) continue;
      issues.push({
        severity: "MEDIUM",
        category: "stale_host_cursor",
        file: rel,
        line: lineNo,
        expected: "Claude Desktop · OpenAI Codex CLI 만 메인",
        found: line.trim().slice(0, 100),
        hint: "Cursor 는 v1.1.19 에서 메인 host 에서 제거됨.",
      });
    }

    // === 검출 5: 잘못된 직책 (라텔웍스 이사 / 황룡건설 대표) ===
    if (/라텔웍스.*이사 황룡|이사 황룡.*라텔웍스/.test(line)) {
      // "황룡건설 이사 황룡 / 라텔웍스 대표이사" 패턴 제외
      if (line.includes("황룡건설") && line.includes("대표이사")) continue;
      issues.push({
        severity: "HIGH",
        category: "incorrect_title",
        file: rel,
        line: lineNo,
        expected: "라텔웍스 대표이사 황룡",
        found: "라텔웍스 ... 이사 황룡 (잘못)",
        hint: "라텔웍스 = 대표이사 황룡, 황룡건설 = 이사 황룡.",
      });
    }
    if (/황룡건설.*대표.*황룡|대표.*황룡.*황룡건설/.test(line)) {
      // 대표 = 황한일 정합
      if (line.includes("황한일")) continue;
      issues.push({
        severity: "MEDIUM",
        category: "incorrect_title",
        file: rel,
        line: lineNo,
        expected: "황룡건설 대표 = 황한일, 이사 = 황룡",
        found: "황룡건설 ... 대표 황룡 (잘못)",
        hint: "황룡건설 대표자 = 황한일. 황룡은 황룡건설 이사.",
      });
    }
  }
}

// ============================================================
// 3) 실행
// ============================================================
const files = walk(ROOT);
for (const f of files) scanFile(f);

// 출력
const grouped = issues.reduce((acc, i) => {
  acc[i.severity] = (acc[i.severity] || []);
  acc[i.severity].push(i);
  return acc;
}, {} as Record<string, DriftIssue[]>);

console.log("doc-code SSoT drift 검증");
console.log(`SSoT 기준값:`);
console.log(`  - version: ${SSoT.version}`);
console.log(`  - description 내 도구 수: ${SSoT.toolCountFromDesc}`);
console.log(`  - KOSHA Guide 번들: ${SSoT.koshaGuideBundleCount} 건`);
console.log(`  - 제거 도구: ${REMOVED_TOOLS.join(", ")}`);
console.log(`  - 메인 host: ${MAIN_HOSTS.join(" · ")}`);
console.log();
console.log(`발견 issues:`);
console.log(`  HIGH:   ${(grouped.HIGH || []).length}`);
console.log(`  MEDIUM: ${(grouped.MEDIUM || []).length}`);
console.log(`  LOW:    ${(grouped.LOW || []).length}`);
console.log();

for (const sev of ["HIGH", "MEDIUM", "LOW"] as const) {
  const list = grouped[sev] || [];
  if (list.length === 0) continue;
  console.log(`[${sev}] ${list.length}건`);
  // 카테고리별 그룹
  const byCat = list.reduce((acc, i) => {
    acc[i.category] = (acc[i.category] || []);
    acc[i.category].push(i);
    return acc;
  }, {} as Record<string, DriftIssue[]>);
  for (const [cat, items] of Object.entries(byCat)) {
    console.log(`  [${cat}] ${items.length} 건`);
    for (const item of items.slice(0, 5)) {
      console.log(`    · ${item.file}:${item.line} — ${item.found.slice(0, 70)}`);
    }
    if (items.length > 5) console.log(`    ... 외 ${items.length - 5} 건`);
  }
  console.log();
}

if ((grouped.HIGH || []).length > 0) {
  console.error(`✗ HIGH ${(grouped.HIGH || []).length} 건 발견. release blocker.`);
  process.exit(1);
}
console.log(`✓ HIGH 0 건 — release OK`);
process.exit(0);
