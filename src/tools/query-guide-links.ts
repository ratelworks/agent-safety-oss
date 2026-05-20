import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { getDocument, listDocuments, neighborsByEdge, getNode } from "../lib/graph-nodes-loader.js";
import { COMMON_RESPONSE_META } from "../config/constants.js";

// 파일 최상단 상수 — 법정문서/작업과 연결된 KOSHA Guide·재해사례·OPS·법령 통합
//
// 입력: docId 또는 activitySlug
// 출력: 그래프의 guidedBy / cited_in / legalBasis / hasAnnex 엣지 추적 결과
//        + 외부 Live API 호출 권유 (compile_safety_references와 다른 용도)
//
// Phase 2 P2 — guidedBy 엣지가 채워지는 만큼 가치 증대.
// KOSHA Guide·OPS Document 노드는 P3 카탈로그화 시 본격 활용.

const inputSchema = z.object({
  docId: z.string().optional().describe("법정문서 docId"),
  activitySlug: z.string().optional().describe("작업 슬러그 (예: 'excavation_2m_plus')"),
}).refine(
  (v) => Boolean(v.docId) || Boolean(v.activitySlug),
  { message: "docId 또는 activitySlug 중 하나 필수" },
);

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  if (input.docId) {
    const doc = await getDocument(input.docId);
    if (!doc) {
      const available = (await listDocuments()).map((d) => d.docId).slice(0, 30);
      return {
        content: [
          { type: "text", text: `docId='${input.docId}' Document 노드 미발견. 사용 가능: ${available.join(", ")}` },
        ],
        structuredContent: { found: false, docId: input.docId, availableDocIds: available },
        isError: true,
      } as McpToolResult;
    }

    // graphology BFS 활용 — Document 의 guidedBy + legalBasis 외에 hasAnnex/regulates 까지 추적
    const guidedBy = await neighborsByEdge(doc["@id"], "guidedBy");
    const legalBasis = await neighborsByEdge(doc["@id"], "legalBasis");
    // legalBasis Article 들의 regulates 엣지 따라가서 관련 Activity 추적
    const relatedActivities: string[] = [];
    for (const articleId of legalBasis) {
      const acts = await neighborsByEdge(articleId, "regulates");
      relatedActivities.push(...acts);
    }
    const uniqueActivities = Array.from(new Set(relatedActivities));

    const sparseLinks = guidedBy.length === 0;

    const externalRecommendations = [
      `compile_safety_references({workType: '${input.docId}', docType: '${doc.cycle}'}) — KOSHA Guide·재해사례·법령 RAG 번들`,
      `get_kosha_guide_md({keyword: '${doc.title}'}) — KOSHA Guide 직접 검색 (번들)`,
      `search_accident_cases({keyword: '${doc.title}'}) — 재해사례 검색 (Live API)`,
    ];

    const payload = {
      docId: input.docId,
      title: doc.title,
      cycle: doc.cycle,
      links: {
        guidedBy, // KOSHA Guide·OPS 노드
        legalBasis, // 법령 근거 IRI
        relatedActivities: uniqueActivities, // graphology BFS — Article.regulates 추적
      },
      sparseLinks,
      sparseLinksNote: sparseLinks
        ? "그래프에 KOSHA Guide·OPS 노드가 아직 카탈로그화되지 않았습니다. 외부 Live API 도구 활용 권장."
        : null,
      externalRecommendations,
      graphologyHops: {
        guidedBy: 1,
        legalBasis: 1,
        relatedActivities: 2, // Document → Article → Activity 2-hop
      },
      _meta: COMMON_RESPONSE_META,
    };

    const text = [
      `# Guide·자료 매칭 — ${doc.title} (docId=${doc.docId})`,
      `cycle: ${doc.cycle}`,
      "",
      `## 그래프 내장 (그래프 엣지)`,
      `guidedBy KOSHA Guide·OPS: ${guidedBy.length}건${sparseLinks ? " (sparse — 외부 API 권장)" : ""}`,
      `legalBasis (Article/Annex): ${legalBasis.length}건`,
      "",
      `## 외부 Live API 권장`,
      ...externalRecommendations.map((r) => `- ${r}`),
      "",
      JSON.stringify(payload, null, 2),
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: payload,
    } as McpToolResult;
  }

  // activitySlug 입력 시 — Activity 노드 → guidedBy + 역방향 regulates Article + appliesTo
  const activityIri = `activity:${input.activitySlug}`;
  const activity = await getNode(activityIri);
  if (!activity) {
    return {
      content: [
        { type: "text", text: `[NOT_FOUND] activity:${input.activitySlug} 노드 미발견. 사용 가능 IRI 는 list 도구로 확인.` },
      ],
      structuredContent: { activitySlug: input.activitySlug, found: false },
      isError: true,
    } as McpToolResult;
  }
  const guidedBy = await neighborsByEdge(activityIri, "guidedBy");
  const regulatedByArticles = await neighborsByEdge(activityIri, "regulates", "in"); // reverse
  const evaluatedBy = await neighborsByEdge(activityIri, "evaluatedBy");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            activitySlug: input.activitySlug,
            activityTitle: (activity as { title?: string }).title,
            links: { guidedBy, regulatedByArticles, evaluatedBy },
            sparseLinks: guidedBy.length === 0,
            graphologyHops: { guidedBy: 1, regulatedByArticles: 1, evaluatedBy: 1 },
            _meta: COMMON_RESPONSE_META,
          },
          null,
          2,
        ),
      },
    ],
    structuredContent: {
      activitySlug: input.activitySlug,
      activityTitle: (activity as { title?: string }).title,
      links: { guidedBy, regulatedByArticles, evaluatedBy },
      sparseLinks: guidedBy.length === 0,
      _meta: COMMON_RESPONSE_META,
    },
  } as McpToolResult;
}

export const queryGuideLinksTool: ToolDefinition = {
  name: "query_guide_links",
  title: "법정문서·작업의 KOSHA Guide·재해사례 연결 묶음",
  description:
    "특정 법정문서(docId) 또는 작업(activitySlug)과 연결된 KOSHA Guide·OPS·재해사례·법령 근거를 그래프 엣지로 추적해 통합 응답. guidedBy/legalBasis 엣지 활용. 그래프 내장 자료가 부족한 경우(sparseLinks) 외부 Live API 도구(compile_safety_references / get_kosha_guide_md / search_accident_cases) 사용 권장 메시지 자동 부착. P3 Activity 노드 카탈로그화 시 가치 증대.",
  inputSchema,
  handler,
};
