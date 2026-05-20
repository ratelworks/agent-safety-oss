#!/usr/bin/env tsx
/**
 * usability-scenarios.ts
 *
 * 실무자(50억 미만 건설현장 + 안전관리자 겸임 현장소장) 페르소나 기반
 * 6개 사용성 시나리오 — LLM 이 우리 MCP 를 호출했을 때 받는 응답을 평가.
 *
 * 평가 기준:
 *  · 응답 길이 (LLM 컨텍스트 비용)
 *  · 핵심 정보 포함 (지정한 키워드 있는가)
 *  · 다음 행동 안내 (nextActions)
 *  · 적용성 안내 (50인/50억)
 *  · 환각 차단 마커
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(ROOT, "build", "cli.js");

interface CallResult {
  ok: boolean;
  text: string;
  parsed?: { content?: { text?: string }[]; structuredContent?: unknown; isError?: boolean };
}

function call(tool: string, input: Record<string, unknown> = {}): CallResult {
  const res = spawnSync(
    "node",
    [CLI, "call", tool, "--inputJson", JSON.stringify(input)],
    { encoding: "utf8", cwd: ROOT },
  );
  const out: CallResult = { ok: res.status === 0, text: "" };
  try {
    out.parsed = JSON.parse(res.stdout);
    out.text = out.parsed?.content?.[0]?.text ?? "";
  } catch {
    out.text = res.stdout;
  }
  return out;
}

interface ScenarioResult {
  name: string;
  steps: { tool: string; ms: number; chars: number; passed: boolean; note: string }[];
  pass: boolean;
  reason?: string;
}

function evalStep(
  tool: string,
  input: Record<string, unknown>,
  expect: (r: CallResult) => { passed: boolean; note: string },
): ScenarioResult["steps"][0] {
  const t0 = Date.now();
  const r = call(tool, input);
  const ms = Date.now() - t0;
  const e = expect(r);
  return { tool, ms, chars: r.text.length, ...e };
}

function header(text: string): void {
  console.log(`\n${"═".repeat(70)}\n${text}\n${"═".repeat(70)}`);
}

const results: ScenarioResult[] = [];

// ═════════════════════════════════════════════════════════════════════
// 시나리오 1 — 신규 현장 1개월차 (현장소장, 30인 25억 건설)
// 페르소나: 김경민 (53세, 30년 건설 경력, 안전관리자 자격 없음)
// 질문: "이번 달 뭐 해야 해?"
// ═════════════════════════════════════════════════════════════════════
header("시나리오 1 — 신규 현장 1개월차 (30인 25억 건설)");
const s1: ScenarioResult = { name: "신규 현장 1개월차", steps: [], pass: false };

s1.steps.push(
  evalStep(
    "list_safety_documents_by_cycle",
    { cycle: "all", workforce: 30, constructionValue: 25, industry: "construction" },
    (r) => {
      const has50 = r.text.includes("50인 미만") && r.text.includes("50억 미만");
      const hasMonth = r.text.includes("월간");
      const hasNext = r.text.includes("get_safety_document_guide");
      const total = (r.parsed?.structuredContent as { total?: number })?.total ?? 0;
      return {
        passed: has50 && hasMonth && hasNext && total >= 14,
        note: `total=${total}, 50인면제=${has50}, 다음행동=${hasNext}`,
      };
    },
  ),
);

s1.steps.push(
  evalStep("get_safety_document_guide", { docId: "monthly_risk_assessment" }, (r) => {
    const hasKras = r.text.includes("KRAS") || r.text.includes("construction_continuous");
    const hasFields = r.text.includes("필수 필드");
    const hasReview = r.text.includes("review_safety_document");
    return {
      passed: hasKras && hasFields && hasReview,
      note: `KRAS=${hasKras}, 필드=${hasFields}, review연동=${hasReview}`,
    };
  }),
);

s1.steps.push(
  evalStep(
    "get_safety_document_guide",
    { docId: "initial_risk_assessment" },
    (r) => {
      const has1month = r.text.includes("1개월");
      const has6cat = r.text.includes("6범주") || r.text.includes("6 범주");
      return {
        passed: has1month,
        note: `1개월내 안내=${has1month}, 6범주=${has6cat}`,
      };
    },
  ),
);

s1.pass = s1.steps.every((s) => s.passed);
results.push(s1);
for (const st of s1.steps) {
  console.log(`  ${st.passed ? "✅" : "❌"} ${st.tool} (${st.ms}ms, ${st.chars}자) — ${st.note}`);
}

// ═════════════════════════════════════════════════════════════════════
// 시나리오 2 — 굴착작업 내일 시작
// 질문: "내일 굴착작업 시작하는데 뭐 준비?"
// ═════════════════════════════════════════════════════════════════════
header("시나리오 2 — 굴착작업 시작 전");
const s2: ScenarioResult = { name: "굴착작업 준비", steps: [], pass: false };

s2.steps.push(
  evalStep("search_safety_laws", { keyword: "굴착" }, (r) => {
    const sc = r.parsed?.structuredContent as { total?: number };
    const n = sc?.total ?? 0;
    return { passed: n > 0, note: `${n}건 히트` };
  }),
);

s2.steps.push(
  evalStep("get_work_plan_schema", { workType: "excavation" }, (r) => {
    const has38 = r.text.includes("§38");
    const hasField = r.text.includes("사전조사") || r.text.includes("작업계획");
    return {
      passed: has38 && hasField,
      note: `§38인용=${has38}, 사전조사필드=${hasField}`,
    };
  }),
);

s2.steps.push(
  evalStep("get_work_permit_schema", { permitType: "excavation" }, (r) => {
    const hasInsp = r.text.includes("점검") || r.text.includes("사전");
    return { passed: hasInsp, note: `점검항목=${hasInsp}` };
  }),
);

s2.steps.push(
  evalStep(
    "search_kosha_archive",
    { keyword: "굴착작업", shpCd: "ops", rowsPerPage: 5 },
    (r) => {
      const sc = r.parsed?.structuredContent as { total?: number; items?: unknown[] };
      const n = sc?.total ?? 0;
      const has = (sc?.items?.length ?? 0) > 0;
      const hasGgnr = r.text.includes("공공누리");
      return {
        passed: n > 0 && has,
        note: `KOSHA total=${n}, 공공누리=${hasGgnr}`,
      };
    },
  ),
);

s2.steps.push(
  evalStep(
    "compile_safety_references",
    { workType: "굴착작업", docType: "work_plan" },
    (r) => {
      const sc = r.parsed?.structuredContent as { sources?: { law?: { bundles?: number } } };
      const lawBundles = sc?.sources?.law?.bundles ?? 0;
      return {
        passed: lawBundles > 0 || r.text.includes("법령") || r.text.includes("§"),
        note: `법령번들=${lawBundles}`,
      };
    },
  ),
);

s2.pass = s2.steps.every((s) => s.passed);
results.push(s2);
for (const st of s2.steps) {
  console.log(`  ${st.passed ? "✅" : "❌"} ${st.tool} (${st.ms}ms, ${st.chars}자) — ${st.note}`);
}

// ═════════════════════════════════════════════════════════════════════
// 시나리오 3 — TBM 일지 작성 (외국인 근로자 다수)
// 질문: "오늘 거푸집 해체 TBM, 외국인 근로자 5명 (베트남) 있음"
// ═════════════════════════════════════════════════════════════════════
header("시나리오 3 — TBM 일지 + 외국인 근로자");
const s3: ScenarioResult = { name: "TBM + 외국인", steps: [], pass: false };

s3.steps.push(
  evalStep("get_tbm_schema", { duration: "standard" }, (r) => {
    const has15 = r.text.includes("§15") && r.text.includes("4항");
    const hasShinm = r.text.includes("서명");
    return { passed: has15 && hasShinm, note: `§15④=${has15}, 서명필드=${hasShinm}` };
  }),
);

s3.steps.push(
  evalStep("get_safety_document_guide", { docId: "daily_tbm" }, (r) => {
    const hasMistakes = r.text.includes("흔한 실수") || r.text.includes("commonMistakes");
    const hasForeign = r.text.includes("외국인") || r.text.includes("모국어");
    return {
      passed: hasMistakes && hasForeign,
      note: `흔한실수=${hasMistakes}, 외국인안내=${hasForeign}`,
    };
  }),
);

s3.steps.push(
  evalStep(
    "get_foreign_worker_resource_links",
    { language: "vi", topic: "거푸집" },
    (r) => {
      const hasUrl = r.text.includes("kosha");
      return { passed: hasUrl, note: `KOSHA URL=${hasUrl}` };
    },
  ),
);

s3.pass = s3.steps.every((s) => s.passed);
results.push(s3);
for (const st of s3.steps) {
  console.log(`  ${st.passed ? "✅" : "❌"} ${st.tool} (${st.ms}ms, ${st.chars}자) — ${st.note}`);
}

// ═════════════════════════════════════════════════════════════════════
// 시나리오 4 — 사고 발생 후 (비계에서 떨어짐, 휴업 7일)
// 질문: "어제 비계 작업자 떨어짐 사고, 휴업 7일. 어떻게?"
// ═════════════════════════════════════════════════════════════════════
header("시나리오 4 — 사고 발생 후 처리");
const s4: ScenarioResult = { name: "사고 발생 후", steps: [], pass: false };

s4.steps.push(
  evalStep(
    "get_safety_document_guide",
    { docId: "industrial_accident_report" },
    (r) => {
      const has1m = r.text.includes("1개월");
      const has73 = r.text.includes("§73");
      return { passed: has1m && has73, note: `1개월기한=${has1m}, §73=${has73}` };
    },
  ),
);

s4.steps.push(
  evalStep("get_safety_document_guide", { docId: "ad_hoc_risk_assessment" }, (r) => {
    const hasReopen = r.text.includes("재개") || r.text.includes("재개 전");
    return { passed: hasReopen, note: `작업재개전 의무=${hasReopen}` };
  }),
);

s4.steps.push(
  evalStep("search_safety_laws", { keyword: "산업재해" }, (r) => {
    const sc = r.parsed?.structuredContent as { total?: number };
    return {
      passed: (sc?.total ?? 0) > 0,
      note: `${sc?.total ?? 0}건 히트`,
    };
  }),
);

s4.pass = s4.steps.every((s) => s.passed);
results.push(s4);
for (const st of s4.steps) {
  console.log(`  ${st.passed ? "✅" : "❌"} ${st.tool} (${st.ms}ms, ${st.chars}자) — ${st.note}`);
}

// ═════════════════════════════════════════════════════════════════════
// 시나리오 5 — 감독관 대응 (즉답)
// 질문: "감독관이 산안기준규칙 §38 근거 묻는다"
// ═════════════════════════════════════════════════════════════════════
header("시나리오 5 — 감독관 즉답");
const s5: ScenarioResult = { name: "감독관 대응", steps: [], pass: false };

s5.steps.push(
  evalStep(
    "get_safety_law_article",
    { ref: "산안기준규칙 §38", lawCode: "osha-standard" },
    (r) => {
      const sc = r.parsed?.structuredContent as { found?: boolean };
      const has = sc?.found === true;
      const hasBadge = r.text.includes("✅") || r.text.includes("🟡") || r.text.includes("⚠");
      const hasUrl = r.text.includes("law.go.kr");
      return {
        passed: has && hasBadge && hasUrl,
        note: `found=${has}, 검토배지=${hasBadge}, URL=${hasUrl}`,
      };
    },
  ),
);

s5.steps.push(
  evalStep(
    "verify_safety_basis",
    {
      claims: [
        {
          claim: "굴착작업 시 작업계획서 작성 필수",
          evidence: [
            {
              basisType: "regulation",
              legalWeight: "mandatory",
              title: "산안기준규칙 §38",
              source: "LAW_MCP",
              reference: "산안기준규칙 §38",
            },
          ],
        },
      ],
    },
    (r) => {
      const sc = r.parsed?.structuredContent as { verdicts?: { status?: string }[] };
      const status = sc?.verdicts?.[0]?.status;
      return {
        passed: status === "supported",
        note: `검증 status=${status}`,
      };
    },
  ),
);

// 환각 음성 케이스
s5.steps.push(
  evalStep(
    "verify_safety_basis",
    {
      claims: [
        {
          claim: "추락 방지 필수",
          evidence: [
            {
              basisType: "law",
              legalWeight: "mandatory",
              title: "산안법 §999 (허위)",
              source: "LAW_MCP",
              reference: "산안법 §999",
            },
          ],
        },
      ],
    },
    (r) => {
      const isErr = r.parsed?.isError === true;
      const hasMarker = r.text.includes("[HALLUCINATION_DETECTED]");
      return {
        passed: isErr && hasMarker,
        note: `isError=${isErr}, 마커=${hasMarker}`,
      };
    },
  ),
);

s5.pass = s5.steps.every((s) => s.passed);
results.push(s5);
for (const st of s5.steps) {
  console.log(`  ${st.passed ? "✅" : "❌"} ${st.tool} (${st.ms}ms, ${st.chars}자) — ${st.note}`);
}

// ═════════════════════════════════════════════════════════════════════
// 시나리오 6 — 위험성평가 초안 검토
// 질문: "이 평가서 초안 점검해줘 (필수 필드 일부 누락 + 환각 ref)"
// ═════════════════════════════════════════════════════════════════════
header("시나리오 6 — 위험성평가 초안 검토");
const s6: ScenarioResult = { name: "위험성평가 검토", steps: [], pass: false };

s6.steps.push(
  evalStep(
    "review_safety_document",
    {
      docId: "risk_assessment",
      draft: {
        metadata: {
          siteName: "황룡건설 ○○현장",
          assessmentDate: "2026-04-25",
          assessmentType: "ongoing",
          // 근로자 대표 누락 (의도적)
          participants: [{ role: "사업주", signed: true }],
        },
        hazards: [{ description: "추락 위험", riskLevel: "상" }],
        controls: [
          // PPE 만 (engineering 누락 — warn)
          { description: "안전모", type: "ppe", responsible: "현장소장", deadline: "즉시" },
        ],
        citations: [
          // 환각 ref
          {
            basisType: "law",
            legalWeight: "mandatory",
            title: "허위 §999",
            source: "LAW_MCP",
            reference: "산안법 §999",
          },
        ],
      },
      scale: { workforce: 30, constructionValue: 25, industry: "construction" },
    },
    (r) => {
      const sc = r.parsed?.structuredContent as {
        overall?: string;
        summary?: { fail?: number; warn?: number };
        applicability?: { exemptedFrom?: string[] };
      };
      const isErr = r.parsed?.isError === true;
      const overall = sc?.overall;
      const fails = sc?.summary?.fail ?? 0;
      const warns = sc?.summary?.warn ?? 0;
      const exemptCount = sc?.applicability?.exemptedFrom?.length ?? 0;
      const hasMarker = r.text.includes("[HALLUCINATION_DETECTED]");
      const hasRevision = r.text.includes("[REVISION_NEEDED]");

      // 통과 조건:
      // 1. overall = fail (3+ blocker) 또는 needs_revision
      // 2. fail 카운트 >= 2 (대표 서명 누락 + 환각)
      // 3. 적용성 면제 안내 (50억 미만 → 안전보건대장 면제 등)
      // 4. 환각 마커 부착
      const passed = isErr && fails >= 2 && hasMarker && exemptCount >= 1;
      return {
        passed,
        note: `overall=${overall} fail=${fails} warn=${warns} 면제=${exemptCount}건 마커=${hasMarker}`,
      };
    },
  ),
);

s6.pass = s6.steps.every((s) => s.passed);
results.push(s6);
for (const st of s6.steps) {
  console.log(`  ${st.passed ? "✅" : "❌"} ${st.tool} (${st.ms}ms, ${st.chars}자) — ${st.note}`);
}

// ═════════════════════════════════════════════════════════════════════
// 종합
// ═════════════════════════════════════════════════════════════════════
header("종합 결과");
const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\n시나리오 ${passed}/${total} PASS\n`);

for (const r of results) {
  const passSteps = r.steps.filter((s) => s.passed).length;
  const totalChars = r.steps.reduce((s, x) => s + x.chars, 0);
  const totalMs = r.steps.reduce((s, x) => s + x.ms, 0);
  console.log(
    `  ${r.pass ? "✅" : "❌"} ${r.name} — ${passSteps}/${r.steps.length} step PASS · ${totalChars}자 · ${totalMs}ms`,
  );
  if (!r.pass) {
    for (const s of r.steps.filter((x) => !x.passed)) {
      console.log(`     ❌ ${s.tool} — ${s.note}`);
    }
  }
}

console.log("");
process.exit(passed === total ? 0 : 1);
