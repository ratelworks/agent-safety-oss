import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { ToolDefinition } from "./lib/types.js";
import { TraceRecorder } from "./lib/trace-recorder.js";

// ── 도구 모듈 import ──
// 번들 통합:
//   - getKoshaGuideContentTool (Live API 15144147) → 제거 (getKoshaGuideMdTool 이 1,039건 본문 offline 제공)
//   - searchKoshaGuidesTool (빈 번들 stub) → 제거 (getKoshaGuideMdTool 의 keyword 인수가 검색 기능 통합)
import { fieldSafetyBriefingTool } from "./tools/field-safety-briefing.js";
import { getKoshaGuideMdTool } from "./tools/get-kosha-guide-md.js";
import { searchAccidentCasesTool } from "./tools/search-accident-cases.js";
import { getAccidentCaseAttachmentsTool } from "./tools/get-accident-case-attachments.js";
import { searchConstructionFatalAccidentsTool } from "./tools/search-construction-fatal-accidents.js";
import { searchAllFatalAccidentsTool } from "./tools/search-all-fatal-accidents.js";
import { searchSafetyMaterialsTool } from "./tools/search-safety-materials.js";
import { searchMsdsTool } from "./tools/search-msds.js";
import { searchPpeCertificationTool } from "./tools/search-ppe-certification.js";
import { searchSafetyLawSmartTool } from "./tools/search-safety-law-smart.js";
import { searchSifArchiveTool } from "./tools/search-sif-archive.js";
import { listConstructionSubtasksTool } from "./tools/list-construction-subtasks.js";
import { verifySafetyBasisTool } from "./tools/verify-safety-basis.js";
import { analyzeConstructionWorkRisksTool } from "./tools/analyze-construction-work-risks.js";
import { getProjectInfoTool } from "./tools/get-project-info.js";
import { getOfficialFormTool } from "./tools/get-official-form.js";
import { compileSafetyReferencesTool } from "./tools/compile-safety-references.js";
import { getMeasuresByRiskTool } from "./tools/get-measures-by-risk.js";
import { getPpeByTaskTool } from "./tools/get-ppe-by-task.js";
import { generateTbmTopicsTool } from "./tools/generate-tbm-topics.js";
import { getForeignWorkerResourceLinksTool } from "./tools/get-foreign-worker-resource-links.js";
import { searchSafetyLawsTool } from "./tools/search-safety-laws.js";
import { getSafetyLawArticleTool } from "./tools/get-safety-law-article.js";
import { listCoreSafetyLawsTool } from "./tools/list-core-safety-laws.js";
import { getRiskAssessmentSchemaTool } from "./tools/get-risk-assessment-schema.js";
import { getWorkPlanSchemaTool } from "./tools/get-work-plan-schema.js";
import { getTbmSchemaTool } from "./tools/get-tbm-schema.js";
import { getOpsSchemaTool } from "./tools/get-ops-schema.js";
import { getWorkPermitSchemaTool } from "./tools/get-work-permit-schema.js";
import { listKrasMethodsTool } from "./tools/list-kras-methods.js";
import { chooseAssessmentMethodTool } from "./tools/choose-assessment-method.js";
import { getKrasMethodTool } from "./tools/get-kras-method.js";
import { reviewSafetyDocumentTool } from "./tools/review-safety-document.js";
import { generateSafetyDocumentTool } from "./tools/generate-safety-document.js";
import { submitSafetyDocumentTool } from "./tools/submit-safety-document.js";
// startSafetyFormUiTool removed 2026-04-27 — form-server는 클라이언트 환경 의존(브라우저·OS open)으로 OSS 4대 본분 위반.
// dev/Agent_HQ/Agent_Safety_Forms/ 로 격리됨 (라텔웍스 제품 영역).
import { listSafetyDocumentsByCycleTool } from "./tools/list-safety-documents-by-cycle.js";
import { getSafetyDocumentGuideTool } from "./tools/get-safety-document-guide.js";
import { searchKoshaArchiveTool } from "./tools/search-kosha-archive.js";
import { getKoshaArchiveFilesTool } from "./tools/get-kosha-archive-files.js";
import { listKoshaArchiveFacetsTool } from "./tools/list-kosha-archive-facets.js";
import { queryLegalBasisTool } from "./tools/query-legal-basis.js";
import { queryPenaltyTool } from "./tools/query-penalty.js";
import { queryDelegationChainTool } from "./tools/query-delegation-chain.js";
import { queryApplicabilityTool } from "./tools/query-applicability.js";
import { queryGuideLinksTool } from "./tools/query-guide-links.js";
import { SITE_PROFILE_TOOLS } from "./tools/site-profile-tools.js";
import { COMPANY_KEY_TOOLS } from "./tools/company-key-tools.js";
import { assessMyObligationsTool } from "./tools/assess-my-obligations.js";
import { getSubmissionInfoTool } from "./tools/get-submission-info.js";
import { getRetentionStatusTool } from "./tools/get-retention-status.js";
import { listUpcomingDutiesTool } from "./tools/list-upcoming-duties.js";
import { getIncidentResponseWorkflowTool } from "./tools/get-incident-response-workflow.js";
import { getConstructionStageDutiesTool } from "./tools/get-construction-stage-duties.js";
import { listDownloadableFormsTool } from "./tools/list-downloadable-forms.js";
import { exportDraftedDocumentTool } from "./tools/export-drafted-document.js";
import { assembleDocContextTool } from "./tools/assemble-doc-context.js";
import { renderA2UIFormTool } from "./tools/render-a2ui-form.js";
import { renderProfileInputFormTool } from "./tools/render-profile-input-form.js";
import { saveProfileFromFormTool } from "./tools/save-profile-from-form.js";
import { CORRECTIVE_ACTION_TOOLS } from "./tools/corrective-action-tools.js";
import { SAFETY_REPORT_TOOLS } from "./tools/safety-report-tools.js";
import { LOCAL_STORAGE_TOOLS } from "./tools/local-storage-tools.js";
import { PHOTO_EVIDENCE_TOOLS } from "./tools/photo-evidence-tools.js";
import { SAFETY_ISSUE_TOOLS } from "./tools/safety-issue-tools.js";
import { toMcpErrorContent } from "./lib/errors.js";
import { COMMON_RESPONSE_META } from "./config/constants.js";
import type { McpToolResult } from "./lib/types.js";

