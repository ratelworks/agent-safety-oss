#!/usr/bin/env tsx
/**
 * test-dclx-output.ts — 정본(.dclx)과 정본에서 만든 한글 파일
 *
 *   1. .dclx 꾸러미가 공식 도구(doclang 0.9.0 의 pack)가 묶은 것과 같은 부분·순서·내용이다 (시험 자료: fixtures/dclx)
 *   2. 문서를 만들면 기본으로 정본을 저장하고, 미리보기 Markdown 을 함께 돌려준다
 *   3. 정본은 결재·제출용 문서다 — 검사 상태·안내문·작성 안내·도구 표기·§ 기호가 없고, 빈 칸은 빈칸이며, 절 제목에 근거와 수록 판본이 있다
 *   4. 한글 파일은 정본에서 만든다 — 값의 기호("10*20*30", "<확인> & 정리")가 그대로 남는다 (Markdown 을 거치면 "102030" 이 된다)
 *   5. 한글 파일에 결재본(Markdown 경로)의 내용이 빠짐없이 들어 있다
 *
 * 정본 DocLang 은 공식 검증기(doclang 0.9.0 의 validate — XSD·Schematron)도 통과한다 — 이 시험은 Python 도구 없이 돌도록
 * 그 검증을 싣지 않는다. 손으로 확인: uvx --from "doclang[schematron-saxon]==0.9.0" doclang validate <파일>
 *
 * 사용: tsx scripts/test/test-dclx-output.ts
 */
