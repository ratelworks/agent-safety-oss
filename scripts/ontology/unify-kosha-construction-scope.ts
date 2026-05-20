#!/usr/bin/env tsx
/**
 * unify-kosha-construction-scope.ts
 *
 * "관련 있는걸 모두 받아서 모두 온톨로지화" 정책 적용:
 *   1. 보유 모든 KOSHA 가이드를 건설안전 관련 자료로 인정 (out_of_domain 표기 제거)
 *   2. _meta.scope를 prefix 기반 재분류 (scope.json categoryMapping과 일관)
 *   3. _meta.scopeNote 정리 (도메인 외 메모 제거)
 *   4. F-2 (목재가공시설) 영구 삭제 — 명백히 비건설 (목재가공업)
 *   5. scope.json updatedAt 갱신
 *
 * 실행 후: refine-kosha-mapping.ts 재실행으로 키워드 매칭 edge 자동 생성.
 */

import { readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");
const SCOPE_PATH = resolve(ROOT, "src", "ontology", "scope.json");

// prefix → scope 재분류 (보유 가이드 모두 건설 도메인으로 인정)
function classifyScope(guideNo: string): "construction" | "general_applicable" | "construction_partial" {
  // C-C, D-C: 건설 화학공정
  if (/^C-C/i.test(guideNo) || /^D-C/i.test(guideNo)) return "construction";
  // C, D: 명백 건설
  if (/^[CD]-/i.test(guideNo)) return "construction";
  // E-G: 일반 보건
  if (/^E-G/i.test(guideNo)) return "construction_partial";
  // E-T: 화학시험 (보유 9개 — 보건 적용 가능)
  if (/^E-T/i.test(guideNo)) return "construction_partial";
  // E-M: 화학 관련 (보유 8개)
  if (/^E-M/i.test(guideNo)) return "construction_partial";
  // E-H: 화학 관련 (보유 4개)
  if (/^E-H/i.test(guideNo)) return "construction_partial";
  // E (E-G/T/M/H 외): 전기설비 73개 — 건설 가설전기 적용
  if (/^E-/i.test(guideNo)) return "general_applicable";
  // T: 교육·훈련
  if (/^T-/i.test(guideNo)) return "construction_partial";
  // M: 기계 (선별 27개) — 양중·고소·체인톱 등
  if (/^M-/i.test(guideNo)) return "construction_partial";
  // H: 보건 — 건설근로자 보건 직접 적용
  if (/^H-/i.test(guideNo)) return "general_applicable";
  // W: 작업환경측정 — 건설 분진·소음 적용
  if (/^W-/i.test(guideNo)) return "general_applicable";
  // B-E: 전기설비 — 건설 가설전기
  if (/^B-E/i.test(guideNo)) return "general_applicable";
  // A: 안전·보건경영
  if (/^A-/i.test(guideNo)) return "general_applicable";
  // G: 안전관리 일반
  if (/^G-/i.test(guideNo)) return "general_applicable";
  // X: 위험성평가
  if (/^X-/i.test(guideNo)) return "general_applicable";
  // O: 일반 (용접재료·볼트너트)
  if (/^O-/i.test(guideNo)) return "general_applicable";
  // F: 화재예방 (보유 — 폴리우레탄폼 보존)
  if (/^F-/i.test(guideNo)) return "general_applicable";
  // K: 유해화학물질 저장·운반
  if (/^K-/i.test(guideNo)) return "general_applicable";
  return "general_applicable";
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  // 1) F-2 (목재가공시설 화재 폭발 예방기준) 영구 삭제
  for (const base of [GUIDES_DIR, resolve(ROOT, "build", "ontology", "graph", "nodes", "documents", "guides")]) {
    const f2 = resolve(base, "f-2-2011.jsonld");
    if (await fileExists(f2)) {
      await unlink(f2);
      console.log(`  rm ${f2.replace(ROOT + "/", "")}`);
    }
  }

  // 2) 모든 가이드 _meta.scope 재분류 + scopeNote 정리
  const files = await readdir(GUIDES_DIR);
  const stats = { construction: 0, general_applicable: 0, construction_partial: 0 };
  let modified = 0;

  for (const f of files) {
    if (!f.endsWith(".jsonld")) continue;
    const p = resolve(GUIDES_DIR, f);
    const node = JSON.parse(await readFile(p, "utf-8")) as Record<string, unknown> & {
      _meta?: { guideNo?: string; scope?: string; scopeNote?: string };
    };
    const guideNo = String(node._meta?.guideNo ?? f.replace(/\.jsonld$/, "").toUpperCase());
    const newScope = classifyScope(guideNo);
    stats[newScope] += 1;

    let changed = false;
    node._meta = node._meta ?? {};
    if (node._meta.scope !== newScope) {
      node._meta.scope = newScope;
      changed = true;
    }
    // out_of_domain 메모 제거
    if (node._meta.scopeNote) {
      delete node._meta.scopeNote;
      changed = true;
    }
    if (changed) {
      await writeFile(p, JSON.stringify(node, null, 2) + "\n", "utf-8");
      modified += 1;
    }
  }
  console.log(`\n[reclassify] modified ${modified} guide files`);
  console.log(`  construction:         ${stats.construction}`);
  console.log(`  general_applicable:   ${stats.general_applicable}`);
  console.log(`  construction_partial: ${stats.construction_partial}`);
  console.log(`  total:                ${stats.construction + stats.general_applicable + stats.construction_partial}`);

  // 3) scope.json 갱신
  const scope = JSON.parse(await readFile(SCOPE_PATH, "utf-8"));
  if (scope.koshaGuide) {
    scope.koshaGuide.totalGuides = stats.construction + stats.general_applicable + stats.construction_partial;
    scope.koshaGuide.estimatedConstructionRelevant = scope.koshaGuide.totalGuides;
    scope.koshaGuide.comment =
      "본 OSS는 건설안전 적용 가능한 KOSHA 가이드만 보유. " +
      "C/D/C-C/D-C는 건설 직접 (construction). " +
      "A/G/X/H/W/B-E/E-(전기)/O/F/K는 일반 적용 (general_applicable). " +
      "M/T/E-G/E-T/E-M/E-H는 부분 적용 (construction_partial).";
    scope.koshaGuide.categoryMapping = {
      construction: ["C-*", "D-*", "C-C-*", "D-C-*"],
      general_applicable: ["A-*", "G-*", "X-*", "H-*", "W-*", "B-E-*", "E-* (E-G/T/M/H 외)", "O-*", "F-*", "K-*"],
      construction_partial: ["E-G-*", "E-T-*", "E-M-*", "E-H-*", "T-*", "M-*"],
      out_of_domain: ["B-M-*", "B-5*", "B-6*", "P-*"],
    };
  }
  scope.updatedAt = new Date().toISOString().slice(0, 10);
  await writeFile(SCOPE_PATH, JSON.stringify(scope, null, 2) + "\n", "utf-8");
  console.log("[scope] scope.json categoryMapping 갱신");

  console.log("\n[done] 모든 보유 KOSHA 가이드를 건설안전 도메인으로 통합");
  console.log("       다음: npm run typecheck && tsx scripts/ontology/refine-kosha-mapping.ts (자동 매핑)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
