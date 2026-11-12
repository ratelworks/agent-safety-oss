#!/usr/bin/env tsx
/**
 * derive-hazard-articles.ts — 유해요인 → 조문 연결을 공종 자료에서 끌어낸다
 *
 * 공종 단계의 감소대책에는 근거 조문이 붙어 있다. 같은 유해요인의 대책이 여러 공종에서
 * 같은 조문을 근거로 들면, 그 조문은 그 유해요인의 대표 조문이다.
 *   위험요인 --hasHazard--> 유해요인,  위험요인 --mitigatedBy--> 대책 --basisArticle--> 조문
 *   ⇒ 유해요인 --regulatedBy--> 조문
 *
 * 손으로 고르지 않는다. 기준에 든 조문만 유해요인 노드의 regulatedBy 에 더하고,
 * 끌어낸 것임을 _meta.derivedRegulatedBy 와 _meta.linkBasis 에 적는다 (기존 연결은 그대로 둔다).
 *
 * 사용: npx tsx scripts/ontology/derive-hazard-articles.ts [--check]
 *   --check  노드가 지금 기준과 같은지만 확인 (다르면 exit 1)
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
/** 그 유해요인이 나오는 공종 가운데 이 비율 이상이 근거로 든 조문만 */
const MIN_SHARE = 0.2;
/** 그리고 최소 이만큼의 공종이 근거로 든 조문만 */
const MIN_WORKS = 3;
const CHECK = process.argv.includes("--check");

interface Measure { basis?: { basisArticle?: string } }
interface Subtask {
  title: string;
  steps: { stepHazards?: { hasHazard?: string; risks?: { measures?: Measure[] }[] }[] }[];
}
type HazardNode = Record<string, unknown> & { "@id": string; regulatedBy?: string[]; _meta?: Record<string, unknown> };

/** 조문 주소의 번호로 정렬 ("art:기준규칙:619의2" → [619, 2]) */
function articleKey(iri: string): number[] {
  return (iri.split(":").pop() ?? "").split("의").map(Number);
}

async function main(): Promise<void> {
  const worksOf = new Map<string, Set<string>>();
  const cited = new Map<string, Map<string, Set<string>>>();
  for (const f of await readdir(resolve(NODES, "subtasks"))) {
    if (!f.endsWith(".jsonld")) continue;
    const sub = JSON.parse(await readFile(resolve(NODES, "subtasks", f), "utf-8")) as Subtask;
    for (const step of sub.steps) {
      for (const slot of step.stepHazards ?? []) {
        if (!slot.hasHazard) continue;
        if (!worksOf.has(slot.hasHazard)) worksOf.set(slot.hasHazard, new Set());
        worksOf.get(slot.hasHazard)?.add(sub.title);
        for (const risk of slot.risks ?? []) {
          for (const m of risk.measures ?? []) {
            const art = m.basis?.basisArticle;
            if (!art) continue;
            if (!cited.has(slot.hasHazard)) cited.set(slot.hasHazard, new Map());
            const byArt = cited.get(slot.hasHazard) as Map<string, Set<string>>;
            if (!byArt.has(art)) byArt.set(art, new Set());
            byArt.get(art)?.add(sub.title);
          }
        }
      }
    }
  }

  let changed = 0;
  let total = 0;
  for (const f of (await readdir(resolve(NODES, "hazards"))).sort()) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(NODES, "hazards", f);
    const raw = await readFile(path, "utf-8");
    const node = JSON.parse(raw) as HazardNode;
    const works = worksOf.get(node["@id"])?.size ?? 0;
    const need = Math.max(MIN_WORKS, Math.ceil(works * MIN_SHARE));
    const derived = [...(cited.get(node["@id"])?.entries() ?? [])]
      .filter(([, w]) => w.size >= need)
      .map(([art]) => art)
      .sort((a, b) => {
        const [x, y] = [articleKey(a), articleKey(b)];
        return (x[0] ?? 0) - (y[0] ?? 0) || (x[1] ?? 0) - (y[1] ?? 0);
      });
    const meta = { ...(node._meta ?? {}) };
    const before = (meta.derivedRegulatedBy as string[] | undefined) ?? [];
    // 예전에 끌어낸 것은 걷어내고 지금 기준으로 다시 넣는다 — 사람이 넣은 연결은 그대로
    const curated = (node.regulatedBy ?? []).filter((a) => !before.includes(a));
    const merged = [...curated, ...derived.filter((a) => !curated.includes(a))];
    const added = derived.filter((a) => !curated.includes(a));
    if (added.length > 0) {
      meta.derivedRegulatedBy = added;
      meta.derivedRegulatedByNote = `공종 단계의 감소대책이 근거로 든 조문에서 끌어낸 연결 — 이 유해요인이 나오는 공종 ${works}개 중 ${need}개 이상이 근거로 든 조문`;
      meta.linkBasis = { ...((meta.linkBasis as Record<string, string> | undefined) ?? {}), derivedRegulatedBy: "derived" };
    } else {
      delete meta.derivedRegulatedBy;
      delete meta.derivedRegulatedByNote;
    }
    const next: HazardNode = { ...node, ...(merged.length > 0 ? { regulatedBy: merged } : {}), _meta: meta };
    const out = `${JSON.stringify(next, null, 2)}\n`;
    total += added.length;
    // 내용이 같으면 쓰지 않는다 (줄바꿈 모양만 다른 파일을 건드리지 않게)
    if (JSON.stringify(next) !== JSON.stringify(node)) {
      changed += 1;
      if (!CHECK) await writeFile(path, out, "utf-8");
    }
    if (added.length > 0) console.log(`${node["@id"]} (공종 ${works}개, 기준 ${need}개↑): +${added.map((a) => a.split(":").slice(1).join(":")).join(", ")}`);
  }
  console.log(`\n끌어낸 연결 ${total}개 · ${CHECK ? "다른" : "바뀐"} 노드 ${changed}개`);
  if (CHECK && changed > 0) {
    console.error("❌ 유해요인 노드가 지금 기준과 다르다 — npx tsx scripts/ontology/derive-hazard-articles.ts 로 다시 만든다");
    process.exit(1);
  }
}

void main();
