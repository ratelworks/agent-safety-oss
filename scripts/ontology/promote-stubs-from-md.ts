#!/usr/bin/env tsx
/**
 * promote-stubs-from-md.ts
 *
 * src/ontology/safety-laws/*.md 에서 이미 verified 인 본문을 추출하여
 * Article/Annex stub 노드의 description 을 채우고 verificationStatus 를
 * stub → verified 로 승급한다.
 *
 * OSS 자족성 — 외부 API 호출 0회. 본 OSS 의 SSoT 인 .md 본문이 권위.
 *
 * 동작:
 *   1) safety-laws/*.md 파싱 → {law -> articles{N -> {title, body}}, annexes{N -> {title, body}}}
 *   2) src/ontology/graph/nodes/articles/*.jsonld + annexes/*.jsonld 순회
 *   3) verificationStatus === "stub" 이고 매칭되는 본문이 있으면 description 채움 + verified 승급
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const LAWS_MD_DIR = resolve(ROOT, "src", "ontology", "safety-laws");
const ARTICLES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "articles");
const ANNEXES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "annexes");

// canonical 슬러그 → MD 파일명
const LAW_FILES: Record<string, string> = {
  "산안법": "산업안전보건법.md",
  "산안법시행령": "산업안전보건법-시행령.md",
  "산안법시행규칙": "산업안전보건법-시행규칙.md",
  "기준규칙": "산업안전보건기준에-관한-규칙.md",
  "중처법": "중대재해처벌법.md",
  "중처법시행령": "중대재해처벌법.md", // 통합 MD
  "위험성평가-고시": "위험성평가-고시-2024-76.md",
};

interface LawParsed {
  articles: Map<string, { title: string; body: string }>;
  annexes: Map<string, { title: string; body: string }>;
}

async function parseLawMd(file: string): Promise<LawParsed> {
  const path = resolve(LAWS_MD_DIR, file);
  const articles = new Map<string, { title: string; body: string }>();
  const annexes = new Map<string, { title: string; body: string }>();
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return { articles, annexes };
  }

  // 섹션 분리 — ## 으로 시작하는 라인 기준
  const lines = content.split("\n");
  let curHeader: string | null = null;
  let curBody: string[] = [];

  const flush = () => {
    if (!curHeader) return;
    // 패턴 1: "## §38 사전조사 및 작업계획서의 작성 등"
    let m = curHeader.match(/^##\s+§(\d+)(?:의(\d+))?\s+(.+?)$/);
    if (m) {
      const major = m[1];
      const minor = m[2];
      const title = m[3].trim();
      const key = minor ? `${major}의${minor}` : major;
      const body = curBody.join("\n").trim();
      // 별표 형태 ("## §38 [별표 4] ...")는 articleRe와 충돌 — annex 우선 매칭
      const annexInline = curHeader.match(/\[별표\s*(\d+)\]\s+(.+?)$/);
      if (annexInline) {
        annexes.set(`별표${annexInline[1]}`, { title: annexInline[2].trim(), body });
      } else {
        articles.set(key, { title, body });
      }
      return;
    }
    // 패턴 2: "## §38 [별표 4] ..."
    m = curHeader.match(/^##\s+§(\d+)\s*\[별표\s*(\d+)\]\s+(.+?)$/);
    if (m) {
      annexes.set(`별표${m[2]}`, { title: m[3].trim(), body: curBody.join("\n").trim() });
      return;
    }
    // 패턴 3: "## [별표 N] ..." 또는 "## 별표 N ..."
    m = curHeader.match(/^##\s+\[?별표\s*(\d+)\]?\s+(.+?)$/);
    if (m) {
      annexes.set(`별표${m[1]}`, { title: m[2].trim(), body: curBody.join("\n").trim() });
      return;
    }
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      curHeader = line;
      curBody = [];
    } else if (curHeader) {
      curBody.push(line);
    }
  }
  flush();

  return { articles, annexes };
}

async function processStubs(
  dir: string,
  kind: "Article" | "Annex",
  parsedByLaw: Map<string, LawParsed>,
): Promise<{ promoted: number; missing: number; alreadyVerified: number }> {
  const entries = await readdir(dir);
  let promoted = 0;
  let missing = 0;
  let alreadyVerified = 0;

  for (const file of entries) {
    if (!file.endsWith(".jsonld")) continue;
    const path = resolve(dir, file);
    const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      "@id": string;
      verificationStatus?: string;
      description?: string;
      title?: string;
      _meta?: Record<string, unknown>;
    };

    if (node.verificationStatus === "verified") {
      alreadyVerified += 1;
      continue;
    }

    const m = node["@id"].match(/^(art|annex):([^:]+):(.+)$/);
    if (!m) continue;
    const canonical = m[2];
    const tail = m[3];
    const parsed = parsedByLaw.get(canonical);
    if (!parsed) {
      missing += 1;
      continue;
    }

    let entry: { title: string; body: string } | undefined;
    if (kind === "Article") {
      // tail: "38" 또는 "175의2"
      entry = parsed.articles.get(tail);
    } else {
      // tail: "별표4" or "별표4-6호"
      const m2 = tail.match(/^별표(\d+)/);
      if (m2) entry = parsed.annexes.get(`별표${m2[1]}`);
    }

    if (!entry) {
      missing += 1;
      continue;
    }

    node.description = entry.body || node.description || "";
    if (entry.title && (!node.title || node.title.includes("미확정"))) {
      node.title = entry.title;
    }
    node.verificationStatus = "verified";
    const meta = (node._meta ?? {}) as Record<string, unknown>;
    node._meta = {
      ...meta,
      promotedFromStubAt: new Date().toISOString().slice(0, 10),
      bodySource: "src/ontology/safety-laws (OSS 자족 본문)",
      bodyLength: (entry.body || "").length,
    };

    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
    promoted += 1;
  }

  return { promoted, missing, alreadyVerified };
}

(async () => {
  const parsedByLaw = new Map<string, LawParsed>();
  for (const [canonical, file] of Object.entries(LAW_FILES)) {
    parsedByLaw.set(canonical, await parseLawMd(file));
  }

  console.log("# safety-laws/*.md 파싱 결과");
  for (const [canonical, parsed] of parsedByLaw.entries()) {
    console.log(`  ${canonical}: articles=${parsed.articles.size}, annexes=${parsed.annexes.size}`);
  }

  console.log("\n# Article stub 승급");
  const ar = await processStubs(ARTICLES_DIR, "Article", parsedByLaw);
  console.log(`  promoted=${ar.promoted}, missing=${ar.missing}, alreadyVerified=${ar.alreadyVerified}`);

  console.log("\n# Annex stub 승급");
  const an = await processStubs(ANNEXES_DIR, "Annex", parsedByLaw);
  console.log(`  promoted=${an.promoted}, missing=${an.missing}, alreadyVerified=${an.alreadyVerified}`);

  console.log(
    `\n[done] 총 promoted ${ar.promoted + an.promoted}건 verified 승급. missing 은 본문 .md 에 부재 — 추후 법제처 sync 또는 .md 보강 필요.`,
  );
})();
