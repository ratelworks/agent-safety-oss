#!/usr/bin/env tsx
/**
 * connect-orphans.ts
 *
 * audit-graph-health 가 보고한 orphan(in-degree=0) 노드들을 그래프에 연결.
 * 동시에 마지막 9개 dangling 보강 article 도 stub 생성.
 *
 * 접근:
 *  · article orphan → doc.legalBasis 에 추가 (해당 의무문서가 인용)
 *  · activity orphan → article.regulates 에 추가 (모법/기준규칙이 규제)
 *  · equipment orphan → article.regulates 에 추가
 *  · penalty orphan → article.penalizedBy 에 추가
 *  · 일부 orphan article 은 다른 article 의 delegates / penalty.imposedBy 로 연결
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const DOCS = resolve(NODES, "documents");

// id → file path 매핑
const idToFile = new Map<string, string>();

async function indexNodes(dir: string) {
  for (const e of await readdir(dir)) {
    const p = join(dir, e);
    const st = await stat(p);
    if (st.isDirectory()) await indexNodes(p);
    else if (e.endsWith(".jsonld")) {
      try {
        const node = JSON.parse(await readFile(p, "utf-8")) as { "@id"?: string };
        if (node["@id"]) idToFile.set(node["@id"], p);
      } catch {}
    }
  }
}

async function patchNode(id: string, mutate: (n: Record<string, unknown>) => void): Promise<boolean> {
  const path = idToFile.get(id);
  if (!path) {
    console.warn(`[skip] not found: ${id}`);
    return false;
  }
  const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  mutate(node);
  await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
  return true;
}

function addToArray(node: Record<string, unknown>, key: string, values: string[]) {
  const cur = (node[key] as string[] | undefined) ?? [];
  const set = new Set(cur);
  for (const v of values) set.add(v);
  node[key] = [...set];
}

// ─── 매핑 정의 ───
// article ← doc.legalBasis (article orphan 해소)
const DOC_LEGAL_BASIS: Array<{ doc: string; arts: string[] }> = [
  // 비계 (기준규칙 §63-71) → 새 doc 또는 work-plan에 통합. 가장 적절한 곳: work_plan_scaffolding 없음. work-permit-high-altitude 활용.
  { doc: "doc:ad_hoc/work_permit_high_altitude",
    arts: ["art:기준규칙:63","art:기준규칙:64","art:기준규칙:65","art:기준규칙:66","art:기준규칙:67","art:기준규칙:68","art:기준규칙:69","art:기준규칙:70","art:기준규칙:71"] },
  // 화재폭발 (기준규칙 §236-244) → work-permit (화기)
  { doc: "doc:ad_hoc/work_permit",
    arts: ["art:기준규칙:236","art:기준규칙:237","art:기준규칙:238","art:기준규칙:240","art:기준규칙:243","art:기준규칙:244"] },
  // 전기작업 (기준규칙 §301-305) → work-permit-loto
  { doc: "doc:ad_hoc/work_permit_loto",
    arts: ["art:기준규칙:301","art:기준규칙:302","art:기준규칙:303","art:기준규칙:304","art:기준규칙:305"] },
  // 거푸집동바리 (기준규칙 §335-337) → work-plan-formwork (없으면 work-plan 일반)
  { doc: "doc:ad_hoc/work_plan",
    arts: ["art:기준규칙:335","art:기준규칙:336","art:기준규칙:337","art:기준규칙:343","art:기준규칙:344","art:기준규칙:345","art:기준규칙:346"] },
  // 밀폐공간 (기준규칙 §618-625) → work-permit-confined-space
  { doc: "doc:ad_hoc/work_permit_confined_space",
    arts: ["art:기준규칙:618","art:기준규칙:621","art:기준규칙:622","art:기준규칙:623","art:기준규칙:624","art:기준규칙:625"] },
  // 산안법 §38 안전조치, §39 보건조치 → 다수 의무문서가 모법 인용해야 함
  { doc: "doc:annual/safety_health_management_policy",
    arts: ["art:산안법:38","art:산안법:39"] },
  // 산안법 벌칙 §168-175 → severe_accident_compliance 가 인용
  { doc: "doc:semi_annual/severe_accident_compliance",
    arts: ["art:산안법:168","art:산안법:169","art:산안법:170","art:산안법:171","art:산안법:175","art:중처법:6","art:중처법:7"] },
];

// article.regulates += [activity/equipment] (activity/equipment orphan 해소)
const ART_REGULATES: Array<{ art: string; targets: string[] }> = [
  // 비계 / 고소작업 / 작업장 안전조치
  { art: "art:기준규칙:63", targets: ["activity:scaffolding_assembly"] },
  { art: "art:기준규칙:64", targets: ["activity:scaffolding_assembly"] },
  { art: "art:기준규칙:65", targets: ["activity:scaffolding_assembly"] },
  { art: "art:기준규칙:66", targets: ["activity:scaffolding_assembly"] },
  { art: "art:기준규칙:67", targets: ["activity:scaffolding_assembly"] },
  { art: "art:기준규칙:68", targets: ["activity:scaffolding_assembly"] },
  { art: "art:기준규칙:69", targets: ["activity:scaffolding_assembly"] },
  { art: "art:기준규칙:70", targets: ["activity:scaffolding_assembly", "equipment:fall_prevention_temporary"] },
  { art: "art:기준규칙:71", targets: ["activity:scaffolding_assembly", "equipment:fall_prevention_temporary"] },
  // 화재폭발 (건설현장 용접·용단 한정 — 화학설비 운영은 비건설 도메인)
  { art: "art:기준규칙:240", targets: ["equipment:welding_cutting_apparatus"] },
  { art: "art:기준규칙:243", targets: ["equipment:welding_cutting_apparatus"] },
  // 전기작업
  { art: "art:기준규칙:301", targets: ["activity:electric_work_50v_plus", "equipment:ac_arc_welder"] },
  { art: "art:기준규칙:302", targets: ["activity:electric_work_50v_plus"] },
  { art: "art:기준규칙:303", targets: ["activity:electric_work_50v_plus"] },
  { art: "art:기준규칙:304", targets: ["activity:electric_work_50v_plus", "equipment:ac_arc_welder"] },
  { art: "art:기준규칙:305", targets: ["activity:electric_work_50v_plus"] },
  // 거푸집동바리 + 굴착
  { art: "art:기준규칙:335", targets: ["activity:formwork_shoring"] },
  { art: "art:기준규칙:336", targets: ["activity:formwork_shoring"] },
  { art: "art:기준규칙:337", targets: ["activity:formwork_shoring"] },
  { art: "art:기준규칙:343", targets: ["activity:excavation_2m_plus", "activity:tunnel_excavation"] },
  { art: "art:기준규칙:344", targets: ["activity:excavation_2m_plus", "activity:tunnel_excavation"] },
  { art: "art:기준규칙:345", targets: ["activity:excavation_2m_plus", "activity:tunnel_excavation"] },
  { art: "art:기준규칙:346", targets: ["activity:excavation_2m_plus", "activity:tunnel_excavation"] },
  // 밀폐공간
  { art: "art:기준규칙:618", targets: ["activity:underground_utility", "activity:tunnel_excavation"] },
  { art: "art:기준규칙:621", targets: ["activity:underground_utility"] },
  { art: "art:기준규칙:622", targets: ["activity:underground_utility"] },
  { art: "art:기준규칙:623", targets: ["activity:underground_utility"] },
  { art: "art:기준규칙:624", targets: ["activity:underground_utility"] },
  { art: "art:기준규칙:625", targets: ["activity:underground_utility"] },
  // 산안법 §38 안전조치 → 거의 모든 활동 적용
  { art: "art:산안법:38",
    targets: ["activity:rc_concrete","activity:steel_structure","activity:formwork_shoring","activity:scaffolding_assembly","activity:excavation_2m_plus","activity:demolition","activity:waterproofing","activity:finishing_paint","activity:finishing_tile","activity:phc_pile_driving","activity:earthwork_landfill","activity:road_pavement","activity:underground_utility","activity:drainage_sewerage","activity:bridge_5m_30m","activity:tunnel_excavation","activity:tower_assembly","activity:tower_crane","activity:heavy_lifting","activity:vehicle_cargo","activity:vehicle_construction","activity:safety_education","activity:tbm_daily","activity:risk_assessment_general","activity:electric_work_50v_plus","activity:asbestos_removal"] },
  // 산안법 §39 보건조치 → 석면·전기 등 보건 위험
  { art: "art:산안법:39",
    targets: ["activity:asbestos_removal"] },
  // 산안법 벌칙은 활동 직접 regulates 안 함 (penalty 매핑은 아래)
  // 안전인증 대상 기계기구 — 건설현장 적용 한정 (lift/gondola/crane/aerial_work_platform)
  { art: "art:산안법:80", targets: ["equipment:lift","equipment:gondola","equipment:power_saw","equipment:crane","equipment:aerial_work_platform"] },
];

// article.penalizedBy += [penalty]  (penalty orphan 해소)
const ART_PENALIZED: Array<{ art: string; penalties: string[] }> = [
  { art: "art:산안법:38",  penalties: ["penalty:산안법:167","penalty:산안법:168"] },
  { art: "art:산안법:39",  penalties: ["penalty:산안법:167","penalty:산안법:168"] },
  { art: "art:산안법:54",  penalties: ["penalty:산안법:170"] },
  { art: "art:산안법:57",  penalties: ["penalty:산안법:170의2","penalty:산안법:171"] },
  { art: "art:산안법:36",  penalties: ["penalty:산안법:170의2"] },
  { art: "art:산안법:42",  penalties: ["penalty:산안법:169"] },
  { art: "art:중처법:4",   penalties: ["penalty:중처법:7"] },
];

// 잔여 9개 dangling article stub
const REMAINING_ART_STUBS: Array<{ act: string; num: string; title: string; legalBasisOf?: string[]; description: string }> = [
  { act: "산안법", num: "119", title: "석면조사",
    legalBasisOf: ["doc:ad_hoc/asbestos_investigation_report"],
    description: "건축물·설비 소유주의 일반석면조사 의무. §142 기관석면조사로 위임 (50㎡ 이상 건축물·15㎡ 이상 단열재)." },
  { act: "산안법", num: "138", title: "질병자의 근로 금지·제한",
    legalBasisOf: ["doc:annual/health_examination_followup"],
    description: "감염병·정신질환·심장질환 등 근로로 병세가 악화될 우려가 있는 근로자에 대한 사업주의 근로 금지·제한 의무." },
  { act: "산안법시행령", num: "29", title: "산업보건의 자격·직무",
    description: "산안법 §22 위임. 산업보건의 자격(의사) 및 직무 (건강진단 결과 검토·근로자 건강관리 지도 등)." },
  { act: "산안법시행령", num: "32", title: "명예산업안전감독관 위촉·임기·해촉",
    description: "산안법 §23 위임. 위촉 자격, 임기 2년, 해촉 사유, 활동지원금 등." },
  { act: "산안법시행령", num: "59", title: "건설재해예방 지도대상 건설공사",
    description: "산안법 §73 위임. 1억 원 이상 120억 원 미만 건설공사. 토목공사는 1억~150억." },
  { act: "산안법시행규칙", num: "41", title: "감정노동 보호조치 세부",
    description: "산안법 §41 위임. 폭언등 발생 시 업무 일시 중단·전환·치료지원·법적 조치 안내 등." },
  { act: "산안법시행규칙", num: "55", title: "안전보건진단의 종류·내용",
    description: "산안법 §47 위임. 종합진단·안전기술진단·보건기술진단 구분, 진단보고서 제출기한." },
  { act: "산안법시행규칙", num: "188", title: "작업환경측정 결과의 보존",
    description: "산안법 §126 위임. 측정결과 5년 보존 (특수건강진단 대상 물질은 30년)." },
  { act: "산안법시행규칙", num: "220", title: "건강진단 결과 보존",
    description: "산안법 §134 위임. 일반건강진단 5년, 특수건강진단 30년 보존." }
];

(async () => {
  await indexNodes(NODES);
  console.log(`[index] ${idToFile.size} nodes`);

  // 0. 잔여 dangling article stub 추가
  let stubCount = 0;
  for (const a of REMAINING_ART_STUBS) {
    const fname = `${a.act}-§${a.num}.jsonld`;
    const path = resolve(ARTICLES, fname);
    const obj = {
      "@context": "../../context.jsonld",
      "@id": `art:${a.act}:${a.num}`,
      "@type": ["Article", "Legislation"],
      articleNumber: a.num,
      title: a.title,
      partOf: a.act === "산안법" ? "act:산업안전보건법" :
              a.act === "산안법시행령" ? "act:산업안전보건법시행령" :
              "act:산업안전보건법시행규칙",
      verificationStatus: "stub",
      ...(a.legalBasisOf && { legalBasisOf: a.legalBasisOf }),
      _meta: {
        publishedBy: "법제처 국가법령정보센터 (자동 stub)",
        sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(
          a.act === "산안법" ? "산업안전보건법" :
          a.act === "산안법시행령" ? "산업안전보건법시행령" :
          "산업안전보건법시행규칙"
        )}/제${a.num}조`,
        fetchedAt: "2026-04-28",
        licenseHint: "저작권법 §7 비보호 (자유 인용)",
        note: "Coverage closure stub (Phase 2.5 wave2)."
      },
      description: a.description,
      legislationIdentifier:
        a.act === "산안법" ? "산업안전보건법" :
        a.act === "산안법시행령" ? "산업안전보건법 시행령" :
        "산업안전보건법 시행규칙",
      legislationDate: "2025-10-01",
      legislationType: a.act === "산안법" ? "Act" : "Regulation",
      legislationLegalForce: "InForce",
      jurisdiction: "KR",
      temporalCoverage: "2025-10-01/.."
    };
    await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
    idToFile.set(obj["@id"], path);
    stubCount++;
  }
  console.log(`[stub] ${stubCount} 잔여 article stub 추가`);

  // 1. doc.legalBasis 보강 (article orphan 해소)
  let docPatched = 0;
  for (const m of DOC_LEGAL_BASIS) {
    const ok = await patchNode(m.doc, (n) => addToArray(n, "legalBasis", m.arts));
    if (ok) docPatched++;
  }
  console.log(`[doc] legalBasis ${docPatched} 패치`);

  // 2. article.regulates 보강 (activity/equipment orphan 해소)
  let artPatched = 0;
  for (const m of ART_REGULATES) {
    const ok = await patchNode(m.art, (n) => addToArray(n, "regulates", m.targets));
    if (ok) artPatched++;
  }
  console.log(`[art] regulates ${artPatched} 패치`);

  // 3. article.penalizedBy 보강 (penalty orphan 해소)
  let penPatched = 0;
  for (const m of ART_PENALIZED) {
    const ok = await patchNode(m.art, (n) => addToArray(n, "penalizedBy", m.penalties));
    if (ok) penPatched++;
  }
  console.log(`[penalty] penalizedBy ${penPatched} 패치`);

  console.log("✅ orphan 연결 완료");
})();