// 파일 최상단 상수 - 공개 도구 수는 TOOLS.length 가 SSoT (`node build/cli.js tools` 로 실측).
// 회귀 차단: ci.yml 의 `tool count regression` 단계가 README badge / docs 와 자동 대조.
// KOSHA Guide 본문 번들 통합으로 getKoshaGuideContentTool·searchKoshaGuidesTool 2개 제거됨 (legacy)
//   - getKoshaGuideMdTool (번들 1,039건, offline, keyless) 가 list/search/content 모두 통합 제공
//   - compile-safety-references 의 kosha-guide 호출도 번들 도구로 자동 마이그레이션
// 50억 미만 + 50인 미만 소규모 건설현장 + 안전관리자 겸임 현장소장의
// 일·주·월·분기·반기·연·수시·상시 단위 법정문서 작성 길잡이
export const TOOLS: ToolDefinition[] = [
  // ─── 1. 검색 (Search) — Live API 키 필요 ───
  searchAccidentCasesTool, // KOSHA 국내재해사례 (15121001)
  getAccidentCaseAttachmentsTool, // 재해사례 첨부 (15121008)
  searchConstructionFatalAccidentsTool, // 건설 중대재해 (15133935)
  searchAllFatalAccidentsTool, // 전업종 사망사고 (15119137)
  searchSafetyMaterialsTool, // 안전보건자료 (15139398)
  searchMsdsTool, // MSDS (15157612)
  searchPpeCertificationTool, // 보호구 인증 (15139497)
  searchSafetyLawSmartTool, // 안전보건법령 스마트검색 (15123696) — AI 유사어 + 법령·KOSHA Guide·미디어 통합
  // ─── 1. 검색 (Search) — Live API keyless (KOSHA portal24) ⭐ 신규 ───
  searchKoshaArchiveTool, // 안전보건자료실 8,976건 (selectMediaList)
  listKoshaArchiveFacetsTool, // 5개 facet 코드 목록
  // ─── 1. 검색 (Search) — 로컬 번들 keyless ───
  searchSafetyLawsTool, // 법령 번들 키워드 검색 (저작권법 §7 비보호)
  getKoshaGuideMdTool, // 번들 KOSHA Guide 본문 MD (1,039건, keyless offline). 목록·검색·본문 통합
  searchSifArchiveTool, // SIF 아카이브 (번들, 빈 상태)
  listConstructionSubtasksTool, // 공종 세부공정 (번들, 빈 상태)
  // ─── 2. 조회 (Lookup) — 본문/메타 ───
  getSafetyLawArticleTool, // 법령 조문 본문
  listCoreSafetyLawsTool, // 번들 법령 목록 (검토상태 포함)
  getForeignWorkerResourceLinksTool, // 외국인 13국어 자료 링크
  getKrasMethodTool, // KRAS 7방법 상세
  getKoshaArchiveFilesTool, // KOSHA 자료 첨부 파일 + 다운로드 URL ⭐ 신규
  getProjectInfoTool, // 프로젝트 메타·크레딧
  getOfficialFormTool, // ⭐ 내장 공식 양식 132 formId (HWP 14 / PDF 23 / XLSX 1 / md 94, forms-map.json SSoT)
  // ─── 2. 조회 — 그래프 메타 (v0.3 신규) ───
  queryLegalBasisTool, // ⭐ docId → 법적 근거 통합 (v0.3)
  queryPenaltyTool, // ⭐ docId/articleRef → 처벌 (v0.3)
  // ─── 3. 가이드 (Guide) — 시간 주기 + 서식 + KRAS ⭐ ───
  listSafetyDocumentsByCycleTool, // 주기별 법정문서 색인 (일·주·월·분기·반기·연·수시·상시)
  getSafetyDocumentGuideTool, // 특정 문서 풀 가이드 (양식+작성가이드+검토규칙)
  getRiskAssessmentSchemaTool, // 위험성평가 스키마 (kras_method 통합)
  getWorkPlanSchemaTool, // 작업계획서 13종 스키마
  getTbmSchemaTool, // TBM 스키마 (고시 §15 ④ 3호)
  getOpsSchemaTool, // OPS 1페이지 스키마
  getWorkPermitSchemaTool, // 작업허가서 5종 스키마
  listKrasMethodsTool, // KRAS 7방법 목록
  chooseAssessmentMethodTool, // 사업장 조건 기반 KRAS 방법 추천
  // ─── 4. 검증 (Verify) ⭐ — MCP 의 킬러 기능 ───
  verifySafetyBasisTool, // ref 실존 + 등급 정합성 + 환각 마커
  reviewSafetyDocumentTool, // 법정문서 초안 종합 점검 (Phase A: 위험성평가)
  generateSafetyDocumentTool, // ⭐ 법정문서 *완성 본문* 결정론적 생성 (P-PAPER-1: work_plan_excavation)
  submitSafetyDocumentTool, // ⭐ A2UI action.name 과 실제 MCP tool contract 연결
  // startSafetyFormUiTool — 격리 (Agent_Safety_Forms 제품 영역, 2026-04-27)
  queryApplicabilityTool, // ⭐ 적용성 자동 판정 (v0.3)
  // ─── 5. 매칭/체인 (Chain) — 공종 → 자료 자동 묶음 ───
  fieldSafetyBriefingTool, // ⭐ 현장 사용자 친화 통합 brief (작업명 → 위험·통제·법령·의무문서·KOSHA 한 화면, 부칙·법무 노이즈 자동 제외)
  analyzeConstructionWorkRisksTool, // 공종 위험요인 통합 분석
  compileSafetyReferencesTool, // (workType × docType) → 법령+KOSHA+사례 RAG 번들
  getMeasuresByRiskTool, // ⭐ 위험요인 → mitigatedBy 안전조치 + ERIC + 원문 링크
  getPpeByTaskTool, // ⭐ 작업 → 위험요인 → PPE 보호구 집계
  generateTbmTopicsTool, // ⭐ 작업 → TBM 회의 주제 markdown 생성
  queryDelegationChainTool, // ⭐ 위임 사슬 BFS 추적 (v0.3)
  queryGuideLinksTool, // ⭐ Guide·자료 묶음 (v0.3)
  // ─── 6. SSoT 사이트 프로파일 (v0.4 신규) — 한 번 등록 + 94종 양식 자동 채움 ───
  ...SITE_PROFILE_TOOLS,
  // ─── 7. 라텔웍스 발행 키 + 기업 프로파일 (v0.4 신규) — 가입 1회 + 자동 fetch ───
  ...COMPANY_KEY_TOOLS,
  // ─── 8. 라이프사이클 진단 (v0.5 신규) — 인식·제출·보관 6단계 ───
  assessMyObligationsTool, // ⭐ 사업장 프로파일 → 적용 법정의무 진단 (라이프사이클 §1.1 인식)
  getSubmissionInfoTool, // ⭐ docId → 제출처·마감·전자제출 (§1.5 제출)
  getRetentionStatusTool, // ⭐ docId+compileDate → 남은 보관·다음 갱신일 (§1.6 보관)
  listUpcomingDutiesTool, // ⭐ N일 내 임박 의무 (§1.6 보관·알림)
  getIncidentResponseWorkflowTool, // ⭐ 산재 시간순 의무 (§5.1 응급 시나리오)
  getConstructionStageDutiesTool, // ⭐ 공사 단계별 의무 패키지 (§5.2 단계 시나리오)
  listDownloadableFormsTool, // ⭐ 132종 양식 인덱스·필터 (§1.2 작성)
  exportDraftedDocumentTool, // ⭐ draft → HTML/Markdown 출력 (§1.2·§1.4)
  assembleDocContextTool, // ⭐⭐ docId → 그래프 traversal 완전 컨텍스트 조립 (LLM 추측 없는 결정론적 작성 지원)
  renderA2UIFormTool, // ⭐⭐ docId → A2UI v0.9 JSONL 폼 (Claude Desktop·Inspector 직접 렌더 + 동적 입력)
  renderProfileInputFormTool, // ⭐⭐⭐ Profile 통합 입력 폼 (사업장+현장+인력 한 번 등록 → 94종 자동 채움)
  saveProfileFromFormTool, // ⭐⭐⭐ Profile 폼 입력값 → profile.jsonld 일괄 저장
  // ─── 9. 조치·보고 사이클 (v0.6.x 신규) — SafetyIssue·CorrectiveAction·SafetyReport ───
  ...CORRECTIVE_ACTION_TOOLS,
  ...SAFETY_REPORT_TOOLS,
  // ─── 10. 로컬 저장소 (v0.5 신규) — drafts·documents·activity log ───
  ...LOCAL_STORAGE_TOOLS,
  // ─── 10. 현장 사이클 (v0.6 신규) — PhotoEvidence·SafetyIssue ───
  ...PHOTO_EVIDENCE_TOOLS,
  ...SAFETY_ISSUE_TOOLS,
];

