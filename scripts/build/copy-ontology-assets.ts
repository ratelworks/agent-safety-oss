#!/usr/bin/env tsx
/**
 * copy-ontology-assets.ts
 *
 * tsc 는 .json 만 resolveJsonModule 로 번들하고 .md 파일은 build/ 에 복사하지
 * 않는다. 본 스크립트는 src/ontology/ 의 MD 파일을 build/ontology/ 로 복사해서
 * 런타임 로더가 찾을 수 있게 한다.
 */

import { readdir, mkdir, copyFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SRC_DIR = resolve(ROOT, "src", "ontology");
const DEST_DIR = resolve(ROOT, "build", "ontology");

// .md 와 .json 모두 복사 (가이드 entity 는 .json, 법령·KRAS는 .md)
async function copyMdFiles(src: string, dest: string): Promise<number> {
  const entries = await readdir(src, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      count += await copyMdFiles(srcPath, destPath);
    } else if (
      entry.name.endsWith(".md") ||
      entry.name.endsWith(".json") ||
      entry.name.endsWith(".jsonld") ||
      // 내장 공식 양식 (v0.3 신규) — HWP·PDF·XLSX
      entry.name.endsWith(".hwp") ||
      entry.name.endsWith(".hwpx") ||
      entry.name.endsWith(".pdf") ||
      entry.name.endsWith(".xlsx")
    ) {
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
      count += 1;
    }
  }
  return count;
}

(async () => {
  try {
    await stat(SRC_DIR);
  } catch {
    console.log("[copy-ontology] src/ontology not found, skipping");
    return;
  }
  const count = await copyMdFiles(SRC_DIR, DEST_DIR);
  console.log(`[copy-ontology] copied ${count} .md files → build/ontology/`);
})();
