import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { getDocument, getNode, neighborsByEdge, hasType } from "../lib/graph-nodes-loader.js";
import { COMMON_RESPONSE_META } from "../config/constants.js";

// 파일 최상단 상수 — 조문/문서 위반 시 처벌 조회
// docId 또는 Article ID(예: 'penalty:산안법:175', 'art:기준규칙:38')로 조회.
// Phase 1 P1 — 현재 Penalty 노드는 산안법 §175(굴착 작업계획서) 1건. 점진 확장.

const inputSchema = z
  .object({
    docId: z.string().optional().describe("법정문서 docId — 미작성 시 처벌"),
    articleRef: z.string().optional().describe("Article 노드 IRI 또는 조문 참조 (penalty: 또는 art: prefix)"),
  })
  .refine(
    (v) => Boolean(v.docId) || Boolean(v.articleRef),
    { message: "docId 또는 articleRef 중 하나 필수" },
  );

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  let penaltyIds: string[] = [];
  let docTitle: string | undefined;

  if (input.docId) {
    const doc = await getDocument(input.docId);
    if (!doc) {
      return {
        content: [{ type: "text", text: `docId='${input.docId}' Document 노드 미발견.` }],
        structuredContent: { found: false, docId: input.docId },
        isError: true,
      } as McpToolResult;
    }
    docTitle = doc.title;
    const pom = doc.penaltyOnMissing;
    if (Array.isArray(pom)) penaltyIds = pom;
    else if (pom) penaltyIds = [pom];
  } else if (input.articleRef) {
    if (input.articleRef.startsWith("penalty:")) {
      penaltyIds = [input.articleRef];
    } else {
      // graphology BFS — Article → penalizedBy 엣지 추적
      penaltyIds = await neighborsByEdge(input.articleRef, "penalizedBy");
    }
  }

  if (penaltyIds.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `처벌 매핑이 아직 등록되지 않은 ${input.docId ? `문서(${input.docId})` : "조문"}입니다.`,
        },
      ],
      structuredContent: {
        found: false,
        docId: input.docId,
        articleRef: input.articleRef,
        note: "Penalty 노드 매핑은 점진 확장 — 미발견 시 verify_safety_basis 또는 search_safety_laws 사용 권장.",
      },
    } as McpToolResult;
  }

  // 다중 Penalty 처리 — 단순 미작성 + 사망 결과 등 별개 케이스 모두 응답
  const penalties: Array<{
    "@id": string;
    title?: string;
    partOf: string;
    penaltyType: string;
    amount?: number;
    amountUnit?: string;
    imprisonmentMaxYears?: number;
    condition?: string;
  }> = [];
  const missingNodeIds: string[] = [];
  for (const pid of penaltyIds) {
    const penalty = await getNode(pid);
    // @type 은 string 또는 ["Penalty", "Legislation"] 같은 multi-type 배열일 수 있다.
    // 직접 `=== "Penalty"` 비교 시 multi-type 노드 전부 missingNodeIds 로 잘못 분류
    // (실측: art:산안법:38 → penalty 4건 모두 누락). hasType 으로 둘 다 처리.
    if (!penalty || !hasType(penalty, "Penalty")) {
      missingNodeIds.push(pid);
      continue;
    }
    const p = penalty as {
      title?: string;
      partOf: string;
      penaltyType: string;
      amount?: number;
      amountUnit?: string;
      imprisonmentMaxYears?: number;
      condition?: string;
    };
    penalties.push({
      "@id": pid,
      title: p.title,
      partOf: p.partOf,
      penaltyType: p.penaltyType,
      amount: p.amount,
      amountUnit: p.amountUnit,
      imprisonmentMaxYears: p.imprisonmentMaxYears,
      condition: p.condition,
    });
  }

  const isErrorFlag = penalties.length === 0 && missingNodeIds.length > 0;

  const payload = {
    found: penalties.length > 0,
    docId: input.docId,
    docTitle,
    penalties,
    missingNodeIds: missingNodeIds.length > 0 ? missingNodeIds : undefined,
    note:
      penalties.length > 1
        ? "복수 처벌 매핑 — 위반 상황(단순 미작성 / 사망 결과 등)에 따라 적용 조항이 다름. 각 condition 확인 필요."
        : undefined,
    _meta: COMMON_RESPONSE_META,
  };

  const lines: string[] = [
    `# 처벌 조회${docTitle ? ` — ${docTitle} (docId=${input.docId})` : ""}`,
    `매핑된 처벌: ${penalties.length}건${penalties.length > 1 ? " (복수 — 위반 상황별 별개 적용)" : ""}`,
    "",
  ];
  for (const [i, p] of penalties.entries()) {
    const amountText =
      p.imprisonmentMaxYears && p.amount
        ? `${p.imprisonmentMaxYears}년 이하 징역 또는 ${p.amount.toLocaleString("ko-KR")} ${p.amountUnit ?? "원"} 이하 벌금`
        : p.amount && p.amountUnit
          ? `${p.amount.toLocaleString("ko-KR")} ${p.amountUnit} 이하 ${p.penaltyType === "administrative_fine" ? "과태료" : "벌금"}`
          : "(금액 미명시)";
    lines.push(
      `## ${i + 1}. ${p.title ?? p["@id"]}`,
      `   조건: ${p.condition ?? "-"}`,
      `   유형: ${p.penaltyType}`,
      `   금액: ${amountText}`,
      "",
    );
  }
  lines.push(JSON.stringify(payload, null, 2));

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: payload,
    isError: isErrorFlag ? true : undefined,
  } as McpToolResult;
}

export const queryPenaltyTool: ToolDefinition = {
  name: "query_penalty",
  title: "조문·문서 위반 시 처벌 조회 (과태료·벌금·형사)",
  description:
    "법정문서 미작성 또는 조문 위반 시 적용되는 처벌(과태료·벌금·징역) 조회. 입력은 docId 또는 articleRef. 그래프 노드의 penalizedBy/penaltyOnMissing 엣지 추적. Phase 1 P1 — 점진 확장 중, 현재 산안법 §175(굴착 작업계획서 미작성) 등록 완료.",
  inputSchema,
  handler,
};
