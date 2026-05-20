#!/usr/bin/env tsx
/**
 * real-use-test.ts
 *
 * 외부 사용자(LLM·안전관리자) 입장 실 사용 시나리오. 5 페르소나가 도구 체인으로
 * 실제 질문을 해결하는 흐름을 시뮬레이션 + 응답 품질 평가.
 */

import { listCoreSafetyLawsTool } from "../../src/tools/list-core-safety-laws.js";
import { getSafetyLawArticleTool } from "../../src/tools/get-safety-law-article.js";
import { searchSafetyLawsTool } from "../../src/tools/search-safety-laws.js";
import { reviewSafetyDocumentTool } from "../../src/tools/review-safety-document.js";
import { queryLegalBasisTool } from "../../src/tools/query-legal-basis.js";
import { queryPenaltyTool } from "../../src/tools/query-penalty.js";
import { queryApplicabilityTool } from "../../src/tools/query-applicability.js";
import { queryDelegationChainTool } from "../../src/tools/query-delegation-chain.js";
import { queryGuideLinksTool } from "../../src/tools/query-guide-links.js";
import { verifySafetyBasisTool } from "../../src/tools/verify-safety-basis.js";
import { listSafetyDocumentsByCycleTool } from "../../src/tools/list-safety-documents-by-cycle.js";
import { getSafetyDocumentGuideTool } from "../../src/tools/get-safety-document-guide.js";
import { getProjectInfoTool } from "../../src/tools/get-project-info.js";

interface Step {
  tool: string;
  input: unknown;
  highlights: string[];
}

interface Persona {
  name: string;
  role: string;
  question: string;
  steps: Step[];
}

const personas: Persona[] = [
  // ─────────────────────────────────────────────────────────────
  {
    name: "김안전",
    role: "50인 미만 토목현장 현장소장 (5억 공사, 8명, 굴착 3m)",
    question: "내일 굴착작업 시작 전 무엇을 준비해야 하지?",
    steps: [
      {
        tool: "query_applicability",
        input: {
          docId: "work_plan_excavation",
          scale: { workforce: 8, constructionValue: 5, industry: "construction" },
          workConditions: { depthM: 3 },
        },
        highlights: ["document.applies", "crossCutting.applies", "crossCutting.exempts", "relatedHazards"],
      },
      {
        tool: "query_legal_basis",
        input: { docId: "work_plan_excavation" },
        highlights: ["legalBasis.iriMapped", "legalBasis.relatedPenalties"],
      },
      {
        tool: "query_penalty",
        input: { articleRef: "art:기준규칙:38" },
        highlights: ["penalties"],
      },
      {
        tool: "review_safety_document",
        input: {
          docId: "work_plan_excavation",
          draft: {
            metadata: { siteName: "테스트", planDate: "2026-04-27", notifiedToWorkers: true },
            workConditions: { depthM: 3 },
            preSurvey: { shape: "토사2m+풍화암1m", crackWater: "함수 적정", buriedObj: "도시가스관 GL-1m", groundwater: "GL-3m" },
            plan: { method: "기계굴착", resources: "굴삭기 1·작업자 5", protectBuried: "도시가스관 차단", signal: "무전기", shoring: "H-Pile +계측", supervisor: "현장소장", other: "보호구·교육" },
            citations: [{ basisType: "regulation", legalWeight: "mandatory", title: "산안기준규칙 §38", source: "LAW_MCP", reference: "산업안전보건기준에 관한 규칙 §38" }],
          },
          scale: { workforce: 8, constructionValue: 5, industry: "construction" },
        },
        highlights: ["overall", "summary"],
      },
    ],
  },
  // ─────────────────────────────────────────────────────────────
  {
    name: "박관리",
    role: "100인 제조업 안전관리자",
    question: "TBM 일지 매일 작성하는데 법적 근거 + 검토 항목?",
    steps: [
      {
        tool: "get_safety_document_guide",
        input: { docId: "daily_tbm" },
        highlights: ["title", "cycle", "legalBasis"],
      },
      {
        tool: "query_legal_basis",
        input: { docId: "daily_tbm" },
        highlights: ["legalBasis.iriMapped"],
      },
      {
        tool: "query_delegation_chain",
        input: { startRef: "art:위험성평가-고시:15" },
        highlights: ["chainLength"],
      },
    ],
  },
  // ─────────────────────────────────────────────────────────────
  {
    name: "이감독",
    role: "사고 보고 담당 안전관리자 (1시간 내 보고서)",
    question: "사망사고 발생. 산업재해조사표 작성 항목 + 환각 ref 검증",
    steps: [
      {
        tool: "query_legal_basis",
        input: { docId: "industrial_accident_report" },
        highlights: ["legalBasis.iriMapped", "retention"],
      },
      {
        tool: "verify_safety_basis",
        input: {
          claims: [
            { claim: "산안법 §57에 따라 산업재해조사표 1개월 내 제출", evidence: [{ basisType: "law", legalWeight: "mandatory", title: "산안법 §57", source: "LAW_MCP", reference: "산업안전보건법 §57" }] },
          ],
        },
        highlights: ["overall", "supported"],
      },
      {
        tool: "verify_safety_basis",
        input: {
          claims: [
            { claim: "산안법 §999 가짜 조문", evidence: [{ basisType: "law", legalWeight: "mandatory", title: "산안법 §999", source: "INTERNAL", reference: "산업안전보건법 §999" }] },
          ],
        },
        highlights: ["overall", "invalid"],
      },
    ],
  },
  // ─────────────────────────────────────────────────────────────
  {
    name: "최평가",
    role: "5인 미만 사업장 (소상공인)",
    question: "5인 미만인데 위험성평가 의무 있나?",
    steps: [
      {
        tool: "query_applicability",
        input: {
          docId: "monthly_risk_assessment",
          scale: { workforce: 3, industry: "service" },
        },
        highlights: ["document.applies", "crossCutting.exempts"],
      },
      {
        tool: "search_safety_laws",
        input: { keyword: "5인 미만" },
        highlights: ["totalCount"],
      },
    ],
  },
  // ─────────────────────────────────────────────────────────────
  {
    name: "정중처",
    role: "중대재해 처벌법 점검 담당",
    question: "중처법 §4 안전·보건 확보의무 9가지가 무엇인가?",
    steps: [
      {
        tool: "query_legal_basis",
        input: { docId: "severe_accident_compliance" },
        highlights: ["legalBasis.iriMapped"],
      },
      {
        tool: "query_delegation_chain",
        input: { startRef: "art:중처법:4" },
        highlights: ["chainLength"],
      },
      {
        tool: "get_safety_law_article",
        input: { ref: "중대재해 처벌 등에 관한 법률 §4" },
        highlights: ["title"],
      },
    ],
  },
];

