#!/usr/bin/env tsx
/**
 * scaffold-missing-nodes.ts
 *
 * 마스터 리스트에 있으나 노드가 없는 docId 들에 대해 기본 스켈레톤 노드 생성.
 * sections.fields 는 빈 메타 + 결재선 4필드만. 정합은 후속 작업으로.
 *
 * 호출: npx tsx scripts/ontology/scaffold-missing-nodes.ts
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
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

const FREQ_TO_CYCLE: Record<string, string> = {
  "매일": "cyc:daily",
  "매주": "cyc:weekly",
  "매월": "cyc:monthly",
  "월": "cyc:monthly",
  "월·정산": "cyc:monthly",
  "월·반기": "cyc:monthly",
  "분기": "cyc:quarterly",
  "반기": "cyc:semi_annual",
  "연": "cyc:annual",
  "연1회/특수 6개월": "cyc:annual",
  "사고시 즉시": "cyc:ad_hoc",
  "사고시 1개월": "cyc:ad_hoc",
  "사고후": "cyc:ad_hoc",
  "현장개설": "cyc:on_construction_open",
  "선임시": "cyc:on_appointment",
  "발주시": "cyc:on_construction_open",
  "설계시": "cyc:on_construction_open",
  "착공": "cyc:on_construction_open",
  "작업단위": "cyc:ad_hoc",
  "작업변경시": "cyc:ad_hoc",
  "특수작업시": "cyc:ad_hoc",
  "채용시": "cyc:ad_hoc",
  "변경시": "cyc:ad_hoc",
  "지정시": "cyc:ad_hoc",
  "기계도입시": "cyc:ad_hoc",
  "주기검사": "cyc:annual",
  "수시": "cyc:as_needed",
  "해체전": "cyc:ad_hoc",
  "타설전": "cyc:ad_hoc",
  "조립후": "cyc:ad_hoc",
  "건설 2일1회 / 기타 주1회": "cyc:weekly",
  "건설 2개월1회 / 기타 분기": "cyc:bimonthly",
  "매일·매주·매월": "cyc:monthly",
};

function cyclePath(cycle: string, docId: string): string {
  const c = cycle.replace("cyc:", "").replace(/_/g, "_");
  return `doc:${c}/${docId}`;
}

function legalToIris(refs: string[]): string[] {
  return refs.map((r) => {
    const [law, art] = r.split(":");
    if (!law || !art) return "";
    if (law === "산안법") return `art:산안법:${art}`;
    if (law === "산안법시행령") return `art:산안법시행령:${art}`;
    if (law === "산안법시행규칙") return `art:산안법시행규칙:${art}`;
    if (law === "산안기준규칙") {
      if (art.startsWith("별표")) return `annex:기준규칙:${art}`;
      return `art:기준규칙:${art}`;
    }
    if (law === "중처법") return `art:중처법:${art}`;
    if (law === "위험성평가-고시") return `art:위험성평가-고시:${art.split(":")[0]}`;
    return "";
  }).filter(Boolean);
}

function categoryToDocCategory(cat: string): string {
  const m: Record<string, string> = {
    "A_체제": "appointment",
    "B_위평": "risk_assessment",
    "C_교육": "education",
    "D_작업계획": "work_plan",
    "E_작업허가": "permit",
    "F_도급": "council",
    "G_점검": "inspection",
    "H_화학": "register",
    "I_측정": "report",
    "J_건강": "report",
    "K_사고": "report",
    "L_진단": "report",
    "M_인증": "application",
    "N_비용": "register",
  };
  return m[cat] ?? "general";
}

function buildSkeletonNode(m: MasterDoc): any {
  const cycle = FREQ_TO_CYCLE[m.frequency] ?? "cyc:as_needed";
  const cycleStr = cycle.replace("cyc:", "");
  const id = `doc:${cycleStr}/${m.docId}`;
  return {
    "@context": "../../context.jsonld",
    "@id": id,
    "@type": ["Document", "DigitalDocument"],
    docId: m.docId,
    title: m.title,
    description: `${m.title} - ${m.legalRef.join(" + ")} (자동 생성 스켈레톤. 후속 양식 정합 필요).`,
    cycle,
    trigger: m.frequency,
    legalBasis: legalToIris(m.legalRef),
    officialFormSpec: {
      formId: `auto_skeleton_${m.docId}`,
      officialName: `${m.title} (${m.formSource})`,
      formMatchType: "스켈레톤 자동 생성 — 양식 정합 후속 필요",
      license: "공공누리 + 황룡건설(주) + ㈜라텔웍스",
    },
    sections: [
      {
        title: "1. 문서 메타",
        legalSource: m.legalRef.join(" + "),
        fields: [
          { key: "documentNumber", label: "문서 번호", required: true, inputGuide: "현장 자체 일련번호. 양식: 'DOC-YYMMDD-NN'.", examples: [], checkPoints: [] },
          { key: "siteName", label: "사업장 / 현장명", required: true, inputGuide: "사업장 정식 명칭.", examples: [], checkPoints: [] },
          { key: "compileDate", label: "작성 일자", required: true, inputGuide: "작성 일자 (YYYY-MM-DD).", examples: [], checkPoints: [] },
          { key: "compiler", label: "작성자 (안전관리자)", required: true, inputGuide: "작성자 성명·직책.", examples: [], checkPoints: [] },
        ],
      },
      {
        title: "2. 본문 (양식 정합 후속 필요)",
        legalSource: m.legalRef.join(" + "),
        fields: [
          { key: "content", label: "본문 내용", required: true, inputGuide: `${m.title} 본문. 양식 정합 후 sections.fields 보강 필요.`, examples: [], checkPoints: [] },
        ],
      },
      {
        title: "3. 결재선",
        legalSource: m.legalRef[0] ?? "",
        fields: [
          { key: "compiler_sign", label: "작성자 (안전관리자) 서명", required: true, inputGuide: "안전관리자 성명·서명.", examples: [], checkPoints: [] },
          { key: "supervisor_sign", label: "관리감독자 서명", required: true, inputGuide: "관리감독자 성명·서명.", examples: [], checkPoints: [] },
          { key: "principal_sign", label: "사업주 / 안전보건관리책임자 서명", required: true, inputGuide: "사업주 또는 안전보건관리책임자(현장소장) 성명·서명.", examples: [], checkPoints: [] },
        ],
      },
    ],
    approvalChain: [
      { role: "작성자 (안전관리자)", action: "기안" },
      { role: "관리감독자", action: "검토" },
      { role: "사업주 / 안전보건관리책임자", action: "최종 승인" },
    ],
    reviewRules: [
      { rule: "문서 메타 (사업장명·작성일자·작성자) 명시", severity: "blocker", legalBasis: m.legalRef[0] ?? "", checkFields: ["siteName", "compileDate", "compiler"] },
      { rule: "사업주 + 안전관리자 서명", severity: "blocker", legalBasis: m.legalRef[0] ?? "", checkFields: ["compiler_sign", "principal_sign"] },
    ],
    penaltyOnMissing: m.penaltyOnMissing.startsWith("산안법") ? `penalty:${m.penaltyOnMissing}` : (m.penaltyOnMissing.startsWith("중처법") ? `penalty:${m.penaltyOnMissing}` : "—"),
    retention: m.retention,
    guidedBy: [],
    verificationStatus: "scaffold",
    _meta: {
      publishedBy: "황룡건설(주) + ㈜라텔웍스",
      sourceLaw: legalToIris(m.legalRef)[0] ?? "",
      createdAt: "2026-04-29",
      createdBy: "scaffold-missing-nodes.ts (마스터 리스트 자동 생성)",
      note: "스켈레톤 노드. 후속 양식 정합 작업 필요 (sections.fields 양식 그대로 + inputGuide + examples 보강).",
      documentCategory: categoryToDocCategory(m.category),
    },
    applicableWhen: {
      appliesTo: "applic:all_workplace",
      scaleNotes: m.applicableScope,
    },
    hasHazard: [],
    appliesToActivities: [],
    informedBy: [],
  };
}

function docIdToFileName(docId: string): string {
  return docId.replace(/_/g, "-") + ".jsonld";
}

async function main() {
  const masterTxt = await readFile(resolve(ROOT, "src/ontology/legal-duty-master.json"), "utf8");
  const master = JSON.parse(masterTxt);
  const dir = resolve(ROOT, "src/ontology/graph/nodes/documents");
  const existing = new Set<string>();
  for (const e of await readdir(dir)) {
    if (!e.endsWith(".jsonld")) continue;
    try {
      const node = JSON.parse(await readFile(resolve(dir, e), "utf8"));
      if (node.docId) existing.add(node.docId);
    } catch {}
  }

  let created = 0;
  for (const m of master.documents as MasterDoc[]) {
    if (existing.has(m.docId)) continue;
    const node = buildSkeletonNode(m);
    const fname = docIdToFileName(m.docId);
    await writeFile(resolve(dir, fname), JSON.stringify(node, null, 2), "utf8");
    console.log(`  + ${fname} (${m.docId})`);
    created++;
  }
  console.log(`\n총 ${created}종 신규 스켈레톤 생성`);
}

main().catch((e) => { console.error(e); process.exit(1); });
