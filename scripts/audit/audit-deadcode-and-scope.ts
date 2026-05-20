#!/usr/bin/env tsx
/**
 * 데드코드 + 프로젝트 목적 외 구현 audit
 *
 * 프로젝트 목적 (메모리 §agentsafety_top_priority_document_drafting):
 *   - 14~19종 법정 안전관리 문서 작성 보조 (최우선)
 *   - 산재된 KOSHA + 법률 → 온톨로지 그래프
 *   - 도메인 경계: 안전관리 한정 (§agentsafety_domain_boundary_with_extension)
 *     · 미포함: 화학물질(환경부), 소방(소방청), 하도급(공정위), 환경, 시공도면
 *
 * 검증 항목:
 *   1. 미사용 lib export (다른 파일에서 import 안 됨)
 *   2. 미사용 도구 (build/tools/*.ts 중 server.ts에 등록 안 됨)
 *   3. 1회성 마이그레이션 스크립트 (시한폭탄)
 *   4. context.jsonld 정의 0건 사용 term
 *   5. 도메인 경계 위반 (인접 도메인 키워드)
 *   6. 미사용 그래프 노드 디렉토리
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SRC = resolve(ROOT, "src");
const SCRIPTS = resolve(ROOT, "scripts");

async function walk(dir: string, ext: string[], out: string[] = []): Promise<string[]> {
  for (const f of await readdir(dir)) {
    const p = resolve(dir, f);
    const s = await stat(p).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) await walk(p, ext, out);
    else if (ext.some((e) => f.endsWith(e))) out.push(p);
  }
  return out;
}

async function readText(p: string): Promise<string> {
  try { return await readFile(p, "utf-8"); } catch { return ""; }
}

interface Finding { severity: "HIGH" | "MEDIUM" | "LOW"; category: string; items: string[]; }
const findings: Finding[] = [];

async function main() {
  // 1. 미사용 lib exports
  const libFiles = await walk(SRC, [".ts"]);
  const libExports = new Map<string, string[]>(); // file → exported symbols
  for (const f of libFiles) {
    const txt = await readText(f);
    const matches = txt.match(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g) ?? [];
    const symbols = matches.map(m => m.replace(/^.*\s+/, ""));
    if (symbols.length) libExports.set(f, symbols);
  }
  // 사용처 찾기
  const allCode = await Promise.all([...libFiles, ...(await walk(SCRIPTS, [".ts"]))].map(readText));
  const allText = allCode.join("\n");
  const unusedExports: string[] = [];
  for (const [file, symbols] of libExports) {
    const fname = file.replace(ROOT + "/", "");
    if (fname.startsWith("src/tools/") || fname.startsWith("src/server")) continue; // tools/server는 export 자체가 진입점
    for (const sym of symbols) {
      // 자기 정의 라인 제외하고 다른 곳에서 사용되는지
      const usages = (allText.match(new RegExp(`\\b${sym}\\b`, "g")) ?? []).length;
      if (usages <= 1) {
        unusedExports.push(`${fname} :: ${sym}`);
      }
    }
  }
  if (unusedExports.length > 0) {
    findings.push({ severity: "MEDIUM", category: "미사용 lib exports (정의 1회만 — import 0건)", items: unusedExports });
  }

  // 2. 미사용 도구 (tool-registry.ts에 등록 여부)
  const registryTxt = await readText(resolve(SRC, "tool-registry.ts"));
  const toolFiles = await walk(resolve(SRC, "tools"), [".ts"]);
  const unregistered: string[] = [];
  for (const tf of toolFiles) {
    const txt = await readText(tf);
    const exportMatch = txt.match(/export\s+const\s+([A-Za-z0-9_]+Tool)\s*:/);
    if (!exportMatch) continue;
    const toolName = exportMatch[1];
    if (!registryTxt.includes(toolName)) unregistered.push(`${tf.replace(ROOT + "/", "")} :: ${toolName}`);
  }
  if (unregistered.length > 0) {
    findings.push({ severity: "HIGH", category: "도구 정의됐지만 tool-registry.ts에 등록 안 됨", items: unregistered });
  }

  // 3. 1회성 마이그레이션 스크립트 — scripts/migrations/ 외부에 잔존하는지만 검사
  // phase-c-* 는 회귀 테스트 도구로 분류 (마이그레이션 아님)
  const scriptFiles = await walk(SCRIPTS, [".ts"]);
  const migrationCandidates: string[] = [];
  for (const sf of scriptFiles) {
    const fname = sf.replace(ROOT + "/", "");
    if (fname.startsWith("scripts/migrations/")) continue;
    const name = fname.split("/").pop() ?? "";
    if (name.startsWith("phase-c-")) continue; // 회귀 테스트 (Phase C 신입 자족도)
    if (/^(migrate-|audit-fix-|fill-|gap[1-9]-|fix-|seed-extra-|seed-domain|connect-orphan|sync-reverse-edges|round[0-9]+|phase-[ab][0-9]?)/.test(name)) {
      migrationCandidates.push(fname);
    }
  }
  if (migrationCandidates.length > 0) {
    findings.push({ severity: "MEDIUM", category: "1회성 마이그레이션 스크립트 (scripts/migrations/로 이동 필요)", items: migrationCandidates });
  }

  // 4. context.jsonld 정의 0건 사용 term
  const ctx = JSON.parse(await readText(resolve(ROOT, "src/ontology/graph/context.jsonld")));
  const ctxKeys = Object.keys(ctx["@context"] ?? {});
  const nodes = await walk(resolve(ROOT, "src/ontology/graph/nodes"), [".jsonld"]);
  const nodeTexts = await Promise.all(nodes.map(readText));
  const nodeBlob = nodeTexts.join("\n");
  const unusedTerms: string[] = [];
  for (const k of ctxKeys) {
    if (k.startsWith("@") || k === "_meta") continue;
    if (k[0] === k[0].toUpperCase()) continue; // 타입은 @type 검사 별도
    const def = ctx["@context"][k];
    const isPrefix = typeof def === "string" && /^https?:\/\//.test(def);
    if (isPrefix) {
      // CURIE form: prefix:suffix — 더 정확한 매칭 (suffix 한글·하이픈·숫자 허용)
      const re = new RegExp(`["']${k}:[^"'\\s]+["']`, "g");
      const matches = nodeBlob.match(re);
      if (!matches || matches.length === 0) unusedTerms.push(`${k} (prefix, 사용 0건)`);
    } else {
      const re = new RegExp(`"${k}"\\s*:`, "g");
      const matches = nodeBlob.match(re);
      if (!matches || matches.length === 0) unusedTerms.push(`${k} (term, 사용 0건)`);
    }
  }
  if (unusedTerms.length > 0) {
    findings.push({ severity: "LOW", category: "context.jsonld 정의됐지만 노드 사용 0건", items: unusedTerms });
  }

  // 5. 도메인 경계 위반 — 안전관리 외 도메인
  const offDomainPatterns: { domain: string; pattern: RegExp }[] = [
    { domain: "환경부 (화학물질관리법)", pattern: /화학물질관리법|환경부\s*고시/ },
    { domain: "소방청 (소방시설법)", pattern: /소방시설(?:법|기본법|설치|관리)|화재예방.{0,5}법/ },
    { domain: "공정위 (하도급법)", pattern: /하도급법|공정거래위원회/ },
    { domain: "국토부 시공도면", pattern: /시공도면|건축도면\s*심의|구조계산서\s*인허가/ },
    { domain: "철도/항공/해상 안전법", pattern: /철도안전법|항공안전법|선박안전법/ },
  ];
  const tsFiles = [...libFiles, ...scriptFiles];
  const tsCode = await Promise.all(tsFiles.map(readText));
  const domainViolations: string[] = [];
  // 의무문서가 외부 도메인 법령을 인용하는 패턴 (정당)
  const allowedExternalRef = /legalBasisExternal|externalDomain|외부 도메인|인접 도메인|GHS|MSDS|화재안전기준|소방시설법 §|화학물질관리법 §|시공도면[·\.]계획서|건축도면 검토|위험물안전관리법/;
  for (let i = 0; i < tsFiles.length; i++) {
    const f = tsFiles[i];
    const fname = f.replace(ROOT + "/", "");
    if (fname.startsWith("scripts/migrations/")) continue; // 1회성 격리됨
    const txt = tsCode[i];
    for (const { domain, pattern } of offDomainPatterns) {
      if (pattern.test(txt) && !allowedExternalRef.test(txt)) {
        domainViolations.push(`${fname} (${domain})`);
      }
    }
  }
  if (domainViolations.length > 0) {
    findings.push({ severity: "HIGH", category: "도메인 경계 위반 (안전관리 외)", items: domainViolations });
  }

  // 6. 미사용 그래프 노드 디렉토리
  const graphRoot = resolve(ROOT, "src/ontology/graph/nodes");
  const dirs = await readdir(graphRoot);
  const dirUsage: Record<string, number> = {};
  for (const d of dirs) {
    const p = resolve(graphRoot, d);
    const s = await stat(p).catch(() => null);
    if (!s?.isDirectory()) continue;
    const slug = d.replace(/s$/, ""); // documents → document
    const re = new RegExp(`\\b${slug}:`, "g");
    const matches = nodeBlob.match(re);
    dirUsage[d] = matches?.length ?? 0;
  }
  const lowUsage = Object.entries(dirUsage).filter(([_, c]) => c < 5).map(([d, c]) => `${d}: ${c}회`);
  if (lowUsage.length > 0) {
    findings.push({ severity: "LOW", category: "그래프 노드 디렉토리 참조 ≤ 5건", items: lowUsage });
  }

  // 7. src/ontology JSON 미참조 (import + JSON 패턴 + scripts/migrations 모두 검사)
  const taxFiles = await readdir(resolve(ROOT, "src/ontology"));
  const migrationsTexts = await Promise.all(
    (await walk(resolve(SCRIPTS, "migrations"), [".ts"]).catch(() => [])).map(readText)
  );
  const blob = allText + "\n" + migrationsTexts.join("\n");
  const deprecated: string[] = [];
  for (const f of taxFiles) {
    const p = resolve(ROOT, "src/ontology", f);
    const s = await stat(p).catch(() => null);
    if (s?.isFile() && f.endsWith(".json")) {
      const stem = f.replace(/\.json$/, "");
      const re = new RegExp(`(?:ontology/${stem}|${stem.replace(/\./g, "\\.")}\\.json)`, "g");
      const usages = (blob.match(re) ?? []).length;
      if (usages === 0) deprecated.push(`${f} (참조 0건)`);
    }
  }
  if (deprecated.length > 0) {
    findings.push({ severity: "MEDIUM", category: "src/ontology 미참조 JSON 파일", items: deprecated });
  }

  // ─── 출력
  console.log("=".repeat(80));
  console.log("데드코드 + 프로젝트 목적 외 구현 audit");
  console.log("=".repeat(80));
  const HIGH = findings.filter(f => f.severity === "HIGH");
  const MEDIUM = findings.filter(f => f.severity === "MEDIUM");
  const LOW = findings.filter(f => f.severity === "LOW");
  console.log(`\n발견: HIGH ${HIGH.length} / MEDIUM ${MEDIUM.length} / LOW ${LOW.length}\n`);

  for (const f of findings) {
    console.log(`[${f.severity}] ${f.category} (${f.items.length}건)`);
    for (const it of f.items) console.log(`  · ${it}`);
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
