import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  getArticle,
  listLaws,
  getLawHeaderMeta,
  type LawCode,
} from "../lib/safety-laws-loader.js";

// 파일 최상단 상수 — 특정 조문 원문 조회

const inputSchema = z.object({
  ref: z
    .string()
    .describe(
      "조문 참조 — 예: '산안법 §36', '§38', '산안기준규칙 §38', '중처법 §4', '산업안전보건법 시행규칙 §37'",
    ),
  lawCode: z
    .enum([
      "osha",
      "osha-decree",
      "osha-rule",
      "osha-standard",
      "severe-accident",
      "risk-assessment-notice",
    ])
    .optional()
    .describe("명시적 법령 코드 지정 (ref 에 법령명 없을 때)"),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const article = await getArticle(input.ref, input.lawCode as LawCode | undefined);

  if (!article) {
    const availableLaws = listLaws()
      .map((l) => `- ${l.shortName} (${l.code})`)
      .join("\n");
    const md = [
      `# 조문 조회 실패: "${input.ref}"`,
      "",
      "매칭되는 조문이 번들에 없습니다. 다음을 확인하세요:",
      "",
      "1. 법령명을 포함해서 재시도 (예: `산안법 §36`, `산안기준규칙 §38`)",
      "2. `search_safety_laws` 로 키워드 기반 검색",
      "3. 번들에 없는 조문은 법제처 원문 확인: https://www.law.go.kr",
      "",
      "## 번들된 법령 목록",
      "",
      availableLaws,
    ].join("\n");

    return {
      content: [{ type: "text", text: md }],
      structuredContent: {
        query: input,
        found: false,
        availableLaws: listLaws(),
      },
    };
  }

  // 법령 헤더 메타 조회 (검토 상태·기준일·출처 URL)
  const headerMeta = await getLawHeaderMeta(article.lawCode);

  const statusBadge = (() => {
    switch (headerMeta.reviewStatus) {
      case "verified":
        return "✅ 원문 대조 완료";
      case "partial":
        return "🟡 부분 검증 (일부 조문만 확인됨)";
      case "needs_review":
        return "⚠ 조문 재대조 권장";
      default:
        return "ℹ️ 검토 상태 미기재";
    }
  })();

  // MD 응답
  const md = [
    `# ${article.lawShortName} ${article.ref} ${article.title}`,
    "",
    `> **법령**: ${article.lawShortName}`,
    `> **조문**: ${article.ref} ${article.title}`,
    `> **현행 기준**: ${headerMeta.currentLawId ?? "(법령 헤더 미기재)"}`,
    `> **출처 URL**: ${headerMeta.sourceUrl ?? "https://www.law.go.kr"}`,
    `> **마지막 동기화**: ${headerMeta.lastSyncedAt ?? "(미기재)"}`,
    `> **검토 상태**: ${statusBadge}`,
    headerMeta.manualReviewRequired
      ? `> **검토 필요 여부**: ${headerMeta.manualReviewRequired}`
      : "",
    headerMeta.nextReviewDue
      ? `> **다음 검토 권장**: ${headerMeta.nextReviewDue}`
      : "",
    `> **저작권**: 저작권법 §7 비보호 저작물 (자유 인용)`,
    "",
    "---",
    "",
    article.body.replace(/^##\s+§[^\n]+\n/, ""), // 헤딩 중복 제거
    "",
    "---",
    "",
    "**인용 시 근거 등급**: `basisType: law | regulation` / `legalWeight: mandatory`",
    "",
    headerMeta.reviewStatus === "verified"
      ? "> ✅ 본 조문은 법제처 현행본과 직접 대조 검증 완료."
      : headerMeta.reviewStatus === "partial"
        ? "> 🟡 본 법령은 일부 조문만 원문 검증됨. 해당 조문 인용 전 법제처 현행본 확인 권장."
        : "> ⚠ 본 법령은 기준일 메타만 확인됐으며 개별 조문 원문 재대조를 권장한다. 법적 판단·판례 참조 시 법제처 공식본 필수.",
  ]
    .filter((x) => x !== "")
    .join("\n");

  return {
    content: [{ type: "text", text: md }],
    structuredContent: {
      query: input,
      found: true,
      article: {
        lawCode: article.lawCode,
        lawShortName: article.lawShortName,
        ref: article.ref,
        title: article.title,
        basisType: "law",
        legalWeight: "mandatory",
      },
      lawMeta: headerMeta,
    },
  };
}

export const getSafetyLawArticleTool: ToolDefinition = {
  name: "get_safety_law_article",
  title: "법령 조문 본문 조회",
  description:
    "특정 법령 조문의 원문을 Markdown 으로 반환. ref 는 '산안법 §36', '§38', '산안기준규칙 §38', '중처법 §4' 같이 법령명+조번호 형식. LLM 이 위험성평가·작업계획서 작성 시 'mandatory 근거' 로 이 응답을 그대로 인용. 저작권법 §7 비보호 저작물이라 복제·재배포 자유.",
  inputSchema,
  handler,
};
