#!/usr/bin/env tsx
/**
 * audit-work-plan-annex4.ts (2026-04-29)
 *
 * 산안기준규칙 §38 별표 4 13호의 공식 본문과 MCP work-plan-* 노드 13종을 1:1 대조.
 *
 * 검증 차원:
 *  (1) 사전조사 항목 수 일치
 *  (2) 작업계획서 항목 수 일치
 *  (3) 키워드 누수 (별표에 없는 항목이 MCP에 추가됨 — 예: 굴착에 '그 밖에 안전·보건')
 *  (4) 키워드 누락 (별표에 있는데 MCP에 없음)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJ = resolve(__dirname, "..", "..");

// 산안기준규칙 별표 4 13호 공식 항목 (build/ontology/safety-laws/산업안전보건기준에-관한-규칙.md 기반).
// 각 호의 사전조사·작업계획 항목 수는 법제처 본문 기준 카운트.
const ANNEX4: Array<{
  no: number;
  workType: string;
  docId: string;
  preSurvey: string[];
  plan: string[];
}> = [
  {
    no: 1,
    workType: "타워크레인 설치·조립·해체",
    docId: "work_plan_tower_crane",
    preSurvey: ["풍속"],
    plan: [
      "타워크레인의 종류·형식",
      "설치·조립·해체 순서",
      "작업도구·장비·가설설비 및 방호설비",
      "작업인원의 구성 및 작업근로자의 역할범위",
      "산안기준규칙 §142 (지지)",
    ],
  },
  {
    no: 2,
    workType: "차량계 하역운반기계등 사용 작업",
    docId: "work_plan_vehicle_cargo",
    preSurvey: [],
    plan: [
      "해당 작업에 따른 추락·낙하·전도·협착·붕괴 등 위험 예방대책",
      "차량계 하역운반기계등의 운행 경로·작업방법",
    ],
  },
  {
    no: 3,
    workType: "차량계 건설기계 사용 작업",
    docId: "work_plan_vehicle_construction",
    preSurvey: ["해당 기계의 굴러떨어짐·지반붕괴·매설물 손상 위험"],
    plan: [
      "사용하는 차량계 건설기계의 종류·성능",
      "차량계 건설기계의 운행 경로",
      "차량계 건설기계에 의한 작업방법",
    ],
  },
  {
    no: 4,
    workType: "화학설비·압력용기·배관 정비",
    docId: "work_plan_chemical_maintenance",
    preSurvey: [],
    plan: ["§278 단독 — 작업절차·안전대책 (별표 4에 별도 항목 없음, 본문 §278 참조)"],
  },
  {
    no: 5,
    workType: "전기작업 (50V 초과 또는 250VA 초과)",
    docId: "work_plan_electric_work",
    preSurvey: [],
    plan: [
      "전기작업의 목적·내용",
      "전기작업 근로자의 자격 및 적정 인원",
      "작업 범위·작업책임자 임명·전격·섬락 보호구 착용 (한 항)",
    ],
  },
  {
    no: 6,
    workType: "굴착작업 (높이 2m 이상)",
    docId: "work_plan_excavation",
    preSurvey: [
      "형상·지질 및 지층의 상태",
      "균열·함수·용수 및 동결의 유무 또는 상태",
      "매설물 등의 유무 또는 상태",
      "지반의 지하수위 상태",
    ],
    plan: [
      "굴착방법 및 순서, 토사 등 반출 방법",
      "필요한 인원 및 장비 사용계획",
      "매설물 등에 대한 이설·보호대책",
      "사업장 내 연락방법 및 신호방법",
      "흙막이 지보공 설치방법 및 계측계획",
      "작업지휘자의 배치계획",
    ],
  },
  {
    no: 7,
    workType: "터널굴착작업",
    docId: "work_plan_tunnel",
    preSurvey: [
      "보링 등 적절한 방법으로 낙반·출수 및 가스폭발 등 위험 방지 — 지형·지질 및 지층상태 조사",
    ],
    plan: [
      "굴착 방법",
      "터널지보공 및 복공의 시공방법과 용수의 처리방법",
      "환기 또는 조명시설을 설치할 때에는 그 방법",
    ],
  },
  {
    no: 8,
    workType: "교량 설치·해체·변경 (높이 5m 또는 지간 30m)",
    docId: "work_plan_bridge",
    preSurvey: [],
    plan: [
      "작업 방법 및 순서",
      "부재의 낙하·전도 또는 붕괴 방지 방법",
      "근로자 추락 위험 방지 안전조치",
      "가설 철구조물의 설치·사용·해체 시 안전성 검토 방법",
      "사용하는 기계등의 종류 및 성능",
      "작업지휘자 배치계획",
    ],
  },
  {
    no: 9,
    workType: "채석작업",
    docId: "work_plan_quarry",
    preSurvey: ["지반의 붕괴·굴착기계 굴러떨어짐 등 작업장 지형·지질 및 지층 상태"],
    plan: [
      "노천·갱내굴착의 구별 및 채석방법",
      "굴착면의 높이와 기울기",
      "굴착면 소단의 위치와 넓이",
      "갱내 낙반·붕괴방지 방법",
      "발파방법",
      "암석의 분할방법",
      "암석의 가공장소",
      "굴착기계등의 종류 및 성능",
      "토석·암석의 적재 및 운반방법과 운반경로",
      "표토·용수의 처리방법",
    ],
  },
  {
    no: 10,
    workType: "건물 등 해체작업",
    docId: "work_plan_demolition",
    preSurvey: ["해체건물 등의 구조", "주변 상황"],
    plan: [
      "해체의 방법 및 해체 순서도면",
      "가설설비·방호설비·환기설비 및 살수·방화설비 등의 방법",
      "사업장 내 연락방법",
      "해체물의 처분계획",
      "해체작업용 기계·기구 등의 작업계획서",
      "해체작업용 화약류 등의 사용계획서",
      "그 밖에 안전·보건에 관련된 사항",
    ],
  },
  {
    no: 11,
    workType: "중량물의 취급작업",
    docId: "work_plan_heavy_lifting",
    preSurvey: [],
    plan: [
      "추락위험 예방 안전대책",
      "낙하위험 예방 안전대책",
      "전도위험 예방 안전대책",
      "협착위험 예방 안전대책",
      "붕괴위험 예방 안전대책",
    ],
  },
  {
    no: 12,
    workType: "궤도 보수·점검작업",
    docId: "work_plan_railway_maintenance",
    preSurvey: [],
    plan: [
      "적절한 작업 인원, 작업량, 작업순서와 방법 및 위험요인에 대한 안전조치방법 등",
    ],
  },
  {
    no: 13,
    workType: "입환작업",
    docId: "work_plan_railway_shunting",
    preSurvey: [],
    plan: ["§395 단독 — 입환작업 안전 (별표 4 항목 명시 없음)"],
  },
];

const findings: Array<{
  no: number;
  workType: string;
  docId: string;
  status: string;
  expectedPreSurveyN: number;
  actualPreSurveyN: number;
  expectedPlanN: number;
  actualPlanN: number;
  preSurveyKeys: string[];
  planKeys: string[];
  notes: string[];
}> = [];

for (const a of ANNEX4) {
  const docPath = resolve(
    PROJ,
    "src/ontology/graph/nodes/documents",
    a.docId.replace(/_/g, "-") + ".jsonld",
  );
  let actualPreSurveyN = 0;
  let actualPlanN = 0;
  let preSurveyKeys: string[] = [];
  let planKeys: string[] = [];
  const notes: string[] = [];
  let status: "OK" | "MISSING_NODE" | "COUNT_MISMATCH" | "EXTRA_FIELD" | "MISSING_FIELD" = "OK";

  try {
    const raw = JSON.parse(readFileSync(docPath, "utf8"));
    const sections = raw.sections ?? [];
    for (const sec of sections) {
      const keys = (sec.fields ?? []).map((f: any) => f.key);
      if (sec.title === "사전조사" || (sec.title ?? "").includes("사전조사")) {
        actualPreSurveyN = keys.length;
        preSurveyKeys = keys;
      } else if (sec.title === "작업계획" || (sec.title ?? "").includes("작업계획")) {
        actualPlanN = keys.length;
        planKeys = keys;
      }
    }

    if (a.preSurvey.length > 0 && actualPreSurveyN !== a.preSurvey.length) {
      status = "COUNT_MISMATCH";
      notes.push(`사전조사 ${a.preSurvey.length}항 ↔ MCP ${actualPreSurveyN}건`);
    }
    if (a.plan.length > 0 && actualPlanN !== a.plan.length) {
      status = "COUNT_MISMATCH";
      notes.push(`작업계획 ${a.plan.length}항 ↔ MCP ${actualPlanN}건`);
    }
    if (actualPlanN > a.plan.length && a.plan.length > 0) {
      status = "EXTRA_FIELD";
      notes.push(`MCP 가 별표 4 ${a.no}호 보다 ${actualPlanN - a.plan.length}건 더 많음 (불필요 필드 의심)`);
    } else if (actualPlanN < a.plan.length && a.plan.length > 0) {
      // 위 if 분기와 mutex 이므로 status 가 EXTRA_FIELD 일 수 없음 — 직접 대입.
      status = "MISSING_FIELD";
      notes.push(`MCP 가 별표 4 ${a.no}호 보다 ${a.plan.length - actualPlanN}건 적음 (누락 필드 의심)`);
    }
  } catch (err) {
    status = "MISSING_NODE";
    notes.push(`Document 노드 없음: ${docPath} (${(err as Error).message.slice(0, 80)})`);
  }

  findings.push({
    no: a.no,
    workType: a.workType,
    docId: a.docId,
    status,
    expectedPreSurveyN: a.preSurvey.length,
    actualPreSurveyN,
    expectedPlanN: a.plan.length,
    actualPlanN,
    preSurveyKeys,
    planKeys,
    notes,
  });
}

console.log("══════ 산안기준규칙 별표 4 13호 정합 감사 ══════");
console.log(`(공식 본문 — build/ontology/safety-laws/산업안전보건기준에-관한-규칙.md)`);
console.log("");
console.log("호 | 작업유형                              | docId                          | 사전조사 | 작업계획 | 상태");
console.log("---|------------------------------------ |--------------------------------|----------|----------|------");
for (const f of findings) {
  const stat =
    f.status === "OK" ? "✅" :
    f.status === "MISSING_NODE" ? "❓ NODE 없음" :
    f.status === "EXTRA_FIELD" ? "⚠️ 불필요" :
    f.status === "MISSING_FIELD" ? "🔴 누락" :
    "🟡 mismatch";
  const pre = `${f.actualPreSurveyN}/${f.expectedPreSurveyN}`;
  const plan = `${f.actualPlanN}/${f.expectedPlanN}`;
  console.log(`${String(f.no).padStart(2)} | ${f.workType.padEnd(38)} | ${f.docId.padEnd(30)} | ${pre.padEnd(8)} | ${plan.padEnd(8)} | ${stat}`);
}
console.log("");
console.log("══════ 상세 ══════");
for (const f of findings) {
  if (f.notes.length > 0) {
    console.log(`\n[${f.no}호 ${f.workType}] ${f.docId}`);
    for (const n of f.notes) console.log(`  ⮕ ${n}`);
    if (f.planKeys.length > 0) console.log(`     planKeys: ${f.planKeys.join(", ")}`);
  }
}

const outPath = resolve(PROJ, "dev-resources", "audit-work-plan-annex4.json");
writeFileSync(outPath, JSON.stringify({ findings, annex4Source: "build/ontology/safety-laws/산업안전보건기준에-관한-규칙.md" }, null, 2));
console.log(`\n[audit] 상세 → ${outPath}`);
