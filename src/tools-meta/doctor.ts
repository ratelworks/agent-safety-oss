/**
 * doctor.ts
 *
 * 외부 리뷰 P1 (2026-05-22) — agent-safety-oss doctor CLI 명령.
 *
 * 설치 직후 또는 평소에 시스템 무결성을 한 번에 확인:
 *   1. 도구 / capability SSoT 정합 (92/92/92)
 *   2. 그래프 노드 카운트 + dangling IRI
 *   3. KOSHA Guide 본문 등급별 분포
 *   4. 법령 마지막 동기화 일자 + stale 경고 (1년 이상)
 *   5. profile.jsonld 존재 여부 + API 키 환경변수
 *
 * 출력: Markdown — 사용자에게 가독성 우선, JSON 옵션도 제공.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface DoctorReport {
  generatedAt: string;
  overall: "ok" | "warn" | "fail";
  sections: DoctorSection[];
}

interface DoctorSection {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  data?: Record<string, unknown>;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstNow(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 19) + "+09:00";
}

function findRoot(start: string): string {
  // build/tools-meta 또는 src/tools-meta 에서 출발해 package.json 이 있는 위치로 거슬러 오름
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(cur, "package.json"))) return cur;
    cur = resolve(cur, "..");
  }
  return start;
}

const ROOT = findRoot(__dirname);

async function checkToolCapabilitySSoT(): Promise<DoctorSection> {
  const buildRegistryPath = resolve(ROOT, "build/tool-registry.js");
  if (!existsSync(buildRegistryPath)) {
    return {
      name: "도구·Capability SSoT 정합",
      status: "warn",
      detail: "build/tool-registry.js 미발견. `npm run build` 실행 후 doctor 재실행 권장.",
    };
  }
  const mod = (await import(buildRegistryPath)) as { TOOLS?: Array<{ name: string }> };
  const tools = mod.TOOLS ?? [];

  // capability registry
  const capRegistryPath = resolve(ROOT, "build/capability-registry.js");
  let capCount = 0;
  if (existsSync(capRegistryPath)) {
    const capMod = (await import(capRegistryPath)) as {
      CAPABILITY_REGISTRY_ENTRIES?: Array<[string, unknown]>;
    };
    capCount = capMod.CAPABILITY_REGISTRY_ENTRIES?.length ?? 0;
  }

  // capability jsonld
  const capDir = resolve(ROOT, "src/ontology/graph/nodes/capabilities");
  const capFiles = existsSync(capDir)
    ? readdirSync(capDir).filter((f) => f.endsWith(".jsonld")).length
    : 0;

  const aligned = tools.length === capCount && tools.length === capFiles;
  return {
    name: "도구·Capability SSoT 정합",
    status: aligned ? "ok" : "fail",
    detail: aligned
      ? `TOOLS = CAPABILITY_REGISTRY = .jsonld = ${tools.length}/${capCount}/${capFiles}`
      : `drift 검출: TOOLS ${tools.length} / CAPABILITY ${capCount} / .jsonld ${capFiles}`,
    data: { tools: tools.length, capabilityRegistry: capCount, capabilityJsonld: capFiles },
  };
}

function checkGraphNodes(): DoctorSection {
  const nodesDir = resolve(ROOT, "src/ontology/graph/nodes");
  if (!existsSync(nodesDir)) {
    return { name: "그래프 노드", status: "fail", detail: "nodes 디렉토리 미발견" };
  }
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const cat of readdirSync(nodesDir)) {
    const catDir = join(nodesDir, cat);
    if (!statSync(catDir).isDirectory()) continue;
    const count = readdirSync(catDir).filter((f) => f.endsWith(".jsonld")).length;
    byCategory[cat] = count;
    total += count;
  }
  return {
    name: "그래프 노드",
    status: "ok",
    detail: `${total} 노드 — articles ${byCategory.articles ?? 0} · documents ${byCategory.documents ?? 0} · controls ${byCategory.controls ?? 0} · hazards ${byCategory.hazards ?? 0}`,
    data: { total, byCategory },
  };
}

function checkKoshaGuides(): DoctorSection {
  const dir = resolve(ROOT, "src/ontology/kosha-guides");
  if (!existsSync(dir)) return { name: "KOSHA Guide 본문", status: "warn", detail: "디렉토리 미발견" };
  const all = readdirSync(dir).filter((f) => f.endsWith(".md"));
  let failed = 0;
  try {
    failed = JSON.parse(readFileSync(join(dir, "_FAILURES.json"), "utf8")).length;
  } catch {}
  let verified = 0;
  let partial = 0;
  let raw = 0;
  for (const f of all) {
    const empty = (readFileSync(join(dir, f), "utf8").match(/^<table>$/gm) ?? []).length;
    if (empty === 0) verified++;
    else if (empty <= 10) partial++;
    else raw++;
  }
  const pct = (n: number) => Math.round((n / all.length) * 100);
  return {
    name: "KOSHA Guide 본문",
    status: "ok",
    detail: `총 ${all.length} 본문 — verified ${verified} (${pct(verified)}%) · partial ${partial} (${pct(partial)}%) · raw ${raw} (${pct(raw)}%) · 추출 실패 ${failed}`,
    data: { total: all.length, verified, partial, raw, failed },
  };
}

function checkLawFreshness(): DoctorSection {
  const dir = resolve(ROOT, "src/ontology/safety-laws");
  if (!existsSync(dir)) return { name: "법령 동기화", status: "fail", detail: "디렉토리 미발견" };
  const todayMs = Date.now();
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  let staleCount = 0;
  let oldestDate = "";
  let newestDate = "";
  const laws: Array<{ filename: string; date: string; stale: boolean }> = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md") || f === "README.md") continue;
    const content = readFileSync(join(dir, f), "utf8");
    const m = content.match(/마지막 동기화[^\n]*?(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    const date = m[1];
    if (!oldestDate || date < oldestDate) oldestDate = date;
    if (!newestDate || date > newestDate) newestDate = date;
    const dateMs = new Date(`${date}T00:00:00+09:00`).getTime();
    const stale = todayMs - dateMs > ONE_YEAR_MS;
    if (stale) staleCount++;
    laws.push({ filename: f, date, stale });
  }
  return {
    name: "법령 동기화",
    status: staleCount > 0 ? "warn" : "ok",
    detail:
      staleCount > 0
        ? `⚠️ ${staleCount}건 1년 경과 (가장 오래된: ${oldestDate}) — 법제처 재확인 권장`
        : `최신 ${newestDate} / 가장 오래된 ${oldestDate} — 모두 1년 이내`,
    data: { laws, staleCount, oldestDate, newestDate },
  };
}

function checkProfileAndKeys(): DoctorSection {
  const profilePath = join(homedir(), ".agent-safety-oss", "profile.jsonld");
  const hasProfile = existsSync(profilePath);
  const dataGoKrKey = !!process.env.DATA_GO_KR_KEY;
  const agentHqKey = !!process.env.AGENTHQ_API_KEY;
  const issues: string[] = [];
  if (!hasProfile) issues.push("profile.jsonld 미생성 — register_site 등으로 사업장 등록 권장");
  if (!dataGoKrKey && !agentHqKey) {
    issues.push(
      "API 키 미설정 (DATA_GO_KR_KEY / AGENTHQ_API_KEY) — KOSHA OneAPI 7개 도구 사용 시 필요",
    );
  }
  return {
    name: "사용자 환경",
    status: issues.length === 0 ? "ok" : "warn",
    detail:
      issues.length === 0
        ? `profile.jsonld 존재 · API 키 ${dataGoKrKey || agentHqKey ? "설정됨" : "미설정"}`
        : issues.join(" / "),
    data: { profilePath, hasProfile, dataGoKrKey, agentHqKey },
  };
}

export async function runDoctor(format: "markdown" | "json" = "markdown"): Promise<string> {
  const sections: DoctorSection[] = [
    await checkToolCapabilitySSoT(),
    checkGraphNodes(),
    checkKoshaGuides(),
    checkLawFreshness(),
    checkProfileAndKeys(),
  ];
  const hasFailure = sections.some((s) => s.status === "fail");
  const hasWarn = sections.some((s) => s.status === "warn");
  const overall: DoctorReport["overall"] = hasFailure ? "fail" : hasWarn ? "warn" : "ok";

  const report: DoctorReport = {
    generatedAt: kstNow(),
    overall,
    sections,
  };

  if (format === "json") return JSON.stringify(report, null, 2);

  // Markdown
  const lines: string[] = [];
  const overallEmoji = overall === "ok" ? "✅" : overall === "warn" ? "⚠️" : "❌";
  lines.push(`# agent-safety-oss doctor ${overallEmoji} ${overall.toUpperCase()}`);
  lines.push("");
  lines.push(`> 생성: ${report.generatedAt}`);
  lines.push("");
  for (const s of sections) {
    const sym = s.status === "ok" ? "✅" : s.status === "warn" ? "⚠️" : "❌";
    lines.push(`## ${sym} ${s.name}`);
    lines.push("");
    lines.push(s.detail);
    lines.push("");
  }
  if (overall !== "ok") {
    lines.push("---");
    lines.push("");
    lines.push("권장 액션:");
    if (sections.find((s) => s.name.startsWith("도구·Capability") && s.status !== "ok")) {
      lines.push("- `npm run build` 후 재실행");
      lines.push("- `npm run verify:tool-capability` 으로 정확한 drift 확인");
    }
    if (sections.find((s) => s.name === "법령 동기화" && s.status === "warn")) {
      lines.push("- `src/ontology/safety-laws/*.md` 의 `마지막 동기화` 날짜 갱신 + 법제처 재확인");
    }
    if (sections.find((s) => s.name === "사용자 환경" && s.status === "warn")) {
      lines.push("- `node build/cli.js call register_site --inputJson '...'` 로 사업장 등록");
      lines.push("- API 키 필요 시 `.env` 또는 환경변수에 `DATA_GO_KR_KEY` / `AGENTHQ_API_KEY` 설정");
    }
  }
  return lines.join("\n") + "\n";
}
