import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  listLaws,
  extractAllArticles,
  getLawHeaderMeta,
} from "../lib/safety-laws-loader.js";

// 파일 최상단 상수 — 번들된 법령·조문 목록 조회
// 각 법령별로 포함된 조문 수를 요약

const inputSchema = z.object({
  includeArticles: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "true 면 각 법령 하위 조문 목록(§N 제목) 도 함께 반환. false(기본)는 법령 메타만",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const laws = listLaws();
  const summary = await Promise.all(
    laws.map(async (law) => {
      const [articles, meta] = await Promise.all([
        extractAllArticles(law.code),
        getLawHeaderMeta(law.code),
      ]);
      return {
        ...law,
        articleCount: articles.length,
        reviewStatus: meta.reviewStatus,
        lastSyncedAt: meta.lastSyncedAt,
        nextReviewDue: meta.nextReviewDue,
        sourceUrl: meta.sourceUrl,
        currentLawId: meta.currentLawId,
        manualReviewRequired: meta.manualReviewRequired,
        articles: input.includeArticles
          ? articles.map((a) => ({ ref: a.ref, title: a.title }))
          : undefined,
      };
    }),
  );

  const totalArticles = summary.reduce((sum, l) => sum + l.articleCount, 0);

  const statusEmoji = (s?: string): string => {
    switch (s) {
      case "verified":
        return "✅";
      case "partial":
        return "🟡";
      case "needs_review":
        return "⚠";
      default:
        return "ℹ️";
    }
  };

  // MD 응답
  const lines: string[] = [];
  lines.push("# 번들된 건설·산업안전 법령");
  lines.push("");
  lines.push(`> 법령 **${laws.length}개** · 조문 **${totalArticles}개**`);
  lines.push(
    `> 저작권법 §7 비보호 저작물 · 출처: 법제처 국가법령정보센터 (https://www.law.go.kr)`,
  );
  lines.push("");

  for (const law of summary) {
    lines.push(`## ${statusEmoji(law.reviewStatus)} ${law.shortName} (${law.code})`);
    lines.push(`**공식명**: ${law.official}`);
    if (law.currentLawId) {
      lines.push(`**현행 기준**: ${law.currentLawId}`);
    }
    lines.push(`**포함 조문**: ${law.articleCount}건`);
    if (law.lastSyncedAt) {
      lines.push(`**마지막 동기화**: ${law.lastSyncedAt}`);
    }
    if (law.manualReviewRequired) {
      lines.push(`**검토 필요 여부**: ${law.manualReviewRequired}`);
    }
    if (law.nextReviewDue) {
      lines.push(`**다음 검토 권장**: ${law.nextReviewDue}`);
    }
    if (law.sourceUrl) {
      lines.push(`**출처 URL**: ${law.sourceUrl}`);
    }
    lines.push("");

    if (input.includeArticles && law.articles && law.articles.length > 0) {
      for (const art of law.articles) {
        lines.push(`- ${art.ref} ${art.title}`);
      }
      lines.push("");
    }
  }

  lines.push("## 검토 상태 범례");
  lines.push("- ✅ **verified**: 법제처 원문과 직접 대조 검증 완료");
  lines.push("- 🟡 **partial**: 일부 조문만 검증, 나머지는 메타만 확인");
  lines.push("- ⚠ **needs_review**: 기준일 메타만 확인, 개별 조문 재대조 권장");
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## 사용 방법");
  lines.push("");
  lines.push("- **키워드 검색**: `search_safety_laws(keyword, lawCode?)`");
  lines.push("- **조문 조회**: `get_safety_law_article(ref, lawCode?)`");
  lines.push("- **전체 조문 목록**: `list_core_safety_laws(includeArticles=true)`");
  lines.push("");
  lines.push(
    "본 번들은 건설·산업안전 실무에서 자주 인용되는 핵심 조문을 선별한 것이며 전체 법령이 아닙니다. 번들에 없는 조문이 필요하면 법제처 원문 (https://www.law.go.kr) 확인.",
  );

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      totalLaws: laws.length,
      totalArticles,
      laws: summary,
    },
  };
}

export const listCoreSafetyLawsTool: ToolDefinition = {
  name: "list_core_safety_laws",
  title: "번들된 법령 목록",
  description:
    "본 MCP 에 번들된 건설·산업안전 법령 **MD 본문 10개** (산안법·시행령·시행규칙·기준규칙·중처법·중처법 시행령·위험성평가 고시·건진법·건진법 시행령·건진법 시행규칙) 와 각 법령의 조문 수를 반환. `includeArticles=true` 로 각 조문 목록(§N·제목) 까지 받을 수 있음. 전체 법령이 아니라 실무 빈번 인용 조문만 선별됨 (산안법 영역은 거의 전수, 중처법 시행령은 13조 전수, 건진법은 §62 안전관리 영역 4조만) — 없는 조문은 법제처 원문 확인.",
  inputSchema,
  handler,
};
