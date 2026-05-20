#!/usr/bin/env tsx
/**
 * generate-form-templates.ts (2026-04-29)
 *
 * 모든 docId 노드의 sections.fields 를 기반으로 표준 작성 양식 (.md) 자동 생성.
 *
 * 정책:
 *  - 외부 공식 hwp/pdf 가 이미 forms-map.json 에 있으면 우선 사용 (skip)
 *  - 그 외 모든 노드는 sections.fields → 채우기형 마크다운 양식 생성
 *  - 결과물: src/ontology/forms/auto/{docId}.md
 *  - forms-map.json 에 자동 entry 추가
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJ = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(PROJ, "src/ontology/graph/nodes/documents");
const FORMS_DIR = resolve(PROJ, "src/ontology/forms");
const AUTO_DIR = resolve(FORMS_DIR, "auto");
mkdirSync(AUTO_DIR, { recursive: true });

// 기존 forms-map.json 로드
const formsMapPath = resolve(FORMS_DIR, "forms-map.json");
const formsMap = JSON.parse(readFileSync(formsMapPath, "utf8")) as {
  _meta: any;
  forms: Array<{ formId: string; docId: string; [k: string]: any }>;
};
const existingDocIds = new Set(formsMap.forms.map((f) => f.docId));

interface DocNode {
  docId: string;
  title: string;
  description?: string;
  cycle?: string;
  applicableWhen?: any;
  legalBasis?: string[];
  retention?: string;
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
  standardForm?: { source?: string; sourceUrl?: string };
  _meta?: any;
}

function generateMarkdown(doc: DocNode): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}`);
  lines.push("");
  lines.push(`> **법적 근거**: ${(doc.legalBasis ?? []).join(" · ") || "—"}`);
  if (doc.description) {
    lines.push(`> ${doc.description.split("\n")[0]}`);
  }
  if (doc.standardForm?.source) {
    lines.push(`> **양식 출처**: ${doc.standardForm.source}`);
  }
  if (doc.standardForm?.sourceUrl) {
    lines.push(`> **다운로드**: ${doc.standardForm.sourceUrl}`);
  }
  if (doc.retention) {
    lines.push(`> **보존**: ${doc.retention}`);
  }
  lines.push("");
  lines.push(`> 본 양식은 agent-safety-oss 자동 생성 (sections.fields 기반).`);
  lines.push(`> 외부 공식 HWP/PDF 양식이 있는 경우 \`get_official_form\` 도구로 받기 권장.`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 메타·결재선 표준 헤더
  lines.push("## 문서 메타");
  lines.push("");
  lines.push("| 항목 | 내용 |");
  lines.push("|---|---|");
  lines.push("| 문서번호 | DOC-YYYYMMDD-NNN |");
  lines.push("| 사업장명 | |");
  lines.push("| 작성일 | YYYY-MM-DD |");
  lines.push("| 작성자 | |");
  lines.push("");
  lines.push("## 결재선");
  lines.push("");
  lines.push("| 역할 | 성명 | 서명 | 일자 |");
  lines.push("|---|---|---|---|");
  lines.push("| 사업주 | | (서명/인) | |");
  lines.push("| 관리감독자 | | (서명/인) | |");
  lines.push("| 근로자대표 | | (서명/인) | |");
  lines.push("");

  // sections 본문
  for (const sec of doc.sections ?? []) {
    const titleHasNum = /^\s*(\d+\.|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|\([0-9]+\)|[①-⑳])/.test(sec.title);
    const heading = titleHasNum ? sec.title : sec.title;
    lines.push(`## ${heading}${sec.legalSource ? ` (${sec.legalSource})` : ""}`);
    lines.push("");
    if (sec.fields && sec.fields.length > 0) {
      lines.push("| 항목 | 내용 |");
      lines.push("|---|---|");
      for (const f of sec.fields) {
        const required = f.required === false ? "" : " *(필수)*";
        lines.push(`| ${f.label}${required} | |`);
      }
      lines.push("");
      // 작성 가이드 (inputGuide·examples 가 있는 경우)
      const fieldsWithGuide = sec.fields.filter((f) => f.inputGuide || (f.examples && f.examples.length > 0));
      if (fieldsWithGuide.length > 0) {
        lines.push("> **📝 작성 가이드**:");
        lines.push(">");
        for (const f of fieldsWithGuide) {
          lines.push(`> **[${f.label}]**`);
          if (f.inputGuide) lines.push(`> - ${f.inputGuide}`);
          if (f.standardFormat) lines.push(`> - 형식: \`${f.standardFormat}\``);
          if (f.examples && f.examples.length > 0) {
            lines.push(`> - 예시:`);
            for (const ex of f.examples) lines.push(`>   - ${ex}`);
          }
          if (f.checkPoints && f.checkPoints.length > 0) {
            lines.push(`> - 체크포인트: ${f.checkPoints.join(" / ")}`);
          }
          lines.push(">");
        }
        lines.push("");
      }
    }
  }

  if (doc.retention) {
    lines.push("---");
    lines.push("");
    lines.push(`*보존: ${doc.retention}*`);
    lines.push("");
  }

  return lines.join("\n");
}

const newEntries: any[] = [];
let generated = 0;
let skipped = 0;

for (const file of readdirSync(DOCS_DIR)) {
  if (!file.endsWith(".jsonld") || file.startsWith("kosha")) continue;
  const doc = JSON.parse(readFileSync(resolve(DOCS_DIR, file), "utf8")) as DocNode;
  if (!doc.docId) continue;

  // 이미 외부 양식 있는 docId 는 skip 하지 않고 보조 .md 도 생성 (다중 매칭)
  const mdPath = resolve(AUTO_DIR, `${doc.docId}.md`);
  const md = generateMarkdown(doc);
  writeFileSync(mdPath, md, "utf8");
  generated += 1;

  // forms-map 에 등록 (이미 동일 formId 있으면 skip)
  const formId = `auto_${doc.docId}`;
  if (formsMap.forms.some((f) => f.formId === formId)) {
    skipped += 1;
    continue;
  }
  newEntries.push({
    formId,
    docId: doc.docId,
    title: `${doc.title} — 자동 생성 양식 (.md)`,
    officialName: `agent-safety-oss 자동 생성 — ${(doc.legalBasis ?? []).join(" · ") || "본문 기반"}`,
    filename: `auto/${doc.docId}.md`,
    format: "md",
    size_bytes: Buffer.byteLength(md, "utf8"),
    source: "agent-safety-oss (sections.fields 자동 변환)",
    sourceUrl: doc.standardForm?.sourceUrl ?? "",
    originalDownloadUrl: "",
    license: "MIT (code) / 공공누리 (data 출처는 각 노드 legalBasis 참조)",
    autoGenerated: true,
  });
}

formsMap.forms.push(...newEntries);
formsMap._meta.compiled = "2026-04-29";
formsMap._meta.autoGenerated = `${newEntries.length} 자동 생성 양식 추가 (sections.fields 기반)`;
writeFileSync(formsMapPath, JSON.stringify(formsMap, null, 2) + "\n", "utf8");

console.log(`[generate-form-templates] 자동 양식 생성 완료`);
console.log(`  - 생성: ${generated} 노드 → auto/{docId}.md`);
console.log(`  - 새 entry: ${newEntries.length} (forms-map.json 추가)`);
console.log(`  - skip: ${skipped} (이미 등록된 formId)`);
console.log(`  - forms-map.json 총: ${formsMap.forms.length} 양식`);
