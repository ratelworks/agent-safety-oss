// ─────────────────────────────────────────────────────────────────────────────
// evaluate-jsonld
//
// 1264 노드 종합 품질 평가 (점수화).
// 평가 6축:
//   1) JSON-LD spec 준수      — jsonld.expand 통과율
//   2) Schema.org 적합도      — Legislation 핵심 필드 충족
//   3) 그래프 무결성          — dangling / orphan / format
//   4) 타입별 필수 필드        — SHACL-style 룰 (코드 내장)
//   5) Cross-node 의미 무결성  — 참조 대상 타입 일치
//   6) Verification 상태 분포  — verified / needs_review / draft
//
// 종합 등급: A / B / C / D / F
//
// 사용:
//   npx tsx scripts/verify/evaluate-jsonld.ts          # 요약
//   npx tsx scripts/verify/evaluate-jsonld.ts --verbose
//   npx tsx scripts/verify/evaluate-jsonld.ts --json
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import jsonld from "jsonld";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const NODES_ROOT = join(REPO_ROOT, "src/ontology/graph/nodes");
const CONTEXT_PATH = join(REPO_ROOT, "src/ontology/graph/context.jsonld");

interface Node {
  filePath: string;
  id: string;
  type: string[];
  raw: any;
}

// ─── 타입별 필수 필드 룰 (SHACL-style, 코드 내장) ───
// 실제 데이터 모델 분석 후 정정 — 노드 타입별 schema 문서가 부재한 OSS 의 임시 contract.
// Document 는 두 sub-schema 분기:
//   - 일반 Document (work-plan-* 등 14종): 작성 양식 필드 (legalBasis, requiredFields 등)
//   - KOSHA Guide (documents/guides/*): 참고 문서 (cycle, mitigatedBy, causedBy 등)
const TYPE_REQUIRED_FIELDS: Record<string, string[]> = {
  Article: ["articleNumber", "partOf", "description"],
  Penalty: ["penaltyType", "amount", "amountUnit", "condition", "partOf"],
  Hazard: ["slug", "label", "category"], // koshaAccidentType 은 권장
  Control: ["slug", "label", "ericLevel", "category"],
  Activity: ["title"],
  Applicability: ["title"],
  Annex: ["annexNumber", "partOf"],
  Act: ["legislationIdentifier", "legislationDate", "legislationType"],
};
// Document sub-schema (필드 존재로 분기)
const DOCUMENT_GENERAL_REQUIRED = ["docId", "title", "cycle", "legalBasis", "applicableWhen", "requiredFields"];
const DOCUMENT_GUIDE_REQUIRED = ["docId", "title", "cycle"];

// schema.org Legislation 핵심 필드
const SCHEMA_ORG_LEGISLATION_FIELDS = [
  "legislationIdentifier",
  "legislationDate",
  "legislationType",
];

// IRI prefix → 기대 타입 (cross-node 무결성)
const PREFIX_EXPECTED_TYPE: Record<string, string[]> = {
  act: ["Act"],
  art: ["Article"],
  annex: ["Annex"],
  doc: ["Document"],
  penalty: ["Penalty"],
  activity: ["Activity"],
  hazard: ["Hazard"],
  control: ["Control"],
  applic: ["Applicability"],
};

// IRI 참조 필드 (context.jsonld @type:@id 추출)
function loadIriFields(): Set<string> {
  const ctx = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"))["@context"];
  const fields = new Set<string>();
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === "object" && v !== null && (v as any)["@type"] === "@id") {
      fields.add(k);
    }
  }
  return fields;
}

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
            const types = Array.isArray(raw["@type"]) ? raw["@type"] : [raw["@type"]];
            nodes.push({ filePath: full, id: raw["@id"], type: types, raw });
          }
        } catch {}
      }
    }
  }
  walk(NODES_ROOT);
  return nodes;
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

