#!/usr/bin/env tsx
/**
 * expand-kosha-guidedby-prefix.ts
 * 키워드 미매칭 KOSHA Guide 를 KOSHA 코드 prefix 기반 fallback 으로
 * 활동/위험 노드의 guidedBy 에 추가. 활용률 70%+ → 95%+ 끌어올림.
 *
 * KOSHA 코드 분류 (KOSHA 안전기술지침 분류체계 기반):
 *   A   일반·관리   →  risk_assessment_general · safety_education
 *   B   기계        →  vehicle_construction · machine_entanglement
 *   B-E 전기설비    →  electric_work_50v_plus · electric_shock
 *   B-M 기계본체    →  vehicle_construction · machine_entanglement
 *   C   건설일반    →  rc_concrete · risk_assessment_general
 *   C-C 건설화학    →  chemical_facility
 *   D   건설구조    →  steel_structure · rc_concrete
 *   D-C 건설공법    →  rc_concrete
 *   E   환경/위생   →  chemical_exposure · safety_education
 *   E-G 환경관리    →  safety_education · chemical_exposure
 *   E-M 환경기계    →  vehicle_construction
 *   E-T 환경장치    →  chemical_facility
 *   G   일반관리    →  risk_assessment_general
 *   H   보건        →  chemical_exposure · safety_education
 *   M   기계관리    →  vehicle_construction · machine_entanglement
 *   O   운영관리    →  risk_assessment_general
 *   P   공정안전    →  chemical_facility · chemical_exposure
 *   T   교육·훈련   →  safety_education
 *   W   작업환경    →  safety_education · dust_exposure
 *   X   기타        →  risk_assessment_general
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");
const ACTIVITIES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "activities");
const HAZARDS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "hazards");

const EDGE_PROPS = ["delegates","references","hasArticle","partOf","hasAnnex","specifies","regulates","penalizedBy","penalizedByDelegated","appliesTo","requires","mitigatedBy","mitigates","causedBy","evaluatedBy","cycledAs","legalBasisOf","legalBasis","penaltyOnMissing","relatedDocs","guidedBy","amendedTo","interpretedBy","auditedBy","informedBy","hasHazard","regulatedBy","cycle"];

// KOSHA 코드 prefix → 활동/위험 fallback (각 1~2개로 over-link 방지)
const PREFIX_MAP: Array<{ prefix: RegExp; activities?: string[]; hazards?: string[] }> = [
  { prefix: /^A-G/,   activities: ["activity:safety_education"], hazards: ["hazard:msd_repetitive"] },
  { prefix: /^A/,     activities: ["activity:risk_assessment_general"] },
  { prefix: /^B-E/,   activities: ["activity:electric_work_50v_plus"], hazards: ["hazard:electric_shock"] },
  { prefix: /^B-M/,   activities: ["activity:vehicle_construction"], hazards: ["hazard:machine_entanglement"] },
  { prefix: /^B/,     activities: ["activity:vehicle_construction"], hazards: ["hazard:machine_entanglement"] },
  { prefix: /^C-C/,   hazards: ["hazard:chemical_exposure"] },
  { prefix: /^C/,     activities: ["activity:rc_concrete"], hazards: ["hazard:fall_from_height"] },
  { prefix: /^D-C/,   activities: ["activity:rc_concrete"] },
  { prefix: /^D/,     activities: ["activity:steel_structure"] },
  { prefix: /^E-G/,   activities: ["activity:safety_education"], hazards: ["hazard:chemical_exposure"] },
  { prefix: /^E-M/,   activities: ["activity:vehicle_construction"] },
  { prefix: /^E-T/,   hazards: ["hazard:chemical_exposure"] },
  { prefix: /^E/,     hazards: ["hazard:chemical_exposure"], activities: ["activity:safety_education"] },
  { prefix: /^G/,     activities: ["activity:risk_assessment_general"] },
  { prefix: /^H/,     hazards: ["hazard:chemical_exposure"], activities: ["activity:safety_education"] },
  { prefix: /^M/,     activities: ["activity:vehicle_construction"], hazards: ["hazard:machine_entanglement"] },
  { prefix: /^O/,     activities: ["activity:risk_assessment_general"] },
  { prefix: /^P/,     hazards: ["hazard:chemical_exposure"] },
  { prefix: /^T/,     activities: ["activity:safety_education"] },
  { prefix: /^W/,     activities: ["activity:safety_education"], hazards: ["hazard:dust_exposure"] },
  { prefix: /^X/,     activities: ["activity:risk_assessment_general"] }
];

(async () => {
  // 1. 미사용 guide IRI 식별 (in-degree 0)
  const guideFiles = await readdir(GUIDES_DIR);
  const allGuides: Array<{ iri: string; guideNo: string; title: string }> = [];
  for (const f of guideFiles) {
    if (!f.endsWith(".jsonld")) continue;
    const node = JSON.parse(await readFile(resolve(GUIDES_DIR, f), "utf8"));
    allGuides.push({
      iri: node["@id"],
      guideNo: node._meta?.guideNo ?? "",
      title: node.title ?? ""
    });
  }

  // in-edges 계산
  const inEdgeIds = new Set<string>();
  const dirsToScan = [
    ACTIVITIES_DIR, HAZARDS_DIR,
    resolve(ROOT, "src/ontology/graph/nodes/documents"),
    resolve(ROOT, "src/ontology/graph/nodes/articles"),
    resolve(ROOT, "src/ontology/graph/nodes/controls")
  ];
  async function scan(dir: string) {
    for (const f of await readdir(dir)) {
      const p = resolve(dir, f);
      const { stat } = await import("node:fs/promises");
      const st = await stat(p);
      if (st.isDirectory()) { if (f === "guides") continue; await scan(p); continue; }
      if (!f.endsWith(".jsonld")) continue;
      const n = JSON.parse(await readFile(p, "utf8"));
      for (const prop of EDGE_PROPS) {
        const v = n[prop]; if (!v) continue;
        const arr = Array.isArray(v) ? v : [v];
        for (const t of arr) if (typeof t === "string" && t.startsWith("doc:kosha_guide")) inEdgeIds.add(t);
      }
    }
  }
  for (const d of dirsToScan) await scan(d);

  const unused = allGuides.filter(g => !inEdgeIds.has(g.iri));
  console.log(`[unused] ${unused.length} guides without in-edge`);

  // 2. 활동/위험 인덱스
  const actIdx = new Map<string, { path: string; node: Record<string, unknown> }>();
  for (const f of await readdir(ACTIVITIES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(ACTIVITIES_DIR, f);
    const node = JSON.parse(await readFile(p, "utf8"));
    if (node["@id"]) actIdx.set(node["@id"], { path: p, node });
  }
  const hazIdx = new Map<string, { path: string; node: Record<string, unknown> }>();
  for (const f of await readdir(HAZARDS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(HAZARDS_DIR, f);
    const node = JSON.parse(await readFile(p, "utf8"));
    if (node["@id"]) hazIdx.set(node["@id"], { path: p, node });
  }

  // 3. prefix-based mapping
  let activityLinks = 0, hazardLinks = 0, fallbackUsed = 0;
  for (const g of unused) {
    const map = PREFIX_MAP.find(m => m.prefix.test(g.guideNo));
    if (!map) continue;
    fallbackUsed++;

    for (const aid of map.activities ?? []) {
      const e = actIdx.get(aid);
      if (!e) continue;
      const arr = (e.node.guidedBy as string[] | undefined) ?? [];
      if (!arr.includes(g.iri)) {
        arr.push(g.iri); e.node.guidedBy = arr; activityLinks++;
      }
    }
    for (const hid of map.hazards ?? []) {
      const e = hazIdx.get(hid);
      if (!e) continue;
      const arr = (e.node.guidedBy as string[] | undefined) ?? [];
      if (!arr.includes(g.iri)) {
        arr.push(g.iri); e.node.guidedBy = arr; hazardLinks++;
      }
    }
  }

  for (const { path, node } of actIdx.values()) await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
  for (const { path, node } of hazIdx.values()) await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");

  console.log(`[fallback] prefix 매칭: ${fallbackUsed}`);
  console.log(`[link] activity guidedBy 신규: ${activityLinks}`);
  console.log(`[link] hazard   guidedBy 신규: ${hazardLinks}`);
})();
