#!/usr/bin/env tsx
/**
 * sync-kosha-data.ts
 *
 * KOSHA 파일 데이터셋을 data.go.kr 에서 받아 번들 JSON 을 사용자 로컬에 갱신한다.
 * - 15140383 사망사고 고위험요인(SIF) → src/ontology/sif-archive.json
 * - 15087828 건설업 공종별 세부공정 → src/ontology/construction-subtasks.json
 * - 15116595 KOSHA Guide 목록 → src/ontology/kosha-guide-map.json
 *
 * 라이선스 설계:
 *   이 스크립트는 원본 데이터의 **필드명·값·순서를 변경하지 않고 그대로** 저장한다.
 *   (공공누리 변경금지 조건 준수)
 *   결과 JSON 은 사용자 PC 에만 존재하며 npm 패키지 재배포 대상이 아니다.
 *
 * 사용:
 *   1) data.go.kr 에서 "파일데이터 받기" 버튼으로 원본 XLSX/CSV 다운로드
 *   2) 아래 경로에 배치:
 *        ./data/sif-archive.xlsx            (15140383)
 *        ./data/construction-subtasks.xlsx  (15087828)
 *        ./data/kosha-guide.csv             (15116595)
 *   3) npm i -D xlsx        (XLSX 파싱 라이브러리 — 선택 의존성)
 *   4) npx tsx scripts/sync/sync-kosha-data.ts
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DATA_DIR = resolve(ROOT, "data");
const TAXONOMY_DIR = resolve(ROOT, "src", "ontology");

interface SyncTarget {
  label: string;
  input: string;
  output: string;
  dataId: string;
  sourceUrl: string;
  arrayKey: string;
  source: string;
}

const TARGETS: Record<"sif" | "subtasks" | "guide", SyncTarget> = {
  sif: {
    label: "SIF 아카이브 (15140383)",
    input: resolve(DATA_DIR, "sif-archive.xlsx"),
    output: resolve(TAXONOMY_DIR, "sif-archive.json"),
    dataId: "15140383",
    sourceUrl: "https://www.data.go.kr/data/15140383/fileData.do",
    arrayKey: "patterns",
    source: "한국산업안전보건공단 사망사고 고위험요인(SIF) 아카이브 (data.go.kr)",
  },
  subtasks: {
    label: "건설업 공종별 세부공정 (15087828)",
    input: resolve(DATA_DIR, "construction-subtasks.xlsx"),
    output: resolve(TAXONOMY_DIR, "construction-subtasks.json"),
    dataId: "15087828",
    sourceUrl: "https://www.data.go.kr/data/15087828/fileData.do",
    arrayKey: "mainCategories",
    source: "한국산업안전보건공단 건설업 공종별 세부공정 목록 (data.go.kr)",
  },
  guide: {
    label: "KOSHA Guide 목록 (15116595)",
    input: resolve(DATA_DIR, "kosha-guide.csv"),
    output: resolve(TAXONOMY_DIR, "kosha-guide-map.json"),
    dataId: "15116595",
    sourceUrl: "https://www.data.go.kr/data/15116595/fileData.do",
    arrayKey: "guides",
    source: "한국산업안전보건공단 KOSHA Guide 목록 (data.go.kr)",
  },
};

// ── 유틸 ──
type Row = Record<string, unknown>;
type Loader = (path: string) => Promise<Row[]>;
type Transformer = (rows: Row[]) => unknown[];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

interface XlsxModule {
  read: (buf: Buffer, opts: { type: string }) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (sheet: unknown, opts: { defval: string }) => Row[];
  };
}

async function loadXlsx(path: string): Promise<Row[]> {
  try {
    // xlsx 는 sync 실행 시에만 필요한 선택 의존성 — 타입 선언 없이 동적 import
    const modName = "xlsx";
    const mod = (await import(modName)) as XlsxModule;
    const buf = await readFile(path);
    const wb = mod.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    return mod.utils.sheet_to_json(sheet, { defval: "" });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "xlsx 패키지가 설치되지 않았다. 설치: npm i -D xlsx (sync 실행 시에만 필요)",
      );
    }
    throw err;
  }
}

async function loadCsv(path: string): Promise<Row[]> {
  const raw = await readFile(path, "utf8");
  const [headerLine, ...rows] = raw.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return rows.map((r) => {
    const cells = splitCsvRow(r);
    const obj: Row = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });
}

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of row) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ── 파일별 변환 (원본 헤더 그대로 유지) ──

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function transformSif(rows: Row[]): unknown[] {
  // KOGL 변경금지 준수: 원본 행을 통째로 records 배열에 저장.
  // analyze_construction_work_risks 는 optional 보조 키(workType, hazardCode,
  // rootCauses, controls) 를 사용하지만, 원본에 없으면 빈 문자열로 둔다.
  return rows.map((r) => ({
    original: r,
    workType: str(r["고위험작업"] ?? r["공종"]),
    hazardCode: str(r["재해유형"]),
    rootCauses: splitList(str(r["재해유발요인"] ?? r["원인"])),
    controls: splitList(str(r["저감대책"] ?? r["대책"])),
  }));
}

function transformSubtasks(rows: Row[]): unknown[] {
  // 주공종별 grouping — 순서는 원본 순서 보존
  const order: string[] = [];
  const map = new Map<string, { ko: string; original: Row }[]>();
  for (const r of rows) {
    const main = str(r["주공종"] ?? r["공종"]).trim();
    const sub = str(r["세부공정"] ?? r["세부작업"]).trim();
    if (!main || !sub) continue;
    if (!map.has(main)) {
      map.set(main, []);
      order.push(main);
    }
    map.get(main)!.push({ ko: sub, original: r });
  }
  return order.map((main) => ({
    code: slugify(main),
    ko: main,
    subtasks: map.get(main),
  }));
}

function transformGuide(rows: Row[]): unknown[] {
  return rows.map((r) => ({
    guideCode: str(r["지침번호"] ?? r["분류기호"]),
    title: str(r["명칭"] ?? r["지침명"]),
    category: str(r["분류내용"] ?? r["분류기호"]),
    publishedAt: str(r["제정일"] ?? r["등록일"]),
    original: r,
  }));
}

async function sync(target: SyncTarget, transform: Transformer, loader: Loader): Promise<void> {
  if (!(await fileExists(target.input))) {
    console.log(`[skip] ${target.label} — ${target.input} 없음`);
    console.log(`       다운로드: ${target.sourceUrl}`);
    return;
  }

  const rows = await loader(target.input);
  const items = transform(rows);

  const payload = {
    version: "0.1.0",
    dataId: target.dataId,
    bundleStatus: "loaded",
    source: target.source,
    sourceUrl: target.sourceUrl,
    license: "공공누리 출처표시·변경금지",
    licenseNote:
      "원본 데이터는 공공누리 변경금지 조건하에 배포된다. 이 JSON 은 사용자 PC 에만 존재하며 재배포하지 말 것. 각 레코드의 'original' 필드는 원본 행 그대로이며, 그 외 파생 필드는 본 프로젝트 내 검색 편의를 위한 인덱싱 용도일 뿐 재배포 대상이 아니다.",
    lastSyncedAt: new Date().toISOString(),
    totalCount: items.length,
    [target.arrayKey]: items,
  };

  await writeFile(target.output, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[ok] ${target.label} — ${items.length}건 → ${target.output}`);
}

function splitList(s: string): string[] {
  if (!s) return [];
  return String(s)
    .split(/[\n;,·•]|  +/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function slugify(s: string): string {
  return (
    String(s)
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/gi, "")
      .toUpperCase() || "CATEGORY"
  );
}

// ── 실행 ──
(async () => {
  console.log(`[sync-kosha] ${new Date().toISOString()}`);
  console.log(`             입력: ${DATA_DIR}`);
  console.log(`             출력: ${TAXONOMY_DIR}`);
  console.log("");
  console.log(
    "⚠ 공공누리 출처표시·변경금지: 이 스크립트가 생성한 JSON 은 **사용자 로컬 전용**이며 재배포 금지.\n",
  );

  await sync(TARGETS.sif, transformSif, loadXlsx).catch((e: Error) =>
    console.error(`[err] SIF: ${e.message}`),
  );
  await sync(TARGETS.subtasks, transformSubtasks, loadXlsx).catch((e: Error) =>
    console.error(`[err] subtasks: ${e.message}`),
  );
  await sync(TARGETS.guide, transformGuide, loadCsv).catch((e: Error) =>
    console.error(`[err] guide: ${e.message}`),
  );

  console.log("\n[done]");
})();
