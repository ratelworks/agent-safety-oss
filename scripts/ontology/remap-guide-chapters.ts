#!/usr/bin/env tsx
/**
 * remap-guide-chapters.ts — KOSHA Guide 노드의 relatedChapter 를 가이드 원문 인용으로 다시 잇는다
 *
 * relatedChapter 는 가이드 본문의 "산업안전보건기준에 관한 규칙 제2편 제1장 제9절 제7관(…)" 같은 인용에서 왔다.
 * 예전에는 장 번호만으로 이어 편이 다른 장(제3편 제1장 관리대상 유해물질 …)에 잘못 이어졌다.
 * 인용 글(rawCitation)의 편·장·절·관·속으로 구조 노드를 다시 찾고, 하나로 정해지지 않는 연결은 뺀다.
 *
 * 사용: tsx scripts/ontology/remap-guide-chapters.ts [--dry-run]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStructureIndex, resolveStructureCitation } from "../lib/law-structure-citation.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES = resolve(__dirname, "..", "..", "src", "ontology", "graph", "nodes");
const GUIDES = resolve(NODES, "documents", "guides");
const CHAPTERS = resolve(NODES, "chapters");

interface Related {
  chapterNodeId: string;
  law: string;
  chapterTitle: string;
  source?: string;
  rawCitation?: string;
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const index = buildStructureIndex(CHAPTERS);
  const exists = new Set([...index.values()].flat().map((u) => u.id));
  let kept = 0;
  let moved = 0;
  let dropped = 0;
  const droppedRows: string[] = [];
  for (const f of readdirSync(GUIDES).filter((x) => x.endsWith(".jsonld")).sort()) {
    const path = join(GUIDES, f);
    const raw = readFileSync(path, "utf8");
    const node = JSON.parse(raw) as { relatedChapter?: Related[] };
    if (!Array.isArray(node.relatedChapter) || node.relatedChapter.length === 0) continue;
    const out: Related[] = [];
    for (const r of node.relatedChapter) {
      // 이미 있는 구조 노드를 가리키고 법령에 편이 없으면 그대로 둔다
      const old = r.chapterNodeId.match(/^chapter:([^:]+):(\d+)장$/);
      if (exists.has(r.chapterNodeId) && !(old && [...(index.get(r.law) ?? [])].some((u) => u.path[0]?.l === "편"))) {
        out.push(r);
        kept += 1;
        continue;
      }
      const num = old ? Number(old[2]) : NaN;
      const unit = Number.isFinite(num) ? resolveStructureCitation(index, r.law, r.rawCitation ?? "", num) : null;
      if (!unit) {
        dropped += 1;
        droppedRows.push(`${f} ${r.chapterNodeId} — ${(r.rawCitation ?? "").slice(0, 80)}`);
        continue;
      }
      out.push({ ...r, chapterNodeId: unit.id, chapterTitle: unit.title });
      moved += 1;
    }
    // 같은 구조 노드로 모인 연결은 하나만
    const unique = out.filter((r, i) => out.findIndex((x) => x.chapterNodeId === r.chapterNodeId) === i);
    const next = { ...node } as Record<string, unknown>;
    if (unique.length) next.relatedChapter = unique;
    else delete next.relatedChapter;
    const body = JSON.stringify(next, null, 2) + (raw.endsWith("\n") ? "\n" : "");
    if (body !== raw && !dryRun) writeFileSync(path, body, "utf8");
  }
  console.log(`가이드 장 연결 — 그대로 ${kept} · 다시 이음 ${moved} · 하나로 정해지지 않아 뺌 ${dropped}${dryRun ? " (dry-run)" : ""}`);
  for (const row of droppedRows) console.log(`  뺌: ${row}`);
}

main();
