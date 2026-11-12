/**
 * 현장 말 → 그래프 대상. 동의어 사전(ontology/synonyms.json)을 읽고 질문에 맞는 묶음을 찾는다.
 * 묶음은 낱말들과 그 낱말이 가리키는 대상(작업·공종·유해요인·조문·문서)의 주소로 이뤄진다.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNONYMS_PATH = resolve(__dirname, "..", "ontology", "synonyms.json");
/** 이보다 짧은 낱말은 맞춰 보지 않는다 */
const MIN_TERM_LENGTH = 2;

export interface SynonymGroup {
  id: string;
  primary: string;
  synonyms: string[];
  expandsTo: string[];
  /** 묶음이 맞더라도 빼야 하는 대상 */
  explicitlyExcludes?: string[];
  exclusionNote?: string;
  applicabilityNote?: string;
  timingNote?: string;
  userMisuseNote?: string;
}

let cache: SynonymGroup[] | null = null;

export async function loadSynonymGroups(): Promise<SynonymGroup[]> {
  if (cache) return cache;
  cache = (JSON.parse(await readFile(SYNONYMS_PATH, "utf-8")) as { groups: SynonymGroup[] }).groups;
  return cache;
}

/**
 * 질문이 이 묶음에 맞으면 맞은 낱말을, 아니면 null.
 * 대표 낱말이나 동의어가 질문에 그대로 들어 있거나, 여러 낱말로 된 동의어의 낱말이 모두 들어 있을 때 맞는다.
 */
export function matchedTerm(query: string, group: SynonymGroup): string | null {
  if (query.includes(group.primary)) return group.primary;
  for (const s of group.synonyms) {
    if (query.includes(s)) return s;
    const tokens = s.split(/\s+/).filter((t) => t.length >= MIN_TERM_LENGTH);
    if (tokens.length > 1 && tokens.every((t) => query.includes(t))) return s;
  }
  return null;
}
