#!/usr/bin/env tsx
/**
 * quality-regression.ts (v0.8+)
 *
 * 49종 Document 자동 회귀 평가:
 *   - 표준 입력으로 generate 호출
 *   - 출력 본문에 환각 의심 키워드 잔류 검사
 *   - KOSHA·Hazard·Control 매핑 통계
 *   - docId별 점수 (출력 길이·매핑 정확성·환각 0)
 *   - 의심 결함 자동 식별
 *
 * 반복 실행으로 결함 수렴.
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { listDocuments } from "../../build/lib/graph-nodes-loader.js";

interface ToolResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
}

// 환각 의심 키워드 — 출력에 나타나면 결함 의심
// 각 docId 별 의심 키워드 (이 docId에 *나오면 안 되는* 키워드)
const HALLUCINATION_SUSPECTS: Record<string, string[]> = {
  work_permit_loto: ["정전기", "정전도장", "정전기 방전"],
  work_plan_electric_work: ["정전기", "정전도장"],
  severe_accident_immediate_report: ["급성 스트레스", "조기대응", "직무스트레스"],
  daily_tbm: ["타워크레인 작업", "굴착작업"], // TBM은 일일 안전회의로 작업별 가이드는 부적합
  ppe_register: ["정전기"], // 보호구 등록은 정전기 화재 방지와 별개
  msds_register: ["교통사고"],
  health_safety_committee: ["굴착", "타워크레인"], // 위원회는 행정
  safety_health_management_policy: ["굴착", "용접"],
  safety_health_regulation: ["굴착작업"],
  industrial_accident_report: ["급성 스트레스", "조기대응"],
};

// 일반 표준 입력 (모든 Document에 사용)
function buildInput(docId: string): unknown {
  return {
    docId,
    useProfile: false,
    draft: {
      metadata: {
        siteName: "테스트 사업장",
        planDate: "2026-04-28",
        supervisor: "홍길동",
      },
      documentId: `TEST-${docId}-001`,
      workPeriod: "2026-04-29 ~ 2026-05-15",
      emergencyContacts: {
        fire: "119",
        labor: "041-560-2800",
        hospital: "041-550-3114",
        owner: "010-1234-5678",
      },
      approvalChain: [
        { role: "사업주", name: "황룡", signed: true, date: "2026-04-28" },
      ],
    },
    scale: { workforce: 10, constructionValue: 5, industry: "construction" },
  };
}

interface DocResult {
  docId: string;
  title: string;
  isError: boolean;
  bodyLength: number;
  koshaCount: number;
  hazardCount: number;
  controlCount: number;
  sectionsCount: number;
  hallucinationsFound: string[]; // 출력에서 발견된 의심 키워드
  qualityScore: number; // 0~10
  flags: string[]; // 의심 사항
}

function evaluateOutput(
  docId: string,
  text: string,
  sc: Record<string, unknown>,
  isError: boolean,
): DocResult {
  const koshaCount = (sc["koshaGuideCount"] as number | undefined) ?? 0;
  const hazardCount = (sc["hazardCount"] as number | undefined) ?? 0;
  const controlCount = (sc["controlCount"] as number | undefined) ?? 0;
  const sectionsCount = (sc["sectionsCount"] as number | undefined) ?? 0;
  const bodyLength = text.length;

  const flags: string[] = [];
  const hallucinations: string[] = [];
  const textWithoutCode = text.replace(/```[\s\S]*?```/g, "");

  // 1. 환각 의심 키워드 검사
  // 법령 원문 발췌 코드블록에는 범용 조문 예시가 포함될 수 있으므로 생성 문장만 검사한다.
  const suspects = HALLUCINATION_SUSPECTS[docId] ?? [];
  for (const sus of suspects) {
    if (textWithoutCode.includes(sus)) {
      hallucinations.push(sus);
    }
  }

  // 2. IRI 잔류 검사 (가독성 회귀) — 본문 내에 미변환 IRI가 있으면 결함
  // 단 코드블록 내 본문은 제외 (extractArticleBody 출력에 자연스러운 § 참조)
  const iriPatterns = [/\bart:[가-힣A-Za-z]+:[0-9]/, /\bannex:[가-힣A-Za-z]+:/, /\bpenalty:[가-힣A-Za-z]+:/];
  const iriResidual: string[] = [];
  for (const re of iriPatterns) {
    const m = textWithoutCode.match(re);
    if (m) iriResidual.push(m[0]);
  }
  if (iriResidual.length > 0) {
    flags.push(`IRI 잔류 (가독성 X): ${iriResidual.join(", ")}`);
  }

  // 3. 법령 본문 발췌 작동 검사 — 작업/허가/사고 문서엔 §N 본문 발췌가 있어야
  const isWorkDoc = docId.startsWith("work_plan_") || docId.startsWith("work_permit_");
  const hasLawExtract = text.includes("```\n①") || text.includes("```\n사업주는") || text.includes("```\n- 사전조사:");
  const hasLawSection = text.includes("법령 근거");
  if (isWorkDoc && hasLawSection && !hasLawExtract) {
    flags.push("법령 본문 발췌 누락 (코드 블록 없음)");
  }

  // 4. 행정 문서 양식 일관성 검사 — administrative/report는 "사업장명" 사용
  const isAdminDoc =
    docId.startsWith("safety_health_") ||
    docId === "severe_accident_immediate_report" ||
    docId === "industrial_accident_report" ||
    docId === "health_safety_committee" ||
    docId === "contractor_safety_council";
  if (isAdminDoc && text.includes("| 현장명 |")) {
    flags.push("행정 문서에 '현장명' 강제 (양식 일관성 결여)");
  }

  // 5. 결재선 기본값 검사 — 모든 문서에 결재선 섹션 있어야
  // generate-safety-document.ts:586 의 출력 패턴 `## 결재선` 정합
  if (!/^##\s+(\d+\.\s+)?결재선/m.test(text)) {
    flags.push("결재선 섹션 누락");
  }

  // 6. 비상연락망 검사
  if (!text.includes("비상연락망")) {
    flags.push("비상연락망 누락");
  }

  // 점수 계산
  let score = 10;
  if (isError) {
    score = 0;
    flags.push("isError");
  } else {
    if (bodyLength < 800) {
      score -= 3;
      flags.push(`너무 짧음 (${bodyLength})`);
    }
    if (hallucinations.length > 0) {
      score -= 4;
      flags.push(`환각 의심: [${hallucinations.join(", ")}]`);
    }
    if (iriResidual.length > 0) {
      score -= 2;
    }
    if (isWorkDoc && hasLawSection && !hasLawExtract) {
      score -= 2;
    }
    if (isAdminDoc && text.includes("| 현장명 |")) {
      score -= 2;
    }
    if (sectionsCount === 0) {
      score -= 1;
      flags.push("sections 메타 미정의 (fallback)");
    }
    if (
      koshaCount === 0 &&
      (docId.startsWith("work_plan_") || docId.startsWith("work_permit_") || docId.startsWith("hazardous_"))
    ) {
      score -= 1;
      flags.push("작업 문서인데 KOSHA 0건");
    }
    if (hazardCount > 10) {
      score -= 1;
      flags.push(`Hazard 과매핑 (${hazardCount})`);
    }
  }

  return {
    docId,
    title: String(sc["title"] ?? ""),
    isError,
    bodyLength,
    koshaCount,
    hazardCount,
    controlCount,
    sectionsCount,
    hallucinationsFound: hallucinations,
    qualityScore: Math.max(0, score),
    flags,
  };
}

(async () => {
  const docs = (await listDocuments()).filter((d) => !d["@id"].startsWith("doc:kosha_guide"));
  console.log(`# Quality Regression — ${docs.length} Document\n`);

  const results: DocResult[] = [];
  for (const doc of docs) {
    try {
      const r = (await generateSafetyDocumentTool.handler(buildInput(doc.docId))) as ToolResult;
      const text = r.content?.[0]?.text ?? "";
      const sc = r.structuredContent ?? {};
      const result = evaluateOutput(doc.docId, text, sc, r.isError === true);
      results.push(result);
    } catch (err) {
      results.push({
        docId: doc.docId,
        title: "",
        isError: true,
        bodyLength: 0,
        koshaCount: 0,
        hazardCount: 0,
        controlCount: 0,
        sectionsCount: 0,
        hallucinationsFound: [`EXCEPTION: ${(err as Error).message}`],
        qualityScore: 0,
        flags: ["EXCEPTION"],
      });
    }
  }

  // 정렬 (점수 낮은 순 — 결함 우선 노출)
  results.sort((a, b) => a.qualityScore - b.qualityScore);

  console.log(`## 점수 낮은 순 (개선 우선)\n`);
  console.log(`| docId | 점수 | KOSHA | H | C | sections | flags |`);
  console.log(`|---|---:|---:|---:|---:|---:|---|`);
  for (const r of results.slice(0, 20)) {
    console.log(`| ${r.docId} | ${r.qualityScore} | ${r.koshaCount} | ${r.hazardCount} | ${r.controlCount} | ${r.sectionsCount} | ${r.flags.join("; ") || "—"} |`);
  }

  console.log(`\n## 환각 의심 발견된 docId\n`);
  const halls = results.filter((r) => r.hallucinationsFound.length > 0);
  if (halls.length === 0) {
    console.log(`✓ 환각 의심 0건`);
  } else {
    for (const r of halls) {
      console.log(`- **${r.docId}**: ${r.hallucinationsFound.join(", ")}`);
    }
  }

  console.log(`\n## 종합`);
  const passed = results.filter((r) => r.qualityScore >= 8).length;
  const warning = results.filter((r) => r.qualityScore >= 5 && r.qualityScore < 8).length;
  const failed = results.filter((r) => r.qualityScore < 5).length;
  const avg = results.reduce((s, r) => s + r.qualityScore, 0) / results.length;
  console.log(`  ✓ 우수 (≥8): ${passed} / ${results.length}`);
  console.log(`  △ 경고 (5~7): ${warning}`);
  console.log(`  ✗ 결함 (<5): ${failed}`);
  console.log(`  평균 점수: ${avg.toFixed(2)} / 10`);
  console.log(`  환각 의심 발견: ${halls.length} / ${results.length}`);

  process.exit(halls.length > 0 || failed > 0 ? 1 : 0);
})();
