#!/usr/bin/env tsx
/**
 * verify-tool-capability-drift.ts — TOOLS ↔ CAPABILITY_REGISTRY_ENTRIES ↔ capability .jsonld 정합
 *
 * 외부 평가 P0-1 (2026-05-19): src/index.ts 에 registerCapabilities 누락 + TOOLS 88 vs
 * CAPABILITY_REGISTRY_ENTRIES 69 = 19 drift. v1.2.2 에서 정합.
 *
 * 검증 항목:
 *   1. TOOLS (build/tool-registry.js) 의 도구 이름 set
 *   2. CAPABILITY_REGISTRY_ENTRIES (build/capability-registry.js) entry 이름 set
 *   3. src/ontology/graph/nodes/capabilities/*.jsonld 파일명 set
 *   4. 세 set 이 정확히 일치하는지 검증
 *
 * HIGH 1건 이상 시 exit 1 (release blocker).
 *
 * CI 통합: prepublishOnly + verify-all 에 등록.
 */
import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CAPABILITY_NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "capabilities");

interface DriftIssue {
  severity: "HIGH" | "MEDIUM";
  category: "tools_missing_capability" | "capability_missing_tool" | "missing_jsonld_node" | "orphan_jsonld_node";
  toolName: string;
  hint: string;
}

async function main(): Promise<void> {
  const issues: DriftIssue[] = [];

  // 1) TOOLS set (런타임 등록 도구)
  const toolRegistry = await import(resolve(ROOT, "build/tool-registry.js"));
  const toolNames = new Set<string>(toolRegistry.TOOLS.map((t: { name: string }) => t.name));

  // 2) CAPABILITY_REGISTRY_ENTRIES set
  const capRegistry = await import(resolve(ROOT, "build/capability-registry.js"));
  const capEntryNames = new Set<string>(
    capRegistry.CAPABILITY_REGISTRY_ENTRIES.map(([name]: [string, unknown]) => name),
  );

  // 3) capability .jsonld 파일 set
  const jsonldNames = new Set<string>(
    readdirSync(CAPABILITY_NODES_DIR)
      .filter((f) => f.endsWith(".jsonld"))
      .map((f) => f.replace(".jsonld", "")),
  );

  // 4) 검증
  for (const t of toolNames) {
    if (!capEntryNames.has(t)) {
      issues.push({
        severity: "HIGH",
        category: "tools_missing_capability",
        toolName: t,
        hint: "TOOLS 에 등록됐는데 CAPABILITY_REGISTRY_ENTRIES 누락. capability-registry.ts 에 entry 추가 필요.",
      });
    }
    if (!jsonldNames.has(t)) {
      issues.push({
        severity: "HIGH",
        category: "missing_jsonld_node",
        toolName: t,
        hint: `src/ontology/graph/nodes/capabilities/${t}.jsonld 파일 누락. capability 노드 신규 작성 필요.`,
      });
    }
  }

  for (const c of capEntryNames) {
    if (!toolNames.has(c)) {
      issues.push({
        severity: "MEDIUM",
        category: "capability_missing_tool",
        toolName: c,
        hint: "CAPABILITY_REGISTRY_ENTRIES 에 등록됐는데 TOOLS 에 없음 (도구 제거 후 capability entry 잔존).",
      });
    }
  }

  for (const j of jsonldNames) {
    if (!toolNames.has(j)) {
      issues.push({
        severity: "MEDIUM",
        category: "orphan_jsonld_node",
        toolName: j,
        hint: `capability .jsonld 노드는 있는데 TOOLS 에 없음. 노드 정리 또는 도구 재등록 필요.`,
      });
    }
  }

  // 출력
  console.log("Tool ↔ Capability drift 검증");
  console.log(`  TOOLS:                            ${toolNames.size}`);
  console.log(`  CAPABILITY_REGISTRY_ENTRIES:      ${capEntryNames.size}`);
  console.log(`  capability .jsonld 노드:          ${jsonldNames.size}`);
  console.log();

  const high = issues.filter((i) => i.severity === "HIGH");
  const medium = issues.filter((i) => i.severity === "MEDIUM");

  console.log(`발견 issues:`);
  console.log(`  HIGH:   ${high.length}`);
  console.log(`  MEDIUM: ${medium.length}`);
  console.log();

  for (const sev of ["HIGH", "MEDIUM"] as const) {
    const list = issues.filter((i) => i.severity === sev);
    if (list.length === 0) continue;
    console.log(`[${sev}] ${list.length} 건`);
    const byCat: Record<string, DriftIssue[]> = {};
    for (const i of list) (byCat[i.category] ||= []).push(i);
    for (const [cat, items] of Object.entries(byCat)) {
      console.log(`  [${cat}] ${items.length} 건`);
      for (const item of items.slice(0, 10)) {
        console.log(`    · ${item.toolName} — ${item.hint}`);
      }
      if (items.length > 10) console.log(`    ... 외 ${items.length - 10} 건`);
    }
    console.log();
  }

  if (high.length > 0) {
    console.error(`✗ HIGH ${high.length} 건 발견. release blocker.`);
    process.exit(1);
  }
  console.log(`✓ HIGH 0 건 — TOOLS ↔ Capability 정합 OK`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[verify-tool-capability-drift] fatal:`, e);
  process.exit(1);
});

// build 경로 미존재 시 안내
if (!existsSync(resolve(ROOT, "build/tool-registry.js"))) {
  console.error("build/ 부재 — 'npm run build' 먼저 실행 필요");
  process.exit(2);
}
