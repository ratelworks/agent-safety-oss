#!/usr/bin/env tsx
/**
 * auto-defect-detection.ts (L1 자동화)
 *
 * 70개 의무문서 모두 자동 generate → 결함 통계 → 보강 우선순위 산출.
 *
 * 검출 항목:
 *   1. 빈칸 비율 (미작성 필수 필드)
 *   2. inputGuide 부재 필드 (보강 필요)
 *   3. 환각 의심 키워드 잔류
 *   4. KOSHA 가이드 매핑 부족
 *   5. 법령 본문 발췌 누락
 *
 * 출력: 우선순위 리포트 (가장 결함 많은 doc·field 정렬)
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { listDocuments } from "../../build/lib/graph-nodes-loader.js";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUT = resolve(ROOT, "artifacts", "test-results", "auto");

interface DocDefect {
  docId: string;
  title: string;
  category: string;
  bodyLength: number;
  emptyFieldCount: number;
  totalFieldCount: number;
  emptyRatio: number;
  fieldsWithoutGuide: number;
  hallucinations: string[];
  koshaCount: number;
  hazardCount: number;
  legalBodyMissing: boolean;
  priority: number;  // 보강 우선순위 점수 (높을수록 시급)
}

const HALLUCINATION_KEYWORDS = ["lorem", "임의값", "TODO", "FIXME", "본 OSS 7 법령 번들에 본문 미수록"];

function categorize(docId: string): string {
  if (docId.startsWith("work_plan_")) return "workPlan";
  if (docId.startsWith("work_permit")) return "workPermit";
  if (docId.includes("inspection") || docId.includes("check")) return "inspection";
  if (docId.includes("accident") || docId.includes("severe")) return "accident";
  if (docId.includes("drawing") || docId.includes("plan_") || docId.includes("placement")) return "drawing";
  return "admin";
}

const STD_INPUT = (docId: string) => ({
  docId,
  draft: {
    metadata: { siteName: "테스트현장", planDate: "2026-04-28", supervisor: "테스터" },
    documentId: `AUTO-${docId}`,
    workPeriod: "2026-04-29 ~ 2026-05-15",
    emergencyContacts: { fire: "119", labor: "T", hospital: "T", owner: "T" },
    approvalChain: [{ role: "사업주", name: "T", signed: true, date: "2026-04-28" }],
  },
  scale: { workforce: 10, constructionValue: 5, industry: "construction" },
});

async function main() {
  await mkdir(OUT, { recursive: true });
  const docs = (await listDocuments()).filter((d: any) => !d["@id"].startsWith("doc:kosha_guide"));
  console.log(`자동 결함 검출 시작 — ${docs.length}개 의무문서\n`);

  const defects: DocDefect[] = [];
  for (const doc of docs) {
    const docId = (doc as any).docId ?? "";
    if (!docId) continue;

    let r: any;
    try {
      r = await generateSafetyDocumentTool.handler(STD_INPUT(docId));
    } catch (err) {
      continue;
    }
    const text = r.content?.[0]?.text ?? "";
    const struct = r.structuredContent ?? {};
    if (r.isError) continue;

    const emptyFieldCount = (text.match(/\(미작성 — 필수\)/g) ?? []).length;
    const totalFieldCount = (text.match(/^\| [^|]+ \|/gm) ?? []).length;

    // sections.fields 중 inputGuide 없는 비율
    let fieldsWithoutGuide = 0;
    let totalRequiredFields = 0;
    for (const sec of (doc as any).sections ?? []) {
      for (const f of sec.fields ?? []) {
        if (f.required) totalRequiredFields += 1;
        if (f.required && !f.inputGuide) fieldsWithoutGuide += 1;
      }
    }

    const hallucinations: string[] = [];
    for (const k of HALLUCINATION_KEYWORDS) {
      if (text.toLowerCase().includes(k.toLowerCase())) hallucinations.push(k);
    }

    const koshaCount = struct.koshaGuideCount ?? 0;
    const hazardCount = struct.hazardCount ?? 0;
    const legalBodyMissing = !text.includes("```\n①") && !text.includes("```\n사업주") && !text.includes("```\n- ") && !text.includes("```\n제");

    // 우선순위: 빈칸비율 × 가중치 + 환각 + 가이드부재
    const emptyRatio = totalFieldCount > 0 ? emptyFieldCount / totalFieldCount : 0;
    const priority =
      emptyRatio * 50 +
      hallucinations.length * 30 +
      (totalRequiredFields > 0 ? (fieldsWithoutGuide / totalRequiredFields) * 20 : 0);

    defects.push({
      docId,
      title: (doc as any).title ?? docId,
      category: categorize(docId),
      bodyLength: text.length,
      emptyFieldCount,
      totalFieldCount,
      emptyRatio,
      fieldsWithoutGuide,
      hallucinations,
      koshaCount,
      hazardCount,
      legalBodyMissing,
      priority,
    });
  }

  // 우선순위 정렬
  defects.sort((a, b) => b.priority - a.priority);

  // 종합 통계
  const total = defects.length;
  const sumEmpty = defects.reduce((s, d) => s + d.emptyFieldCount, 0);
  const sumFields = defects.reduce((s, d) => s + d.totalFieldCount, 0);
  const docsWithoutGuide = defects.filter((d) => d.fieldsWithoutGuide > 0).length;
  const docsWithHall = defects.filter((d) => d.hallucinations.length > 0).length;
  const fieldsWithoutGuideTotal = defects.reduce((s, d) => s + d.fieldsWithoutGuide, 0);

  console.log("════════════════════════════════════════");
  console.log("종합 결함 통계");
  console.log("════════════════════════════════════════");
  console.log(`전체 문서:                  ${total}`);
  console.log(`빈칸 합계:                  ${sumEmpty} / ${sumFields} = ${(100 * sumEmpty / sumFields).toFixed(1)}%`);
  console.log(`inputGuide 미보유 문서:     ${docsWithoutGuide} / ${total}`);
  console.log(`inputGuide 미보유 필드 합계: ${fieldsWithoutGuideTotal}`);
  console.log(`환각 의심 문서:             ${docsWithHall}`);
  console.log("");

  // 카테고리별
  console.log("─ 카테고리별 결함 평균 ─");
  const cats = ["workPlan", "workPermit", "inspection", "drawing", "accident", "admin"];
  for (const c of cats) {
    const sub = defects.filter((d) => d.category === c);
    if (sub.length === 0) continue;
    const avgEmpty = sub.reduce((s, d) => s + d.emptyRatio, 0) / sub.length;
    const sumGuide = sub.reduce((s, d) => s + d.fieldsWithoutGuide, 0);
    console.log(`  ${c.padEnd(12)} ${sub.length}개 / 빈칸 ${(100 * avgEmpty).toFixed(0)}% / 가이드 미보유 필드 ${sumGuide}`);
  }
  console.log("");

  // 보강 우선순위 Top 15
  console.log("─ 보강 우선순위 Top 15 ─");
  console.log(`| 순위 | docId | 카테고리 | 빈칸% | 가이드없음 | 환각 | 우선순위 |`);
  console.log(`|---|---|---|---:|---:|---:|---:|`);
  for (let i = 0; i < Math.min(15, defects.length); i++) {
    const d = defects[i];
    console.log(`| ${i+1} | ${d.docId} | ${d.category} | ${(100 * d.emptyRatio).toFixed(0)}% | ${d.fieldsWithoutGuide} | ${d.hallucinations.length} | ${d.priority.toFixed(1)} |`);
  }
  console.log("");

  // 환각 발견 문서
  if (docsWithHall > 0) {
    console.log("─ 환각 의심 발견 ─");
    for (const d of defects.filter((d) => d.hallucinations.length > 0)) {
      console.log(`  ${d.docId}: ${d.hallucinations.join(", ")}`);
    }
  }

  // JSON 저장
  await writeFile(resolve(OUT, "defect-report.json"), JSON.stringify(defects, null, 2), "utf-8");
  console.log(`\n→ 전체 결함 리포트: ${OUT}/defect-report.json`);
}

main().catch(console.error);
