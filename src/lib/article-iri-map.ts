// ─────────────────────────────────────────────────────────────────────────────
// article-iri-map.ts
//
// 법령 별칭 → canonical 슬러그 매핑 + 조문/별표 ref 텍스트 → 정식 IRI 변환.
// guides/*.json 의 legalBasis 메타({law, article, text})를 그래프 IRI 로 끌어올리는
// 1차 매핑 테이블.
//
// Phase 1 P1 — 환각 차단 정체성을 위해 매핑 결과는 "예측" 으로만 표시하고,
// 실제 Article/Annex 노드가 graph nodes 에 존재하는 경우에만 Document.legalBasis 정방향으로 승급.
// 노드 부재 시 _meta.predictedLegalBasisIris 에만 기록 (사용자에게 안내용).
// ─────────────────────────────────────────────────────────────────────────────

// 법령명 → canonical 슬러그
//
// decision 005: 그래프(articles/*.jsonld @id)에 존재하는 모든 art: prefix 를 커버해야
// review 환각검증이 정당한 법령 인용을 차단하지 않는다. 그래프 실측 prefix 10종:
//   건진법, 건진법시행규칙, 건진법시행령, 기준규칙, 산안법, 산안법시행규칙,
//   산안법시행령, 위험성평가-고시, 중처법, 중처법시행령
// 시행령/시행규칙은 본법보다 먼저 매칭되도록 별도 키로 명시 (긴 표기 우선).
export const LAW_ALIASES: Record<string, string> = {
  // ─── 산안법 ───
  "산업안전보건법": "산안법",
  "산안법": "산안법",
  // 산안법 시행령
  "산업안전보건법 시행령": "산안법시행령",
  "산안법 시행령": "산안법시행령",
  "산안법시행령": "산안법시행령",
  // 산안법 시행규칙
  "산업안전보건법 시행규칙": "산안법시행규칙",
  "산안법 시행규칙": "산안법시행규칙",
  "산안법시행규칙": "산안법시행규칙",
  // ─── 기준규칙 ───
  "산업안전보건기준에 관한 규칙": "기준규칙",
  "산업안전보건기준에관한규칙": "기준규칙",
  "산안기준규칙": "기준규칙",
  "기준규칙": "기준규칙",
  "안전보건규칙": "기준규칙",
  // ─── 중처법 ───
  "중대재해 처벌 등에 관한 법률": "중처법",
  "중대재해처벌법": "중처법",
  "중처법": "중처법",
  // 중처법 시행령 — 입력 키 누락이 P0 버그였음 (decision 005)
  "중대재해 처벌 등에 관한 법률 시행령": "중처법시행령",
  "중대재해처벌법 시행령": "중처법시행령",
  "중대재해처벌법시행령": "중처법시행령",
  "중처법 시행령": "중처법시행령",
  "중처법시행령": "중처법시행령",
  // ─── 건진법 (건설기술 진흥법) ───
  "건설기술 진흥법": "건진법",
  "건설기술진흥법": "건진법",
  "건진법": "건진법",
  // 건진법 시행령
  "건설기술 진흥법 시행령": "건진법시행령",
  "건설기술진흥법 시행령": "건진법시행령",
  "건진법 시행령": "건진법시행령",
  "건진법시행령": "건진법시행령",
  // 건진법 시행규칙
  "건설기술 진흥법 시행규칙": "건진법시행규칙",
  "건설기술진흥법 시행규칙": "건진법시행규칙",
  "건진법 시행규칙": "건진법시행규칙",
  "건진법시행규칙": "건진법시행규칙",
  // ─── 위험성평가 고시 ───
  "위험성평가 고시 (제2024-76호)": "위험성평가-고시",
  "위험성평가 고시": "위험성평가-고시",
  "위험성평가고시": "위험성평가-고시",
  "사업장 위험성평가에 관한 지침": "위험성평가-고시",
  // 별표 자체가 law 로 들어오는 케이스 (예: "산안기준규칙 별표 3")
  "산안기준규칙 별표 3": "기준규칙",
  "산안기준규칙 별표 4": "기준규칙",
};

