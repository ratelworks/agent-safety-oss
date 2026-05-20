#!/usr/bin/env tsx
/**
 * convert-guides-to-graph.ts
 *
 * src/ontology/guides/*.json (19종 docId entity) → src/ontology/graph/nodes/documents/*.jsonld
 * 자동 변환. 이미 수동 작성된 .jsonld 가 있으면 skip (충돌 방지).
 *
 * 매핑:
 *   docId            → @id, docId
 *   cycle            → cycle (cycle:{name})
 *   title            → title
 *   alternativeNames → alternativeNames
 *   purpose          → description, trigger
 *   legalBasis       → _meta.legalBasisRefs (사람이 읽을 수 있는 형태로 보존,
 *                       Phase 2 에서 Article 노드 IRI 매핑)
 *   applicability    → applicableWhen (간단 형태 — scaleNotes 보존)
 *   retention        → retention
 *   standardForm     → standardForm + requiredFields (key 자동 생성)
 *   reviewRules      → reviewRules (이미 호환)
 *   writingGuide     → _meta.writingGuide
 *   examples         → _meta.examples
 *   relatedTools     → _meta.relatedTools
 */

import { readFile, readdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "guides");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

interface GuideEntity {
  docId: string;
  cycle: string;
  title: string;
  alternativeNames?: string[];
  purpose?: string;
  legalBasis?: Array<{ law: string; article: string; text: string }>;
  applicability?: {
    appliesTo?: string;
    exemptedFrom?: string[];
    scaleNotes?: string;
  };
  retention?: string;
  standardForm?: {
    source?: string;
    sourceUrl?: string;
    requiredFields?: string[];
    optionalFields?: string[];
  };
  writingGuide?: unknown;
  examples?: unknown;
  reviewRules?: Array<{
    rule: string;
    severity: string;
    legalBasis?: string;
    checkFields?: string[];
  }>;
  relatedTools?: string[];
}

// docId → 한 단어 영문 슬러그 (file 명·@id 용)
function slugifyDocId(docId: string): string {
  return docId.replace(/_/g, "-");
}

// 한국어 라벨 → key 자동 생성 (충돌 감지: 같은 docId 내 중복 시 _2, _3 suffix)
function labelToKey(
  label: string,
  idx: number,
  used: Set<string>,
): string {
  const cleaned = label
    .replace(/[\s/—–-]+/g, "_")
    .replace(/[()\[\],.·~:]/g, "")
    .toLowerCase();

  let base: string;
  if (cleaned.length === 0 || cleaned.length > 60) {
    base = `field_${idx + 1}`;
  } else {
    base = cleaned;
  }

  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  // 충돌 — suffix 추가
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      console.warn(
        `[labelToKey] 충돌 감지: '${base}' 이미 사용됨 → '${candidate}' (라벨='${label}')`,
      );
      return candidate;
    }
  }

  // 최후 — idx 기반
  const fallback = `field_${idx + 1}`;
  used.add(fallback);
  return fallback;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function convert(guide: GuideEntity): Record<string, unknown> {
  const slug = slugifyDocId(guide.docId);
  const usedKeys = new Set<string>();
  const requiredFields = (guide.standardForm?.requiredFields ?? []).map((label, idx) => ({
    key: labelToKey(label, idx, usedKeys),
    label,
    source: guide.standardForm?.source ?? "표준 양식 미고시",
  }));

  return {
    "@context": "../../context.jsonld",
    "@id": `doc:${guide.cycle}/${guide.docId}`,
    "@type": "Document",
    docId: guide.docId,
    title: guide.title,
    alternativeNames: guide.alternativeNames ?? [],
    description: guide.purpose ?? "",
    cycle: `cyc:${guide.cycle}`,
    trigger: guide.purpose ?? "",
    applicableWhen: guide.applicability?.appliesTo
      ? { appliesTo: guide.applicability.appliesTo, scaleNotes: guide.applicability.scaleNotes ?? "" }
      : {},
    exemptedWhen:
      (guide.applicability?.exemptedFrom?.length ?? 0) > 0
        ? { reasons: guide.applicability!.exemptedFrom }
        : {},
    requiredFields,
    reviewRules: guide.reviewRules ?? [],
    retention: guide.retention ?? "",
    standardForm: guide.standardForm ?? {},
    relatedDocs: [],
    guidedBy: [],
    verificationStatus: "auto_converted",
    _meta: {
      publishedBy: "황룡건설(주) + ㈜라텔웍스",
      legalBasisRefs: guide.legalBasis ?? [],
      writingGuide: guide.writingGuide,
      examples: guide.examples,
      relatedTools: guide.relatedTools ?? [],
      convertedAt: new Date().toISOString().slice(0, 10),
      note: "guides/*.json 에서 자동 변환된 노드. legalBasis 의 Article 노드 IRI 매핑은 P1 수작업 보강 예정.",
    },
  };
}

(async () => {
  const entries = await readdir(GUIDES_DIR);
  let converted = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const guidePath = resolve(GUIDES_DIR, entry);
    const slug = basename(entry, ".json");
    const targetPath = resolve(DOCS_DIR, `${slug}.jsonld`);

    if (await fileExists(targetPath)) {
      console.log(`[skip] ${slug}.jsonld 이미 존재 (수동 작성)`);
      skipped += 1;
      continue;
    }

    const raw = await readFile(guidePath, "utf8");
    const guide = JSON.parse(raw) as GuideEntity;
    const node = convert(guide);
    await writeFile(targetPath, JSON.stringify(node, null, 2) + "\n", "utf8");
    console.log(`[ok]   ${slug}.jsonld (docId=${guide.docId}, fields=${(guide.standardForm?.requiredFields ?? []).length})`);
    converted += 1;
  }

  console.log("");
  console.log(`[done] converted=${converted}, skipped=${skipped}, total=${entries.length}`);
})();
