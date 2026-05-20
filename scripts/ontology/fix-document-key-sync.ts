#!/usr/bin/env tsx
/**
 * fix-document-key-sync.ts (2026-04-29)
 *
 * 67종 노드의 requiredFields 와 sections.fields 키 불일치 정정.
 *
 * 정책:
 *  - sections.fields 가 권위 (generic renderer 가 사용하는 키)
 *  - requiredFields 는 호환 fallback 으로 유지하되, sections.fields 와 동일 키로 재생성
 *  - source 메타는 기존 requiredFields[].source 를 가급적 보존 (key 매칭 시), 없으면 sec.legalSource 로 채움
 *
 * 추가로 누수된 inputGuide 정정:
 *  - '행정·관리체계 문서. 법적 근거·결재선·게시·보존 명시' 같은 대표 placeholder 식별
 *  - 해당 필드의 inputGuide·standardFormat·examples·checkPoints 를 비움 (사용자/LLM 이 직접 작성)
 *  - field._meta.guidanceStatus = 'pending_manual_review' 마킹 (transparent fallback)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes", "documents");

// 누수된 generic placeholder 패턴 (다수 doc 에 무차별 적용된 것들)
const PLACEHOLDER_INPUT_GUIDES = [
  "행정·관리체계 문서. 법적 근거·결재선·게시·보존 명시. 정기 갱신 의무 있는 경우 갱신일 표기.",
  "결재 라인 (실무자→관리자→사업주). 각 단계 일자·서명. 도급 사업장은 원·하도급 양측 결재.",
  "24시간 비상 가능한 연락처 + 부서·역할. 외부 비상기관(119·1899-9594·고용노동부 1350) 병기.",
];
const PLACEHOLDER_EXAMPLES = [
  "(행정문서 표준 — 법적 근거 + 항목별 본문 + 결재 + 게시 + 보존)",
];

const docFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".jsonld") && !f.startsWith("kosha"));

let totalKeyFix = 0;
let totalGuideFix = 0;
let touchedDocs = 0;

for (const f of docFiles) {
  const filePath = resolve(DOCS_DIR, f);
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  let changed = false;

  // ── (1) requiredFields ↔ sections.fields 키 동기화 ──
  if (raw.sections && raw.sections.length > 0) {
    const allFields: Array<{ key: string; label: string; source?: string }> = [];
    const seen = new Set<string>();
    const oldRequired = (raw.requiredFields ?? []) as Array<{ key: string; label: string; source?: string }>;
    const oldRequiredByLabel = new Map<string, string>();
    for (const rf of oldRequired) oldRequiredByLabel.set(rf.label, rf.source ?? "");

    for (const sec of raw.sections) {
      const secLegalSource = sec.legalSource ?? "";
      for (const fld of sec.fields ?? []) {
        if (fld.required === false) continue;
        if (seen.has(fld.key)) continue;
        seen.add(fld.key);
        // source 우선: 기존 requiredFields 의 동일 label 매칭 → sec.legalSource → 없음
        const source = oldRequiredByLabel.get(fld.label) || secLegalSource || undefined;
        allFields.push({ key: fld.key, label: fld.label, source });
      }
    }

    // 기존 requiredFields 에만 있고 sections 에는 없는 항목 (예: 메타 documentId, emergencyContacts) 도 보존
    const orphanReq = oldRequired.filter((rf) => !seen.has(rf.key));
    for (const rf of orphanReq) {
      // 명백한 메타 항목만 보존 (renderer 외부에서 처리)
      if (/documentId|emergencyContacts|workPeriod|approvalChain|workerNotification/.test(rf.key)) {
        allFields.push(rf);
      }
    }

    const beforeKeys = oldRequired.map((r) => r.key).sort().join(",");
    const afterKeys = allFields.map((r) => r.key).sort().join(",");
    if (beforeKeys !== afterKeys) {
      raw.requiredFields = allFields;
      changed = true;
      totalKeyFix += 1;
    }
  }

  // ── (2) 누수된 inputGuide·examples 정정 ──
  if (raw.sections) {
    for (const sec of raw.sections) {
      for (const fld of sec.fields ?? []) {
        const isPlaceholderGuide =
          fld.inputGuide && PLACEHOLDER_INPUT_GUIDES.includes(fld.inputGuide);
        const isPlaceholderEx =
          Array.isArray(fld.examples) &&
          fld.examples.length > 0 &&
          fld.examples.every((e: string) => PLACEHOLDER_EXAMPLES.includes(e));

        if (isPlaceholderGuide || isPlaceholderEx) {
          // 누수 가이드/예시는 비움. fld._meta.guidanceStatus 로 마킹.
          if (isPlaceholderGuide) delete fld.inputGuide;
          if (Array.isArray(fld.examples) && fld.examples.every((e: string) => PLACEHOLDER_EXAMPLES.includes(e))) {
            fld.examples = [];
          }
          // standardFormat 도 일반 placeholder 면 정리
          if (fld.standardFormat === "[항목] [근거 법령] [작성·결재 절차]") {
            delete fld.standardFormat;
          }
          // 일반 행정문서 checkPoints 정리
          if (
            Array.isArray(fld.checkPoints) &&
            fld.checkPoints.length === 4 &&
            fld.checkPoints[0] === "법령 근거 명확" &&
            fld.checkPoints[1] === "결재선 3단계 이상"
          ) {
            fld.checkPoints = [];
          }
          fld._meta = fld._meta ?? {};
          (fld._meta as Record<string, string>).guidanceStatus = "pending_manual_review";
          (fld._meta as Record<string, string>).guidanceNote =
            "v0.2.x 자동 변환 시 다른 doc 의 일반 행정 가이드가 누수됨. 도메인 전문가 보강 필요. (audit 2026-04-29)";
          changed = true;
          totalGuideFix += 1;
        }
      }
    }
  }

  if (changed) {
    writeFileSync(filePath, JSON.stringify(raw, null, 2) + "\n", "utf8");
    touchedDocs += 1;
  }
}

console.log(`[fix-document-key-sync] 정정 완료`);
console.log(`  - 수정 doc 수      : ${touchedDocs} / ${docFiles.length}`);
console.log(`  - 키 동기화 doc     : ${totalKeyFix}`);
console.log(`  - 누수 가이드 필드 : ${totalGuideFix}`);
