#!/usr/bin/env tsx
/**
 * promote-document-status.ts
 *
 * 19개 auto_converted Document 노드의 verificationStatus 를 human_reviewed 로 전환.
 * Phase 5: 라텔웍스 1차 도메인 검토 완료 표기.
 * (work_plan_excavation 은 verified 유지)
 *
 * _meta 에 reviewedAt + reviewer + reviewNotes 추가.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

(async () => {
  let promoted = 0;
  for (const f of await readdir(DOCS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(DOCS_DIR, f);
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      "@id": string;
      verificationStatus?: string;
      _meta?: Record<string, unknown>;
    };

    // a-codex 진단 반영 — 자동 일괄 변경은 'human_reviewed' 라벨 과신 위험.
    // 'auto_promoted_pending_review' 로 명확화 (실제 dogfooding 완료 시만 'verified').
    if (node.verificationStatus === "auto_converted" || node.verificationStatus === "human_reviewed") {
      node.verificationStatus = "auto_promoted_pending_review";
      const meta = (node._meta ?? {}) as Record<string, unknown>;
      node._meta = {
        ...meta,
        autoPromotedAt: "2026-04-26",
        promotedBy: "scripts/ontology/promote-document-status.ts (자동 스크립트, 사람 검토 미실시)",
        promoteRationale: "1) standardForm 출처가 KOSHA 표준 / 2) legalBasisRefs 가 법제처 verified Article 노드와 매칭 / 3) reviewRules 가 인용 조문과 정합. 단 사람 도메인 전문가 직접 검토는 미실시 — 황룡건설 dogfooding 완료 후 'verified' 승급 예정.",
      };
      await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
      promoted += 1;
    }
  }
  console.log(`[done] ${promoted} 개 Document auto_converted → human_reviewed`);
})();
