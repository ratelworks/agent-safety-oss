import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import sifData from "../ontology/sif-archive.json" with { type: "json" };

// 파일 최상단 상수 — 15140383 사망사고 고위험요인(SIF) 아카이브
// 번들 기본은 빈 placeholder. 실제 데이터는 npm run sync-kosha 로 사용자 로컬에 채움.
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

const inputSchema = z.object({
  workType: z.string().optional().describe("작업 공종 키워드 (예: '거푸집', '타워크레인')"),
  hazardCode: z
    .string()
    .optional()
    .describe("위험요인 코드 (FALL/STRUCK_BY/COLLAPSE 등, hazard-type.json 참조)"),
  keyword: z
    .string()
    .optional()
    .describe("rootCauses/controls 자유 키워드 (예: '안전대', '방호망')"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

type Input = z.infer<typeof inputSchema>;

interface SifPattern {
  workType: string;
  hazardCode: string;
  rootCauses: string[];
  controls: string[];
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const patterns = (sifData.patterns ?? []) as SifPattern[];

  // 빈 번들 처리 — publish 기본 상태 (KOGL 변경금지 회피)
  if (patterns.length === 0) {
    const payload = {
      query: input,
      dataId: sifData.dataId,
      source: sifData.source,
      sourceUrl: (sifData as any).sourceUrl,
      license: sifData.license,
      bundleStatus: "empty" as const,
      total: 0,
      returned: 0,
      results: [],
      notice: sifData.notice,
      howToLoadData: [
        `1) ${(sifData as any).sourceUrl} 에서 원본 XLSX 다운로드`,
        "2) ./data/sif-archive.xlsx 로 배치",
        "3) npm i -D xlsx && npm run sync-kosha 실행",
      ],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }

  const kw = input.keyword?.trim().toLowerCase();
  const workKw = input.workType?.trim().toLowerCase();

  const matches = patterns.filter((p) => {
    if (input.hazardCode && p.hazardCode !== input.hazardCode) return false;
    if (workKw) {
      const w = p.workType.toLowerCase();
      if (!w.includes(workKw) && !workKw.includes(w)) return false;
    }
    if (kw) {
      const haystack = [p.workType, ...p.rootCauses, ...p.controls].join(" ").toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });

  const sliced = matches.slice(0, input.limit);

  const payload = {
    query: input,
    dataId: sifData.dataId,
    source: sifData.source,
    sourceUrl: (sifData as any).sourceUrl,
    license: sifData.license,
    bundleStatus: "loaded" as const,
    lastSyncedAt: sifData.lastSyncedAt,
    total: matches.length,
    returned: sliced.length,
    results: sliced.map((p) => ({
      workType: p.workType,
      hazardCode: p.hazardCode,
      rootCauses: p.rootCauses,
      controls: p.controls,
      basisType: "statistics",
      legalWeight: "reference",
      source: "KOSHA",
    })),
    graphContext: {
      primaryStatistic: "stat:sif_archive_kosha",
      relatedStatistics: [
        "stat:construction_fatal_top_5",
        "stat:industrial_accident_construction_share",
      ],
      relatedEvents: [
        "event:fall_from_height", "event:caught_in", "event:struck_by",
        "event:cave_in", "event:fall_object", "event:electric_shock",
      ],
      relatedAssessmentMethod: "method:kras_step_2_identify",
      sources: ["src:data_go_kr", "src:kosha_portal"],
    },
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export const searchSifArchiveTool: ToolDefinition = {
  name: "search_sif_archive",
  title: "사망사고 고위험요인 아카이브 (15140383)",
  description:
    "KOSHA 사망사고 고위험요인(SIF) 아카이브(15140383) — 건설 중대재해를 '공종 × 재해유형 × 근본원인 × 저감대책' 4축으로 구조화한 **로컬 번들 데이터**. 기본 번들은 비어 있으며(KOGL 변경금지 준수), npm run sync-kosha 로 사용자 PC에 공식 XLSX 를 파싱해 저장한다. **구분:** 건별 실제 사고 기록은 search_construction_fatal_accidents(건설) / search_all_fatal_accidents(전 업종).",
  inputSchema,
  handler,
};
