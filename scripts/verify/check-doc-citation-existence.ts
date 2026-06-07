#!/usr/bin/env tsx
/**
 * check-doc-citation-existence.ts
 *
 * README/docs 가 인용한 **번들 법령 조문**이 실제 번들에 수록됐는지 검증하는 게이트.
 * 기존 check:doc-sync 는 평문 수치(도구 수·버전)만 보아 "조문 실재" 갭을 못 잡는다.
 * 예: README 가 "산안법 §54 자동 인용" 이라 광고하나 §54 가 번들 발췌에 미수록이면,
 *     실제로는 인용 불가 → 본 게이트가 exit 1 로 차단 (publish·CI).
 *
 * 판정:
 *   - 번들 법령(guessLawCodeFromRef 로 식별)의 미수록 조문 인용 → 위반(exit 1)
 *   - 번들 외 법령(소방·환경 등 inBundle:false) → 대조 보류(통과). 발췌 번들 특성상
 *     번들 외 인용은 정상이므로 false positive 방지.
 *
 * 해소: 위반 조문을 src/ontology/safety-laws/*.md 에 법제처 원문 대조 후 추가하거나,
 *       문서에서 번들 보유 조문으로 수정.
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listLaws,
  extractAllArticles,
  guessLawCodeFromRef,
} from "../../src/lib/safety-laws-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// 법령명 + 조문(나열 포함) 추출
const ART = String.raw`(?:제\s*\d+\s*조(?:\s*의\s*\d+)?|§\s*\d+(?:\s*의\s*\d+)?)`;
const ARTLIST = `${ART}(?:\\s*[·ㆍ,]\\s*${ART})*`;
const LAWNAME = String.raw`[가-힣][가-힣·ㆍ\s]{0,20}(?:시행령|시행규칙|법|규칙|고시|규정)`;
const BLOCK_RE = new RegExp(`(${LAWNAME})\\s*(${ARTLIST})`, "g");
const ONE_RE = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|§\s*(\d+)(?:\s*의\s*(\d+))?/g;

const bundle = new Map<string, Set<string>>();
const shortNames = new Map<string, string>();
for (const law of listLaws()) {
  const arts = await extractAllArticles(law.code);
  bundle.set(
    law.code,
    new Set(arts.map((a) => a.ref)),
  );
  shortNames.set(law.code, law.shortName);
}

const files = ["README.md"];
for (const f of await readdir(join(ROOT, "docs"))) {
  if (f.endsWith(".md")) files.push(`docs/${f}`);
}

interface Missing {
  rel: string;
  lawName: string;
  ref: string;
}
const missing: Missing[] = [];
let okCount = 0;

for (const rel of files) {
  let text: string;
  try {
    text = await readFile(join(ROOT, rel), "utf8");
  } catch {
    continue;
  }
  for (const bm of text.matchAll(BLOCK_RE)) {
    const lawPart = bm[1].trim().replace(/\s+/g, " ");
    const code = guessLawCodeFromRef(lawPart);
    for (const am of bm[2].matchAll(ONE_RE)) {
      const n = am[1] ?? am[3];
      const sub = am[2] ?? am[4];
      if (!n) continue;
      const ref = sub ? `§${n}의${sub}` : `§${n}`;
      if (!code) continue; // 번들 외 법령 — 대조 보류(통과)
      if (bundle.get(code)?.has(ref)) okCount += 1;
      else missing.push({ rel, lawName: shortNames.get(code) ?? code, ref });
    }
  }
}

const uniq = new Map<string, Set<string>>();
for (const m of missing) {
  const k = `${m.lawName} ${m.ref}`;
  if (!uniq.has(k)) uniq.set(k, new Set());
  uniq.get(k)!.add(m.rel);
}

if (uniq.size === 0) {
  console.log(
    `[doc-citation] OK ✅ — 번들 조문 인용 ${okCount}건 모두 실재 (스캔 ${files.length}개 문서)`,
  );
  process.exit(0);
}

console.error(
  `[doc-citation] ❌ 번들 미수록 조문 인용 ${uniq.size}종 — README/docs 가 인용했으나 번들에 없는 조문:`,
);
for (const [k, fs] of [...uniq].sort()) {
  console.error(`  - ${k.padEnd(20)} ← ${[...fs].join(", ")}`);
}
console.error(
  `\n해소: 해당 조문을 src/ontology/safety-laws/*.md 에 법제처 원문 대조 후 추가하거나, 문서에서 번들 보유 조문으로 수정.`,
);
process.exit(1);
