#!/usr/bin/env tsx
/**
 * 19종 문서 자동화 수준 정량 측정.
 *
 * 각 빈칸을 3분류:
 *   A. 그래프 직접 fetch (auto): label·example·guidance·blanks가 그래프 노드/legalBasisDetails로 100% 채움 가능
 *   B. 그래프 + LLM 추론 (suggest): 그래프가 항목 목록 제공, LLM이 예시 보고 추론
 *   C. 사용자 입력 필수 (input): 현장 시점·인적·실측 데이터
 *
 * 자동화율 = (A + B*0.5) / total
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS_DIR = resolve(ROOT, "src/ontology/guides");
const REPORTS_DIR = resolve(ROOT, "reports");

const USER_INPUT_KEYWORDS = [
  "성명", "명단", "서명", "인적사항", "연락처", "전화", "소속", "면허번호", "자격번호",
  "실측", "측정값", "측정 결과", "날짜", "일자", "시각", "시간", "주소", "위치",
  "예산", "금액", "비용", "인원", "수량", "신청", "제출 일자", "발견 일자",
  "근로자 대표", "외국인", "하청 회사", "재해자", "아차사고", "발생",
];
const GRAPH_FETCH_KEYWORDS = [
  "법령", "조문", "근거", "별표", "조항", "시행규칙", "시행령", "고시",
  "기준", "등급", "한계", "노출기준", "TWA", "STEL", "CAS", "안전인증",
  "보호구 종류", "KOSHA Guide", "인용", "hierarchical", "안전조치",
  "hazard", "control", "위험요인", "안전수칙", "h2s", "GHS",
];

type Classification = "auto" | "suggest" | "input";

function classifyBlank(blankText: string, fieldLabel: string, fieldGuidance: string): Classification {
  const blankLower = blankText.toLowerCase();
  const userScore = USER_INPUT_KEYWORDS.filter((kw) => blankLower.includes(kw.toLowerCase())).length;
  const graphScore = GRAPH_FETCH_KEYWORDS.filter((kw) => blankLower.includes(kw.toLowerCase())).length;

  if (userScore >= 2 || (userScore >= 1 && graphScore === 0)) return "input";
  if (graphScore >= 2 || (graphScore >= 1 && userScore === 0)) return "auto";
  return "suggest";
}

interface DocResult {
  docFile: string;
  title: string;
  totalFields: number;
  totalBlanks: number;
  auto: number;
  suggest: number;
  input: number;
  automationRate: number;
  fieldAnalysis: Array<{
    label: string;
    totalBlanks: number;
    auto: number;
    suggest: number;
    input: number;
    samples: Array<{ blank: string; class: Classification }>;
  }>;
}

function measureDoc(docFile: string): DocResult {
  const d = JSON.parse(readFileSync(join(DOCS_DIR, `${docFile}.json`), "utf8"));
  const title: string = d.title || docFile;
  const required: any[] = d.requiredFields || [];

  const blankClassifications = { auto: 0, suggest: 0, input: 0 };
  const fieldAnalysis: DocResult["fieldAnalysis"] = [];

  for (const field of required) {
    const blanks: string[] = field.blanks || [];
    const label = field.label || "";
    const guidance = field.guidance || "";

    const fieldBlanks = { auto: 0, suggest: 0, input: 0, total: blanks.length };
    const samples: Array<{ blank: string; class: Classification }> = [];

    for (const blank of blanks) {
      const cls = classifyBlank(blank, label, guidance);
      fieldBlanks[cls]++;
      blankClassifications[cls]++;
      samples.push({ blank, class: cls });
    }

    fieldAnalysis.push({
      label,
      totalBlanks: blanks.length,
      auto: fieldBlanks.auto,
      suggest: fieldBlanks.suggest,
      input: fieldBlanks.input,
      samples: samples.slice(0, 3),
    });
  }

  const total = blankClassifications.auto + blankClassifications.suggest + blankClassifications.input;
  const autoRate = ((blankClassifications.auto + blankClassifications.suggest * 0.5) / Math.max(total, 1)) * 100;

  return {
    docFile,
    title,
    totalFields: required.length,
    totalBlanks: total,
    auto: blankClassifications.auto,
    suggest: blankClassifications.suggest,
    input: blankClassifications.input,
    automationRate: Math.round(autoRate * 10) / 10,
    fieldAnalysis,
  };
}

function main() {
  const targetDocs = readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();

  const results: DocResult[] = [];
  for (const doc of targetDocs) {
    try {
      results.push(measureDoc(doc));
    } catch (e) {
      console.log(`[WARN] ${doc}: ${(e as Error).message}`);
    }
  }

  console.log(`19종 문서 자동화 수준 측정\n`);
  console.log(`${"문서".padEnd(40)} ${"필드".padStart(5)} ${"빈칸".padStart(5)} ${"auto".padStart(6)} ${"suggest".padStart(8)} ${"input".padStart(6)} ${"자동화%".padStart(8)}`);
  console.log("-".repeat(100));

  const byRate = [...results].sort((a, b) => b.automationRate - a.automationRate);
  for (const r of byRate) {
    console.log(
      `${r.title.slice(0, 38).padEnd(40)} ${String(r.totalFields).padStart(5)} ${String(r.totalBlanks).padStart(5)} ${String(r.auto).padStart(6)} ${String(r.suggest).padStart(8)} ${String(r.input).padStart(6)} ${r.automationRate.toFixed(1).padStart(7)}%`,
    );
  }

  console.log("-".repeat(100));
  const totalBlanks = results.reduce((s, r) => s + r.totalBlanks, 0);
  const totalAuto = results.reduce((s, r) => s + r.auto, 0);
  const totalSuggest = results.reduce((s, r) => s + r.suggest, 0);
  const totalInput = results.reduce((s, r) => s + r.input, 0);
  const overall = ((totalAuto + totalSuggest * 0.5) / Math.max(totalBlanks, 1)) * 100;
  const avgPerDoc = results.reduce((s, r) => s + r.automationRate, 0) / results.length;

  console.log(
    `${"합계 / 평균".padEnd(40)} ${String(results.reduce((s, r) => s + r.totalFields, 0)).padStart(5)} ${String(totalBlanks).padStart(5)} ${String(totalAuto).padStart(6)} ${String(totalSuggest).padStart(8)} ${String(totalInput).padStart(6)} ${overall.toFixed(1).padStart(7)}%`,
  );
  console.log(`\n전체 빈칸: ${totalBlanks}개`);
  console.log(`  ✅ auto (그래프 직접 fetch):       ${totalAuto} (${(totalAuto / totalBlanks * 100).toFixed(1)}%)`);
  console.log(`  🟡 suggest (그래프+LLM 추론):     ${totalSuggest} (${(totalSuggest / totalBlanks * 100).toFixed(1)}%)`);
  console.log(`  📝 input (사용자 입력 필수):       ${totalInput} (${(totalInput / totalBlanks * 100).toFixed(1)}%)`);
  console.log(`\n자동화율 계산: (auto + suggest×0.5) / total = ${overall.toFixed(1)}%`);
  console.log(`문서별 자동화율 평균: ${avgPerDoc.toFixed(1)}%`);

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORTS_DIR, "automation-rate.json"),
    JSON.stringify({
      results,
      overall: {
        totalBlanks,
        auto: totalAuto,
        suggest: totalSuggest,
        input: totalInput,
        automationRate: Math.round(overall * 10) / 10,
        avgPerDoc: Math.round(avgPerDoc * 10) / 10,
      },
    }, null, 2),
    "utf8",
  );
  console.log(`\n저장: reports/automation-rate.json`);
}

main();
