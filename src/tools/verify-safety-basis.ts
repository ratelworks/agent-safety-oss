import { resolveCitation, resolveReference, type CitationOutcome } from "../lib/citation-resolver.js";
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  EvidenceItemSchema,
  BASIS_TYPES,
  type EvidenceItemT,
} from "../evidence/evidence.schema.js";
import { BASIS_WEIGHT_MAP } from "../config/constants.js";
import { stringBool } from "../lib/zod-helpers.js";

// 파일 최상단 상수 — verification status 코드
const STATUS = {
  SUPPORTED: "supported",
  PARTIAL: "partial",
  UNSUPPORTED: "unsupported",
  INVALID: "invalid",
} as const;

// 환각 / 미검출 마커
// 응답 텍스트 첫 줄에 부착하여 LLM 이 "검증 성공"으로 오해하는 것을 차단
const MARKER_HALLUCINATION = "[HALLUCINATION_DETECTED]";
const MARKER_NOT_FOUND = "[NOT_FOUND]";
const MARKER_INLINE_CITATION = "[INLINE_CITATION_WARNING]";

// 본문 인라인 법령 인용 추출 정규식 (korean-law-mcp verify_citations 패턴 차용)
// evidence 배열을 첨부하지 않고 claim 본문에 "산안기준규칙 제38조" 처럼 인라인으로 쓴
// 법령 인용을 자동 추출 → 번들 조문 대조. evidence-기반 검증의 사각지대(LLM 이 근거를
// 구조화하지 않고 본문에 흘려 쓴 가짜 조문)를 메운다.
//   그룹1: 법령명("산안기준규칙" / "산업안전보건법" 등)
//   그룹2: 제N조의 N      그룹3: 제N조의 M 의 M
//   그룹4: §N 의 N        그룹5: §N 의 M
const INLINE_CITATION_REGEX =
  /([가-힣][가-힣·ㆍ\s]{0,20}?(?:법|규칙|시행령|시행규칙|고시|규정))\s*(?:제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|§\s*(\d+)(?:\s*의\s*(\d+))?)/g;

// 기본 mandatory trigger — claim 에 포함되면 법령·규정 근거 필요
// 교차 검증 지적 반영: "필수", "필요", "위반 시", "과태료" 추가
const DEFAULT_MANDATORY_TRIGGERS = [
  "의무",
  "반드시",
  "필수",
  "필요",
  "금지",
  "법적",
  "법령",
  "해야 한다",
  "해야한다",
  "하여야 한다",
  "하여야한다",
  "위반",
  "위반 시",
  "과태료",
  "처벌",
];

const inputSchema = z.object({
  claims: z
    .array(
      z.object({
        claim: z.string().min(1),
        evidence: z.array(EvidenceItemSchema).default([]),
      }),
    )
    .min(1)
    .describe("검증할 안전관리 결론 목록 (claim + 첨부 evidence)"),
  requireMandatoryFor: z
    .array(z.string())
    .optional()
    .describe(
      `claim 에 포함 시 mandatory 근거 필수인 trigger 문자열 배열. 미지정 시 기본 trigger(${DEFAULT_MANDATORY_TRIGGERS.join(", ")}) 사용`,
    ),
  useDefaultMandatoryTriggers: stringBool
    .optional()
    .default(true)
    .describe(
      "기본 trigger 자동 포함 여부. requireMandatoryFor 를 같이 주면 기본값과 합쳐진다. false 면 기본 trigger 미적용",
    ),
  allowRecommendedAsBasis: stringBool
    .optional()
    .default(false)
    .describe(
      "true 면 mandatory(법령) 근거가 없어도 recommended(KOSHA Guide) 근거가 있으면 partial 로 완화. 법령 조회 Tool 미제공 환경 보조. 기본 false (엄격).",
    ),
  verifyReferenceExistence: stringBool
    .optional()
    .default(true)
    .describe(
      "true (기본) 면 basisType=law|regulation 인 evidence 의 reference 가 번들된 법령 조문에 실존하는지 대조. false 면 등급 정합성만 체크 (구버전 호환).",
    ),
});

type Input = z.infer<typeof inputSchema>;

