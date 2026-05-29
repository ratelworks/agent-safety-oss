// ─────────────────────────────────────────────────────────────────────────────
// verify-graph-integrity
//
// 온톨로지 그래프 (src/ontology/graph) 정합성 검증.
// - dangling references: 참조된 IRI 가 실제 노드로 존재하는가
// - format violations: IRI 형식 표준 (콜론 1개, 공백/괄호/콤마 금지)
// - orphan nodes: 어디서도 참조되지 않는 노드 (entry point 제외)
// - JSON-LD expand: jsonld 표준 라이브러리로 expand 가능 여부
//
// 사용:
//   npm run verify-graph                 # 요약
//   npm run verify-graph -- --verbose    # 전체 dangling 목록
//   npm run verify-graph -- --json       # 머신 판독용 JSON
//   npm run verify-graph -- --strict     # 위반 1건이라도 있으면 exit 1 (CI 용)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import jsonld from "jsonld";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const GRAPH_ROOT = join(REPO_ROOT, "src/ontology/graph");
const NODES_ROOT = join(GRAPH_ROOT, "nodes");
const CONTEXT_PATH = join(GRAPH_ROOT, "context.jsonld");

// ─── context.jsonld 에서 @type: "@id" 필드 자동 추출 ───
function extractIriFields(): Set<string> {
  const ctx = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"))["@context"];
  const fields = new Set<string>();
  for (const [key, val] of Object.entries(ctx)) {
    if (typeof val === "object" && val !== null && (val as any)["@type"] === "@id") {
      fields.add(key);
    }
  }
  return fields;
}

// 알려진 prefix (context.jsonld 정의)
// 교차 검증 2026-04-30: 노드 데이터에 활성 사용 중이지만 화이트리스트 누락이던
// 4개 prefix 추가 — cyc(1136 사용), facet(342 사용), entity(104 사용),
// iso45001(179 사용 — ISO 45001 OHSMS 표준 클래스 매핑, context.jsonld:16 정의).
// 이 추가 + IRI_FORMAT_RE 정규식 완화(숫자 prefix 허용)로 verify-graph IRI 형식 위반 1836 → 0.
const KNOWN_PREFIXES = new Set([
  "act", "art", "annex", "doc", "penalty", "activity", "hazard", "event",
  "control", "method", "cycle", "cyc", "applic", "interp", "manual", "stat", "src",
  "equipment", "chapter", "section", "part",
  "facet", "entity", "iso45001", "kosha", "cc", "safety",
]);

// 도메인 경계 — 본 OSS 는 안전관리만. 외부 도메인 참조는 위반.
const OUT_OF_DOMAIN_HINTS = ["화학물질관리법", "위험물안전관리법", "폐기물관리법", "소방시설법"];

interface Node {
  filePath: string;
  id: string;
  type: string | string[];
  raw: any;
}

interface Issue {
  kind: "format" | "dangling" | "orphan" | "out-of-domain" | "expand-error";
  iri: string;
  inFile?: string;
  inField?: string;
  detail?: string;
}

// ─── 1. 전체 노드 로드 ───
function loadAllNodes(): Node[] {
  const nodes: Node[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".jsonld")) {
        try {
          const raw = JSON.parse(readFileSync(full, "utf8"));
          if (raw["@id"] && raw["@type"]) {
            nodes.push({ filePath: full, id: raw["@id"], type: raw["@type"], raw });
          }
        } catch (e) {
          console.warn(`[skip] ${relative(REPO_ROOT, full)} — JSON parse error: ${(e as Error).message}`);
        }
      }
    }
  }
  walk(NODES_ROOT);
  return nodes;
}

// ─── 2. IRI 추출 (재귀) ───
function extractIris(value: unknown, key: string, iriFields: Set<string>): string[] {
  // 명시적 IRI 필드만 처리. 그 외 키는 값을 IRI 로 간주하지 않음 (자연어 / 메타데이터).
  if (!iriFields.has(key)) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((v) => (typeof v === "string" ? [v] : []));
  }
  return [];
}

