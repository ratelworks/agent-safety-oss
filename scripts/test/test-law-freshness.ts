#!/usr/bin/env tsx
/**
 * test-law-freshness.ts — 법령·고시·양식 최신화 회귀 시험 (네트워크 없음)
 *
 * 각 검사에 "통과해야 하는 입력"과 "실패해야 하는 입력(대조군)"을 함께 둔다 —
 * 통과만 보는 검사는 빈 검사일 수 있기 때문이다.
 *
 *   1. 조문 판본 대조: 표기 차이는 같음, 문구 차이는 다름
 *   2. 판본 점검: 번들 MST ≠ 현행 MST 면 낡음
 *   3. 관리비 계상: 현행 고시 별표 1 값으로 계산, 공사종류 불명이면 계산하지 않음
 *   4. 산업재해조사표: 현행 칸, 옛 입력 키 처리
 *   5. 번들 데이터: 옛 고시·옛 주소·옛 제목이 남지 않음
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeForCompare,
  isRepealedText,
  parseArticleNumber,
  extractBundleLawText,
  renderArticle,
} from "../sync/reconcile-article-editions.js";
import { judgeEdition, extractHeaderMST, BUNDLED_LAWS } from "../verify/check-law-editions.js";
import { computeOshCost, matchRateRow, readRateTable, estimateBaseFromContract } from "../../src/lib/osh-cost.js";
import { applyInputMigrations, readInputMigrations, keepLeadingDigits } from "../../src/lib/input-migrations.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS = resolve(ROOT, "src/ontology/graph/nodes/documents");
const ARTICLES = resolve(ROOT, "src/ontology/graph/nodes/articles");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// ── 1. 조문 판본 대조 ───────────────────────────────────────────────
{
  const a = "**제70조 (건설공사 기간의 연장)**\n\n① 태풍ㆍ홍수 등 악천후 <개정 2026.10.27>";
  const b = "제70조(건설공사 기간의 연장)\n① 태풍·홍수 등 악천후";
  check("표기 차이(굵게·가운뎃점·개정 꼬리표)는 같음", normalizeForCompare(a) === normalizeForCompare(b));
  const c = "제70조(건설공사 기간의 연장)\n① 태풍·홍수·폭염·한파 등 악천후";
  check("[대조군] 문구 차이는 다름", normalizeForCompare(b) !== normalizeForCompare(c));
  check("삭제 조문 판별", isRepealedText("제208조 삭제 <2022.10.18>"));
  check("이동 조문 판별", isRepealedText("제336조\n[종전 제336조는 제333조로 이동 <2023.11.14>]"));
  check("[대조군] 일반 조문은 삭제 아님", !isRepealedText("제38조(안전조치)\n① 사업주는 …"));
  const t = parseArticleNumber("64(1)5");
  check("항·호 노드 번호 해석", t?.article === "64" && t?.hang === "1" && t?.ho === "5");
  check("[대조군] 잘못된 번호는 해석 불가", parseArticleNumber("제64조") === null);
  const rendered = renderArticle({
    number: "336",
    title: "",
    head: "제336조",
    hangs: [],
    effective: "20260302",
    note: "[종전 제336조는 제333조로 이동 <2023.11.14>]",
  });
  check("이동 자리 본문에 이동 안내 포함", rendered.includes("이동") && isRepealedText(rendered));

  const section = "## §57 산업재해 발생 은폐 금지\n\n① 사업주는 은폐해서는 아니 된다.\n\n**관련**: 시행규칙 §73\n";
  const law = extractBundleLawText(section);
  check("번들 절에서 해설 줄 제외", law === "① 사업주는 은폐해서는 아니 된다.", JSON.stringify(law));
  const tampered = extractBundleLawText(section.replace("은폐해서는", "숨겨서는"));
  check("[대조군] 번들 본문을 바꾸면 다름", normalizeForCompare(tampered) !== normalizeForCompare(law));
}

// ── 1-b. 실제 번들: 반영 결과 ──────────────────────────────────────
{
  const art70 = readJson(resolve(ARTICLES, "산안법-§70.jsonld"));
  check("산안법 제70조 ①1호 폭염·한파 반영", /폭염ㆍ한파 등 악천후/.test(art70.description));
  const art84 = readJson(resolve(ARTICLES, "산안법-§84.jsonld"));
  check("산안법 제84조 ②1호 현행 문구", art84.description.includes("연구ㆍ개발 또는 수출을 목적으로 제조하거나 수입하는 경우"));
  let flagged = 0;
  let staleMst = 0;
  const current: Record<string, string> = { 산안법: "291447", 산안법시행령: "288347", 산안법시행규칙: "288431", 기준규칙: "273603" };
  for (const f of readdirSync(ARTICLES)) {
    const n = readJson(resolve(ARTICLES, f));
    if (n.verificationStatus === "verified" && n._meta?.needsVerification === true) flagged += 1;
    const law = String(n["@id"]).split(":")[1];
    if (current[law] && n._meta?.lawServiceMST !== current[law]) staleMst += 1;
  }
  check("verified 인데 needsVerification 인 조문 노드 없음", flagged === 0, `${flagged}건`);
  check("산안법 계열 4종 조문 노드 판본 표지 모두 현행", staleMst === 0, `${staleMst}건`);
}

// ── 2. 판본 점검 ───────────────────────────────────────────────────
{
  const law = BUNDLED_LAWS[0];
  const entry = (mst: string, status: string, eff: string) => ({
    mst,
    status,
    name: law.name,
    promulgationNo: "22122",
    promulgationDate: "2026-10-27",
    effectiveDate: eff,
    kind: "법률",
  });
  const cur = [entry("291447", "현행", "2026-10-27")];
  const ef = [entry("291447", "시행예정", "2099-01-28")];
  check("번들 MST = 현행 MST 면 현행", judgeEdition(law, "291447", { "291447": 184 }, cur, ef).status === "현행");
  check("[대조군] 번들 MST 가 옛 판이면 낡음", judgeEdition(law, "283449", { "283449": 184 }, cur, ef).status === "낡음");
  check(
    "[대조군] 조문 노드 일부가 옛 판이면 낡음",
    judgeEdition(law, "291447", { "291447": 180, "283449": 4 }, cur, ef).status === "낡음",
  );
  check("시행예정 판은 안내 목록에", judgeEdition(law, "291447", {}, cur, ef).pending.length === 1);
  check("[대조군] 현행 판을 못 찾으면 조회 실패", judgeEdition(law, "291447", {}, [], ef).status === "조회 실패");
  const md = readFileSync(resolve(ROOT, "src/ontology/safety-laws/산업안전보건법.md"), "utf8");
  check("산안법 번들 머리말 MST 가 현행 판", extractHeaderMST(md) === "291447");
  check("산안법 번들 머리말 현행 표기 제22122호", md.includes("법률 제22122호"));
}

// ── 3. 관리비 계상 ─────────────────────────────────────────────────
{
  const node = readJson(resolve(DOCS, "safety-health-mgmt-cost-plan.jsonld"));
  const table = readRateTable(node);
  check("요율표 4개 공사종류", table.length === 4, `${table.length}`);
  const building = matchRateRow("건축공사업", table);
  check("건축 판별", building?.type === "건축공사");
  if (building) {
    const r = computeOshCost(building, 3_200_000_000);
    check("대상액 32억 건축 = 77,285,000원", r.total === 77_285_000, String(r.total));
    check("5억 미만 구간 3.11%", computeOshCost(building, 400_000_000).ratePercent === 3.11);
    const big = computeOshCost(building, 22_400_000_000);
    check("50억 이상 2.37% = 530,880,000원", big.ratePercent === 2.37 && big.total === 530_880_000, String(big.total));
    check("[대조군] 옛 요율 1.97% 아님", r.ratePercent !== 1.97);
  }
  check("터널은 중건설로 판별", matchRateRow("토목 (터널 신설)", table)?.type === "중건설공사");
  check("[대조군] 판별 불가 공사종류는 계산하지 않음", matchRateRow("미상", table) === undefined);
  check("대상액 불명확 시 총공사금액 × 7/10", estimateBaseFromContract(1_000_000_000) === 700_000_000);
  const txt = JSON.stringify(node);
  check("[대조군] 옛 고시 2022-43 인용 없음", !txt.includes("2022-43"));
  check("현행 고시 제2025-11호 인용", txt.includes("제2025-11호"));
}

// ── 4. 산업재해조사표 ──────────────────────────────────────────────
{
  const node = readJson(resolve(DOCS, "industrial-accident-report.jsonld"));
  const keys = new Set<string>((node.sections ?? []).flatMap((s: { fields: { key: string }[] }) => s.fields.map((f) => f.key)));
  check("주소 칸", keys.has("injuredAddress"));
  check("휴대전화 칸", keys.has("injuredMobile"));
  check("개인정보 활용 동의 칸", keys.has("benefitGuidanceConsent"));
  check("[대조군] 성별 칸 없음", !keys.has("injuredGender"));
  const txt = JSON.stringify(node);
  check("[대조군] 통계청 표기 없음", !txt.includes("통계청"));
  check("주민등록번호 앞 7자리 표기", txt.includes("주민등록번호 앞 7자리"));

  const rules = readInputMigrations(node);
  const draft: Record<string, unknown> = { injuredId: "830101-1234567", injuredGender: "남", injuredName: "홍길동" };
  const notes = applyInputMigrations(draft, rules);
  check("옛 키 성별은 지워짐", !("injuredGender" in draft));
  check("주민번호 13자리 → 앞 7자리", draft.injuredId === "830101-1******", String(draft.injuredId));
  check("처리 내역 2건", notes.length === 2, String(notes.length));
  check("[대조군] 이미 7자리면 그대로", keepLeadingDigits("830101-1", 7) === null);
  const untouched: Record<string, unknown> = { injuredName: "홍길동" };
  check("[대조군] 해당 키 없으면 처리 없음", applyInputMigrations(untouched, rules).length === 0);
}

// ── 5. 번들 데이터 ─────────────────────────────────────────────────
{
  const formsMap = readFileSync(resolve(ROOT, "src/ontology/forms/forms-map.json"), "utf8");
  check("[대조군] 접속 거부 KRAS 주소 없음", !formsMap.includes("kras.kosha.or.kr"));
  check("[대조군] 500 응답 전자책 목록 주소 없음", !/download\.jsp\?kd=feb&sdir=\d+"/.test(formsMap));
  check("[대조군] 404 기술지침 주소 없음", !formsMap.includes("extappKosha/kosha/guidance/"));
  const fm = JSON.parse(formsMap);
  const f30 = fm.forms.find((f: { formId: string }) => f.formId === "annex30_industrial_accident_report");
  check("산업재해조사표 원본 현행판", String(f30?.officialName).includes("<개정 2025. 10. 1.>"));
  const guide = readFileSync(resolve(ROOT, "src/ontology/kosha-guides/D-1-2021.md"), "utf8").split("\n")[0];
  check("D-1-2021 현행 제목", guide === "# 미압 배관에서의 폭연 방산구 설치에 관한 기술지침", guide);
}

console.log(`\n[law-freshness] ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
