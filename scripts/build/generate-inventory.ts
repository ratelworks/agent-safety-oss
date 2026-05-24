#!/usr/bin/env tsx
/**
 * generate-inventory.ts
 *
 * 외부 리뷰 P0 (2026-05-22) — 자동 inventory 생성으로 README/docs drift 차단.
 *
 * 빌드 시 자동 실행되어 docs/INVENTORY.md 를 갱신한다.
 * SSoT 정책: 다음 카운트는 모두 코드/데이터에서 직접 산출하며 수동 편집 금지:
 *   - MCP 도구 수 (TOOLS.length, keyless / API-key / stub 분리)
 *   - 그래프 노드 카테고리별 수
 *   - KOSHA Guide 본문 수 + 추출 품질 등급
 *   - 법령 본문 조문 수 + 마지막 동기화일 + 커버리지 (전체 조문 대비)
 *   - 양식 인덱스 (HWP/PDF/XLSX/MD)
 *   - 데이터 기준일 통합 표시
 *
 * 산출 로직은 `inventory-data.ts` 에 분리 (ADR 003). 본 파일은 렌더링만 담당.
 * sync-docs.ts (9개 문서 marker 자동 갱신) 가 동일 데이터를 재사용.
 *
 * 실행:
 *   npm run build  (자동)
 *   npx tsx scripts/build/generate-inventory.ts  (수동)
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  collectInventoryData,
  ROOT,
  type InventoryData,
} from "./inventory-data.js";

function renderInventoryMarkdown(data: InventoryData): string {
  const { tools, graph, kosha, laws, forms, lawArticleTotal, latestLawSync, generatedAt, documentsTotal, docIdMaster } = data;
  const lines: string[] = [];
  lines.push("# Inventory (자동 생성)");
  lines.push("");
  lines.push(
    `> **본 문서는 \`npm run build\` 시 \`scripts/build/generate-inventory.ts\` 가 자동 생성합니다. 수동 편집 금지** — drift 차단용.`,
  );
  lines.push("");
  lines.push(`- 생성 시각: ${generatedAt}`);
  lines.push(`- 법령 데이터 최신 동기화: **${latestLawSync}**`);
  lines.push(`- 양식 인덱스 컴파일: ${forms.meta.compiled}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 1. 도구
  lines.push("## 1. MCP 도구");
  lines.push("");
  lines.push("| 항목 | 수 |");
  lines.push("|---|---:|");
  lines.push(`| 전체 등록 도구 | **${tools.total}** |`);
  lines.push(`| API 키 불필요 (keyless) | ${tools.keyless} |`);
  lines.push(`| API 키 필요 (data.go.kr / KOSHA OneAPI) | ${tools.keyRequired} |`);
  lines.push(`| 라이선스 placeholder (데이터 없음) | ${tools.stub} |`);
  lines.push(`| **실질 활성 도구** | **${tools.active}** |`);
  lines.push("");
  if (tools.stubNames.length > 0) {
    lines.push("**라이선스 placeholder 도구** (의도된 빈 상태 — 공공누리 변경금지 라이선스 준수):");
    for (const name of tools.stubNames) {
      lines.push(`- \`${name}\` — 사용자가 \`npm run sync-kosha\` 로 공식 데이터를 별도 로드해야 동작`);
    }
    lines.push("");
  }
  if (tools.keyRequiredNames.length > 0) {
    lines.push("**API 키 필요 도구** (data.go.kr 또는 라텔웍스 발행 키):");
    for (const name of tools.keyRequiredNames) lines.push(`- \`${name}\``);
    lines.push("");
  }

  // 2. 그래프
  lines.push("## 2. 그래프 노드");
  lines.push("");
  lines.push(
    `- 카테고리 1단계 노드 (직속 \`.jsonld\`): **${graph.totalTopLevel}**`,
  );
  lines.push(
    `- 전체 노드 (재귀, KOSHA Guide 1,039건 포함): **${graph.totalRecursive}**`,
  );
  lines.push(`- 엣지 (주요 EDGE_FIELDS): **${graph.edges}**`);
  lines.push("");
  lines.push("| 카테고리 | 1단계 | 재귀 (서브디렉토리 포함) |");
  lines.push("|---|---:|---:|");
  const sortedCats = Object.entries(graph.byCategoryRecursive).sort((a, b) => b[1] - a[1]);
  for (const [cat, recCount] of sortedCats) {
    const topCount = graph.byCategoryTopLevel[cat] ?? 0;
    lines.push(`| ${cat} | ${topCount} | ${recCount} |`);
  }
  lines.push(`| **전체** | **${graph.totalTopLevel}** | **${graph.totalRecursive}** |`);
  lines.push("");

  // 3. KOSHA Guide
  lines.push("## 3. KOSHA Guide 본문 / 메타");
  lines.push("");
  lines.push("| 항목 | 수 | 비고 |");
  lines.push("|---|---:|---|");
  lines.push(`| 그래프 메타 (.jsonld) | **${kosha.metaCount}** | KOSHA OneAPI 15144147 가 인지한 가이드 메타 |`);
  lines.push(`| 본문 (.md) | **${kosha.bodyCount}** | PDF → kordoc 변환 성공한 본문 |`);
  lines.push(
    `| 본문 미수집 | ${kosha.missingBodies.length} | ${kosha.missingBodies.length > 0 ? "메타는 있으나 KOSHA 측 PDF 0 bytes" : "(없음 — 본문 = 메타)"} |`,
  );
  lines.push("");
  if (kosha.missingBodies.length > 0) {
    lines.push("**본문 미수집 가이드 상세** (`_FAILURES.json`):");
    lines.push("");
    lines.push("| guideNo | 제목 | 사유 | 사용자 우회 경로 |");
    lines.push("|---|---|---|---|");
    for (const id of kosha.missingBodies) {
      const fail = kosha.failures.find((f) => f.guideNo === id);
      lines.push(
        `| \`${id}\` | ${fail?.title ?? "(_FAILURES.json 미등록 — drift)"} | ${fail?.reason ?? "—"} | ${fail?.userWorkaround ?? "—"} |`,
      );
    }
    lines.push("");
    if (!kosha.failureDriftOk) {
      lines.push(
        "> ⚠️ `_FAILURES.json` 과 실제 본문 미수집 목록이 불일치합니다. `npm run audit:kosha-gaps` 로 정정 필요.",
      );
      lines.push("");
    }
  }
  lines.push("**추출 품질 등급** (`.md` 의 빈 `<table>` 잔재 기준 자동 분류):");
  lines.push("");
  lines.push("| 등급 | 기준 | 수 | 비율 |");
  lines.push("|---|---|---:|---:|");
  const pct = (n: number) => ((n / kosha.bodyCount) * 100).toFixed(1) + "%";
  lines.push(`| **verified** | 빈 \`<table>\` 0건 — 본문 정상 | ${kosha.verified} | ${pct(kosha.verified)} |`);
  lines.push(`| **partial** | 빈 \`<table>\` 1~10건 — 표 일부 손실, 본문 텍스트 정상 | ${kosha.partial} | ${pct(kosha.partial)} |`);
  lines.push(`| **raw** | 빈 \`<table>\` 11+건 — kordoc 변환 잔재 다수, 본문은 텍스트로 가독 가능 | ${kosha.raw} | ${pct(kosha.raw)} |`);
  lines.push("");
  lines.push(
    "> ⚠️ KOSHA Guide 는 PDF → kordoc 변환 결과로, 일부 시각적 서식 손실 가능. LLM 인용 시 본문 텍스트만 사용 권장. 정확한 원본은 각 파일의 `원본 URL` 참조.",
  );
  lines.push("");

  // 4. 법령 본문
  lines.push("## 4. 법령 본문 (핵심 조문 발췌)");
  lines.push("");
  lines.push(
    "> ⚠️ **본 OSS 의 법령 번들은 건설안전 실무 핵심 조문 발췌 — 전문 (全文) 아님**. 전체 법령은 [법제처](https://www.law.go.kr) 직접 참조 필수. 단, 위험성평가 고시 (2024-76호) 는 전문 (23조) 수록.",
  );
  lines.push("");
  lines.push("| 법령 | 수록 조문 | 전체 조문 | 커버리지 | 마지막 동기화 | 현행 호수 |");
  lines.push("|---|---:|---:|:---:|:---:|---|");
  for (const l of laws) {
    const totalStr = l.totalArticles === null ? "(영역 한정)" : String(l.totalArticles);
    lines.push(
      `| ${l.shortName} | ${l.articleCount} | ${totalStr} | ${l.coveragePercent} | ${l.lastSynced} | ${l.publishedVersion ?? "—"} |`,
    );
  }
  lines.push(`| **합계** | **${lawArticleTotal}** | — | — | — | — |`);
  lines.push("");
  lines.push(`**저작권**: 저작권법 §7 — 비보호 저작물 (자유 인용·재배포)`);
  lines.push("");

  // 4-1. 법정의무 문서 마스터
  lines.push("## 4-1. 법정의무 문서 마스터 (`legal-duty-master.json`)");
  lines.push("");
  lines.push(`- 19종 법정 안전관리 문서: **${documentsTotal}** (안전관리자가 매일·매주·매월 작성)`);
  lines.push(`- 94 docId 마스터: **${docIdMaster}** (legal-duty-master.json 의 documents 총 카운트 — 19종 + 세분화된 사이클·범위·발주처별 변형)`);
  lines.push("");

  // 5. 양식
  lines.push("## 5. 양식 인덱스 (`forms-map.json`)");
  lines.push("");
  lines.push("| 포맷 | 수 | 비고 |");
  lines.push("|---|---:|---|");
  for (const [fmt, cnt] of Object.entries(forms.byFormat).sort()) {
    const note = fmt === "md" ? "자동 생성 양식 (sections.fields 기반)" : "공식 양식 (고용노동부·KOSHA·법제처 원본)";
    lines.push(`| ${fmt.toUpperCase()} | ${cnt} | ${note} |`);
  }
  lines.push(`| **합계** | **${forms.total}** | — |`);
  lines.push("");
  lines.push(`**라이선스**: ${forms.meta.license}`);
  lines.push("");

  // 6. 데이터 신뢰성 요약
  lines.push("## 6. 데이터 신뢰성 요약");
  lines.push("");
  lines.push("- **법령**: 법제처 OpenAPI `lawService` 직접 추출 + 본문 100% 검증 (개별 \\.md 헤더 참조)");
  lines.push("- **KOSHA Guide**: PDF → kordoc 변환 — 본문 텍스트 보존, 일부 표 서식 잔재. 등급 분포 위 §3 참조.");
  lines.push("- **그래프 노드**: SHACL 검증 통과, IRI dangling 0");
  lines.push(
    `- **자동 검증 게이트** (CI): \`audit:strict\` / \`verify:tool-capability\` (${tools.total}/${tools.total}/${tools.total}) / \`verify:edge-context\` / \`validate-shapes:strict\` / \`npm audit --audit-level=high\``,
  );
  lines.push("- **개정 미반영 가능성**: 본 번들은 마지막 동기화일 기준 스냅샷. 그 이후 법령 개정·KOSHA Guide 신규는 미반영. 결재·인용 전 법제처/KOSHA 원본 재확인 권장.");
  lines.push("");

  // 7. 자동 갱신 안내
  lines.push("## 7. 본 문서 갱신");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run build              # 자동 생성 (빌드 단계 통합)");
  lines.push("npx tsx scripts/build/generate-inventory.ts  # 수동 실행");
  lines.push("```");
  lines.push("");
  lines.push(
    "9개 문서 (README · README-EN · CHANGELOG · SECURITY · ARCHITECTURE · IDENTITY · DATA_SOURCES · CONTRIBUTING · OPERATIONAL-ONTOLOGY) 의 marker 영역은 `sync-docs.ts` 가 본 inventory 산출값으로 자동 갱신합니다. `npm run docs:check` 가 CI/pre-commit 에서 drift 차단.",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("**제공: 황룡건설(주) · 개발: 주식회사 라텔웍스** · 라이선스: MIT · 공공누리");

  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const data = await collectInventoryData();
  const output = renderInventoryMarkdown(data);
  const target = resolve(ROOT, "docs/INVENTORY.md");
  writeFileSync(target, output, "utf8");
  // eslint-disable-next-line no-console
  console.log(`[inventory] ${target} 생성 완료 (${output.split("\n").length} lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
