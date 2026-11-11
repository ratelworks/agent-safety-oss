#!/usr/bin/env tsx
/**
 * materialize-inverse-edges.ts — 역관계 쌍의 한쪽에만 적힌 간선을 반대쪽에도 채운다
 *
 * 그래프 노드는 역관계를 양쪽 노드에 각각 적는다(A legalBasis B ↔ B legalBasisOf A).
 * 한쪽만 적히면 읽는 방향에 따라 답이 달라진다 — 이 스크립트가 빠진 쪽을 채우고,
 * `--check` 는 빠진 간선이 하나라도 있으면 실패한다(게이트).
 *
 * 사용
 *   tsx scripts/ontology/materialize-inverse-edges.ts           # 빠진 간선을 채움
 *   tsx scripts/ontology/materialize-inverse-edges.ts --check   # 점검만 (빠진 간선 있으면 exit 1)
 *
 * 역관계가 아닌 쌍: hasArticle / partOf — 법령은 조문을 직접 가리키지만(hasArticle)
 * 조문은 자신이 속한 장을 가리킨다(partOf). 포함 경로가 달라 역관계로 다루지 않는다.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");

/** 역관계 쌍 — [정방향, 역방향]. 어휘 정의(skeleton)의 owl:inverseOf 선언과 같아야 한다 */
export const INVERSE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["delegates", "delegationOf"],
  ["regulates", "regulatedBy"],
];

/**
 * 한 방향만 맞추는 쌍 — [정방향, 역방향]. 정방향 간선에는 역방향이 있어야 하지만 그 반대는 요구하지 않는다.
 * 문서의 법령 근거(legalBasis)는 검토를 거쳐 문서 본문에 실리는 목록이다. 조문 쪽에만 적힌
 * legalBasisOf 는 검토되지 않은 느슨한 연결이 섞여 있어, 문서의 법령 근거로 자동 승격하지 않는다.
 */
export const FORWARD_ONLY_PAIRS: ReadonlyArray<readonly [string, string]> = [["legalBasis", "legalBasisOf"]];

interface NodeFile {
  path: string;
  text: string;
  json: Record<string, unknown>;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".jsonld") ? [p] : [];
  });
}

function refs(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list
    .map((v) => (typeof v === "string" ? v : (v as { "@id"?: string } | null)?.["@id"]))
    .filter((v): v is string => typeof v === "string");
}

/** 원본 서식을 지키며 배열 속성에 값을 더한다. 서식을 지킬 수 없으면 표준 서식으로 다시 쓴다 */
function addToArrayProperty(text: string, key: string, additions: string[]): string {
  const expected = JSON.parse(text) as Record<string, unknown>;
  const current = expected[key];
  expected[key] = [...(Array.isArray(current) ? current : current === undefined ? [] : [current]), ...additions];
  const quoted = additions.map((a) => JSON.stringify(a));
  let edited: string | null = null;

  const keyMatch = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(text);
  if (keyMatch && Array.isArray(current)) {
    const open = keyMatch.index + keyMatch[0].length;
    const close = text.indexOf("]", open); // 값이 문자열 IRI 뿐이라 중첩 대괄호가 없다
    const inner = text.slice(open, close);
    if (inner.trim() === "") {
      edited = text.slice(0, open) + quoted.join(", ") + text.slice(close);
    } else if (inner.includes("\n")) {
      const indent = /\n([ \t]*)\S[^\n]*\s*$/.exec(inner)?.[1] ?? "    ";
      const body = inner.replace(/\s*$/, "");
      const tail = inner.slice(body.length);
      edited = text.slice(0, open) + body + quoted.map((q) => `,\n${indent}${q}`).join("") + tail + text.slice(close);
    } else {
      edited = text.slice(0, open) + inner.replace(/\s*$/, "") + quoted.map((q) => `, ${q}`).join("") + text.slice(close);
    }
  } else if (current === undefined) {
    const idLine = /\n([ \t]*)"@id"\s*:\s*"[^"\n]*",?[ \t]*(?=\n)/.exec(text);
    if (idLine) {
      const at = idLine.index + idLine[0].length;
      const lineWithComma = idLine[0].trimEnd().endsWith(",") ? "" : ",";
      edited = `${text.slice(0, at)}${lineWithComma}\n${idLine[1]}"${key}": [${quoted.join(", ")}]${lineWithComma ? "" : ","}${text.slice(at)}`;
    }
  }

  if (edited !== null) {
    try {
      if (JSON.stringify(JSON.parse(edited)) === JSON.stringify(reorder(expected, JSON.parse(edited) as Record<string, unknown>))) return edited;
    } catch {
      // 아래에서 표준 서식으로 다시 쓴다
    }
  }
  return `${JSON.stringify(expected, null, 2)}\n`;
}

