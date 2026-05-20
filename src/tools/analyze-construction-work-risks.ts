import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import subtaskData from "../ontology/construction-subtasks.json" with { type: "json" };
import hazardData from "../ontology/hazard-type.json" with { type: "json" };
import guideData from "../ontology/kosha-guide-map.json" with { type: "json" };
import sifData from "../ontology/sif-archive.json" with { type: "json" };
import worktypeFallback from "../ontology/construction-worktype.json" with { type: "json" };
import { KOSHA_GUIDE_DISCLAIMER } from "../config/constants.js";
import { stringBool } from "../lib/zod-helpers.js";

// 파일 최상단 상수 — 공종 매칭 모드 및 스코어
const MATCH = { CODE: "code", KEYWORD: "keyword", TOKEN: "token" } as const;

// 행위 토큰 — 같은 대상 공종 안에서 "조립/해체" 같은 동작을 구분하게 함
const ACTION_TOKENS = [
  "조립",
  "해체",
  "설치",
  "철거",
  "타설",
  "인양",
  "양중",
  "배근",
  "시공",
  "청소",
  "정비",
  "용접",
];

const SCORE = {
  EXACT_CODE: 100,
  EXACT_NAME: 80,
  ACTION_MATCH: 40,
  PARTIAL_NAME: 20,
};

// 두 점수 이상 차이 안 나면 모호 매치로 간주
const AMBIGUITY_THRESHOLD = 10;

const inputSchema = z.object({
  workType: z
    .string()
    .describe(
      "건설 공종/세부공정. 코드(FORMWORK_DISMANTLE) 또는 한글 키워드('거푸집 해체') 모두 허용",
    ),
  siteType: z.string().optional().describe("현장 유형 (예: '소규모 건축공사')"),
  conditions: z
    .object({
      heightWork: stringBool.optional(),
      foreignWorkers: stringBool.optional(),
      weather: z.string().optional(),
      nightWork: stringBool.optional(),
    })
    .optional()
    .describe("가중치 반영 조건 — boolean 은 'true'/'false'/1/0 등 literal 만 허용"),
});

type Input = z.infer<typeof inputSchema>;

interface Subtask {
  code: string;
  ko: string;
  mainHazards: string[];
}
interface MainCategory {
  code: string;
  ko: string;
  subtasks: Subtask[];
}
interface HazardType {
  code: string;
  ko: string;
  domains: string[];
}
interface Guide {
  guideCode: string;
  title: string;
  domain: string;
  relatedWorkTypes?: string[];
  relatedHazards?: string[];
}
interface SifPattern {
  workType: string;
  hazardCode: string;
  rootCauses: string[];
  controls: string[];
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  // 공종 분류: KOSHA 공식(15087828) 이 비어 있으면 내부 fallback(MIT) 사용
  const officialCategories = (subtaskData.mainCategories ?? []) as MainCategory[];
  const usingFallbackTaxonomy = officialCategories.length === 0;
  const categories: MainCategory[] = usingFallbackTaxonomy
    ? adaptWorktypeFallback()
    : officialCategories;

  const hazards = hazardData.hazards as HazardType[];
  const guides = (guideData.guides ?? []) as Guide[];
  const sifPatterns = (sifData.patterns ?? []) as SifPattern[];

