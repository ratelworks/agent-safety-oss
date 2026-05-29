import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  EvidenceItemSchema,
  BASIS_TYPES,
  type EvidenceItemT,
} from "../evidence/evidence.schema.js";
import { BASIS_WEIGHT_MAP } from "../config/constants.js";
import { stringBool } from "../lib/zod-helpers.js";
import { getArticle, listLaws } from "../lib/safety-laws-loader.js";

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
  exists: boolean;
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
  };

  // 다음 행동 제안 — 환각·부분지원·미지원 케이스별 맞춤 검색 도구 추천
  const nextActions: string[] = [];
  if (summary.hallucinationCount > 0) {
    nextActions.push(
      "search_safety_laws({keyword}) 로 정확한 조문 재검색 후 재제출",
      "list_core_safety_laws() 로 번들된 법령 6개·55조문 목록 확인",
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
      `${MARKER_HALLUCINATION} 환각 인용 ${summary.hallucinationCount}건 검출 — 번들된 법령 조문에 실존하지 않는 reference 가 포함됨. LLM 은 추측·생성 금지하고 search_safety_laws 로 재검증할 것.`,
    );
  } else if (summary.unsupported > 0) {
    headerLines.push(
      `${MARKER_NOT_FOUND} 근거 부족 claim ${summary.unsupported}건 — mandatory trigger 가 포함된 claim 에 법령·규정 근거가 없거나 evidence 자체가 비어있음.`,
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
// 번들된 6개 법령 55조문에서 getArticle() 매칭 시도
async function checkRefExistence(ev: EvidenceItemT): Promise<RefCheck> {
  const reference = ev.reference ?? "";

  // 비법령 evidence 는 검증 대상 외
  if (ev.basisType !== "law" && ev.basisType !== "regulation") {
    return {
      reference,
      exists: true,
      reason: `basisType=${ev.basisType} 는 ref 실존 검증 대상 아님 (KOSHA Guide·재해사례·MSDS 등은 별도 Live API)`,
    };
  }

  if (!reference) {
    return {
      reference: "",
      exists: false,
      reason: `basisType=${ev.basisType} 인데 reference 필드가 비어있음. 법령 인용은 reference 필수.`,
    };
  }

  try {
    const article = await getArticle(reference);
    if (article) {
      return {
        reference,
        exists: true,
        matched: `${article.lawShortName} ${article.ref} ${article.title}`,
      };
    }
    const lawList = listLaws()
      .map((l) => l.shortName)
      .join(", ");
    return {
      reference,
      exists: false,
      reason: `번들 법령(${lawList})에서 '${reference}' 조문을 찾을 수 없음. **환각(hallucination) 가능성**. search_safety_laws 또는 list_core_safety_laws 로 정확한 조문 재확인 권장. (단, 번들 미포함 법령일 수도 있으니 법제처 원문도 함께 확인.)`,
    };
  } catch (err) {
    return {
      reference,
      exists: false,
      reason: `검증 중 오류: ${(err as Error).message}`,
    };
  }
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
  if (verifyReferenceExistence) {
    refChecks = await Promise.all(evidence.map(checkRefExistence));
    for (let i = 0; i < refChecks.length; i += 1) {
      const ev = evidence[i];
      const check = refChecks[i];
      if (!check.exists && (ev.basisType === "law" || ev.basisType === "regulation")) {
        hallucinationCount += 1;
        reasons.push(
          `[HALLUCINATION] reference='${check.reference}' — ${check.reason}`,
        );
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

  return {
    claim,
    status,
    reasons,
    highestWeight: highest,
    matchedTriggers,
    refChecks,
    hallucinationCount,
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
    "LLM 이 생성한 안전관리 결론(claim)에 첨부된 근거(evidence)의 **(1) 등급 정합성**(basisType↔legalWeight) + **(2) reference 실존성**(번들 법령 55조문 대조) + **(3) mandatory trigger 검사**(의무/반드시/필수/금지/위반 등 포함 시 법령 근거 필수) 를 점검. 환각 인용 발견 시 응답 첫 줄에 `[HALLUCINATION_DETECTED]` 마커 + isError:true 를 부착해 LLM 의 자가검열을 강제. **주의**: 의미론적 entailment(이 조문이 정말 이 주장에 적용되는가)는 검증하지 않음 — 인간 검토 필요. 법령 조회 Tool 미제공 환경에서는 allowRecommendedAsBasis=true 로 KOSHA Guide 근거까지 허용 가능.",
  inputSchema,
  handler,
};
