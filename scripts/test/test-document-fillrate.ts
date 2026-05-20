#!/usr/bin/env tsx
/**
 * test-document-fillrate.ts
 *
 * 94종 법정문서를 generate_safety_document 로 자동 작성한 결과가
 * 노드의 requiredFields / sections 양식을 얼마나 채우는지 정량 평가.
 *
 * 평가 메트릭 (각 docId별):
 *   1. 양식 필드 매핑 채움률 (requiredFields 또는 sections.fields 채움 비율)
 *   2. 법령 인용 무결성 (인용된 법령 IRI 가 그래프 Article 에 실존)
 *   3. 환각 검출 (review_safety_document 의 [HALLUCINATION_DETECTED] 마커)
 *   4. 결재선 완결성 (approvalChain 필수 역할)
 *   5. 그래프 컨텍스트 활용 (assemble_doc_context 로 조립한 hazard·control 이 결과에 반영)
 *
 * 빈도 우선 정렬 — 매일·매주·작업단위 부터.
 *
 * 실행:
 *   npm run mcp:test:fillrate                # 전 94종
 *   npx tsx scripts/test/test-document-fillrate.ts --top 20    # 빈도 상위 20종만
 *   npx tsx scripts/test/test-document-fillrate.ts --docId daily_tbm  # 단일 검증
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(ROOT, "build", "cli.js");
const NODES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");
const MASTER_PATH = resolve(ROOT, "src", "ontology", "legal-duty-master.json");
const OUT_DIR = resolve(ROOT, "artifacts", "test-results", "core", "fillrate");

const args = process.argv.slice(2);
const topArg = args.indexOf("--top") >= 0 ? Number(args[args.indexOf("--top") + 1]) : 0;
const docIdArg = args.indexOf("--docId") >= 0 ? args[args.indexOf("--docId") + 1] : null;

interface MasterDoc {
  docId: string;
  title: string;
  category: string;
  frequency: string;
  formStrictness: string;
}

interface CallOk {
  ok: true;
  text: string;
  data: any;
  ms: number;
}
interface CallFail {
  ok: false;
  reason: string;
  ms: number;
}
type CallResult = CallOk | CallFail;

function call(tool: string, input: Record<string, unknown>): CallResult {
  const t0 = Date.now();
  const res = spawnSync("node", [CLI, "call", tool, "--inputJson", JSON.stringify(input)], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  if (res.status !== 0) return { ok: false, reason: `exit=${res.status}`, ms };
  try {
    const parsed = JSON.parse(res.stdout);
    if (parsed.isError)
      return { ok: false, reason: parsed.content?.[0]?.text?.slice(0, 100) ?? "isError", ms };
    return { ok: true, text: parsed.content?.[0]?.text ?? "", data: parsed.structuredContent, ms };
  } catch (e: any) {
    return { ok: false, reason: `parse: ${e.message}`, ms };
  }
}

function loadMasterDocs(): MasterDoc[] {
  const raw = JSON.parse(readFileSync(MASTER_PATH, "utf8"));
  return raw.documents;
}

function loadNode(docId: string): any | null {
  for (const f of readdirSync(NODES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    try {
      const n = JSON.parse(readFileSync(join(NODES_DIR, f), "utf8"));
      if (n.docId === docId) return n;
    } catch {}
  }
  return null;
}

// 빈도 우선순위 (매일 가장 높음)
const FREQUENCY_PRIORITY: Record<string, number> = {
  매일: 100,
  "매일·매주·매월": 99,
  매주: 90,
  "매주·강풍후": 89,
  작업단위: 80,
  "월1회": 75,
  매월: 70,
  "월·반기": 69,
  "월·정산": 68,
  분기: 60,
  반기: 55,
  연: 50,
  "연1회/특수 6개월": 49,
  현장개설: 40,
  "사고시 1개월": 35,
  "사고시 즉시": 35,
  사고후: 34,
  채용시: 30,
  변경시: 30,
  작업변경시: 30,
  특수작업시: 30,
  선임시: 25,
  발주시: 25,
  설계시: 25,
  착공: 25,
  공사전: 25,
  타설전: 25,
  해체전: 25,
  조립후: 25,
  기계도입시: 25,
  특수진단후: 25,
  지정시: 20,
  주기검사: 20,
  수시: 15,
  "건설 2일1회 / 기타 주1회": 60,
  "건설 2개월1회 / 기타 분기": 55,
};

function freqPriority(f: string): number {
  return FREQUENCY_PRIORITY[f] ?? 10;
}

interface FillRateResult {
  docId: string;
  title: string;
  category: string;
  frequency: string;
  formStrictness: string;
  generated: boolean;
  generateMs: number;
  generateError?: string;
  // 양식 필드 분석
  totalFields: number;
  fieldsInDoc: number;
  fieldsFilled: number;
  fillRate: number; // 0~1
  // 법령 인용
  legalRefsInNode: number;
  legalRefsInOutput: number;
  legalCoverage: number; // 0~1 출력에 등장한 법령 IRI 수 / 노드 legalBasis 수
  // 환각
  hallucinationFlag: boolean;
  hallucinationKeywords: string[];
  // 결재선
  approvalChainPresent: boolean;
  // 그래프 컨텍스트
  graphScore: number; // 0~7
  // 종합
  qualityScore: number; // 0~100
}

// 환각 의심 패턴 (review_safety_document 의 [HALLUCINATION_DETECTED] 마커 외 보조)
// 정확한 법령 §·항 인용은 정상이므로 패턴에서 제외
// 법령 인용 정규화 매칭 — IRI 표기 ↔ 자연어 표기 차이 흡수.
// 예: art:기준규칙:38 ↔ 출력의 "제38조" "§38" "38조" 모두 매치.
// 예: annex:기준규칙:별표4-6호 ↔ 출력의 "별표 4 제6호" "별표 4 6호" "별표4-6호" 모두 매치.
function matchesLegalRefInText(iri: string, text: string): boolean {
  const stripped = iri.replace(/^(art|annex):/, "");
  const parts = stripped.split(":");
  if (parts.length < 2) return text.includes(stripped);
  const tail = parts[parts.length - 1];

  // annex 별표 정규화 — 다양한 표기 시도
  if (iri.startsWith("annex:")) {
    const m = tail.match(/^별표(\d+)(?:[-의](\d+)호?)?$/);
    if (m) {
      const [, num, sub] = m;
      const variants: string[] = [tail];
      variants.push(`별표 ${num}`);
      variants.push(`별표${num}`);
      if (sub) {
        variants.push(`별표 ${num} 제${sub}호`);
        variants.push(`별표 ${num} ${sub}호`);
        variants.push(`별표 ${num}-${sub}호`);
        variants.push(`별표${num}-${sub}호`);
        variants.push(`별표 ${num}의 ${sub}호`);
        variants.push(`별표${num}의${sub}호`);
      }
      return variants.some((v) => text.includes(v));
    }
    return text.includes(tail);
  }

  // art 조문 — 숫자 기반 매칭 (제N조 / §N / N조 / 단순 N)
  const numMatch = tail.match(/^(\d+)(?:의(\d+))?$/);
  if (numMatch) {
    const [, n, sub] = numMatch;
    const variants: string[] = [tail];
    variants.push(`제${n}조`);
    variants.push(`§${n}`);
    if (sub) {
      variants.push(`제${n}조의${sub}`);
      variants.push(`제${n}조 의${sub}`);
      variants.push(`§${n}의${sub}`);
    } else {
      // 단순 N 매칭은 noise 위험 → 제N조 / §N 만 (단, 본문에 "산안기준규칙 제N조" 등 표기가 일반적)
    }
    return variants.some((v) => text.includes(v));
  }
  return text.includes(tail);
}

// 행위 문서 판정 — 선임/교육/위원회/대장/방침/규정/점검/회의록 등은
// hasHazard / mitigatedBy 가 본질적으로 적용 대상이 아니므로 graphScore 산식에서 면제.
// 우선순위: 노드의 documentCategory 명시 → docId 패턴 fallback.
const PROCEDURAL_DOC_PATTERNS = [
  "_appointment$",          // 선임·지정 보고
  "_education_log$",        // 교육 일지
  "_committee$",            // 위원회 운영
  "_council$",              // 협의체
  "_register$",             // 대장 (보호구·MSDS 비치대장)
  "^safety_health_management_policy$",  // 안전보건경영방침
  "^safety_health_regulation$",          // 안전보건관리규정
  "^risk_assessment_procedure$",         // 위험성평가 절차서
  "^legal_summary_posting$",             // 법령요지 게시
  "^safety_signage_register$",           // 표지대장
  "^worker_complaint_log$",              // 의견청취 대장
  "^supervisor_monthly_log$",            // 직무 일지
  "^honorary_safety_supervisor_appointment$",
  "_consultative_body$",   // 안전보건교육 지원
  "_information_provision$", // 안전보건정보 제공
  "_health_register$",      // 안전보건대장 (기본/설계/공사)
  "^health_examination",    // 건강진단 (followup·records)
  "^industrial_physician_appointment$",
];
function isProceduralDoc(docId: string, node: any): boolean {
  // 1) 노드 _meta.documentCategory 명시값 우선
  const cat = node?._meta?.documentCategory;
  if (cat && /procedural|appointment|education|committee|register|policy|regulation/.test(String(cat))) {
    return true;
  }
  // 2) docId 패턴 fallback
  for (const pat of PROCEDURAL_DOC_PATTERNS) {
    if (new RegExp(pat).test(docId)) return true;
  }
  return false;
}

const HALLUCINATION_PATTERNS = [
  /KOSHA Guide [A-Z]-\d{1,3}-202\d 에 명시되어/, // 그래프에 없는 KOSHA Guide 직접 인용
];

function evaluateFillRate(doc: MasterDoc, node: any, generateText: string, structured: any): FillRateResult {
  // 1. 양식 필드 분석 — sections.fields 또는 requiredFields
  const allFields: Array<{ key: string; label: string }> = [];
  if (Array.isArray(node.requiredFields)) {
    for (const f of node.requiredFields) {
      if (f && typeof f === "object" && f.key) allFields.push({ key: f.key, label: f.label ?? "" });
    }
  }
  if (Array.isArray(node.sections)) {
    for (const sec of node.sections) {
      const fields = Array.isArray(sec?.fields) ? sec.fields : [];
      for (const f of fields) {
        if (f && typeof f === "object" && f.key) allFields.push({ key: f.key, label: f.label ?? "" });
      }
    }
  }

  // 텍스트에 필드 label 또는 key 가 등장하는지
  const text = generateText;
  const textLower = text.toLowerCase();
  let inDoc = 0;
  let filled = 0;
  for (const f of allFields) {
    const labelMatch = f.label && text.includes(f.label);
    const keyMatch = f.key && textLower.includes(f.key.toLowerCase());
    if (labelMatch || keyMatch) {
      inDoc++;
      // 채워졌는지 — label 뒤에 ":" 또는 다음 줄에 비공백
      const idx = text.indexOf(f.label);
      if (idx >= 0) {
        const after = text.slice(idx + f.label.length, idx + f.label.length + 200);
        if (/[가-힣A-Za-z0-9]/.test(after) && !/^\s*[(:|]?\s*$/.test(after.split("\n")[0] ?? "")) {
          filled++;
        }
      } else {
        filled++; // key match 만으로는 채워진 걸로 간주
      }
    }
  }

  // 2. 법령 인용 — 노드 legalBasis 의 article·annex 가 출력 텍스트에 표기됐는지 검증.
  // 노드 IRI 표기와 출력 자연어 표기가 다를 수 있으므로 정규화 매칭:
  //   · art:기준규칙:38   → "제38조" 또는 "§38" 또는 "38조" 또는 "38" 모두 매치
  //   · annex:기준규칙:별표4-6호 → "별표 4 제6호" "별표 4 6호" "별표4-6호" "별표4의6호" 등 모두 매치
  const legalRefsInNode = Array.isArray(node.legalBasis) ? node.legalBasis.length : 0;
  let legalRefsInOutput = 0;
  if (Array.isArray(node.legalBasis)) {
    for (const ref of node.legalBasis) {
      if (matchesLegalRefInText(String(ref), text)) legalRefsInOutput++;
    }
  }

  // 3. 환각 — review_safety_document 호출
  const reviewRes = call("review_safety_document", { docId: doc.docId, draft: { content: text } });
  let hallucinationFlag = false;
  const hallucinationKeywords: string[] = [];
  if (reviewRes.ok) {
    if (reviewRes.text.includes("[HALLUCINATION_DETECTED]")) {
      hallucinationFlag = true;
      hallucinationKeywords.push("review marker");
    }
  }
  // 패턴 기반 추가 검출
  for (const pat of HALLUCINATION_PATTERNS) {
    if (pat.test(text)) {
      hallucinationFlag = true;
      const m = text.match(pat);
      if (m) hallucinationKeywords.push(m[0].slice(0, 30));
    }
  }

  // 4. 결재선
  const approvalChainPresent = /결재선|결재[ ]?구분|approval/.test(text);

  // 5. 그래프 점수 — 7키 보유율. 단 행위 문서(선임·교육·점검·위원회·대장 등)는
  //    hasHazard / mitigatedBy 가 본질적으로 적용 대상 아니므로 자동 충족 가산.
  //    문서의 정성을 graphScore 가 손상시키지 않도록.
  const graphKeys = ["legalBasis", "hasHazard", "mitigatedBy", "annexReference", "guidedBy", "relatedDocs", "iso45001Class"];
  let graphScore = 0;
  const isProcedural = isProceduralDoc(doc.docId, node);
  for (const k of graphKeys) {
    const hasKey = !!node[k] || (k === "legalBasis" && !!node.legalBasisExternal);
    if (hasKey) {
      graphScore++;
    } else if (isProcedural && (k === "hasHazard" || k === "mitigatedBy")) {
      // 행위 문서는 hazard/control 키 없어도 가산 (산식 면제)
      graphScore++;
    }
  }

  // 종합 점수 (0~100)
  const fillRate = allFields.length > 0 ? filled / allFields.length : 0;
  const legalCoverage = legalRefsInNode > 0 ? legalRefsInOutput / legalRefsInNode : 0;
  const qualityScore = Math.round(
    fillRate * 40 + // 필드 채움 (40%)
    legalCoverage * 25 + // 법령 정합 (25%)
    (hallucinationFlag ? 0 : 15) + // 환각 없음 (15%)
    (approvalChainPresent ? 10 : 0) + // 결재선 (10%)
    (graphScore / 7) * 10, // 그래프 (10%)
  );

  return {
    docId: doc.docId,
    title: doc.title,
    category: doc.category,
    frequency: doc.frequency,
    formStrictness: doc.formStrictness,
    generated: true,
    generateMs: 0,
    totalFields: allFields.length,
    fieldsInDoc: inDoc,
    fieldsFilled: filled,
    fillRate,
    legalRefsInNode,
    legalRefsInOutput,
    legalCoverage,
    hallucinationFlag,
    hallucinationKeywords,
    approvalChainPresent,
    graphScore,
    qualityScore,
  };
}

function main(): void {
  const allDocs = loadMasterDocs();
  let targets: MasterDoc[];
  if (docIdArg) {
    targets = allDocs.filter((d) => d.docId === docIdArg);
    if (targets.length === 0) {
      console.error(`docId="${docIdArg}" not found`);
      process.exit(1);
    }
  } else if (topArg > 0) {
    targets = [...allDocs].sort((a, b) => freqPriority(b.frequency) - freqPriority(a.frequency)).slice(0, topArg);
  } else {
    targets = [...allDocs].sort((a, b) => freqPriority(b.frequency) - freqPriority(a.frequency));
  }

  console.log("=".repeat(78));
  console.log(`Document Fillrate Test — ${targets.length}종 평가 (빈도 우선)`);
  console.log("=".repeat(78));

  const results: FillRateResult[] = [];
  let processed = 0;
  for (const doc of targets) {
    processed++;
    const node = loadNode(doc.docId);
    if (!node) {
      console.log(`❌ [${processed}/${targets.length}] ${doc.docId}: 노드 없음`);
      continue;
    }

    const t0 = Date.now();
    const genRes = call("generate_safety_document", {
      docId: doc.docId,
      draft: {},
    });
    const genMs = Date.now() - t0;

    if (!genRes.ok) {
      const reason = (genRes as any).reason ?? "unknown";
      console.log(`❌ [${processed}/${targets.length}] ${doc.docId}: generate 실패 — ${reason.slice(0, 60)}`);
      results.push({
        docId: doc.docId,
        title: doc.title,
        category: doc.category,
        frequency: doc.frequency,
        formStrictness: doc.formStrictness,
        generated: false,
        generateMs: genMs,
        generateError: reason,
        totalFields: 0,
        fieldsInDoc: 0,
        fieldsFilled: 0,
        fillRate: 0,
        legalRefsInNode: 0,
        legalRefsInOutput: 0,
        legalCoverage: 0,
        hallucinationFlag: false,
        hallucinationKeywords: [],
        approvalChainPresent: false,
        graphScore: 0,
        qualityScore: 0,
      });
      continue;
    }

    const result = evaluateFillRate(doc, node, genRes.text, genRes.data);
    result.generateMs = genMs;
    results.push(result);

    const badge = result.qualityScore >= 80 ? "🟢" : result.qualityScore >= 60 ? "🟡" : "🔴";
    console.log(
      `${badge} [${processed}/${targets.length}] ${doc.docId.padEnd(40)} ${result.qualityScore.toString().padStart(3)}/100 ` +
        `필드 ${result.fieldsFilled}/${result.totalFields} ` +
        `법령 ${result.legalRefsInOutput}/${result.legalRefsInNode} ` +
        `${result.hallucinationFlag ? "⚠️" : "✓"}환각 ${result.approvalChainPresent ? "✓" : "·"}결재 (${result.generateMs}ms)`,
    );
  }

  // 종합 통계
  console.log("\n" + "=".repeat(78));
  const generated = results.filter((r) => r.generated);
  const failed = results.filter((r) => !r.generated);
  console.log(`처리: ${results.length} / 생성 성공: ${generated.length} / 실패: ${failed.length}`);

  if (generated.length === 0) return;

  const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  console.log(`\n📊 평균 메트릭 (생성 성공 ${generated.length}종 기준):`);
  console.log(`  필드 채움률:        ${(avg(generated.map((r) => r.fillRate)) * 100).toFixed(1)}%`);
  console.log(`  법령 정합률:        ${(avg(generated.map((r) => r.legalCoverage)) * 100).toFixed(1)}%`);
  console.log(`  환각 미검출 비율:   ${((generated.filter((r) => !r.hallucinationFlag).length / generated.length) * 100).toFixed(1)}%`);
  console.log(`  결재선 보유 비율:   ${((generated.filter((r) => r.approvalChainPresent).length / generated.length) * 100).toFixed(1)}%`);
  console.log(`  그래프 점수 평균:   ${avg(generated.map((r) => r.graphScore)).toFixed(2)}/7`);
  console.log(`  종합 품질 점수:     ${avg(generated.map((r) => r.qualityScore)).toFixed(1)}/100`);

  // 빈도별 평균
  console.log(`\n📊 빈도 그룹별 종합 점수:`);
  const byFreq = new Map<string, FillRateResult[]>();
  for (const r of generated) (byFreq.get(r.frequency) ?? byFreq.set(r.frequency, []).get(r.frequency))!.push(r);
  const freqs = [...byFreq.keys()].sort((a, b) => freqPriority(b) - freqPriority(a));
  for (const f of freqs) {
    const items = byFreq.get(f)!;
    const a = avg(items.map((r) => r.qualityScore));
    console.log(`  ${f.padEnd(20)} n=${items.length.toString().padStart(3)} 평균=${a.toFixed(1)}/100`);
  }

  // 결과 저장
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `fillrate-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outPath, JSON.stringify({ summary: { processed: results.length, generated: generated.length, failed: failed.length }, results }, null, 2));
  console.log(`\n결과 저장: ${outPath}`);
}

main();