interface IriResolution {
  iri: string | null;
  kind: "Article" | "Annex" | null;
  canonical: string | null;
  matchedAliasKey: string | null;
}

// 공백 정규화 lookup — "중처법 시행령" 과 "중처법시행령" 을 동일 키로 취급.
// LAW_ALIASES 에 양쪽 표기를 모두 등록하지만, 누락 시에도 공백 차이로 인한
// canonical 실패를 방지하기 위한 2차 안전망 (decision 005 단일화 정신).
const ALIAS_BY_COMPACT: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [key, canonical] of Object.entries(LAW_ALIASES)) {
    m[key.replace(/\s+/g, "")] = canonical;
  }
  return m;
})();

function resolveCanonical(law: string): string | null {
  const trimmed = law.trim();
  // 1차: 정확 매칭
  const exact = LAW_ALIASES[trimmed];
  if (exact) return exact;
  // 2차: 공백 제거 후 매칭
  const compact = ALIAS_BY_COMPACT[trimmed.replace(/\s+/g, "")];
  return compact ?? null;
}

// 조문 텍스트(예: "§38", "§15 ④ 3호", "§42 (추락방지)", "별표 4", "§338~§347")
// 에서 1차 IRI 생성. 부수 정보(항·호·괄호 부연)는 IRI 에 포함하지 않음 (P1).
export function legalRefToIri(law: string, article: string): IriResolution {
  const trimmedLaw = law.trim();
  const canonical = resolveCanonical(trimmedLaw);
  if (!canonical) {
    return { iri: null, kind: null, canonical: null, matchedAliasKey: null };
  }

  const trimmed = article.trim();

  // 별표 처리 — "별표 4" / "별표 4 6호" / "별표3"
  if (/별표/.test(trimmed)) {
    const m = trimmed.match(/별표\s*(\d+)(?:\s*(\d+)호)?/);
    if (m) {
      const major = m[1];
      const sub = m[2];
      if (sub) {
        return {
          iri: `annex:${canonical}:별표${major}-${sub}호`,
          kind: "Annex",
          canonical,
          matchedAliasKey: trimmedLaw,
        };
      }
      return {
        iri: `annex:${canonical}:별표${major}`,
        kind: "Annex",
        canonical,
        matchedAliasKey: trimmedLaw,
      };
    }
  }

  // 조문 §N — 첫 번째 §숫자만 사용. 범위(§338~§347)는 첫 조만.
  const m = trimmed.match(/§\s*(\d+)/);
  if (m) {
    return {
      iri: `art:${canonical}:${m[1]}`,
      kind: "Article",
      canonical,
      matchedAliasKey: trimmedLaw,
    };
  }

  return { iri: null, kind: null, canonical, matchedAliasKey: trimmedLaw };
}

// 19종 docId 의 legalBasisRefs 를 받아 IRI 들을 일괄 추출
export function extractIrisFromRefs(
  refs: Array<{ law: string; article: string; text: string }>,
): {
  iris: string[];
  unresolved: Array<{ law: string; article: string; reason: string }>;
} {
  const iris = new Set<string>();
  const unresolved: Array<{ law: string; article: string; reason: string }> = [];
  for (const r of refs) {
    const res = legalRefToIri(r.law, r.article);
    if (res.iri) {
      iris.add(res.iri);
    } else {
      unresolved.push({
        law: r.law,
        article: r.article,
        reason: res.canonical
          ? `법령은 매핑되었으나 article 패턴 미인식 ('${r.article}')`
          : `법령 별칭 미등록 ('${r.law}') — LAW_ALIASES 추가 필요`,
      });
    }
  }
  return { iris: Array.from(iris), unresolved };
}
