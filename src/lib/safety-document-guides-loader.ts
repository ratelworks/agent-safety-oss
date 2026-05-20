import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 파일 최상단 상수 — 시간 주기별 법정문서 가이드 entity 로더
// src/ontology/guides/*.json 을 읽어 docId·cycle·메타·작성가이드·검토규칙 제공
// safety-laws-loader 와 동일 패턴

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUIDES_DIR = resolve(__dirname, "..", "ontology", "guides");

// ─── 타입 정의 ───
// 가이드 JSON 의 `cycle` 필드는 `"cyc:..."` IRI 형태(예: `"cyc:quarterly"`)로 저장된다.
// loader 가 prefix 를 벗겨내 아래 정규화된 enum 으로 보관하고, 도구·CLI 인터페이스도 동일하게 사용한다.
export type CycleCode =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semi_annual"
  | "annual"
  | "ad_hoc"
  | "continuous";

// 가이드 JSON 의 `legalBasis` 는 IRI 문자열 배열 (`art:산안법:36` 형태),
// `legalBasisDetails` 는 사람이 읽는 법령명·조항·발췌가 포함된 객체 배열이다.
// 두 필드는 의미가 다르며 항상 동시에 존재해야 한다 (legalBasisDetails 가 정합 검증의 진실).
export interface LegalBasisDetail {
  law: string;
  article: string;
  text?: string;
}

export interface ApplicabilityEntry {
  appliesTo: string;
  exemptedFrom: string[];
  scaleNotes: string;
}

export interface StandardFormEntry {
  source: string;
  sourceUrl?: string;
  requiredFields: string[];
  optionalFields?: string[];
}

export interface WritingGuideEntry {
  fieldHints?: Record<string, string>;
  commonMistakes?: string[];
  bestPractices?: string[];
}

export interface ExampleEntry {
  title: string;
  source?: string;
  url?: string;
  license?: string;
}

export interface ReviewRuleEntry {
  rule: string;
  severity: "blocker" | "warning" | "info";
  legalBasis?: string;
}

export interface SafetyDocumentGuide {
  docId: string;
  cycle: CycleCode;
  title: string;
  alternativeNames?: string[];
  purpose: string;
  legalBasis: string[];
  legalBasisDetails?: LegalBasisDetail[];
  applicability: ApplicabilityEntry;
  retention: string;
  standardForm: StandardFormEntry;
  writingGuide?: WritingGuideEntry;
  examples?: ExampleEntry[];
  reviewRules: ReviewRuleEntry[];
  relatedTools: string[];
}

// ─── 캐시 ───
let GUIDES_CACHE: SafetyDocumentGuide[] | null = null;

// 시간 주기 정렬 순서
const CYCLE_ORDER: Record<CycleCode, number> = {
  daily: 1,
  weekly: 2,
  monthly: 3,
  quarterly: 4,
  semi_annual: 5,
  annual: 6,
  ad_hoc: 7,
  continuous: 8,
};

// 시간 주기 표시명 (UI/응답용)
export const CYCLE_LABELS: Record<CycleCode, string> = {
  daily: "일간",
  weekly: "주간",
  monthly: "월간",
  quarterly: "분기",
  semi_annual: "반기",
  annual: "연간",
  ad_hoc: "수시",
  continuous: "상시",
};

// 모든 가이드 entity 로드
export async function loadAllGuides(): Promise<SafetyDocumentGuide[]> {
  if (GUIDES_CACHE) return GUIDES_CACHE;

  const files = await readdir(GUIDES_DIR);
  const guides: SafetyDocumentGuide[] = [];

  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const path = resolve(GUIDES_DIR, f);
    const content = await readFile(path, "utf8");
    try {
      const guide = JSON.parse(content) as SafetyDocumentGuide;
      // cycle 정규화: 가이드 JSON 은 `"cyc:daily"` 형태로 저장되어 있으나 도구·CLI 인터페이스는 prefix 없는 enum 을 사용
      guide.cycle = (guide.cycle as string).replace(/^cyc:/, "") as CycleCode;
      guides.push(guide);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[guides-loader] ${f} JSON parse error: ${(err as Error).message}`);
    }
  }

  // cycle 순 + cycle 내 docId 알파벳 순 정렬
  guides.sort((a, b) => {
    const ca = CYCLE_ORDER[a.cycle] ?? 99;
    const cb = CYCLE_ORDER[b.cycle] ?? 99;
    if (ca !== cb) return ca - cb;
    return a.docId.localeCompare(b.docId);
  });

  GUIDES_CACHE = guides;
  return guides;
}

// 특정 docId 가이드 조회
export async function getGuideById(
  docId: string,
): Promise<SafetyDocumentGuide | undefined> {
  const all = await loadAllGuides();
  return all.find((g) => g.docId === docId);
}

