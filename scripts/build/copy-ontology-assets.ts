#!/usr/bin/env tsx
/**
 * copy-ontology-assets.ts
 *
 * tsc 는 .json 만 resolveJsonModule 로 번들하고 .md 파일은 build/ 에 복사하지
 * 않는다. 본 스크립트는 src/ontology/ 의 자산 파일(MD·JSON·DocLang 아카이브·양식)을 build/ontology/ 로
 * 복사해서 런타임 로더가 찾을 수 있게 한다. 원본(src)에서 지운 자산이 build/ 에 남아 패키지에 섞이지 않도록,
 * 같은 확장자의 build/ 쪽 파일 중 원본에 없는 것은 지운다.
 */

import { readdir, mkdir, copyFile, stat, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SRC_DIR = resolve(ROOT, "src", "ontology");
const DEST_DIR = resolve(ROOT, "build", "ontology");

/** 복사하는 자산 확장자 — KOSHA Guide 원본은 .dclx(DocLang 아카이브) */
const ASSET_EXTENSIONS = [".md", ".json", ".jsonld", ".dclx", ".hwp", ".hwpx", ".pdf", ".xlsx"];
const isAsset = (name: string): boolean => ASSET_EXTENSIONS.some((ext) => name.endsWith(ext));

/** build/ 쪽에 남은, 원본에 없는 자산을 지운다 */
async function pruneStale(src: string, dest: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dest, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    const inSrc = await stat(srcPath).then(() => true, () => false);
    if (entry.isDirectory()) {
      if (inSrc) removed += await pruneStale(srcPath, destPath);
    } else if (isAsset(entry.name) && !inSrc) {
      await rm(destPath);
      removed += 1;
    }
  }
  return removed;
}

// 자산 파일 복사 (가이드 entity 는 .json, 법령·KRAS는 .md, KOSHA Guide 원본은 .dclx, 내장 공식 양식은 HWP·PDF·XLSX)
async function copyMdFiles(src: string, dest: string): Promise<number> {
  const entries = await readdir(src, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      count += await copyMdFiles(srcPath, destPath);
    } else if (isAsset(entry.name)) {
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
  const removed = await pruneStale(SRC_DIR, DEST_DIR);
  console.log(`[copy-ontology] copied ${count} asset files → build/ontology/${removed ? ` · removed ${removed} stale` : ""}`);
})();
