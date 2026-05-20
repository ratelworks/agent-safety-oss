#!/usr/bin/env tsx
/**
 * e2e-smoke.ts
 *
 * 실무 의미 검증용 전수 실행 러너.
 * - Phase 1: 16개 keyless 도구 전수 실행 → 각 도구가 비어있지 않은 결과를 주는가
 * - Phase 2: 시나리오 1개 E2E (천장크레인 정비 → search → get → compile)
 * - Phase 3: 가드레일 음성 테스트 (verify_safety_basis 가 허위 근거 걸러내는가)
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(ROOT, "build", "cli.js");

interface CallResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  parsed?: { content?: { text?: string }[]; structuredContent?: unknown };
}

function call(tool: string, inputJson: Record<string, unknown> = {}): CallResult {
  const res = spawnSync(
    "node",
    [CLI, "call", tool, "--inputJson", JSON.stringify(inputJson)],
    { encoding: "utf8", cwd: ROOT },
  );
  const out = {
    ok: res.status === 0,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    parsed: undefined as CallResult["parsed"],
  };
  try {
    out.parsed = JSON.parse(out.stdout);
  } catch {
    // 파싱 실패 = 응답이 JSON 아님 (에러 메시지 등)
  }
  return out;
}

interface VerdictRow {
  tool: string;
  verdict: "PASS" | "EMPTY" | "FAIL";
  note: string;
}

const results: VerdictRow[] = [];

function verdict(
  tool: string,
  r: CallResult,
  check: (r: CallResult) => { verdict: "PASS" | "EMPTY" | "FAIL"; note: string },
): void {
  if (!r.ok) {
    results.push({
      tool,
      verdict: "FAIL",
      note: `exit != 0 · stderr: ${r.stderr.slice(0, 120).replace(/\n/g, " ")}`,
    });
    return;
  }
  if (!r.parsed) {
    results.push({
      tool,
      verdict: "FAIL",
      note: `응답 JSON 파싱 실패 · stdout 앞 100자: ${r.stdout.slice(0, 100)}`,
    });
    return;
  }
  results.push({ tool, ...check(r) });
}

function textLen(r: CallResult): number {
  const t = r.parsed?.content?.[0]?.text ?? "";
  return t.length;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: keyless 도구 전수 실행
// ═══════════════════════════════════════════════════════════════════
console.log("═══ Phase 1: 16개 keyless 도구 전수 실행 ═══\n");

// ── 법령 3개 ──
verdict("list_core_safety_laws", call("list_core_safety_laws"), (r) => {
  const sc = r.parsed?.structuredContent as { totalLaws?: number; totalArticles?: number };
  if (!sc?.totalLaws || sc.totalLaws < 6)
    return { verdict: "FAIL", note: `법령 수 부족: ${sc?.totalLaws}` };
  if (!sc.totalArticles || sc.totalArticles < 30)
    return { verdict: "EMPTY", note: `조문 수 ${sc.totalArticles} — 30개 미만` };
  return { verdict: "PASS", note: `${sc.totalLaws}개 법령 · ${sc.totalArticles}개 조문` };
});

verdict("search_safety_laws", call("search_safety_laws", { keyword: "추락" }), (r) => {
  // 응답 shape: { total: N, query:..., laws: [...], articles: [...] }
  const sc = r.parsed?.structuredContent as { total?: number; articles?: unknown[] };
  const n = sc?.total ?? (sc?.articles ?? []).length;
  if (!n) return { verdict: "EMPTY", note: "추락 검색 결과 0건" };
  return { verdict: "PASS", note: `${n}건 히트` };
});

verdict(
  "get_safety_law_article",
  call("get_safety_law_article", { ref: "산안기준규칙 §38" }),
  (r) => {
    const sc = r.parsed?.structuredContent as { found?: boolean };
    if (!sc?.found) return { verdict: "FAIL", note: "산안기준규칙 §38 조회 실패" };
    return { verdict: "PASS", note: `§38 원문 ${textLen(r)}자` };
  },
);

// ── KOSHA 번들 4개 ──
verdict("get_kosha_guide_md", call("get_kosha_guide_md", { keyword: "추락" }), (r) => {
  const sc = r.parsed?.structuredContent as { results?: unknown[]; totalCount?: number };
  const n = (sc?.results ?? []).length;
  if (n === 0) return { verdict: "EMPTY", note: "추락 Guide 히트 0" };
  return { verdict: "PASS", note: `${n}건 Guide` };
});

verdict("search_sif_archive", call("search_sif_archive", { workType: "건설" }), (r) => {
  const sc = r.parsed?.structuredContent as { totalCount?: number; bundleStatus?: string };
  if (sc?.bundleStatus === "empty")
    return { verdict: "PASS", note: "bundleStatus=empty 확인 (KOGL 변경금지로 정상 placeholder)" };
  if (!sc?.totalCount) return { verdict: "EMPTY", note: `totalCount=${sc?.totalCount}` };
  return { verdict: "PASS", note: `${sc.totalCount}건` };
});

verdict("list_construction_subtasks", call("list_construction_subtasks"), (r) => {
  const sc = r.parsed?.structuredContent as { bundleStatus?: string; totalCategories?: number };
  if (sc?.bundleStatus === "empty")
    return { verdict: "PASS", note: "bundleStatus=empty 확인 (공식 XLSX 미포함 정상 placeholder)" };
  if (!sc?.totalCategories) return { verdict: "EMPTY", note: "categories 0" };
  return { verdict: "PASS", note: `${sc.totalCategories}개 주공종` };
});

verdict(
  "get_foreign_worker_resource_links",
  call("get_foreign_worker_resource_links", { language: "vi" }),
  (r) => {
    const len = textLen(r);
    if (len < 100) return { verdict: "EMPTY", note: `응답 ${len}자` };
    return { verdict: "PASS", note: `${len}자 링크 안내` };
  },
);

// ── 스키마 5개 ──
for (const tool of [
  "get_risk_assessment_schema",
  "get_work_plan_schema",
  "get_tbm_schema",
  "get_ops_schema",
]) {
  verdict(tool, call(tool), (r) => {
    const len = textLen(r);
    if (len < 200) return { verdict: "EMPTY", note: `스키마 ${len}자` };
    return { verdict: "PASS", note: `${len}자` };
  });
}

// get_work_permit_schema 는 permitType 필수 — 5종류 중 1개 선택
verdict(
  "get_work_permit_schema",
  call("get_work_permit_schema", { permitType: "working_at_height" }),
  (r) => {
    const len = textLen(r);
    if (len < 200) return { verdict: "EMPTY", note: `${len}자` };
    return { verdict: "PASS", note: `${len}자 (working_at_height)` };
  },
);

// ── 분석 3개 ──
verdict(
  "analyze_construction_work_risks",
  call("analyze_construction_work_risks", { workType: "철근콘크리트공사" }),
  (r) => {
    const len = textLen(r);
    if (len < 200) return { verdict: "EMPTY", note: `분석 ${len}자` };
    return { verdict: "PASS", note: `${len}자` };
  },
);

verdict(
  "compile_safety_references",
  call("compile_safety_references", {
    workType: "철근콘크리트공사",
    docType: "risk_assessment",
  }),
  (r) => {
    const sc = r.parsed?.structuredContent as {
      references?: unknown[];
      totalReferences?: number;
      totalCount?: number;
    };
    const n =
      sc?.totalReferences ?? sc?.totalCount ?? (sc?.references ?? []).length;
    if (!n) return { verdict: "EMPTY", note: "references 0" };
    return { verdict: "PASS", note: `${n}개 근거` };
  },
);

verdict(
  "verify_safety_basis",
  call("verify_safety_basis", {
    claims: [
      {
        claim: "추락방지망 설치 필수",
        evidence: [
          {
            basisType: "regulation",
            legalWeight: "mandatory",
            title: "산안기준규칙 §42 추락방지",
            source: "LAW_MCP",
            reference: "산안기준규칙 §42",
            snippet: "사업주는 근로자가 추락할 위험이 있는 장소...",
          },
        ],
      },
    ],
  }),
  (r) => {
    const len = textLen(r);
    if (len < 100) return { verdict: "EMPTY", note: `${len}자` };
    return { verdict: "PASS", note: `${len}자` };
  },
);

// ── 가이드 (시간 주기) 2개 ──
verdict("list_safety_documents_by_cycle", call("list_safety_documents_by_cycle"), (r) => {
  const sc = r.parsed?.structuredContent as { total?: number };
  const n = sc?.total ?? 0;
  if (n < 12) return { verdict: "EMPTY", note: `가이드 entity ${n}개 (14 기대)` };
  return { verdict: "PASS", note: `${n}개 entity` };
});

verdict(
  "get_safety_document_guide",
  call("get_safety_document_guide", { docId: "daily_tbm" }),
  (r) => {
    const sc = r.parsed?.structuredContent as { found?: boolean };
    if (!sc?.found) return { verdict: "FAIL", note: "daily_tbm 가이드 미발견" };
    return { verdict: "PASS", note: "daily_tbm 가이드 풀 본문 반환" };
  },
);

// ── review_safety_document Phase A ──
verdict(
  "review_safety_document",
  call("review_safety_document", {
    docId: "risk_assessment",
    draft: {
      metadata: {
        siteName: "테스트",
        assessmentDate: "2026-04-25",
        assessmentType: "ongoing",
        participants: [
          { role: "사업주", signed: true },
          { role: "근로자대표", signed: true },
        ],
      },
      hazards: [{ description: "추락 위험", riskLevel: "상" }],
      controls: [
        { description: "안전대 설치", type: "engineering", responsible: "현장소장", deadline: "즉시" },
      ],
      citations: [
        {
          basisType: "regulation",
          legalWeight: "mandatory",
          title: "산안기준규칙 §38",
          source: "LAW_MCP",
          reference: "산안기준규칙 §38",
        },
      ],
    },
    scale: { workforce: 30, constructionValue: 25, industry: "construction" },
  }),
  (r) => {
    const sc = r.parsed?.structuredContent as { overall?: string };
    if (sc?.overall === "pass") return { verdict: "PASS", note: "정상 초안 → pass" };
    if (sc?.overall === "fail") return { verdict: "FAIL", note: `expected pass got fail` };
    return { verdict: "PASS", note: `overall=${sc?.overall}` };
  },
);

// ── KRAS 방법론 3개 ──
verdict("list_kras_methods", call("list_kras_methods"), (r) => {
  const sc = r.parsed?.structuredContent as { total?: number; methods?: unknown[] };
  const n = sc?.total ?? (sc?.methods ?? []).length;
  if (n < 7) return { verdict: "EMPTY", note: `KRAS 방법 ${n}/7개` };
  return { verdict: "PASS", note: `${n}개 방법` };
});

verdict(
  "choose_assessment_method",
  call("choose_assessment_method", {
    industry: "construction",
    scale: "small",
    subject: "construction",
  }),
  (r) => {
    const sc = r.parsed?.structuredContent as {
      recommendation?: { primary?: string };
    };
    const p = sc?.recommendation?.primary;
    if (p !== "construction_continuous")
      return { verdict: "FAIL", note: `건설업 추천=${p} (예상: construction_continuous)` };
    return { verdict: "PASS", note: `1순위=${p}` };
  },
);

verdict(
  "get_kras_method",
  call("get_kras_method", { method: "construction_continuous" }),
  (r) => {
    const sc = r.parsed?.structuredContent as { found?: boolean };
    if (!sc?.found) return { verdict: "FAIL", note: "조회 실패" };
    const len = textLen(r);
    if (len < 1000) return { verdict: "EMPTY", note: `본문 ${len}자` };
    return { verdict: "PASS", note: `본문 ${len}자` };
  },
);

// ── 메타 ──
verdict("get_project_info", call("get_project_info"), (r) => {
  const len = textLen(r);
  if (len < 100) return { verdict: "EMPTY", note: `${len}자` };
  return { verdict: "PASS", note: `${len}자` };
});

// ═══ Phase 1 리포트 ═══
console.log("Phase 1 결과:\n");
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
for (const r of results) {
  const badge = r.verdict === "PASS" ? "✅" : r.verdict === "EMPTY" ? "🟡" : "❌";
  console.log(`  ${badge} ${pad(r.tool, 36)} ${r.note}`);
}
const pass = results.filter((r) => r.verdict === "PASS").length;
const empty = results.filter((r) => r.verdict === "EMPTY").length;
const fail = results.filter((r) => r.verdict === "FAIL").length;
console.log(`\n총 ${results.length}건 — ✅ PASS ${pass} · 🟡 EMPTY ${empty} · ❌ FAIL ${fail}\n`);

// ═══════════════════════════════════════════════════════════════════
// Phase 2: E2E 시나리오 — 천장크레인 정비
// ═══════════════════════════════════════════════════════════════════
console.log("═══ Phase 2: 천장크레인 정비 위험성평가 시나리오 ═══\n");

const p2: { step: string; verdict: "PASS" | "EMPTY" | "FAIL"; detail: string }[] = [];

// Step 1: search_safety_laws("크레인")
{
  const r = call("search_safety_laws", { keyword: "크레인" });
  const sc = r.parsed?.structuredContent as { total?: number; articles?: unknown[] };
  const n = sc?.total ?? (sc?.articles ?? []).length;
  p2.push({
    step: "1) search_safety_laws('크레인')",
    verdict: n > 0 ? "PASS" : "EMPTY",
    detail: `법령 조문 ${n}건 히트`,
  });
  console.log(`  Step 1 → 크레인 법령 조문 ${n}건 히트`);
  if (n > 0 && r.parsed?.content?.[0]?.text) {
    console.log(`    (발췌) ${r.parsed.content[0].text.slice(0, 200).replace(/\n/g, " ")}...`);
  }
}

// Step 2: get_kosha_guide_md(keyword="크레인")
{
  const r = call("get_kosha_guide_md", { keyword: "크레인" });
  const sc = r.parsed?.structuredContent as { results?: unknown[] };
  const n = (sc?.results ?? []).length;
  p2.push({
    step: "2) get_kosha_guide_md(keyword='크레인')",
    verdict: n > 0 ? "PASS" : "EMPTY",
    detail: `KOSHA Guide ${n}건`,
  });
  console.log(`  Step 2 → KOSHA Guide ${n}건`);
}

// Step 3: compile_safety_references({workType:'크레인작업', docType:'risk_assessment'})
{
  const r = call("compile_safety_references", {
    workType: "크레인작업",
    docType: "risk_assessment",
  });
  const sc = r.parsed?.structuredContent as {
    totalReferences?: number;
    totalCount?: number;
    breakdown?: Record<string, number>;
  };
  const n = sc?.totalReferences ?? sc?.totalCount ?? 0;
  p2.push({
    step: "3) compile_safety_references(크레인작업, RA)",
    verdict: n > 0 ? "PASS" : "EMPTY",
    detail: `총 ${n}개 근거 · breakdown=${JSON.stringify(sc?.breakdown ?? {})}`,
  });
  console.log(
    `  Step 3 → compile: ${n}개 근거 (breakdown: ${JSON.stringify(sc?.breakdown ?? {})})`,
  );
}

// Step 4: get_work_plan_schema(workType='tower_crane')
{
  const r = call("get_work_plan_schema", { workType: "tower_crane" });
  const len = textLen(r);
  const txt = r.parsed?.content?.[0]?.text ?? "";
  const hasSection = txt.includes("§38") || txt.includes("작업계획서");
  p2.push({
    step: "4) get_work_plan_schema('tower_crane')",
    verdict: hasSection && len > 500 ? "PASS" : "EMPTY",
    detail: `응답 ${len}자, §38 언급=${hasSection}`,
  });
  console.log(`  Step 4 → work plan schema (tower_crane): ${len}자, §38 언급=${hasSection}`);
  if (len < 500) {
    console.log(`    응답: ${txt.slice(0, 400)}`);
  }
}

console.log("");

// ═══════════════════════════════════════════════════════════════════
// Phase 3: 가드레일 음성 테스트
// ═══════════════════════════════════════════════════════════════════
console.log("═══ Phase 3: verify_safety_basis 가드레일 음성 테스트 ═══\n");

const p3: { case: string; expected: string; actual: string; verdict: "PASS" | "FAIL" }[] = [];

// Case A: 존재하지 않는 조문 "산안법 §999"
{
  const r = call("verify_safety_basis", {
    claims: [
      {
        claim: "안전모 착용 필수",
        evidence: [
          {
            basisType: "law",
            legalWeight: "mandatory",
            title: "산안법 §999 (허위)",
            source: "LAW_MCP",
            reference: "산안법 §999",
            snippet: "(존재하지 않는 조문)",
          },
        ],
      },
    ],
  });
  const sc = r.parsed?.structuredContent as {
    verdicts?: { status?: string; reasons?: string[] }[];
  };
  const v0 = sc?.verdicts?.[0];
  const status = v0?.status ?? "";
  const reasons = v0?.reasons ?? [];
  const flagged =
    status === "partial" ||
    status === "unsupported" ||
    status === "invalid" ||
    reasons.length > 0;
  p3.push({
    case: "A. 존재하지 않는 조문 '산안법 §999'",
    expected: "partial/invalid + reasons (ref 존재 확인)",
    actual: flagged ? `status=${status}, reasons=${reasons.length}` : `status=${status} (위험 — 허위 ref 통과)`,
    verdict: flagged ? "PASS" : "FAIL",
  });
  console.log(
    `  Case A (없는 조문) → ${flagged ? `✅ status=${status}` : `❌ status=${status} (허위 ref 통과됨!)`}`,
  );
}

// Case B: basisType=kosha_guide + legalWeight=mandatory 불일치
{
  const r = call("verify_safety_basis", {
    claims: [
      {
        claim: "추락방지망 설치 필수",
        evidence: [
          {
            basisType: "kosha_guide",
            legalWeight: "mandatory", // KOSHA Guide 는 권고이므로 mandatory 부적절
            title: "KOSHA Guide C-39-2015 추락방지망",
            source: "KOSHA",
            reference: "C-39-2015",
            snippet: "(가이드 텍스트)",
          },
        ],
      },
    ],
  });
  // verify_safety_basis 응답: { summary: {supported, partial, unsupported, invalid}, verdicts: [{status, reasons[]}] }
  const sc = r.parsed?.structuredContent as {
    summary?: { supported?: number; partial?: number; unsupported?: number; invalid?: number };
    verdicts?: { status?: string; reasons?: string[] }[];
  };
  const v0 = sc?.verdicts?.[0];
  const status = v0?.status ?? "";
  const reasons = v0?.reasons ?? [];
  const flagged =
    status === "partial" ||
    status === "unsupported" ||
    status === "invalid" ||
    reasons.length > 0;
  p3.push({
    case: "B. kosha_guide + mandatory 등급 불일치",
    expected: "partial/unsupported + reasons",
    actual: flagged ? `status=${status}, reasons=${reasons.length}` : "통과됨",
    verdict: flagged ? "PASS" : "FAIL",
  });
  console.log(
    `  Case B (kosha_guide+mandatory) → ${flagged ? `✅ status=${status}, reasons=${reasons.length}건` : "❌ 불일치 감지 못함"}`,
  );
  if (reasons.length > 0) {
    console.log(`    reason: ${reasons[0]}`);
  }
}

// Case C: evidence 가 아예 없음 (빈 배열) — mandatory 요구 claim 에 근거 없음
{
  const r = call("verify_safety_basis", {
    claims: [
      {
        claim: "고소작업 시 추락방지망을 설치해야 한다",
        evidence: [],
      },
    ],
  });
  const sc = r.parsed?.structuredContent as {
    verdicts?: { status?: string; reasons?: string[]; matchedTriggers?: string[] }[];
  };
  const v0 = sc?.verdicts?.[0];
  const status = v0?.status ?? "";
  const flagged = status === "unsupported" || status === "partial" || status === "invalid";
  p3.push({
    case: "C. evidence 0개 + mandatory-trigger claim",
    expected: "unsupported",
    actual: flagged ? `status=${status}` : `status=${status}`,
    verdict: flagged ? "PASS" : "FAIL",
  });
  console.log(
    `  Case C (근거 0개) → ${flagged ? `✅ status=${status}, triggers=${v0?.matchedTriggers?.join(",")}` : `❌ status=${status}`}`,
  );
}

console.log("");

// ═══ 전체 요약 ═══
console.log("═══════════════════════════════════════════");
console.log("전체 요약");
console.log("═══════════════════════════════════════════");
console.log(`Phase 1 — 16개 도구: PASS ${pass} · EMPTY ${empty} · FAIL ${fail}`);
const p2pass = p2.filter((x) => x.verdict === "PASS").length;
console.log(`Phase 2 — 크레인 시나리오: ${p2pass}/${p2.length} PASS`);
const p3pass = p3.filter((x) => x.verdict === "PASS").length;
console.log(`Phase 3 — 가드레일 음성: ${p3pass}/${p3.length} PASS`);

// 실패 상세
const anyFail =
  fail > 0 ||
  empty > 0 ||
  p2.some((x) => x.verdict !== "PASS") ||
  p3.some((x) => x.verdict !== "PASS");

if (anyFail) {
  console.log("\n🔴 주의가 필요한 항목:");
  for (const r of results.filter((r) => r.verdict !== "PASS")) {
    console.log(`  [P1-${r.verdict}] ${r.tool} — ${r.note}`);
  }
  for (const r of p2.filter((x) => x.verdict !== "PASS")) {
    console.log(`  [P2-${r.verdict}] ${r.step} — ${r.detail}`);
  }
  for (const r of p3.filter((x) => x.verdict !== "PASS")) {
    console.log(`  [P3-FAIL] ${r.case} — expected=${r.expected}, actual=${r.actual}`);
  }
  process.exit(1);
}
console.log("\n✅ 전체 통과");
