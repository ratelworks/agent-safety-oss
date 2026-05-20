import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  getDocument,
  listDocuments,
  findArticlesAndAnnexesForDocument,
  neighborsByEdge,
  getNode,
  type ArticleNode,
  type AnnexNode,
} from "../lib/graph-nodes-loader.js";
import { COMMON_RESPONSE_META } from "../config/constants.js";

// 파일 최상단 상수 — Document 노드의 법적 근거 조문·별표·처벌 통합 응답
// 그래프 메타 reverse lookup. 19종 docId 모두 지원.
//
// 입력: docId (예: 'work_plan_excavation', 'monthly_risk_assessment')
// 출력:
//   - 정식 IRI 매핑된 Article/Annex 노드 (Phase 1 P0 일부)
//   - legalBasisRefs 메타 텍스트 (Phase 1 P1 자동 변환분 19종)
//   - applicableWhen / exemptedWhen / retention / penaltyOnMissing 통합

const inputSchema = z.object({
  docId: z
    .string()
    .min(1)
    .describe(
      "법정문서 docId (예: work_plan_excavation, monthly_risk_assessment, daily_tbm). list_safety_documents_by_cycle 로 전체 docId 확인 가능.",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const doc = await getDocument(input.docId);
  if (!doc) {
    const available = (await listDocuments()).map((d) => d.docId).slice(0, 30);
    return {
      content: [
        {
          type: "text",
          text: `docId='${input.docId}' 의 Document 노드를 찾을 수 없습니다. 사용 가능: ${available.join(", ")}`,
        },
      ],
      structuredContent: {
        docId: input.docId,
        found: false,
        availableDocIds: available,
      },
      isError: true,
    } as McpToolResult;
  }

  const meta = (doc._meta ?? {}) as Record<string, unknown>;
  const legalBasisRefs = (meta["legalBasisRefs"] as Array<{
    law: string;
    article: string;
    text: string;
  }>) ?? [];

  // ── Reverse lookup (a-codex P0 권고): Article/Annex 정·역방향 모두 추적 ──
  const linkedNodes = await findArticlesAndAnnexesForDocument(doc.docId);
  const iriArticles: Array<{
    "@id": string;
    "@type": string;
    articleNumber?: string;
    annexNumber?: string;
    title: string;
    partOf: string;
    verificationStatus?: string;
    description?: string;
  }> = linkedNodes.map((n) => {
    const types = Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]];
    if (types.includes("Article")) {
      const a = n as ArticleNode;
      return {
        "@id": a["@id"],
        "@type": "Article",
        articleNumber: a.articleNumber,
        title: a.title,
        partOf: a.partOf,
        verificationStatus: a.verificationStatus,
        description: a.description,
      };
    }
    const ax = n as AnnexNode;
    return {
      "@id": ax["@id"],
      "@type": "Annex",
      annexNumber: ax.annexNumber,
      title: ax.title,
      partOf: ax.partOf,
      verificationStatus: ax.verificationStatus,
      description: ax.description,
    };
  });

  const sparseGraph = iriArticles.length === 0;

  // graphology BFS — Article의 penalizedBy 까지 1-hop 추가 추적
  const penaltyIris: string[] = [];
  for (const a of iriArticles) {
    if (a["@type"] === "Article" || (Array.isArray(a["@type"]) && (a["@type"] as string[]).includes("Article"))) {
      const p = await neighborsByEdge(a["@id"], "penalizedBy");
      penaltyIris.push(...p);
    }
  }
  const uniquePenalties: Array<{ "@id": string; title?: string; amount?: number; condition?: string }> = [];
  for (const id of Array.from(new Set(penaltyIris))) {
    const n = await getNode(id);
    const nTypes = Array.isArray(n?.["@type"]) ? (n["@type"] as string[]) : [n?.["@type"]];
    if (n && nTypes.includes("Penalty")) {
      const p = n as { title?: string; amount?: number; condition?: string };
      uniquePenalties.push({ "@id": id, title: p.title, amount: p.amount, condition: p.condition });
    }
  }

  const payload = {
    docId: doc.docId,
    title: doc.title,
    cycle: doc.cycle,
    trigger: doc.trigger,
    applicableWhen: doc.applicableWhen,
    exemptedWhen: doc.exemptedWhen,
    retention: doc.retention,
    penaltyOnMissing: doc.penaltyOnMissing,
    legalBasis: {
      iriMapped: iriArticles,
      textRefs: legalBasisRefs,
      relatedPenalties: uniquePenalties, // graphology BFS — Article → Penalty 1-hop
      sparseGraph,
      sparseGraphNote: sparseGraph
        ? "이 문서는 아직 정식 Article 노드 IRI 매핑이 안 됐습니다. legalBasisRefs(텍스트 메타)가 1차 출처입니다."
        : null,
    },
    graphologyHops: {
      iriMapped: 1,
      relatedPenalties: 2, // Document → Article → Penalty
    },
    requiredFieldCount: doc.requiredFields.length,
    reviewRuleCount: doc.reviewRules.length,
    standardForm: doc.standardForm,
    _meta: {
      verificationStatus: meta["verificationStatus"] ?? "verified",
      sourceUrl:
        doc.standardForm?.["sourceUrl" as keyof typeof doc.standardForm] ?? null,
      ...COMMON_RESPONSE_META,
    },
  };

  const headerLines = [
    `# ${doc.title} (docId=${doc.docId}) 법적 근거`,
    `cycle: ${doc.cycle}, retention: ${doc.retention || "미명시"}`,
    "",
    `## 정식 IRI 매핑 (${iriArticles.length}건)`,
    ...(iriArticles.length > 0
      ? iriArticles.map(
          (a, i) =>
            `${i + 1}. [${a["@type"]}] ${a.partOf} ${a.articleNumber ?? a.annexNumber ?? ""} — ${a.title} (${a.verificationStatus ?? "?"})`,
        )
      : ["  (아직 IRI 매핑 없음 — sparseGraph)"]),
    "",
    `## legalBasisRefs 텍스트 (${legalBasisRefs.length}건)`,
    ...legalBasisRefs.map(
      (r, i) => `${i + 1}. ${r.law} ${r.article} — ${r.text}`,
    ),
  ];

  return {
    content: [
      {
        type: "text",
        text: headerLines.join("\n") + "\n\n" + JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  } as McpToolResult;
}

export const queryLegalBasisTool: ToolDefinition = {
  name: "query_legal_basis",
  title: "법정문서의 법적 근거 조문·별표·처벌 통합 조회",
  description:
    "안전관리 법정문서(docId)의 법적 근거 조문·시행일·적용성·과태료를 한 번에 반환. 19종 docId 지원 (work_plan_excavation, monthly_risk_assessment, daily_tbm 등). 그래프 노드 reverse lookup — legalBasisRefs 메타에서 1차 응답, 정식 IRI 매핑된 Article 노드는 점진 추가.",
  inputSchema,
  handler,
};
