#!/usr/bin/env tsx
/**
 * connect-new-articles.ts
 * 신규 추가한 기준규칙 44조 + 안전인증 등을 doc.legalBasis 로 가리키게 보강.
 * orphan in-degree=0 해소.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "documents");

const PATCHES: Array<{ file: string; arts: string[] }> = [
  // 비계 점검표 → §13(난간) §55,56,57,58(비계) §72,73(시스템)
  { file: "scaffolding-inspection-checklist.jsonld",
    arts: ["art:기준규칙:13","art:기준규칙:55","art:기준규칙:56","art:기준규칙:57","art:기준규칙:58","art:기준규칙:72","art:기준규칙:73"] },
  // 추락방지망 → 이미 §42-45
  { file: "fall-prevention-net-inspection.jsonld", arts: [] },
  // 안전대 → §32(보호구) §31,34 추가
  { file: "safety-harness-inspection.jsonld",
    arts: ["art:기준규칙:31","art:기준규칙:34"] },
  // 임시소방 → §232(용접화재)
  { file: "temporary-fire-facility-check.jsonld",
    arts: ["art:기준규칙:232","art:기준규칙:428"] },
  // 건설기계 일일점검 → §78,79,86,98,99,100,104
  { file: "construction-machinery-inspection.jsonld",
    arts: ["art:기준규칙:78","art:기준규칙:79","art:기준규칙:86","art:기준규칙:98","art:기준규칙:99","art:기준규칙:100","art:기준규칙:104"] },
  // 타워크레인 → §134,135 + §40 신호수
  { file: "tower-crane-inspection.jsonld",
    arts: ["art:기준규칙:134","art:기준규칙:135","art:기준규칙:40","art:기준규칙:47"] },
  // 거푸집 시공상세도 → §338,339
  { file: "formwork-shoring-drawing.jsonld",
    arts: ["art:기준규칙:338","art:기준규칙:339"] },
  // 콘크리트 타설 → §338,339
  { file: "concrete-placement-plan.jsonld",
    arts: ["art:기준규칙:338","art:기준규칙:339"] },
  // 흙막이 → §347,348(발파),351,352
  { file: "earth-retaining-drawing.jsonld",
    arts: ["art:기준규칙:347"] },
  // 가설전기 → §306,318
  { file: "temporary-electric-inspection.jsonld",
    arts: ["art:기준규칙:306","art:기준규칙:318"] },
  // 신호수 → §40
  { file: "signaler-appointment.jsonld", arts: [] },
  // 고소작업대 → §31,34 보호구
  { file: "aerial-work-platform-plan.jsonld",
    arts: ["art:기준규칙:31"] },
  // 작업장 사전 점검표 (기존 doc) → §21,23(통로) §49,50(조명)
  { file: "pre-work-inspection.jsonld",
    arts: ["art:기준규칙:21","art:기준규칙:23","art:기준규칙:49","art:기준규칙:50","art:기준규칙:46","art:기준규칙:48"] },
  // work-plan-bridge → §367,369(터널·교량 시계)
  { file: "work-plan-bridge.jsonld",
    arts: ["art:기준규칙:367","art:기준규칙:369"] },
  // work-plan-tunnel → §351,352
  { file: "work-plan-tunnel.jsonld",
    arts: ["art:기준규칙:351","art:기준규칙:352","art:기준규칙:367"] },
  // work-plan-quarry → §348(발파)
  { file: "work-plan-quarry.jsonld",
    arts: ["art:기준규칙:348"] },
  // work_permit_confined_space → §626,627
  { file: "work-permit-confined-space.jsonld",
    arts: ["art:기준규칙:626","art:기준규칙:627"] },
  // msds-register / asbestos-investigation-report 추가 §574
  { file: "msds-register.jsonld", arts: ["art:기준규칙:574"] },
  { file: "asbestos-investigation-report.jsonld", arts: ["art:기준규칙:574"] },
  // ppe-register → §31,34
  { file: "ppe-register.jsonld", arts: ["art:기준규칙:31","art:기준규칙:34"] },
  // work_plan_heavy_lifting + vehicle → §168
  { file: "work-plan-heavy-lifting.jsonld", arts: ["art:기준규칙:168"] },
  // work-plan-vehicle-cargo + vehicle-construction → §168
  { file: "work-plan-vehicle-cargo.jsonld", arts: ["art:기준규칙:168"] },
  // 항타 → §207, §210
  { file: "work-plan-vehicle-construction.jsonld", arts: ["art:기준규칙:207","art:기준규칙:210"] },
];

(async () => {
  let patched = 0, skipped = 0;
  for (const p of PATCHES) {
    if (p.arts.length === 0) continue;
    const path = resolve(DOCS, p.file);
    try {
      const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
      const cur = (node.legalBasis as string[] | undefined) ?? [];
      const set = new Set(cur);
      for (const a of p.arts) set.add(a);
      node.legalBasis = [...set];
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
      patched++;
    } catch (e) {
      console.warn(`skip ${p.file}: ${(e as Error).message}`);
      skipped++;
    }
  }
  console.log(`✅ ${patched} doc legalBasis 보강 (${skipped} skip)`);
})();