/** 키 순서만 다른 경우를 같다고 보기 위해, 기준 객체의 키 순서로 맞춘다 */
function reorder(source: Record<string, unknown>, order: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(order)) if (k in source) out[k] = source[k];
  for (const k of Object.keys(source)) if (!(k in out)) out[k] = source[k];
  return out;
}

export interface MissingEdge {
  subject: string;
  predicate: string;
  object: string;
}

/** 빠진 역방향 간선을 모은다 — (object) -[반대 술어]-> (subject) 형태로 돌려준다 */
export function findMissingInverseEdges(nodes: Map<string, Record<string, unknown>>): MissingEdge[] {
  const missing: MissingEdge[] = [];
  const directions: Array<readonly [string, string]> = [
    ...INVERSE_PAIRS.flatMap(([f, b]) => [[f, b], [b, f]] as const),
    ...FORWARD_ONLY_PAIRS,
  ];
  {
    for (const [a, b] of directions) {
      for (const [id, node] of nodes) {
        for (const target of refs(node[a])) {
          const targetNode = nodes.get(target);
          if (!targetNode) continue; // 그래프 밖 대상(노드 파일 없음)은 반대쪽을 적을 곳이 없다
          if (!refs(targetNode[b]).includes(id)) missing.push({ subject: target, predicate: b, object: id });
        }
      }
    }
  }
  return missing;
}

function loadNodes(): Map<string, NodeFile> {
  const files = new Map<string, NodeFile>();
  for (const path of walk(NODES_DIR)) {
    const text = readFileSync(path, "utf8");
    const json = JSON.parse(text) as Record<string, unknown>;
    const id = json["@id"];
    if (typeof id === "string") files.set(id, { path, text, json });
  }
  return files;
}

function main(): void {
  const check = process.argv.includes("--check");
  const files = loadNodes();
  const missing = findMissingInverseEdges(new Map([...files].map(([id, f]) => [id, f.json])));
  const byPredicate: Record<string, number> = {};
  for (const m of missing) byPredicate[m.predicate] = (byPredicate[m.predicate] ?? 0) + 1;

  if (check) {
    if (missing.length === 0) {
      console.log(`✅ 역관계 일치 — ${INVERSE_PAIRS.map((p) => p.join("↔")).join(", ")}, ${FORWARD_ONLY_PAIRS.map((p) => p.join("→")).join(", ")} (노드 ${files.size}개)`);
      return;
    }
    console.error(`❌ 한쪽에만 적힌 역관계 ${missing.length}건 ${JSON.stringify(byPredicate)}`);
    for (const m of missing.slice(0, 10)) console.error(`   ${m.subject} 에 ${m.predicate} → ${m.object} 없음`);
    console.error("   채우기: tsx scripts/ontology/materialize-inverse-edges.ts");
    process.exit(1);
  }

  const grouped = new Map<string, Map<string, string[]>>();
  for (const m of missing) {
    const perKey = grouped.get(m.subject) ?? new Map<string, string[]>();
    const list = perKey.get(m.predicate) ?? [];
    if (!list.includes(m.object)) list.push(m.object);
    perKey.set(m.predicate, list);
    grouped.set(m.subject, perKey);
  }
  for (const [id, perKey] of grouped) {
    const file = files.get(id);
    if (!file) continue;
    let text = file.text;
    for (const [key, additions] of perKey) text = addToArrayProperty(text, key, additions.sort());
    writeFileSync(file.path, text);
  }
  console.log(`채움: ${missing.length}건 ${JSON.stringify(byPredicate)} · 파일 ${grouped.size}개`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
