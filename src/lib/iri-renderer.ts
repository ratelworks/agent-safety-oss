// ─────────────────────────────────────────────────────────────────────────────
// iri-renderer.ts (v0.8 결함 #2 정정)
//
// 그래프 IRI 를 사람이 읽을 수 있는 한국어 형식으로 변환.
// generate_safety_document 출력 가독성 향상.
//
// 예:
//   art:기준규칙:38         → "산업안전보건기준에 관한 규칙 §38"
//   art:기준규칙:38#2       → "산업안전보건기준에 관한 규칙 §38 ②"
//   annex:기준규칙:별표4-6호 → "산업안전보건기준에 관한 규칙 별표 4 제6호"
//   penalty:산안법:175       → "산업안전보건법 §175 (5천만원 이하 과태료)"
// ─────────────────────────────────────────────────────────────────────────────

const LAW_NAME_MAP: Record<string, string> = {
  "기준규칙": "산업안전보건기준에 관한 규칙",
  "산안법": "산업안전보건법",
  "산안법시행령": "산업안전보건법 시행령",
  "산안법시행규칙": "산업안전보건법 시행규칙",
  "중처법": "중대재해처벌법",
  "중처법시행령": "중대재해처벌법 시행령",
  "위험성평가-고시": "위험성평가 고시 (2024-76)",
};

const PENALTY_AMOUNT_MAP: Record<string, string> = {
  "penalty:산안법:175": "5천만원 이하 과태료",
  "penalty:산안법:167": "7년 이하 징역 또는 1억원 이하 벌금 (사망 사고 시)",
  "penalty:중처법:6": "1년 이상 징역 또는 10억원 이하 벌금 (사망 사고 시)",
};

const HANG_NUMBER_MAP: Record<string, string> = {
  "1": "①",
  "2": "②",
  "3": "③",
  "4": "④",
  "5": "⑤",
  "6": "⑥",
  "7": "⑦",
  "8": "⑧",
};

/**
 * IRI 를 한국어 사람 가독 형식으로 변환.
 *
 * @example
 *   renderIri("art:기준규칙:38")        → "산업안전보건기준에 관한 규칙 §38"
 *   renderIri("art:기준규칙:38#2")      → "산업안전보건기준에 관한 규칙 §38 ②"
 *   renderIri("annex:기준규칙:별표4-6호") → "산업안전보건기준에 관한 규칙 별표 4 제6호"
 *   renderIri("penalty:산안법:175")      → "산업안전보건법 §175 (5천만원 이하 과태료)"
 */
export function renderIri(iri: string): string {
  if (!iri || typeof iri !== "string") return iri;

  // Penalty
  if (iri.startsWith("penalty:")) {
    const amount = PENALTY_AMOUNT_MAP[iri];
    const m = iri.match(/^penalty:([^:]+):(.+)$/);
    if (m) {
      const lawName = LAW_NAME_MAP[m[1]] ?? m[1];
      return `${lawName} §${m[2]}${amount ? ` (${amount})` : ""}`;
    }
    return iri;
  }

  // Annex (별표·서식)
  if (iri.startsWith("annex:")) {
    const m = iri.match(/^annex:([^:]+):(.+)$/);
    if (m) {
      const lawName = LAW_NAME_MAP[m[1]] ?? m[1];
      const annexId = m[2];
      // "별표4-6호" → "별표 4 제6호"
      const parsed = annexId.match(/^별표(\d+)(?:-(.+))?$/);
      if (parsed) {
        const annexNo = parsed[1];
        const sub = parsed[2];
        if (sub) return `${lawName} 별표 ${annexNo} 제${sub}`;
        return `${lawName} 별표 ${annexNo}`;
      }
      return `${lawName} ${annexId}`;
    }
    return iri;
  }

  // Article (조문)
  if (iri.startsWith("art:")) {
    // art:기준규칙:38#2 → 산안기준규칙 §38 ②
    const m = iri.match(/^art:([^:]+):(\d+)(?:#(\d+))?$/);
    if (m) {
      const lawName = LAW_NAME_MAP[m[1]] ?? m[1];
      const articleNo = m[2];
      const hang = m[3];
      if (hang) {
        const hangSym = HANG_NUMBER_MAP[hang] ?? `제${hang}항`;
        return `${lawName} §${articleNo} ${hangSym}`;
      }
      return `${lawName} §${articleNo}`;
    }
    return iri;
  }

  // 그 외 IRI는 원형 유지
  return iri;
}

