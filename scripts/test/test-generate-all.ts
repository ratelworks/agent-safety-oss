#!/usr/bin/env tsx
/**
 * test-generate-all.ts (P-PAPER-2h)
 *
 * 모든 Document 노드에 대해 generate_safety_document 회귀 테스트.
 * sections 메타가 정의된 모든 docId가 Markdown 본문 결정론적 출력하는지 검증.
 */

import { generateSafetyDocumentTool } from "../../build/tools/generate-safety-document.js";
import { listDocuments } from "../../build/lib/graph-nodes-loader.js";

interface ToolResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
}

(async () => {
  const docs = (await listDocuments()).filter((d) => !d["@id"].startsWith("doc:kosha_guide"));
  console.log(`# 54종 generate 회귀 테스트 — ${docs.length} Document\n`);

  let pass = 0;
  let fail = 0;
  let noSections = 0;
  const failures: Array<{ docId: string; reason: string }> = [];

  for (const doc of docs) {
    const sections = (doc as { sections?: unknown[] }).sections;
    if (!sections || sections.length === 0) {
      console.log(`  ⚠ ${doc.docId.padEnd(45)} sections 메타 미정의 (fallback 모드)`);
      noSections += 1;
    }

    try {
      const r = (await generateSafetyDocumentTool.handler({
        docId: doc.docId,
        draft: {
          metadata: { siteName: "테스트현장", planDate: "2026-04-27" },
          documentId: `TEST-${doc.docId}-001`,
          workPeriod: "2026-04-28 ~ 2026-05-15",
          emergencyContacts: { fire: "119", labor: "041-560-2800", hospital: "041-550-3114", owner: "010-XXXX-XXXX" },
        },
        scale: { workforce: 8, constructionValue: 5, industry: "construction" },
      })) as ToolResult;
      const text = r.content?.[0]?.text ?? "";
      const sc = r.structuredContent ?? {};
      const length = (sc["bodyMarkdownLength"] as number | undefined) ?? text.length;
      const koshaCount = (sc["koshaGuideCount"] as number | undefined) ?? 0;
      const hazardCount = (sc["hazardCount"] as number | undefined) ?? 0;
      const controlCount = (sc["controlCount"] as number | undefined) ?? 0;

      if (r.isError) {
        fail += 1;
        failures.push({ docId: doc.docId, reason: text.slice(0, 100) });
        console.log(`  ✗ ${doc.docId.padEnd(45)} isError`);
      } else if (length < 200) {
        fail += 1;
        failures.push({ docId: doc.docId, reason: `너무 짧음 (${length}자)` });
        console.log(`  ✗ ${doc.docId.padEnd(45)} too short (${length})`);
      } else {
        pass += 1;
        console.log(`  ✓ ${doc.docId.padEnd(45)} ${length}자  KOSHA=${koshaCount} H=${hazardCount} C=${controlCount}`);
      }
    } catch (err) {
      fail += 1;
      failures.push({ docId: doc.docId, reason: (err as Error).message });
      console.log(`  ✗ ${doc.docId.padEnd(45)} EXCEPTION: ${(err as Error).message}`);
    }
  }

  console.log(`\n# 결과`);
  console.log(`  ✓ PASS: ${pass}`);
  console.log(`  ✗ FAIL: ${fail}`);
  console.log(`  ⚠ sections 미정의 (fallback): ${noSections}`);

  if (failures.length > 0) {
    console.log(`\n# 실패 상세`);
    for (const f of failures) {
      console.log(`  - ${f.docId}: ${f.reason}`);
    }
  }

  process.exit(fail === 0 ? 0 : 1);
})();