interface RefCheck {
  reference: string;
  /** confirmed=수록 자료에 있음 / not_found=전 조문 수록 법령에 없는 조문 / unverifiable=수록 범위 밖이라 확인 불가 */
  outcome: CitationOutcome;
  /** outcome === "confirmed" 와 같다 (이전 응답 형식 유지) */
  exists: boolean;
  matched?: string;
  reason?: string;
}

// 본문 인라인 인용 검증 결과
interface InlineCitationCheck {
  raw: string; // 매칭 원문 (예: "산안기준규칙 제38조")
  lawPart: string; // 추출된 법령명 (예: "산안기준규칙")
  ref: string; // 정규화된 조문 (예: "§38")
  outcome: CitationOutcome;
  inBundle: boolean; // 확인 가능한 범위인가 (false=수록 범위 밖, 판정 보류) — outcome !== "unverifiable"
  exists: boolean; // 수록 자료에 실존하는가 — outcome === "confirmed"
  matched?: string;
  reason?: string;
}

interface ClaimVerdict {
  claim: string;
  status: (typeof STATUS)[keyof typeof STATUS];
  reasons: string[];
  highestWeight: "mandatory" | "recommended" | "reference" | "none";
  matchedTriggers: string[];
  refChecks: RefCheck[];
  hallucinationCount: number;
  /** 수록 범위 밖이라 실존을 확인하지 못한 근거 수 — 틀렸다는 뜻이 아니다 */
  unverifiableCount: number;
  // 본문 인라인 인용 검증 — evidence 와 독립. 번들 법령으로 식별됐으나 조문이 번들에 미수록이면 flag.
  // false positive 여지(법령명↔조문 휴리스틱 + 번들=건설안전 발췌라 실존 조문 누락 가능)가 있어
  // status/isError 판정에는 미반영, 경고·nextAction 으로만 노출 (100% 하위 호환). 미수록≠환각.
  inlineCitations: InlineCitationCheck[];
  inlineUnresolvedCount: number;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const triggers = buildTriggers(input);
  const verdicts: ClaimVerdict[] = [];
  for (const c of input.claims) {
    verdicts.push(
      await verifyClaim(
        c.claim,
        c.evidence,
        triggers,
        input.allowRecommendedAsBasis === true,
        input.verifyReferenceExistence !== false,
      ),
    );
  }

  const summary = {
    total: verdicts.length,
    supported: verdicts.filter((v) => v.status === STATUS.SUPPORTED).length,
    partial: verdicts.filter((v) => v.status === STATUS.PARTIAL).length,
    unsupported: verdicts.filter((v) => v.status === STATUS.UNSUPPORTED).length,
    invalid: verdicts.filter((v) => v.status === STATUS.INVALID).length,
    hallucinationCount: verdicts.reduce((s, v) => s + v.hallucinationCount, 0),
    unverifiableCount: verdicts.reduce((s, v) => s + v.unverifiableCount, 0),
    // 본문 인라인 인용 환각 — evidence 기반 hallucinationCount 와 별개 집계 (status 미반영)
    inlineUnresolvedCount: verdicts.reduce(
      (s, v) => s + v.inlineUnresolvedCount,
      0,
    ),
  };

  // 다음 행동 제안 — 환각·부분지원·미지원 케이스별 맞춤 검색 도구 추천
  const nextActions: string[] = [];
  if (summary.hallucinationCount > 0) {
    nextActions.push(
      "search_safety_laws({keyword}) 로 정확한 조문 재검색 후 재제출",
      "조문 번호와 법령명을 다시 확인 — 산안법·시행령·시행규칙·기준규칙·중처법·중처법 시행령·위험성평가 고시는 전 조문이 수록돼 있음",
    );
  }
  if (summary.unverifiableCount > 0) {
    nextActions.push(
      "수록 범위 밖 법령 인용이 있음 — 틀렸다는 뜻이 아니라 이 도구의 자료로 확인하지 못했다는 뜻. 법제처 원문으로 실존을 확인할 것 (verdicts[].refChecks 의 outcome: unverifiable)",
    );
  }
  if (summary.inlineUnresolvedCount > 0) {
    nextActions.push(
      "본문에 evidence 없이 쓴 법령 인용 중 전 조문 수록 법령에 없는 조문이 있음 — 조문 번호를 다시 확인 (verdicts[].inlineCitations 의 outcome: not_found)",
    );
  }
  if (summary.unsupported > 0) {
    nextActions.push(
      "compile_safety_references({workType, docType}) 로 관련 법령·KOSHA 자료 묶음 받기",
    );
  }
  if (summary.partial > 0 && !input.allowRecommendedAsBasis) {
    nextActions.push(
      "allowRecommendedAsBasis: true 로 KOSHA Guide(recommended) 근거까지 허용 가능 (단, 법령 근거가 더 권장됨)",
    );
  }

