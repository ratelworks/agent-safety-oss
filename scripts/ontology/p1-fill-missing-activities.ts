#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = "/Users/ratelworks/Desktop/Claude Code/dev/oss/agent-safety-oss/src/ontology/graph/nodes";

// 누락된 4개 활동을 적절한 의무문서에 추가
const ADDITIONS: Array<{ doc: string; activity: string }> = [
  // PHC파일 항타 — 차량계 건설기계 작업계획서 + 통합
  { doc: "work-plan-vehicle-construction", activity: "activity:phc_pile_driving" },
  { doc: "work-plan",                      activity: "activity:phc_pile_driving" },
  { doc: "construction-machinery-inspection", activity: "activity:phc_pile_driving" },

  // 도로포장 — 차량계(롤러기 차량) + 점검표
  { doc: "work-plan-vehicle-construction",   activity: "activity:road_pavement" },
  { doc: "construction-machinery-inspection", activity: "activity:road_pavement" },
  { doc: "work-plan",                         activity: "activity:road_pavement" },

  // 송전탑·철탑 조립 — 안전인증 + 작업계획서 통합 + 고소작업
  { doc: "safety-certification-application",   activity: "activity:tower_assembly" },
  { doc: "voluntary-safety-confirmation-filing", activity: "activity:tower_assembly" },
  { doc: "safety-inspection-application",      activity: "activity:tower_assembly" },
  { doc: "work-permit-high-altitude",          activity: "activity:tower_assembly" },
  { doc: "safety-harness-inspection",          activity: "activity:tower_assembly" },
  { doc: "fall-prevention-net-inspection",     activity: "activity:tower_assembly" },

  // 방수 작업 — 외벽 + 화학물질 + 고소
  { doc: "msds-register",                  activity: "activity:waterproofing" },
  { doc: "safety-harness-inspection",      activity: "activity:waterproofing" },
  { doc: "fall-prevention-net-inspection", activity: "activity:waterproofing" },
  { doc: "aerial-work-platform-plan",      activity: "activity:waterproofing" },
  { doc: "work-permit-high-altitude",      activity: "activity:waterproofing" },
  { doc: "health-examination-records",     activity: "activity:waterproofing" },
];

let added = 0;
for (const { doc, activity } of ADDITIONS) {
  const path = `${ROOT}/documents/${doc}.jsonld`;
  const node = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  const cur = (node.appliesToActivities as string[] | undefined) ?? [];
  if (!cur.includes(activity)) {
    cur.push(activity);
    node.appliesToActivities = cur;
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf-8");
    added += 1;
    console.log(`  ✓ ${doc} += ${activity}`);
  }
}
console.log(`[done] ${added} activity edges added to documents`);
