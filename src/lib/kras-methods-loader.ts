import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 파일 최상단 상수 — KRAS 7개 방법론 MD 디렉터리
// src/ontology/kras-methods/ 하위의 *.md 파일을 런타임에 로드
// 출처: KOSHA 산업안전포털 KRAS (https://portal.kosha.or.kr/kras/evaluation/kras-method)
const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveKrasDir(): string {
  return resolve(__dirname, "..", "ontology", "kras-methods");
}

const KRAS_DIR = resolveKrasDir();

// KRAS 7개 방법론 메타데이터 (SSoT)
// formId 는 KOSHA portal24 file API 의 식별자
// applicableScale: 1=소규모(50인↓) 2=중규모 3=대규모 4=의무 적용
export interface KrasMethodMeta {
  code: KrasMethodCode;
  fileName: string;
  shortName: string;
  official: string;
  formId: string;
  approach: "qualitative" | "quantitative";
  applicableScale: ("small" | "medium" | "large" | "mandatory")[];
  applicableSubject: ("general" | "construction" | "chemical" | "health")[];
  pdfBytes: number;
  /** 그래프 노드 IRI — 도구 응답에 graphContext로 포함 */
  iri: string;
}

export type KrasMethodCode =
  | "3step"
  | "checklist"
  | "key_factor"
  | "frequency_severity"
  | "occupational_health"
  | "chemical"
  | "construction_continuous";

const METHODS: Record<KrasMethodCode, KrasMethodMeta> = {
  "3step": {
    code: "3step",
    fileName: "3step.md",
    shortName: "3단계 판단법",
    official: "위험성 수준 3단계 판단법",
    formId: "10182",
    approach: "qualitative",
    applicableScale: ["small"],
    applicableSubject: ["general"],
    pdfBytes: 421920,
    iri: "method:3step",
  },
  checklist: {
    code: "checklist",
    fileName: "checklist.md",
    shortName: "체크리스트법",
    official: "체크리스트법",
    formId: "10183",
    approach: "qualitative",
    applicableScale: ["small", "medium", "large"],
    applicableSubject: ["general"],
    pdfBytes: 396614,
    iri: "method:checklist",
  },
  key_factor: {
    code: "key_factor",
    fileName: "key-factor.md",
    shortName: "핵심요인 기술법",
    official: "핵심요인 기술법 (OPS, One Point Sheet)",
    formId: "10184",
    approach: "qualitative",
    applicableScale: ["small", "medium"],
    applicableSubject: ["general"],
    pdfBytes: 558671,
    iri: "method:key_factor",
  },
  frequency_severity: {
    code: "frequency_severity",
    fileName: "frequency-severity.md",
    shortName: "빈도·강도법",
    official: "위험 가능성과 중대성을 조합한 빈도·강도법",
    formId: "10185",
    approach: "quantitative",
    applicableScale: ["medium", "large"],
    applicableSubject: ["general", "construction"],
    pdfBytes: 1092595,
    iri: "method:frequency_severity",
  },
  occupational_health: {
    code: "occupational_health",
    fileName: "occupational-health.md",
    shortName: "산업보건평가",
    official: "산업보건 위험성평가법",
    formId: "10186",
    approach: "qualitative",
    applicableScale: ["small", "medium", "large"],
    applicableSubject: ["health"],
    pdfBytes: 588133,
    iri: "method:occupational_health",
  },
  chemical: {
    code: "chemical",
    fileName: "chemical.md",
    shortName: "화학물질평가",
    official: "화학물질 위험성평가 (CHARM)",
    formId: "10187",
    approach: "qualitative",
    applicableScale: ["small", "medium", "large"],
    applicableSubject: ["chemical"],
    pdfBytes: 267597,
    iri: "method:chemical",
  },
  construction_continuous: {
    code: "construction_continuous",
    fileName: "construction-continuous.md",
    shortName: "건설 최초·상시·수시·정기",
    official: "건설업 최초·상시·수시·정기 위험성평가",
    formId: "10188",
    approach: "qualitative",
    applicableScale: ["mandatory"],
    applicableSubject: ["construction"],
    pdfBytes: 36092717,
    iri: "method:construction_continuous",
  },
};

