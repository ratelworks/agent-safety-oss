#!/usr/bin/env tsx
/**
 * inventory-data.ts
 *
 * ADR 003 (Doc Drift Prevention) — 코드/데이터에서 카운트 산출하는 단일 진원지.
 *
 * `generate-inventory.ts` (INVENTORY.md 렌더링) 와 `sync-docs.ts` (9개 문서 marker 자동 갱신)
 * 가 동일한 산출값을 공유하도록 본 모듈을 import.
 *
 * 신규 marker 키 추가 시:
 *   1. 본 모듈의 collectInventoryData() 반환 객체에 필드 추가
 *   2. sync-docs.ts 의 MARKER_MAP 에 매핑 추가
 *   3. generate-inventory.ts 의 렌더링에 필요 시 추가
 *
 * 의존성: Node 표준만. zod-to-json-schema 등 외부 패키지 미사용.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..", "..");

// ─── 1. 도구 (TOOLS) ───
export interface ToolStat {
  total: number;
  keyless: number;
  keyRequired: number;
  stub: number;
  active: number;
  stubNames: string[];
  keyRequiredNames: string[];
  allNames: string[];
}

export async function countTools(): Promise<ToolStat> {
  const buildRegistryPath = resolve(ROOT, "build/tool-registry.js");
  let allNames: string[] = [];
  if (existsSync(buildRegistryPath)) {
    const mod = (await import(buildRegistryPath)) as { TOOLS?: Array<{ name: string }> };
    if (Array.isArray(mod.TOOLS)) {
      allNames = mod.TOOLS.map((t) => t.name).filter(Boolean);
    }
  }
  if (allNames.length === 0) {
    throw new Error(
      "[inventory-data] build/tool-registry.js 미발견. `npm run build` 후 실행 필요.",
    );
  }

  // API 키 필요 목록 — src/cli.ts TOOLS_NEEDING_API_KEY 추출
  const cli = readFileSync(resolve(ROOT, "src/cli.ts"), "utf8");
  const keyMatch = cli.match(/TOOLS_NEEDING_API_KEY = new Set<string>\(\[([\s\S]*?)\]\)/);
  const keyRequired: string[] = [];
  if (keyMatch) {
    const lines = keyMatch[1].matchAll(/"([^"]+)"/g);
    for (const m of lines) keyRequired.push(m[1]);
  }

  // stub 도구 — tool-registry.ts 의 "빈 상태" 주석 + 실제 JSON bundleStatus=empty 검증
  const toolRegistry = readFileSync(resolve(ROOT, "src/tool-registry.ts"), "utf8");
  const stubMatches = toolRegistry.matchAll(/(\w+Tool),\s*\/\/[^\n]*빈 상태/g);
  const stubVarMap: Record<string, string> = {
    searchSifArchiveTool: "search_sif_archive",
    listConstructionSubtasksTool: "list_construction_subtasks",
  };
  const stubNames: string[] = [];
  for (const m of stubMatches) {
    const name = stubVarMap[m[1]];
    if (name && allNames.includes(name)) stubNames.push(name);
  }

  const total = allNames.length;
  const keyRequiredCount = keyRequired.length;
  return {
    total,
    keyless: total - keyRequiredCount,
    keyRequired: keyRequiredCount,
    stub: stubNames.length,
    active: total - stubNames.length,
    stubNames,
    keyRequiredNames: keyRequired,
    allNames,
  };
}

// ─── 2. 그래프 노드 ───
export interface GraphStat {
  totalTopLevel: number; // 카테고리 디렉토리 직접 자식만 (예: documents/*.jsonld)
  totalRecursive: number; // 카테고리 + 모든 서브디렉토리 (예: documents/guides/*.jsonld 포함)
  byCategoryTopLevel: Record<string, number>;
  byCategoryRecursive: Record<string, number>;
  edges: number; // graph 엣지 추정 (audit-graph-health 와 동일 logic)
}

function countJsonldRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      count += countJsonldRecursive(full);
    } else if (entry.endsWith(".jsonld")) {
      count += 1;
    }
  }
  return count;
}

// EDGE_PROPS — audit-graph-health.ts 와 1:1 동일 (SSoT). 변경 시 양쪽 동시 갱신 필요.
const EDGE_PROPS = [
  "delegates", "references", "hasArticle", "partOf", "hasAnnex", "specifies",
  "regulates", "penalizedBy", "penalizedByDelegated", "appliesTo", "requires",
  "mitigatedBy", "mitigates", "causedBy", "evaluatedBy", "cycledAs",
  "legalBasisOf", "legalBasis", "penaltyOnMissing", "relatedDocs",
  "guidedBy", "amendedTo", "interpretedBy", "auditedBy", "informedBy",
  "hasHazard", "regulatedBy", "cycle", "hasChapter", "hasSection", "delegationOf",
] as const;

function countGraphEdges(): number {
  // audit-graph-health.ts 와 동일 산출 로직 — EDGE_PROPS 별 IRI 참조 카운트 합산.
  // JSON parse 비용은 build 시 1회만 발생하므로 정확성 우선.
  const nodesDir = resolve(ROOT, "src/ontology/graph/nodes");
  if (!existsSync(nodesDir)) return 0;
  let edges = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".jsonld")) {
        try {
          const node = JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown>;
          for (const prop of EDGE_PROPS) {
            const v = node[prop];
            if (!v) continue;
            if (typeof v === "string") edges += 1;
            else if (Array.isArray(v)) {
              for (const t of v) if (typeof t === "string") edges += 1;
            }
          }
        } catch {}
      }
    }
  };
  walk(nodesDir);
  return edges;
}

export function countGraphNodes(): GraphStat {
  const nodesDir = resolve(ROOT, "src/ontology/graph/nodes");
  const byCategoryTopLevel: Record<string, number> = {};
  const byCategoryRecursive: Record<string, number> = {};
  let totalTopLevel = 0;
  let totalRecursive = 0;
  for (const cat of readdirSync(nodesDir)) {
    const catDir = join(nodesDir, cat);
    if (!statSync(catDir).isDirectory()) continue;
    const topLevelCount = readdirSync(catDir).filter((f) => f.endsWith(".jsonld")).length;
    const recursiveCount = countJsonldRecursive(catDir);
    byCategoryTopLevel[cat] = topLevelCount;
    byCategoryRecursive[cat] = recursiveCount;
    totalTopLevel += topLevelCount;
    totalRecursive += recursiveCount;
  }
  return {
    totalTopLevel,
    totalRecursive,
    byCategoryTopLevel,
    byCategoryRecursive,
    edges: countGraphEdges(),
  };
}

// ─── 3. KOSHA Guide 본문 + 메타 + 추출 품질 ───
export interface KoshaFailure {
  guideNo: string;
  title?: string;
  category?: string;
  reason?: string;
  userWorkaround?: string;
}

export interface KoshaStat {
  bodyCount: number;
  metaCount: number;
  missingBodies: string[];
  failures: KoshaFailure[];
  failureDriftOk: boolean;
  verified: number;
  partial: number;
  raw: number;
}

export function countKoshaGuides(): KoshaStat {
  const dir = resolve(ROOT, "src/ontology/kosha-guides");
  const all = readdirSync(dir).filter((f) => f.endsWith(".md"));

  const metaDir = resolve(ROOT, "src/ontology/graph/nodes/documents/guides");
  let metaCount = 0;
  let missingBodies: string[] = [];
  if (existsSync(metaDir)) {
    const metaFiles = readdirSync(metaDir).filter((f) => f.endsWith(".jsonld"));
    metaCount = metaFiles.length;
    const bodyIds = new Set(all.map((f) => f.replace(/\.md$/, "").toLowerCase()));
    missingBodies = metaFiles
      .map((f) => f.replace(/\.jsonld$/, ""))
      .filter((id) => !bodyIds.has(id.toLowerCase()))
      .map((id) => id.toUpperCase());
  }

  let failures: KoshaFailure[] = [];
  try {
    const raw = JSON.parse(readFileSync(join(dir, "_FAILURES.json"), "utf8"));
    const list = Array.isArray(raw) ? raw : raw.failures ?? [];
    failures = list as KoshaFailure[];
  } catch {}
  const failureIds = failures.map((f) => f.guideNo);
  const failureDriftOk =
    missingBodies.every((id) => failureIds.includes(id)) &&
    failureIds.every((id) => missingBodies.includes(id));

  let verified = 0;
  let partial = 0;
  let raw = 0;
  for (const f of all) {
    const content = readFileSync(join(dir, f), "utf8");
    const emptyTables = (content.match(/^<table>$/gm) ?? []).length;
    if (emptyTables === 0) verified++;
    else if (emptyTables <= 10) partial++;
    else raw++;
  }
  return {
    bodyCount: all.length,
    metaCount,
    missingBodies,
    failures,
    failureDriftOk,
    verified,
    partial,
    raw,
  };
}

// ─── 4. 법령 본문 ───
export interface LawStat {
  filename: string;
  shortName: string;
  articleCount: number;
  totalArticles: number | null;
  coveragePercent: string;
  lastSynced: string;
  publishedVersion: string | null;
  isPartial: boolean;
}

export const LAW_TOTAL_ARTICLES: Record<string, { total: number | null; shortName: string }> = {
  "산업안전보건법.md": { total: 175, shortName: "산업안전보건법" },
  "산업안전보건법-시행령.md": { total: 159, shortName: "산안법 시행령" },
  "산업안전보건법-시행규칙.md": { total: 252, shortName: "산안법 시행규칙" },
  "산업안전보건기준에-관한-규칙.md": { total: 671, shortName: "산안기준규칙" },
  "중대재해처벌법.md": { total: 16, shortName: "중대재해처벌법" },
  "중대재해처벌법-시행령.md": { total: 14, shortName: "중처법 시행령" },
  "위험성평가-고시-2024-76.md": { total: 23, shortName: "위험성평가 고시" },
  "건설기술진흥법-§62영역.md": { total: null, shortName: "건진법 §62 영역" },
};

export function countLawArticles(): LawStat[] {
  const dir = resolve(ROOT, "src/ontology/safety-laws");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");
  const out: LawStat[] = [];
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf8");
    const articleCount = (content.match(/^##\s+(§|제\d)/gm) ?? []).length;
    const meta = LAW_TOTAL_ARTICLES[f] ?? { total: null, shortName: f.replace(/\.md$/, "") };
    const lastSynced =
      content.match(/마지막 동기화[^\n]*?(\d{4}-\d{2}-\d{2})/)?.[1] ?? "(미명시)";
    const publishedVersion = content.match(/현행 법률[^\n]*?\*\*([^*]+)\*\*/)?.[1]?.trim() ?? null;
    const coveragePercent =
      meta.total === null
        ? "(영역 한정)"
        : meta.total === articleCount
          ? "**전문**"
          : `${((articleCount / meta.total) * 100).toFixed(1)}%`;
    const isPartial = meta.total !== null && articleCount < meta.total;
    out.push({
      filename: f,
      shortName: meta.shortName,
      articleCount,
      totalArticles: meta.total,
      coveragePercent,
      lastSynced,
      publishedVersion,
      isPartial,
    });
  }
  return out;
}

