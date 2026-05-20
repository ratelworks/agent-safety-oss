/**
 * harness-policy.ts — HarnessPolicy 정의·검출 (외부 평가 P0-6)
 *
 * 평가자 진단 (2026-05-19): profile.jsonld 의 4 HarnessPolicy 가 선언만 되어 있고
 * 중앙 enforcement 가 없다. 도구별 분산 방어 (review_safety_document 의 hallucination
 * marker 등) 만 존재.
 *
 * v1.3.0 단계 1 (본 파일): 정의 + 검출 함수 + 메타 부착.
 * v1.3.x 단계 2 (다음 sprint): 모든 tool 응답 wrapping enforce.
 *
 * profile.jsonld 의 policy SSoT:
 *   - safety:policy/no_generated_legal_basis
 *   - safety:policy/cite_graph_sources
 *   - safety:policy/ask_missing_required_fields
 *   - safety:policy/human_fallback_threshold
 */
import type { McpToolResult } from "./types.js";

export type PolicyIRI =
  | "safety:policy/no_generated_legal_basis"
  | "safety:policy/cite_graph_sources"
  | "safety:policy/ask_missing_required_fields"
  | "safety:policy/human_fallback_threshold";

export type PolicySeverity = "blocker" | "warning" | "info";

export interface PolicyCheckResult {
  policy: PolicyIRI;
  severity: PolicySeverity;
  compliant: boolean;
  evidence: string;
  hint?: string;
}

export interface PolicyContext {
  toolName: string;
  /** structuredContent.legalBasis 또는 본문에서 추출한 IRI */
  legalBasisCited?: string[];
  /** graph traversal IRI (예: hazard:, control:, art:, doc:) 인용 여부 */
  graphSourcesCited?: string[];
  /** required field 누락 (사용자 자동 채움 금지) */
  missingRequiredFields?: string[];
  /** high-risk action 여부 (예: archive_safety_document) */
  isHighRiskAction?: boolean;
}

// mandatory trigger keywords — legalBasis 필수 표지
const MANDATORY_TRIGGERS = [
  "의무", "반드시", "필수", "위반 시", "과태료",
  "처벌", "벌칙", "벌금", "징역", "법적 책임",
  "준수해야", "이행해야", "지켜야", "금지된다",
  "제출해야",
];

/**
 * 본문 텍스트에서 mandatory trigger 키워드 검출.
 */
export function hasMandatoryTrigger(text: string): boolean {
  return MANDATORY_TRIGGERS.some((trigger) => text.includes(trigger));
}

/**
 * 본문/structured 에서 그래프 IRI 인용 검출.
 * prefix: art:, doc:, hazard:, control:, annex:, activity:, chapter:, kosha:
 */
export function extractGraphIris(text: string): string[] {
  const pattern = /\b(art|doc|hazard|control|annex|activity|chapter|kosha):[a-zA-Z0-9가-힣_\-\/]+/g;
  return Array.from(new Set(text.match(pattern) || []));
}

/**
 * 4 HarnessPolicy 검증.
 */
