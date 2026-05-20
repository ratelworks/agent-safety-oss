/**
 * coverage-report.ts
 *
 * 그래프 커버리지 종합 분석:
 *   1. 법령 조문 분포 (Article)
 *   2. 별표·별지 분포 (Annex)
 *   3. 위험요인 카테고리 (Hazard)
 *   4. 통제수단 ERIC 분포 (Control)
 *   5. 법정문서 빈도·카테고리 매트릭스 (Document)
 *   6. 양방향 도달성 (Document ↔ Article ↔ Annex / Hazard ↔ Control)
 *   7. 고립 노드 (orphan) 분석
 *   8. 사용 빈도 vs 그래프 점수 산점
 *
 * 사용: npx tsx scripts/audit/coverage-report.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "../../src/ontology/graph/nodes");
const MASTER_PATH = resolve(__dirname, "../../src/ontology/legal-duty-master.json");

function walkDir(dir: string): string[] {
  const out: string[] = [];
  if (!exists(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walkDir(p));
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}
function exists(p: string): boolean {
  try { statSync(p); return true; } catch { return false; }
}

function loadAll(subdir: string): any[] {
  const out: any[] = [];
  for (const p of walkDir(join(NODES_DIR, subdir))) {
    try { out.push(JSON.parse(readFileSync(p, "utf8"))); } catch {}
  }
  return out;
}

function bar(n: number, max: number, width = 30): string {
  if (max === 0) return "";
  const filled = Math.round((n / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function header(title: string): void {
  console.log("\n" + "=".repeat(78));
  console.log(`  ${title}`);
  console.log("=".repeat(78));
}

function main(): void {
  console.log("# Agent Safety OSS — 그래프 커버리지 종합 분석\n");

  const articles = loadAll("articles");
  const annexes = loadAll("annexes");
  const hazards = loadAll("hazards");
  const controls = loadAll("controls");
  const documents = loadAll("documents").filter(
    (d) => !d["@id"]?.startsWith("doc:kosha_guide/") && !d._meta?.sourceApi?.toString().includes("KOSHA Guide"),
  );
  const cycles = loadAll("cycles");
  const masters = JSON.parse(readFileSync(MASTER_PATH, "utf8")).documents as any[];

  // ============================================================
  // 1. 법령 조문 분포 (Article)
  // ============================================================
  header("1. 법령 조문 (Article) 커버리지");
  console.log(`  전체 Article 노드: ${articles.length}개`);
  const articleByLaw = new Map<string, number>();
  for (const a of articles) {
    const law = a.legislationIdentifier ?? "(unknown)";
    articleByLaw.set(law, (articleByLaw.get(law) ?? 0) + 1);
  }
  console.log("  법령별 조문 수:");
  for (const [law, n] of [...articleByLaw.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${bar(n, articles.length, 20)} ${law}: ${n}조`);
  }
  // Article 의 verificationStatus
  const artStatus = new Map<string, number>();
  for (const a of articles) artStatus.set(a.verificationStatus ?? "(없음)", (artStatus.get(a.verificationStatus ?? "(없음)") ?? 0) + 1);
  console.log("\n  검증 상태:");
  for (const [s, n] of artStatus) console.log(`    ${s}: ${n}`);

  // ============================================================
  // 2. 별표·별지 (Annex) 커버리지
  // ============================================================
  header("2. 별표·별지 (Annex) 커버리지");
  console.log(`  전체 Annex 노드: ${annexes.length}개`);
  const annexByKind = new Map<string, number>();
  const annexByLaw = new Map<string, number>();
  for (const a of annexes) {
    annexByKind.set(a.annexKind ?? "(없음)", (annexByKind.get(a.annexKind ?? "(없음)") ?? 0) + 1);
    const law = String(a.partOf ?? "").split(":")[1] ?? "(unknown)";
    annexByLaw.set(law, (annexByLaw.get(law) ?? 0) + 1);
  }
  console.log("  종류별:");
  for (const [k, n] of annexByKind) console.log(`    ${bar(n, annexes.length, 20)} ${k}: ${n}`);
  console.log("\n  소속 법령별:");
  for (const [law, n] of [...annexByLaw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
    console.log(`    ${bar(n, annexes.length, 20)} ${law}: ${n}`);

  // 별지 1~99호 커버 여부 (산안법 시행규칙)
  const knownAnnexNumbers = new Set<string>();
  for (const a of annexes) {
    if (String(a["@id"] ?? "").includes("산안법시행규칙")) {
      const num = String(a.annexNumber ?? "").trim();
      if (num) knownAnnexNumbers.add(num);
    }
  }
  console.log(`\n  산안법시행규칙 별지/서식 커버: ${knownAnnexNumbers.size}건`);
  console.log(`    수록 번호: ${[...knownAnnexNumbers].sort((a, b) => Number(a) - Number(b)).slice(0, 30).join(", ")}${knownAnnexNumbers.size > 30 ? "..." : ""}`);

  // ============================================================
  // 3. Hazard 카테고리
  // ============================================================
  header("3. 위험요인 (Hazard) 커버리지");
  console.log(`  전체 Hazard 노드: ${hazards.length}개`);
  const hzByCat = new Map<string, number>();
  for (const h of hazards) hzByCat.set(h.category ?? "(없음)", (hzByCat.get(h.category ?? "(없음)") ?? 0) + 1);
  console.log("  카테고리별:");
  for (const [c, n] of hzByCat) console.log(`    ${bar(n, hazards.length, 20)} ${c}: ${n}`);

  // KOSHA 7대 사고 매칭 (사망사고 7유형)
  const kosha7 = ["fall_from_height", "struck_by", "caught_in", "electrocution", "fire_explosion", "asphyxiation", "crushing"];
  const hzIds = new Set(hazards.map((h) => h["@id"]));
  console.log("\n  KOSHA 7대 사망사고 분류 매칭:");
  for (const k of kosha7) {
    const has = hzIds.has(`hazard:${k}`);
    console.log(`    ${has ? "✅" : "❌"} hazard:${k}`);
  }

  // 통제수단 미보유 hazard
  const hzWithoutControl = hazards.filter((h) => !Array.isArray(h.mitigatedBy) || h.mitigatedBy.length === 0);
  console.log(`\n  통제수단 매핑 없는 hazard: ${hzWithoutControl.length}건`);
  if (hzWithoutControl.length > 0)
    console.log(`    ${hzWithoutControl.slice(0, 5).map((h) => h["@id"]).join(", ")}${hzWithoutControl.length > 5 ? "..." : ""}`);

  // ============================================================
  // 4. Control ERIC 분포
  // ============================================================
  header("4. 통제수단 (Control) ERIC 커버리지");
  console.log(`  전체 Control 노드: ${controls.length}개`);
  const ctByEric = new Map<string, number>();
  for (const c of controls) {
    const eric = c.ericLevel ?? c.controlLevel ?? "(없음)";
    ctByEric.set(eric, (ctByEric.get(eric) ?? 0) + 1);
  }
  console.log("  ERIC 단계별:");
  for (const e of ["Elimination", "Substitution", "Engineering", "Administrative", "PPE"]) {
    const n = ctByEric.get(e) ?? 0;
    console.log(`    ${bar(n, controls.length, 20)} ${e}: ${n}`);
  }
  // 매핑 안 된 ericLevel (5단계 외)
  const otherEric = [...ctByEric.entries()].filter(([k]) => !["Elimination", "Substitution", "Engineering", "Administrative", "PPE"].includes(k));
  if (otherEric.length > 0) {
    console.log("\n  ⚠️ 5단계 외 분류:");
    for (const [k, n] of otherEric) console.log(`    ${k}: ${n}`);
  }

  // ============================================================
  // 5. Document 빈도·카테고리 매트릭스
  // ============================================================
  header("5. 법정문서 (Document) 빈도·카테고리 매트릭스");
  console.log(`  전체 Document 노드: ${documents.length}개 (KOSHA Guide 카탈로그 제외)`);
  console.log(`  마스터 SSoT 법정의무: ${masters.length}종`);
  const masterIds = new Set(masters.map((m) => m.docId));
  const docIds = new Set(documents.map((d) => d.docId));

  // 마스터에 있는데 노드에 없는
  const masterOnlyIds = [...masterIds].filter((id) => !docIds.has(id));
  const docOnlyIds = [...docIds].filter((id) => !masterIds.has(id));
  console.log(`  마스터 ↔ 노드 정합:`);
  console.log(`    양쪽 모두: ${[...masterIds].filter((id) => docIds.has(id)).length}`);
  console.log(`    마스터만 (노드 없음): ${masterOnlyIds.length}${masterOnlyIds.length ? " — " + masterOnlyIds.slice(0, 3).join(", ") : ""}`);
  console.log(`    노드만 (마스터 없음): ${docOnlyIds.length}${docOnlyIds.length ? " — " + docOnlyIds.slice(0, 3).join(", ") : ""}`);

  // ============================================================
  // 6. 양방향 도달성
  // ============================================================
  header("6. 양방향 참조 도달성");
  // Document → Article 참조 수집
  const docToArticles = new Map<string, string[]>();
  const articleToDocs = new Map<string, string[]>();
  for (const d of documents) {
    const refs = (Array.isArray(d.legalBasis) ? d.legalBasis : []) as string[];
    docToArticles.set(d["@id"], refs);
    for (const r of refs) {
      const arr = articleToDocs.get(r) ?? [];
      arr.push(d["@id"]);
      articleToDocs.set(r, arr);
    }
  }
  // 가장 많이 참조된 Article (top 10)
  const topArticles = [...articleToDocs.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  console.log("  가장 많이 참조된 Article (top 10):");
  for (const [art, docs] of topArticles) {
    console.log(`    ${docs.length}건 ← ${art}`);
  }
  console.log(`  Article 노드 ${articles.length} 중 한 번이라도 참조된 것: ${articleToDocs.size}`);
  console.log(`  → 미참조 Article: ${articles.length - articleToDocs.size}건 (그래프 활용도 낮음)`);

  // Hazard → Control 도달성
  const hzReachControl = new Map<string, Set<string>>();
  for (const h of hazards) {
    const set = new Set<string>();
    const direct = Array.isArray(h.mitigatedBy) ? h.mitigatedBy : [];
    for (const c of direct) set.add(c);
    hzReachControl.set(h["@id"], set);
  }
  const totalHzCtPairs = [...hzReachControl.values()].reduce((s, x) => s + x.size, 0);
  console.log(`\n  Hazard → Control 직접 매핑 총수: ${totalHzCtPairs}`);
  console.log(`  Hazard 평균 도달 Control 수: ${(totalHzCtPairs / hazards.length).toFixed(1)}`);

  // Control → Hazard 역참조 (어떤 control이 어떤 hazard에서 호출되나)
  const ctReverseHz = new Map<string, Set<string>>();
  for (const [hz, cts] of hzReachControl) {
    for (const c of cts) {
      const set = ctReverseHz.get(c) ?? new Set();
      set.add(hz);
      ctReverseHz.set(c, set);
    }
  }
  const ctsUnused = controls.filter((c) => !ctReverseHz.has(c["@id"]) || ctReverseHz.get(c["@id"])!.size === 0);
  console.log(`  hazard에서 사용 안 된 Control: ${ctsUnused.length}/${controls.length}`);
  if (ctsUnused.length > 0)
    console.log(`    ${ctsUnused.slice(0, 5).map((c) => c["@id"]).join(", ")}${ctsUnused.length > 5 ? "..." : ""}`);

  // ============================================================
  // 7. 고립 노드 (orphan)
  // ============================================================
  header("7. 고립 노드 (orphan) 분석");
  // 모든 IRI 수집
  const allRefs = new Map<string, number>(); // IRI → 참조 횟수
  const allNodes = [...articles, ...annexes, ...hazards, ...controls, ...documents, ...cycles];
  // 모든 노드의 모든 IRI 참조 카운트
  function walkRefs(value: unknown, into: (iri: string) => void): void {
    if (typeof value === "string") {
      if (value.includes(":") && !value.startsWith("http") && !value.startsWith("./")) into(value);
    } else if (Array.isArray(value)) {
      for (const x of value) walkRefs(x, into);
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) walkRefs(v, into);
    }
  }
  for (const node of allNodes) {
    const myId = node["@id"];
    for (const [k, v] of Object.entries(node)) {
      if (k === "@id") continue;
      walkRefs(v, (iri) => {
        if (iri === myId) return;
        allRefs.set(iri, (allRefs.get(iri) ?? 0) + 1);
      });
    }
  }
  const allIds = new Set(allNodes.map((n) => n["@id"]));
  const orphans = [...allIds].filter((id) => !allRefs.has(id));
  console.log(`  전체 노드 ${allNodes.length} 중 어디에서도 참조 안 된 (orphan): ${orphans.length}`);
  // 카테고리별 orphan
  const orphanByPrefix = new Map<string, number>();
  for (const o of orphans) {
    const prefix = o.split(":")[0];
    orphanByPrefix.set(prefix, (orphanByPrefix.get(prefix) ?? 0) + 1);
  }
  console.log("  prefix별 orphan:");
  for (const [p, n] of [...orphanByPrefix.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${p}: ${n}`);
  }

  // ============================================================
  // 8. 사용 빈도 vs 그래프 점수
  // ============================================================
  header("8. 빈도 vs 그래프 완전체 점수 매트릭스");
  function score(d: any): number {
    let s = 0;
    if (d.legalBasis || d.legalBasisExternal) s++;
    if (d.hasHazard) s++;
    if (d.mitigatedBy) s++;
    if (d.annexReference) s++;
    if (d.guidedBy) s++;
    if (d.relatedDocs) s++;
    if (d.iso45001Class) s++;
    return s;
  }
  const docMap = new Map(documents.map((d) => [d.docId, d]));
  const FREQ_GROUPS: [string, RegExp][] = [
    ["🔴 매일", /매일/],
    ["🟠 작업단위", /작업단위/],
    ["🟠 매주", /매주/],
    ["🟡 매월", /월|반기|분기/],
    ["🟢 연·현장개설", /^연$|개설|착공|설계|발주/],
    ["⚪ 트리거형", /수시|선임|채용|변경|특수|사고|기계|진단|타설|해체|조립|지정|주기/],
  ];
  console.log("  빈도 그룹별 평균 점수:");
  for (const [label, re] of FREQ_GROUPS) {
    const items = masters.filter((m) => re.test(m.frequency));
    if (items.length === 0) continue;
    const scores = items.map((m) => {
      const node = docMap.get(m.docId);
      return node ? score(node) : 0;
    });
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    console.log(`    ${label.padEnd(15)} n=${items.length.toString().padStart(3)} 평균=${avg.toFixed(2)}/7 최저=${min} 최고=${max} ${bar(Math.round(avg * 10), 70, 14)}`);
  }
  const allScores = documents.map((d) => score(d));
  const overallAvg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  console.log(`\n  전체 평균: ${overallAvg.toFixed(2)}/7`);

  // ============================================================
  // 종합 요약
  // ============================================================
  header("📊 종합 커버리지 요약");
  console.log(`  법령 조문 (Article):    ${articles.length} 노드 / ${articleByLaw.size}개 법령`);
  console.log(`  별표·별지 (Annex):      ${annexes.length} 노드 / ${annexByKind.size}종류`);
  console.log(`  위험요인 (Hazard):      ${hazards.length} 노드 / ${hzByCat.size}카테고리`);
  console.log(`  통제수단 (Control):     ${controls.length} 노드 / ${ctByEric.size}분류`);
  console.log(`  법정문서 (Document):    ${documents.length} 노드 (마스터 ${masters.length}종 매핑)`);
  console.log(`  Article 활용도:         ${articleToDocs.size}/${articles.length} (${((articleToDocs.size / articles.length) * 100).toFixed(1)}%)`);
  console.log(`  Control 활용도:         ${controls.length - ctsUnused.length}/${controls.length} (${(((controls.length - ctsUnused.length) / controls.length) * 100).toFixed(1)}%)`);
  console.log(`  고립 노드 비율:         ${orphans.length}/${allNodes.length} (${((orphans.length / allNodes.length) * 100).toFixed(1)}%)`);
  console.log(`  법정문서 평균 점수:     ${overallAvg.toFixed(2)}/7`);
}

main();
