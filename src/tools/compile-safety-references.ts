import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { analyzeConstructionWorkRisksTool } from "./analyze-construction-work-risks.js";
import { searchSifArchiveTool } from "./search-sif-archive.js";
import { getKoshaGuideMdTool } from "./get-kosha-guide-md.js";
import { searchSafetyLawsTool } from "./search-safety-laws.js";

// 파일 최상단 상수 — Reference 번들러
// 공종 + 문서유형 → LLM 이 해당 문서 작성에 필요한 공식 자료 원샷 번들
// (법령·KOSHA Guide·SIF·공종분석을 단일 응답에 묶어 RAG 컨텍스트로 직접 사용 가능)
const DEFAULT_LIMIT_PER_SOURCE = 5;

const DOC_TYPE_LAW_KEYWORDS: Record<string, string[]> = {
  risk_assessment: ["위험성평가", "§36"],
  work_plan: ["작업계획서", "§38", "별표 4"],
  tbm: ["상시", "§15", "작업 전 안전점검회의"],
  ops: ["핵심요인", "§7"],
  work_permit: ["정전작업", "밀폐공간", "화기", "고소작업", "추락"],
  daily_inspection: ["작업시작", "§35", "별표 3"],
  general: ["§36", "§38"],
};

const inputSchema = z.object({
  workType: z
    .string()
    .describe("작업 공종 (예: '거푸집 해체', '타워크레인 양중', '밀폐공간 청소')"),
  docType: z
    .enum([
      "risk_assessment",
      "work_plan",
      "tbm",
      "ops",
      "work_permit",
      "daily_inspection",
      "general",
    ])
    .default("general")
    .describe(
      "문서 유형 — 해당 문서 작성에 필요한 자료만 선별해 반환",
    ),
  limitPerSource: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(DEFAULT_LIMIT_PER_SOURCE)
    .describe("각 소스당 최대 결과 건수"),
});

type Input = z.infer<typeof inputSchema>;

function readStructured(result: unknown): any {
  const r = result as any;
  if (r && typeof r === "object" && "structuredContent" in r) {
    return r.structuredContent ?? null;
  }
  return null;
}

function readContent(result: unknown): string {
  const r = result as any;
  if (
    r &&
    typeof r === "object" &&
    Array.isArray(r.content) &&
    r.content[0]?.text
  ) {
    return r.content[0].text;
  }
  return "";
}

