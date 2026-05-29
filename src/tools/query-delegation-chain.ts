import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { getNode, listDocuments, bfsByEdge } from "../lib/graph-nodes-loader.js";
import { COMMON_RESPONSE_META } from "../config/constants.js";

// 파일 최상단 상수 — 법령 위임 사슬 BFS 추적
// 시작 Article(예: 산안법 §36) → 위임된 시행령·시행규칙·고시 사슬 추적.
// Phase 1 P1 — Article 노드의 delegates 엣지가 채워지는 만큼 사슬 길이 확장.
// 현재 P0 stub — Document 노드의 legalBasisRefs 텍스트 메타가 1차 출처.

const inputSchema = z.object({
  startRef: z
    .string()
    .min(1)
    .describe(
      "출발 조문 (예: 'art:산안법:36') 또는 docId(예: 'monthly_risk_assessment'). docId 입력 시 해당 문서의 모든 legalBasisRefs를 펼쳐 보여줌.",
    ),
  maxDepth: z.number().int().min(1).max(5).default(3).describe("BFS 최대 깊이"),
});

type Input = z.infer<typeof inputSchema>;

interface ChainNode {
  ref: string;
  source: "iri" | "text";
  law?: string;
  article?: string;
  text?: string;
  depth: number;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const chain: ChainNode[] = [];

  // docId 입력 시 — Document 노드의 legalBasisRefs 펼침 (텍스트 fallback)
  if (!input.startRef.startsWith("art:") && !input.startRef.startsWith("act:")) {
    const docs = await listDocuments();
    const doc = docs.find((d) => d.docId === input.startRef);
    if (doc) {
      const refs = (doc._meta?.["legalBasisRefs"] as Array<{
        law: string;
        article: string;
        text: string;
      }>) ?? [];
      for (const r of refs) {
        chain.push({
          ref: `${r.law} ${r.article}`,
          source: "text",
          law: r.law,
          article: r.article,
          text: r.text,
          depth: 1,
        });
      }
      const payload = {
        startRef: input.startRef,
        startKind: "Document",
        startTitle: doc.title,
        chainLength: chain.length,
        chain,
        warning: {
          mode: "textFallback",
          note: "Document 입력 시 legalBasisRefs(텍스트) 평면 펼침 응답. 진짜 BFS 위임 추적은 art:/act: IRI 입력 시 작동.",
        },
        _meta: {
          ...COMMON_RESPONSE_META,
        },
      };
      const text = [
        `# 위임 사슬 — Document '${doc.title}' (textFallback)`,
        `⚠ 본 응답은 Document 의 legalBasisRefs 텍스트를 평면 나열한 것입니다. 진짜 BFS 위임 추적은 art:기준규칙:38 같은 IRI 입력 시 동작합니다.`,
        `법령 근거 ${chain.length}건:`,
        ...chain.map((c, i) => `  ${i + 1}. ${c.ref} — ${c.text}`),
        "",
        JSON.stringify(payload, null, 2),
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        structuredContent: payload,
      } as McpToolResult;
    }
  }

  // Article/Act 노드 입력 시 — graphology BFS (delegates 엣지)
  const startNode = await getNode(input.startRef);
  if (startNode) {
    const bfsResult = await bfsByEdge(input.startRef, "delegates", input.maxDepth);
    for (const r of bfsResult) {
      const data = r.data as { partOf?: string; articleNumber?: string };
      chain.push({
        ref: r.id,
        source: "iri",
        law: data.partOf,
        article: data.articleNumber,
        depth: r.depth,
      });
    }
  }

  const payload = {
    startRef: input.startRef,
    startKind: "Article|Act",
    chainLength: chain.length,
    chain,
    _meta: {
      note:
        "Article/Act 노드 BFS. delegates 엣지가 채워지는 만큼 사슬 길이 확장. Phase 1 P1 — 현재 골격, P2에서 Article 32건 추가 후 본격 활용.",
      ...COMMON_RESPONSE_META,
    },
  };

  // delegates 엣지 데이터 0 상태 솔직한 경고 (교차 검증 P3 권고)
  const delegatesAvailable = chain.length > 1; // start 외에 hop 있나
  const enrichedPayload = {
    ...payload,
    warning: !delegatesAvailable
      ? {
          mode: "noDelegationData",
          note: "Article/Act 노드가 graph 에 있으나 delegates 엣지 데이터가 아직 채워지지 않았습니다. 위임 관계는 P3 후속(법제처 체계도조회 통합) 에서 본격 추적 예정. 현재는 단일 노드 본문만 반환.",
        }
      : undefined,
  };

  if (chain.length === 0) {
    // 교차 검증 P4 권고: 가짜 IRI / 미발견 시 isError=true (verify_safety_basis 와 일관성)
    return {
      content: [
        {
          type: "text",
          text: `[NOT_FOUND] 시작 노드 '${input.startRef}' 미발견. docId(work_plan_excavation 등) 또는 Article IRI(art:기준규칙:38 등) 사용.`,
        },
      ],
      structuredContent: enrichedPayload,
      isError: true,
    } as McpToolResult;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(enrichedPayload, null, 2) }],
    structuredContent: enrichedPayload,
  } as McpToolResult;
}

export const queryDelegationChainTool: ToolDefinition = {
  name: "query_delegation_chain",
  title: "법령 위임 사슬 추적 (산안법 → 시행령 → 시행규칙 → 고시)",
  description:
    "출발 조문(art: 또는 act: IRI) 또는 docId 입력 시 위임 관계를 BFS 로 추적해 시행령·시행규칙·고시까지 연결된 법적 근거 사슬을 반환. 산안법 §36 → 위험성평가 고시 §15 처럼 본문에 명시 안 된 위임도 추적. Phase 1 P1 — Article 노드의 delegates 엣지가 채워지는 만큼 사슬 길이 확장.",
  inputSchema,
  handler,
};
