#!/usr/bin/env tsx
/**
 * sync-docs.ts
 *
 * ADR 003 (Doc Drift Prevention) L2 — 9개 문서의 marker 영역을 INVENTORY 산출값으로 자동 갱신.
 *
 * 처리 패턴:
 *   1. `<!-- INV:KEY -->VALUE<!-- /INV:KEY -->` (본문 inline) — 정규식 치환
 *   2. shields.io badge URL — `release-v{VERSION}` / `MCP%20tools-{TOOLS_TOTAL}` 정규식 치환
 *
 * 실행:
 *   npm run docs:sync           # 자동 갱신 + write
 *   npm run docs:check          # dry-run + drift 있으면 exit 1 (CI / pre-commit 용)
 *   npx tsx scripts/build/sync-docs.ts [--check] [--verbose]
 *
 * 처리 대상: README.md · README-EN.md · CHANGELOG.md · CONTRIBUTING.md
 *           docs/SECURITY.md · docs/ARCHITECTURE.md · docs/IDENTITY.md
 *           docs/DATA_SOURCES.md · docs/OPERATIONAL-ONTOLOGY.md
 *
 * 신규 marker 키 추가 시:
 *   1. inventory-data.ts 의 collectInventoryData() 반환에 필드 추가
 *   2. 본 파일의 MARKER_MAP 에 key → 값 함수 추가
 *   3. 적용 대상 문서에 `<!-- INV:KEY -->초기값<!-- /INV:KEY -->` 삽입
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { collectInventoryData, ROOT, type InventoryData } from "./inventory-data.js";

const TARGET_DOCS: string[] = [
  // 외부 공개 최상위 문서
  "README.md",
  "README-EN.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "NOTICE.md",
  // docs/ 하위 문서
  "docs/ARCHITECTURE.md",
  "docs/IDENTITY.md",
  "docs/DATA_SOURCES.md",
  "docs/OPERATIONAL-ONTOLOGY.md",
  "docs/API-SPECS.md",
  "docs/JSONLD-AUTHORING-GUIDE.md",
  "docs/LEGAL-DUTY-LIFECYCLE.md",
  "docs/SETUP_CLAUDE_DESKTOP.md",
  "docs/SETUP_CODEX.md",
  // examples
  "examples/README.md",
];

function formatNumber(n: number, locale: boolean = true): string {
  return locale ? n.toLocaleString("en-US") : String(n);
}

// marker key → 산출 함수. inventory-data.ts 의 InventoryData 와 1:1 매핑.
const MARKER_MAP: Record<string, (d: InventoryData) => string> = {
  // KOSHA Guide
  KOSHA_BODY: (d) => formatNumber(d.kosha.bodyCount),
  KOSHA_META: (d) => formatNumber(d.kosha.metaCount),
  KOSHA_FAILURES: (d) => String(d.kosha.missingBodies.length),
  // MCP Tools
  TOOLS_TOTAL: (d) => String(d.tools.total),
  TOOLS_KEYLESS: (d) => String(d.tools.keyless),
  TOOLS_KEYREQ: (d) => String(d.tools.keyRequired),
  TOOLS_PLACEHOLDER: (d) => String(d.tools.stub),
  TOOLS_ACTIVE: (d) => String(d.tools.active),
  // 법령
  LAW_LAST_SYNC: (d) => d.latestLawSync,
  LAW_ARTICLES: (d) => formatNumber(d.lawArticleTotal),
  LAW_BUNDLE_COUNT: (d) => String(d.laws.length),
  // 그래프 — 1단계 vs 재귀 분리 (외부 사용자가 무엇이 무엇인지 알 수 있도록)
  GRAPH_TOTAL: (d) => formatNumber(d.graph.totalRecursive), // 재귀 (KOSHA 1,039 포함) — 외부 공개 표기
  GRAPH_TOPLEVEL: (d) => formatNumber(d.graph.totalTopLevel), // 카테고리 1단계만
  GRAPH_EDGES: (d) => formatNumber(d.graph.edges),
  GRAPH_ACTIVITIES: (d) => String(d.graph.byCategoryTopLevel.activities ?? 0),
  GRAPH_HAZARDS: (d) => String(d.graph.byCategoryTopLevel.hazards ?? 0),
  GRAPH_CONTROLS: (d) => String(d.graph.byCategoryTopLevel.controls ?? 0),
  // 법정문서 / docId 마스터
  DOCUMENTS_TOTAL: (d) => String(d.documentsTotal),
  DOCID_MASTER: (d) => String(d.docIdMaster),
  // 양식
  FORMS_TOTAL: (d) => String(d.forms.total),
  FORMS_HWP: (d) => String(d.forms.byFormat.hwp ?? 0),
  FORMS_PDF: (d) => String(d.forms.byFormat.pdf ?? 0),
  FORMS_XLSX: (d) => String(d.forms.byFormat.xlsx ?? 0),
  FORMS_MD: (d) => String(d.forms.byFormat.md ?? 0),
  // 패키지 버전
  VERSION: (d) => d.version,
};

interface DriftEntry {
  file: string;
  key: string;
  current: string;
  expected: string;
  context: string;
}

interface ProcessResult {
  file: string;
  changed: boolean;
  drifts: DriftEntry[];
  newContent: string;
  originalContent: string;
}

// `<!-- INV:KEY -->VALUE<!-- /INV:KEY -->` 패턴 매칭 + 치환
function processMarkers(content: string, file: string, data: InventoryData): ProcessResult {
  const drifts: DriftEntry[] = [];
  const re = /<!--\s*INV:([A-Z_]+)\s*-->([\s\S]*?)<!--\s*\/INV:\1\s*-->/g;
  const newContent = content.replace(re, (match, key: string, current: string) => {
    const fn = MARKER_MAP[key];
    if (!fn) {
      // 알 수 없는 키 — 그대로 두되 drift 로 기록 (사용자가 등록 깜빡한 경우)
      drifts.push({
        file,
        key,
        current,
        expected: "(unknown key — MARKER_MAP 미등록)",
        context: snippet(content, content.indexOf(match)),
      });
      return match;
    }
    const expected = fn(data);
    if (current.trim() !== expected) {
      drifts.push({
        file,
        key,
        current,
        expected,
        context: snippet(content, content.indexOf(match)),
      });
    }
    return `<!-- INV:${key} -->${expected}<!-- /INV:${key} -->`;
  });

  // shields.io badge URL — 정규식 치환 (marker 안 들어가는 위치)
  let finalContent = newContent;
  finalContent = replaceBadge(
    finalContent,
    /(\[!\[Release\][^)]*release-v)[\d.]+/g,
    data.version,
    file,
    "VERSION (badge)",
    drifts,
  );
  finalContent = replaceBadge(
    finalContent,
    /(\[!\[Tools\][^)]*MCP%20tools-)\d+/g,
    String(data.tools.total),
    file,
    "TOOLS_TOTAL (badge)",
    drifts,
  );

  return {
    file,
    changed: finalContent !== content,
    drifts,
    newContent: finalContent,
    originalContent: content,
  };
}

function snippet(content: string, index: number): string {
  if (index < 0) return "";
  const start = Math.max(0, index - 30);
  const end = Math.min(content.length, index + 60);
  return content
    .slice(start, end)
    .replace(/\n/g, " ")
    .trim();
}

function replaceBadge(
  content: string,
  pattern: RegExp,
  newValue: string,
  file: string,
  keyLabel: string,
  drifts: DriftEntry[],
): string {
  return content.replace(pattern, (match, prefix: string) => {
    const currentValue = match.slice(prefix.length);
    if (currentValue !== newValue) {
      drifts.push({
        file,
        key: keyLabel,
        current: currentValue,
        expected: newValue,
        context: match,
      });
    }
    return `${prefix}${newValue}`;
  });
}

interface RunOptions {
  check: boolean;
  verbose: boolean;
}

async function run(opts: RunOptions): Promise<number> {
  const data = await collectInventoryData();
  let totalChanges = 0;
  let totalDrifts = 0;
  const allDrifts: DriftEntry[] = [];
  const wroteFiles: string[] = [];

  for (const rel of TARGET_DOCS) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) {
      if (opts.verbose) console.warn(`[sync-docs] ${rel} 미발견 — skip`);
      continue;
    }
    const original = readFileSync(abs, "utf8");
    const result = processMarkers(original, rel, data);

    if (result.drifts.length > 0) {
      totalDrifts += result.drifts.length;
      allDrifts.push(...result.drifts);
    }

    if (result.changed) {
      totalChanges++;
      if (!opts.check) {
        writeFileSync(abs, result.newContent, "utf8");
        wroteFiles.push(rel);
        if (opts.verbose) console.log(`[sync-docs] ${rel}: 갱신 (${result.drifts.length} drift)`);
      } else if (opts.verbose) {
        console.log(`[sync-docs] ${rel}: drift ${result.drifts.length}건 (check mode — 미수정)`);
      }
    } else if (opts.verbose) {
      console.log(`[sync-docs] ${rel}: 정합 (변경 없음)`);
    }
  }

  // 결과 출력
  if (opts.check) {
    if (totalDrifts > 0) {
      console.error("");
      console.error(`❌ docs:check FAIL — ${totalDrifts}건 drift 검출`);
      console.error("");
      for (const d of allDrifts) {
        console.error(`  • ${d.file} :: ${d.key}`);
        console.error(`    현재: "${d.current}"`);
        console.error(`    예상: "${d.expected}"`);
        if (opts.verbose && d.context) console.error(`    context: ${d.context}`);
      }
      console.error("");
      console.error("정정: `npm run docs:sync` 실행 후 변경 사항 commit");
      console.error("");
      return 1;
    }
    console.log(`✅ docs:check PASS — ${TARGET_DOCS.length}개 문서 정합 (${totalChanges} 파일 marker 검출)`);
    return 0;
  }

  // sync 모드
  if (totalChanges === 0) {
    console.log(`[sync-docs] 변경 없음 — ${TARGET_DOCS.length}개 문서 모두 정합`);
    return 0;
  }
  console.log(`[sync-docs] ${totalChanges}개 파일 갱신: ${wroteFiles.join(", ")}`);
  return 0;
}

async function main(): Promise<void> {
  const opts: RunOptions = {
    check: process.argv.includes("--check"),
    verbose: process.argv.includes("--verbose") || process.argv.includes("-v"),
  };
  const exitCode = await run(opts);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
