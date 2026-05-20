#!/usr/bin/env tsx
/**
 * Phase A-2 Step 1: KOSHA 자료실 5개 facet 코드 fetch → JSON 저장
 * 다음 단계에서 이 JSON을 읽어 그래프 노드로 변환
 */
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getFacetCodes, FACET_GROUP_IDS, SHP_CODE_MAP } from "../../src/lib/kosha-archive-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "src/ontology/kosha-archive-facets.json");

async function main() {
  const result: Record<string, any> = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: "https://portal.kosha.or.kr/archive/cent-archive/master-arch",
    license: "공공누리 출처표시 (KOSHA)",
    shpCodes: SHP_CODE_MAP,
    facetGroups: {} as Record<string, any>,
  };

  for (const [ctgr, meta] of Object.entries(FACET_GROUP_IDS)) {
    console.log(`fetching ${ctgr} (${meta.ko})...`);
    const codes = await getFacetCodes(meta.groupId);
    result.facetGroups[ctgr] = {
      groupId: meta.groupId,
      ko: meta.ko,
      count: codes.length,
      codes,
    };
    console.log(`  → ${codes.length}개`);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(result, null, 2), "utf-8");
  const total = Object.values(result.facetGroups).reduce((s: number, g: any) => s + g.count, 0);
  console.log(`\n[done] 5 그룹 / 총 ${total}개 facet → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
