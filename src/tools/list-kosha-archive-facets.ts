import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  getFacetCodes,
  FACET_GROUP_IDS,
} from "../lib/kosha-archive-client.js";

// 파일 최상단 상수 — KOSHA 자료실의 5개 facet 코드 목록 조회
// search_kosha_archive 의 ctgr01~05 파라미터에 넣을 코드 확인용

const inputSchema = z.object({
  ctgr: z
    .enum(["ctgr01", "ctgr02", "ctgr03", "ctgr04", "ctgr05", "all"])
    .default("all")
    .describe(
      "facet 분류 — ctgr01(일반분야 17개) / ctgr02(기계설비 35+) / ctgr03(작업 24) / ctgr04(직업건강 28+) / ctgr05(특수형태 3). all 은 5개 모두",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const targets =
    input.ctgr === "all"
      ? Object.keys(FACET_GROUP_IDS)
      : [input.ctgr];

  // 5개 facet 을 병렬 조회 (각 0.3s × 5 → 0.3s 단축)
  const fetched = await Promise.all(
    targets.map(async (ctgr) => {
      const meta = FACET_GROUP_IDS[ctgr];
      const codes = await getFacetCodes(meta.groupId);
      return [ctgr, { groupId: meta.groupId, ko: meta.ko, codes }] as const;
    }),
  );
  const allCodes: Record<
    string,
    { groupId: string; ko: string; codes: { code: string; name: string }[] }
  > = Object.fromEntries(fetched);

  // MD 응답
  const lines: string[] = [];
  lines.push(`# KOSHA 자료실 facet 코드`);
  lines.push("");
  lines.push(
    `> search_kosha_archive 의 ctgr01~05 파라미터에 사용할 코드. 단일 코드만 지원 (다중 코드 CSV 미지원).`,
  );
  lines.push("");

  for (const ctgr of targets) {
    const data = allCodes[ctgr];
    lines.push(`## ${ctgr} — ${data.ko} (${data.groupId}, ${data.codes.length}개)`);
    lines.push("");
    lines.push(`| 코드 | 이름 |`);
    lines.push(`|:---:|---|`);
    for (const c of data.codes) {
      lines.push(`| \`${c.code}\` | ${c.name} |`);
    }
    lines.push("");
  }

  lines.push(`## 사용 예시`);
  lines.push("");
  lines.push(`- 크레인 OPS 검색: \`search_kosha_archive({keyword:'크레인', shpCd:'ops', ctgr02:'10'})\``);
  lines.push(`- 밀폐공간 동영상: \`search_kosha_archive({shpCd:'video', ctgr04:'21'})\``);
  lines.push(`- 굴착작업 책자: \`search_kosha_archive({shpCd:'book', ctgr03:'04'})\``);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      query: input,
      facets: allCodes,
      graphContext: {
        sources: ["src:kosha_portal"],
        relatedManuals: ["manual:kosha_ms", "manual:risk_assessment_practical", "manual:construction_disaster_prevention"],
      },
    },
  };
}

export const listKoshaArchiveFacetsTool: ToolDefinition = {
  name: "list_kosha_archive_facets",
  title: "KOSHA 자료실 facet 코드 목록 (5개 분류)",
  description:
    "search_kosha_archive 의 ctgr01~05 파라미터에 넣을 facet 코드 목록을 KOSHA Live API 로 조회. 5개 분류: 일반분야(추락·비계·보호구 등 17개) / 기계설비(크레인·지게차·굴착기 등 35+개) / 작업(굴착·터널·해체 등 24개) / 직업건강(밀폐공간·소음·석면 등 28+개) / 특수형태(배달종사자 등 3개). **API 키 불필요**.",
  inputSchema,
  handler,
};
