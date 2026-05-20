#!/usr/bin/env tsx
/**
 * generate-article-stubs.ts
 *
 * predicted IRI 분석 → 누락된 Article/Annex stub 노드 일괄 자동 생성.
 *
 * 동작:
 *  1) 모든 Document 의 _meta.predictedLegalBasisIris 수집 → 고유 IRI 목록
 *  2) IRI 가 이미 노드로 존재하면 skip
 *  3) src/ontology/safety-laws/*.md 본문에서 § 제목 자동 추출 → stub title
 *  4) verificationStatus="stub", _meta.note="P3 verified 전환 예정"
 *  5) enrich-graph-iris 재실행 → promoted 카운트 급증 기대
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");
const ARTICLES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const ANNEXES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "annexes");
const LAWS_MD_DIR = resolve(ROOT, "src", "ontology", "safety-laws");

// canonical 슬러그 → 법령 MD 파일명 + Act IRI
const LAW_TO_MD: Record<string, { mdFile: string; actIri: string; lawName: string }> = {
  "산안법": {
    mdFile: "산업안전보건법.md",
    actIri: "act:산업안전보건법",
    lawName: "산업안전보건법",
  },
  "산안법시행령": {
    mdFile: "산업안전보건법-시행령.md",
    actIri: "act:산업안전보건법시행령",
    lawName: "산업안전보건법 시행령",
  },
  "산안법시행규칙": {
    mdFile: "산업안전보건법-시행규칙.md",
    actIri: "act:산업안전보건법시행규칙",
    lawName: "산업안전보건법 시행규칙",
  },
  "기준규칙": {
    mdFile: "산업안전보건기준에-관한-규칙.md",
    actIri: "act:산업안전보건기준에관한규칙",
    lawName: "산업안전보건기준에 관한 규칙",
  },
  "중처법": {
    mdFile: "중대재해처벌법.md",
    actIri: "act:중대재해처벌등에관한법률",
    lawName: "중대재해 처벌 등에 관한 법률",
  },
  "중처법시행령": {
    mdFile: "중대재해처벌법.md", // 중처법.md 안에 시행령 섹션 통합
    actIri: "act:중대재해처벌등에관한법률시행령",
    lawName: "중대재해 처벌 등에 관한 법률 시행령",
  },
  "위험성평가-고시": {
    mdFile: "위험성평가-고시-2024-76.md",
    actIri: "act:사업장위험성평가에관한지침",
    lawName: "사업장 위험성평가에 관한 지침 (고시 2024-76호)",
  },
};

// 법령 MD 파싱 — § 또는 별표 제목 추출
async function parseLawMd(mdFile: string): Promise<{
  articles: Map<string, string>; // articleNumber → title
  annexes: Map<string, string>; // annexNumber → title
}> {
  const path = resolve(LAWS_MD_DIR, mdFile);
  const articles = new Map<string, string>();
  const annexes = new Map<string, string>();
  try {
    const content = await readFile(path, "utf8");
    // ## §38 사전조사 및 작업계획서의 작성 등
    const articleRe = /^##\s+§(\d+)(?:의(\d+))?\s+(.+?)$/gm;
    let m: RegExpExecArray | null;
    while ((m = articleRe.exec(content)) !== null) {
      const major = m[1];
      const minor = m[2];
      const title = m[3].trim();
      const key = minor ? `${major}의${minor}` : major;
      articles.set(key, title);
    }
    // ## §38 [별표 4] 사전조사 및 작업계획서의 내용
    const annexRe = /^##\s+§(\d+)\s*\[별표\s*(\d+)\]\s+(.+?)$/gm;
    while ((m = annexRe.exec(content)) !== null) {
      const annexNum = m[2];
      const title = m[3].trim();
      annexes.set(`별표${annexNum}`, title);
    }
    // 별도 ## 별표 N 제목 패턴
    const annexAlt = /^##\s+\[?별표\s*(\d+)\]?\s+(.+?)$/gm;
    while ((m = annexAlt.exec(content)) !== null) {
      annexes.set(`별표${m[1]}`, m[2].trim());
    }
  } catch {
    // 파일 없으면 빈 맵 반환
  }
  return { articles, annexes };
}

// 기존 노드 IRI 인덱스 빌드
async function existingNodeIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const visit = async (dir: string) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = resolve(dir, e.name);
        if (e.isDirectory()) await visit(full);
        else if (e.name.endsWith(".jsonld")) {
          const node = JSON.parse(await readFile(full, "utf8")) as { "@id"?: string };
          if (node["@id"]) ids.add(node["@id"]);
        }
      }
    } catch {
      // dir 없음
    }
  };
  await visit(resolve(ROOT, "src", "ontology", "graph", "nodes"));
  return ids;
}

// IRI 분해 — "art:기준규칙:38" → {kind, canonical, num}
function parseIri(iri: string): { kind: "Article" | "Annex" | null; canonical: string; tail: string } {
  const m = iri.match(/^(art|annex):([^:]+):(.+)$/);
  if (!m) return { kind: null, canonical: "", tail: "" };
  return {
    kind: m[1] === "art" ? "Article" : "Annex",
    canonical: m[2],
    tail: m[3],
  };
}

(async () => {
  // 1. predicted IRI 수집
  const docFiles = (await readdir(DOCS_DIR)).filter((f) => f.endsWith(".jsonld"));
  const allPredicted = new Set<string>();
  for (const f of docFiles) {
    const node = JSON.parse(await readFile(resolve(DOCS_DIR, f), "utf8")) as {
      _meta?: { predictedLegalBasisIris?: string[] };
    };
    for (const iri of node._meta?.predictedLegalBasisIris ?? []) {
      allPredicted.add(iri);
    }
  }

  // 2. 기존 노드 인덱스
  const existing = await existingNodeIds();

  // 3. 법령 MD 파싱 캐시
  const lawCache = new Map<string, { articles: Map<string, string>; annexes: Map<string, string> }>();
  for (const [canonical, info] of Object.entries(LAW_TO_MD)) {
    if (!lawCache.has(info.mdFile)) {
      lawCache.set(info.mdFile, await parseLawMd(info.mdFile));
    }
  }

  // 4. stub 생성
  let articleCreated = 0;
  let annexCreated = 0;
  let skipped = 0;
  const unrecognized: string[] = [];

  for (const iri of allPredicted) {
    if (existing.has(iri)) {
      skipped += 1;
      continue;
    }
    const parsed = parseIri(iri);
    if (!parsed.kind) {
      unrecognized.push(iri);
      continue;
    }
    const lawInfo = LAW_TO_MD[parsed.canonical];
    if (!lawInfo) {
      unrecognized.push(iri);
      continue;
    }
    const md = lawCache.get(lawInfo.mdFile);

    if (parsed.kind === "Article") {
      const articleNumber = parsed.tail; // "38" or "175의2" 등
      const title = md?.articles.get(articleNumber) ?? "(제목 미확정 — P3 본문 verified 시 보강)";
      const stubPath = resolve(
        ARTICLES_DIR,
        `${parsed.canonical}-§${articleNumber.replace(/\//g, "-")}.jsonld`,
      );
      const node = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": "Article",
        articleNumber,
        title,
        partOf: lawInfo.actIri,
        verificationStatus: "stub",
        legalBasisOf: [],
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 stub)",
          sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(lawInfo.lawName)}/제${articleNumber}조`,
          fetchedAt: "2026-04-26",
          licenseHint: "저작권법 §7 비보호 (자유 인용)",
          note: "Phase 2 자동 stub. 본문 verified 전환은 Phase 3 예정. legalBasisOf 점진 채움.",
        },
      };
      await writeFile(stubPath, JSON.stringify(node, null, 2) + "\n", "utf8");
      articleCreated += 1;
    } else if (parsed.kind === "Annex") {
      const annexNumber = parsed.tail;
      const title = md?.annexes.get(annexNumber) ?? "(제목 미확정 — P3 본문 verified 시 보강)";
      const stubPath = resolve(
        ANNEXES_DIR,
        `${parsed.canonical}-${annexNumber}.jsonld`,
      );
      const node = {
        "@context": "../../context.jsonld",
        "@id": iri,
        "@type": "Annex",
        annexNumber,
        title,
        partOf: lawInfo.actIri,
        verificationStatus: "stub",
        specifies: [],
        _meta: {
          publishedBy: "법제처 국가법령정보센터 (자동 stub)",
          sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(lawInfo.lawName)}`,
          fetchedAt: "2026-04-26",
          licenseHint: "저작권법 §7 비보호 (자유 인용)",
          contentType: "table",
          note: "Phase 2 자동 stub. 본문/이미지 verified 전환은 Phase 3 예정.",
        },
      };
      await writeFile(stubPath, JSON.stringify(node, null, 2) + "\n", "utf8");
      annexCreated += 1;
    }
  }

  console.log(
    `[done] articleCreated=${articleCreated} annexCreated=${annexCreated} skipped=${skipped} unrecognized=${unrecognized.length}`,
  );
  if (unrecognized.length > 0) {
    console.log("\n[unrecognized IRIs] (LAW_TO_MD 보강 또는 IRI 패턴 검토):");
    for (const u of unrecognized) console.log(`  ${u}`);
  }
})();
