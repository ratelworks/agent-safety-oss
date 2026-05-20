import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  searchArchive,
  SHP_CODE_MAP,
} from "../lib/kosha-archive-client.js";
import { formatYYYYMMDD } from "../lib/format-helpers.js";
import { KOSHA_GONGGONGNURI_ATTRIBUTION } from "../config/constants.js";

// 파일 최상단 상수 — KOSHA 산업안전포털 안전보건자료실 8,976건 Live 검색
// keyless. selectMediaList endpoint (검증 완료, 평균 0.298s)
// 응답에 medGonggongnuriNm 자동 포함 → 자료별 공공누리 유형 자동 노출

const inputSchema = z.object({
  keyword: z
    .string()
    .optional()
    .describe(
      "검색 키워드 (예: '추락', '굴착', '안전모'). 미지정 시 전체 결과",
    ),
  shpCd: z
    .enum(["ops", "video", "book", "ppt", "other"])
    .default("ops")
    .describe(
      "콘텐츠 형식 — ops(OPS 1페이지) / video(동영상) / book(책자) / ppt(교안) / other(기타). 기본 ops",
    ),
  ctgr01: z.string().optional().describe("일반분야 코드 (CONTS_GNRL_CD) — list_kosha_archive_facets({ctgr:'ctgr01'}) 로 코드 확인"),
  ctgr02: z.string().optional().describe("기계설비 코드 (CONTS_MCHN_FXTR_REL_CD) — 예: '10' 크레인"),
  ctgr03: z.string().optional().describe("작업 코드 (CONTS_JOB_REL_CD) — 예: '04' 굴착작업"),
  ctgr04: z.string().optional().describe("직업건강 코드 (CONTS_CR_HLTH_REL_CD) — 예: '21' 밀폐공간"),
  ctgr05: z.string().optional().describe("특수형태 코드 (CONTS_SPCL_SHP_CD) — 예: '02' 배달종사자"),
  page: z.coerce.number().int().min(1).default(1),
  rowsPerPage: z.coerce.number().int().min(1).max(50).default(10),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const shpCdNum = SHP_CODE_MAP[input.shpCd].code;
  const result = await searchArchive({
    shpCd: shpCdNum,
    searchValue: input.keyword,
    ctgr01: input.ctgr01,
    ctgr02: input.ctgr02,
    ctgr03: input.ctgr03,
    ctgr04: input.ctgr04,
    ctgr05: input.ctgr05,
    page: input.page,
    rowsPerPage: input.rowsPerPage,
  });

  // MD 응답
  const lines: string[] = [];
  lines.push(`# KOSHA 안전보건자료실 검색 결과`);
  lines.push("");
  lines.push(
    `> 형식: **${SHP_CODE_MAP[input.shpCd].ko}** · 키워드: ${input.keyword ?? "(전체)"} · 페이지 ${input.page}/${Math.ceil(result.total / input.rowsPerPage) || 1}`,
  );
  lines.push(`> 결과: **${result.items.length}건** (총 ${result.total}건)`);
  lines.push(
    `> 출처: KOSHA 산업안전포털 (https://portal.kosha.or.kr/archive/cent-archive/master-arch)`,
  );
  lines.push(`> 라이선스: 공공누리 (자료별 medGonggongnuriNm 확인)`);
  lines.push("");

  if (result.items.length === 0) {
    lines.push("[NOT_FOUND] 검색 결과 없음. 키워드 변경 또는 facet 조정 권장.");
  } else {
    for (const item of result.items) {
      const date = formatYYYYMMDD(item.contsRegYmd);
      lines.push(`## ${item.medName}`);
      lines.push(`- 발행일: ${date} · 조회수: ${item.totHitSum}`);
      lines.push(`- 공공누리: ${item.medGonggongnuriNm ?? "(미표기)"}`);
      if (item.medKeyword) {
        lines.push(`- 키워드: ${item.medKeyword.split(",").slice(0, 8).join(", ")}`);
      }
      if (item.medNote) {
        lines.push(`- 설명: ${item.medNote.slice(0, 200)}`);
      }
      lines.push(`- 첨부: \`get_kosha_archive_files({contsAtcflNo: "${item.contsAtcflNo}"})\``);
      lines.push(`- 발행번호: ${item.contsPblsNo}`);
      lines.push("");
    }
  }

  lines.push(`## 다음 단계`);
  lines.push(
    `- 자료 첨부 파일 받기: \`get_kosha_archive_files({contsAtcflNo})\``,
  );
  lines.push(
    `- 사용 가능한 facet 코드 확인: \`list_kosha_archive_facets({ctgr})\``,
  );
  lines.push(`- 인용 시 출처 표기: "${KOSHA_GONGGONGNURI_ATTRIBUTION}"`);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      query: input,
      total: result.total,
      page: result.page,
      rowsPerPage: result.rowsPerPage,
      items: result.items.map((it) => ({
        contsAtcflNo: it.contsAtcflNo,
        contsPblsNo: it.contsPblsNo,
        medName: it.medName,
        medNote: it.medNote,
        medKeyword: it.medKeyword,
        contsRegYmd: it.contsRegYmd,
        contsFbctnShpCd: it.contsFbctnShpCd,
        contsFbctnShpNm: it.contsFbctnShpNm,
        totHitSum: it.totHitSum,
        medGonggongnuri: it.medGonggongnuri,
        medGonggongnuriNm: it.medGonggongnuriNm,
      })),
      graphContext: {
        sources: ["src:kosha_portal"],
        relatedManuals: [
          "manual:kosha_ms",
          "manual:risk_assessment_practical",
          "manual:construction_disaster_prevention",
        ],
        koshaMsDomains: [
          "manual:kosha_ms_domain_leadership",
          "manual:kosha_ms_domain_planning",
          "manual:kosha_ms_domain_operation",
          "manual:kosha_ms_domain_check",
          "manual:kosha_ms_domain_review",
        ],
      },
    },
  };
}

export const searchKoshaArchiveTool: ToolDefinition = {
  name: "search_kosha_archive",
  title: "KOSHA 안전보건자료실 Live 검색 (8,976건)",
  description:
    "KOSHA 산업안전포털 안전보건자료실의 OPS·동영상·책자·교안·기타 8,976건을 Live 로 검색. 키워드 + 5개 facet (일반분야·기계설비·작업·직업건강·특수형태) + 페이지네이션. 응답에 자료별 공공누리 유형(medGonggongnuriNm) 자동 포함. 검색 후 contsAtcflNo 로 get_kosha_archive_files 호출하여 다운로드 URL 조립. **API 키 불필요** (KOSHA portal24 비로그인 endpoint).",
  inputSchema,
  handler,
};
