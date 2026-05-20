/**
 * validate-shacl.ts
 *
 * SHACL Shape (src/ontology/shapes/shapes.jsonld) 의 의미를 OSS 의존성 0 환경에서 검증.
 * 외부 SHACL 엔진(rdf-validate-shacl 등)이 동일 .jsonld 를 사용 가능하지만,
 * CI 통합용 자체 검증을 추가 의존성 없이 수행.
 *
 * 6 Shape 검증:
 *   - DocumentShape       (94종 법정의무문서)
 *   - ArticleShape        (법령 조문)
 *   - AnnexShape          (별표·별지)
 *   - HazardShape         (유해·위험요인)
 *   - PersonShape         (사이트 프로파일 직원, profile.jsonld)
 *   - ApplicabilityShape  (결정론적 추론 룰, v1.3.x 추가)
 *
 * 사용:
 *   npx tsx scripts/verify/validate-shacl.ts          # 모든 Shape 검증
 *   npx tsx scripts/verify/validate-shacl.ts Document # 특정 Shape만
 *   npx tsx scripts/verify/validate-shacl.ts --json   # 머신 출력
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes");
const args = process.argv.slice(2);
const ONLY = args.filter((a) => !a.startsWith("--"))[0]; // Document / Article / Annex / Hazard / Person
const JSON_OUTPUT = args.includes("--json");

interface Violation {
  shape: string;
  nodeId: string;
  file: string;
  property: string;
  rule: string;
  message: string;
  actual?: unknown;
}

interface PropRule {
  path: string;
  required?: boolean;
  datatype?: "string" | "boolean" | "date";
  pattern?: RegExp;
  enumValues?: string[];
  hasValue?: string;
  minCount?: number;
  isIRI?: boolean;
}

interface ShapeRules {
  shape: string;
  matcher: (node: any) => boolean;
  props: PropRule[];
}

const SHAPE_RULES: ShapeRules[] = [
  {
    shape: "DocumentShape",
    matcher: (n) => {
      const isDoc = Array.isArray(n["@type"]) ? n["@type"].includes("Document") : n["@type"] === "Document";
      if (!isDoc) return false;
      // KOSHA Guide 카탈로그 메타·DSSTR 등 비-법정의무문서 제외
      const id = String(n["@id"] ?? "");
      const docId = String(n.docId ?? "");
      if (id.startsWith("doc:kosha_guide/") || docId.startsWith("kosha_guide_")) return false;
      if (n._meta?.sourceApi?.toString().includes("KOSHA Guide")) return false;
      // cycle 이 reference 인 메타 노드 제외
      if (n.cycle === "cyc:reference") return false;
      return true;
    },
    props: [
      // 노드 자체 필수 (마스터 SSoT 키는 DocumentMasterShape 별도)
      { path: "docId", required: true, datatype: "string", pattern: /^[a-z][a-z0-9_]*$/ },
      { path: "title", required: true, datatype: "string" },
      { path: "cycle", isIRI: true }, // 권장
      { path: "iso45001Class", required: true, isIRI: true }, // A3 매핑 의무
      { path: "verificationStatus", enumValues: ["verified", "pending", "auto-aligned", "kosha_live_verified", "simulation_passed"] },
    ],
  },
  {
    shape: "ArticleShape",
    matcher: (n) => Array.isArray(n["@type"]) ? n["@type"].includes("Article") : n["@type"] === "Article",
    props: [
      { path: "articleNumber", required: true, datatype: "string" },
      { path: "title", required: true, datatype: "string" },
      { path: "description", required: true, datatype: "string" },
      { path: "legislationIdentifier", required: true, datatype: "string" },
      { path: "legislationDate", required: true, datatype: "date" },
      { path: "legislationType", required: true, enumValues: ["Act", "Decree", "Rule", "Regulation", "Notice", "Notification"] },
      { path: "legislationLegalForce", required: true, enumValues: ["InForce", "Repealed"] },
      { path: "jurisdiction", required: true, datatype: "string", hasValue: "KR" },
    ],
  },
  {
    shape: "AnnexShape",
    matcher: (n) => Array.isArray(n["@type"]) ? n["@type"].includes("Annex") : n["@type"] === "Annex",
    props: [
      { path: "annexNumber", required: true, datatype: "string" },
      { path: "title", required: true, datatype: "string" },
      { path: "annexKind", required: true, enumValues: ["별표", "별지", "별첨", "서식"] },
      { path: "partOf", required: true, isIRI: true },
    ],
  },
  {
    shape: "HazardShape",
    matcher: (n) => n["@type"] === "Hazard",
    props: [
      { path: "label", required: true, datatype: "string" },
      { path: "category", required: true, enumValues: ["physical", "chemical", "biological", "ergonomic", "psychological", "psychosocial", "environmental"] },
      { path: "iso45001Class", required: true, hasValue: "iso45001:Hazard" },
      { path: "description", required: true, datatype: "string" },
      { path: "mitigatedBy", required: true, isIRI: true, minCount: 1 },
    ],
  },
  // PersonShape는 profile.jsonld의 sites/persons 배열에 적용 — 별도 처리 (graph 노드는 없음)
  {
    shape: "ApplicabilityShape",
    matcher: (n) => Array.isArray(n["@type"]) ? n["@type"].includes("Applicability") : n["@type"] === "Applicability",
    props: [
      { path: "label", required: true, datatype: "string" },
      { path: "condition", required: true }, // JSON Logic — 구조 검증은 lib/applicability-rule.ts
      { path: "legalBasis", required: true, isIRI: true, minCount: 1 },
      { path: "legalWeight", required: true, enumValues: ["mandatory", "recommended", "reference"] },
    ],
  },
];

function validateProp(rule: PropRule, value: unknown, shape: string, nodeId: string, file: string): Violation[] {
  const violations: Violation[] = [];
  const isMissing = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

  if (rule.required && isMissing) {
    violations.push({
      shape,
      nodeId,
      file,
      property: rule.path,
      rule: "minCount=1",
      message: `${rule.path} 필수`,
      actual: value,
    });
    return violations;
  }
  if (isMissing) return violations;

  if (rule.datatype === "string" && typeof value !== "string") {
    violations.push({ shape, nodeId, file, property: rule.path, rule: "datatype=string", message: `${rule.path} 문자열 아님`, actual: value });
  }
  if (rule.datatype === "boolean" && typeof value !== "boolean") {
    violations.push({ shape, nodeId, file, property: rule.path, rule: "datatype=boolean", message: `${rule.path} 불리언 아님`, actual: value });
  }
  if (rule.datatype === "date" && typeof value === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    violations.push({ shape, nodeId, file, property: rule.path, rule: "datatype=date", message: `${rule.path} YYYY-MM-DD 형식 아님`, actual: value });
  }
  if (rule.pattern && typeof value === "string" && !rule.pattern.test(value)) {
    violations.push({ shape, nodeId, file, property: rule.path, rule: `pattern=${rule.pattern}`, message: `${rule.path} 패턴 위반`, actual: value });
  }
  if (rule.enumValues && typeof value === "string" && !rule.enumValues.includes(value)) {
    violations.push({ shape, nodeId, file, property: rule.path, rule: `in=[${rule.enumValues.join(",")}]`, message: `${rule.path} 허용값 외`, actual: value });
  }
  if (rule.hasValue && value !== rule.hasValue) {
    violations.push({ shape, nodeId, file, property: rule.path, rule: `hasValue=${rule.hasValue}`, message: `${rule.path} 고정값 위반`, actual: value });
  }
  if (rule.isIRI) {
    const arr = Array.isArray(value) ? value : [value];
    for (const v of arr) {
      if (typeof v !== "string" || !v.includes(":") || v.startsWith("http://") || v.startsWith("https://")) {
        violations.push({ shape, nodeId, file, property: rule.path, rule: "nodeKind=IRI", message: `${rule.path} prefix:slug 아님`, actual: v });
      }
    }
    if (rule.minCount && arr.length < rule.minCount) {
      violations.push({ shape, nodeId, file, property: rule.path, rule: `minCount=${rule.minCount}`, message: `${rule.path} 최소 ${rule.minCount}개 필요`, actual: arr.length });
    }
  }
  return violations;
}

function walkDir(dir: string): string[] {
  const out: string[] = [];
  if (!exists(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) {
      out.push(...walkDir(p));
    } else if (f.endsWith(".jsonld")) {
      out.push(p);
    }
  }
  return out;
}
function exists(p: string): boolean {
  try { statSync(p); return true; } catch { return false; }
}

function validate(): { violations: Violation[]; counts: Record<string, { nodes: number; violations: number; conformant: number }> } {
  const violations: Violation[] = [];
  const counts: Record<string, { nodes: number; violations: number; conformant: number }> = {};
  const allFiles = walkDir(NODES_DIR);

  for (const file of allFiles) {
    let node: any;
    try {
      node = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const sr of SHAPE_RULES) {
      if (ONLY && sr.shape !== `${ONLY}Shape`) continue;
      if (!sr.matcher(node)) continue;
      counts[sr.shape] ??= { nodes: 0, violations: 0, conformant: 0 };
      counts[sr.shape].nodes++;
      const before = violations.length;
      for (const rule of sr.props) {
        const value = node[rule.path];
        violations.push(...validateProp(rule, value, sr.shape, node["@id"] ?? "(no @id)", file.replace(NODES_DIR + "/", "")));
      }
      const added = violations.length - before;
      counts[sr.shape].violations += added;
      if (added === 0) counts[sr.shape].conformant++;
    }
  }
  return { violations, counts };
}

function main(): void {
  const { violations, counts } = validate();
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ violations, counts }, null, 2));
    return;
  }

  console.log("=".repeat(80));
  console.log("SHACL Shape 검증 결과");
  console.log("=".repeat(80));
  for (const [shape, c] of Object.entries(counts)) {
    const pct = c.nodes > 0 ? ((c.conformant / c.nodes) * 100).toFixed(1) : "-";
    const badge = c.violations === 0 ? "✅" : "❌";
    console.log(`${badge} ${shape}: ${c.conformant}/${c.nodes} 노드 conformant (${pct}%) · ${c.violations} 위반`);
  }
  console.log("");
  if (violations.length > 0) {
    console.log(`총 위반 ${violations.length}건 (상위 30):\n`);
    for (const v of violations.slice(0, 30)) {
      console.log(`  [${v.shape}] ${v.nodeId} @ ${v.file}`);
      console.log(`    ${v.property} (${v.rule}): ${v.message}`);
    }
    if (violations.length > 30) console.log(`  ... ${violations.length - 30} more (--json 으로 전체 출력)`);
    process.exitCode = 1;
  } else {
    console.log(`✅ PASS — 모든 노드가 ${SHAPE_RULES.length} Shape 통과`);
  }
}

main();
