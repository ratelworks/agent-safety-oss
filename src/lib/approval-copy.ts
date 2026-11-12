/**
 * approval-copy.ts — 생성된 Markdown 본문을 결재·제출용으로 정리한다
 *
 * 생성 본문에는 AI 비서와 개발자를 위한 안내(작성 가이드, 검사 상태 머리말, 도구 표기)가 섞여 있다.
 * 사람이 받아 보는 파일(HWPX 등)에는 이 안내를 빼고 법령 기호를 한글 표기로 바꾼다.
 * 브라우저 입력 폼의 미리보기도 같은 규칙을 쓴다(그쪽은 화면 코드 안에 따로 구현돼 있다).
 */

// ── 상수 ────────────────────────────────────────────────────────────
/** 괄호째 지우는 도구 표기의 시작 문구 */
const INLINE_META_PREFIXES = ["(kordoc/pdftotext", "(그래프 추론", "(ERIC-PP 위계"];
const DISCLAIMER_LOOKAHEAD_LINES = 5;
const TOOL_NAME = "agent-safety-oss";

/** § 36 → 제36조, ¶ 2 → 제2항, Art. 5 → 제5조 */
export function humanizeLawSymbols(text: string): string {
  return text
    .replace(/§\s*(\d+)/g, "제$1조")
    .replace(/¶\s*(\d+)/g, "제$1항")
    .replace(/\bArt\.?\s*(\d+)/g, "제$1조");
}

function stripInlineParen(line: string, prefix: string): string {
  const start = line.indexOf(prefix);
  if (start < 0) return line;
  const close = line.indexOf(")", start);
  if (close < 0) return line;
  return (line.slice(0, start).replace(/\s+$/, "") + line.slice(close + 1)).replace(/\s+\./g, ".");
}

/** AI 비서·개발자용 안내를 본문에서 뺀다 */
export function stripGeneratedNoise(text: string): string {
  // 1차 — 첫 절 제목(##) 앞의 인용문과 구분선(검사 상태 머리말, 작성 안내)을 뺀다. 문서 제목(#)은 남긴다
  const lines: string[] = [];
  let inPreamble = true;
  for (const line of text.split("\n")) {
    if (inPreamble) {
      if (line.startsWith("## ") || line.startsWith("### ")) inPreamble = false;
      else if (line.startsWith(">") || line.trim() === "---") continue;
    }
    lines.push(line);
  }

  // 2차 — 본문 안의 안내 블록과 도구 표기를 뺀다
  const out: string[] = [];
  let skipBlock = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (skipBlock) {
      if (line.startsWith("## ") || line.startsWith("---")) skipBlock = false;
      else continue;
    }
    if (line.includes("결재 사용 불가") && line.startsWith(">")) continue;
    if (line.includes("자동 검사 통과") && line.startsWith(">")) continue;
    if (line.includes("📝") && line.includes("작성 가이드")) {
      skipBlock = true;
      continue;
    }
    if (line.startsWith("## ") && line.includes("적용 KOSHA Guide") && line.includes("(0건)")) {
      skipBlock = true;
      continue;
    }
    if (line.startsWith("> ") && line.includes("ERIC-PP") && line.includes("5계층")) continue;
    if (line.startsWith("> 직접 매핑")) continue;
    // 맨 끝의 도구 안내문(구분선 뒤 몇 줄 안에 도구 이름이 나오면 거기서 끝낸다)
    if (line.trim() === "---" && lines.slice(i + 1, i + 1 + DISCLAIMER_LOOKAHEAD_LINES).join(" ").includes(TOOL_NAME)) break;

    let cleaned = line;
    for (const prefix of INLINE_META_PREFIXES) cleaned = stripInlineParen(cleaned, prefix);
    out.push(cleaned.split("ERIC-PP 위계").join("통제수단 위계").split("ERIC-PP").join("통제수단"));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 결재·제출용 본문 */
export function toApprovalCopy(markdown: string): string {
  return stripGeneratedNoise(humanizeLawSymbols(markdown));
}
