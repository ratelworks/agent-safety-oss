#!/usr/bin/env tsx
/**
 * test-safety-management-plan.ts — 안전관리계획서가 법정 수립기준 원문대로 짜였는가
 *
 *   1. 건설기술 진흥법 시행규칙 별표 7 제2호(총괄 안전관리계획) 가~라목 항목마다 칸이 있고, 칸 안내가 별표 원문 문구를 담는다
 *   2. 별표 7 제3호(공종별 세부 안전관리계획) 각 목 항목·타워크레인 사용공사 4개 항목도 칸으로 있다
 *   3. 칸 안내가 인용한 시행령 제98조·제99조·제100조·제103조, 「건설공사 안전관리 업무수행 지침」 제14조·제15조·제20조·제21조 문구가
 *      수록 조문 노드 원문에 그대로 있다 (그 조문 노드가 문서 근거에 걸려 있다)
 *   4. 위반 시 처벌이 건설기술 진흥법 제88조제7호이고, 위반 문구가 조문 원문 그대로다
 *   5. 생성한 문서(Markdown·정본)에 별표 7 항목과 처벌이 모두 나온다
 *
 * 사용: tsx scripts/test/test-safety-management-plan.ts
 */
import "./isolated-storage.js"; // 저장 폴더를 임시 폴더로 — 사용자 문서 폴더에 파일을 남기지 않는다
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSafetyDocumentTool } from "../../src/tools/generate-safety-document.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const DOC_FILE = resolve(NODES, "documents", "construction-safety-management-plan.jsonld");
const DOC_ID = "construction_safety_management_plan";
const PENALTY = "penalty:건진법:88-7";

/** 별표 7 항목 — [칸 key, source 에 들어갈 위치, 칸 안내에 들어 있어야 할 별표 원문 문구] */
const ANNEX7_ITEMS: Array<[string, string, string]> = [
  ["projectOverview", "제2호 가목", "공사개요"],
  ["locationMap", "제2호 가목", "위치도"],
  ["masterSchedule", "제2호 가목", "전체 공정표"],
  ["designDocuments", "제2호 가목", "인가·허가 또는 승인한 행정기관 등에 이미 제출된 경우는 제외한다"],
  ["siteConditions", "제2호 나목 1)", "현장시공 조건, 주변 교통 여건 및 환경요소 등"],
  ["keyProcessRisks", "제2호 나목 2) 가)", "핵심관리가 필요한 공정으로 선정된 공정의 위험 요소, 위험성 및 그에 대한 저감대책"],
  ["mustConsiderRisks", "제2호 나목 2) 나)", "시공단계에서 반드시 고려해야 하는 위험 요소, 위험성 및 그에 대한 저감대책"],
  ["contractorFoundRisks", "제2호 나목 2) 다)", "시공자가 시공단계에서 위험 요소 및 위험성을 발굴한 경우에 대한 저감대책 마련 방안"],
  ["surroundingsSafety", "제2호 나목 3)", "주변 시설물에 대한 안전 관련 협의서류 및 지반침하 등에 대한 계측계획을 포함한다"],
  ["trafficPlan", "제2호 나목 4) 가)", "교통 신호수 배치계획, 교통안전시설물 점검계획"],
  ["equipmentGuides", "제2호 나목 4) 나)", "공사장 내부의 주요 지점별 건설기계·장비의 전담유도원 배치계획"],
  ["safetyOrganization", "제2호 다목 1)", "비상시의 경우를 별도로 구분하여 작성한다"],
  ["inspectionPlan", "제2호 다목 2) 가)", "자체안전점검, 정기안전점검의 시기·내용, 안전점검 공정표, 안전점검 체크리스트 등 실시계획"],
  ["monitoringPlan", "제2호 다목 2) 나)", "공사장 상부에서 전체를 실시간으로 파악할 수 있도록 폐쇄회로 텔레비전의 설치·운영계획을 마련해야 한다"],
  ["safetyCostPlan", "제2호 다목 3)", "안전관리비의 계상, 산출·집행계획, 사용계획 등"],
  ["educationPlan", "제2호 다목 4)", "안전교육계획표, 교육의 종류·내용 및 교육관리"],
  ["reportingPlan", "제2호 다목 5)", "감독관의 작업허가가 필요한 공정과 그 시기"],
  ["emergencyResponse", "제2호 라목 1)", "내부·외부 비상연락망, 비상동원조직, 경보체제, 응급조치 및 복구"],
  ["fireEvacuation", "제2호 라목 2)", "단열재 시공시점부터는 월 1회 이상 비상대피 훈련을 실시해야 한다"],
  ["detailOverview", "제3호 각 목 1)", "구조물해체의 대상·공법 등의 개요"],
  ["detailProcedure", "제3호 각 목 2)", "지하매설물, 지하수위 변동 및 흐름, 되메우기 다짐 등"],
  ["detailInspection", "제3호 각 목 3)", "안전점검계획표 및 안전점검표"],
  ["detailCalculation", "제3호 각 목 4)", "굴착 비탈면, 흙막이 등 안전성 계산서"],
  ["towerCraneOperation", "제3호 아목 1)", "타워크레인간 충돌방지계획 및 공사장 외부 선회방지"],
  ["towerCraneInspection", "제3호 아목 2)", "점검시기, 점검 체크리스트 및 검사업체 선정계획 등"],
  ["towerCraneRental", "제3호 아목 3)", "저가임대 및 재임대 방지방안을 포함한다"],
  ["towerCraneCalculation", "제3호 아목 4)", "현장조건을 반영한 타워크레인의 기초 및 브레이싱에 대한 계산서는 반드시 포함해야 한다"],
];