  const payload = {
    summary,
    // 이 도구가 확인하는 범위 — 인용이 주장을 실제로 뒷받침하는지는 보지 않는다
    scope: {
      checked: ["근거 종류와 강제 수준의 정합", "인용 조문의 실존(수록 자료 대조)", "의무 표현에 법령·규정 근거가 붙었는지"],
      notChecked: "인용한 조문의 내용이 주장을 뒷받침하는지 — refChecks[].matched 의 조문 제목을 보고 사람이 판단",
    },
    verdicts,
    effectiveTriggers: triggers,
    policy: {
      allowRecommendedAsBasis: input.allowRecommendedAsBasis === true,
      useDefaultMandatoryTriggers: input.useDefaultMandatoryTriggers !== false,
      verifyReferenceExistence: input.verifyReferenceExistence !== false,
    },
    nextActions,
  };

  // 응답 텍스트 — 환각 발견 시 마커 첫 줄 부착
  const isHallucination = summary.hallucinationCount > 0;
  const isUnsupported = summary.invalid > 0 || summary.unsupported > 0;
  const headerLines: string[] = [];
  if (isHallucination) {
    headerLines.push(
      `${MARKER_HALLUCINATION} 환각 인용 ${summary.hallucinationCount}건 검출 — 전 조문이 수록된 법령에 없는 조문이거나 reference 가 비어 있음. LLM 은 추측·생성 금지하고 search_safety_laws 로 재검증할 것.`,
    );
  } else if (summary.unsupported > 0) {
    headerLines.push(
      `${MARKER_NOT_FOUND} 근거 부족 claim ${summary.unsupported}건 — mandatory trigger 가 포함된 claim 에 법령·규정 근거가 없거나 evidence 자체가 비어있음.`,
    );
  }
  // 인라인 인용 경고는 evidence 기반 판정과 독립 — isError/status 에 영향 없이 추가 노출
  if (summary.inlineUnresolvedCount > 0) {
    headerLines.push(
      `${MARKER_INLINE_CITATION} 본문에 쓴 법령 인용 ${summary.inlineUnresolvedCount}건이 전 조문 수록 법령에 없는 조문 — verdicts[].inlineCitations 의 outcome: not_found 항목의 조문 번호를 다시 확인할 것. (본문 인용은 법령명 추출이 어림이라 판정에는 반영하지 않음)`,
    );
  }
  const text =
    (headerLines.length > 0 ? headerLines.join("\n") + "\n\n" : "") +
    JSON.stringify(payload, null, 2);

  return {
    content: [{ type: "text", text }],
    structuredContent: payload,
    isError: isHallucination || isUnsupported ? true : undefined,
  } as McpToolResult;
}

function buildTriggers(input: Input): string[] {
  const extra = input.requireMandatoryFor ?? [];
  if (input.useDefaultMandatoryTriggers === false) return extra;
  // 합침 + 중복 제거 (순서는 기본 먼저)
  const merged = [...DEFAULT_MANDATORY_TRIGGERS, ...extra];
  return Array.from(new Set(merged));
}

// reference 실존 검증 — basisType 이 law|regulation 인 evidence 만
// 수록 자료(그래프의 조문·별표 노드)와 대조 — lib/citation-resolver.ts
async function checkRefExistence(ev: EvidenceItemT): Promise<RefCheck> {
  const reference = ev.reference ?? "";

  // 비법령 evidence 는 검증 대상 외
  if (ev.basisType !== "law" && ev.basisType !== "regulation") {
    return {
      reference,
      outcome: "confirmed",
      exists: true,
      reason: `basisType=${ev.basisType} 는 ref 실존 검증 대상 아님 (KOSHA Guide·재해사례·MSDS 등은 별도 Live API)`,
    };
  }

  if (!reference) {
    return {
      reference: "",
      outcome: "not_found",
      exists: false,
      reason: `basisType=${ev.basisType} 인데 reference 필드가 비어있음. 법령 인용은 reference 필수.`,
    };
  }

  try {
    const resolved = await resolveReference(reference);
    if (resolved.outcome === "confirmed") {
      return {
        reference,
        outcome: "confirmed",
        exists: true,
        matched: `${resolved.iri} ${resolved.title ?? ""}`.trim(),
        ...(resolved.detailNote ? { reason: resolved.detailNote } : {}),
      };
    }
    return { reference, outcome: resolved.outcome, exists: false, reason: resolved.reason };
  } catch (err) {
    return { reference, outcome: "unverifiable", exists: false, reason: `검증 중 오류: ${(err as Error).message}` };
  }
}

