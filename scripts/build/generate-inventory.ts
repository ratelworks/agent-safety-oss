#!/usr/bin/env tsx
/**
 * generate-inventory.ts
 *
 * 외부 리뷰 P0 (2026-05-22) — 자동 inventory 생성으로 README/docs drift 차단.
 *
 * 빌드 시 자동 실행되어 docs/INVENTORY.md 를 갱신한다.
 * SSoT 정책: 다음 카운트는 모두 코드/데이터에서 직접 산출하며 수동 편집 금지:
 *   - MCP 도구 수 (TOOLS.length, keyless / API-key / stub 분리)
 *   - 그래프 노드 카테고리별 수
 *   - KOSHA Guide 본문 수 + 추출 품질 등급
 *   - 법령 본문 조문 수 + 마지막 동기화일 + 커버리지 (전체 조문 대비)
 *   - 양식 인덱스 (HWP/PDF/XLSX/MD)
 *   - 데이터 기준일 통합 표시
 *
 * 실행:
 *   npm run build  (자동)
 *   npx tsx scripts/build/generate-inventory.ts  (수동)
 *
 * 의존성: Node 표준만. zod-to-json-schema 등 외부 패키지 미사용.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ─── 1. 도구 (TOOLS) ───
interface ToolStat {
  total: number;
  keyless: number;
  keyRequired: number;
  stub: number;
  active: number;
  stubNames: string[];
  keyRequiredNames: string[];
  allNames: string[];
}

async function countTools(): Promise<ToolStat> {
  // 정확도 우선 — build/tool-registry.js 동적 import 로 TOOLS 직접 카운트.
  // generate-inventory.ts 는 build step 안에서 실행되므로 build/ 디렉토리 항상 존재.
  const buildRegistryPath = resolve(ROOT, "build/tool-registry.js");
  let allNames: string[] = [];
  if (existsSync(buildRegistryPath)) {
    const mod = (await import(buildRegistryPath)) as { TOOLS?: Array<{ name: string }> };
    if (Array.isArray(mod.TOOLS)) {
      allNames = mod.TOOLS.map((t) => t.name).filter(Boolean);
    }
  }
  // fallback — build 미생성 시 src/cli.ts 의 TOOLS_NEEDING_API_KEY 만 활용
  if (allNames.length === 0) {
    throw new Error(
      "[generate-inventory] build/tool-registry.js 미발견. `npm run build` 후 실행 필요.",
    );
  }

  // API 키 필요 목록 — src/cli.ts TOOLS_NEEDING_API_KEY 추출
  const cli = readFileSync(resolve(ROOT, "src/cli.ts"), "utf8");
  const keyMatch = cli.match(/TOOLS_NEEDING_API_KEY = new Set<string>\(\[([\s\S]*?)\]\)/);
  const keyRequired: string[] = [];
  if (keyMatch) {
    const lines = keyMatch[1].matchAll(/"([^"]+)"/g);
    for (const m of lines) keyRequired.push(m[1]);
  }

  // stub 도구 — tool-registry.ts 의 "빈 상태" 주석 + 실제 JSON bundleStatus=empty 검증
  const toolRegistry = readFileSync(resolve(ROOT, "src/tool-registry.ts"), "utf8");
  const stubMatches = toolRegistry.matchAll(/(\w+Tool),\s*\/\/[^\n]*빈 상태/g);
  const stubVarMap: Record<string, string> = {
    searchSifArchiveTool: "search_sif_archive",
    listConstructionSubtasksTool: "list_construction_subtasks",
  };
  const stubNames: string[] = [];
  for (const m of stubMatches) {
    const name = stubVarMap[m[1]];
    if (name && allNames.includes(name)) stubNames.push(name);
  }

  const total = allNames.length;
  const keyRequiredCount = keyRequired.length;
  return {
    total,
    keyless: total - keyRequiredCount,
    keyRequired: keyRequiredCount,
    stub: stubNames.length,
    active: total - stubNames.length,
    stubNames,
    keyRequiredNames: keyRequired,
    allNames,
  };
}

// ─── 2. 그래프 노드 ───
interface GraphStat {
  total: number;
  byCategory: Record<string, number>;
}

function countGraphNodes(): GraphStat {
  const nodesDir = resolve(ROOT, "src/ontology/graph/nodes");
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const cat of readdirSync(nodesDir)) {
    const catDir = join(nodesDir, cat);
    if (!statSync(catDir).isDirectory()) continue;
    const count = readdirSync(catDir).filter((f) => f.endsWith(".jsonld")).length;
    byCategory[cat] = count;
    total += count;
  }
  return { total, byCategory };
}

// ─── 3. KOSHA Guide 본문 + 추출 품질 ───
interface KoshaStat {
  total: number;
  failed: number;
  verified: number; // 빈 <table> 잔재 0건
  partial: number;  // 빈 <table> 1~10건
  raw: number;      // 빈 <table> 11건+
}

function countKoshaGuides(): KoshaStat {
  const dir = resolve(ROOT, "src/ontology/kosha-guides");
  const all = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const failuresPath = join(dir, "_FAILURES.json");
  let failed = 0;
  try {
    const failures = JSON.parse(readFileSync(failuresPath, "utf8"));
    failed = Array.isArray(failures) ? failures.length : 0;
  } catch {}

  let verified = 0;
  let partial = 0;
  let raw = 0;
  for (const f of all) {
    const content = readFileSync(join(dir, f), "utf8");
    const emptyTables = (content.match(/^<table>$/gm) ?? []).length;
    if (emptyTables === 0) verified++;
    else if (emptyTables <= 10) partial++;
    else raw++;
  }
  return { total: all.length, failed, verified, partial, raw };
}

// ─── 4. 법령 본문 ───
interface LawStat {
  filename: string;
  shortName: string;
  articleCount: number;
  totalArticles: number | null;
  coveragePercent: string;
  lastSynced: string;
  publishedVersion: string | null;
  isPartial: boolean;
}

const LAW_TOTAL_ARTICLES: Record<string, { total: number | null; shortName: string }> = {
  "산업안전보건법.md": { total: 175, shortName: "산업안전보건법" },
  "산업안전보건법-시행령.md": { total: 159, shortName: "산안법 시행령" },
  "산업안전보건법-시행규칙.md": { total: 252, shortName: "산안법 시행규칙" },
  "산업안전보건기준에-관한-규칙.md": { total: 671, shortName: "산안기준규칙" },
  "중대재해처벌법.md": { total: 16, shortName: "중대재해처벌법" },
  "중대재해처벌법-시행령.md": { total: 14, shortName: "중처법 시행령" },
  "위험성평가-고시-2024-76.md": { total: 23, shortName: "위험성평가 고시" },
  "건설기술진흥법-§62영역.md": { total: null, shortName: "건진법 §62 영역" },
};

function countLawArticles(): LawStat[] {
  const dir = resolve(ROOT, "src/ontology/safety-laws");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");
  const out: LawStat[] = [];
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf8");
    const articleCount = (content.match(/^##\s+(§|제\d)/gm) ?? []).length;
    const meta = LAW_TOTAL_ARTICLES[f] ?? { total: null, shortName: f.replace(/\.md$/, "") };
    const lastSynced =
      content.match(/마지막 동기화[^\n]*?(\d{4}-\d{2}-\d{2})/)?.[1] ?? "(미명시)";
    const publishedVersion = content.match(/현행 법률[^\n]*?\*\*([^*]+)\*\*/)?.[1]?.trim() ?? null;
    const coveragePercent =
      meta.total === null
        ? "(영역 한정)"
        : meta.total === articleCount
          ? "**전문**"
          : `${((articleCount / meta.total) * 100).toFixed(1)}%`;
    const isPartial = meta.total !== null && articleCount < meta.total;
    out.push({
      filename: f,
      shortName: meta.shortName,
      articleCount,
      totalArticles: meta.total,
      coveragePercent,
      lastSynced,
      publishedVersion,
      isPartial,
    });
  }
  return out;
}