/** 칸 안내가 인용한 조문 문구 — [칸 key, 조문 노드 파일 이름, 원문 문구] */
const CITED: Array<[string, string, string]> = [
  ["integratedWithHazardPlan", "건진법시행령-§98", "유해위험방지계획을 수립해야 하는 건설공사"],
  ["preReview", "건진법시행령-§98", "공사감독자 또는 건설사업관리기술인의 검토"],
  ["reviewResult", "건진법시행령-§98", "20일 이내"],
  ["surroundingsSafety", "건진법시행령-§99", "굴착공사로 인한 위험징후 감지를 위한 계측계획"],
  ["inspectionPlan", "건진법시행령-§100", "매일 자체안전점검"],
  ["educationPlan", "건진법시행령-§103", "매일 공사 착수 전"],
  ["educationPlan", "건진법시행령-§103", "시공상세도면에 따른 세부 시공순서 및 시공기술상의 주의사항"],
  ["inspectionPlan", "건설안전관리-지침-§21", "건설공사의 공사기간동안 매일 공종별 실시"],
  ["inspectionPlan", "건설안전관리-지침-§20", "현장기록 양식"],
  ["reportingPlan", "건설안전관리-지침-§14", "건설사업관리기술인에게 서면으로 보고"],
  ["detailWorkType", "건설안전관리-지침-§14", "작업현장에 비치"],
  ["residualDesignRisks", "건설안전관리-지침-§15", "설계에서 잔존하여 시공단계에서 반드시 고려해야 하는 위험요소"],
];

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}
/** 비교용 — 띄어쓰기·가운뎃점 표기(ㆍ·)·괄호 안 한자 차이를 없앤다 */
const flat = (s: string): string => s.replace(/ㆍ/g, "·").replace(/\([一-龥]+\)/g, "").replace(/[\s"'“”]/g, "");

interface Field { key: string; label: string; required?: boolean; source?: string; inputGuide?: string }
interface Doc { legalBasis: string[]; penaltyOnMissing: string; sections: Array<{ title: string; legalSource?: string; fields: Field[] }> }

async function nodeText(dir: string, name: string): Promise<string> {
  return (JSON.parse(await readFile(resolve(NODES, dir, `${name}.jsonld`), "utf8")) as { description?: string }).description ?? "";
}

async function main(): Promise<void> {
  const doc = JSON.parse(await readFile(DOC_FILE, "utf8")) as Doc;
  const fields = new Map(doc.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
  const annex = flat(await nodeText("articles", "건진법시행규칙-§58"));

  // 1·2. 별표 7 항목
  const badAnnex: string[] = [];
  for (const [key, where, phrase] of ANNEX7_ITEMS) {
    const f = fields.get(key);
    if (!f || !(f.source ?? "").includes(where) || !flat(f.inputGuide ?? "").includes(flat(phrase)) || !annex.includes(flat(phrase))) badAnnex.push(`${key}(${where})`);
  }
  check(`별표 7 항목 ${ANNEX7_ITEMS.length}개 — 칸이 있고 출처 위치·안내 문구가 별표 원문과 같다`, badAnnex.length === 0, badAnnex.join(", "));
  const totalPlan = ANNEX7_ITEMS.filter(([, where]) => where.startsWith("제2호")).map(([key]) => key);
  const optional = totalPlan.filter((key) => !fields.get(key)?.required);
  check("총괄 안전관리계획(제2호) 칸은 모두 필수다", optional.length === 0, optional.join(", "));

  // 3. 인용 조문
  const badCite: string[] = [];
  for (const [key, file, phrase] of CITED) {
    const text = flat(await nodeText("articles", file).catch(() => ""));
    if (!text.includes(flat(phrase)) || !flat(fields.get(key)?.inputGuide ?? "").includes(flat(phrase))) badCite.push(`${key}↔${file}`);
  }
  check(`칸 안내가 인용한 시행령·지침 문구 ${CITED.length}개가 조문 원문에 그대로 있다`, badCite.length === 0, badCite.join(", "));
  const citedIris = [...new Set(CITED.map(([, file]) => `art:${file.replace("-§", ":")}`))];
  const unlinked = citedIris.filter((iri) => !doc.legalBasis.includes(iri));
  check("인용한 조문이 문서 근거(legalBasis)에 걸려 있다", unlinked.length === 0, unlinked.join(", "));
  const missingNodes: string[] = [];
  for (const iri of doc.legalBasis) {
    const [, law, n] = iri.split(":");
    if (!(await nodeText("articles", `${law}-§${n}`).catch(() => ""))) missingNodes.push(iri);
  }
  check("문서 근거 조문이 모두 원문과 함께 수록돼 있다", missingNodes.length === 0, missingNodes.join(", "));

  // 4. 처벌
  const penalty = JSON.parse(await readFile(resolve(NODES, "penalties", "건진법-§88-7.jsonld"), "utf8")) as { "@id": string; articleRef: string; _meta: { quote: string } };
  const art88 = flat(await nodeText("articles", "건진법-§88"));
  check("위반 시 처벌이 건설기술 진흥법 제88조제7호다", doc.penaltyOnMissing === PENALTY && penalty["@id"] === PENALTY && penalty.articleRef === "art:건진법:88");
  check("처벌 위반 문구가 제88조 원문 그대로이고 안전관리계획(제62조제1항)을 다룬다", art88.includes(flat(penalty._meta.quote)) && penalty._meta.quote.includes("제62조제1항에 따른 안전관리계획"));

  // 5. 생성 문서
  const draft = { workName: "흙막이 굴착", siteName: "시험 현장" };
  const md = (await generateSafetyDocumentTool.handler({ docId: DOC_ID, draft, useProfile: false, format: "md" })).content[0].text as string;
  // 문서 메타·결재선(공통 칸)은 공통 표로 그린다 — 이 서류의 법정 항목 칸만 본다
  const ownFields = doc.sections.filter((s) => s.legalSource !== "공통").flatMap((s) => s.fields);
  const missingLabels = ownFields.filter((f) => !md.includes(f.label)).map((f) => f.key);
  check("Markdown 본문에 이 서류의 칸이 모두 나온다", missingLabels.length === 0, missingLabels.join(", "));
  check("Markdown 본문에 처벌(2년 이하 징역 또는 2천만원 이하 벌금)이 나온다", md.includes("2년 이하 징역 또는 2천만원 이하 벌금"));
  check("작업명을 주면 공종 단계별 위험요인·근거 표가 붙는다(핵심관리 공정 작성 근거)", md.includes("## 작업 단계별 위험요인·근거"));
  const xml = (await generateSafetyDocumentTool.handler({ docId: DOC_ID, draft, useProfile: false, format: "doclang" })).content[0].text as string;
  const missingCanon = ownFields.filter((f) => !flat(xml).includes(flat(f.label))).map((f) => f.key);
  check("정본에 이 서류의 칸과 처벌이 모두 나온다", missingCanon.length === 0 && xml.includes("2년 이하 징역"), missingCanon.join(", "));

  console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