function collectAllRefs(obj: unknown, iriFields: Set<string>, into: { ref: string; field: string }[]): void {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => collectAllRefs(item, iriFields, into));
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("@")) continue;
    if (k === "_meta") continue; // 메타데이터 (sourceUrl 등) 제외
    const iris = extractIris(v, k, iriFields);
    iris.forEach((iri) => into.push({ ref: iri, field: k }));
    // 중첩 객체 재귀 (안전을 위해 모든 자식 순회)
    if (typeof v === "object" && v !== null) {
      collectAllRefs(v, iriFields, into);
    }
  }
}

// ─── 3. IRI 형식 검증 ───
// prefix 는 영문자로 시작, 이후 영문/숫자/언더스코어/하이픈 허용 (W3C CURIE 호환).
// iso45001 같은 표준 prefix(숫자 포함)도 받기 위해 [a-z]+ → [a-z][a-z0-9_-]* 완화.
const IRI_FORMAT_RE = /^[a-z][a-z0-9_-]*:[^,()\s][^\s]*$/;
function validateIriFormat(iri: string): { valid: boolean; reason?: string } {
  if (!iri) return { valid: false, reason: "empty" };
  if (iri.includes(",")) return { valid: false, reason: "comma in IRI (배열로 분리 필요)" };
  if (iri.includes("(")) return { valid: false, reason: "괄호+한국어 설명문 포함 (식별자만 사용)" };
  if (/\s/.test(iri)) return { valid: false, reason: "공백 포함" };
  if (!IRI_FORMAT_RE.test(iri)) return { valid: false, reason: "형식 위반 (prefix:identifier)" };
  const prefix = iri.split(":")[0];
  if (!KNOWN_PREFIXES.has(prefix)) return { valid: false, reason: `알 수 없는 prefix: ${prefix}` };
  return { valid: true };
}

// ─── 4. 도메인 외 참조 검출 ───
function isOutOfDomain(iri: string): boolean {
  return OUT_OF_DOMAIN_HINTS.some((hint) => iri.includes(hint));
}

// safety:* / cc:* 는 그래프 노드가 아니라 JSON-LD vocabulary/class/action 식별자다.
// 노드 존재성(dangling) 검증 대상에서 제외하되 IRI 형식 검증은 그대로 유지한다.
function isVocabularyRef(iri: string): boolean {
  return /^safety:[A-Z]/.test(iri)
    || iri.startsWith("safety:schema/")
    || iri.startsWith("safety:action/")
    || iri.startsWith("safety:agent/")
    || iri.startsWith("cc:");
}

// ─── 5. JSON-LD expand 검증 ───
async function validateJsonldExpand(node: Node): Promise<string | null> {
  try {
    // context 를 인라인으로 치환 (파일 시스템 의존 회피)
    const ctx = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"));
    const doc = { ...node.raw, "@context": ctx["@context"] };
    await jsonld.expand(doc);
    return null;
  } catch (e) {
    return (e as Error).message.slice(0, 150);
  }
}

