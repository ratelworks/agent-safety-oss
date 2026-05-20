#!/usr/bin/env tsx
/**
 * audit-legal-duty-coverage.ts
 *
 * 마스터 리스트(legal-duty-master.json) vs 노드(documents/*.jsonld) vs 양식(forms-map.json)
 * 3차원 1:1 정합 검증.
 *
 * 게이트: 모든 새 작업은 이 스크립트가 PASS인 상태에서 시작해야 한다.
 *
 * 종합:
 *   1) docId 보유 (마스터 ↔ 노드)
 *   2) 양식 정합 (sections.fields가 슬러그 자동생성이 아닌 양식 기반인지)
 *   3) 양식 매핑 (forms-map.json 에 docId 매핑이 있는지)
 *
 * Exit: 0=PASS / 1=NEEDS_WORK
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

interface MasterDoc {
  docId: string;
  title: string;
  category: string;
  legalRef: string[];
  formStrictness: "법령강제" | "KOSHA표준" | "고시" | "자율";
  formSource: string;
  frequency: string;
  applicableScope: string;
  retention: string;
  penaltyOnMissing: string;
}

interface Master {
  _meta: any;
  documents: MasterDoc[];
}

interface FormEntry {
  formId: string;
  docId: string;
  format: string;
  filename?: string;
}

interface NodeStatus {
  docId: string;
  hasNode: boolean;
  hasOfficialFormSpec: boolean;
  hasApprovalChain: boolean;
  fieldsCount: number;
  slugRatio: number;
  inputGuideRatio: number;
  alignmentLevel: "정합완료" | "부분정합" | "미정합" | "노드없음";
}

async function loadMaster(): Promise<Master> {
  const txt = await readFile(resolve(ROOT, "src/ontology/legal-duty-master.json"), "utf8");
  return JSON.parse(txt);
}

async function loadFormsMap(): Promise<{ forms: FormEntry[] }> {
  const txt = await readFile(resolve(ROOT, "src/ontology/forms/forms-map.json"), "utf8");
  return JSON.parse(txt);
}

async function scanDocumentNodes(): Promise<Map<string, any>> {
  const dir = resolve(ROOT, "src/ontology/graph/nodes/documents");
  const entries = await readdir(dir);
  const map = new Map<string, any>();
  for (const e of entries) {
    if (!e.endsWith(".jsonld")) continue;
    try {
      const txt = await readFile(resolve(dir, e), "utf8");
      const node = JSON.parse(txt);
      if (node.docId) map.set(node.docId, node);
    } catch {}
  }
  return map;
}

function classifyAlignment(node: any): { level: NodeStatus["alignmentLevel"]; slug: number; guide: number; total: number } {
  if (!node) return { level: "노드없음", slug: 0, guide: 0, total: 0 };
  const sections = node.sections ?? [];
  const fields: any[] = [];
  for (const s of sections) for (const f of s.fields ?? []) fields.push(f);
  const total = fields.length;
  if (total === 0) return { level: "미정합", slug: 0, guide: 0, total: 0 };
  const slug = fields.filter((f) => (f.key ?? "").startsWith("f_") && (f.key ?? "").split("_").length >= 3).length;
  // 의미있는 가이드: inputGuide 존재 + "본문 항목" placeholder 아님 (길이 무관)
  const meaningfulGuide = fields.filter(
    (f) => f.inputGuide && !f.inputGuide.includes("본문 항목") && (f.inputGuide ?? "").length >= 5,
  ).length;
  const examples = fields.filter(
    (f) => Array.isArray(f.examples) && f.examples.length > 0,
  ).length;
  const slugRatio = slug / total;
  const guideRatio = meaningfulGuide / total;
  const examplesRatio = examples / total;
  let level: NodeStatus["alignmentLevel"];
  // 미정합: 슬러그 50%+ (자동생성 슬러그키만 있음)
  // 정합완료: 슬러그 30% 미만 + (가이드 70%+ AND examples 50%+) — 실제 의미있는 양식 정합
  // 부분정합: 그 외 (슬러그 30~50% 또는 가이드/예시 부족)
  if (slugRatio >= 0.5) level = "미정합";
  else if (slugRatio < 0.3 && guideRatio >= 0.7 && examplesRatio >= 0.5) level = "정합완료";
  else level = "부분정합";
  return { level, slug, guide: meaningfulGuide, total };
}

function statusEmoji(level: NodeStatus["alignmentLevel"]): string {
  switch (level) {
    case "정합완료": return "🟢";
    case "부분정합": return "🟡";
    case "미정합":   return "🟠";
    case "노드없음": return "🔴";
  }
}

async function main() {
  const master = await loadMaster();
  const formsMap = await loadFormsMap();
  const nodes = await scanDocumentNodes();

  const statuses: NodeStatus[] = [];
  const formByDocId = new Map<string, FormEntry[]>();
  for (const f of formsMap.forms) {
    if (!f.docId) continue;
    if (!formByDocId.has(f.docId)) formByDocId.set(f.docId, []);
    formByDocId.get(f.docId)!.push(f);
  }

  for (const m of master.documents) {
    const node = nodes.get(m.docId);
    const cls = classifyAlignment(node);
    statuses.push({
      docId: m.docId,
      hasNode: !!node,
      hasOfficialFormSpec: !!node?.officialFormSpec,
      hasApprovalChain: !!(node?.approvalChain && node.approvalChain.length > 0),
      fieldsCount: cls.total,
      slugRatio: cls.total ? cls.slug / cls.total : 0,
      inputGuideRatio: cls.total ? cls.guide / cls.total : 0,
      alignmentLevel: cls.level,
    });
  }

  // 출력
  const banner = "=".repeat(108);
  console.log(banner);
  console.log(`안전관리 법정의무 문서 정합 감사 — 마스터 ${master.documents.length}종`);
  console.log(banner);

  // 카테고리별 그룹
  const byCategory = new Map<string, MasterDoc[]>();
  for (const d of master.documents) {
    if (!byCategory.has(d.category)) byCategory.set(d.category, []);
    byCategory.get(d.category)!.push(d);
  }

  let overall = { 정합완료: 0, 부분정합: 0, 미정합: 0, 노드없음: 0 };
  let officialMapped = 0, autoMapped = 0, noMapping = 0;

  for (const cat of Array.from(byCategory.keys()).sort()) {
    const docs = byCategory.get(cat)!;
    console.log(`\n[${cat}] ${docs.length}종`);
    for (const m of docs) {
      const s = statuses.find((x) => x.docId === m.docId)!;
      const forms = formByDocId.get(m.docId) ?? [];
      const officialForm = forms.find((f) => ["hwp", "hwpx", "pdf", "xlsx"].includes(f.format));
      const autoForm = forms.find((f) => f.format === "md");
      let formTag = "❌없음";
      if (officialForm) { formTag = `📄${officialForm.format}`; officialMapped++; }
      else if (autoForm) { formTag = "📝md"; autoMapped++; }
      else { noMapping++; }
      const strictTag = m.formStrictness === "법령강제" ? "🔴" : m.formStrictness === "KOSHA표준" ? "🟠" : m.formStrictness === "고시" ? "🟠" : "🟡";
      console.log(
        `  ${statusEmoji(s.alignmentLevel)} ${strictTag} ${m.docId.padEnd(50)} ${formTag.padEnd(8)} ${s.alignmentLevel.padEnd(8)} ${m.title.slice(0, 28)}`,
      );
      overall[s.alignmentLevel]++;
    }
  }

  // 종합
  console.log(`\n${banner}`);
  console.log(`종합`);
  console.log(banner);
  console.log(`\n📊 노드 상태:`);
  console.log(`  🟢 정합완료: ${overall.정합완료}종`);
  console.log(`  🟡 부분정합: ${overall.부분정합}종`);
  console.log(`  🟠 미정합:   ${overall.미정합}종`);
  console.log(`  🔴 노드없음: ${overall.노드없음}종`);
  console.log(`\n📋 양식 매핑:`);
  console.log(`  📄 공식 양식 (hwp/pdf/xlsx): ${officialMapped}종`);
  console.log(`  📝 자동생성 .md:              ${autoMapped}종`);
  console.log(`  ❌ 매핑 없음:                ${noMapping}종`);

  // 누락 리스트
  const missingNodes = statuses.filter((s) => s.alignmentLevel === "노드없음");
  const needsAlignment = statuses.filter((s) => s.alignmentLevel === "미정합");
  const missingForms = master.documents
    .filter((m) => !formByDocId.has(m.docId))
    .map((m) => m.docId);

  if (missingNodes.length > 0) {
    console.log(`\n🔴 노드 부재 (${missingNodes.length}종) — 즉시 신규 생성:`);
    for (const m of missingNodes) console.log(`  - ${m.docId}`);
  }
  if (needsAlignment.length > 0) {
    console.log(`\n🟠 양식 정합 미완료 (${needsAlignment.length}종) — sections.fields 양식 정합:`);
    for (const m of needsAlignment) console.log(`  - ${m.docId} (${m.fieldsCount} fields, slug ${(m.slugRatio*100).toFixed(0)}%)`);
  }
  if (missingForms.length > 0) {
    console.log(`\n❌ 양식 매핑 부재 (${missingForms.length}종) — forms-map.json 갱신:`);
    for (const d of missingForms) console.log(`  - ${d}`);
  }

  // Exit
  const blockerLeft = missingNodes.length + needsAlignment.length + missingForms.length;
  if (blockerLeft === 0) {
    console.log("\n✅ PASS — 모든 법정의무 문서가 1:1 정합 (노드 + 양식 + 정합 완료)");
    process.exit(0);
  } else {
    console.log(`\n⚠️ NEEDS_WORK — ${blockerLeft}건 잔여 (노드 ${missingNodes.length} / 정합 ${needsAlignment.length} / 양식 ${missingForms.length})`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