const TOOLS_REGISTRY: Record<string, { handler: (i: unknown) => Promise<unknown> }> = {
  list_core_safety_laws: listCoreSafetyLawsTool,
  get_safety_law_article: getSafetyLawArticleTool,
  search_safety_laws: searchSafetyLawsTool,
  review_safety_document: reviewSafetyDocumentTool,
  query_legal_basis: queryLegalBasisTool,
  query_penalty: queryPenaltyTool,
  query_applicability: queryApplicabilityTool,
  query_delegation_chain: queryDelegationChainTool,
  query_guide_links: queryGuideLinksTool,
  verify_safety_basis: verifySafetyBasisTool,
  list_safety_documents_by_cycle: listSafetyDocumentsByCycleTool,
  get_safety_document_guide: getSafetyDocumentGuideTool,
  get_project_info: getProjectInfoTool,
} as Record<string, { handler: (i: unknown) => Promise<unknown> }>;

function pluck(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else return undefined;
  }
  return cur;
}

function summarizeValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}건]`;
  if (typeof v === "object" && v) return JSON.stringify(v).slice(0, 100);
  return String(v).slice(0, 100);
}

interface PersonaOutcome {
  name: string;
  role: string;
  question: string;
  steps: Array<{
    tool: string;
    ok: boolean;
    summary: string;
    isError?: boolean;
  }>;
  passed: boolean;
}

(async () => {
  console.log("# 실 사용 테스트 — 5 페르소나 도구 체인\n");
  const outcomes: PersonaOutcome[] = [];
  for (const p of personas) {
    console.log(`\n## ${p.name} (${p.role})`);
    console.log(`Q: ${p.question}\n`);
    const stepResults: PersonaOutcome["steps"] = [];
    for (const s of p.steps) {
      const tool = TOOLS_REGISTRY[s.tool];
      if (!tool) {
        console.log(`  ❌ ${s.tool} — 도구 미등록`);
        stepResults.push({ tool: s.tool, ok: false, summary: "도구 미등록" });
        continue;
      }
      try {
        const r = (await tool.handler(s.input)) as { structuredContent?: unknown; isError?: boolean };
        const sc = r.structuredContent;
        const highlightSummary = s.highlights
          .map((h) => `${h}=${summarizeValue(pluck(sc, h))}`)
          .join(" | ");
        console.log(`  ✅ ${s.tool}${r.isError ? " [isError]" : ""}`);
        console.log(`     ${highlightSummary}`);
        stepResults.push({ tool: s.tool, ok: true, summary: highlightSummary, isError: r.isError });
      } catch (err) {
        console.log(`  ❌ ${s.tool} — ${(err as Error).message.slice(0, 100)}`);
        stepResults.push({ tool: s.tool, ok: false, summary: (err as Error).message.slice(0, 100) });
      }
    }
    const allOk = stepResults.every((s) => s.ok);
    outcomes.push({ ...p, steps: stepResults, passed: allOk });
  }

  console.log("\n# 종합");
  for (const o of outcomes) {
    console.log(`  ${o.passed ? "✅" : "❌"} ${o.name} (${o.steps.filter((s) => s.ok).length}/${o.steps.length} steps)`);
  }
  const total = outcomes.length;
  const passed = outcomes.filter((o) => o.passed).length;
  console.log(`\n[done] ${passed}/${total} 페르소나 시나리오 통과`);

  process.exit(passed === total ? 0 : 1);
})();
