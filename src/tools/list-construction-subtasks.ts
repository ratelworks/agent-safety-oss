import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import subtaskData from "../ontology/construction-subtasks.json" with { type: "json" };
import { listWorks } from "../lib/work-steps.js";

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

  // 공식 분류표(15087828)를 싣지 않았으면 프로젝트가 정리한 공종 노드(그래프)로 답한다
  if (categories.length === 0) {
    const mainKwLocal = input.mainCategory?.trim();
    const kwLocal = input.keyword?.trim();
    const groups = (await listWorks())
      .filter((g) => !mainKwLocal || g.group.includes(mainKwLocal) || mainKwLocal.includes(g.group))
      .map((g) => ({
        group: g.group,
        works: g.works.filter((w) => !kwLocal || w.name.includes(kwLocal) || w.steps.some((st) => st.includes(kwLocal))),
      }))
      .filter((g) => g.works.length > 0);
    if (groups.length > 0) {
      const graphPayload = {
        query: input,
        source: "프로젝트 자체 정리 공종 (그래프의 공종 노드) — 공단의 공식 공종 분류(15087828)가 아니다",
        totalGroups: groups.length,
        totalWorks: groups.reduce((n, g) => n + g.works.length, 0),
        groups,
        nextSteps: [
          "analyze_construction_work_risks({workType: '<공종 이름>'}) — 단계별 재해유형·근거(조문의 호·목, KOSHA Guide 조항)·관련 지침·관련 문서",
          "generate_tbm_topics({activityLabel: '<공종 이름> <단계>'}) — 그 단계의 TBM 주제",
        ],
        ...(input.hazardCode ? { note: "hazardCode 필터는 공식 분류표 전용이라 적용하지 않았다." } : {}),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(graphPayload, null, 2) }],
        structuredContent: graphPayload,
      };
    }
  }

  // 빈 번들 처리 (공종 노드에서도 찾지 못한 경우)
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
  title: "건설업 공종·작업 단계 목록",
  description:
    "건설 공종과 작업 단계 목록 — 대공종(가설·비계, 흙막이, 철골, 터널 등) × 공종(강관비계, 지하연속벽 등) × 단계(자재반입·조립·사용·해체 등). 프로젝트가 정리한 공종 노드로 답하며 공단의 공식 분류(15087828)가 아니다. mainCategory 로 대공종, keyword 로 공종·단계 이름을 거른다. 공종을 고른 뒤 analyze_construction_work_risks 로 단계별 재해유형과 근거를 조회한다.",
  inputSchema,
  handler,
};
