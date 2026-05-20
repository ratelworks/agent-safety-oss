#!/usr/bin/env tsx
/**
 * 실제 LLM 작성 결과 객관 비교 (자동 카운트).
 *
 * 작성자: Codex (GPT-5.5)
 * 평가자: 자동 스크립트 (자가 채점 회피)
 *
 * 측정 항목:
 *   1. article 노드 인용 수 (§N 패턴)
 *   2. KOSHA Guide 코드 인용 수 (D-C-N-YYYY, C-N-YYYY 등)
 *   3. 구체 수치 명시 수 (수치·면허번호·전화번호 등)
 *   4. 표 항목 수 (정보 밀도)
 *   5. 본문 길이 (문자 수)
 *   6. 명시된 책임자/명단 구체성
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TESTS = resolve(ROOT, "reports/real-llm-tests");

interface SpecificNumbers {
  phone: number;
  license: number;
  measurements: number;
  ratios: number;
  document_codes: number;
}

interface Analysis {
  label: string;
  length: number;
  lines: number;
  articles_cited: number[];
  articles_count: number;
  kosha_guides: string[];
  kosha_guides_count: number;
  specific_numbers: SpecificNumbers;
  hazards_mentioned: number;
  controls_mentioned: number;
}

function countArticles(text: string): number[] {
  const pattern = /§\s*(\d+(?:-\d+)?)|제\s*(\d+(?:의\s*\d+)?)\s*조/g;
  const nums = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const n = m[1] || m[2];
    if (n && /^\d+$/.test(n)) nums.add(parseInt(n, 10));
  }
  return Array.from(nums).sort((a, b) => a - b);
}

function countKoshaGuides(text: string): string[] {
  const pattern = /(?:[ACDEHMP])-(?:[A-Z]-)?\d+-\d{4}/g;
  return Array.from(new Set(text.match(pattern) || []));
}

function countSpecificNumbers(text: string): SpecificNumbers {
  return {
    phone: (text.match(/\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}/g) || []).length,
    license: (text.match(/\d{2}-\d{4}-\d{4}/g) || []).length,
    measurements: (text.match(/\d+(?:\.\d+)?\s*(?:mm|cm|m\b|°|%|kg|ton|L|ppm|mg\/m³|dBA?|MA형|1종|2종)/g) || []).length,
    ratios: (text.match(/1:\d+(?:\.\d+)?/g) || []).length,
    document_codes: (text.match(/(?:도면|별첨)\s*(?:번호\s*)?[A-Z]{2,}-\d{4}-\d+/g) || []).length,
  };
}

function countSafetyConcepts(text: string): { hazards_mentioned: number; controls_mentioned: number } {
  const hazards = ["붕괴", "매몰", "추락", "낙하", "깔림", "뒤집힘", "맞음", "감전", "폭발", "화재",
    "가스누출", "산소결핍", "질식", "소음", "진동", "온열", "동결", "근골격계"];
  const controls = ["흙막이", "안전기울기", "계측", "안전난간", "안전대", "신호수", "유도자",
    "추락방호망", "환기", "농도측정", "절연", "보호구", "안전모", "안전화", "MA형", "1종", "특급"];
  return {
    hazards_mentioned: hazards.filter((h) => text.includes(h)).length,
    controls_mentioned: controls.filter((c) => text.includes(c)).length,
  };
}

function analyze(label: string, path: string): Analysis {
  const text = readFileSync(path, "utf8");
  const articles = countArticles(text);
  const guides = countKoshaGuides(text);
  const nums = countSpecificNumbers(text);
  const concepts = countSafetyConcepts(text);
  return {
    label,
    length: text.length,
    lines: (text.match(/\n/g) || []).length,
    articles_cited: articles,
    articles_count: articles.length,
    kosha_guides: guides,
    kosha_guides_count: guides.length,
    specific_numbers: nums,
    hazards_mentioned: concepts.hazards_mentioned,
    controls_mentioned: concepts.controls_mentioned,
  };
}

function grade(articleCount: number, guideCount: number, length: number, conceptsSum: number): number {
  let score = 0;
  score += Math.min(articleCount / 8, 1) * 30;
  score += Math.min(guideCount / 5, 1) * 25;
  score += Math.min(length / 4000, 1) * 15;
  score += Math.min(conceptsSum / 25, 1) * 30;
  return Math.round(score * 10) / 10;
}

function pad(s: string | number, width: number, align: "left" | "right" = "right"): string {
  const str = String(s);
  if (str.length >= width) return str;
  return align === "right" ? str.padStart(width) : str.padEnd(width);
}

function fmtNum(n: number, signed = false): string {
  const sign = signed && n >= 0 ? "+" : "";
  return sign + n.toLocaleString("en-US");
}

function main() {
  const a = analyze("A. MCP 미사용 (Codex 단독)", resolve(TESTS, "codex-without-mcp.md"));
  const b = analyze("B. MCP 사용 (Codex + 그래프)", resolve(TESTS, "codex-with-mcp.md"));

  console.log("실제 LLM (Codex/GPT-5.5) — MCP 사용 vs 미사용 객관 비교");

  console.log(`\n${pad("메트릭", 30, "left")} ${pad("A. MCP 미사용", 18)} ${pad("B. MCP 사용", 18)} ${pad("Δ", 10)}`);
  console.log("-".repeat(80));
  console.log(`${pad("본문 길이 (문자)", 30, "left")} ${pad(fmtNum(a.length), 18)} ${pad(fmtNum(b.length), 18)} ${pad(fmtNum(b.length - a.length, true), 10)}`);
  console.log(`${pad("본문 행수", 30, "left")} ${pad(fmtNum(a.lines), 18)} ${pad(fmtNum(b.lines), 18)} ${pad(fmtNum(b.lines - a.lines, true), 10)}`);
  console.log(`${pad("법령 article 인용 수", 30, "left")} ${pad(a.articles_count, 18)} ${pad(b.articles_count, 18)} ${pad(fmtNum(b.articles_count - a.articles_count, true), 10)}`);
  console.log(`${pad("KOSHA Guide 인용 수", 30, "left")} ${pad(a.kosha_guides_count, 18)} ${pad(b.kosha_guides_count, 18)} ${pad(fmtNum(b.kosha_guides_count - a.kosha_guides_count, true), 10)}`);
  console.log(`${pad("hazard 언급", 30, "left")} ${pad(a.hazards_mentioned, 18)} ${pad(b.hazards_mentioned, 18)} ${pad(fmtNum(b.hazards_mentioned - a.hazards_mentioned, true), 10)}`);
  console.log(`${pad("control 언급", 30, "left")} ${pad(a.controls_mentioned, 18)} ${pad(b.controls_mentioned, 18)} ${pad(fmtNum(b.controls_mentioned - a.controls_mentioned, true), 10)}`);

  console.log(`\n구체 수치 메시 (정확도 지표):`);
  for (const k of ["phone", "license", "measurements", "ratios", "document_codes"] as const) {
    const va = a.specific_numbers[k];
    const vb = b.specific_numbers[k];
    console.log(`  ${pad(k, 25, "left")} ${pad(va, 18)} ${pad(vb, 18)} ${pad(fmtNum(vb - va, true), 10)}`);
  }

  console.log(`\n법령 article 목록:`);
  console.log(`  A (MCP 미사용): ${a.articles_cited.length > 0 ? "§" + a.articles_cited.join(", §") : "(없음)"}`);
  console.log(`  B (MCP 사용):   §${b.articles_cited.join(", §")}`);

  console.log(`\nKOSHA Guide 목록:`);
  console.log(`  A: ${a.kosha_guides.length > 0 ? a.kosha_guides.join(", ") : "(없음)"}`);
  console.log(`  B: ${b.kosha_guides.join(", ")}`);

  const aScore = grade(a.articles_count, a.kosha_guides_count, a.length, a.hazards_mentioned + a.controls_mentioned);
  const bScore = grade(b.articles_count, b.kosha_guides_count, b.length, b.hazards_mentioned + b.controls_mentioned);
  console.log(`\n객관 종합 점수 (100점 만점, 정량 카운트 기반):`);
  console.log(`  A. MCP 미사용: ${aScore}`);
  console.log(`  B. MCP 사용:   ${bScore}`);
  console.log(`  Δ:           +${(bScore - aScore).toFixed(1)}`);

  writeFileSync(
    resolve(TESTS, "comparison-summary.json"),
    JSON.stringify({ a, b, a_score: aScore, b_score: bScore, delta: bScore - aScore }, null, 2),
    "utf8",
  );
  console.log(`\n저장: reports/real-llm-tests/comparison-summary.json`);
}

main();
