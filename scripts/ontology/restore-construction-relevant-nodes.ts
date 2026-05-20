#!/usr/bin/env tsx
/**
 * restore-construction-relevant-nodes.ts
 *
 * 1차 라운드에서 과도하게 삭제된 건설안전 적용 노드 선별 복원.
 *
 * 복원 사유:
 *   - shear_bender (전단기·절곡기) — 산안법 §80 안전인증 13종 중 2호. 건설현장 철근 가공.
 *   - pressure_vessel (압력용기) — §80 13종 중 5호. 건설현장 LPG·산소봄베·공기탱크.
 *   - psychosocial_stress — 산안법 §51 직장내괴롭힘 + 자살예방. 건설근로자 자살률.
 *   - KOSHA B-E 시리즈 22개 — "건설현장의 전기설비 설치 및 관리" 등 가설전기 핵심.
 *   - KOSHA H 시리즈 141개 — 건설근로자 보건 (석면·소음·분진·도료·진동·비파괴) 다수.
 *   - KOSHA W 시리즈 19개 — 작업장 소음·한랭·MSDS 측정·평가.
 *   - KOSHA O 시리즈 2개 — 용접재료·볼트너트 체결 (건설 일반).
 *   - KOSHA M 시리즈 선별 ~25개 — 타워크레인·슬링·체인톱·아크용접·고소작업대 등.
 *
 * 영구 삭제 (건설 부적합):
 *   - KOSHA B-M 시리즈 39개 (산업기계)
 *   - KOSHA B-5/B-6 (조선업·부선)
 *   - KOSHA P 시리즈 101개 (PSM 화학공정)
 *   - KOSHA M 시리즈 나머지 ~70개 (제조업 기계 — CNC/사출/제분/제지 등)
 *   - equipment: press, injection_molding, roller
 *   - hazards: dust_explosion
 *   - documents/activities: chemical_facility, railway_*, quarry, customer_violence,
 *                          process_safety_management, epidemiological_*, hazardous_*-{industrial,machinery}
 */

import { execSync } from "node:child_process";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SRC_TAX = resolve(ROOT, "src", "ontology");

// ── 1) 도메인 노드 3개 복원 ───────────────────────────────────────────
const RESTORE_NODE_FILES = [
  "src/ontology/graph/nodes/equipment/shear_bender.jsonld",
  "src/ontology/graph/nodes/equipment/pressure_vessel.jsonld",
  "src/ontology/graph/nodes/hazards/psychosocial_stress.jsonld",
];

// ── 2) KOSHA M 시리즈 선별 복원 (건설 적용 25개) ──────────────────────
const M_SERIES_RESTORE = new Set<string>([
  "m-37-2012",  // 작업장내 기계 소음평가
  "m-39-2012",  // 작업장내 인간공학
  "m-48-2012",  // 안전운송을 위한 작업장
  "m-49-2023",  // 작업장내 안전한 적재 및 하역작업
  "m-5-2012",   // 작업장비 사용
  "m-51-2023",  // 작업장의 소음제어
  "m-52-2012",  // 체인톱의 사용 (powersaw)
  "m-60-2012",  // 작업장 미끄러짐
  "m-67-2012",  // 수동 금속 아크 용접 (ac_arc_welder)
  "m-70-2013",  // 그로맷·케이블레이드 슬링 (양중)
  "m-74-2011",  // 스테인리스강 아크 용접 흄
  "m-82-2011",  // 타워크레인의 설치·조립·해체작업
  "m-89-2016",  // 타워크레인 접근통로 및 방책
  "m-9-2023",   // 금속 가공용 수동 둥근톱
  "m-90-2011",  // 크레인 및 권상장치의 와이어로프 선정
  "m-91-2012",  // 타워크레인의 지지·고정 및 운전
  "m-92-2013",  // 이동식 승강 테이블
  "m-93-2011",  // 스태커
  "m-94-2011",  // 인조섬유 라운드슬링
  "m-98-2012",  // 드릴기 방호조치
  "m-123-2012", // 기계류의 위험성평가
  "m-137-2023", // 기계의 제작 구매 사용 시 안전기준
  "m-153-2012", // 가공목재 및 판재의 적재
  "m-155-2023", // 이동식 고소작업대의 선정과 안전관리
  "m-159-2012", // 수목작업에서의 굴삭기 안전작업
  "m-191-2017", // 안전제어시스템 평균위험고장시간
  "m-192-2017", // 기계안전 제어시스템 안전관련부품
]);

// ── 3) 통째 복원 prefix ──────────────────────────────────────────────
const RESTORE_FULL_PREFIXES: RegExp[] = [
  /^b-e-/i,  // 전기설비 22개
  /^h-/i,    // 보건관리 141개
  /^w-/i,    // 작업환경측정 19개
  /^o-/i,    // 일반 2개
];

