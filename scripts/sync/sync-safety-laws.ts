#!/usr/bin/env tsx
/**
 * sync-safety-laws.ts
 *
 * 법제처 국가법령정보센터에서 건설·산업안전 관련 법령 현행본을 동기화하기
 * 위한 **가이드 스크립트**. 현재 구현은 법령 API 자동 fetch 가 아직
 * 통합되지 않아 **수동 갱신 절차만 안내**한다.
 *
 * 저작권: 저작권법 §7 (법령·고시·훈령은 저작권 보호 대상 아님). 자유 복제·재배포.
 *
 * 동작:
 *   기본(안전 모드): 법령 원문 fetch 가 구현되지 않았으므로
 *     - 갱신 대상 URL 안내만 출력하고 종료
 *     - "마지막 동기화" 일자 자동 갱신은 하지 않음 (허위 신호 방지)
 *   --allow-stamp-only (명시 플래그):
 *     사용자가 수동 갱신을 마친 후 일자만 갱신하고 싶을 때 사용
 *
 * 사용:
 *   npx tsx scripts/sync/sync-safety-laws.ts
 *   npx tsx scripts/sync/sync-safety-laws.ts --allow-stamp-only
 *
 * v0.2 계획:
 *   법제처 OpenAPI (LSW) 통합 후 실 내용 자동 fetch + MD 재생성
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface LawMeta {
  file: string;
  lawId: string;
  portalUrl: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const LAWS_DIR = resolve(ROOT, "src", "ontology", "safety-laws");

const LAWS: LawMeta[] = [
  {
    file: "산업안전보건법.md",
    lawId: "산업안전보건법",
    portalUrl: "https://www.law.go.kr/법령/산업안전보건법",
  },
  {
    file: "산업안전보건법-시행령.md",
    lawId: "산업안전보건법 시행령",
    portalUrl: "https://www.law.go.kr/법령/산업안전보건법시행령",
  },
  {
    file: "산업안전보건법-시행규칙.md",
    lawId: "산업안전보건법 시행규칙",
    portalUrl: "https://www.law.go.kr/법령/산업안전보건법시행규칙",
  },
  {
    file: "산업안전보건기준에-관한-규칙.md",
    lawId: "산업안전보건기준에 관한 규칙",
    portalUrl: "https://www.law.go.kr/법령/산업안전보건기준에관한규칙",
  },
  {
    file: "중대재해처벌법.md",
    lawId: "중대재해 처벌 등에 관한 법률",
    portalUrl: "https://www.law.go.kr/법령/중대재해처벌등에관한법률",
  },
  {
    file: "위험성평가-고시-2024-76.md",
    lawId: "사업장 위험성평가에 관한 지침 (고시 제2024-76호)",
    portalUrl: "https://www.law.go.kr/행정규칙/사업장위험성평가에관한지침",
  },
];

const TODAY = new Date().toISOString().slice(0, 10);
const allowStampOnly = process.argv.includes("--allow-stamp-only");

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function refreshSyncStamp(lawMeta: LawMeta): Promise<boolean> {
  const path = resolve(LAWS_DIR, lawMeta.file);
  if (!(await fileExists(path))) {
    console.error(`[err] ${lawMeta.file} — 파일 없음`);
    return false;
  }
  const content = await readFile(path, "utf8");
  const updated = content.replace(
    /> \*\*마지막 동기화\*\*:\s*\d{4}-\d{2}-\d{2}/,
    `> **마지막 동기화**: ${TODAY}`,
  );
  if (updated !== content) {
    await writeFile(path, updated, "utf8");
    console.log(`[stamp] ${lawMeta.file} — ${TODAY}`);
    return true;
  }
  return false;
}

(async () => {
  console.log(`[sync-safety-laws] ${new Date().toISOString()}`);
  console.log("");

  if (!allowStampOnly) {
    console.log(
      "⚠ 법령 원문 자동 fetch 는 v0.2 에서 구현 예정. 현재는 **수동 갱신 안내만** 수행합니다.",
    );
    console.log(
      "  일자 스탬프만 갱신하려면 --allow-stamp-only 플래그로 재실행하세요.",
    );
    console.log("");
    console.log("## 갱신 절차");
    console.log("  1) 각 법령의 portalUrl 에서 최신 원문 확인");
    for (const law of LAWS) {
      console.log(`     - ${law.lawId}`);
      console.log(`       ${law.portalUrl}`);
    }
    console.log("  2) src/ontology/safety-laws/<파일명>.md 를 편집해 원문 반영");
    console.log("  3) 파일 상단 '현행 법령번호' / '시행일' 메타 갱신");
    console.log(
      "  4) npx tsx scripts/sync/sync-safety-laws.ts --allow-stamp-only 실행해 '마지막 동기화' 일자 갱신",
    );
    console.log("  5) 빌드 & 커밋");
    console.log("");
    console.log(
      "[exit] 허위 동기화 신호 방지를 위해 내용 변경 없이 일자만 갱신하지 않습니다.",
    );
    process.exit(2);
  }

  // --allow-stamp-only 명시된 경우에만 스탬프 갱신
  let stamped = 0;
  for (const law of LAWS) {
    if (await refreshSyncStamp(law)) stamped += 1;
  }
  console.log("");
  console.log(`[done] ${stamped}/${LAWS.length} 파일 '마지막 동기화' 일자 갱신`);
  console.log(
    "(주의) 원문 내용이 최신인지는 본 스크립트가 보장하지 않습니다.",
  );
})();
