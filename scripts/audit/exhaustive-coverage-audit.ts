#!/usr/bin/env tsx
/**
 * 전수 커버리지 audit — 매핑 누락 + 노드 종류별 결합도
 *
 * 검증 항목:
 *   1. 의무문서 66종 — 모든 필드가 inputGuide+standardFormat+examples+checkPoints 4종 세트?
 *   2. KOSHA Guide 1,039 — 활동·위험·장비와 매핑된 비율
 *   3. 사고 패턴 79 — 의무문서 사고보고와 연결?
 *   4. 활동 27 — 의무문서·KOSHA·hazard·control 모두 보유?
 *   5. 위험 32 — mitigatedBy + KOSHA Guide + activity?
 *   6. 통제 45 — 어떤 hazard 매핑 / 어떤 doc 매핑?
 *   7. 사고유형(event) 24 — pattern 매핑?
 *   8. 법령 1,298 — legalBasisOf 보유 비율
 *   9. 별표 227 — partOf + cross-reference 보유?
 *  10. 처벌 9 — 위반 의무문서 매핑?
 *  11. KRAS method 13 — 위험성평가 doc과 매핑?
 *  12. 외국어·PPE·소방 — 본 OSS 도메인 경계 내 처리?
 *  13. 활동/위험 vs 24 사고유형 (event) 완전 매트릭스 누락 cell
 *  14. 분야별 KOSHA Guide 매핑 비율
 *  15. SHACL shape 커버 노드 타입 (참고)
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "src/ontology/graph");
const NODES = resolve(ROOT, "nodes");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const f of await readdir(dir)) {
    const p = resolve(dir, f);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}

interface Node { path: string; iri: string; type: string | string[] | undefined; raw: any; refs: Map<string, string[]>; }

function isType(n: Node, t: string): boolean {
  return Array.isArray(n.type) ? n.type.includes(t) : n.type === t;
}

function refSetOf(n: Node, key: string): string[] {
  const v = n.raw[key];
  if (Array.isArray(v)) return v.filter(x => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

async function loadAll() {
  const paths = await walk(NODES);
  const nodes = new Map<string, Node>();
  for (const p of paths) {
    try {
      const n = JSON.parse(await readFile(p, "utf-8"));
      if (!n["@id"]) continue;
      const refs = new Map<string, string[]>();
      nodes.set(n["@id"], { path: p, iri: n["@id"], type: n["@type"], raw: n, refs });
    } catch {}
  }
  // 인덱스 — 누가 누구를 참조하는가 (역방향)
  const reverseIndex = new Map<string, Set<string>>();
  for (const [iri, info] of nodes) {
    for (const [, v] of Object.entries(info.raw)) {
      const targets = (Array.isArray(v) ? v : [v]).filter((x: any) => typeof x === "string" && nodes.has(x as string));
      for (const t of targets) {
        if (!reverseIndex.has(t as string)) reverseIndex.set(t as string, new Set());
        reverseIndex.get(t as string)!.add(iri);
      }
    }
  }
  return { nodes, reverseIndex };
}

async function main() {
  const { nodes, reverseIndex } = await loadAll();
  const findings: any[] = [];
  const stats: Record<string, any> = {};

  // ─── 1. 의무문서 필드 4종 세트 ───
  const docs = [...nodes.values()].filter(n => isType(n, "Document") && !n.iri.startsWith("doc:kosha_guide"));
  let totalFields = 0, fullSetCount = 0;
  const partial: string[] = [];
  for (const d of docs) {
    for (const sec of (d.raw.sections ?? [])) {
      for (const fld of (sec.fields ?? [])) {
        totalFields++;
        const has4 = !!fld.inputGuide && !!fld.standardFormat && !!fld.examples?.length && !!fld.checkPoints?.length;
        if (has4) fullSetCount++;
        else if (partial.length < 5) partial.push(`${d.iri}/${fld.key}: missing ${[
          !fld.inputGuide && "inputGuide",
          !fld.standardFormat && "standardFormat",
          !fld.examples?.length && "examples",
          !fld.checkPoints?.length && "checkPoints",
        ].filter(Boolean).join(",")}`);
      }
    }
  }
  stats["의무문서 4종 세트"] = `${fullSetCount}/${totalFields} (${(fullSetCount/totalFields*100).toFixed(1)}%)`;
  if (fullSetCount < totalFields) findings.push({ severity: "MEDIUM", area: "의무문서 4종 세트", message: `${totalFields-fullSetCount}건 미완`, sample: partial });

  // ─── 2. KOSHA Guide 1039 → 활동/위험/장비 매핑 비율 ───
  const koshaGuides = [...nodes.values()].filter(n => n.iri.startsWith("doc:kosha_guide"));
  let mapped = 0;
  for (const g of koshaGuides) {
    const r = g.raw;
    if ((r.appliesToActivities?.length ?? 0) > 0 || (r.causedBy?.length ?? 0) > 0 || (r.involves?.length ?? 0) > 0 || (r.guidedBy?.length ?? 0) > 0) mapped++;
  }
  const koshaMappedRate = mapped / koshaGuides.length;
  stats["KOSHA Guide 활동/위험/장비 매핑"] = `${mapped}/${koshaGuides.length} (${(koshaMappedRate*100).toFixed(1)}%)`;
  if (koshaMappedRate < 0.30) findings.push({ severity: "HIGH", area: "KOSHA Guide 매핑", message: `${koshaGuides.length-mapped}건 활동/위험 미매핑` });
  else if (koshaMappedRate < 0.70) findings.push({ severity: "MEDIUM", area: "KOSHA Guide 매핑", message: `${koshaGuides.length-mapped}건 매핑 미흡 (≥70% 권장)` });

  // ─── 3. 사고 패턴 → 사고문서 연결 ───
  const patterns = [...nodes.values()].filter(n => n.iri.startsWith("event:pattern/"));
  const accidentDocs = ["doc:ad_hoc/severe_accident_immediate_report", "doc:ad_hoc/industrial_accident_report", "doc:ad_hoc/severe_accident_compliance"];
  // 사고문서가 패턴들을 참조하는가?
  let accidentRefPatterns = 0;
  for (const adIri of accidentDocs) {
    const ad = nodes.get(adIri);
    if (!ad) continue;
    const refs = [...Object.values(ad.raw)].flat().filter(x => typeof x === "string");
    for (const r of refs) if ((r as string).startsWith("event:pattern/")) accidentRefPatterns++;
  }
  stats["사고문서 → 패턴 참조"] = `${accidentRefPatterns}건 (패턴 ${patterns.length}개 중)`;
  if (accidentRefPatterns === 0) findings.push({ severity: "HIGH", area: "패턴 ↔ 사고문서", message: `사고문서가 ${patterns.length}개 패턴 중 0건 참조 — informedBy 누락` });

  // ─── 4. 활동 → 의무문서/KOSHA/hazard/control 보유 ───
  const activities = [...nodes.values()].filter(n => isType(n, "Activity"));
  const activityIncomplete: string[] = [];
  for (const a of activities) {
    const r = a.raw;
    const hasDocs = (reverseIndex.get(a.iri) ?? new Set()).size > 0; // 역참조 doc/kosha
    const hasFacets = (r.koshaArchiveFacets?.length ?? 0) > 0;
    const missing: string[] = [];
    if (!hasDocs) missing.push("docs");
    if (!hasFacets) missing.push("facets");
    if (missing.length > 0 && activityIncomplete.length < 10) activityIncomplete.push(`${a.iri} (${missing.join(",")})`);
  }
  stats["활동 매핑 누락"] = `${activityIncomplete.length}/${activities.length}`;
  if (activityIncomplete.length > 0) findings.push({ severity: "MEDIUM", area: "활동 매핑", message: `${activityIncomplete.length}/${activities.length} 활동 매핑 누락`, sample: activityIncomplete });

  // ─── 5. 위험 → mitigatedBy / facet ───
  const hazards = [...nodes.values()].filter(n => isType(n, "Hazard"));
  const hazardIncomplete: string[] = [];
  for (const h of hazards) {
    const r = h.raw;
    const hasMit = (r.mitigatedBy?.length ?? 0) > 0;
    const hasFacet = (r.koshaArchiveFacets?.length ?? 0) > 0;
    if (!hasMit || !hasFacet) {
      const missing = [!hasMit && "mitigatedBy", !hasFacet && "facet"].filter(Boolean).join(",");
      if (hazardIncomplete.length < 10) hazardIncomplete.push(`${h.iri} (${missing})`);
    }
  }
  stats["위험 mitigatedBy/facet 누락"] = `${hazardIncomplete.length}/${hazards.length}`;
  if (hazardIncomplete.length > 0) findings.push({ severity: "MEDIUM", area: "위험 매핑", message: `${hazardIncomplete.length}/${hazards.length} 위험 mitigatedBy 또는 facet 누락`, sample: hazardIncomplete });

  // ─── 6. 사고유형(event) → pattern 매핑 ───
  const events = [...nodes.values()].filter(n => isType(n, "Event") && !n.iri.startsWith("event:pattern/"));
  const eventNoPattern: string[] = [];
  for (const e of events) {
    const slug = e.iri.replace(/^event:/, "");
    const hasPattern = patterns.some(p => p.iri.startsWith(`event:pattern/${slug}_`) || p.raw.koshaAccidentType === slug);
    if (!hasPattern) eventNoPattern.push(e.iri);
  }
  stats["사고유형(event) → pattern 매핑"] = `${events.length - eventNoPattern.length}/${events.length}`;
  if (eventNoPattern.length > 0) findings.push({ severity: "LOW", area: "event → pattern 매핑", message: `${eventNoPattern.length}/${events.length} event 패턴 0건`, sample: eventNoPattern });

  // ─── 7. 법령 article → legalBasisOf 보유 ───
  const articles = [...nodes.values()].filter(n => isType(n, "Article"));
  let articlesWithLBO = 0;
  for (const a of articles) {
    if ((a.raw.legalBasisOf?.length ?? 0) > 0) articlesWithLBO++;
  }
  const lboRate = articlesWithLBO / articles.length;
  stats["법령 article legalBasisOf 보유"] = `${articlesWithLBO}/${articles.length} (${(lboRate*100).toFixed(1)}%)`;
  // 1298건 중 의무문서 66종이 인용한 것만 — 비율 낮음이 정상

  // ─── 8. 별표 → cross-reference ───
  const annexes = [...nodes.values()].filter(n => isType(n, "Annex"));
  let annexLinked = 0;
  for (const a of annexes) {
    const incomingCount = (reverseIndex.get(a.iri) ?? new Set()).size;
    if (incomingCount > 1) annexLinked++; // partOf 외 1개 이상 참조
  }
  stats["별표 cross-reference"] = `${annexLinked}/${annexes.length} (${(annexLinked/annexes.length*100).toFixed(1)}%)`;

  // ─── 9. 처벌 → 위반 의무문서 매핑 ───
  const penalties = [...nodes.values()].filter(n => isType(n, "Penalty"));
  let penaltyMapped = 0;
  for (const p of penalties) {
    const r = p.raw;
    if ((r.references?.length ?? 0) > 0 || (r.legalBasis?.length ?? 0) > 0 || (reverseIndex.get(p.iri)?.size ?? 0) > 0) penaltyMapped++;
  }
  stats["처벌 매핑"] = `${penaltyMapped}/${penalties.length}`;
  if (penaltyMapped < penalties.length) findings.push({ severity: "MEDIUM", area: "처벌 매핑", message: `${penalties.length-penaltyMapped}건 처벌 ↔ 의무 미매핑` });

  // ─── 10. KRAS method → 위험성평가 doc 매핑 ───
  const methods = [...nodes.values()].filter(n => isType(n, "Method"));
  let methodMapped = 0;
  for (const m of methods) {
    const incoming = reverseIndex.get(m.iri) ?? new Set();
    if ([...incoming].some(i => i.includes("risk_assessment"))) methodMapped++;
  }
  stats["KRAS method → 위험성평가 doc"] = `${methodMapped}/${methods.length}`;
  if (methodMapped < methods.length * 0.7) findings.push({ severity: "MEDIUM", area: "method 매핑", message: `${methods.length-methodMapped}/${methods.length} method 가 위험성평가 doc 에서 참조 안 됨` });

  // ─── 11. 24 사고유형 × 27 활동 매트릭스 — 패턴 cell 분포 ───
  const matrix = new Map<string, number>();
  for (const p of patterns) {
    const slug = p.iri.replace(/^event:pattern\//, "");
    const [event, activity] = slug.split("_event_").length === 2 ? slug.split("_event_") : [p.raw.koshaAccidentType ?? "?", "general"];
    const key = `${event}|${activity}`;
    matrix.set(key, (matrix.get(key) ?? 0) + 1);
  }
  const eventNames = ["fall_from_height","fall_object","struck_by","caught_in","cave_in","electric_shock","fire_explosion","asphyxiation","drowning","chemical_contact","thermal_burn","cut_pierce","overturn_collapse","traffic_accident","trip_slip","dust_explosion"];
  const activityNames = ["excavation_2m_plus","tower_crane","scaffolding_assembly","formwork_shoring","rc_concrete","demolition","tunnel_excavation","bridge_5m_30m","phc_pile_driving","steel_structure"];
  let coveredCells = 0;
  for (const e of eventNames) for (const a of activityNames) if (patterns.some(p => p.raw.koshaAccidentType === e && (p.raw.causedBy ?? []).includes(`activity:${a}`))) coveredCells++;
  const totalCells = eventNames.length * activityNames.length;
  stats["사고유형×활동 매트릭스"] = `${coveredCells}/${totalCells} (${(coveredCells/totalCells*100).toFixed(1)}%)`;

  // ─── 12. 분야별 KOSHA Guide 매핑 ───
  const koshaByCategory: Record<string, { total: number; mapped: number }> = {};
  for (const g of koshaGuides) {
    const cat = g.raw._meta?.guideCategory ?? "?";
    if (!koshaByCategory[cat]) koshaByCategory[cat] = { total: 0, mapped: 0 };
    koshaByCategory[cat].total++;
    const r = g.raw;
    if ((r.appliesToActivities?.length ?? 0) > 0 || (r.causedBy?.length ?? 0) > 0 || (r.involves?.length ?? 0) > 0) {
      koshaByCategory[cat].mapped++;
    }
  }
  stats["분야별 KOSHA Guide 매핑"] = Object.entries(koshaByCategory).map(([k, v]) => `${k}:${v.mapped}/${v.total}`).join(", ");

  // ─── 13. 모든 노드 타입 분포 ───
  const typeDist: Record<string, number> = {};
  for (const n of nodes.values()) {
    const types = Array.isArray(n.type) ? n.type : [n.type ?? "?"];
    for (const t of types) typeDist[t as string] = (typeDist[t as string] ?? 0) + 1;
  }
  stats["타입 분포"] = Object.entries(typeDist).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(", ");

  // ─── 출력 ───
  console.log("=".repeat(72));
  console.log("전수 커버리지 audit");
  console.log("=".repeat(72));
  console.log(`총 노드: ${nodes.size}\n`);

  console.log("[통계]");
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
  console.log("");

  const HIGH = findings.filter(f => f.severity === "HIGH");
  const MEDIUM = findings.filter(f => f.severity === "MEDIUM");
  const LOW = findings.filter(f => f.severity === "LOW");

  console.log(`[갭] HIGH ${HIGH.length} / MEDIUM ${MEDIUM.length} / LOW ${LOW.length}\n`);
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.area}`);
    console.log(`    ${f.message}`);
    if (f.sample) for (const s of f.sample.slice(0, 5)) console.log(`      · ${s}`);
    console.log("");
  }

  await writeFile(resolve(__dirname, "..", "..", "artifacts", "audit", "exhaustive-coverage.json"), JSON.stringify({ stats, findings }, null, 2), "utf-8");
}

main().catch((e) => { console.error(e); process.exit(1); });