// 등록: zod 스키마를 MCP SDK 고수준 API에 전달
export function registerAllTools(server: McpServer): void {
  const recorder = new TraceRecorder();

  for (const tool of TOOLS) {
    const originalHandler = tool.handler;
    const wrappedHandler = async (input: unknown): Promise<McpToolResult> => {
      const startedAt = new Date().toISOString();
      try {
        const result = await originalHandler(input);
        const output = attachCredits(result);
        const endedAt = new Date().toISOString();
        await recorder.recordToolCall(tool.name, input, output, startedAt, endedAt);
        return output;
      } catch (err) {
        const output = toMcpErrorContent(err);
        const endedAt = new Date().toISOString();
        await recorder.recordToolCall(
          tool.name,
          input,
          { error: getErrorMessage(err) },
          startedAt,
          endedAt,
        );
        return output;
      }
    };

    server.registerTool(
      tool.name,
      {
        title: tool.title ?? tool.name,
        description: tool.description,
        inputSchema: extractRawShape(tool.inputSchema),
      },
      wrappedHandler,
    );
  }
}

function extractRawShape(schema: unknown): z.ZodRawShape {
  // ZodEffects(.refine() 등)는 _def.schema 로 unwrap 필요 (a-codex P0-5 권고)
  let cur: unknown = schema;
  // 최대 3단계까지 unwrap (.refine().refine() 같은 중첩 대응)
  for (let i = 0; i < 3; i += 1) {
    if (
      cur &&
      typeof cur === "object" &&
      "_def" in (cur as Record<string, unknown>)
    ) {
      const def = (cur as { _def?: { schema?: unknown; typeName?: string } })._def;
      if (def && def.typeName === "ZodEffects" && def.schema) {
        cur = def.schema;
        continue;
      }
    }
    break;
  }
  if (cur && typeof cur === "object" && "shape" in (cur as Record<string, unknown>)) {
    return (cur as { shape: z.ZodRawShape }).shape;
  }
  return {} as z.ZodRawShape;
}

// 모든 Tool 응답에 공통 크레딧 메타를 자동 첨부
// structuredContent 에 _meta 블록을 추가해 LLM 이 참조하거나 인용 시 표시 가능
export function attachCredits(result: McpToolResult): McpToolResult {
  const base = (result.structuredContent ?? {}) as Record<string, unknown>;
  const merged = {
    ...base,
    _meta: {
      ...((base._meta as Record<string, unknown>) ?? {}),
      ...COMMON_RESPONSE_META,
    },
  };
  return {
    ...result,
    structuredContent: merged,
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function findTool(name: string) {
  return TOOLS.find((t) => t.name === name);
}
