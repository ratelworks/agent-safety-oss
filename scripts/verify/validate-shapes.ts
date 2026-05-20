// ─────────────────────────────────────────────────────────────────────────────
// validate-shapes
//
// SHACL declarative 검증 — shapes/safety-shapes.ttl 의 룰을 1264 노드에 적용.
// rdf-validate-shacl (zazuko) + N3 parser + jsonld 표준 라이브러리 조합.
//
// Document 는 파일 경로로 sub-class 분류 (general vs guide):
//   - documents/guides/*.jsonld → safety:DocumentGuide
//   - 그 외 documents/*.jsonld   → safety:DocumentGeneral
//
// 사용:
//   npm run validate-shapes              # 요약
//   npm run validate-shapes -- --verbose # 위반 상세
//   npm run validate-shapes -- --strict  # 위반 시 exit 1 (CI)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import jsonld from "jsonld";
// rdf-validate-shacl / @zazuko/env-node 는 자체 타입 제공 — 과거 @ts-expect-error 는 더 이상 필요 없음.
import SHACLValidator from "rdf-validate-shacl";
import rdf from "@zazuko/env-node";

// @zazuko/env-node 는 rdf-ext + clownface + N3 parser 통합 환경.
// SHACLValidator 가 요구하는 모든 메서드 (clownface, dataset, namedNode 등) 제공.
const factory: any = rdf;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const NODES_ROOT = join(REPO_ROOT, "src/ontology/graph/nodes");
const SHAPES_PATH = join(REPO_ROOT, "shapes/safety-shapes.ttl");
const CONTEXT_PATH = join(REPO_ROOT, "src/ontology/graph/context.jsonld");

// ─── Turtle / N-Quads → RDF dataset (zazuko env 사용) ───
async function loadTurtleDataset(turtle: string) {
  return await rdf.dataset().import(rdf.formats.parsers.import("text/turtle", Readable.from([turtle]))!);
}

async function loadNQuadsDataset(nquads: string) {
  return await rdf
    .dataset()
    .import(rdf.formats.parsers.import("application/n-quads", Readable.from([nquads]))!);
}

// ─── 모든 jsonld 노드 → N-Quads (Document sub-class 부여) ───
async function loadAllNodesAsRdf(): Promise<{ nquads: string; nodeCount: number; subSchemaInfo: { general: number; guide: number } }> {
  const ctx = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"));
  const allQuads: string[] = [];
  let nodeCount = 0;
  const subSchemaInfo = { general: 0, guide: 0 };

  async function processFile(full: string) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      return;
    }
    if (!raw["@id"] || !raw["@type"]) return;

    // Document 는 sub-class 부여 — 파일 경로 기반
    const types = Array.isArray(raw["@type"]) ? [...raw["@type"]] : [raw["@type"]];
    if (types.includes("Document")) {
      if (full.includes("/documents/guides/")) {
        types.push("DocumentGuide");
        subSchemaInfo.guide++;
      } else {
        types.push("DocumentGeneral");
        subSchemaInfo.general++;
      }
      raw["@type"] = types;
    }

    nodeCount++;
    const doc = { ...raw, "@context": ctx["@context"] };
    try {
      const expanded = await jsonld.expand(doc);
      const nquads = (await jsonld.toRDF(expanded, { format: "application/n-quads" })) as string;
      allQuads.push(nquads);
    } catch (e) {
      console.warn(`[skip] ${relative(REPO_ROOT, full)} — toRDF 실패: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  function walk(dir: string, files: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, files);
      else if (entry.endsWith(".jsonld")) files.push(full);
    }
    return files;
  }

  const files = walk(NODES_ROOT);
  for (const f of files) await processFile(f);

  return { nquads: allQuads.join("\n"), nodeCount, subSchemaInfo };
}

interface Violation {
  focusNode: string;
  path: string;
  message: string;
  severity: string;
  sourceShape: string;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has("--verbose");
  const strict = args.has("--strict");

  console.log("[load] SHACL shapes 로드…");
  const shapes = await loadTurtleDataset(readFileSync(SHAPES_PATH, "utf8"));
  console.log(`[load] shapes: ${shapes.size} triples`);

  console.log("[load] 1264 노드 → JSON-LD expand → N-Quads 변환…");
  const { nquads, nodeCount, subSchemaInfo } = await loadAllNodesAsRdf();
  console.log(`[load] 노드: ${nodeCount} (Document general=${subSchemaInfo.general}, guide=${subSchemaInfo.guide})`);

  const data = await loadNQuadsDataset(nquads);
  console.log(`[load] data: ${data.size} triples`);

  console.log("[validate] SHACL validator 실행…\n");
  const validator = new SHACLValidator(shapes, { factory });
  const report: any = await validator.validate(data);

  const resultsArray: any[] = report.results || [];
  const violations: Violation[] = [];
  for (const r of resultsArray) {
    const msgArr = Array.isArray(r.message) ? r.message : [r.message].filter(Boolean);
    violations.push({
      focusNode: r.focusNode?.value || "(unknown)",
      path: r.path?.value || "(no path)",
      message: msgArr[0]?.value || msgArr[0] || "(no message)",
      severity: r.severity?.value?.split("#")[1] || "Violation",
      sourceShape: r.sourceShape?.value || "(unknown)",
    });
  }

  // 그룹화
  const byShape: Record<string, Violation[]> = {};
  for (const v of violations) {
    const shape = v.sourceShape.split("#")[1] || v.sourceShape;
    byShape[shape] ??= [];
    byShape[shape].push(v);
  }

  console.log("┌──────────────────────────────────────────────┐");
  console.log("│  SHACL 검증 결과                              │");
  console.log("└──────────────────────────────────────────────┘");
  console.log(`전체 노드: ${nodeCount}`);
  console.log(`전체 triples: ${data.size}`);
  console.log(`위반: ${violations.length}건`);
  console.log(`Conforms: ${report.conforms}\n`);

  for (const [shape, list] of Object.entries(byShape).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`[${shape}] ${list.length}건`);
    const limit = verbose ? list.length : 5;
    for (const v of list.slice(0, limit)) {
      const focus = v.focusNode.replace("https://safety.ratelworks.org/", "").replace(/\//g, ":");
      const path = v.path.split("#")[1] || v.path.split("/").pop() || v.path;
      console.log(`  - ${focus}.${path} — ${v.message}`);
    }
    if (!verbose && list.length > limit) {
      console.log(`    ... ${list.length - limit}건 더`);
    }
    console.log();
  }

  if (report.conforms) {
    console.log("✅ PASS — 모든 노드가 SHACL shapes 통과");
  } else {
    console.log(`❌ FAIL — ${violations.length} SHACL 위반`);
  }

  if (strict && !report.conforms) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("validate-shapes 실패:", e);
  process.exit(2);
});
