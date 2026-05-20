#!/usr/bin/env tsx
/**
 * p0-verify.ts
 *
 * P0 검증 — 굴착 작업계획서(work_plan_excavation) Document 중심 그래프 노드 +
 * review_safety_document Tool 의 5가지 케이스 통합 검증.
 *
 * 케이스:
 *   1. 적용 외 (굴착면 < 2m)        → applicability warn
 *   2. 필수 누락 (사전조사 1건 무)   → blocker fail
 *   3. 환각 ref (§39 인용)           → hallucination
 *   4. 정상 작성                     → pass
 *   5. 권장 보강 (notifiedToWorkers무) → warn/fail
 */

import { reviewSafetyDocumentTool } from "../../src/tools/review-safety-document.js";

const tool = reviewSafetyDocumentTool;

interface Expect {
  applicabilityApplies?: boolean;
  overall?: "pass" | "needs_revision" | "fail";
  isError?: boolean;
  failCountAtLeast?: number;
  hallucinationCountAtLeast?: number;
  containsRule?: string; // 응답 checks 중에 일부 포함되어야 할 rule 텍스트
}

interface Case {
  name: string;
  expect: string;
  input: unknown;
  assertions: Expect;
}

const cases: Case[] = [
  {
    name: "Case 1 — 적용 외 (굴착면 1.5m, §38 미적용)",
    expect: "applicability=false, 필드 검증 skip",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "테스트현장 A", planDate: "2026-04-26" },
        workConditions: { depthM: 1.5 },
      },
      scale: { workforce: 8, constructionValue: 5, industry: "construction" },
    },
    assertions: {
      applicabilityApplies: false,
    },
  },
  {
    name: "Case 2 — 적용 + 필수 누락 (사전조사 4 중 3, 작업계획 7 중 5, 통지 X)",
    expect: "blocker fail 다수",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "테스트현장 B", planDate: "2026-04-26", notifiedToWorkers: false },
        workConditions: { depthM: 3.0 },
        preSurvey: {
          shape: "토사층 상부 0.5m + 풍화암 2m + 연암",
          crackWater: "균열 일부, 함수 적음",
          buriedObj: "도시가스관 매설 (GL-1.5m)",
        },
        plan: {
          method: "기계굴착(백호 0.7m³) → 인력굴착 마무리",
          resources: "굴삭기 1대, 작업자 4명, 신호수 1명",
          protectBuried: "도시가스관 노출 시 도시가스공사 입회",
          signal: "무전기 + 호각",
          shoring: "흙막이 H-Pile + 토류판",
        },
      },
      scale: { workforce: 8, constructionValue: 5, industry: "construction" },
    },
    assertions: {
      applicabilityApplies: true,
      overall: "fail",
      isError: true,
      failCountAtLeast: 5,
    },
  },
  {
    name: "Case 3 — 환각 ref (§39 인용)",
    expect: "hallucination 검출",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "테스트현장 C", planDate: "2026-04-26", notifiedToWorkers: true },
        workConditions: { depthM: 3.5 },
        preSurvey: {
          shape: "OK", crackWater: "OK", buriedObj: "OK", groundwater: "GL-3m",
        },
        plan: {
          method: "OK", resources: "OK", protectBuried: "OK",
          signal: "OK", shoring: "흙막이 + 계측 (GL- 변위 일 1회 측정, 기준값 ±10mm)",
          supervisor: "현장소장 직접", other: "보호구·교육 일일",
        },
        citations: [
          { basisType: "regulation", legalWeight: "mandatory", title: "굴착 §39 (가공)", source: "INTERNAL", reference: "산업안전보건기준에 관한 규칙 §39" },
        ],
      },
      scale: { workforce: 8, constructionValue: 5, industry: "construction" },
    },
    assertions: {
      applicabilityApplies: true,
      isError: true,
      hallucinationCountAtLeast: 1,
    },
  },
  {
    name: "Case 4 — 정상 (모든 필드 + ref + 통지)",
    expect: "overall pass",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "테스트현장 D", planDate: "2026-04-26", notifiedToWorkers: true, supervisor: "홍길동", compiler: "김안전" },
        documentId: "WP-D-2026-04-26-001",
        approvalChain: [
          { role: "작성자", name: "김안전", signed: true, date: "2026-04-26" },
          { role: "사업주", name: "황룡", signed: true, date: "2026-04-26" },
          { role: "관리감독자", name: "박감독", signed: true, date: "2026-04-26" },
          { role: "근로자대표", name: "이근로", signed: true, date: "2026-04-26" },
        ],
        workPeriod: "2026-04-27 ~ 2026-04-30",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-XXXX-XXXX" },
        workerNotification: { method: "TBM + 게시판 + 서명", date: "2026-04-26", evidence: "TBM 일지 첨부" },
        workConditions: { depthM: 4.0 },
        preSurvey: {
          shape: "토사 1m + 풍화암 3m",
          crackWater: "함수 적정, 동결 무",
          buriedObj: "전기관로 (GL-0.5m)",
          groundwater: "GL-3.5m (강우 시 +0.3m)",
        },
        plan: {
          method: "기계굴착 후 인력 마감",
          resources: "굴삭기 1, 작업자 5",
          protectBuried: "전기관로 차단 후 작업",
          signal: "무전기 + 신호수",
          shoring: "H-Pile + 토류판 (변위 1회/일 ±10mm)",
          supervisor: "작업지휘자 홍길동",
          other: "TBM 시작 전 5분",
        },
        citations: [
          { basisType: "regulation", legalWeight: "mandatory", title: "산안기준규칙 §38 굴착", source: "LAW_MCP", reference: "산업안전보건기준에 관한 규칙 §38" },
        ],
      },
      scale: { workforce: 8, constructionValue: 5, industry: "construction" },
    },
    assertions: {
      applicabilityApplies: true,
      overall: "pass",
      isError: false,
    },
  },
  {
    name: "Case 5 — 통지 누락 (blocker)",
    expect: "blocker — notifiedToWorkers fail",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "테스트현장 E", planDate: "2026-04-26", notifiedToWorkers: false },
        workConditions: { depthM: 3.0 },
        preSurvey: { shape: "OK", crackWater: "OK", buriedObj: "OK", groundwater: "OK" },
        plan: {
          method: "OK", resources: "OK", protectBuried: "OK",
          signal: "OK", shoring: "OK", supervisor: "OK", other: "OK",
        },
      },
      scale: { workforce: 8, constructionValue: 5, industry: "construction" },
    },
    assertions: {
      applicabilityApplies: true,
      isError: true,
      containsRule: "근로자에게 작업계획서 알림",
    },
  },
];