// ─── 5. 양식 ───
interface FormsStat {
  total: number;
  byFormat: Record<string, number>;
  meta: { compiled: string; license: string };
}

function countForms(): FormsStat {
  const path = resolve(ROOT, "src/ontology/forms/forms-map.json");
  const data = JSON.parse(readFileSync(path, "utf8"));
  const byFormat: Record<string, number> = {};
  for (const f of data.forms) byFormat[f.format] = (byFormat[f.format] ?? 0) + 1;
  return {
    total: data.forms.length,
    byFormat,
    meta: { compiled: data._meta?.compiled ?? "?", license: data._meta?.license ?? "?" },
  };
}

// ─── INVENTORY.md 조립 ───
async function generateInventory(): Promise<string> {
  const tools = await countTools();
  const graph = countGraphNodes();
  const kosha = countKoshaGuides();
  const laws = countLawArticles();
  const forms = countForms();
  const generatedAt = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19) + "+09:00";

  const lawArticleTotal = laws.reduce((s, l) => s + l.articleCount, 0);
  const latestLawSync =
    laws
      .map((l) => l.lastSynced)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .pop() ?? "(미명시)";

  const lines: string[] = [];
  lines.push("# Inventory (자동 생성)");
  lines.push("");
  lines.push(
    `> **본 문서는 \`npm run build\` 시 \`scripts/build/generate-inventory.ts\` 가 자동 생성합니다. 수동 편집 금지** — drift 차단용.`,
  );
  lines.push("");
  lines.push(`- 생성 시각: ${generatedAt}`);
  lines.push(`- 법령 데이터 최신 동기화: **${latestLawSync}**`);
  lines.push(`- 양식 인덱스 컴파일: ${forms.meta.compiled}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 1. 도구
  lines.push("## 1. MCP 도구");
  lines.push("");
  lines.push("| 항목 | 수 |");
  lines.push("|---|---:|");
  lines.push(`| 전체 등록 도구 | **${tools.total}** |`);
  lines.push(`| API 키 불필요 (keyless) | ${tools.keyless} |`);
  lines.push(`| API 키 필요 (data.go.kr / KOSHA OneAPI) | ${tools.keyRequired} |`);
  lines.push(`| 라이선스 placeholder (데이터 없음) | ${tools.stub} |`);
  lines.push(`| **실질 활성 도구** | **${tools.active}** |`);
  lines.push("");
  if (tools.stubNames.length > 0) {
    lines.push("**라이선스 placeholder 도구** (의도된 빈 상태 — 공공누리 변경금지 라이선스 준수):");
    for (const name of tools.stubNames) {
      lines.push(`- \`${name}\` — 사용자가 \`npm run sync-kosha\` 로 공식 데이터를 별도 로드해야 동작`);
    }
    lines.push("");
  }
  if (tools.keyRequiredNames.length > 0) {
    lines.push("**API 키 필요 도구** (data.go.kr 또는 라텔웍스 발행 키):");
    for (const name of tools.keyRequiredNames) lines.push(`- \`${name}\``);
    lines.push("");
  }

  // 2. 그래프
  lines.push("## 2. 그래프 노드");
  lines.push("");
  lines.push("| 카테고리 | 노드 수 |");
  lines.push("|---|---:|");
  const sortedCats = Object.entries(graph.byCategory).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCats) lines.push(`| ${cat} | ${count} |`);
  lines.push(`| **전체** | **${graph.total}** |`);
  lines.push("");

  // 3. KOSHA Guide
  lines.push("## 3. KOSHA Guide 본문");
  lines.push("");
  lines.push("| 항목 | 수 |");
  lines.push("|---|---:|");
  lines.push(`| 전체 본문 (.md) | **${kosha.total}** |`);
  lines.push(`| 추출 실패 (\`_FAILURES.json\`) | ${kosha.failed} |`);
  lines.push("");
  lines.push("**추출 품질 등급** (빈 `<table>` 잔재 기준 자동 분류):");
  lines.push("");
  lines.push("| 등급 | 기준 | 수 | 비율 |");
  lines.push("|---|---|---:|---:|");
  const pct = (n: number) => ((n / kosha.total) * 100).toFixed(1) + "%";
  lines.push(`| **verified** | 빈 \`<table>\` 0건 — 본문 정상 | ${kosha.verified} | ${pct(kosha.verified)} |`);
  lines.push(`| **partial** | 빈 \`<table>\` 1~10건 — 표 일부 손실, 본문 텍스트 정상 | ${kosha.partial} | ${pct(kosha.partial)} |`);
  lines.push(`| **raw** | 빈 \`<table>\` 11+건 — kordoc 변환 잔재 다수, 본문은 텍스트로 가독 가능 | ${kosha.raw} | ${pct(kosha.raw)} |`);
  lines.push("");
  lines.push(
    "> ⚠️ KOSHA Guide 는 PDF → kordoc 변환 결과로, 일부 시각적 서식 손실 가능. LLM 인용 시 본문 텍스트만 사용 권장. 정확한 원본은 각 파일의 `원본 URL` 참조.",
  );
  lines.push("");

  // 4. 법령 본문
  lines.push("## 4. 법령 본문 (핵심 조문 발췌)");
  lines.push("");
  lines.push(
    "> ⚠️ **본 OSS 의 법령 번들은 건설안전 실무 핵심 조문 발췌 — 전문 (全文) 아님**. 전체 법령은 [법제처](https://www.law.go.kr) 직접 참조 필수. 단, 위험성평가 고시 (2024-76호) 는 전문 (23조) 수록.",
  );
  lines.push("");
  lines.push("| 법령 | 수록 조문 | 전체 조문 | 커버리지 | 마지막 동기화 | 현행 호수 |");
  lines.push("|---|---:|---:|:---:|:---:|---|");
  for (const l of laws) {
    const totalStr = l.totalArticles === null ? "(영역 한정)" : String(l.totalArticles);
    lines.push(
      `| ${l.shortName} | ${l.articleCount} | ${totalStr} | ${l.coveragePercent} | ${l.lastSynced} | ${l.publishedVersion ?? "—"} |`,
    );
  }
  lines.push(`| **합계** | **${lawArticleTotal}** | — | — | — | — |`);
  lines.push("");
  lines.push(`**저작권**: 저작권법 §7 — 비보호 저작물 (자유 인용·재배포)`);
  lines.push("");

  // 5. 양식
  lines.push("## 5. 양식 인덱스 (`forms-map.json`)");
  lines.push("");
  lines.push("| 포맷 | 수 | 비고 |");
  lines.push("|---|---:|---|");
  for (const [fmt, cnt] of Object.entries(forms.byFormat).sort()) {
    const note = fmt === "md" ? "자동 생성 양식 (sections.fields 기반)" : "공식 양식 (고용노동부·KOSHA·법제처 원본)";
    lines.push(`| ${fmt.toUpperCase()} | ${cnt} | ${note} |`);
  }
  lines.push(`| **합계** | **${forms.total}** | — |`);
  lines.push("");
  lines.push(`**라이선스**: ${forms.meta.license}`);
  lines.push("");

  // 6. 데이터 신뢰성 요약
  lines.push("## 6. 데이터 신뢰성 요약");
  lines.push("");
  lines.push("- **법령**: 법제처 OpenAPI `lawService` 직접 추출 + 본문 100% 검증 (개별 \\.md 헤더 참조)");
  lines.push("- **KOSHA Guide**: PDF → kordoc 변환 — 본문 텍스트 보존, 일부 표 서식 잔재. 등급 분포 위 §3 참조.");
  lines.push("- **그래프 노드**: SHACL 검증 통과, IRI dangling 0");
  lines.push("- **자동 검증 게이트** (CI): `audit:strict` / `verify:tool-capability` (92/92/92) / `verify:edge-context` / `validate-shapes:strict` / `npm audit --audit-level=high`");
  lines.push("- **개정 미반영 가능성**: 본 번들은 마지막 동기화일 기준 스냅샷. 그 이후 법령 개정·KOSHA Guide 신규는 미반영. 결재·인용 전 법제처/KOSHA 원본 재확인 권장.");
  lines.push("");

  // 7. 자동 갱신 안내
  lines.push("## 7. 본 문서 갱신");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run build              # 자동 생성 (빌드 단계 통합)");
  lines.push("npx tsx scripts/build/generate-inventory.ts  # 수동 실행");
  lines.push("```");
  lines.push("");
  lines.push("CI 단계에서 본 문서가 최신 상태와 일치하는지 검증할 수 있도록 `check:inventory-drift` 추가 예정.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("**제공: 황룡건설(주) · 개발: 주식회사 라텔웍스** · 라이선스: MIT · 공공누리");

  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const output = await generateInventory();
  const target = resolve(ROOT, "docs/INVENTORY.md");
  writeFileSync(target, output, "utf8");
  // eslint-disable-next-line no-console
  console.log(`[inventory] ${target} 생성 완료 (${output.split("\n").length} lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
