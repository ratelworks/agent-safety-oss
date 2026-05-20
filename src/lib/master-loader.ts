/**
 * master-loader.ts
 *
 * legal-duty-master.json 단일 진실 공급원(SSoT) 로더.
 * src/build 두 위치를 자동 탐색하여 캐싱.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MasterDoc {
  docId: string;
  title: string;
  category: string;
  legalRef: string[];
  formStrictness: string;
  formSource: string;
  // frequency 는 사용자 표시용 자연어 ("월1회", "변경시" 등).
  frequency: string;
  // cycleSlug 는 graph.cycle 의 slug 부분 ("monthly", "ad_hoc" 등) 과 1:1 동기화된 machine SSoT.
  // 도구 코드는 cycleSlug 를 우선 사용하고 frequency 는 표시용으로만 사용한다.
  // scripts/etl/sync-master-cycleslug.ts 가 갱신.
  cycleSlug?: string;
  applicableScope: string;
  retention: string;
  penaltyOnMissing: string;
  // C1 라이프사이클 키
  purpose?: string | null;
  submitTo?: string | null;
  submitDeadline?: string | null;
  electronicSubmission?: { available: boolean; url?: string; system?: string } | null;
  templateUrl?: string | null;
  koshaGuideRef?: string[];
  relatedDocsByLifecycle?: { before: string[]; during: string[]; after: string[] };
  nextDueRule?: string | null;
  sourceStatus?: { keys: Record<string, "rule-default" | "manual" | "pending"> };
}

export interface MasterFile {
  _meta: Record<string, unknown>;
  documents: MasterDoc[];
}

let cache: MasterFile | null = null;

export function loadMaster(): MasterFile {
  if (cache) return cache;
  const candidates = [
    resolve(__dirname, "../ontology/legal-duty-master.json"),
    resolve(__dirname, "../../src/ontology/legal-duty-master.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, "utf8");
      cache = JSON.parse(raw);
      return cache!;
    } catch {
      // try next
    }
  }
  throw new Error("legal-duty-master.json not found");
}

export function findDoc(docId: string): MasterDoc | undefined {
  return loadMaster().documents.find((d) => d.docId === docId);
}

// retention 문자열 → 일수 환산 (대략)
export function retentionToDays(retention: string): number | null {
  if (!retention) return null;
  const m = retention.match(/(\d+)\s*년/);
  if (m) return Number(m[1]) * 365;
  if (retention.includes("영구")) return Number.POSITIVE_INFINITY;
  if (retention.includes("공사 완료")) return 0; // 공사 완료 시점 기준
  if (retention.includes("현장 운영")) return 0;
  if (retention.includes("기계 사용")) return 0;
  return null;
}

// nextDueRule + compileDate → 다음 작성일 (ISO 8601)
export function computeNextDueDate(rule: string | null | undefined, compileDate: string): string | null {
  if (!rule) return null;
  const m = rule.match(/compileDate\s*\+\s*P(\d+)([DMY])/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const d = new Date(compileDate);
  if (Number.isNaN(d.getTime())) return null;
  if (unit === "D") d.setDate(d.getDate() + n);
  else if (unit === "M") d.setMonth(d.getMonth() + n);
  else if (unit === "Y") d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
}
