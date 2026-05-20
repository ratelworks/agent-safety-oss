#!/usr/bin/env tsx
/**
 * sync-forms-map.ts
 *
 * 마스터 리스트 88종 vs forms-map.json 매핑 동기화.
 * 매핑 없는 docId는 자동생성 .md 양식 생성 + forms-map 등록.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

interface MasterDoc { docId: string; title: string; legalRef: string[]; formStrictness: string; formSource: string; }

async function main() {
  const masterTxt = await readFile(resolve(ROOT, "src/ontology/legal-duty-master.json"), "utf8");
  const master = JSON.parse(masterTxt);
  const formsMapPath = resolve(ROOT, "src/ontology/forms/forms-map.json");
  const forms = JSON.parse(await readFile(formsMapPath, "utf8"));
  const mappedDocIds = new Set<string>(forms.forms.map((f: any) => f.docId).filter(Boolean));

  // 자동 생성된 .md 양식 파일 목록
  const autoDir = resolve(ROOT, "src/ontology/forms/auto");
  const autoFiles = await readdir(autoDir);

  let added = 0;
  let mdGenerated = 0;
  for (const m of master.documents as MasterDoc[]) {
    if (mappedDocIds.has(m.docId)) continue;
    // 자동 생성 .md 파일 존재?
    const mdName = `${m.docId}.md`;
    let hasFile = autoFiles.includes(mdName);
    if (!hasFile) {
      // .md 자동 생성
      const mdContent = `# ${m.title}\n\n> **법적 근거**: ${m.legalRef.join(" + ")}\n> **양식 출처**: ${m.formSource}\n> **양식 강제도**: ${m.formStrictness}\n\n> 본 양식은 agent-safety-oss 자동 생성 (마스터 리스트 기반).\n> 실제 공식 양식이 있는 경우 후속 다운로드 + kordoc parse 후 정합 권장.\n\n---\n\n## 문서 메타\n\n| 항목 | 내용 |\n|---|---|\n| 문서번호 | DOC-YYMMDD-NN |\n| 사업장명 | |\n| 작성일자 | YYYY-MM-DD |\n| 작성자 | |\n\n## 본문 (양식 정합 후속 필요)\n\n_sections.fields 양식 정합 후속 작업 필요_\n\n## 결재선\n\n| 역할 | 성명 | 서명 | 일자 |\n|---|---|---|---|\n| 작성자 (안전관리자) | | | |\n| 관리감독자 | | | |\n| 사업주 / 안전보건관리책임자 | | | |\n`;
      await writeFile(resolve(autoDir, mdName), mdContent, "utf8");
      mdGenerated++;
    }
    forms.forms.push({
      formId: `auto_${m.docId}`,
      docId: m.docId,
      title: m.title,
      officialName: `${m.title} (${m.formSource})`,
      filename: `auto/${mdName}`,
      format: "md",
      size_bytes: 0,
      source: "agent-safety-oss (마스터 리스트 자동 생성)",
      sourceUrl: "",
      originalDownloadUrl: "",
      license: "공공누리 + 황룡건설(주) + ㈜라텔웍스",
    });
    added++;
    console.log(`  + ${m.docId} → auto/${mdName}`);
  }

  forms._meta.compiled = "2026-04-29";
  forms._meta.coverage = {
    masterTotal: master.documents.length,
    mapped: forms.forms.length,
  };
  await writeFile(formsMapPath, JSON.stringify(forms, null, 2), "utf8");
  console.log(`\nforms-map 갱신: ${added}종 매핑 추가 (.md 신규 생성 ${mdGenerated}종)`);
  console.log(`총 ${forms.forms.length}종 매핑`);
}

main().catch((e) => { console.error(e); process.exit(1); });
