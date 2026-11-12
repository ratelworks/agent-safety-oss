/**
 * unreviewed-links.ts — 항목별 검토를 거치지 않은 연결을 가려낸다
 *
 * 그래프의 규율 연결(조문 regulates 대상) 가운데 한쪽 자료에만 적혀 있어 반대쪽에 채워 넣은 것은
 * `ontology/graph/unreviewed-links.json` 에 목록으로 둔다. 도구는 이 연결로 나온 조문에 "검토 전" 표시를 붙인다.
 * 검토를 마친 연결은 목록에서 빼면 표시가 사라진다.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CANDIDATE_PATHS = [
  resolve(ROOT, "build", "ontology", "graph", "unreviewed-links.json"),
  resolve(ROOT, "src", "ontology", "graph", "unreviewed-links.json"),
];
export const UNREVIEWED_NOTE = "검토 전 연결 — 한쪽 자료에만 적혀 있던 연결이라 맞는지 확인이 필요합니다";

let regulates: Set<string> | null = null;

function load(): Set<string> {
  if (regulates) return regulates;
  const path = CANDIDATE_PATHS.find((p) => existsSync(p));
  const list = path ? ((JSON.parse(readFileSync(path, "utf8")) as { regulates?: string[] }).regulates ?? []) : [];
  regulates = new Set(list);
  return regulates;
}

/** 조문(또는 별표)이 대상(작업·장비·위험요인)을 규율한다는 연결이 검토 전인가 */
export function isUnreviewedRegulation(articleIri: string, targetIri: string): boolean {
  return load().has(`${articleIri}|${targetIri}`);
}

export function unreviewedRegulationCount(): number {
  return load().size;
}