function shouldRestoreGuide(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (RESTORE_FULL_PREFIXES.some((rx) => rx.test(lower))) return true;
  // M 시리즈 선별
  const stem = lower.replace(/\.jsonld$/, "");
  if (M_SERIES_RESTORE.has(stem)) return true;
  return false;
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function gitShow(filepath: string): Promise<string | null> {
  try {
    const out = execSync(`git show "HEAD:${filepath}"`, { cwd: ROOT, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
    return out;
  } catch {
    return null;
  }
}

async function getDeletedFiles(): Promise<string[]> {
  const out = execSync("git diff --diff-filter=D --name-only HEAD", { cwd: ROOT, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
  return out.split("\n").filter((l) => l.trim().length > 0);
}

async function main() {
  // 1) 도메인 노드 3개 복원
  let restoredNodes = 0;
  for (const rel of RESTORE_NODE_FILES) {
    const content = await gitShow(rel);
    if (!content) {
      console.warn(`[skip] git에서 가져올 수 없음: ${rel}`);
      continue;
    }
    const dest = resolve(ROOT, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf-8");
    restoredNodes += 1;
    console.log(`  + ${rel}`);
  }
  console.log(`[restore-nodes] ${restoredNodes} files`);

  // psychosocial_stress description 보강 (감정노동 §41 → §51 직장내괴롭힘 + 자살예방으로 확장)
  const psyPath = resolve(ROOT, "src/ontology/graph/nodes/hazards/psychosocial_stress.jsonld");
  if (await fileExists(psyPath)) {
    const psy = JSON.parse(await readFile(psyPath, "utf-8"));
    psy.label = "직무스트레스·정신건강 (직장내괴롭힘 포함)";
    psy.description =
      "**원인**: 직장 내 괴롭힘 / 과로·장시간 근로 / 중대재해 목격 후 외상 / 고객 폭언.\n" +
      "**상황**: 건설근로자 자살률 높음 / 야간·연속 근로 / 사망사고 다발 현장 / 고객 응대 직군.\n" +
      "**확인**: 산안법 §51 (직장 내 괴롭힘 예방) / §41 (고객 폭언 — 감정노동) / KOSHA H-37 (자살·우울증 예방) / H-204 (직장 따돌림).\n" +
      "**중대성**: 우울 / 자살 / PTSD / 만성 스트레스성 질환.";
    psy._meta = psy._meta ?? {};
    psy._meta.constructionApplicability =
      "건설업 적용 — 산안법 §51 직장내괴롭힘은 모든 사업장 (건설 포함). KOSHA H-36 중대재해 후 급성 스트레스 / H-37 자살·우울 / H-204 직장 따돌림 가이드는 건설업에 직접 적용.";
    psy._meta.updatedAt = new Date().toISOString().slice(0, 10);
    await writeFile(psyPath, JSON.stringify(psy, null, 2) + "\n", "utf-8");
    console.log("  ~ psychosocial_stress description 보강 (건설 §51 + 자살예방 + 직장내괴롭힘)");
  }

  // pressure_vessel description 보강 (건설현장 가스용기·LPG·산소봄베)
  const pvPath = resolve(ROOT, "src/ontology/graph/nodes/equipment/pressure_vessel.jsonld");
  if (await fileExists(pvPath)) {
    const pv = JSON.parse(await readFile(pvPath, "utf-8"));
    pv.description =
      "고압 가스·액체 저장 용기 (산안법 §80 안전인증 13종 중 5호). 건설현장 LPG·산소·아세틸렌 봄베 / 가스용접 기구 / 공기탱크 / 보일러 등이 해당. 폭발·누출 위험.";
    pv._meta = pv._meta ?? {};
    pv._meta.constructionApplicability =
      "건설업 적용 — 가스용접·용단·콘크리트 양생용 보일러·압축공기탱크 등 건설현장 사용. 안전인증 §80 + 정기 안전검사 §93 의무.";
    pv._meta.updatedAt = new Date().toISOString().slice(0, 10);
    await writeFile(pvPath, JSON.stringify(pv, null, 2) + "\n", "utf-8");
    console.log("  ~ pressure_vessel description 보강 (건설 LPG·산소봄베·공기탱크)");
  }

  // 2) KOSHA 가이드 복원
  const deleted = await getDeletedFiles();
  const guideDeleted = deleted.filter((p) => p.includes("/documents/guides/"));
  let restoredGuides = 0;
  for (const rel of guideDeleted) {
    const fname = rel.split("/").pop() ?? "";
    if (!shouldRestoreGuide(fname)) continue;
    const content = await gitShow(rel);
    if (!content) continue;
    const dest = resolve(ROOT, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf-8");
    restoredGuides += 1;
  }
  console.log(`[restore-guides] ${restoredGuides} KOSHA guide files restored`);

  // 3) scope.json out_of_domain 분류 수정
  const scopePath = resolve(SRC_TAX, "scope.json");
  const scope = JSON.parse(await readFile(scopePath, "utf-8"));
  if (scope.koshaGuide?.categoryMapping) {
    scope.koshaGuide.categoryMapping = {
      construction: ["C-*", "D-*", "C-C-*", "D-C-*"],
      general_applicable: [
        "A-*", "G-*", "X-*",
        "H-*",  // 보건관리 — 건설근로자 적용 (석면·소음·분진·도료·비파괴 등 다수)
        "W-*",  // 작업환경측정 — 건설현장 분진·소음 적용
        "B-E-*", // 전기설비 — 건설 가설전기 (건설현장 전기설비 가이드 포함)
        "O-*",  // 일반 (용접재료·볼트너트)
      ],
      construction_partial: [
        "E-G-*", "T-*",
        "M-*",  // 일부 (타워크레인·슬링·체인톱·아크용접·고소작업대 등)
      ],
      out_of_domain: [
        "B-M-*",  // 산업기계
        "B-5*", "B-6*",  // 조선업·부선
        "P-*",  // PSM 화학공정
      ],
    };
    scope.koshaGuide.comment =
      "C/D 시리즈는 건설 직접. A/G/X/H/W/B-E/O 시리즈는 일반 안전관리·보건·전기설비(건설 적용 가능). " +
      "M은 부분 적용 (양중·고소작업대 등 선별). B-M/B-5/B-6/P는 비건설 (산업기계·조선·PSM).";
    scope.updatedAt = new Date().toISOString().slice(0, 10);
    await writeFile(scopePath, JSON.stringify(scope, null, 2) + "\n", "utf-8");
    console.log("[scope] koshaGuide.categoryMapping 재분류");
  }

  console.log("\n[done] 건설안전 적용 노드 선별 복원 완료.");
  console.log("       run `npm run build && npm run verify-graph` to validate.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