  const matchResult = matchSubtask(categories, input.workType);
  if (!matchResult) {
    const payload = {
      query: input,
      matched: null,
      available: flattenSubtasks(categories).map((s) => ({ code: s.code, ko: s.ko })),
      message:
        "workType 에 해당하는 공종/세부공정을 찾지 못했다. list_construction_subtasks 로 전체 목록 확인.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }
  const matched = matchResult.best;

  // 모호 매치 경고 — 상위 후보들이 점수 임계 내에 모여 있으면 사용자에게 알림
  const candidateList =
    matchResult.candidates.length > 1
      ? matchResult.candidates.map((c) => ({
          code: c.subtask.code,
          ko: c.subtask.ko,
          mainCategory: c.mainCategory.code,
          score: c.score,
          reason: c.reason,
        }))
      : undefined;
  const needsDisambiguation =
    matchResult.candidates.length > 1 &&
    matchResult.candidates[0].score - matchResult.candidates[1].score < AMBIGUITY_THRESHOLD;

  const hazardLookup = new Map(hazards.map((h) => [h.code, h]));
  const hazardList = matched.subtask.mainHazards
    .map((c) => hazardLookup.get(c))
    .filter((h): h is HazardType => Boolean(h));

  const cond = input.conditions ?? {};
  const weighted = hazardList.map((h) => ({
    code: h.code,
    ko: h.ko,
    riskLevel: computeRiskLevel(h.code, cond),
  }));

  // 관련 KOSHA Guide
  const relatedGuides = guides.filter(
    (g) =>
      g.domain === "construction" &&
      (g.relatedWorkTypes?.includes(matched.subtask.code) ||
        hazardList.some((h) => g.relatedHazards?.includes(h.code))),
  );

  // SIF 아카이브 패턴 매칭 (공종 키워드 기반)
  const subtaskKoLower = matched.subtask.ko.toLowerCase();
  const sifMatches = sifPatterns.filter((p) => {
    const wt = p.workType.toLowerCase();
    const hazardOverlap = hazardList.some((h) => h.code === p.hazardCode);
    const workOverlap = wt.includes(subtaskKoLower) || subtaskKoLower.includes(wt);
    return hazardOverlap && workOverlap;
  });

  const payload = {
    query: input,
    matched: {
      mode: matched.mode,
      mainCategory: { code: matched.mainCategory.code, ko: matched.mainCategory.ko },
      subtask: { code: matched.subtask.code, ko: matched.subtask.ko },
      score: matched.score,
      reason: matched.reason,
    },
    ...(candidateList
      ? { matchedCandidates: candidateList, needsDisambiguation }
      : {}),
    hazards: weighted,
    sifPatterns: sifMatches.map((p) => ({
      workType: p.workType,
      hazardCode: p.hazardCode,
      rootCauses: p.rootCauses,
      controls: p.controls,
      basisType: "statistics",
      legalWeight: "reference",
    })),
    relatedKoshaGuides: relatedGuides.map((g) => ({
      guideCode: g.guideCode,
      title: g.title,
      legalWeight: "recommended" as const,
      basisType: "kosha_guide" as const,
    })),
    checklistHints: buildChecklistHints(matched.subtask, weighted, cond, sifMatches),
    disclaimer: KOSHA_GUIDE_DISCLAIMER,
    degradedMode: usingFallbackTaxonomy
      ? {
          reason:
            "공식 공종 분류(15087828)와 KOSHA Guide 매핑(15116595), SIF 아카이브(15140383)가 번들에 비어 있어, 프로젝트 내부 fallback taxonomy(MIT)로 대체했다.",
          missing: [
            ...(officialCategories.length === 0 ? ["construction-subtasks (15087828)"] : []),
            ...(guides.length === 0 ? ["kosha-guide-map (15116595)"] : []),
            ...(sifPatterns.length === 0 ? ["sif-archive (15140383)"] : []),
          ],
          howToResolve:
            "npm run sync-kosha 로 공식 데이터를 로드하면 KOSHA 공식 매핑과 SIF 패턴이 응답에 포함된다.",
        }
      : undefined,
    nextSteps: [
      "search_construction_fatal_accidents: 최근 중대재해 실사례 보강",
      "search_accident_cases: 업종·키워드 기반 유사 사례",
      "get_accident_case_attachments: 재해사례 이미지·도면",
      "get_kosha_guide_md: 번들 KOSHA Guide 본문 (1,039건, keyless)",
      "search_ppe_certification: 필요 보호구 인증 모델",
      "verify_safety_basis: 생성 결과 근거 정합성 검증",
    ],
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

interface SubtaskCandidate {
  mainCategory: MainCategory;
  subtask: Subtask;
  score: number;
  mode: (typeof MATCH)[keyof typeof MATCH];
  reason: string;
}

function scoreSubtask(
  query: string,
  qLower: string,
  queryActionTokens: string[],
  mainCategory: MainCategory,
  subtask: Subtask,
): SubtaskCandidate | null {
  // 1) 정확 코드 매칭
  if (subtask.code === query) {
    return {
      mainCategory,
      subtask,
      score: SCORE.EXACT_CODE,
      mode: MATCH.CODE,
      reason: "exact code match",
    };
  }

  const nameLower = subtask.ko.toLowerCase();

  // 2) 정확한 한글 명칭 매칭
  if (nameLower === qLower) {
    return {
      mainCategory,
      subtask,
      score: SCORE.EXACT_NAME,
      mode: MATCH.KEYWORD,
      reason: "exact Korean name match",
    };
  }

  // 3) 부분 명칭 매칭 기본 점수
  const nameOverlap = nameLower.includes(qLower) || qLower.includes(nameLower);
  if (!nameOverlap) return null;

  let score = SCORE.PARTIAL_NAME;
  const reasons: string[] = ["partial name overlap"];

  // 4) 행위 토큰 매치 보너스 — 쿼리에 '해체' 있고 후보 이름에도 '해체' 있을 때
  const subtaskActionTokens = ACTION_TOKENS.filter((t) => subtask.ko.includes(t));
  const commonActions = queryActionTokens.filter((t) => subtaskActionTokens.includes(t));
  if (commonActions.length > 0) {
    score += SCORE.ACTION_MATCH;
    reasons.push(`action token match: ${commonActions.join(",")}`);
  }

  return {
    mainCategory,
    subtask,
    score,
    mode: commonActions.length > 0 ? MATCH.TOKEN : MATCH.KEYWORD,
    reason: reasons.join(" + "),
  };
}

function matchSubtask(
  categories: MainCategory[],
  query: string,
): { best: SubtaskCandidate; candidates: SubtaskCandidate[] } | null {
  const q = query.trim();
  const qLower = q.toLowerCase();
  const queryActionTokens = ACTION_TOKENS.filter((t) => q.includes(t));

  const scored: SubtaskCandidate[] = [];
  for (const c of categories) {
    for (const s of c.subtasks) {
      const res = scoreSubtask(q, qLower, queryActionTokens, c, s);
      if (res) scored.push(res);
    }
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  // 상위 5개까지만 candidate 로 반환 (너무 많으면 오염)
  const topCandidates = scored.slice(0, 5);
  return { best: topCandidates[0], candidates: topCandidates };
}

function flattenSubtasks(categories: MainCategory[]): Subtask[] {
  return categories.flatMap((c) => c.subtasks);
}

// 공식 공종 분류(construction-subtasks.json, 15087828) 가 비어 있을 때
// 내부 간이 분류(construction-worktype.json, MIT) 를 MainCategory 형식으로 변환.
// 사용자 입장에선 interface 동일하게 유지하면서 degraded mode 로 동작.
function adaptWorktypeFallback(): MainCategory[] {
  const workTypes = (worktypeFallback as any).workTypes ?? [];
  return [
    {
      code: "GENERAL",
      ko: "일반 (프로젝트 내부 분류)",
      subtasks: workTypes.map((w: any) => ({
        code: w.code,
        ko: w.ko,
        mainHazards: w.mainHazards ?? [],
      })),
    },
  ];
}

function computeRiskLevel(
  code: string,
  cond: { heightWork?: boolean; foreignWorkers?: boolean; weather?: string; nightWork?: boolean },
): "high" | "medium" | "low" {
  let score = 1;
  if (code === "FALL" && cond.heightWork) score += 2;
  if (code === "FALL" && cond.weather && /강풍|우천|폭우/.test(cond.weather)) score += 1;
  if (["COLLAPSE", "CRUSHED", "SUFFOCATION", "ELECTRIC", "FIRE_EXPLOSION"].includes(code)) score += 1;
  if (cond.foreignWorkers) score += 1;
  if (cond.nightWork) score += 1;
  if (score >= 3) return "high";
  if (score === 2) return "medium";
  return "low";
}

function buildChecklistHints(
  sub: Subtask,
  hazards: Array<{ code: string; ko: string; riskLevel: string }>,
  cond: { foreignWorkers?: boolean; weather?: string },
  sifMatches: SifPattern[],
): string[] {
  const hints: string[] = [
    `${sub.ko} 작업 시작 전 TBM 실시`,
    "작업 구역 출입통제 및 신호체계 확인",
  ];
  if (hazards.some((h) => h.code === "FALL")) hints.push("안전대 부착설비·추락방호망·작업발판 고정 상태 점검");
  if (hazards.some((h) => h.code === "COLLAPSE")) hints.push("가설구조물·동바리·흙막이 지보공 변위 확인");
  if (hazards.some((h) => h.code === "STRUCK_BY")) hints.push("상·하부 동시작업 금지, 낙하물 방지조치 확인");
  if (hazards.some((h) => h.code === "ELECTRIC")) hints.push("LOTO 실시 및 검전기 사용 확인");
  if (hazards.some((h) => h.code === "SUFFOCATION")) hints.push("산소·유해가스 측정 및 감시인 배치");
  if (cond.foreignWorkers)
    hints.push("외국인 근로자 대상 모국어 자료 사전 배포 및 이해도 확인");
  if (cond.weather && /강풍|우천|폭우|강설/.test(cond.weather))
    hints.push(`기상 조건(${cond.weather}) 기준 작업 중지 기준 사전 공유`);

  // SIF 에서 나온 대표 controls 상위 3개 추가 (중복 제거)
  const sifControls = new Set<string>();
  for (const p of sifMatches) {
    for (const c of p.controls) {
      sifControls.add(c);
      if (sifControls.size >= 3) break;
    }
    if (sifControls.size >= 3) break;
  }
  for (const c of sifControls) hints.push(`[SIF] ${c}`);

  return hints;
}

export const analyzeConstructionWorkRisksTool: ToolDefinition = {
  name: "analyze_construction_work_risks",
  title: "건설 공종 위험요인 분석",
  description:
    "건설 세부공정 기준으로 표준 공종 분류(15087828), hazard taxonomy, KOSHA Guide 매핑, SIF 아카이브 패턴(15140383)을 조합해 위험요인·위험등급·체크리스트·근본원인·저감대책·관련 지침·다음 단계 Tool 제안까지 통합 반환한다. TBM/위험성평가 체인의 시작점.",
  inputSchema,
  handler,
};
