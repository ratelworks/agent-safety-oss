/**
 * 부칙 층 — 산업안전보건법·시행령·시행규칙·안전보건규칙 부칙(시행일·적용례·경과조치·특례)을 본칙 조문에서 찾는다.
 * 부칙 노드(SupplementaryProvision)는 부칙 조마다 원문을 그대로 가지고, 부칙이 언급한 본칙 조문을 references 로 가리킨다.
 */
import { listNodesByType } from "./graph-nodes-loader.js";

// ── 상수 ────────────────────────────────────────────────────────────
const SUPPLEMENT_TYPE = "SupplementaryProvision";
/** 부칙 성격 표시 이름 */
export const SUPPLEMENT_KIND_LABEL: Record<string, string> = {
  "effective-date": "시행일",
  application: "적용례",
  transitional: "경과조치",
  "special-case": "특례",
  "validity-period": "유효기간",
  "other-law-amendment": "다른 법령에 의한 개정",
  "relation-to-other-laws": "다른 법령과의 관계",
  repeal: "폐지",
  deleted: "삭제",
  other: "기타",
};

interface SupplementNode {
  "@id": string;
  title: string;
  supplementKind?: string;
  legislationDate?: string;
  description?: string;
  references?: string[];
}

export interface SupplementForArticle {
  iri: string;
  title: string;
  kind: string;
  kindLabel: string;
  promulgated?: string;
  text: string;
}

let cache: SupplementNode[] | null = null;
async function loadSupplements(): Promise<SupplementNode[]> {
  if (cache) return cache;
  cache = (await listNodesByType(SUPPLEMENT_TYPE)) as unknown as SupplementNode[];
  return cache;
}

/** 이 조문을 언급한 부칙 — 공포일이 늦은 것부터 */
export async function findSupplementsFor(articleIri: string): Promise<SupplementForArticle[]> {
  // 항·호 단위 주소(art:산안법:38:1)도 조 단위로 맞춘다
  const base = articleIri.split(":").slice(0, 3).join(":");
  const hits = (await loadSupplements()).filter((s) => (s.references ?? []).includes(base));
  return hits
    .map((s) => ({
      iri: s["@id"],
      title: s.title,
      kind: s.supplementKind ?? "other",
      kindLabel: SUPPLEMENT_KIND_LABEL[s.supplementKind ?? "other"] ?? "기타",
      ...(s.legislationDate ? { promulgated: s.legislationDate } : {}),
      text: s.description ?? "",
    }))
    .sort((a, b) => (b.promulgated ?? "").localeCompare(a.promulgated ?? "") || a.iri.localeCompare(b.iri, "ko"));
}
