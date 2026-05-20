import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  getArchiveFiles,
  buildDownloadUrl,
} from "../lib/kosha-archive-client.js";
import { KOSHA_GONGGONGNURI_ATTRIBUTION } from "../config/constants.js";

// 파일 최상단 상수 — 특정 KOSHA 자료의 첨부 파일 bundle + 다운로드 URL
// search_kosha_archive 의 contsAtcflNo 를 입력으로 받음

const inputSchema = z.object({
  contsAtcflNo: z
    .string()
    .describe(
      "search_kosha_archive 결과의 contsAtcflNo (첨부 bundle ID). 예: HTR2026042019210086263189",
    ),
});

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const files = await getArchiveFiles(input.contsAtcflNo);

  const lines: string[] = [];
  lines.push(`# KOSHA 자료 첨부 파일 (\`${input.contsAtcflNo}\`)`);
  lines.push("");

  if (files.length === 0) {
    lines.push(
      "[NOT_FOUND] 해당 contsAtcflNo 에 첨부 파일 없음. 정확한 ID 인지 search_kosha_archive 결과 재확인.",
    );
  } else {
    lines.push(`> ${files.length}개 파일 (각 atcflSeq 별 다운로드)`);
    lines.push("");
    for (const f of files) {
      const sizeMb = (f.atcflSz / 1024 / 1024).toFixed(2);
      const downloadUrl = buildDownloadUrl(
        f.atcflNo,
        f.atcflSeq,
        f.orgnlAtchFileNm,
        f.mimeType ?? "application/octet-stream",
      );
      lines.push(`## seq ${f.atcflSeq} — ${f.orgnlAtchFileNm}`);
      lines.push(`- 형식: ${f.atcflExtnNm.toUpperCase()} · ${sizeMb}MB`);
      lines.push(`- MIME: ${f.mimeType ?? "(미지정)"}`);
      lines.push(`- 다운로드: ${downloadUrl}`);
      lines.push("");
    }
  }

  lines.push(`## 사용 시 유의사항`);
  lines.push("");
  lines.push(
    `- 각 파일의 공공누리 유형은 search_kosha_archive 결과의 medGonggongnuriNm 참조`,
  );
  lines.push(`- 출처 표기 의무 (공공누리 유형 공통): "${KOSHA_GONGGONGNURI_ATTRIBUTION}"`);
  lines.push(
    `- 변경금지(제3·4유형) 자료는 원본 그대로 사용. 상업금지(제2·4유형) 자료는 영리 목적 사용 금지.`,
  );

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      contsAtcflNo: input.contsAtcflNo,
      files: files.map((f) => ({
        ...f,
        downloadUrl: buildDownloadUrl(
          f.atcflNo,
          f.atcflSeq,
          f.orgnlAtchFileNm,
          f.mimeType ?? "application/octet-stream",
        ),
      })),
    },
  };
}

export const getKoshaArchiveFilesTool: ToolDefinition = {
  name: "get_kosha_archive_files",
  title: "KOSHA 자료 첨부 파일 정보 + 다운로드 URL",
  description:
    "search_kosha_archive 의 contsAtcflNo 입력 시 해당 자료의 첨부 파일 bundle (웹용/인쇄용/원본 AI 등 atcflSeq 별 여러 파일) + 다운로드 URL 조립. 한 자료에 보통 2~3개 파일이 묶여있음. **API 키 불필요**.",
  inputSchema,
  handler,
};
