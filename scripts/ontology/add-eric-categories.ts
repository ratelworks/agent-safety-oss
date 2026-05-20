#!/usr/bin/env tsx
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const D = resolve(__dirname, "..", "..", "src/ontology/graph/nodes/controls");

const ERIC = [
  { id: "control:eric_eliminate",     label: "Eliminate (제거)",     order: 1, description: "위험요인을 근본적으로 제거. 작업 회피·자동화·구조 변경." },
  { id: "control:eric_substitute",    label: "Substitute (대체)",    order: 2, description: "위험요인을 덜 위험한 것으로 대체. 저독성 물질·저위험 공법·안전 장비." },
  { id: "control:eric_engineering",   label: "Engineering (공학적)", order: 3, description: "공학적 통제 (방호장치·격리·인터록·환기·차폐 등). 작업자 행동 의존 X." },
  { id: "control:eric_administrative",label: "Administrative (관리적)", order: 4, description: "절차·교육·작업허가·표지·점검 등 관리 통제. 작업자 행동 의존." },
  { id: "control:eric_ppe",           label: "PPE (개인보호구)",     order: 5, description: "최후의 수단. 안전모·안전대·안전화·보호장갑·호흡기 등 개인보호구." },
];

async function main() {
  const FETCHED = "2026-04-28";
  for (const e of ERIC) {
    const slug = e.id.replace("control:", "");
    await writeFile(resolve(D, `${slug}.jsonld`), JSON.stringify({
      "@context": "../../context.jsonld",
      "@id": e.id,
      "@type": "Control",
      label: e.label,
      description: e.description,
      verificationStatus: "verified",
      _meta: {
        publishedBy: "라텔웍스 + 황룡건설(주)",
        sourceRef: "ERIC-PP 위계 (NIOSH·KOSHA 표준)",
        fetchedAt: FETCHED,
        hierarchyOrder: e.order,
        category: "eric_pp_hierarchy",
      },
    }, null, 2) + "\n");
    console.log(`  ✓ ${e.id}`);
  }
}
main().catch(console.error);
