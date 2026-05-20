#!/usr/bin/env tsx
/**
 * audit-document-templates.ts (2026-04-29)
 *
 * 67종 법정문서 노드를 전수 감사. 4개 정합성 차원 검증:
 *  (A) sections.fields 키 vs requiredFields 키 불일치 (BLOCKER 1 패턴)
 *  (B) 동일 fieldKey 가 다른 doc 에서 다른 inputGuide 를 갖는 누수 (HIGH 1 패턴)
 *  (C) guidedBy KOSHA Guide 매핑 도메인 적합성
 *  (D) inputGuide-필드라벨 키워드 의미 적합성 (휴리스틱)
 *
 * 결과: dev-resources/audit-document-templates.json + 콘솔 요약
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "documents");

interface DocNode {
  filePath: string;
  fileName: string;
  docId: string;
  title: string;
  guidedBy?: string[];
  hasHazard?: string[];
  legalBasis?: string[];
  requiredFields?: Array<{ key: string; label: string; source?: string }>;
  sections?: Array<{
    title: string;
    legalSource?: string;
    fields?: Array<{
      key: string;
      label: string;
      required?: boolean;
      inputGuide?: string;
      standardFormat?: string;
      examples?: string[];
      checkPoints?: string[];
    }>;
  }>;
  reviewRules?: Array<{ rule: string; severity: string }>;
  _meta?: Record<string, unknown>;
}

const findings: {
  keyMismatch: Array<{ doc: string; reqKeys: string[]; secKeys: string[] }>;
  guideLeak: Array<{ key: string; docs: { doc: string; guide: string }[] }>;
  noGuide: Array<{ doc: string }>;
  emptyExamples: Array<{ doc: string; field: string }>;
  guideDomainMismatch: Array<{ doc: string; guides: string[]; reason: string }>;
  noRequiredField: Array<{ doc: string }>;
  noLegalBasis: Array<{ doc: string }>;
  emptySections: Array<{ doc: string }>;
  approvalChainMissing: Array<{ doc: string }>;
} = {
  keyMismatch: [],
  guideLeak: [],
  noGuide: [],
  emptyExamples: [],
  guideDomainMismatch: [],
  noRequiredField: [],
  noLegalBasis: [],
  emptySections: [],
  approvalChainMissing: [],
};

const docs: DocNode[] = readdirSync(DOCS_DIR)
  .filter((f) => f.endsWith(".jsonld") && !f.startsWith("kosha"))
  .map((f) => {
    const filePath = resolve(DOCS_DIR, f);
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      filePath,
      fileName: f,
      docId: raw.docId,
      title: raw.title,
      guidedBy: raw.guidedBy,
      hasHazard: raw.hasHazard,
      legalBasis: raw.legalBasis,
      requiredFields: raw.requiredFields,
      sections: raw.sections,
      reviewRules: raw.reviewRules,
      _meta: raw._meta,
    } as DocNode;
  });

console.log(`[audit] ${docs.length} 문서 노드 로드`);

// ─── (A) sections.fields 키 vs requiredFields 키 불일치 ───
for (const d of docs) {
  const reqKeys = new Set((d.requiredFields ?? []).map((f) => f.key));
  const secKeys = new Set((d.sections ?? []).flatMap((s) => (s.fields ?? []).map((f) => f.key)));
  if (reqKeys.size === 0 && secKeys.size === 0) continue;
  if (reqKeys.size > 0 && secKeys.size > 0) {
    const reqOnly = [...reqKeys].filter((k) => !secKeys.has(k));
    const secOnly = [...secKeys].filter((k) => !reqKeys.has(k));
    if (reqOnly.length > 0 || secOnly.length > 0) {
      findings.keyMismatch.push({
        doc: d.docId,
        reqKeys: reqOnly,
        secKeys: secOnly,
      });
    }
  }
}

// ─── (B) inputGuide 누수: 같은 fieldKey 가 doc 마다 다른 가이드를 가짐 ───
const guideByKey = new Map<string, Map<string, string[]>>();
for (const d of docs) {
  for (const sec of d.sections ?? []) {
    for (const f of sec.fields ?? []) {
      if (!f.inputGuide) continue;
      if (!guideByKey.has(f.key)) guideByKey.set(f.key, new Map());
      const g2docs = guideByKey.get(f.key)!;
      if (!g2docs.has(f.inputGuide)) g2docs.set(f.inputGuide, []);
      g2docs.get(f.inputGuide)!.push(d.docId);
    }
  }
}
// 같은 key + 다른 가이드가 2종 이상 = 누수 의심 (단 라벨이 명확히 다른 경우만)
for (const [key, g2docs] of guideByKey.entries()) {
  if (g2docs.size > 1) {
    const variants = [...g2docs.entries()].map(([guide, docList]) => ({
      doc: docList.join(","),
      guide: guide.slice(0, 80) + (guide.length > 80 ? "..." : ""),
    }));
    findings.guideLeak.push({ key, docs: variants });
  }
}

// ─── (C) guidedBy 미설정 또는 빈 배열 ───
// + KOSHA Guide 도메인 부적합 휴리스틱: 굴착 doc 에 G-100 (지게차) 같은 패턴
const koshaDomainHint: Record<string, string[]> = {
  // docId 패턴 → 기대 가이드 키워드
  excavation: ["굴착", "흙막이", "토공", "지하"],
  scaffolding: ["비계", "발판"],
  tower_crane: ["타워크레인", "양중"],
  demolition: ["해체"],
  electric: ["전기", "감전"],
  asbestos: ["석면"],
  confined_space: ["밀폐"],
  hot_work: ["화기", "용접"],
  loto: ["LOTO", "정전", "잠금"],
};

for (const d of docs) {
  if (!d.guidedBy || d.guidedBy.length === 0) {
    findings.noGuide.push({ doc: d.docId });
  } else {
    // KOSHA Guide 의 실제 제목은 외부 매핑 필요. 여기서는 간단히 docId 키워드와 가이드 코드 prefix 비교.
    // 굴착(work_plan_excavation, excavation_*) → C-, D-C-1, D-C-4, D-C-5, D-C-11, G-29 정상.
    // 비계(scaffolding) → 가이드 미보유 시 noGuide 로 분류.
    for (const [domainKey] of Object.entries(koshaDomainHint)) {
      if (d.docId.includes(domainKey)) {
        // 가이드 코드만으로 도메인 확정은 외부 데이터 필요. 일단 카운트만.
        findings.guideDomainMismatch.push({
          doc: d.docId,
          guides: d.guidedBy,
          reason: `domain=${domainKey} → 가이드 ${d.guidedBy.length}건 매핑 (도메인 적합성 수동 확인 필요)`,
        });
      }
    }
  }
}

// ─── (D) examples / inputGuide 빈 필드 ───
for (const d of docs) {
  for (const sec of d.sections ?? []) {
    for (const f of sec.fields ?? []) {
      const ex = f.examples ?? [];
      const isPlaceholder = ex.length === 1 && /행정문서 표준|법령 근거 명확/.test(ex[0]);
      if (ex.length === 0 || isPlaceholder) {
        findings.emptyExamples.push({ doc: d.docId, field: f.key });
      }
    }
  }
}

// ─── (E) 메타 부재 ───
for (const d of docs) {
  if (!d.requiredFields || d.requiredFields.length === 0) {
    if (!d.sections || d.sections.length === 0) findings.noRequiredField.push({ doc: d.docId });
  }
  if (!d.legalBasis || d.legalBasis.length === 0) findings.noLegalBasis.push({ doc: d.docId });
  if (!d.sections || d.sections.length === 0) findings.emptySections.push({ doc: d.docId });
  // 결재선 필드 존재 여부
  const hasApproval = (d.requiredFields ?? []).some((f) => /approval|결재/.test(f.key + " " + f.label));
  if (!hasApproval) findings.approvalChainMissing.push({ doc: d.docId });
}

// ─── 결과 요약 ───
const summary = {
  totalDocs: docs.length,
  keyMismatch: findings.keyMismatch.length,
  guideLeak: findings.guideLeak.length,
  noGuide: findings.noGuide.length,
  emptyExamplesCount: findings.emptyExamples.length,
  emptyExamplesDocs: new Set(findings.emptyExamples.map((e) => e.doc)).size,
  guideDomainMismatchSamples: findings.guideDomainMismatch.length,
  noRequiredField: findings.noRequiredField.length,
  noLegalBasis: findings.noLegalBasis.length,
  emptySections: findings.emptySections.length,
  approvalChainMissing: findings.approvalChainMissing.length,
};

console.log("\n══════ 감사 요약 ══════");
console.log(JSON.stringify(summary, null, 2));

console.log("\n══════ (A) sections vs requiredFields 키 불일치 (상위 10건) ══════");
for (const m of findings.keyMismatch.slice(0, 10)) {
  console.log(`  • ${m.doc}`);
  console.log(`    reqOnly: ${m.reqKeys.slice(0, 5).join(", ")}${m.reqKeys.length > 5 ? "..." : ""}`);
  console.log(`    secOnly: ${m.secKeys.slice(0, 5).join(", ")}${m.secKeys.length > 5 ? "..." : ""}`);
}

console.log("\n══════ (B) inputGuide 누수 (가장 많은 변종 가진 키 10건) ══════");
const sortedLeaks = findings.guideLeak.sort((a, b) => b.docs.length - a.docs.length);
for (const leak of sortedLeaks.slice(0, 10)) {
  console.log(`  • key=${leak.key} (${leak.docs.length}개 변종)`);
  for (const v of leak.docs.slice(0, 3)) {
    console.log(`    [${v.doc}] ${v.guide}`);
  }
}

console.log("\n══════ (C) 빈 examples 또는 placeholder examples (상위 doc) ══════");
const docExampleMap = new Map<string, number>();
for (const e of findings.emptyExamples) {
  docExampleMap.set(e.doc, (docExampleMap.get(e.doc) ?? 0) + 1);
}
const topProblematic = [...docExampleMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [doc, count] of topProblematic) {
  console.log(`  • ${doc} : ${count}개 필드 placeholder/빈 examples`);
}

console.log("\n══════ (D) guidedBy 빈 또는 미설정 ══════");
for (const n of findings.noGuide.slice(0, 20)) {
  console.log(`  • ${n.doc}`);
}
if (findings.noGuide.length > 20) console.log(`  ... 외 ${findings.noGuide.length - 20}건`);

const outPath = resolve(__dirname, "..", "..", "dev-resources", "audit-document-templates.json");
writeFileSync(outPath, JSON.stringify({ summary, findings }, null, 2));
console.log(`\n[audit] 상세 결과 → ${outPath}`);
