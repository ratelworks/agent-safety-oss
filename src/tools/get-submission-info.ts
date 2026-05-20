/**
 * get_submission_info
 *
 * docId → 제출처·마감·전자제출 URL·필요 첨부서류 조회.
 * docs/LEGAL-DUTY-LIFECYCLE.md §1.5 제출(Submission) 단계.
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { findDoc, loadMaster } from "../lib/master-loader.js";

const inputSchema = z.object({
  docId: z.string().describe("법정문서 docId (예: industrial_accident_report)"),
});


async function handler(rawInput: unknown): Promise<McpToolResult> {
  const { docId } = inputSchema.parse(rawInput);
  const doc = findDoc(docId);
  if (!doc) {
    const allIds = loadMaster()
      .documents.map((d) => d.docId)
      .slice(0, 10);
    return {
      content: [{ type: "text", text: `[NOT_FOUND] docId="${docId}" 미존재. 샘플: ${allIds.join(", ")}...` }],
      isError: true,
      structuredContent: { docId, found: false },
    };
  }

  const lines: string[] = [];
  lines.push(`# ${doc.title}`);
  lines.push("");
  if (doc.purpose) {
    lines.push(`**목적**: ${doc.purpose}`);
    lines.push("");
  }
  lines.push(`**카테고리**: ${doc.category} / **주기**: ${doc.frequency}`);
  lines.push(`**적용범위**: ${doc.applicableScope}`);
  lines.push(`**법령근거**: ${doc.legalRef.join(", ")}`);
  lines.push("");
  lines.push(`## 제출 정보`);
  lines.push("");
  lines.push(`- **제출처**: ${doc.submitTo ?? "(미정의)"}`);
  lines.push(`- **마감**: ${doc.submitDeadline ?? "(미정의)"}`);
  if (doc.electronicSubmission?.available) {
    lines.push(`- **전자제출**: ✅ 가능`);
    lines.push(`  - URL: ${doc.electronicSubmission.url ?? "?"}`);
    if (doc.electronicSubmission.system) lines.push(`  - 시스템: ${doc.electronicSubmission.system}`);
  } else {
    lines.push(`- **전자제출**: ❌ 직접 제출 또는 자체 보관`);
  }
  lines.push("");
  lines.push(`## 보관`);
  lines.push("");
  lines.push(`- **보관기간**: ${doc.retention}`);
  lines.push(`- **다음 작성**: ${doc.nextDueRule ?? "(미정의)"}`);
  lines.push("");
  lines.push(`## 미준수 시`);
  lines.push("");
  lines.push(`- **처벌 근거**: ${doc.penaltyOnMissing}`);
  if (doc.koshaGuideRef && doc.koshaGuideRef.length > 0) {
    lines.push("");
    lines.push(`## 관련 KOSHA Guide`);
    lines.push("");
    for (const g of doc.koshaGuideRef) lines.push(`- ${g}`);
  }
  // sourceStatus 경고
  const ss = doc.sourceStatus?.keys ?? {};
  const pendings = Object.entries(ss).filter(([, v]) => v === "pending").map(([k]) => k);
  if (pendings.length > 0) {
    lines.push("");
    lines.push(`> ⚠️ 다음 키는 추가 검증 필요 (sourceStatus=pending): ${pendings.join(", ")}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      docId: doc.docId,
      title: doc.title,
      submitTo: doc.submitTo,
      submitDeadline: doc.submitDeadline,
      electronicSubmission: doc.electronicSubmission,
      retention: doc.retention,
      nextDueRule: doc.nextDueRule,
      penaltyOnMissing: doc.penaltyOnMissing,
      koshaGuideRef: doc.koshaGuideRef ?? [],
      sourceStatus: ss,
      nextActions: [
        `\`get_safety_document_guide({docId: "${doc.docId}"})\` — 작성 가이드`,
        `\`generate_safety_document({docId: "${doc.docId}", useProfile: true})\` — 초안 생성`,
        `\`get_retention_status({docId: "${doc.docId}", compileDate: "YYYY-MM-DD"})\` — 보관·갱신 추적`,
      ],
    },
  };
}

export const getSubmissionInfoTool: ToolDefinition = {
  name: "get_submission_info",
  title: "법정문서 제출 정보 조회",
  description:
    "법정문서의 제출처·마감·전자제출 URL·보관기간을 조회한다. 라이프사이클 §1.5 제출 단계. 마스터 SSoT 기반.",
  inputSchema,
  handler,
};