function countLawReferences(lawResults: unknown[] | undefined): number {
  if (!lawResults) return 0;
  const headers = new Set<string>();
  for (const result of lawResults) {
    const text = readContent(result);
    for (const header of text.match(/## \[[^\]]+\][^\n]+/g) ?? []) {
      headers.add(header);
    }
  }
  return headers.size;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  // 병렬로 각 소스 Tool 호출. 실패는 null 이나 silent 는 아니고 stderr 기록.
  const safeCall = async (
    label: string,
    fn: (x: unknown) => Promise<McpToolResult> | McpToolResult,
    arg: unknown,
  ): Promise<unknown> => {
    try {
      return await fn(arg);
    } catch (err) {
      // stderr 로그 — 업스트림 장애·키 누락 등 silent fail 방지
      // MCP stdio 프로토콜은 stdout 만 써야 하므로 stderr 는 안전
      // eslint-disable-next-line no-console
      console.error(
        `[compile_safety_references] ${label} 실패:`,
        (err as Error).message,
      );
      return null;
    }
  };

  const [analyzeR, sifR, guideR, lawR] = await Promise.all([
    safeCall("analyze", analyzeConstructionWorkRisksTool.handler, {
      workType: input.workType,
    }),
    safeCall("sif", searchSifArchiveTool.handler, {
      workType: input.workType,
      limit: input.limitPerSource,
    }),
    // 번들 KOSHA Guide 1,039건 키워드 검색 (Live API search 도구 폐기 후 번들로 통합)
    safeCall("kosha-guide", getKoshaGuideMdTool.handler, {
      keyword: input.workType,
      limit: input.limitPerSource,
    }),
    // 문서 유형별 법령 키워드로 번들 법령 검색
    // 모든 키워드를 다 돌되 limitPerSource 는 각 키워드 단위로 적용
    (async (): Promise<unknown[]> => {
      const keywords = DOC_TYPE_LAW_KEYWORDS[input.docType] ?? [];
      const results: unknown[] = [];
      for (const kw of keywords) {
        const r = await safeCall("law:" + kw, searchSafetyLawsTool.handler, {
          keyword: kw,
          limit: input.limitPerSource,
        });
        if (r) results.push(r);
      }
      return results;
    })(),
  ]);

  const analyze = readStructured(analyzeR);
  const sif = readStructured(sifR);
  const guide = readStructured(guideR);
  const lawResults = Array.isArray(lawR) ? lawR : [];
  const lawReferenceCount = countLawReferences(lawResults);
  const guideReferenceCount = (guide?.results ?? []).length;
  const sifReferenceCount = (sif?.results ?? []).length;
  const analysisReferenceCount = analyze?.matched ? 1 : 0;
  const totalReferences =
    lawReferenceCount + guideReferenceCount + sifReferenceCount + analysisReferenceCount;

  // MD 응답 조립 — LLM 이 그대로 인용 가능한 Reference 섹션
  const lines: string[] = [];
  lines.push(`# ${docTypeKo(input.docType)} 참조 자료 번들 — ${input.workType}`);
  lines.push("");
  lines.push(
    `> 문서 유형(docType)=${input.docType} 기준으로 법령·KOSHA Guide·SIF 패턴·재해사례를 조합했습니다.`,
  );
  lines.push("> LLM 은 이 자료들을 `get_*_schema` 의 필드에 매핑해 초안을 작성하세요.");
  lines.push("");

  // [1] 법령 (Mandatory basis)
  lines.push("## 📜 법령·고시 (mandatory 근거)");
  lines.push("");
  if (lawResults.length > 0) {
    const uniq = new Set<string>();
    for (const r of lawResults) {
      const text = readContent(r);
      // 섹션 단위로 요약 — ## 헤딩만 뽑아서 목록화
      const headers = text.match(/## \[[^\]]+\][^\n]+/g) ?? [];
      for (const h of headers) {
        if (uniq.has(h)) continue;
        uniq.add(h);
        lines.push(`- ${h.replace(/^## /, "")}`);
      }
    }
    lines.push("");
    lines.push("→ 본문은 `get_safety_law_article(ref)` 로 조회. 인용 시 `basisType: law | regulation`, `legalWeight: mandatory`");
  } else {
    lines.push("(매칭된 법령 없음)");
  }
  lines.push("");

  // [2] KOSHA Guide (recommended basis)
  lines.push("## 📘 KOSHA Guide (recommended 근거)");
  lines.push("");
  if (guide?.bundleStatus === "empty") {
    lines.push("(번들 Guide 비어 있음 — `npm run sync-kosha` 또는 `get_kosha_guide_md` 번들 도구로 직접 조회)");
  } else if (guide?.results && guide.results.length > 0) {
    for (const g of guide.results) {
      lines.push(`- **${g.guideCode}**: ${g.title} ${g.relatedHazards ? `[${(g.relatedHazards as string[]).join(", ")}]` : ""}`);
    }
  } else {
    lines.push("(매칭된 KOSHA Guide 없음)");
  }
  lines.push("");

  // [3] SIF 패턴 (reference)
  lines.push("## 🔍 SIF 패턴 (reference — 원인·대책)");
  lines.push("");
  if (sif?.bundleStatus === "empty") {
    lines.push("(번들 SIF 비어 있음 — `npm run sync-kosha` 실행 필요)");
  } else if (sif?.results && sif.results.length > 0) {
    for (const p of sif.results) {
      lines.push(`### ${p.workType} / ${p.hazardCode}`);
      lines.push(`- **근본원인**: ${(p.rootCauses as string[]).join("; ")}`);
      lines.push(`- **저감대책**: ${(p.controls as string[]).join("; ")}`);
      lines.push("");
    }
  } else {
    lines.push("(매칭된 SIF 패턴 없음)");
  }

  // [4] 공종 위험요인 분석 (analyze 결과 요약)
  lines.push("## 🎯 공종 위험요인 분석");
  lines.push("");
  if (analyze?.matched) {
    const hz = (analyze.hazards ?? []) as Array<{ code: string; ko: string; riskLevel: string }>;
    lines.push(`**매칭 공종**: ${analyze.matched.subtask?.ko ?? ""} (${analyze.matched.subtask?.code ?? ""})`);
    lines.push("");
    lines.push("**주요 위험요인**:");
    for (const h of hz) {
      const emoji = h.riskLevel === "high" ? "🔴" : h.riskLevel === "medium" ? "🟡" : "🟢";
      lines.push(`- ${emoji} ${h.ko} (${h.code}) — ${h.riskLevel}`);
    }
    if (analyze.checklistHints) {
      lines.push("");
      lines.push("**체크리스트 힌트**:");
      for (const hint of analyze.checklistHints.slice(0, 5)) {
        lines.push(`- ${hint}`);
      }
    }
  } else {
    lines.push("(공종 매칭 실패)");
  }
  lines.push("");

  // [5] 권장 Tool 체인 (문서유형별)
  // 주의: 문서 필드 Validator (validate_*_draft) 는 본 MCP 범위 밖이며
  //       품질관리 도메인 (agent-quality-oss-mcp, 별도 프로젝트) 책임이다.
  //       여기서는 근거 등급 검증(verify_safety_basis) 만 체인에 넣는다.
  lines.push("## 🔗 권장 Tool 체인");
  lines.push("");
  lines.push(
    `1. \`get_${input.docType === "general" ? "risk_assessment" : input.docType}_schema\` — 법정 필수 필드 구조 확인`,
  );
  lines.push("2. (위 자료 참조해 LLM 이 MD 초안 작성)");
  lines.push(
    "3. `verify_safety_basis(claims)` — 문장 단위 근거 등급 정합성 검증 (basisType × legalWeight, mandatory trigger)",
  );
  lines.push("");
  lines.push(
    "> 문서 필드 누락 검증·서명 완결성 같은 **품질 검증** 은 별도 프로젝트 `agent-quality-oss-mcp` 범위. 본 MCP 는 안전 도메인 지식만 관리.",
  );
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    "**LLM 지침**: 위 자료들을 인용할 때는 반드시 **출처 표기** 및 **basisType/legalWeight** 를 명시. 법령 mandatory 근거는 `get_safety_law_article` 로 전문 조회해 정확히 인용.",
  );

  const md = lines.join("\n");

  return {
    content: [{ type: "text", text: md }],
    structuredContent: {
      query: input,
      sources: {
        analyze: analyze
          ? { matched: analyze.matched, hazardCount: (analyze.hazards ?? []).length }
          : null,
        sif: sif
          ? { bundleStatus: sif.bundleStatus, count: (sif.results ?? []).length }
          : null,
        guide: guide
          ? { bundleStatus: guide.bundleStatus, count: (guide.results ?? []).length }
          : null,
        law: {
          searchKeywords: DOC_TYPE_LAW_KEYWORDS[input.docType] ?? [],
          bundles: lawResults.length,
          count: lawReferenceCount,
        },
      },
      totalReferences,
      totalCount: totalReferences,
      breakdown: {
        law: lawReferenceCount,
        koshaGuide: guideReferenceCount,
        sif: sifReferenceCount,
        workRiskAnalysis: analysisReferenceCount,
      },
    },
  };
}

function docTypeKo(code: string): string {
  switch (code) {
    case "risk_assessment":
      return "위험성평가서";
    case "work_plan":
      return "작업계획서";
    case "tbm":
      return "TBM";
    case "ops":
      return "OPS";
    case "work_permit":
      return "작업허가서";
    case "daily_inspection":
      return "일일점검표";
    default:
      return "일반 안전문서";
  }
}

export const compileSafetyReferencesTool: ToolDefinition = {
  name: "compile_safety_references",
  title: "문서유형·공종별 참조 자료 번들",
  description:
    "공종 + 문서유형(위험성평가/작업계획서/TBM/OPS/작업허가서/일일점검표) 입력 시, 해당 문서 작성에 필요한 **법령(mandatory) + KOSHA Guide(recommended) + SIF 패턴(reference) + 공종 위험요인 분석** 을 한 번에 번들해 Markdown 으로 반환. LLM 은 get_*_schema 의 필드 + 이 Reference 조합으로 문서 초안 작성.",
  inputSchema,
  handler,
};