// claim 본문에서 인라인 법령 인용을 추출해 번들 조문과 대조.
// evidence 미첨부 사각지대 보완 — 번들 법령(산안법/기준규칙/중처법/건진법/위평고시)의
// 없는 조문을 본문에 쓴 경우만 환각 flag. 번들 외 법령은 대조 불가로 보류(false positive 방지).
async function checkInlineCitations(
  claim: string,
): Promise<InlineCitationCheck[]> {
  const checks: InlineCitationCheck[] = [];
  const seen = new Set<string>();

  for (const m of claim.matchAll(INLINE_CITATION_REGEX)) {
    const lawPart = m[1].trim().replace(/\s+/g, "");
    const artNo = m[2] ?? m[4]; // 제N조 | §N
    const subNo = m[3] ?? m[5]; // 의 M
    if (!artNo) continue;
    const ref = subNo ? `§${artNo}의${subNo}` : `§${artNo}`;
    const key = `${lawPart}|${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const raw = m[0].trim().replace(/\s+/g, " ");

    const resolved = await resolveCitation(m[1].trim(), ref);
    checks.push({
      raw,
      lawPart,
      ref,
      outcome: resolved.outcome,
      inBundle: resolved.outcome !== "unverifiable",
      exists: resolved.outcome === "confirmed",
      ...(resolved.outcome === "confirmed" ? { matched: `${resolved.iri} ${resolved.title ?? ""}`.trim() } : { reason: resolved.reason }),
    });
  }
  return checks;
}

async function verifyClaim(
  claim: string,
  evidence: EvidenceItemT[],
  mandatoryTriggers: string[],
  allowRecommendedAsBasis: boolean,
  verifyReferenceExistence: boolean,
): Promise<ClaimVerdict> {
  const reasons: string[] = [];

  // 근거 등급 정합성 확인
  for (const ev of evidence) {
    const expected = BASIS_WEIGHT_MAP[ev.basisType];
    if (expected !== ev.legalWeight) {
      reasons.push(
        `evidence basisType=${ev.basisType} 의 표준 legalWeight는 ${expected} 인데 ${ev.legalWeight} 로 선언됨`,
      );
    }
    if (!BASIS_TYPES.includes(ev.basisType)) {
      reasons.push(`unknown basisType=${ev.basisType}`);
    }
  }

  // ref 실존 검증 (P0 — 환각 차단). 증거 별 병렬 조회.
  let refChecks: RefCheck[] = [];
  let hallucinationCount = 0;
  let unverifiableCount = 0;
  if (verifyReferenceExistence) {
    refChecks = await Promise.all(evidence.map(checkRefExistence));
    for (let i = 0; i < refChecks.length; i += 1) {
      const ev = evidence[i];
      const check = refChecks[i];
      if (ev.basisType !== "law" && ev.basisType !== "regulation") continue;
      if (check.outcome === "not_found") {
        hallucinationCount += 1;
        reasons.push(
          `[HALLUCINATION] reference='${check.reference}' — ${check.reason}`,
        );
      } else if (check.outcome === "unverifiable") {
        unverifiableCount += 1;
        reasons.push(`[UNVERIFIED] reference='${check.reference}' — ${check.reason}`);
      }
    }
  }

  // 강제 trigger 검사
  const matchedTriggers = mandatoryTriggers.filter((t) => claim.includes(t));
  const needsMandatory = matchedTriggers.length > 0;
  const hasMandatory = evidence.some((e) => e.legalWeight === "mandatory");
  const hasRecommended = evidence.some((e) => e.legalWeight === "recommended");

  if (needsMandatory && !hasMandatory) {
    const base = `claim 에 trigger(${matchedTriggers.join(",")}) 가 포함되었으나 mandatory(법령·규정) 근거가 없음`;
    if (allowRecommendedAsBasis && hasRecommended) {
      reasons.push(
        `${base}. allowRecommendedAsBasis=true 적용으로 recommended 근거로 완화 검증.`,
      );
    } else {
      reasons.push(base);
    }
  }

  const highest = evidence.reduce<
    "mandatory" | "recommended" | "reference" | "none"
  >((acc, e) => rankWeight(acc, e.legalWeight), "none");

  let status: (typeof STATUS)[keyof typeof STATUS];
  if (hallucinationCount > 0) {
    // 환각 발견 시 무조건 invalid — 등급 정합성과 무관
    status = STATUS.INVALID;
  } else if (evidence.length === 0) {
    status = STATUS.UNSUPPORTED;
    reasons.push("첨부된 evidence 가 없음");
  } else if (reasons.length === 0) {
    status = STATUS.SUPPORTED;
  } else if (needsMandatory && !hasMandatory) {
    status =
      allowRecommendedAsBasis && hasRecommended
        ? STATUS.PARTIAL
        : STATUS.UNSUPPORTED;
  } else {
    status = STATUS.PARTIAL;
  }

  // 본문 인라인 인용 검증 — status 확정 후 계산하여 reasons/status/isError 에 영향 없음.
  // (법령명↔조문 휴리스틱 연결의 false positive 가 기존 evidence 판정을 흔들지 않도록 분리)
  let inlineCitations: InlineCitationCheck[] = [];
  let inlineUnresolvedCount = 0;
  if (verifyReferenceExistence) {
    inlineCitations = await checkInlineCitations(claim);
    inlineUnresolvedCount = inlineCitations.filter(
      (c) => c.inBundle && !c.exists,
    ).length;
  }

  return {
    claim,
    status,
    reasons,
    highestWeight: highest,
    matchedTriggers,
    refChecks,
    hallucinationCount,
    unverifiableCount,
    inlineCitations,
    inlineUnresolvedCount,
  };
}

function rankWeight(
  acc: "mandatory" | "recommended" | "reference" | "none",
  next: "mandatory" | "recommended" | "reference",
): "mandatory" | "recommended" | "reference" | "none" {
  const order: Record<string, number> = {
    none: 0,
    reference: 1,
    recommended: 2,
    mandatory: 3,
  };
  return order[next] > order[acc] ? next : acc;
}

export const verifySafetyBasisTool: ToolDefinition = {
  name: "verify_safety_basis",
  title: "안전관리 근거 검증 (ref 실존 + 등급 정합성)",
  description:
    "LLM 이 생성한 안전관리 결론(claim)에 첨부된 근거(evidence)의 **(1) 등급 정합성**(basisType↔legalWeight) + **(2) reference 실존성**(번들 법령 55조문 대조) + **(3) mandatory trigger 검사**(의무/반드시/필수/금지/위반 등 포함 시 법령 근거 필수) + **(4) 본문 인라인 인용 검증**(evidence 를 첨부하지 않고 claim 본문에 '제38조'·'§38' 처럼 흘려 쓴 법령 인용을 자동 추출→번들 조문 대조. 번들 수록이면 확인됨, 미수록이면 `[INLINE_CITATION_WARNING]`) 을 점검. 환각 인용 발견 시 응답 첫 줄에 `[HALLUCINATION_DETECTED]` 마커 + isError:true 를 부착해 LLM 의 자가검열을 강제. **주의**: (4) 인라인 검증은 법령명↔조문 휴리스틱 + **번들이 건설안전 발췌(전체 법령 아님)** 라는 이중 한계로 false positive 여지가 있어 status/isError 에 미반영(경고 전용). 번들 미수록은 환각이 아니라 발췌 누락일 수 있으니 법제처 확인 필요. 번들 외 법령(inBundle:false)은 대조 보류. 의미론적 entailment(이 조문이 정말 이 주장에 적용되는가)는 검증하지 않음 — 인간 검토 필요. 법령 조회 Tool 미제공 환경에서는 allowRecommendedAsBasis=true 로 KOSHA Guide 근거까지 허용 가능.",
  inputSchema,
  handler,
};