// 등급 산정
function grade(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "B+";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has("--verbose");
  const asJson = args.has("--json");

  const iriFields = loadIriFields();
  const nodes = loadAllNodes();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // ─── 1. JSON-LD spec 준수 ───
  const ctx = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"));
  let expandPass = 0;
  let expandFail = 0;
  const expandFails: { id: string; err: string }[] = [];
  for (const node of nodes) {
    try {
      await jsonld.expand({ ...node.raw, "@context": ctx["@context"] });
      expandPass++;
    } catch (e) {
      expandFail++;
      if (expandFails.length < 5) expandFails.push({ id: node.id, err: (e as Error).message.slice(0, 100) });
    }
  }

  // ─── 2. Schema.org Legislation 적합도 ───
  const schemaCompliantTypes = ["Article", "Annex", "Act", "Penalty"]; // 법령류
  const eligible = nodes.filter((n) => n.type.some((t) => schemaCompliantTypes.includes(t)));
  const schemaPass = eligible.filter((n) =>
    SCHEMA_ORG_LEGISLATION_FIELDS.every((f) => n.raw[f] !== undefined)
  );

  // ─── 3. 그래프 무결성 (재계산) ───
  const allRefs: { ref: string; field: string; from: Node }[] = [];
  function collectRefs(obj: unknown, from: Node) {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach((it) => collectRefs(it, from));
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("@") || k === "_meta") continue;
      if (iriFields.has(k)) {
        const items = Array.isArray(v) ? v : [v];
        items.forEach((it) => {
          if (typeof it === "string") allRefs.push({ ref: it, field: k, from });
        });
      }
      if (typeof v === "object" && v !== null) collectRefs(v, from);
    }
  }
  for (const node of nodes) collectRefs(node.raw, node);

  const dangling = allRefs.filter((r) => !nodeMap.has(r.ref) && /^[a-z]+:[^,()\s]+$/.test(r.ref));
  const referencedIds = new Set(allRefs.map((r) => r.ref));
  const ENTRY_TYPES = new Set(["Document", "Act", "Activity", "Applicability"]);
  const orphans = nodes.filter(
    (n) => !referencedIds.has(n.id) && !n.type.some((t) => ENTRY_TYPES.has(t))
  );

  // ─── 4. 타입별 필수 필드 (SHACL-style) ───
  const fieldViolations: { node: Node; missing: string[]; subSchema?: string }[] = [];
  let typeRuleApplied = 0;
  let typeRulePass = 0;
  function checkRequired(node: Node, required: string[]): string[] {
    return required.filter((f) => {
      const v = node.raw[f];
      if (v === undefined || v === null) return true;
      if (Array.isArray(v) && v.length === 0) return true;
      return false;
    });
  }
  for (const node of nodes) {
    let counted = false;
    for (const t of node.type) {
      // Document 는 sub-schema 분기
      if (t === "Document") {
        if (counted) continue;
        counted = true;
        typeRuleApplied++;
        const isGuide = node.filePath.includes("/documents/guides/");
        const required = isGuide ? DOCUMENT_GUIDE_REQUIRED : DOCUMENT_GENERAL_REQUIRED;
        const missing = checkRequired(node, required);
        if (missing.length === 0) typeRulePass++;
        else fieldViolations.push({ node, missing, subSchema: isGuide ? "Document(Guide)" : "Document(General)" });
        continue;
      }
      const required = TYPE_REQUIRED_FIELDS[t];
      if (!required) continue;
      if (counted) continue;
      counted = true;
      typeRuleApplied++;
      const missing = checkRequired(node, required);
      if (missing.length === 0) typeRulePass++;
      else fieldViolations.push({ node, missing, subSchema: t });
    }
  }

  // ─── 5. Cross-node 의미 무결성 ───
  const crossViolations: { ref: string; expected: string; actual: string; from: Node; field: string }[] = [];
  for (const r of allRefs) {
    if (!nodeMap.has(r.ref)) continue; // dangling 은 별개
    const prefix = r.ref.split(":")[0];
    const expected = PREFIX_EXPECTED_TYPE[prefix];
    if (!expected) continue;
    const target = nodeMap.get(r.ref)!;
    if (!target.type.some((t) => expected.includes(t))) {
      crossViolations.push({
        ref: r.ref,
        expected: expected.join("|"),
        actual: target.type.join(","),
        from: r.from,
        field: r.field,
      });
    }
  }

  // ─── 6. Verification 상태 분포 ───
  // 인정되는 값: verified, kosha_live_verified, needs_review, simulation_passed, draft
  // 점수 가중치: verified류=1.0, simulation/needs_review=0.5, draft=0.3, missing=0
  const verifStats: Record<string, number> = {
    verified: 0,
    kosha_live_verified: 0,
    needs_review: 0,
    simulation_passed: 0,
    draft: 0,
    missing: 0,
  };
  for (const n of nodes) {
    const v = n.raw.verificationStatus;
    if (typeof v === "string" && v in verifStats) verifStats[v]++;
    else verifStats.missing++;
  }

  // ─── 7. 노드 타입 분포 ───
  const typeDist: Record<string, number> = {};
  for (const n of nodes) {
    for (const t of n.type) typeDist[t] = (typeDist[t] || 0) + 1;
  }

  // ─── 점수 산정 ───
  const scores = {
    spec: (expandPass / nodes.length) * 100,
    schema: eligible.length > 0 ? (schemaPass.length / eligible.length) * 100 : 0,
    integrity: ((nodes.length - new Set(dangling.map((d) => d.ref)).size - orphans.length) / nodes.length) * 100,
    typeRules: typeRuleApplied > 0 ? (typeRulePass / typeRuleApplied) * 100 : 0,
    crossNode: allRefs.length > 0 ? ((allRefs.length - crossViolations.length - dangling.length) / allRefs.length) * 100 : 0,
    verification:
      ((verifStats.verified +
        verifStats.kosha_live_verified +
        (verifStats.needs_review + verifStats.simulation_passed) * 0.5 +
        verifStats.draft * 0.3) /
        nodes.length) *
      100,
  };
  // 가중 평균
  const overall =
    scores.spec * 0.20 +
    scores.schema * 0.15 +
    scores.integrity * 0.20 +
    scores.typeRules * 0.20 +
    scores.crossNode * 0.15 +
    scores.verification * 0.10;

  // ─── 출력 ───
  if (asJson) {
    console.log(JSON.stringify({ scores, overall, grade: grade(overall) }, null, 2));
    return;
  }

  console.log("\n┌───────────────────────────────────────────────────────────┐");
  console.log("│  agent-safety-oss — JSON-LD 그래프 종합 평가           │");
  console.log("└───────────────────────────────────────────────────────────┘\n");
  console.log(`전체 노드: ${nodes.length}개`);
  console.log(`전체 참조: ${allRefs.length}건`);
  console.log(`타입 분포: ${Object.entries(typeDist).slice(0, 10).map(([t, c]) => `${t}=${c}`).join(", ")}${Object.keys(typeDist).length > 10 ? " ..." : ""}\n`);

  console.log("━━━ 평가 6축 ━━━\n");

  console.log(`[1] JSON-LD 1.1 spec 준수             ${scores.spec.toFixed(1)}점  ${grade(scores.spec)}`);
  console.log(`    expand 통과: ${expandPass}/${nodes.length} (${pct(expandPass, nodes.length)})`);
  if (expandFail > 0) {
    console.log(`    expand 실패: ${expandFail}건`);
    expandFails.forEach((f) => console.log(`      - ${f.id}: ${f.err}`));
  }
  console.log();

  console.log(`[2] Schema.org Legislation 적합도     ${scores.schema.toFixed(1)}점  ${grade(scores.schema)}`);
  console.log(`    필수 3필드 (legislationIdentifier·Date·Type) 충족`);
  console.log(`    충족: ${schemaPass.length}/${eligible.length} (${pct(schemaPass.length, eligible.length)}) — 법령 노드(Article/Annex/Act/Penalty)`);
  console.log();

  console.log(`[3] 그래프 무결성                     ${scores.integrity.toFixed(1)}점  ${grade(scores.integrity)}`);
  console.log(`    Dangling refs: ${new Set(dangling.map((d) => d.ref)).size}종 / ${dangling.length}건 발생`);
  console.log(`    Orphan nodes:  ${orphans.length}개 (${pct(orphans.length, nodes.length)})`);
  if (verbose && orphans.length > 0) {
    console.log(`    orphan 샘플:`);
    orphans.slice(0, 10).forEach((o) => console.log(`      - ${o.id}`));
  }
  console.log();

  console.log(`[4] 타입별 필수 필드 (SHACL-style)    ${scores.typeRules.toFixed(1)}점  ${grade(scores.typeRules)}`);
  console.log(`    적용된 룰: ${typeRuleApplied}건 / 통과: ${typeRulePass} (${pct(typeRulePass, typeRuleApplied)})`);
  if (fieldViolations.length > 0) {
    const violationByType: Record<string, number> = {};
    for (const v of fieldViolations) {
      const key = v.subSchema || v.node.type.join(",");
      violationByType[key] = (violationByType[key] || 0) + 1;
    }
    console.log(`    타입별 위반: ${Object.entries(violationByType).map(([t, c]) => `${t}=${c}`).join(", ")}`);
    if (verbose) {
      fieldViolations.slice(0, 10).forEach((v) =>
        console.log(`      - ${v.node.id} (${v.subSchema || v.node.type.join(",")}): missing [${v.missing.join(", ")}]`)
      );
    }
  }
  console.log();

  console.log(`[5] Cross-node 의미 무결성            ${scores.crossNode.toFixed(1)}점  ${grade(scores.crossNode)}`);
  console.log(`    참조 대상 타입 일치: ${allRefs.length - crossViolations.length - dangling.length}/${allRefs.length}`);
  console.log(`    타입 불일치: ${crossViolations.length}건`);
  console.log(`    Dangling (참조 자체 부재): ${dangling.length}건`);
  if (crossViolations.length > 0) {
    console.log(`    위반 샘플:`);
    crossViolations.slice(0, 5).forEach((v) =>
      console.log(`      - ${v.from.id}.${v.field} → ${v.ref} (기대: ${v.expected}, 실제: ${v.actual})`)
    );
  }
  console.log();

  console.log(`[6] Verification 상태                 ${scores.verification.toFixed(1)}점  ${grade(scores.verification)}`);
  console.log(`    verified:           ${verifStats.verified} (${pct(verifStats.verified, nodes.length)})`);
  console.log(`    kosha_live_verified:${verifStats.kosha_live_verified} (${pct(verifStats.kosha_live_verified, nodes.length)})`);
  console.log(`    needs_review:       ${verifStats.needs_review}`);
  console.log(`    simulation_passed:  ${verifStats.simulation_passed}`);
  console.log(`    draft:              ${verifStats.draft}`);
  console.log(`    missing 필드:       ${verifStats.missing} (${pct(verifStats.missing, nodes.length)})`);
  console.log();

  console.log("━━━ 종합 ━━━\n");
  console.log(`가중 평균 점수: ${overall.toFixed(1)} / 100   ⇒   등급 ${grade(overall)}`);
  console.log(`\n가중치: spec×0.20 + schema×0.15 + integrity×0.20 + typeRules×0.20 + crossNode×0.15 + verification×0.10\n`);

  // 권고
  console.log("━━━ 권고 ━━━");
  const recos: string[] = [];
  if (scores.schema < 80) recos.push(`Schema.org 적합도 ${scores.schema.toFixed(0)}% — Article/Annex 노드 ${eligible.length - schemaPass.length}건에 legislationIdentifier·Date·Type 추가`);
  if (scores.integrity < 90) recos.push(`그래프 무결성 ${scores.integrity.toFixed(0)}% — dangling ${new Set(dangling.map((d) => d.ref)).size}종 보강 + orphan ${orphans.length}건 연결`);
  if (scores.typeRules < 90) recos.push(`타입 필수 필드 ${scores.typeRules.toFixed(0)}% — ${fieldViolations.length}건 보강 (--verbose 로 상세)`);
  if (scores.crossNode < 95) recos.push(`Cross-node 무결성 ${scores.crossNode.toFixed(0)}% — 참조 타입 정정 필요`);
  if (scores.verification < 50) recos.push(`Verification 신뢰도 ${scores.verification.toFixed(0)}% — verified 승급 필요`);
  if (recos.length === 0) console.log("  ✅ 모든 축이 양호 (>90점)");
  else recos.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  console.log();
}

main().catch((e) => {
  console.error("evaluate-jsonld 실패:", e);
  process.exit(2);
});