import "./isolated-storage.js"; // 저장 폴더를 임시 폴더로 — 사용자 문서 폴더에 파일을 남기지 않는다
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSafetyDocumentTool } from "../../src/tools/generate-safety-document.js";
import { packDclx, unpackDclx } from "../../src/lib/dclx.js";
import { unzip, zip } from "../../src/lib/zip.js";
import { toApprovalCopy } from "../../src/lib/approval-copy.js";
import { markdownToHwpx } from "../../src/lib/hwpx-writer.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures", "dclx");
const SYMBOL_VALUE = "규격 10*20*30 자재 반입 <확인> & 정리";
/** 결재본 대조에 쓰는 문서 — 작업 문서·위험성평가·작업계획서·보고서·교육 일지 */
const PARITY_DOCS = ["daily_tbm", "ad_hoc_risk_assessment", "work_plan_tower_crane", "industrial_accident_report", "special_education_log", "msds_register"];
const PARITY_DRAFT = { workName: "타워크레인 지브 조립", workConditions: ["강풍"], siteName: "시험 현장", riskRows: [{ task: "인양", hazard: "낙하", currentRisk: "상" }] };
/** 결재본에만 있는 자리 표시 — 정본은 손으로 채울 빈칸으로 둔다 */
const PLACEHOLDER = /\((미작성|미서명|미기재)(—필수|—작성필수)?\)$/;

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}
const textOf = (r: { content: Array<{ type: string; text?: string }> }): string => r.content.map((c) => c.text ?? "").join("\n");
/** 한글 파일 본문의 글 — section0.xml 의 글 조각 */
function hwpxText(path: string): string {
  const section = unzip(readFileSync(path)).get("Contents/section0.xml")?.toString("utf8") ?? "";
  return [...section.matchAll(/<hp:t>([^<]*)<\/hp:t>/g)]
    .map((m) => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"))
    .join("\n");
}
/** 비교용 — 띄어쓰기·구분 기호·가운뎃점 표기·서식 기호 차이를 없앤다 */
const flat = (s: string): string => s.replace(/^_|_$/g, "").replace(/\*\*/g, "").replace(/<br>/g, "").replace(/[\s/]+/g, "").replace(/ㆍ/g, "·");

async function main(): Promise<void> {
  // 1. 공식 도구와 같은 꾸러미
  const tiny = readFileSync(resolve(FIXTURES, "tiny.xml"), "utf8");
  const official = unzip(readFileSync(resolve(FIXTURES, "tiny.official.dclx")));
  const ours = unzip(packDclx(tiny));
  check(
    "정본 꾸러미가 공식 도구(doclang 0.9.0 pack)와 같은 부분·순서·내용",
    [...official.keys()].join("|") === [...ours.keys()].join("|") && [...official].every(([name, data]) => ours.get(name)?.equals(data)),
    [...ours.keys()].join(", "),
  );
  check("정본을 풀면 넣은 DocLang 문서가 그대로 나온다", unpackDclx(packDclx(tiny)).documentXml === tiny);
  let rejected = false;
  try {
    unpackDclx(zip([{ name: "document.xml", data: Buffer.from(tiny) }]));
  } catch {
    rejected = true;
  }
  check("규격의 필수 부분이 없는 꾸러미는 정본으로 받지 않는다", rejected);

  // 2. 기본 형식 = 정본 저장 + 미리보기
  const draft = { ...PARITY_DRAFT, todayWork: SYMBOL_VALUE };
  const generated = await generateSafetyDocumentTool.handler({ docId: "daily_tbm", draft, useProfile: false });
  const meta = generated.structuredContent as { dclxPath?: string };
  const storage = resolve(process.env.SAFETY_LOCAL_DIR ?? "");
  check("형식을 주지 않으면 정본(.dclx)을 저장한다", !!meta.dclxPath && meta.dclxPath.endsWith(".dclx") && existsSync(meta.dclxPath) && resolve(meta.dclxPath).startsWith(storage), meta.dclxPath ?? "");
  check("응답에 미리보기 Markdown 과 정본 경로가 함께 있다", textOf(generated).includes("\n# TBM 회의록") && textOf(generated).includes(meta.dclxPath ?? "없음"));

  // 3. 정본은 결재·제출용 문서
  const canonical = unpackDclx(readFileSync(meta.dclxPath ?? "")).documentXml;
  const noise = ["결재 사용 불가", "자동 검사 통과", "agent-safety-oss 가 생성한 초안", "§", "ERIC-PP", "(그래프 추론", "작성 방법", "예시:", "(미작성", "(미서명"].filter((n) => canonical.includes(n));
  check("정본에 검사 상태·안내문·작성 안내·도구 표기·§ 기호·자리 표시가 없다", noise.length === 0, noise.join(", "));
  check("정본 절 제목에 근거가 있고 법령 근거 끝에 수록 판본이 있다", /<heading level="2">[^<]*<custom>[\s\S]*?<\/custom>[^<]*\(위험성평가 고시 제16조제1항제3호/.test(canonical) && canonical.includes("수록 판본:"));
  check("정본은 DocLang 0.9 문서다", /^<doclang xmlns="https:\/\/www\.doclang\.ai\/ns\/v0" version="0\.9">/.test(canonical));

  // 4. 한글 파일은 정본에서 — 값의 기호가 그대로
  const hwpx = await generateSafetyDocumentTool.handler({ docId: "daily_tbm", draft, useProfile: false, format: "hwpx" });
  const hwpxMeta = hwpx.structuredContent as { hwpxPath?: string; dclxPath?: string };
  check("한글 파일과 정본을 함께 저장한다", !!hwpxMeta.hwpxPath && existsSync(hwpxMeta.hwpxPath) && !!hwpxMeta.dclxPath && existsSync(hwpxMeta.dclxPath));
  const fileText = hwpxText(hwpxMeta.hwpxPath ?? "");
  check(`한글 파일에 값이 적힌 그대로 남는다 ("${SYMBOL_VALUE}")`, fileText.includes(SYMBOL_VALUE));
  const markdownPath = (await generateSafetyDocumentTool.handler({ docId: "daily_tbm", draft, useProfile: false, format: "md" })) as { content: Array<{ type: string; text?: string }> };
  const viaMarkdown = unzip(markdownToHwpx(toApprovalCopy(textOf(markdownPath)), { title: "대조" })).get("Contents/section0.xml")?.toString("utf8") ?? "";
  check("대조: Markdown 을 거쳐 만든 한글 파일은 그 값을 바꾼다 (이 시험이 차이를 잡는다)", !viaMarkdown.includes("10*20*30") && viaMarkdown.includes("102030"));

  // 5. 결재본 내용이 빠짐없이
  for (const docId of PARITY_DOCS) {
    const md = textOf(await generateSafetyDocumentTool.handler({ docId, draft: PARITY_DRAFT, useProfile: false, format: "md" }));
    const out = await generateSafetyDocumentTool.handler({ docId, draft: PARITY_DRAFT, useProfile: false, format: "hwpx" });
    const file = flat(hwpxText((out.structuredContent as { hwpxPath: string }).hwpxPath));
    const missing = toApprovalCopy(md)
      .split("\n")
      .flatMap((line) => (line.startsWith("|") ? line.split("|") : [line.replace(/^#+\s*|^[-*]\s+|^>\s*/g, "")]))
      .map((s) => s.trim())
      .filter((s) => s && !/^:?-{3,}:?$/.test(s) && s !== "```" && s !== "값" && !PLACEHOLDER.test(s.replace(/\s+/g, "")))
      // 대책이 없는 문서의 빈 절은 정본에 싣지 않는다
      .filter((s) => !(s === "권장 안전대책" || s === "(그래프 매핑된 Control 없음)"))
      .filter((s) => !file.includes(flat(s)));
    check(`${docId}: 결재본의 내용이 한글 파일(정본 경로)에 모두 있다`, missing.length === 0, missing.slice(0, 5).join(" / "));
  }

  console.log(failed ? `\n❌ ${failed}개 실패` : "\n✅ 전체 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
