#!/usr/bin/env tsx
/**
 * ab-test.ts
 *
 * v0.4 vs v0.5 도구 응답 직접 A/B 테스트.
 * 동일 시나리오 5건에 대해 도구 호출 결과를 캡처.
 *
 * 사용:
 *   - v0.5 (현재): npx tsx scripts/dev/ab-test.ts > /tmp/ab-v0.5.json
 *   - v0.4 (worktree): /tmp/safety-v04 에서 동일 실행 → /tmp/ab-v0.4.json
 *
 * 출력: 시나리오별 응답 (그래프 추론 결과 + KOSHA Guide cover + 사용자 가치 측정 단서).
 */

import { reviewSafetyDocumentTool } from "../../src/tools/review-safety-document.js";
import { queryGuideLinksTool } from "../../src/tools/query-guide-links.js";
import { queryPenaltyTool } from "../../src/tools/query-penalty.js";
import { queryLegalBasisTool } from "../../src/tools/query-legal-basis.js";
import { queryApplicabilityTool } from "../../src/tools/query-applicability.js";
import type { ToolDefinition } from "../../src/lib/types.js";

interface Scenario {
  id: string;
  description: string;
  tool: ToolDefinition;
  toolName: string;
  input: unknown;
}

const scenarios: Scenario[] = [
  {
    id: "S1_excavation_review",
    description: "굴착작업계획서 검수 (정상 케이스)",
    tool: reviewSafetyDocumentTool,
    toolName: "review_safety_document",
    input: {
      docId: "work_plan_excavation",
      draft: {
        metadata: { siteName: "테스트현장", planDate: "2026-04-27", notifiedToWorkers: true, supervisor: "홍길동" },
        documentId: "WP-2026-04-27-001",
        approvalChain: [
          { role: "사업주", name: "황룡", signed: true, date: "2026-04-27" },
          { role: "관리감독자", name: "박감독", signed: true, date: "2026-04-27" },
          { role: "근로자대표", name: "이근로", signed: true, date: "2026-04-27" },
        ],
        workPeriod: "2026-04-28 ~ 2026-05-15",
        emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-XXXX-XXXX" },
        workerNotification: { method: "TBM + 게시판 + 서명", date: "2026-04-27", evidence: "TBM 일지 첨부" },
        workConditions: { depthM: 5.0 },
        preSurvey: {
          shape: "토사 1m + 풍화암 4m",
          crackWater: "함수 적정",
          buriedObj: "도시가스관 GL-1.2m 인접",
          groundwater: "GL-4.5m",
        },
        plan: {
          method: "기계굴착 후 인력 마감",
          resources: "굴삭기 1, 작업자 6",
          protectBuried: "도시가스공사 입회 + 시굴",
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
  },
  {
    id: "S2_query_guide_excavation",
    description: "굴착작업계획서 → KOSHA Guide 매핑 조회",
    tool: queryGuideLinksTool,
    toolName: "query_guide_links",
    input: { docId: "work_plan_excavation" },
  },
  {
    id: "S3_query_guide_msds",
    description: "MSDS 등록부 → 관련 KOSHA Guide 조회",
    tool: queryGuideLinksTool,
    toolName: "query_guide_links",
    input: { docId: "msds_register" },
  },
  {
    id: "S4_query_guide_work_environment",
    description: "작업환경측정 → 관련 KOSHA Guide 조회 (분진·소음·진동·근골격)",
    tool: queryGuideLinksTool,
    toolName: "query_guide_links",
    input: { docId: "work_environment_measurement" },
  },
  {
    id: "S5_penalty_excavation",
    description: "굴착작업 의무 위반 → 처벌 조회",
    tool: queryPenaltyTool,
    toolName: "query_penalty",
    input: { articleIri: "art:기준규칙:38" },
  },
];

interface Captured {
  scenario: string;
  description: string;
  tool: string;
  isError: boolean;
  guidedByCount?: number;
  guidedBySample?: string[];
  legalBasisCount?: number;
  relatedActivitiesCount?: number;
  reviewOverall?: string;
  reviewFailCount?: number;
  reviewWarnCount?: number;
  hallucinationCount?: number;
  payloadSummary: unknown;
}

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

function pickPayload(r: ToolResult): Record<string, unknown> {
  return (r.structuredContent ?? {}) as Record<string, unknown>;
}

(async () => {
  const out: Captured[] = [];
  for (const s of scenarios) {
    try {
      const r = (await s.tool.handler(s.input)) as ToolResult;
      const sc = pickPayload(r);
      const cap: Captured = {
        scenario: s.id,
        description: s.description,
        tool: s.toolName,
        isError: r.isError === true,
        payloadSummary: {},
      };

      // tool별 핵심 메트릭 추출
      if (s.toolName === "query_guide_links") {
        const links = (sc.links ?? {}) as Record<string, unknown>;
        const guidedBy = (links.guidedBy as string[] | undefined) ?? [];
        const legalBasis = (links.legalBasis as string[] | undefined) ?? [];
        const relatedActs = (links.relatedActivities as string[] | undefined) ?? [];
        cap.guidedByCount = guidedBy.length;
        cap.guidedBySample = guidedBy.slice(0, 8);
        cap.legalBasisCount = legalBasis.length;
        cap.relatedActivitiesCount = relatedActs.length;
        cap.payloadSummary = {
          docId: sc.docId,
          title: sc.title,
          guidedBy: guidedBy.slice(0, 12),
          legalBasis,
          relatedActivities: relatedActs,
          sparseLinks: sc.sparseLinks,
        };
      } else if (s.toolName === "review_safety_document") {
        const summary = sc.summary as { fail?: number; warn?: number } | undefined;
        cap.reviewOverall = sc.overall as string | undefined;
        cap.reviewFailCount = summary?.fail ?? 0;
        cap.reviewWarnCount = summary?.warn ?? 0;
        const checks = (sc.checks as Array<Record<string, unknown>> | undefined) ?? [];
        const hall = checks.find((c) => String(c.rule).includes("법령 인용 실존성"));
        cap.hallucinationCount =
          ((hall?.details as { hallucinationCount?: number } | undefined)?.hallucinationCount) ?? 0;
        cap.payloadSummary = {
          overall: sc.overall,
          summary: sc.summary,
          applicability: sc.applicability,
          checksCount: checks.length,
          guidedByInResponse: (sc.guidedBy as string[] | undefined)?.length ?? 0,
        };
      } else if (s.toolName === "query_penalty") {
        cap.payloadSummary = sc;
      } else {
        cap.payloadSummary = sc;
      }

      out.push(cap);
    } catch (err) {
      out.push({
        scenario: s.id,
        description: s.description,
        tool: s.toolName,
        isError: true,
        payloadSummary: { error: (err as Error).message },
      });
    }
  }

  console.log(JSON.stringify(out, null, 2));
})();
