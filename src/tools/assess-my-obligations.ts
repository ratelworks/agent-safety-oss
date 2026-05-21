/**
 * assess_my_obligations
 *
 * 사업장 프로파일을 기준으로 94종 법정의무문서 중 적용 의무를 진단한다.
 * docs/LEGAL-DUTY-LIFECYCLE.md §1.1 인식(Awareness) 단계.
 *
 * 입력: siteId 선택 (미지정 시 profile.jsonld 첫 번째 사업장)
 * 출력: 적용 의무 N종 + 각 의무의 작성주기 / 제출처 / 마감 / 보관 / 다음 작성일
 *
 * 적용 판정:
 *   - "전 사업장"          → applies
 *   - "50인 이상" + 인원   → 매칭
 *   - "건설업 50억 이상"   → 업종 + 도급금액
 *   - 매칭 불확실          → depends_on_review
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { loadProfile } from "../lib/site-profile.js";
import { loadMaster } from "../lib/master-loader.js";
// Issue #6 lateral (2026-05-22) — industry 자연어 alias
import { aliasedEnum, INDUSTRY_ALIASES } from "../lib/input-aliases.js";

type Verdict = "applies" | "likely_applies" | "likely_excludes" | "depends_on_review";

interface SiteFacts {
  industry?: string;
  industryCode?: string;
  workforce?: number;
  contractAmount?: number; // 단위: 원
  isConstruction?: boolean;
  hasContractor?: boolean;
}

function evaluateApplicability(scope: string, facts: SiteFacts): { verdict: Verdict; reason: string } {
  const s = scope.trim();
  if (!s) return { verdict: "depends_on_review", reason: "applicableScope 정의 부재" };

  if (s === "전 사업장" || /전\s*사업장/.test(s)) {
    return { verdict: "applies", reason: "전 사업장 적용" };
  }

  // 50인 이상 / 100인 이상 / N인 이상 패턴
  const workforceMatch = s.match(/(\d+)\s*인\s*이상/);
  if (workforceMatch && facts.workforce !== undefined) {
    const threshold = Number(workforceMatch[1]);
    if (facts.workforce >= threshold) {
      return { verdict: "applies", reason: `상시근로자 ${facts.workforce}명 ≥ ${threshold}명 기준` };
    }
    return { verdict: "likely_excludes", reason: `상시근로자 ${facts.workforce}명 < ${threshold}명 기준` };
  }

  // 건설업 50억 이상 패턴
  if (/건설/.test(s) && /(\d+)\s*억\s*이상/.test(s)) {
    const m = s.match(/(\d+)\s*억\s*이상/);
    const threshold = Number(m![1]) * 100_000_000;
    if (facts.isConstruction === false) {
      return { verdict: "likely_excludes", reason: "건설업 아님" };
    }
    if (facts.contractAmount !== undefined) {
      if (facts.contractAmount >= threshold) {
        return {
          verdict: "applies",
          reason: `건설업 도급금액 ${(facts.contractAmount / 1e8).toFixed(1)}억 ≥ ${threshold / 1e8}억 기준`,
        };
      }
      return {
        verdict: "likely_excludes",
        reason: `건설업 도급금액 ${(facts.contractAmount / 1e8).toFixed(1)}억 < ${threshold / 1e8}억 기준`,
      };
    }
    return { verdict: "depends_on_review", reason: "건설업 여부·도급금액 미확인" };
  }

  // 도급 관련
  if (/도급/.test(s)) {
    if (facts.hasContractor === false) {
      return { verdict: "likely_excludes", reason: "도급 관계 없음" };
    }
    return { verdict: "depends_on_review", reason: `도급 조건 — 사용자 검토 필요: "${s}"` };
  }

  // N~M인 범위 / 한정업종 등
  if (/한정업종|특정업종|별표|업종/.test(s)) {
    return { verdict: "depends_on_review", reason: `업종·별표 조건 — 사용자 검토 필요: "${s}"` };
  }

  // 노사협의 / 자율 등
  if (/노사협의|자율|선택/.test(s)) {
    return { verdict: "depends_on_review", reason: `사업장 자체 결정 조건: "${s}"` };
  }

  return { verdict: "depends_on_review", reason: `룰 미매칭: "${s}"` };
}

function deriveSiteFacts(args: {
  siteId?: string;
  workforce?: number;
  contractAmount?: number;
  industry?: string;
  hasContractor?: boolean;
}): Promise<SiteFacts> {
  return loadProfile().then((profile) => {
    const site = args.siteId
      ? profile.sites.find((s) => s["@id"] === args.siteId)
      : profile.sites[0];
    const project = profile.projects.find((p) => (args.siteId ? p.site === args.siteId : true));

    const inferConstruction = (industry?: string, code?: string): boolean | undefined => {
      if (args.industry === "construction") return true;
      if (args.industry === "manufacturing" || args.industry === "service") return false;
      if (industry?.includes("건설") || code?.startsWith("F") || code?.startsWith("41") || code?.startsWith("42"))
        return true;
      if (project?.constructionType) return true;
      return undefined;
    };

    return {
      industry: args.industry,
      industryCode: site?.industryCode,
      workforce: args.workforce ?? site?.workerCountTotal,
      contractAmount: args.contractAmount ?? project?.contractAmount,
      isConstruction: inferConstruction(site?.industrySubCategory, site?.industryCode),
      hasContractor: args.hasContractor ?? profile.contractors.some((c) => (project ? c.project === project["@id"] : true)),
    };
  });
}

const inputSchema = z.object({
  siteId: z.string().optional().describe("프로파일의 사업장 IRI (생략 시 첫 번째 사업장)"),
  workforce: z.number().int().min(0).optional().describe("상시근로자 수 (프로파일 override)"),
  contractAmount: z.number().min(0).optional().describe("도급금액 단위:원 (프로파일 override)"),
  industry: aliasedEnum(
    ["construction", "manufacturing", "service", "other"] as const,
    INDUSTRY_ALIASES,
  ).optional().describe("업종. 자연어 alias 허용: 건설/건축/토목→construction, 제조/공장→manufacturing, 서비스→service, 기타→other."),
  hasContractor: z.boolean().optional(),
  verdictFilter: z
    .array(z.enum(["applies", "likely_applies", "likely_excludes", "depends_on_review"]))
    .optional()
    .describe("출력 필터 (기본: applies + depends_on_review)"),
});


async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);
  const facts = await deriveSiteFacts(args);
  const master = loadMaster().documents;
  const targetVerdicts = new Set(args.verdictFilter ?? ["applies", "likely_applies", "depends_on_review"]);

  const evaluations = master.map((doc) => {
    const ev = evaluateApplicability(doc.applicableScope, facts);
    return {
      docId: doc.docId,
      title: doc.title,
      category: doc.category,
      verdict: ev.verdict,
      verdictReason: ev.reason,
      frequency: doc.frequency,
      applicableScope: doc.applicableScope,
      submitTo: doc.submitTo,
      submitDeadline: doc.submitDeadline,
      electronicSubmission: doc.electronicSubmission,
      retention: doc.retention,
      nextDueRule: doc.nextDueRule,
      penaltyOnMissing: doc.penaltyOnMissing,
    };
  });

  const filtered = evaluations.filter((e) => targetVerdicts.has(e.verdict));
  const groupedByCategory = filtered.reduce<Record<string, typeof filtered>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  const summary = {
    total: master.length,
    applies: evaluations.filter((e) => e.verdict === "applies").length,
    likelyApplies: evaluations.filter((e) => e.verdict === "likely_applies").length,
    likelyExcludes: evaluations.filter((e) => e.verdict === "likely_excludes").length,
    dependsOnReview: evaluations.filter((e) => e.verdict === "depends_on_review").length,
  };

  const lines: string[] = [];
  lines.push(`# 사업장 법정의무 진단`);
  lines.push("");
  lines.push(`**대상**: ${args.siteId ?? "(프로파일 첫 번째 사업장)"}`);
  lines.push(
    `**조건**: 상시근로자 ${facts.workforce ?? "?"}명 / 도급금액 ${facts.contractAmount !== undefined ? (facts.contractAmount / 1e8).toFixed(2) + "억" : "?"} / 건설업 ${facts.isConstruction === undefined ? "?" : facts.isConstruction ? "예" : "아니오"} / 도급관계 ${facts.hasContractor === undefined ? "?" : facts.hasContractor ? "예" : "아니오"}`,
  );
  lines.push("");
  lines.push(
    `**적용 의무 (전체 ${summary.total}종)**: applies ${summary.applies} · likely_applies ${summary.likelyApplies} · likely_excludes ${summary.likelyExcludes} · depends_on_review ${summary.dependsOnReview}`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  const verdictBadge: Record<Verdict, string> = {
    applies: "🟢 적용",
    likely_applies: "🟡 적용 가능성 높음",
    likely_excludes: "⚪ 비대상",
    depends_on_review: "🟠 검토 필요",
  };

  for (const [category, items] of Object.entries(groupedByCategory)) {
    lines.push(`## [${category}] ${items.length}종`);
    lines.push("");
    for (const it of items) {
      lines.push(`### ${verdictBadge[it.verdict]} — ${it.title}`);
      lines.push(`- **docId**: \`${it.docId}\``);
      lines.push(`- **판정 사유**: ${it.verdictReason}`);
      lines.push(`- **주기**: ${it.frequency} / **적용범위**: ${it.applicableScope}`);
      if (it.submitTo) lines.push(`- **제출**: ${it.submitTo} (마감: ${it.submitDeadline ?? "?"})`);
      if (it.electronicSubmission?.available) {
        lines.push(`- **전자제출**: ✅ ${it.electronicSubmission.url} (${it.electronicSubmission.system ?? ""})`);
      }
      lines.push(`- **보관**: ${it.retention} / **다음 작성**: ${it.nextDueRule ?? "?"}`);
      lines.push(`- **위반 처벌**: ${it.penaltyOnMissing}`);
      lines.push("");
    }
  }

  if (filtered.length === 0) {
    lines.push("*매칭된 의무가 없습니다. verdictFilter 를 넓혀 보세요.*");
  }

  const text = lines.join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      summary,
      facts,
      obligations: filtered,
      nextActions: [
        "각 의무 docId 로 `get_safety_document_guide` 호출 → 작성가이드·법령근거 확보",
        "`generate_safety_document(docId, useProfile=true)` 로 초안 생성",
        "`list_upcoming_duties` 로 30일 내 마감 임박 의무 확인 (구현 후)",
      ],
    },
  };
}

export const assessMyObligationsTool: ToolDefinition = {
  name: "assess_my_obligations",
  title: "사업장 법정의무 진단",
  description:
    "현재 등록된 사이트 프로파일을 기준으로 94종 법정의무문서 중 적용 의무를 진단한다. 인원·도급금액·업종·도급관계로 자동 평가하고, 매칭이 불확실한 항목은 'depends_on_review' 로 분류한다. 각 의무의 제출처·마감·보관·전자제출 URL 동시 출력. (라이프사이클 §1.1 인식 단계)",
  inputSchema,
  handler,
};
