/**
 * 공단 자료실 연관 자료 — 공단 「만화로 보는 산업안전보건기준에 관한 규칙」 이 조문 옆에 QR 로 실어 둔 자료(OPS·동영상 등).
 * 자료 노드(kosha:media/*)는 제목·형식·공단 자료실 주소만 가지고(내용은 싣지 않음), 그 QR 이 인쇄된 조문을 relatedArticles 로 가리킨다.
 */
import { listNodesByType } from "./graph-nodes-loader.js";

// ── 상수 ────────────────────────────────────────────────────────────
const MEDIA_TYPE = "DigitalDocument";
const MEDIA_PREFIX = "kosha:media/";

interface MediaNode {
  "@id": string;
  title: string;
  relatedArticles?: string[];
  _meta?: { sourceUrl?: string; contentForm?: string; publicationNo?: string; licenseHint?: string };
}

export interface KoshaMedia {
  iri: string;
  title: string;
  form?: string;
  url?: string;
  publicationNo?: string;
  license?: string;
}

let cache: MediaNode[] | null = null;
async function loadMedia(): Promise<MediaNode[]> {
  if (cache) return cache;
  cache = ((await listNodesByType(MEDIA_TYPE)) as unknown as MediaNode[]).filter((n) => n["@id"].startsWith(MEDIA_PREFIX));
  return cache;
}

/** 이 조문 옆에 QR 로 실린 공단 자료 */
export async function findKoshaMediaFor(articleIri: string): Promise<KoshaMedia[]> {
  const base = articleIri.split(":").slice(0, 3).join(":");
  return (await loadMedia())
    .filter((n) => (n.relatedArticles ?? []).includes(base))
    .map((n) => ({
      iri: n["@id"],
      title: n.title,
      ...(n._meta?.contentForm ? { form: n._meta.contentForm } : {}),
      ...(n._meta?.sourceUrl ? { url: n._meta.sourceUrl } : {}),
      ...(n._meta?.publicationNo ? { publicationNo: n._meta.publicationNo } : {}),
      ...(n._meta?.licenseHint ? { license: n._meta.licenseHint } : {}),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "ko"));
}
