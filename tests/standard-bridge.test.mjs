// ─────────────────────────────────────────────────────────────────────────────
// standard-bridge.test.mjs — 공공 공종 코드 대응표(src/ontology/standard-bridge.json)가 이 도구의 실제 노드를 가리키는가.
//
// 대응표는 다른 도구가 국토교통부 건설정보분류체계 공종 코드(W)로 이 도구의 작업을 찾는 길이다.
// 가리키는 노드가 없거나(이름이 바뀜) 코드 꼴이 틀리면 그 길이 조용히 끊기므로 여기서 막는다.
// 끊긴 경우를 실제로 잡는지도 본다 — 없는 노드·중첩 id 를 넣은 사본으로 검사가 실패해야 한다.
// 코드가 고시에 실제로 있는지·이름이 같은지는 이 도구가 고시 사본을 들고 있지 않아 여기서 보지 않는다(쓰는 쪽의 통합 검사 몫).
// ─────────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ───── 상수 ─────
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRIDGE = join(ROOT, "src", "ontology", "standard-bridge.json");
const NODES = join(ROOT, "src", "ontology", "graph", "nodes");
const CODE_RE = /^W\d{2,6}$/;
const MATCHES = new Set(["closeMatch", "broadMatch", "narrowMatch", "relatedMatch"]);

/** 대응표가 가리킬 수 있는 노드 폴더 — 최상위 공종·세부 작업만(작업 단계 같은 중첩 id 는 대응 대상이 아니다) */
const BRIDGEABLE_DIRS = ["work_types", "subtasks"];

/** 그 폴더 파일들의 최상위 @id */
function nodeIds() {
  const ids = new Set();
  for (const dir of BRIDGEABLE_DIRS) {
    for (const f of readdirSync(join(NODES, dir)).filter((x) => x.endsWith(".jsonld"))) {
      const id = JSON.parse(readFileSync(join(NODES, dir, f), "utf8"))["@id"];
      if (id) ids.add(id);
    }
  }
  return ids;
}

/** 대응표 검사 — 문제 목록을 돌려준다(빈 목록 = 통과) */
function problems(bridge, ids) {
  const out = [];
  if (!bridge.standard?.notice) out.push("standard.notice 없음");
  if (!Array.isArray(bridge.entries) || bridge.entries.length === 0) out.push("entries 비어 있음");
  for (const e of bridge.entries ?? []) {
    if (!ids.has(e.node)) out.push(`없는 노드(최상위 공종·세부 작업이 아님): ${e.node}`);
    if (!MATCHES.has(e.match)) out.push(`허용하지 않는 대응 관계: ${e.node} ${e.match}`);
    if (!Array.isArray(e.codes) || e.codes.length === 0) out.push(`코드 없음: ${e.node}`);
    for (const c of e.codes ?? []) {
      if (!CODE_RE.test(c.code)) out.push(`코드 꼴 틀림: ${e.node} ${c.code}`);
      if (!c.label) out.push(`코드 이름 없음: ${e.node} ${c.code}`);
    }
  }
  return out;
}

const bridge = JSON.parse(readFileSync(BRIDGE, "utf8"));
const ids = nodeIds();

test("대응표의 모든 노드가 실제로 있고 코드·관계 꼴이 맞다", () => {
  assert.deepEqual(problems(bridge, ids), []);
});

test("끊긴 대응을 실제로 잡는다 — 없는 노드를 넣은 사본은 실패", () => {
  const broken = structuredClone(bridge);
  broken.entries[0] = { ...broken.entries[0], node: broken.entries[0].node + "_없음" };
  assert.ok(problems(broken, ids).some((p) => p.startsWith("없는 노드")));
});

test("같음(exactMatch)은 쓰지 않는다", () => {
  const broken = structuredClone(bridge);
  broken.entries[0] = { ...broken.entries[0], match: "exactMatch" };
  assert.ok(problems(broken, ids).some((p) => p.startsWith("허용하지 않는")));
});

test("작업 단계 같은 중첩 id 는 대응 대상이 아니다", () => {
  const nested = [...readFileSync(join(NODES, BRIDGEABLE_DIRS[0], readdirSync(join(NODES, BRIDGEABLE_DIRS[0])).find((f) => f.endsWith(".jsonld"))), "utf8").matchAll(/"@id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const inner = nested.find((id) => !ids.has(id));
  const broken = structuredClone(bridge);
  broken.entries[0] = { ...broken.entries[0], node: inner ?? "workstep:없음/1" };
  assert.ok(problems(broken, ids).some((p) => p.startsWith("없는 노드")));
});