export function checkPolicies(
  result: McpToolResult,
  context: PolicyContext,
): PolicyCheckResult[] {
  const checks: PolicyCheckResult[] = [];
  const textContent = (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n");

  // Policy 1: no_generated_legal_basis
  // — mandatory trigger 가 있으면 legalBasis 인용 필수
  const hasMandatory = hasMandatoryTrigger(textContent);
  const hasLegalIris = textContent.match(/\bart:[가-힣A-Za-z0-9_\-]+:\d+/g);
  checks.push({
    policy: "safety:policy/no_generated_legal_basis",
    severity: "blocker",
    compliant: !hasMandatory || (hasLegalIris !== null && hasLegalIris.length > 0),
    evidence: hasMandatory
      ? `mandatory trigger 검출. legalBasis IRI ${hasLegalIris?.length ?? 0}개 인용`
      : `mandatory trigger 없음 — policy 적용 안됨`,
    hint: !hasMandatory || hasLegalIris
      ? undefined
      : "mandatory trigger 사용 시 art:{law}:{num} 형식 IRI 인용 필수",
  });

  // Policy 2: cite_graph_sources
  // — generate/review 도구 응답은 graph IRI 인용 필수
  const requiresCitation = ["generate_safety_document", "review_safety_document", "assemble_doc_context"].includes(
    context.toolName,
  );
  const graphIris = extractGraphIris(textContent);
  checks.push({
    policy: "safety:policy/cite_graph_sources",
    severity: "warning",
    compliant: !requiresCitation || graphIris.length > 0,
    evidence: requiresCitation
      ? `graph IRI ${graphIris.length}개 인용 (${graphIris.slice(0, 3).join(", ")}${graphIris.length > 3 ? "..." : ""})`
      : `generate/review 도구 아님 — policy 적용 안됨`,
    hint:
      requiresCitation && graphIris.length === 0
        ? "generate/review/assemble 응답은 art:·doc:·hazard:·control: IRI 인용 필수"
        : undefined,
  });

  // Policy 3: ask_missing_required_fields
  // — 필수 필드 누락 시 임의 채움 금지 (사용자에게 ask)
  const missing = context.missingRequiredFields ?? [];
  checks.push({
    policy: "safety:policy/ask_missing_required_fields",
    severity: "warning",
    compliant: missing.length === 0 || textContent.includes("[NEEDS_INPUT]") || textContent.includes("미입력"),
    evidence:
      missing.length > 0
        ? `누락 필드 ${missing.length}개 (${missing.slice(0, 3).join(", ")}). [NEEDS_INPUT] 마커 또는 '미입력' 명시 필요`
        : `누락 필드 0 — policy 적용 안됨`,
    hint:
      missing.length > 0 && !textContent.includes("[NEEDS_INPUT]")
        ? "누락 필드를 임의 채움 금지. [NEEDS_INPUT] 마커 또는 사용자에게 ask"
        : undefined,
  });

  // Policy 4: human_fallback_threshold
  // — high-risk action (archive_safety_document 등) 은 human approval 명시
  checks.push({
    policy: "safety:policy/human_fallback_threshold",
    severity: "info",
    compliant:
      !context.isHighRiskAction ||
      textContent.includes("human") ||
      textContent.includes("승인") ||
      textContent.includes("서명") ||
      textContent.includes("결재"),
    evidence: context.isHighRiskAction
      ? `high-risk action. human approval 표지 검출 여부 확인 필요`
      : `일반 action — policy 적용 안됨`,
    hint: context.isHighRiskAction
      ? "archive/submit 도구는 사용자 결재·서명·승인 명시 필요"
      : undefined,
  });

  return checks;
}

/**
 * tool 응답 metadata 에 policyCompliance 부착.
 * v1.3.0 단계 1 — detection only (enforcement 는 v1.3.x).
 */
export function attachPolicyMetadata(
  result: McpToolResult,
  context: PolicyContext,
): McpToolResult {
  const checks = checkPolicies(result, context);
  const violations = checks.filter((c) => !c.compliant);

  // structuredContent 에 부착
  const meta = result.structuredContent
    ? { ...result.structuredContent }
    : ({} as Record<string, unknown>);
  meta._harnessPolicy = {
    checks,
    violationCount: violations.length,
    blockerCount: violations.filter((v) => v.severity === "blocker").length,
  };

  // blocker 위반 시 응답 첫 줄에 [POLICY_VIOLATION] 마커 부착 (review_safety_document
  // 의 [HALLUCINATION_DETECTED] 와 같은 패턴)
  const blockerViolations = violations.filter((v) => v.severity === "blocker");
  let content = result.content || [];
  if (blockerViolations.length > 0 && content.length > 0 && content[0].type === "text") {
    const marker = `[POLICY_VIOLATION] ${blockerViolations.map((v) => v.policy).join(", ")}`;
    const hint = blockerViolations
      .map((v) => v.hint)
      .filter(Boolean)
      .join(" / ");
    content = [
      {
        ...content[0],
        text: `${marker}\n${hint ? `Hint: ${hint}\n\n` : "\n"}${(content[0] as { text: string }).text}`,
      },
      ...content.slice(1),
    ];
  }

  return {
    ...result,
    content,
    structuredContent: meta,
  };
}
