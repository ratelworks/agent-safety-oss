#!/usr/bin/env tsx
/**
 * test-trust-boundaries.ts — "확인한 것과 확인하지 못한 것을 구분하는가" 회귀 시험
 *
 *   1. 근거 검증: 실존 조문은 통과, 전 조문 수록 법령에 없는 조문은 거절,
 *      수록 범위 밖 법령은 "확인 불가"(틀림 아님)
 *   2. 검토 전 연결: 가이드 연결 조회·현장 브리핑·법령 근거 조회가 검토 전 연결을 따로 표시
 *   3. 문서의 수록 판본 표시, 외부 전송·삭제 도구의 주의 표시
 *   4. 브라우저 입력 폼의 보조 버튼 → 도구 호출 변환
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
process.env.SAFETY_LOCAL_DIR = mkdtempSync(join(tmpdir(), "trust-boundaries-test-"));
process.env.AGENT_SAFETY_NO_OPEN = "1";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UNREVIEWED_PATH = join(ROOT, "src", "ontology", "graph", "unreviewed-links.json");

const { TOOLS } = await import("../../src/tool-registry.js");
const { resolveReference } = await import("../../src/lib/citation-resolver.js");
const { buildAssistCall } = await import("../../src/viewer.js");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Tool = { name: string; annotations?: Record<string, boolean>; handler: (i: unknown) => Promise<any> };
const tool = (name: string): Tool => (TOOLS as Tool[]).find((t) => t.name === name)!;
const call = async (name: string, input: unknown): Promise<any> => tool(name).handler(input);

async function verdict(claim: string, reference: string): Promise<{ status: string; outcome: string; isError: boolean; structured: any }> {
  const r = await call("verify_safety_basis", {
    claims: [{ claim, evidence: [{ basisType: "law", legalWeight: "mandatory", title: "근거", source: "LAW_MCP", reference }] }],
  });
  const v = r.structuredContent.verdicts[0];
  return { status: v.status, outcome: v.refChecks[0].outcome, isError: r.isError === true, structured: r.structuredContent };
}

// 1. 근거 검증
for (const [label, reference] of [
  ["제N조 표기", "산안법 제36조"],
  ["§ 표기·정식 법령명", "산업안전보건법 §36"],
  ["가지 조문", "산안법 시행규칙 제37조의2"],
  ["별표", "산안기준규칙 별표 4"],
] as const) {
  const v = await verdict("사업주는 조치를 해야 한다", reference);
  check(`실존 조문은 통과 — ${label}`, v.status === "supported" && v.outcome === "confirmed" && !v.isError, `${v.status}/${v.outcome}`);
}
const missing = await verdict("의무가 있다", "산안법 제999조");
check("전 조문 수록 법령에 없는 조문은 거절", missing.status === "invalid" && missing.outcome === "not_found" && missing.isError && missing.structured.summary.hallucinationCount === 1);
for (const [label, reference] of [
  ["수록하지 않은 법령", "건설산업기본법 제22조"],
  ["이름이 비슷한 다른 법령", "근로기준법 제50조"],
  ["일부만 수록한 법령", "건진법 제63조"],
] as const) {
  const v = await verdict("의무가 있다", reference);
  check(
    `수록 범위 밖은 확인 불가(틀림 아님) — ${label}`,
    v.status === "partial" && v.outcome === "unverifiable" && !v.isError && v.structured.summary.hallucinationCount === 0 && v.structured.summary.unverifiableCount === 1,
    `${v.status}/${v.outcome}`,
  );
}
const unrelated = await verdict("모든 근로자는 매일 체조를 해야 한다", "산안법 제36조");
check("확인 범위를 응답에 밝힘(내용 일치는 보지 않음)", typeof unrelated.structured.scope?.notChecked === "string" && unrelated.structured.scope.notChecked.includes("사람이 판단"));
check("법령이 다른 조문을 나열하면 각자의 법령으로 확인", (await resolveReference("산안법 제36조, 기준규칙 제669조")).outcome === "confirmed");
check("나열한 법령 중 수록하지 않은 것이 있으면 확인 불가", (await resolveReference("산안법 제36조, 건설산업기본법 제22조")).outcome === "unverifiable");
check("대조군: 기준규칙 제669조는 실존", (await resolveReference("기준규칙 제669조")).outcome === "confirmed");
const lawLookup = async (ref: string): Promise<boolean> => (await call("get_safety_law_article", { ref })).structuredContent.found !== false;
check("조문 조회: 제○조 표기를 읽음", await lawLookup("산안법 제38조"));
check("조문 조회: 수록하지 않은 법령을 다른 법령으로 대신하지 않음", !(await lawLookup("건설산업기본법 제36조")) && !(await lawLookup("건설산업기본법 §36")));
check("조문 조회: 이름이 비슷한 법령을 혼동하지 않음", !(await lawLookup("근로기준법 §38")));
check("별표 뒤에 없는 조문이 오면 거절", (await resolveReference("산안기준규칙 별표 4, 산안법 제999조")).outcome === "not_found");
check("조문 뒤에 확인 못 하는 별표가 오면 확인됨이 아님", (await resolveReference("산안법 제36조, 기준규칙 별표 999")).outcome !== "confirmed");
check("조문과 별표를 함께 적어도 둘 다 확인", (await resolveReference("산안법 제36조, 산안기준규칙 별표 4")).outcome === "confirmed");
check("읽지 못한 글자가 남으면 확인됨이 아님", (await resolveReference("산안법 제36조 그리고 어떤 고시")).outcome === "unverifiable");
check("괄호 부연은 읽지 못한 글자로 치지 않음", (await resolveReference("산안법 제36조 (위험성평가의 실시)")).outcome === "confirmed");
check("조문 제목을 덧붙인 표기는 확인됨", (await resolveReference("산안법 제36조 위험성평가의 실시")).outcome === "confirmed");
check("법령명 없는 인용은 확인 불가", (await resolveReference("제36조")).outcome === "unverifiable");
check("범위의 끝이 없는 조문이면 거절", (await resolveReference("산안법 제36조부터 제999조까지")).outcome === "not_found");
check("나열한 조문 중 하나가 없으면 거절", (await resolveReference("산안법 제36조, 제999조")).outcome === "not_found");
const range = await resolveReference("기준규칙 §338~§347");
check("범위는 양 끝만 대조했음을 알림", range.outcome === "confirmed" && (range.detailNote ?? "").includes("양 끝"));
const subItem = await resolveReference("산안법 제36조 제999항");
check("항·호는 대조하지 않았음을 알림", subItem.outcome === "confirmed" && (subItem.detailNote ?? "").includes("항·호"));
check("대조군: 조문만 적으면 알림 없음", (await resolveReference("산안법 제36조")).detailNote === undefined);
check("읽지 못한 표기는 확인 불가", (await resolveReference("어떤 근거")).outcome === "unverifiable");

// 2. 검토 전 연결
const unreviewed = (JSON.parse(readFileSync(UNREVIEWED_PATH, "utf8")) as { regulates: string[] }).regulates;
check("검토 전 연결 목록이 있음", unreviewed.length > 0, String(unreviewed.length));
const sample = unreviewed.find((p) => p.split("|")[1].startsWith("activity:"))!;
const [sampleArticle, sampleActivity] = sample.split("|");
const links = (await call("query_guide_links", { activitySlug: sampleActivity.replace("activity:", "") })).structuredContent;
check("가이드 연결 조회가 검토 전 조문을 따로 알림", (links.unreviewedRegulatedByArticles ?? []).includes(sampleArticle) && typeof links.unreviewedNote === "string");
check("검토 전 조문도 전체 목록에는 남아 있음", links.links.regulatedByArticles.includes(sampleArticle));
const briefing = (await call("field_safety_briefing", { workName: "석면 해체·제거" })).content[0].text as string;
check("현장 브리핑이 검토 전 연결을 표시", briefing.includes("(검토 전 연결)") && briefing.includes("검토 전 연결 —"));
const basis = (await call("query_legal_basis", { docId: "msds_register" })).structuredContent;
const sources = new Set((basis.legalBasis.iriMapped as Array<{ linkSource: string }>).map((a) => a.linkSource));
check("법령 근거 조회가 문서 근거와 조문 쪽 연결을 구분", sources.has("document") && sources.has("article-side"));

// 3. 수록 판본·주의 표시
const generated = (await call("generate_safety_document", { docId: "daily_tbm", useProfile: false })).content[0].text as string;
check("문서에 수록 판본과 현행 미확인 안내", /수록 판본: .*시행 \d{4}-\d{2}-\d{2}/.test(generated) && generated.includes("현행 여부는 확인하지 않습니다"));
check("외부 전송 도구에 주의 표시", tool("sync_to_cloud").annotations?.openWorldHint === true);
check("삭제 도구에 주의 표시", tool("clear_site_profile").annotations?.destructiveHint === true && tool("unlink_company_key").annotations?.destructiveHint === true);
check("대조군: 조회 도구에는 삭제 표시 없음", tool("query_legal_basis").annotations?.destructiveHint !== true);

// 4. 보조 버튼
const ok = buildAssistCall("analyze_work_context", "daily_tbm", { todayWork: "굴착 작업" }, "");
check("작업 분석 버튼 → 도구 호출", "tool" in ok && ok.tool === "analyze_work_context" && ok.input.workName === "굴착 작업");
check("작업명이 없으면 사유 안내", "reason" in buildAssistCall("analyze_work_context", "daily_tbm", {}, ""));
check("필드 도움말은 선택한 칸 필요", "reason" in buildAssistCall("request_field_help", "daily_tbm", {}, "") && "tool" in buildAssistCall("request_field_help", "daily_tbm", {}, "todayWork"));
check("목록에 없는 동작은 거절", "reason" in buildAssistCall("clear_site_profile", "daily_tbm", {}, ""));
check("문서 식별자 형식 검사", "reason" in buildAssistCall("preview_review", "../x", {}, ""));

console.log(`[trust-boundaries] ${pass} 통과 / ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
