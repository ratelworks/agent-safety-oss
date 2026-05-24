#!/usr/bin/env tsx
/**
 * test-v150-a2ui-form-value.ts
 *
 * v1.5.0 양방향 그래프 통합이 A2UI 폼 (사용자 진입점) 에 노출하는 가이드/법령
 * 빈칸 자동 채움 효과 정밀 측정.
 *
 * render_a2ui_form 의 v0.9 JSONL 결과를 파싱하여:
 *   - info-card 안에 노출된 KOSHA Guide IRI 카운트
 *   - info-card 안에 노출된 art:* 법령 IRI 카운트
 *   - guide-card / hazard-card 등 추가 데이터 영역 카운트
 *   - 폼 안에 들어가 있는 "빈칸 자동 채움" 텍스트 (예: KOSHA C-1-2018 인용)
 *
 * 안전관리자가 A2UI viewer 에서 폼을 봤을 때 빈칸이 실제로 자동 채워지는지 정량 측정.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = resolve(ROOT, "build/cli.js");
const REPORTS_DIR = resolve(ROOT, "reports");
if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

const DOC_IDS = [
  "daily_tbm",
  "ad_hoc_risk_assessment",
  "industrial_accident_report",
  "work_plan_excavation",
  "msds_register",
];

interface FormResult {
  docId: string;
  rendered: boolean;
  jsonlLines: number;
  componentCount: number;
  guideIriCount: number; // doc:kosha_guide/ 노출 횟수
  lawIriCount: number; // art:* 노출 횟수
  guideCardCount: number; // 가이드 전용 카드
  hazardMentionCount: number; // 위험요인 노출
  controlMentionCount: number; // 통제대책 노출
  legalCitationTextCount: number; // "산안법 §X" 등 텍스트 인용
  totalCharacters: number; // 폼 전체 텍스트 길이
}

function callA2UI(docId: string): FormResult {
  const r = spawnSync(
    "node",
    [CLI, "call", "render_a2ui_form", "--inputJson", JSON.stringify({ docId, format: "jsonl" })],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (r.status !== 0 && r.stdout.length === 0) {
    return {
      docId, rendered: false, jsonlLines: 0, componentCount: 0,
      guideIriCount: 0, lawIriCount: 0, guideCardCount: 0,
      hazardMentionCount: 0, controlMentionCount: 0, legalCitationTextCount: 0,
      totalCharacters: 0,
    };
  }

  // CLI 응답은 JSON. structuredContent 안에 jsonl 또는 components 가 들어있음.
  let response: any;
  try { response = JSON.parse(r.stdout); }
  catch { return { docId, rendered: false, jsonlLines: 0, componentCount: 0, guideIriCount: 0, lawIriCount: 0, guideCardCount: 0, hazardMentionCount: 0, controlMentionCount: 0, legalCitationTextCount: 0, totalCharacters: 0 }; }

  const text = (response?.content?.[0]?.text as string) ?? "";
  const sc = response?.structuredContent ?? {};
  // jsonl 또는 components 둘 다 가능
  const blob = JSON.stringify({ text, sc });
  const jsonlLines = (text.match(/\n/g) ?? []).length;
  const componentCount = (blob.match(/"type":\s*"/g) ?? []).length;

  return {
    docId,
    rendered: true,
    jsonlLines,
    componentCount,
    guideIriCount: (blob.match(/doc:kosha_guide\//g) ?? []).length,
    lawIriCount: (blob.match(/"art:/g) ?? []).length,
    guideCardCount: (blob.match(/"guide-card"|"koshaGuide"/g) ?? []).length,
    hazardMentionCount: (blob.match(/hazard:[a-z_]+/g) ?? []).length,
    controlMentionCount: (blob.match(/control:[a-z_]+/g) ?? []).length,
    legalCitationTextCount:
      (blob.match(/산안법\s*§|산업안전보건법\s*제\d+조|기준규칙\s*§|위험성평가\s*고시/g) ?? []).length,
    totalCharacters: blob.length,
  };
}

async function main(): Promise<void> {
  console.log("# v1.5.0 A2UI 폼 자동 채움 — 정량 매트릭스");
  console.log(`> 실행: ${new Date().toISOString().slice(0, 19)}`);
  console.log("");

  const results: FormResult[] = [];
  for (const docId of DOC_IDS) {
    process.stdout.write(`  [${docId}] ... `);
    const r = callA2UI(docId);
    results.push(r);
    if (r.rendered) {
      console.log(
        `comp=${r.componentCount} guide=${r.guideIriCount} law=${r.lawIriCount} hazard=${r.hazardMentionCount} control=${r.controlMentionCount}`,
      );
    } else {
      console.log("❌ 렌더 실패");
    }
  }

  console.log("");
  console.log("## 종합 매트릭스 (A2UI 폼 내부 노출량)");
  console.log("");
  console.log("| 시나리오 | 렌더 | 컴포넌트 | 가이드 IRI | 법령 IRI | 위험 | 통제 | 법령 인용 텍스트 |");
  console.log("|---|:---:|---:|---:|---:|---:|---:|---:|");
  for (const r of results) {
    const rendered = r.rendered ? "✅" : "❌";
    console.log(
      `| ${r.docId} | ${rendered} | ${r.componentCount} | ${r.guideIriCount} | ${r.lawIriCount} | ${r.hazardMentionCount} | ${r.controlMentionCount} | ${r.legalCitationTextCount} |`,
    );
  }

  console.log("");
  console.log("## 안전관리자 사용 가치 (A2UI 폼에서 자동으로 보이는 정보)");
  console.log("");
  const allRendered = results.every((r) => r.rendered);
  const guideTotal = results.reduce((s, r) => s + r.guideIriCount, 0);
  const lawTotal = results.reduce((s, r) => s + r.lawIriCount, 0);
  const hazardTotal = results.reduce((s, r) => s + r.hazardMentionCount, 0);
  const controlTotal = results.reduce((s, r) => s + r.controlMentionCount, 0);
  const compTotal = results.reduce((s, r) => s + r.componentCount, 0);
  console.log(`- 5개 폼 모두 렌더 성공: ${allRendered ? "✅" : "❌"}`);
  console.log(`- 총 컴포넌트: **${compTotal}** (평균 ${(compTotal / 5).toFixed(0)} per 폼)`);
  console.log(`- 폼 내 KOSHA Guide IRI 노출: **${guideTotal}건** (평균 ${(guideTotal / 5).toFixed(1)} per 폼)`);
  console.log(`- 폼 내 법령 IRI 노출: **${lawTotal}건** (평균 ${(lawTotal / 5).toFixed(1)} per 폼)`);
  console.log(`- 폼 내 위험요인 노출: **${hazardTotal}건**`);
  console.log(`- 폼 내 통제대책 노출: **${controlTotal}건**`);
  console.log("");
  console.log("=> CLI 미숙련 안전관리자가 viewer (localhost:5174) 에서 폼 열면 빈칸이 위 정량만큼 자동 채워짐");

  const reportPath = resolve(REPORTS_DIR, "v150-a2ui-form-value.json");
  writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), forms: results }, null, 2), "utf8");
  console.log("");
  console.log(`[saved] ${reportPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
