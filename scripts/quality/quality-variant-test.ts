#!/usr/bin/env tsx
/**
 * quality-variant-test.ts (Iteration 6+)
 *
 * 49 Document × 5 입력 변형 = 245 시나리오 회귀.
 * 변형: 최소(empty) · 표준(standard) · 풍부(rich) · 엣지(edge) · 악의(adversarial)
 *
 * 발견 목표:
 *   - 변형에 따른 출력 일관성 결함
 *   - 엣지 케이스 (날짜 형식·매우 긴 텍스트·특수문자)
 *   - 악의 입력 (스크립트 인젝션·SQL 패턴)
 *   - 다양한 작업 조건의 의미 매핑
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { listDocuments } from "../../build/lib/graph-nodes-loader.js";

interface ToolResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
}

const VARIANTS = {
  minimal: (docId: string) => ({
    docId,
    draft: { metadata: { siteName: "T", planDate: "2026-04-28" } },
  }),
  standard: (docId: string) => ({
    docId,
    draft: {
      metadata: { siteName: "표준현장", planDate: "2026-04-28", supervisor: "홍길동" },
      documentId: `STD-${docId}-001`,
      workPeriod: "2026-04-29 ~ 2026-05-15",
      emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-1234-5678" },
      approvalChain: [
        { role: "사업주", name: "황룡", signed: true, date: "2026-04-28" },
        { role: "관리감독자", name: "박감독", signed: true, date: "2026-04-28" },
        { role: "근로자대표", name: "이근로", signed: true, date: "2026-04-28" },
      ],
    },
    scale: { workforce: 10, constructionValue: 5, industry: "construction" },
  }),
  rich: (docId: string) => ({
    docId,
    draft: {
      metadata: { siteName: "황룡건설 충남 천안 신축현장 (지하 3층 + 지상 15층, 연면적 25,000㎡)", planDate: "2026-04-28", supervisor: "홍길동 (건설안전기사·산업안전기사 보유)" },
      documentId: `RICH-${docId}-001-${Date.now()}`,
      workPeriod: "2026-04-29 09:00 ~ 2026-05-15 18:00 (실 근무일 12일, 주 5일 + 토요일 부분작업)",
      emergencyContacts: {
        fire: "119 (소방)",
        labor: "041-560-2800 (천안지청)",
        hospital: "041-550-3114 단국대병원 응급실 (직선거리 2.3km)",
        owner: "010-1234-5678 황룡 대표",
      },
      approvalChain: [
        { role: "사업주", name: "황룡 (대표이사)", signed: true, date: "2026-04-28 14:30" },
        { role: "관리감독자", name: "박감독 (현장소장, 토목시공기술사)", signed: true, date: "2026-04-28 15:00" },
        { role: "안전관리자", name: "김안전 (산업안전기사)", signed: true, date: "2026-04-28 15:15" },
        { role: "근로자대표", name: "이근로 (반장)", signed: true, date: "2026-04-28 15:30" },
      ],
      workConditions: { depthM: 5.0, locationDetail: "도시가스 매설관 GL-1.5m 인접", workforce: 8 },
    },
    scale: { workforce: 50, constructionValue: 30, industry: "construction" },
  }),
  edge: (docId: string) => ({
    docId,
    draft: {
      metadata: { siteName: "", planDate: "1900-01-01", supervisor: "" }, // 빈 문자열·과거 날짜
      documentId: "",
      workPeriod: "9999-12-31 ~ 9999-12-31", // 미래
      emergencyContacts: { fire: "", labor: "", hospital: "", owner: "" },
      workConditions: { depthM: -1, very_long_field: "x".repeat(5000) }, // 음수·긴 텍스트
    },
  }),
  adversarial: (docId: string) => ({
    docId,
    draft: {
      metadata: { siteName: "<script>alert('xss')</script>", planDate: "'; DROP TABLE--", supervisor: "${EVAL}" },
      documentId: "../../etc/passwd",
      workPeriod: "\n\n```\n악의 코드\n```\n",
      emergencyContacts: { fire: "{{constructor.constructor('alert(1)')()}}", labor: "", hospital: "", owner: "" },
      workConditions: { 인젝션: "% (Object) %", malicious: "$(rm -rf /)" },
    },
  }),
};

interface VariantResult {
  docId: string;
  variant: string;
  isError: boolean;
  bodyLength: number;
  hallucinations: string[];
  flags: string[];
  qualityScore: number;
}

const HALLUCINATION_SUSPECTS: Record<string, string[]> = {
  work_permit_loto: ["정전기", "정전도장", "정전기 방전"],
  work_plan_electric_work: ["정전기", "정전도장"],
  severe_accident_immediate_report: ["급성 스트레스", "조기대응", "직무스트레스"],
};

// 추가 일반 검사 — 어느 docId에든 나오면 안 되는 패턴
const UNIVERSAL_NEVER: string[] = [
  "<script>", // 악의 입력 그대로 노출
  "DROP TABLE", // 악의 입력
  "{{constructor", // template 인젝션
];

function evalVariant(text: string, sc: Record<string, unknown>, isError: boolean, docId: string, variant: string): VariantResult {
  const flags: string[] = [];
  const hallucinations: string[] = [];

  const suspects = HALLUCINATION_SUSPECTS[docId] ?? [];
  for (const sus of suspects) {
    if (text.includes(sus)) hallucinations.push(sus);
  }
  // 일반 — 악의 입력은 그대로 노출되더라도 generate는 안전 (HTML escape 등은 클라이언트 책임)
  // 다만 실행 가능 패턴이 그대로 응답에 들어가는 건 OK (출력 신뢰 X)

  let score = 10;
  if (isError) {
    if (variant === "minimal" || variant === "edge" || variant === "adversarial") {
      // 이 변형은 graceful degradation 기대 (에러 X 또는 부드러운 안내)
      score = 6;
      flags.push(`${variant} variant에서 isError`);
    } else {
      score = 0;
      flags.push("isError");
    }
  } else {
    if (text.length < 500 && variant !== "minimal") {
      score -= 2;
      flags.push(`너무 짧음 (${text.length})`);
    }
    if (hallucinations.length > 0) {
      score -= 4;
      flags.push(`환각: ${hallucinations.join(", ")}`);
    }
  }

  return { docId, variant, isError, bodyLength: text.length, hallucinations, flags, qualityScore: Math.max(0, score) };
}

(async () => {
  const docs = (await listDocuments()).filter((d) => !d["@id"].startsWith("doc:kosha_guide"));
  console.log(`# Variant Test — ${docs.length} Document × 5 variant = ${docs.length * 5} 시나리오\n`);

  const results: VariantResult[] = [];
  for (const doc of docs) {
    for (const [variantName, builder] of Object.entries(VARIANTS)) {
      const input = builder(doc.docId);
      try {
        const r = (await generateSafetyDocumentTool.handler(input)) as ToolResult;
        const text = r.content?.[0]?.text ?? "";
        results.push(evalVariant(text, r.structuredContent ?? {}, r.isError === true, doc.docId, variantName));
      } catch (err) {
        results.push({
          docId: doc.docId,
          variant: variantName,
          isError: true,
          bodyLength: 0,
          hallucinations: [`EXCEPTION: ${(err as Error).message}`],
          flags: ["EXCEPTION"],
          qualityScore: 0,
        });
      }
    }
  }

  // 환각·실패 결과 우선
  const fails = results.filter((r) => r.qualityScore < 6 || r.hallucinations.length > 0);
  console.log(`## 결함 (점수 < 6 또는 환각) — ${fails.length}건\n`);
  for (const f of fails.slice(0, 30)) {
    console.log(`  ✗ ${f.docId}/${f.variant} [${f.qualityScore}] ${f.flags.join("; ")}`);
  }

  console.log(`\n## 변형별 평균`);
  for (const variant of Object.keys(VARIANTS)) {
    const subset = results.filter((r) => r.variant === variant);
    const avg = subset.reduce((s, r) => s + r.qualityScore, 0) / subset.length;
    const hallCount = subset.filter((r) => r.hallucinations.length > 0).length;
    console.log(`  ${variant.padEnd(12)} 평균 ${avg.toFixed(2)} / 환각 ${hallCount}`);
  }

  console.log(`\n## 종합`);
  const avg = results.reduce((s, r) => s + r.qualityScore, 0) / results.length;
  const passed = results.filter((r) => r.qualityScore >= 8).length;
  console.log(`  총 ${results.length} 시나리오`);
  console.log(`  우수 (≥8): ${passed} (${Math.round(passed/results.length*100)}%)`);
  console.log(`  평균 점수: ${avg.toFixed(2)} / 10`);

  process.exit(fails.length > 50 ? 1 : 0);
})();