// ─── 5. 양식 ───
export interface FormsStat {
  total: number;
  byFormat: Record<string, number>;
  meta: { compiled: string; license: string };
}

export function countForms(): FormsStat {
  const path = resolve(ROOT, "src/ontology/forms/forms-map.json");
  const data = JSON.parse(readFileSync(path, "utf8"));
  const byFormat: Record<string, number> = {};
  for (const f of data.forms) byFormat[f.format] = (byFormat[f.format] ?? 0) + 1;
  return {
    total: data.forms.length,
    byFormat,
    meta: { compiled: data._meta?.compiled ?? "?", license: data._meta?.license ?? "?" },
  };
}

// ─── 6. 패키지 버전 (package.json SSoT) ───
export function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  return pkg.version as string;
}

// ─── 7. 법정문서 (documents) ───
export function countDocuments(): number {
  // 19종 법정 안전관리 문서 — IDENTITY 정의. 정적이지만 미래 확장 가능성 대비 함수화.
  // 현재는 src/ontology/forms/forms-map.json 의 별도 표기 또는 IDENTITY 정의 의존.
  return 19;
}

// ─── 8. 법정의무 문서 마스터 (legal-duty-master.json) ───
export function countDocIdMaster(): number {
  const path = resolve(ROOT, "src/ontology/legal-duty-master.json");
  const data = JSON.parse(readFileSync(path, "utf8"));
  const docs = data.documents ?? [];
  return Array.isArray(docs) ? docs.length : 0;
}

// ─── 통합 산출 ───
export interface InventoryData {
  version: string;
  generatedAt: string;
  tools: ToolStat;
  graph: GraphStat;
  kosha: KoshaStat;
  laws: LawStat[];
  forms: FormsStat;
  lawArticleTotal: number;
  latestLawSync: string;
  documentsTotal: number;
  docIdMaster: number;
}

export async function collectInventoryData(): Promise<InventoryData> {
  const version = readPackageVersion();
  const tools = await countTools();
  const graph = countGraphNodes();
  const kosha = countKoshaGuides();
  const laws = countLawArticles();
  const forms = countForms();
  const lawArticleTotal = laws.reduce((s, l) => s + l.articleCount, 0);
  const latestLawSync =
    laws
      .map((l) => l.lastSynced)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .pop() ?? "(미명시)";
  const generatedAt =
    new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19) + "+09:00";
  return {
    version,
    generatedAt,
    tools,
    graph,
    kosha,
    laws,
    forms,
    lawArticleTotal,
    latestLawSync,
    documentsTotal: countDocuments(),
    docIdMaster: countDocIdMaster(),
  };
}