const FILE_CACHE = new Map<KrasMethodCode, string>();

async function loadMethodFile(code: KrasMethodCode): Promise<string> {
  if (FILE_CACHE.has(code)) return FILE_CACHE.get(code)!;
  const meta = METHODS[code];
  const path = resolve(KRAS_DIR, meta.fileName);
  const content = await readFile(path, "utf8");
  FILE_CACHE.set(code, content);
  return content;
}

export function listKrasMethods(): KrasMethodMeta[] {
  return (Object.keys(METHODS) as KrasMethodCode[]).map((c) => METHODS[c]);
}

export function getKrasMethodMeta(code: KrasMethodCode): KrasMethodMeta | undefined {
  return METHODS[code];
}

export async function getKrasMethodContent(code: KrasMethodCode): Promise<string> {
  return loadMethodFile(code);
}

// 방법 추천 로직 — 사업장 조건 기반
// industry: construction|manufacturing|service|other
// scale: small|medium|large
// subject: general|chemical|health|construction
export interface RecommendInput {
  industry: "construction" | "manufacturing" | "service" | "other";
  scale: "small" | "medium" | "large";
  subject: "general" | "chemical" | "health" | "construction";
}

export interface Recommendation {
  primary: KrasMethodCode;
  secondary: KrasMethodCode[];
  reasoning: string;
}

export function recommendMethod(input: RecommendInput): Recommendation {
  // 1순위: 도메인 특수 평가 (chemical/health) 가 있으면 그것 우선
  if (input.subject === "chemical") {
    return {
      primary: "chemical",
      secondary: ["frequency_severity", "occupational_health"],
      reasoning:
        "화학물질 취급 사업장은 CHARM(화학물질 위험성평가) 의무 적용. 일반 안전 위험은 빈도·강도법 병행, 건강영향은 산업보건평가 추가 권장.",
    };
  }
  if (input.subject === "health") {
    return {
      primary: "occupational_health",
      secondary: ["chemical", "frequency_severity"],
      reasoning:
        "직업병·작업환경·건강관리 영역은 산업보건 위험성평가법으로 진행. 화학물질 노출 시 CHARM 추가, 일반 안전 위험은 빈도·강도법 병행.",
    };
  }

  // 2순위: 건설업 → construction_continuous (의무)
  if (input.industry === "construction") {
    return {
      primary: "construction_continuous",
      secondary: input.scale === "small" ? ["3step", "key_factor"] : ["frequency_severity", "checklist"],
      reasoning:
        "건설업은 최초·상시·수시·정기 평가 의무 (위험성평가 고시 2024-76). 작업별 위험성은 " +
        (input.scale === "small"
          ? "3단계 판단법 또는 핵심요인 기술법(OPS)"
          : "빈도·강도법(5×4) + 체크리스트") +
        "으로 보조.",
    };
  }

  // 3순위: 제조업·서비스업·기타 → 규모별 선택
  if (input.scale === "small") {
    return {
      primary: "3step",
      secondary: ["key_factor", "checklist"],
      reasoning:
        "소규모 사업장(50인↓ 권장)은 3단계 판단법으로 시작. 단순 작업은 핵심요인 기술법(OPS), 표준 반복 작업은 체크리스트법 병행.",
    };
  }
  if (input.scale === "medium") {
    return {
      primary: "frequency_severity",
      secondary: ["checklist", "key_factor"],
      reasoning:
        "중규모 사업장은 빈도·강도법(3×3 또는 5×4)으로 정량 평가 권장. 표준 반복 작업은 체크리스트, 단순 작업은 OPS 병행.",
    };
  }

  // large
  return {
    primary: "frequency_severity",
    secondary: ["checklist", "occupational_health"],
    reasoning:
      "대규모 사업장은 빈도·강도법(5×4) 정량 평가 + 표준 체크리스트 + 산업보건평가 통합 운영 권장. 화학물질 취급 시 CHARM 추가.",
  };
}