// ─── 6. 메인 ───
async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has("--verbose");
  const asJson = args.has("--json");
  const strict = args.has("--strict");

  const iriFields = extractIriFields();
  const nodes = loadAllNodes();
  const nodeIds = new Set(nodes.map((n) => n.id));

  const issues: Issue[] = [];
  const allRefs: { ref: string; field: string; inFile: string }[] = [];

  for (const node of nodes) {
    const collected: { ref: string; field: string }[] = [];
    collectAllRefs(node.raw, iriFields, collected);

    for (const { ref, field } of collected) {
      const inFile = relative(REPO_ROOT, node.filePath);
      allRefs.push({ ref, field, inFile });

      const fmt = validateIriFormat(ref);
      if (!fmt.valid) {
        issues.push({ kind: "format", iri: ref, inFile, inField: field, detail: fmt.reason });
        continue;
      }
      if (isOutOfDomain(ref)) {
        issues.push({ kind: "out-of-domain", iri: ref, inFile, inField: field });
      }
      if (!nodeIds.has(ref) && !isVocabularyRef(ref)) {
        issues.push({ kind: "dangling", iri: ref, inFile, inField: field });
      }
    }
  }

  // orphan 검출 (참조받지 않는 노드)
  const referencedIds = new Set(allRefs.map((r) => r.ref));
  // entry point: Document, Act 는 참조받지 않아도 OK (도구의 진입점)
  const ENTRY_TYPES = new Set(["Document", "Act", "Activity", "Applicability"]);
  for (const node of nodes) {
    if (referencedIds.has(node.id)) continue;
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (types.some((t) => ENTRY_TYPES.has(t))) continue;
    issues.push({ kind: "orphan", iri: node.id, inFile: relative(REPO_ROOT, node.filePath) });
  }

  // 샘플 노드 5개 JSON-LD expand 검증 (모든 노드는 비용 큼)
  const sample = nodes.slice(0, Math.min(5, nodes.length));
  for (const node of sample) {
    const err = await validateJsonldExpand(node);
    if (err) {
      issues.push({ kind: "expand-error", iri: node.id, inFile: relative(REPO_ROOT, node.filePath), detail: err });
    }
  }

  // ─── 결과 출력 ───
  const summary = {
    totalNodes: nodes.length,
    totalRefs: allRefs.length,
    issues: {
      format: issues.filter((i) => i.kind === "format").length,
      dangling: new Set(issues.filter((i) => i.kind === "dangling").map((i) => i.iri)).size,
      danglingOccurrences: issues.filter((i) => i.kind === "dangling").length,
      orphan: issues.filter((i) => i.kind === "orphan").length,
      outOfDomain: issues.filter((i) => i.kind === "out-of-domain").length,
      expandError: issues.filter((i) => i.kind === "expand-error").length,
    },
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, issues: verbose ? issues : issues.slice(0, 50) }, null, 2));
  } else {
    console.log("\n=== 그래프 정합성 검증 ===");
    console.log(`전체 노드: ${summary.totalNodes}`);
    console.log(`전체 참조: ${summary.totalRefs}`);
    console.log(`\n[Issues]`);
    console.log(`  IRI 형식 위반:        ${summary.issues.format}`);
    console.log(`  Dangling references:  ${summary.issues.dangling} 종 (${summary.issues.danglingOccurrences}건 발생)`);
    console.log(`  Orphan nodes:         ${summary.issues.orphan}`);
    console.log(`  도메인 외 참조:       ${summary.issues.outOfDomain}`);
    console.log(`  JSON-LD expand 에러:  ${summary.issues.expandError} / ${sample.length} 샘플`);

    const groups: Record<string, Issue[]> = {};
    for (const i of issues) {
      groups[i.kind] ??= [];
      groups[i.kind].push(i);
    }

    for (const [kind, list] of Object.entries(groups)) {
      console.log(`\n--- [${kind}] (${list.length}건) ---`);
      const limit = verbose ? list.length : 10;
      for (const i of list.slice(0, limit)) {
        const where = i.inFile ? ` @ ${i.inFile}${i.inField ? `:${i.inField}` : ""}` : "";
        const detail = i.detail ? ` — ${i.detail}` : "";
        console.log(`  ${i.iri}${where}${detail}`);
      }
      if (!verbose && list.length > limit) {
        console.log(`  ... ${list.length - limit}건 더 (--verbose 로 전체 보기)`);
      }
    }
  }

  const totalProblems =
    summary.issues.format +
    summary.issues.dangling +
    summary.issues.outOfDomain +
    summary.issues.expandError;
  if (strict && totalProblems > 0) {
    console.error(`\n❌ FAIL — ${totalProblems} 정합성 위반 (--strict)`);
    process.exit(1);
  }
  if (totalProblems === 0) {
    console.log(`\n✅ PASS — 그래프 정합성 위반 0건`);
  }
}

main().catch((e) => {
  console.error("verify-graph-integrity 실패:", e);
  process.exit(2);
});
