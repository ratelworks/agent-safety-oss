import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import subtaskData from "../ontology/construction-subtasks.json" with { type: "json" };

// 파일 최상단 상수 — 15087828 건설업 공종별 세부공정 목록
// 위험성평가 체크리스트 표준 공종 분류

const inputSchema = z.object({
  mainCategory: z
    .string()
    .optional()
    .describe("주공종 필터 — 코드(EARTH/RC/STEEL/SCAFFOLD...) 또는 한글명('토공사', '철근콘크리트공사')"),
  keyword: z
    .string()
    .optional()
    .describe("세부공정명 키워드 (예: '거푸집', '타워크레인')"),
  hazardCode: z
    .string()
    .optional()
    .describe("주요 위험요인 코드로 필터 (FALL/COLLAPSE 등)"),
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

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const categories = (subtaskData.mainCategories ?? []) as MainCategory[];

  // 빈 번들 처리
  if (categories.length === 0) {
    const payload = {
      query: input,
      dataId: subtaskData.dataId,
      source: subtaskData.source,
      sourceUrl: (subtaskData as any).sourceUrl,
      license: subtaskData.license,
      bundleStatus: "empty" as const,
      totalCategories: 0,
      totalSubtasks: 0,
      categories: [],
      notice: (subtaskData as any).notice,
      howToLoadData: [
        `1) ${(subtaskData as any).sourceUrl} 에서 원본 XLSX 다운로드`,
        "2) ./data/construction-subtasks.xlsx 로 배치",
        "3) npm i -D xlsx && npm run sync-kosha 실행",
      ],
      fallback:
        "공식 공종 분류를 아직 로드하지 못했다. 간이 작업공종 조회는 analyze_construction_work_risks 가 내부 번들(construction-worktype.json, project-internal MIT)로 대신 처리 가능.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }

  const mainKw = input.mainCategory?.trim().toLowerCase();
  const kw = input.keyword?.trim().toLowerCase();

  const filteredCategories = categories
    .filter((c) => {
      if (!mainKw) return true;
      return (
        c.code.toLowerCase() === mainKw ||
        c.ko.toLowerCase().includes(mainKw) ||
        mainKw.includes(c.ko.toLowerCase())
      );
    })
    .map((c) => ({
      ...c,
      subtasks: c.subtasks.filter((s) => {
        if (input.hazardCode && !s.mainHazards.includes(input.hazardCode)) return false;
        if (kw) {
          const hay = [s.code, s.ko].join(" ").toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      }),
    }))
    .filter((c) => c.subtasks.length > 0);

  const totalSubtasks = filteredCategories.reduce((n, c) => n + c.subtasks.length, 0);

  const payload = {
    query: input,
    dataId: subtaskData.dataId,
    source: subtaskData.source,
    license: subtaskData.license,
    totalCategories: filteredCategories.length,
    totalSubtasks,
    categories: filteredCategories,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export const listConstructionSubtasksTool: ToolDefinition = {
  name: "list_construction_subtasks",
  title: "건설업 공종별 세부공정 (15087828)",
  description:
    "KOSHA 건설업 공종별 세부공정 목록(15087828) — 위험성평가(RA) 체크리스트 표준 공종 분류. 주공종(토공사/철근콘크리트/철골/가설/해체/양중/마감/MEP/기타) × 세부공정 × 주요 위험요인 계층. RA 문서의 공종 구조를 짤 때 SSoT 로 사용.",
  inputSchema,
  handler,
};
