/**
 * audit-node-completeness.ts
 *
 * 94종 법정의무문서 노드의 작성 가이드 충실도를 측정한다.
 *   - requiredFields[].inputGuide 채움률
 *   - requiredFields[].examples 채움률
 *   - 노드별 충실도 (full / partial / empty)
 *
 * 사용:
 *   npx tsx scripts/audit/audit-node-completeness.ts                # 전체 통계
 *   npx tsx scripts/audit/audit-node-completeness.ts --verbose      # 노드별 상세
 *   npx tsx scripts/audit/audit-node-completeness.ts --weak         # 충실도 < 50% 노드만
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes/documents");

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const WEAK_ONLY = args.includes("--weak");

interface NodeStat {
  file: string;
  docId: string;
  title: string;
  fieldCount: number;
  inputGuideCount: number;
  examplesCount: number;
  inputGuidePct: number;
  examplesPct: number;
  status: "full" | "partial" | "empty" | "no-fields";
}

function audit(): NodeStat[] {
  const files = readdirSync(NODES_DIR)
    .filter((f) => f.endsWith(".jsonld"))
    .map((f) => join(NODES_DIR, f));

  const stats: NodeStat[] = [];
  for (const f of files) {
    let node: any;
    try {
      node = JSON.parse(readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    const rf = Array.isArray(node.requiredFields) ? node.requiredFields : [];
    const fieldCount = rf.length;
    const inputGuideCount = rf.filter((x: any) => x && typeof x.inputGuide === "string" && x.inputGuide.trim()).length;
    const examplesCount = rf.filter((x: any) => x && Array.isArray(x.examples) && x.examples.length > 0).length;
    const inputGuidePct = fieldCount > 0 ? inputGuideCount / fieldCount : 0;
    const examplesPct = fieldCount > 0 ? examplesCount / fieldCount : 0;

    let status: NodeStat["status"];
    if (fieldCount === 0) status = "no-fields";
    else if (inputGuidePct === 1 && examplesPct === 1) status = "full";
    else if (inputGuidePct === 0 && examplesPct === 0) status = "empty";
    else status = "partial";

    stats.push({
      file: f.replace(NODES_DIR + "/", ""),
      docId: node.docId ?? "(unknown)",
      title: node.title ?? "(untitled)",
      fieldCount,
      inputGuideCount,
      examplesCount,
      inputGuidePct,
      examplesPct,
      status,
    });
  }
  return stats;
}

function main(): void {
  const stats = audit();
  const totalNodes = stats.length;
  const totalFields = stats.reduce((s, x) => s + x.fieldCount, 0);
  const totalInputGuide = stats.reduce((s, x) => s + x.inputGuideCount, 0);
  const totalExamples = stats.reduce((s, x) => s + x.examplesCount, 0);

  const byStatus = {
    full: stats.filter((x) => x.status === "full").length,
    partial: stats.filter((x) => x.status === "partial").length,
    empty: stats.filter((x) => x.status === "empty").length,
    "no-fields": stats.filter((x) => x.status === "no-fields").length,
  };

  const fmt = (a: number, b: number): string => (b > 0 ? `${a}/${b} (${((a / b) * 100).toFixed(1)}%)` : "0/0");

  console.log("=".repeat(80));
  console.log("📋 노드 작성 가이드 충실도 (inputGuide + examples)");
  console.log("=".repeat(80));
  console.log(`전체 노드:           ${totalNodes}`);
  console.log(`전체 requiredFields: ${totalFields}`);
  console.log("");
  console.log(`inputGuide 채움률:   ${fmt(totalInputGuide, totalFields)}`);
  console.log(`examples 채움률:     ${fmt(totalExamples, totalFields)}`);
  console.log("");
  console.log("노드 상태:");
  console.log(`  🟢 full     (양쪽 100%): ${byStatus.full}`);
  console.log(`  🟡 partial  (일부 채움):  ${byStatus.partial}`);
  console.log(`  🔴 empty    (양쪽 0%):    ${byStatus.empty}`);
  console.log(`  ⚪ no-fields (필드 없음): ${byStatus["no-fields"]}`);

  if (VERBOSE || WEAK_ONLY) {
    console.log("");
    console.log("─".repeat(80));
    const list = WEAK_ONLY
      ? stats.filter((x) => x.fieldCount > 0 && (x.inputGuidePct < 0.5 || x.examplesPct < 0.5))
      : stats.filter((x) => x.fieldCount > 0);
    list.sort((a, b) => a.inputGuidePct + a.examplesPct - (b.inputGuidePct + b.examplesPct));
    for (const s of list.slice(0, VERBOSE ? 200 : 30)) {
      const ig = `${s.inputGuideCount}/${s.fieldCount}`;
      const ex = `${s.examplesCount}/${s.fieldCount}`;
      console.log(
        `  [${s.status.padEnd(7)}] inputGuide=${ig.padEnd(7)} examples=${ex.padEnd(7)} ${s.docId}`,
      );
    }
  }

  // 머신 가독 메트릭 (CI/README용)
  console.log("\n" + "=".repeat(80));
  const overallPct = ((totalInputGuide + totalExamples) / (totalFields * 2)) * 100;
  console.log(`📊 종합 충실도: ${overallPct.toFixed(1)}%`);
  if (overallPct < 50) {
    console.log("⚠️  목표 100% — scripts/ontology/auto-fill-input-guides.ts 로 자동 채움 가능 부분 보강 권장");
  }

  // 머신 출력 (--json)
  if (args.includes("--json")) {
    console.log("\n" + JSON.stringify({ totalNodes, totalFields, totalInputGuide, totalExamples, byStatus, overallPct }, null, 2));
  }
}

main();
