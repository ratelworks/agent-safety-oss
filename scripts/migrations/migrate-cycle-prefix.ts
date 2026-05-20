#!/usr/bin/env tsx
/**
 * cycle: prefix → cyc: prefix 마이그레이션
 *
 * Why: predicate `safety:cycle` 와 prefix 충돌 회피
 *   - predicate: cycle ({@id: safety:cycle, @type: @id}) — 의미 변경 X
 *   - prefix: cyc: → https://safety.ratelworks.org/cycle/
 *
 * 변경 대상:
 *   1. cycles/ 폴더 9개 노드 @id: cycle:weekly → cyc:weekly
 *   2. 모든 노드에서 string value 가 "cycle:..." 인 경우 → "cyc:..."
 *
 * 코드(src/tools, src/lib) 영향: cycle: prefix 매칭 없음 (검증 완료)
 */
import { readFile, writeFile, readdir, stat, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src/ontology/graph/nodes");
const CYCLES_DIR = resolve(NODES, "cycles");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const f of await readdir(dir)) {
    const p = resolve(dir, f);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else if (f.endsWith(".jsonld")) out.push(p);
  }
  return out;
}

// 재귀: 모든 string value 가 "cycle:..." 인 경우 "cyc:..." 로 치환
function replaceCycleIri(obj: any): any {
  if (typeof obj === "string") {
    if (obj.startsWith("cycle:")) return obj.replace(/^cycle:/, "cyc:");
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(replaceCycleIri);
  if (obj === null || typeof obj !== "object") return obj;
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = replaceCycleIri(v);
  }
  return out;
}

async function main() {
  const paths = await walk(NODES);
  let updated = 0, replaced = 0;
  for (const p of paths) {
    const text = await readFile(p, "utf-8");
    if (!text.includes("cycle:")) continue;
    const node = JSON.parse(text);
    const before = JSON.stringify(node);
    const after = replaceCycleIri(node);
    const afterStr = JSON.stringify(after);
    if (before !== afterStr) {
      // 카운트
      const matches = (before.match(/"cycle:[a-z_]+"/g) ?? []).length;
      replaced += matches;
      await writeFile(p, JSON.stringify(after, null, 2) + "\n", "utf-8");
      updated++;
    }
  }
  console.log(`[done] ${updated}개 노드 / ${replaced}건 cycle: → cyc: 치환`);

  // cycles 폴더 노드들의 @id 도 변경됐으니 OK
  // 도구 코드 영향 없음 (cycle: prefix 미사용 확인 완료)
}

main().catch((e) => { console.error(e); process.exit(1); });