interface CaseResult {
  name: string;
  passed: boolean;
  failures: string[];
}

async function runCase(c: Case): Promise<CaseResult> {
  const failures: string[] = [];
  try {
    const result = await tool.handler(c.input);
    const sc = (result.structuredContent ?? {}) as Record<string, unknown>;
    const overall = sc["overall"];
    const summary = sc["summary"] as { fail?: number } | undefined;
    const applicability = sc["applicability"] as { applies?: boolean } | undefined;
    const checks = (sc["checks"] as Array<Record<string, unknown>> | undefined) ?? [];

    const a = c.assertions;
    if (a.applicabilityApplies !== undefined) {
      if (applicability?.applies !== a.applicabilityApplies) {
        failures.push(
          `applicabilityApplies: expected=${a.applicabilityApplies} actual=${applicability?.applies}`,
        );
      }
    }
    if (a.overall !== undefined) {
      if (overall !== a.overall) {
        failures.push(`overall: expected='${a.overall}' actual='${overall}'`);
      }
    }
    if (a.isError !== undefined) {
      const actualIsError = result.isError === true;
      if (actualIsError !== a.isError) {
        failures.push(`isError: expected=${a.isError} actual=${actualIsError}`);
      }
    }
    if (a.failCountAtLeast !== undefined) {
      const actual = summary?.fail ?? 0;
      if (actual < a.failCountAtLeast) {
        failures.push(`failCount: expected>=${a.failCountAtLeast} actual=${actual}`);
      }
    }
    if (a.hallucinationCountAtLeast !== undefined) {
      const hallCheck = checks.find((x) => String(x.rule).includes("법령 인용 실존성"));
      const count =
        ((hallCheck?.details as { hallucinationCount?: number } | undefined)?.hallucinationCount) ?? 0;
      if (count < a.hallucinationCountAtLeast) {
        failures.push(
          `hallucinationCount: expected>=${a.hallucinationCountAtLeast} actual=${count}`,
        );
      }
    }
    if (a.containsRule) {
      const found = checks.some((x) => String(x.rule).includes(a.containsRule!));
      if (!found) failures.push(`checks 에 rule 포함 X: '${a.containsRule}'`);
    }
    if (failures.length > 0) {
      const problemRules = checks
        .filter((x) => ["fail", "warn"].includes(String(x.status)))
        .slice(0, 8)
        .map((x) => `${x.status}: ${x.rule}${x.reason ? ` — ${x.reason}` : ""}`);
      if (problemRules.length > 0) {
        failures.push(`problem checks: ${problemRules.join(" / ")}`);
      }
    }
  } catch (err) {
    failures.push(`EXCEPTION: ${(err as Error).message}`);
  }
  return { name: c.name, passed: failures.length === 0, failures };
}

(async () => {
  console.log("# P0 검증 시나리오 — work_plan_excavation\n");
  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = await runCase(c);
    results.push(r);
    const mark = r.passed ? "✅" : "❌";
    console.log(`${mark} ${c.name}`);
    if (!r.passed) {
      for (const f of r.failures) console.log(`   - ${f}`);
    }
  }
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`\n# 종합: ${passed}/${total} ${passed === total ? "PASS" : "FAIL"}`);
  process.exit(passed === total ? 0 : 1);
})();
