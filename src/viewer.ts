/**
 * viewer.ts
 *
 * A2UI v0.9 JSONL 을 브라우저에서 폼으로 렌더링하는 운영 viewer.
 * agent-safety-oss 의 사용자 표면 — 비-개발자 안전관리자가 직접 사용.
 * 의존성 0 (Node 표준만) → 빌드되어 npm 패키지(build/viewer.js)에 포함된다.
 *
 * 흐름:
 *   1. Node http 서버 (localhost:5174)
 *   2. 사용자가 브라우저로 접속 (Claude Desktop / MCP Inspector 없이도 가능)
 *   3. 폼 선택: profile / 94종 법정문서 docId 별 A2UI 폼
 *   4. 서버가 MCP CLI 호출 → A2UI JSONL 반환
 *   5. 클라이언트가 vanilla JS A2UI 렌더러로 폼 표시 + draft 자동 저장
 *   6. 사용자 입력 → 본문 생성 (generate_safety_document) → 영구 보관 (archive)
 *   7. MD 다운로드 (.md 파일) — PDF 는 사용자가 별도 도구 (Pandoc / 한컴 등) 로
 *
 * 실행:
 *   npx -y agent-safety-oss viewer   # npm 설치 없이 바로 (자동 브라우저 열림)
 *   npm run mcp:viewer               # 소스 dev (tsx)
 *   → http://localhost:5174
 *
 * 결정 기록: decisions/001-a2ui-viewer-promotion.md
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawnSync, spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
// 컴파일본(build/viewer.js)·소스 dev(src/viewer.ts) 양쪽에서 동작하도록
// 에셋·CLI 경로를 "같은 디렉토리 우선 → 프로젝트 루트 폴백" 으로 해석한다.
// - npm 설치본: build/viewer.js 옆에 cli.js·ontology/ 가 함께 배포됨 (package.json files: ["build"])
// - 소스 dev: src/viewer.ts 옆에 ontology/, ../build/cli.js
const ROOT = resolve(HERE, "..");
function firstExisting(...candidates: string[]): string {
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}
const CLI = firstExisting(resolve(HERE, "cli.js"), resolve(ROOT, "build", "cli.js"));
const MASTER_PATH = firstExisting(
  resolve(HERE, "ontology", "legal-duty-master.json"),
  resolve(ROOT, "src", "ontology", "legal-duty-master.json"),
);
// 결재 양식 SSoT — custom/ (현장 표준 종합 양식) 우선, auto/ (KOSHA 자동 생성) 폴백.
// custom/ 은 안전관리자가 가이드를 참조해 작성한 13섹션 종합 결재 양식.
// auto/ 는 sections.fields 기반 KOSHA 양식 자동 생성 (94종).
const FORMS_DIR_CUSTOM = firstExisting(
  resolve(HERE, "ontology", "forms", "custom"),
  resolve(ROOT, "src", "ontology", "forms", "custom"),
);
const FORMS_DIR_AUTO = firstExisting(
  resolve(HERE, "ontology", "forms", "auto"),
  resolve(ROOT, "src", "ontology", "forms", "auto"),
);
const PORT = Number(process.env.PORT ?? 5174);

// P2-CU7 — 폼 .md 의 `*(필수)*` 표기 라벨을 추출(custom→auto). 신규 의존·네트워크 0(번들 .md 로컬 읽기).
// render_a2ui_form 출력은 불변이며, 이 토큰 집합은 viewer 가 라벨 별표/제출 가드용으로만 쓴다.
function extractRequiredLabels(docId: string): string[] {
  if (!/^[a-zA-Z0-9_-]+$/.test(docId)) return [];
  const filename = docId + ".md";
  let md: string | null = null;
  for (const dir of [FORMS_DIR_CUSTOM, FORMS_DIR_AUTO]) {
    try {
      const p = resolve(dir, filename);
      if (p.startsWith(dir + "/")) { md = readFileSync(p, "utf8"); break; }
    } catch { /* 다음 후보 */ }
  }
  if (!md) return [];
  const labels = new Set<string>();
  for (const line of md.split("\n")) {
    if (!line.includes("*(필수)*")) continue;
    // 표 행 "| 라벨 *(필수)* | |" → 첫 셀에서 라벨 추출
    const cell = line.replace(/^\s*\|/, "").split("|")[0] ?? "";
    const label = cell.replace(/\*\(필수\)\*/g, "").replace(/\*/g, "").trim();
    if (label) labels.add(label);
  }
  return [...labels];
}

interface MasterDoc {
  docId: string;
  title: string;
  category: string;
  frequency: string;
}

function loadMaster(): MasterDoc[] {
  try {
    const raw = JSON.parse(readFileSync(MASTER_PATH, "utf8"));
    return raw.documents as MasterDoc[];
  } catch {
    return [];
  }
}

// 빈도 우선순위
const FREQ_ORDER: Record<string, number> = {
  매일: 100, "매일·매주·매월": 99, "매주": 90, "매주·강풍후": 89, 작업단위: 80,
  "월1회": 75, 매월: 70, "월·반기": 69, "월·정산": 68, 분기: 60, 반기: 55,
  연: 50, "연1회/특수 6개월": 49, 현장개설: 40, "사고시 1개월": 35, "사고시 즉시": 35,
  사고후: 34, 채용시: 30, 변경시: 30, 작업변경시: 30, 특수작업시: 30,
  선임시: 25, 발주시: 25, 설계시: 25, 착공: 25, 공사전: 25, 타설전: 25,
  해체전: 25, 조립후: 25, 기계도입시: 25, 특수진단후: 25, 지정시: 20,
  주기검사: 20, 수시: 15, "건설 2일1회 / 기타 주1회": 60, "건설 2개월1회 / 기타 분기": 55,
};

function freqEmoji(f: string): string {
  const p = FREQ_ORDER[f] ?? 10;
  if (p >= 99) return "🔴";
  if (p >= 80) return "🟠";
  if (p >= 50) return "🟡";
  if (p >= 25) return "🟢";
  return "⚪";
}

function callMcp(tool: string, input: Record<string, unknown> = {}): { ok: boolean; data?: any; text?: string; reason?: string } {
  const res = spawnSync("node", [CLI, "call", tool, "--inputJson", JSON.stringify(input)], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0) return { ok: false, reason: `exit=${res.status}` };
  try {
    const parsed = JSON.parse(res.stdout);
    if (parsed.isError) return { ok: false, reason: parsed.content?.[0]?.text };
    return { ok: true, data: parsed.structuredContent, text: parsed.content?.[0]?.text };
  } catch (e: any) {
    return { ok: false, reason: e.message };
  }
}

// verify_safety_basis / review_safety_document 전용 — isError(미지원 결론 등)여도 structuredContent 를
// 분석 결과로 반환한다(검증 도구는 "근거 불충분"을 정상 진단으로 출력하므로). callMcp shape 불변, 응답 파싱만.
function callMcpAllowError(tool: string, input: Record<string, unknown> = {}): { ok: boolean; data?: any; text?: string; reason?: string } {
  const res = spawnSync("node", [CLI, "call", tool, "--inputJson", JSON.stringify(input)], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  // 검증 도구는 isError 시 exit=1 이지만 stdout 에 분석 JSON(structuredContent)을 그대로 담는다.
  // exit code 와 무관하게 stdout 을 우선 파싱한다. 파싱 실패 시에만 실패 처리.
  try {
    const parsed = JSON.parse(res.stdout);
    if (parsed && (parsed.structuredContent || parsed.content)) {
      return { ok: true, data: parsed.structuredContent, text: parsed.content?.[0]?.text };
    }
    return { ok: false, reason: `exit=${res.status}` };
  } catch {
    return { ok: false, reason: `exit=${res.status}` };
  }
}

// === 문서 상태기계 (DP-2) — viewer 자체 로컬 메타 파일. MCP 응답 shape 과 무관. ===
// 저장 위치: ~/.agent-safety-oss/_workflow/{docId}-local.json (SAFETY_LOCAL_DIR 우선, local-storage 패턴 재사용)
// 상태: draft → pending → approved/rejected → sent → received
function workflowRoot(): string {
  const override = process.env.SAFETY_LOCAL_DIR;
  const base = override ? resolve(override) : resolve(homedir(), ".agent-safety-oss");
  return resolve(base, "_workflow");
}
interface WorkflowHistory { actor: string; verb: string; at: string; reason?: string; note?: string }
interface WorkflowState {
  docId: string;
  title?: string;
  state: "draft" | "pending" | "approved" | "rejected" | "sent" | "received";
  author?: string;       // 작성자 역할 (자동 결재선 주입, F-sub-3)
  approver?: string;     // 결재자 역할
  recipient?: string;    // 수신자 역할
  coAuthors?: string[];  // 다자 작성 귀속 (F-sub-4)
  authMode?: string;     // "self-selected-role": 역할이 미인증 자가선택값임을 명시(서명 아님, critic C2)
  updatedAt: string;
  history: WorkflowHistory[];
}
function safeDocId(docId: string): boolean { return /^[a-zA-Z0-9_-]+$/.test(docId); }
function workflowPath(docId: string): string { return join(workflowRoot(), docId + "-local.json"); }
function readWorkflow(docId: string): WorkflowState | null {
  try {
    const p = workflowPath(docId);
    const legacy = join(workflowRoot(), docId + ".json");
    const path = existsSync(p) ? p : legacy;
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as WorkflowState;
  } catch { return null; }
}
function writeWorkflow(w: WorkflowState): void {
  const dir = workflowRoot();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  w.updatedAt = new Date().toISOString();
  writeFileSync(workflowPath(w.docId), JSON.stringify(w, null, 2), "utf8");
}
function listWorkflows(): WorkflowState[] {
  try {
    const dir = workflowRoot();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")) as WorkflowState; } catch { return null; } })
      .filter((w): w is WorkflowState => !!w);
  } catch { return []; }
}
// === 보관문서 읽기 (P1-CU5) — local-storage 의 documents/{docId}/*. 신규 MCP 도구 없이 viewer 가 직접 FS read. ===
// 동일 머신 파일 읽기 — 신규 외부 네트워크 0 (offline-first 유지). SAFETY_LOCAL_DIR override 반영(workflowRoot 와 동일 base).
function documentsRoot(): string {
  const override = process.env.SAFETY_LOCAL_DIR;
  const base = override ? resolve(override) : resolve(homedir(), ".agent-safety-oss");
  return resolve(base, "documents");
}
interface ArchivedFile { docId: string; title: string; category: string; filename: string; format: string; byteSize: number; archivedAt: string }
function listArchivedFiles(): ArchivedFile[] {
  const out: ArchivedFile[] = [];
  try {
    const root = documentsRoot();
    if (!existsSync(root)) return [];
    for (const docId of readdirSync(root)) {
      if (!safeDocId(docId)) continue;
      const subdir = join(root, docId);
      let files: string[];
      try { files = readdirSync(subdir); } catch { continue; }
      const m = loadMaster().find((x) => x.docId === docId);
      for (const f of files) {
        try {
          const full = join(subdir, f);
          const st = statSync(full);
          if (!st.isFile()) continue;
          const ext = (f.split(".").pop() || "").toLowerCase();
          out.push({
            docId, title: m ? m.title : docId, category: m ? m.category : "",
            filename: f, format: ext === "md" ? "markdown" : ext,
            byteSize: st.size, archivedAt: st.mtime.toISOString(),
          });
        } catch { /* skip */ }
      }
    }
  } catch { /* empty */ }
  return out.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}
function readArchivedFile(docId: string, filename: string): string | null {
  // path traversal 가드 — docId·filename 둘 다 정상화 후 documents/ 내부 검증.
  if (!safeDocId(docId)) return null;
  if (typeof filename !== "string" || filename.includes("..") || filename.includes("/") || filename.includes("\\") || filename === "") return null;
  const root = documentsRoot();
  const target = resolve(root, docId, filename);
  if (!target.startsWith(resolve(root) + "/")) return null;
  try { return readFileSync(target, "utf8"); } catch { return null; }
}

// docId → 한국어 제목 (master 기준, 없으면 docId)
function docTitle(docId: string): string {
  const d = loadMaster().find((m) => m.docId === docId);
  return d ? d.title : docId;
}

const HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>/Igent_Safety_OSS</title>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Google+Sans+Display:wght@700;900&family=Roboto+Mono:wght@400;500&family=Material+Symbols+Outlined&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
<style>
  /* === Design System v2 — Token Contract (핵심만 inline) === */
  :root {
    /* Primitive */
    --gray-50:#FAFAFA; --gray-100:#F5F5F5; --gray-200:#EEEEEE; --gray-300:#E0E0E0;
    --gray-400:#BDBDBD; --gray-500:#9E9E9E; --gray-600:#757575; --gray-700:#616161;
    --gray-800:#424242; --gray-900:#212121; --gray-950:#141414; --gray-1000:#0A0A0A;
    --red-600:#DC2626; --amber-500:#F59E0B; --green-600:#16A34A; --blue-600:#2563EB;

    /* Semantic */
    --foreground: var(--gray-1000);
    --foreground-secondary: var(--gray-700);
    --foreground-tertiary: var(--gray-600);
    --background: #FFFFFF;
    --surface: var(--gray-50);
    --surface-secondary: var(--gray-100);
    --border: var(--gray-300);
    --border-strong: var(--gray-400);
    --primary: var(--gray-1000);
    --primary-hover: var(--gray-900);
    --primary-foreground: #FFFFFF;
    --success: var(--green-600);
    --warning: var(--amber-500);
    --error: var(--red-600);
    --info: var(--blue-600);

    /* Component */
    --component-height: 40px;
    --component-radius: 4px;
    --component-gap: 8px;
    --card-padding: 24px;
    --card-radius: 6px;
    --container-radius: 8px;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.08);

    /* Spacing */
    --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
    --space-6:24px; --space-8:32px; --space-12:48px; --space-16:64px;

    /* Typography */
    --font-sans: "Google Sans", -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    --font-display: "Google Sans Display", "Google Sans", sans-serif;
    --font-mono: "Roboto Mono", "SF Mono", Consolas, monospace;
  }

  * { box-sizing: border-box; }
  body { font-family: var(--font-sans); margin:0; padding:0; background: var(--background); color: var(--foreground); line-height: 1.55; }

  .layout { max-width: 1600px; margin: 0 auto; padding: var(--space-6) var(--space-4) var(--space-12); }

  /* === 좌우 분할 (좌: 입력 폼 / 우: 양식 실시간 미리보기) === */
  .split-area { display: grid; grid-template-columns: minmax(440px, 1fr) minmax(440px, 1.15fr); gap: var(--space-6); align-items: start; margin-top: var(--space-2); }
  .split-area > #form-container { min-width: 0; }
  .split-area > #preview-container { min-width: 0; position: sticky; top: var(--space-3); max-height: calc(100vh - var(--space-6)); overflow-y: auto; }
  /* Profile 모드 — 우측 미사용, 폼 단독 (공통 메타는 양식 없음) */
  .split-area.profile-mode { grid-template-columns: 1fr; max-width: 920px; margin-left: auto; margin-right: auto; }
  .split-area.profile-mode > #preview-container { display: none; }
  /* 분할 화면일 때 preview-panel 의 max-height 는 sticky 컨테이너가 제어 */
  .split-area .preview-panel.preview-doc .preview-body { max-height: none; }
  .split-area .preview-panel .preview-body { max-height: none; }

  /* 분할 임계값 — 1080px 이하면 세로 배치 (태블릿/모바일 자연 fallback) */
  @media (max-width: 1080px) {
    .split-area { grid-template-columns: 1fr; }
    .split-area > #preview-container { position: static; max-height: none; }
  }


  /* === Header === */
  .agent-header { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-4) 0; border-bottom: 1px solid var(--border); margin-bottom: var(--space-6); }
  .agent-logo { font-family: var(--font-display); font-weight: 900; font-size: 24px; color: var(--foreground); letter-spacing: -0.02em; }
  .agent-tagline { font-size: 13px; color: var(--foreground-secondary); margin-left: auto; }

  /* === Toolbar === */
  .agent-toolbar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-3) 0 var(--space-4); border-bottom: 1px solid var(--border); margin-bottom: var(--space-6); }
  .agent-button { display: inline-flex; align-items: center; gap: var(--space-2); height: var(--component-height); padding: 0 var(--space-4); border-radius: var(--component-radius); border: 1px solid var(--border-strong); background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-size: 14px; font-weight: 500; cursor: pointer; box-sizing: border-box; transition: background .12s ease, border-color .12s ease; }
  .agent-button:hover { background: var(--surface); }
  .agent-button.is-active { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
  .agent-button.material { gap: 6px; }
  .agent-button .material-symbols-outlined { font-size: 18px; }

  .agent-input-group { flex: 1; display: flex; align-items: center; gap: var(--space-2); }
  .agent-label { font-size: 13px; color: var(--foreground-secondary); white-space: nowrap; }
  .agent-select, .agent-input { height: var(--component-height); padding: 0 var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--component-radius); background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-size: 14px; box-sizing: border-box; }
  /* select 커스텀 화살표 — 브라우저 기본보다 적절한 여백 */
  .agent-select { flex: 1; min-width: 240px; padding-right: 36px; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%23616161' d='M0 0l5 6 5-6z'/></svg>"); background-repeat: no-repeat; background-position: right 14px center; cursor: pointer; }
  .agent-input { width: 220px; }
  .agent-select:focus, .agent-input:focus { outline: 2px solid var(--primary); outline-offset: -1px; border-color: var(--primary); }

  .agent-select-mini { flex: 0 0 auto; min-width: 130px; }

  /* === 역할 스위처 (현장 공용 단말 — 로그인 아님) === */
  .role-bar { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; padding: var(--space-3) 0; margin-bottom: var(--space-2); }
  .role-bar .role-label { font-size: 13px; color: var(--foreground-secondary); margin-right: var(--space-1); }
  .role-chip { display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 0 var(--space-4); border-radius: 999px; border: 1px solid var(--border-strong); background: var(--background); color: var(--foreground-secondary); font-family: var(--font-sans); font-size: 14px; font-weight: 500; cursor: pointer; transition: all .12s ease; }
  .role-chip:hover { background: var(--surface); }
  .role-chip.is-active { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
  .role-chip .material-symbols-outlined { font-size: 18px; }
  .role-emergency { margin-left: auto; background: var(--background); color: var(--error); border-color: var(--error); }
  .role-emergency:hover { background: #FEF2F2; }

  /* === 역할 홈 (3 레인) === */
  .home-lanes { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); margin-top: var(--space-4); }
  @media (max-width: 1080px) { .home-lanes { grid-template-columns: 1fr; } }
  .lane { border: 1px solid var(--border); border-radius: var(--container-radius); background: var(--surface); overflow: hidden; }
  .lane-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); background: var(--background); }
  .lane-head h2 { font-family: var(--font-display); font-size: 16px; font-weight: 700; margin: 0; }
  .lane-head .material-symbols-outlined { font-size: 20px; color: var(--foreground-secondary); }
  .lane-count { margin-left: auto; font-size: 12px; color: var(--foreground-tertiary); font-family: var(--font-mono); }
  .lane-body { padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); max-height: 60vh; overflow-y: auto; }
  .lane-empty { color: var(--foreground-tertiary); font-size: 13px; padding: var(--space-4) var(--space-2); text-align: center; }
  .doc-card { display: flex; flex-direction: column; gap: 4px; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--card-radius); background: var(--background); cursor: pointer; transition: border-color .12s ease, box-shadow .12s ease; text-align: left; font-family: var(--font-sans); width: 100%; }
  .doc-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
  .doc-card-title { font-size: 14px; font-weight: 600; color: var(--foreground); }
  .doc-card-meta { font-size: 12px; color: var(--foreground-tertiary); display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }

  /* === 문서 상태 배지 (6종 상태기계 + 의무 긴급도) === */
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; line-height: 1.5; }
  .badge .material-symbols-outlined { font-size: 13px; }
  .badge-draft { background: var(--gray-200); color: var(--gray-700); }
  .badge-pending { background: #FFF7ED; color: #C2410C; border: 1px solid var(--amber-500); }
  .badge-approved { background: #ECFDF5; color: #047857; border: 1px solid var(--green-600); }
  .badge-rejected { background: #FEF2F2; color: #B91C1C; border: 1px solid var(--error); }
  .badge-sent { background: #EFF6FF; color: #1D4ED8; border: 1px solid var(--blue-600); }
  .badge-received { background: #ECFEFF; color: #0E7490; border: 1px solid #0891B2; }
  .badge-overdue { background: #FEF2F2; color: #B91C1C; }
  .badge-imminent { background: #FFF7ED; color: #C2410C; }
  .badge-upcoming { background: var(--surface-secondary); color: var(--foreground-secondary); }

  /* === 결재 워크플로우 바 === */
  #workflow-bar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-3) var(--space-4); margin: 0 0 var(--space-4); }
  #workflow-bar .wf-state { display: flex; align-items: center; gap: var(--space-2); font-size: 13px; color: var(--foreground-secondary); }
  #workflow-bar .wf-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-left: auto; }
  #workflow-bar .wf-actions .Button { height: 44px; }
  #workflow-bar .wf-approver { min-height: 44px; }
  #workflow-bar .wf-hist { width: 100%; margin-top: var(--space-2); font-size: 12px; color: var(--foreground-tertiary); }
  #workflow-bar .wf-hist li { line-height: 1.7; }
  /* 연계 바 (P2-CU9) — MSDS↔교육·대장 단계 전환 */
  #link-bar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-3) var(--space-4); margin: 0 0 var(--space-4); border: 1px solid var(--border); border-left: 3px solid var(--info); border-radius: var(--component-radius); background: var(--surface); }
  #link-bar .link-msg { font-size: 13px; color: var(--foreground-secondary); }
  #link-bar .link-btn { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 var(--space-4); border: 1px solid var(--border-strong); border-radius: var(--component-radius); background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-size: 14px; font-weight: 500; cursor: pointer; }
  #link-bar .link-btn:hover { background: var(--background-secondary); }
  #link-bar .link-btn .material-symbols-outlined { font-size: 18px; color: var(--info); }
  @media (max-width: 768px) { #link-bar .link-btn { width: 100%; justify-content: center; min-height: 48px; } }

  /* === read-only 수신/열람 뷰 (P1-CU4) === */
  .readonly-doc { background: var(--background); border: 1px solid var(--border); border-radius: var(--card-radius); padding: var(--card-padding); }
  .readonly-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-3); }
  .readonly-title { font-family: var(--font-display); font-size: 20px; font-weight: 700; margin: 0 0 var(--space-3); color: var(--foreground); }
  .readonly-body { padding: var(--space-3) 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .readonly-actions { margin-top: var(--space-3); }
  .readonly-comment { margin-top: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
  .readonly-comment textarea { width: 100%; min-height: 56px; }
  .health-gate { text-align: center; padding: var(--space-8) var(--space-4); display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
  .health-gate-ic { font-size: 48px; color: var(--warning); }
  .health-gate .caption { max-width: 520px; line-height: 1.7; }

  /* === 보관문서 (P1-CU5) === */
  #archive-view { display: none; }
  .arc-bar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-4); }
  .arc-bar h2 { margin: 0; font-family: var(--font-display); font-size: 20px; }
  .arc-bar input[type="search"] { flex: 1; min-width: 220px; }
  .arc-actions { display: flex; gap: var(--space-2); }
  .arc-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .arc-table th, .arc-table td { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); }
  .arc-table th { color: var(--foreground-tertiary); font-weight: 600; font-size: 12px; }
  .arc-table tbody tr:hover { background: var(--surface); }
  .arc-table .arc-link { background: none; border: none; color: var(--info); cursor: pointer; font: inherit; padding: 0; text-decoration: underline; }
  .arc-empty { padding: var(--space-8); text-align: center; color: var(--foreground-tertiary); }

  /* === 비상 시간순 워크플로우 (P1-CU6) === */
  #emergency-view { display: none; }
  .emg-warn { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-4); border: 2px solid var(--error); border-radius: var(--card-radius); background: rgba(220,38,38,0.06); color: var(--error); font-weight: 600; margin-bottom: var(--space-4); }
  .emg-warn .material-symbols-outlined { font-size: 28px; }
  .emg-steps { display: flex; flex-direction: column; gap: var(--space-4); }
  .emg-step { border: 1px solid var(--border); border-radius: var(--card-radius); padding: var(--card-padding); background: var(--background); }
  .emg-step-head { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2); }
  .emg-step-no { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: var(--primary); color: var(--primary-foreground); font-weight: 700; flex-shrink: 0; }
  .emg-step h3 { margin: 0; font-size: 17px; }
  .emg-step .emg-when { margin-left: auto; font-size: 13px; color: var(--foreground-tertiary); }
  .emg-call-btns { display: flex; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-2); }
  .emg-call { display: inline-flex; align-items: center; gap: var(--space-2); min-height: 56px; padding: 0 var(--space-6); border-radius: var(--component-radius); border: 2px solid var(--error); background: var(--error); color: #fff; font-size: 18px; font-weight: 700; text-decoration: none; }
  .emg-call.secondary { background: var(--background); color: var(--error); }
  .emg-link { display: inline-flex; align-items: center; gap: var(--space-2); min-height: 48px; padding: 0 var(--space-4); border-radius: var(--component-radius); border: 1px solid var(--info); background: var(--background); color: var(--info); font-weight: 600; text-decoration: none; margin-top: var(--space-2); }

  /* === 우측 패널 모드 탭 === */
  .preview-tabs { display: flex; gap: var(--space-1); flex-wrap: wrap; margin: var(--space-2) 0 0; }
  .preview-tab { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--component-radius); background: var(--background); color: var(--foreground-secondary); font-family: var(--font-sans); font-size: 13px; font-weight: 500; cursor: pointer; }
  .preview-tab:hover { background: var(--surface); }
  .preview-tab.is-active { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
  .preview-tab .material-symbols-outlined { font-size: 16px; }

  /* === Card / Section === */
  .agent-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--card-radius); padding: var(--card-padding); margin: var(--space-4) 0; }
  .agent-card.elevated { background: var(--background); box-shadow: var(--shadow-sm); }
  .agent-card-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; margin: 0 0 var(--space-2); color: var(--foreground); }
  .agent-card-body { color: var(--foreground-secondary); font-size: 14px; }

  /* === A2UI 컴포넌트 매핑 === */
  .Column { display: flex; flex-direction: column; gap: var(--space-3); }
  .Row { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
  .Row.spaceBetween { justify-content: space-between; }
  .Card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--card-radius); padding: var(--space-6); margin: var(--space-3) 0; }

  /* Text usageHint variants */
  .h1 { font-family: var(--font-display); font-size: 26px; font-weight: 800; margin: var(--space-4) 0 var(--space-2); color: var(--foreground); letter-spacing: -0.02em; }
  .h2 { font-family: var(--font-display); font-size: 17px; font-weight: 700; margin: var(--space-6) 0 var(--space-2); color: var(--foreground); padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .body { color: var(--foreground); font-size: 14px; margin: var(--space-1) 0; }
  .caption { color: var(--foreground-tertiary); font-size: 12px; line-height: 1.5; margin: var(--space-1) 0; }

  /* Field block (TextField wrapper) */
  .field-block { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-3) 0; }
  .field-block .label { font-size: 13px; font-weight: 500; color: var(--foreground); margin-bottom: 2px; }
  /* 필수 표시 (P2-CU7) — 라벨 별표 + 누락 가드 하이라이트 */
  .field-block .label .req-star { color: var(--error); font-weight: 700; margin-left: 3px; }
  .field-block.is-missing input, .field-block.is-missing textarea, .field-block.is-missing select { border-color: var(--error); background: #FEF2F2; }
  .field-block.is-missing .label { color: var(--error); }
  /* 인라인 힌트 (F-sub-6) — 입력칸 아래 가이드 */
  .field-block .field-hint { color: var(--foreground-tertiary); font-size: 12px; line-height: 1.5; padding-left: 2px; }
  .field-block input, .field-block textarea, .field-block select { height: var(--component-height); padding: 0 var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--component-radius); background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-size: 14px; box-sizing: border-box; }
  .field-block select { padding-right: 36px; cursor: pointer; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%23616161' d='M0 0l5 6 5-6z'/></svg>"); background-repeat: no-repeat; background-position: right 14px center; }
  .field-block input[type="date"], .field-block input[type="datetime-local"], .field-block input[type="time"] { font-family: var(--font-mono); }
  .field-block input[type="number"] { font-variant-numeric: tabular-nums; }
  .field-block textarea { height: auto; min-height: 96px; padding: var(--space-3); resize: vertical; line-height: 1.55; }
  .field-block input:focus, .field-block textarea:focus { outline: 2px solid var(--primary); outline-offset: -1px; border-color: var(--primary); }
  .field-block input::placeholder, .field-block textarea::placeholder { color: var(--foreground-tertiary); }
  .field-block .guide { color: var(--foreground-tertiary); font-size: 12px; padding-left: 2px; }

  /* Check toggle (3-state: 양호 / 불량 / 해당없음) */
  .check-toggle { display: flex; gap: var(--space-2); margin-bottom: var(--space-2); }
  .check-btn { display: inline-flex; align-items: center; gap: var(--space-1); height: var(--component-height); padding: 0 var(--space-4); border: 1px solid var(--border-strong); border-radius: var(--component-radius); background: var(--background); color: var(--foreground-secondary); font-family: var(--font-sans); font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; }
  .check-btn:hover { background: var(--background-secondary); }
  .check-btn .material-symbols-outlined { font-size: 18px; line-height: 1; }
  .check-btn.active { color: var(--background); border-color: transparent; }
  .check-btn-ok.active { background: var(--success, #10B981); }
  .check-btn-ng.active { background: var(--error, #DC2626); }
  .check-btn-na.active { background: var(--gray-700, #374151); }
  .field-block .check-note { height: var(--component-height); padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--component-radius); font-size: 13px; color: var(--foreground); }

  /* Button (A2UI) */
  .Button { display: inline-flex; align-items: center; gap: var(--space-2); height: var(--component-height); padding: 0 var(--space-6); border: 1px solid transparent; border-radius: var(--component-radius); cursor: pointer; font-family: var(--font-sans); font-size: 14px; font-weight: 500; box-sizing: border-box; }
  .Button.primary { background: var(--primary); color: var(--primary-foreground); }
  .Button.primary:hover { background: var(--primary-hover); }
  .Button.secondary { background: var(--surface); color: var(--foreground); border-color: var(--border-strong); }
  .Button.secondary:hover { background: var(--surface-secondary); }
  .Button .material-symbols-outlined { font-size: 18px; }
  /* Button child Text 의 색상 inherit (명시 cascade override) */
  .Button.primary :is(.body, .caption, .h1, .h2),
  .Button.primary > p, .Button.primary > small, .Button.primary > h1, .Button.primary > h2,
  .Button.primary span:not(.material-symbols-outlined) { color: var(--primary-foreground); }
  .Button.secondary :is(.body, .caption, .h1, .h2),
  .Button.secondary > p, .Button.secondary > small,
  .Button.secondary span:not(.material-symbols-outlined) { color: var(--foreground); }

  /* === Status === */
  #status { display: none; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-radius: var(--component-radius); margin: var(--space-4) 0; font-size: 13px; border: 1px solid transparent; }
  #status.ok { background: #ECFDF5; border-color: var(--success); color: #064E3B; display: flex; }
  #status.err { background: #FEF2F2; border-color: var(--error); color: #7F1D1D; display: flex; }
  #status.info { background: #FFFBEB; border-color: var(--warning); color: #78350F; display: flex; }
  #status .material-symbols-outlined { font-size: 18px; }
  #status.ok .material-symbols-outlined { color: var(--success); }
  #status.err .material-symbols-outlined { color: var(--error); }
  #status.info .material-symbols-outlined { color: var(--warning); }

  /* === Preview Panel === */
  .preview-panel { margin-top: var(--space-6); border: 1px solid var(--border); border-radius: var(--card-radius); background: var(--background); overflow: hidden; }
  .preview-panel h3 { margin: 0; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); background: var(--surface); font-family: var(--font-display); font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: var(--space-2); }
  .preview-panel h3 .preview-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preview-panel h3 .preview-actions { display: flex; gap: var(--space-1); flex-wrap: wrap; }
  .preview-panel h3 .preview-action { height: 30px; padding: 0 var(--space-2); font-size: 12px; font-weight: 500; gap: 4px; }
  .preview-panel h3 .preview-action .material-symbols-outlined { font-size: 14px; }
  /* 모바일/협소 폭에서 액션 줄바꿈 */
  @media (max-width: 720px) {
    .preview-panel h3 { flex-wrap: wrap; }
    .preview-panel h3 .preview-actions { width: 100%; justify-content: flex-end; margin-top: var(--space-1); }
  }
  .preview-panel .preview-body { padding: var(--space-4) var(--space-6); max-height: 480px; overflow-y: auto; font-size: 13px; }
  .preview-panel pre { background: var(--surface); padding: var(--space-3); border-radius: var(--component-radius); overflow-x: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; }
  /* === Markdown HTML 양식 렌더 (marked 파싱 결과용 — 결재용 양식 스타일) === */
  .preview-panel .markdown { line-height: 1.7; color: var(--foreground); font-size: 14px; }
  .preview-panel .markdown h1 { font-family: var(--font-display); font-size: 22px; font-weight: 800; text-align: center; margin: 0 0 var(--space-6); padding-bottom: var(--space-3); border-bottom: 2px solid var(--gray-1000); letter-spacing: -0.02em; }
  .preview-panel .markdown h2 { font-family: var(--font-display); font-size: 16px; font-weight: 700; margin: var(--space-6) 0 var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
  .preview-panel .markdown h3 { font-family: var(--font-display); font-size: 14px; font-weight: 700; margin: var(--space-4) 0 var(--space-2); color: var(--foreground); }
  .preview-panel .markdown h4 { font-size: 13px; font-weight: 700; margin: var(--space-3) 0 var(--space-1); color: var(--foreground-secondary); }
  .preview-panel .markdown p { margin: var(--space-2) 0; }
  .preview-panel .markdown ul, .preview-panel .markdown ol { padding-left: var(--space-6); margin: var(--space-2) 0; }
  .preview-panel .markdown li { margin: var(--space-1) 0; }
  .preview-panel .markdown li > ul, .preview-panel .markdown li > ol { margin: 2px 0; }
  .preview-panel .markdown strong { font-weight: 700; color: var(--foreground); }
  .preview-panel .markdown em { font-style: italic; }
  .preview-panel .markdown code { background: var(--surface); padding: 1px 6px; border-radius: 3px; font-family: var(--font-mono); font-size: 12px; }
  .preview-panel .markdown blockquote { border-left: 3px solid var(--border-strong); padding: var(--space-2) var(--space-4); margin: var(--space-3) 0; color: var(--foreground-secondary); background: var(--surface); }
  .preview-panel .markdown hr { border: none; border-top: 1px solid var(--border); margin: var(--space-6) 0; }
  /* 결재용 표 — 흰 배경 + 검정 경계선 (공문서 표준) */
  .preview-panel .markdown table { width: 100%; border-collapse: collapse; margin: var(--space-3) 0; font-size: 13px; }
  .preview-panel .markdown thead { background: var(--surface); }
  .preview-panel .markdown th { padding: var(--space-2) var(--space-3); border: 1px solid var(--border-strong); text-align: left; font-weight: 700; vertical-align: middle; }
  .preview-panel .markdown td { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); vertical-align: top; }
  .preview-panel .markdown td:empty::before { content: ' '; }
  .preview-panel .markdown a { color: var(--info); text-decoration: underline; }
  /* preview-body 자체 max-height 늘리기 — 결재용 양식은 길어질 수 있음 */
  .preview-panel.preview-doc .preview-body { max-height: 720px; }

  /* === Material Symbols inline === */
  .inline-icon { font-size: 1.15em; vertical-align: -3px; margin-right: 4px; color: var(--foreground-tertiary); font-family: "Material Symbols Outlined"; font-weight: normal; font-style: normal; line-height: 1; letter-spacing: normal; text-transform: none; display: inline-block; white-space: nowrap; word-wrap: normal; direction: ltr; -webkit-font-feature-settings: "liga"; font-feature-settings: "liga"; -webkit-font-smoothing: antialiased; }
  .caption .inline-icon, .field-block .guide .inline-icon { font-size: 14px; color: var(--foreground-tertiary); }
  .body .inline-icon, p .inline-icon { font-size: 16px; }
  .preview-panel .markdown h1, .preview-panel .markdown h2, .preview-panel .markdown h3 { margin: var(--space-4) 0 var(--space-2); font-family: var(--font-display); }

  /* === 그래프 컨텍스트 — 사람 친화 표시 === */
  .ctx-section { padding: var(--space-4) 0; border-bottom: 1px solid var(--border); }
  .ctx-section:last-child { border-bottom: none; }
  .ctx-purpose { font-size: 15px; font-weight: 500; color: var(--foreground); line-height: 1.6; margin-bottom: var(--space-3); }
  .ctx-chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }
  .ctx-chip { display: inline-block; padding: 2px 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; font-size: 12px; color: var(--foreground-secondary); }
  .ctx-chip-iso { background: var(--gray-1000); color: var(--primary-foreground); border-color: var(--gray-1000); }
  .ctx-chip-mini { padding: 1px 8px; font-size: 11px; margin-left: var(--space-2); }
  .ctx-chip-field { display: inline-block; padding: 4px 10px; background: var(--surface-secondary); border-radius: var(--component-radius); font-size: 12px; color: var(--foreground); margin: 2px; font-family: var(--font-mono); }
  .ctx-chip-more { background: var(--gray-200); color: var(--foreground-tertiary); }
  .ctx-fields { display: flex; flex-wrap: wrap; gap: 4px; }
  .ctx-h { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-3); font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--foreground); }
  .ctx-h .material-symbols-outlined { font-size: 18px; color: var(--foreground-secondary); }
  .ctx-list { margin: 0; padding: 0; list-style: none; }
  .ctx-list li { padding: var(--space-2) 0; border-bottom: 1px solid var(--border); font-size: 13px; line-height: 1.6; }
  .ctx-list li:last-child { border-bottom: none; }
  .ctx-list li-warn { color: var(--error); }
  .ctx-excerpt { margin-top: var(--space-2); padding: var(--space-3) var(--space-4); background: var(--surface); border-left: 3px solid var(--gray-300); color: var(--foreground-secondary); font-size: 13px; line-height: 1.65; border-radius: 0 var(--component-radius) var(--component-radius) 0; }
  .ctx-excerpt strong { color: var(--foreground); font-weight: 600; }
  .ctx-excerpt em { font-style: italic; }
  .ctx-excerpt code { background: var(--background); padding: 1px 6px; border-radius: 3px; font-family: var(--font-mono); font-size: 12px; }
  .ctx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--space-2); }
  .ctx-hazards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-3); }
  .ctx-card-mini { padding: var(--space-3) var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--component-radius); font-size: 13px; }
  .ctx-card-head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2); }
  .ctx-card-head strong { font-size: 14px; }
  .ctx-desc { color: var(--foreground-secondary); font-size: 13px; line-height: 1.65; }
  .ctx-desc strong { color: var(--foreground); font-weight: 600; }
  .ctx-desc em { color: var(--foreground); font-style: italic; }
  .ctx-desc code { background: var(--surface-secondary); padding: 1px 6px; border-radius: 3px; font-family: var(--font-mono); font-size: 12px; }
  .ctx-callout { padding: var(--space-3) var(--space-4); background: var(--gray-1000); color: var(--primary-foreground); border-radius: var(--component-radius); font-weight: 500; font-size: 14px; }
  .ctx-callout.warn { background: var(--surface); color: var(--error); border: 1px solid var(--error); }
  .ctx-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .ctx-table th { text-align: left; padding: var(--space-2) var(--space-3); width: 110px; color: var(--foreground-secondary); font-weight: 500; border-bottom: 1px solid var(--border); vertical-align: top; }
  .ctx-table td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); color: var(--foreground); }
  .ctx-table a { color: var(--foreground); text-decoration: underline; }
  .ctx-footer-stat { padding-top: var(--space-3); color: var(--foreground-tertiary); font-size: 11px; font-family: var(--font-mono); text-align: right; }

  /* === Footer (Ratelworks) === */
  .agent-footer { margin-top: var(--space-16); padding: var(--space-6) 0; border-top: 1px solid var(--border); text-align: center; color: var(--foreground-secondary); font-size: 14px; line-height: 1.7; }
  .agent-footer strong { color: var(--foreground); font-family: var(--font-display); font-weight: 700; }
  .agent-footer a { color: var(--foreground); font-family: var(--font-display); font-weight: 700; text-decoration: none; }
  .agent-footer a:hover { text-decoration: underline; }

  /* === 모바일 반응형 — 현장 PDA/태블릿 우선 (split-area 는 1080px 임계값에서 이미 세로화) === */
  @media (max-width: 768px) {
    .layout { padding: var(--space-3) var(--space-2) var(--space-8); }
    .agent-header { flex-wrap: wrap; gap: var(--space-2); }
    .agent-tagline { margin-left: 0; font-size: 12px; }
    .agent-toolbar { flex-direction: column; align-items: stretch; gap: var(--space-2); }
    .agent-input-group { width: 100%; flex-wrap: wrap; gap: var(--space-2); }
    .agent-label { width: 100%; }
    .agent-select { min-width: 0; width: 100%; }
    .agent-input { width: 100%; }
    .agent-button { width: 100%; justify-content: center; }
    .agent-card { padding: var(--space-4); }
    .field-block { margin: var(--space-2) 0; }
    /* P2-CU8 — 모바일 터치타깃 ≥44px (현장 장갑·소형 화면). 40px 컨트롤을 48px 로 승격. */
    .field-block input, .field-block textarea, .field-block select { width: 100%; height: 48px; font-size: 16px; }
    .field-block textarea { height: auto; min-height: 96px; }
    .field-block .check-note { height: 48px; }
    .agent-button, .agent-select, .agent-input { height: 48px; font-size: 16px; }
    .check-toggle { flex-wrap: wrap; gap: var(--space-1); }
    /* 3-state 점검 토글 — 저숙련·장갑 현장 핵심 위젯, 더 크게(F-sub-5/KEEP-F) */
    .check-btn { flex: 1; min-width: calc(33% - var(--space-2)); min-height: 48px; padding: 0 var(--space-2); font-size: 15px; }
    .Button { width: 100%; min-height: 48px; justify-content: center; }
    .role-chip { min-height: 48px; }
    .emg-call { min-height: 64px; font-size: 19px; }
    .Row { flex-direction: column; align-items: stretch; }
    .Row.spaceBetween { flex-direction: column; }
    .preview-panel h3 { flex-wrap: wrap; padding: var(--space-3); }
    .preview-panel h3 .preview-download { width: 100%; margin-left: 0; margin-top: var(--space-2); }
    .preview-panel .preview-body { padding: var(--space-3); max-height: 360px; }
    .ctx-hazards { grid-template-columns: 1fr; }
    .ctx-grid { grid-template-columns: 1fr 1fr; }
    .ctx-table th { width: 80px; font-size: 12px; padding: var(--space-1) var(--space-2); }
    .ctx-table td { font-size: 12px; padding: var(--space-1) var(--space-2); }
    #status { padding: var(--space-2) var(--space-3); font-size: 12px; }
  }

  @media (max-width: 480px) {
    .h1 { font-size: 22px; }
    .h2 { font-size: 15px; }
    .body, .field-block .label { font-size: 13px; }
    .Card { padding: var(--space-3); }
  }

  /* === 인쇄용 (window.print() → PDF 저장 가능) === */
  @media print {
    @page { size: A4; margin: 18mm 14mm; }
    body { background: white; color: black; padding: 0; }
    .layout { padding: 0; max-width: 100%; }
    .agent-header, .agent-toolbar, #status, #form-container, .agent-footer { display: none !important; }
    #preview-container { margin: 0; }
    .preview-panel { border: none; box-shadow: none; margin: 0; }
    .preview-panel h3 { display: none; } /* viewer UI 헤더 숨김, 마크다운 자체 h1 이 결재용 제목 */
    .preview-panel .preview-body { max-height: none !important; padding: 0; overflow: visible; }
    .preview-panel .markdown { color: black; font-size: 11pt; line-height: 1.55; }
    .preview-panel .markdown h1 { font-size: 18pt; border-color: black; page-break-after: avoid; }
    .preview-panel .markdown h2 { font-size: 13pt; border-color: #444; page-break-after: avoid; }
    .preview-panel .markdown h3 { font-size: 11pt; page-break-after: avoid; }
    .preview-panel .markdown table { page-break-inside: avoid; }
    .preview-panel .markdown th, .preview-panel .markdown td { border-color: black; }
    .preview-panel .markdown thead { background: #EEE; }
    .preview-download { display: none !important; }
  }
</style>
</head>
<body>
<div class="layout">

<header class="agent-header">
  <div class="agent-logo"><span class="slash">/</span>Igent_Safety_OSS</div>
</header>

<!-- 역할 스위처 — 현장 공용 단말 전제(로그인 아님, "지금 누구로 작업?"). DP-1. -->
<div class="role-bar" id="role-bar"></div>

<div class="agent-toolbar">
  <button onclick="goHome()" id="nav-home" class="agent-button material is-active">
    <span class="material-symbols-outlined">home</span>
    홈
  </button>
  <button onclick="openArchive()" id="nav-archive" class="agent-button material">
    <span class="material-symbols-outlined">inventory_2</span>
    보관 문서
  </button>
  <button onclick="loadForm('profile')" id="nav-profile" class="agent-button material">
    <span class="material-symbols-outlined">settings</span>
    현장 정보 설정
  </button>
  <div class="agent-input-group">
    <select id="group-mode" class="agent-select agent-select-mini" onchange="renderDocSelect(allDocs)" title="문서 묶음 기준">
      <option value="category">분류별</option>
      <option value="frequency">작성 주기별</option>
    </select>
    <select id="doc-select" class="agent-select" onchange="if (this.value) loadForm('doc:' + this.value)">
      <option value="">— 선택 —</option>
    </select>
    <input type="search" id="doc-search" class="agent-input" placeholder="문서·작업 이름으로 검색" oninput="filterDocs(this.value)">
  </div>
</div>

<div id="status"></div>

<!-- 역할 홈 (3 레인) — 첫 화면. profile 강제 진입 제거. -->
<div id="home-view"></div>

<!-- 비상 시간순 워크플로우 (P1-CU6) — 중대재해 즉시보고. "작성=신고 아님" 경고 + 4 STEP. -->
<div id="emergency-view"></div>

<!-- 보관 문서 검색·조회·일괄 내보내기 (P1-CU5) — 감독 즉시제시. -->
<div id="archive-view"></div>

<!-- 문서 작업 영역 (좌 입력 / 우 미리보기 탭) — 홈에서는 숨김 -->
<div id="doc-view" style="display:none">
  <!-- 우측 패널 모드 명시 탭 4종 (F-sm-9 / W7) -->
  <div class="preview-tabs" id="preview-tabs">
    <button type="button" class="preview-tab is-active" data-tab="form" onclick="setPreviewTab('form')"><span class="material-symbols-outlined">description</span>양식 미리보기</button>
    <button type="button" class="preview-tab" data-tab="doc" onclick="setPreviewTab('doc')"><span class="material-symbols-outlined">article</span>생성 본문</button>
    <button type="button" class="preview-tab" data-tab="graph" onclick="setPreviewTab('graph')"><span class="material-symbols-outlined">hub</span>온톨로지 그래프</button>
    <button type="button" class="preview-tab" data-tab="verify" onclick="setPreviewTab('verify')"><span class="material-symbols-outlined">verified_user</span>법적 근거 검증</button>
  </div>
  <!-- 결재 워크플로우 바 (상태 배지 + 결재 액션). 상태기계 DP-2. -->
  <div id="workflow-bar" class="agent-card elevated" style="display:none"></div>
  <!-- 연계 바 (P2-CU9) — MSDS 등록↔교육, 대장 라이프사이클 단계 전환 진입. -->
  <div id="link-bar" style="display:none"></div>
  <div class="split-area">
    <div id="form-container"></div>
    <div id="preview-container"></div>
  </div>
</div>

<footer class="agent-footer">
  Provided by <strong>황룡건설(주)</strong> · Developed by <a href="mailto:alphamale@ratelworks.co.kr">R/ITEL WORKS</a>
</footer>

</div><!-- /.layout -->

<script>
let currentTarget = 'profile';
let fieldPathMap = {};
let currentRequiredLabels = [];   // P2-CU7 — 현재 폼의 필수 라벨(서버 /api/form 에서 .md 파싱)
let carryContext = null;          // P2-CU9 — 연계 진입 시 캐리오버 컨텍스트 { target, values }
// === 역할 (현장 공용 단말 내 역할 전환 — 로그인 아님, DP-1) ===
const ROLES = [
  { id: 'safety_manager',     label: '안전관리자', icon: 'shield' },
  { id: 'site_manager',       label: '현장소장',   icon: 'engineering' },
  { id: 'subcontractor_lead', label: '작업반장',   icon: 'construction' },
  { id: 'worker_rep',         label: '근로자대표', icon: 'groups' },
  { id: 'client_orderer',     label: '발주자',     icon: 'apartment' },
];
let currentRole = localStorage.getItem('asos.role') || 'safety_manager';
let activeView = 'home';          // 'home' | 'doc'
let viewMode = 'edit';            // 'edit' | 'view' — 수신/열람 read-only 모드 (P1-CU4)
let healthUnlocked = false;       // J_건강(보호 분류) 본인 확인 게이트 통과 여부 (F-wr-4 부분)
let previewTab = 'form';          // 양식 미리보기 | 생성 본문 | 그래프 | 검증
let lastGeneratedDoc = null;     // { docId, content, filename } — generate 본문 (MD 다운로드 호환)
let currentContext = null;       // 마지막으로 표시한 assemble_doc_context 의 docId — 토글용
let currentDocTitle = '';        // 현재 docId 의 한국어 제목 (실시간 양식 미리보기 헤더)
let formPreviewDebounce = null;  // 폼 입력 시 양식 미리보기 갱신 debounce
let lastRenderedMd = '';         // 우측에 마지막으로 그린 마크다운 본문 (MD 저장/인쇄용)

const root = document.getElementById('form-container');
const status = document.getElementById('status');

const STATUS_ICON = { ok: 'check_circle', err: 'error', info: 'info' };
// P2-CU7 — 오류 reason humanize 사전. raw 도구/프로세스 사유를 사람 말 + 복구 안내로 치환(F-sm-7/W5).
const ERROR_REASON_KO = [
  { re: /exit\\s*=?\\s*1|exit code\\s*1|exited with code 1/i, ko: '문서 생성 도구가 처리를 끝내지 못했습니다 — 필수 항목이 비어 있는지 확인 후 다시 시도하세요.' },
  { re: /ENOENT|no such file|not found/i, ko: '필요한 파일을 찾지 못했습니다 — 문서를 다시 선택하거나 관리자에게 문의하세요.' },
  { re: /EACCES|permission denied/i, ko: '저장 권한이 없습니다 — 보관 폴더 권한을 확인하거나 관리자에게 문의하세요.' },
  { re: /ECONNREFUSED|ETIMEDOUT|fetch failed|network/i, ko: '도구 응답을 받지 못했습니다 — 잠시 후 다시 시도하세요.' },
  { re: /invalid json|unexpected token|JSON/i, ko: '도구 응답을 해석하지 못했습니다 — 다시 시도하거나 관리자에게 문의하세요.' },
  { re: /timeout/i, ko: '처리 시간이 초과되었습니다 — 잠시 후 다시 시도하세요.' },
];
function humanizeReason(msg) {
  let out = String(msg || '');
  for (const r of ERROR_REASON_KO) {
    if (r.re.test(out)) {
      // raw 사유는 괄호로 보존하되 앞에 사람 말 + 복구안내를 둔다.
      const m = out.match(/[:：]\\s*(.+)$/);
      const raw = m ? m[1].trim() : '';
      out = r.ko + (raw ? ' (' + raw + ')' : '');
      break;
    }
  }
  return out;
}
function setStatus(kind, msg) {
  status.className = kind;
  const iconName = STATUS_ICON[kind] || 'info';
  // prefix 이모지 제거 + 본문 이모지 → Material Symbols 인라인 치환
  let cleanMsg = (msg || '').replace(/^✅\s*|^❌\s*|^⚠️?\s*|^💡\s*|^🔄\s*/, '');
  if (kind === 'err') cleanMsg = humanizeReason(cleanMsg);   // P2-CU7 오류 humanize + 복구 안내
  status.innerHTML = '<span class="material-symbols-outlined">' + iconName + '</span><span>' + replaceEmojiWithIcons(cleanMsg) + '</span>';
}

// === 역할 스위처 chrome ===
function roleLabel(id) { const r = ROLES.find(x => x.id === id); return r ? r.label : id; }
function renderRoleBar() {
  const bar = document.getElementById('role-bar');
  if (!bar) return;
  let html = '<span class="role-label">지금 누구로 작업하시나요?</span>';
  for (const r of ROLES) {
    const active = r.id === currentRole ? ' is-active' : '';
    html += '<button type="button" class="role-chip' + active + '" onclick="switchRole(\\'' + r.id + '\\')">' +
      '<span class="material-symbols-outlined">' + r.icon + '</span>' + r.label + '</button>';
  }
  // 긴급 진입 (P1-CU6 자리 — 현재는 안내). 모든 역할 공통.
  html += '<button type="button" class="role-chip role-emergency" onclick="openEmergency()" title="중대재해 즉시보고">' +
    '<span class="material-symbols-outlined">emergency</span>긴급</button>';
  bar.innerHTML = html;
}
function switchRole(id) {
  currentRole = id;
  try { localStorage.setItem('asos.role', id); } catch {}
  renderRoleBar();
  if (activeView === 'home') goHome();
}
// === 비상 시간순 워크플로우 (P1-CU6, UC-12) — "문서"가 아닌 시간순 절차로 재프레이밍 ===
// STEP1 전화(법정의무 최우선) → STEP2 e-노동민원(사용자 클릭 외부링크) → STEP3 즉시보고서 → STEP4 1개월 조사표.
const EMERGENCY_DOC = 'severe_accident_immediate_report';
const FOLLOWUP_DOC = 'industrial_accident_report';
async function openEmergency() {
  activeView = 'emergency';
  stopPolling();
  document.getElementById('home-view').style.display = 'none';
  document.getElementById('doc-view').style.display = 'none';
  const view = document.getElementById('emergency-view');
  view.style.display = 'block';
  document.querySelectorAll('.agent-toolbar .agent-button').forEach((b) => b.classList.remove('is-active'));
  setStatus('info', '비상 절차 — 전화 신고가 최우선 법정 의무입니다.');
  // 제출처·e-노동민원 URL 은 master 에서 실측(신규 네트워크 아님 — 로컬 callMcp).
  let submitTo = '관할 지방고용노동(지)청 + 119 + 경찰';
  let minwonUrl = 'https://minwon.moel.go.kr';
  let minwonSystem = '고용노동부 e-노동민원';
  try {
    const r = await fetch('/api/emergency-info');
    const d = await r.json();
    if (d.ok && d.data) {
      if (d.data.submitTo) submitTo = d.data.submitTo;
      if (d.data.electronicSubmission && d.data.electronicSubmission.url) minwonUrl = d.data.electronicSubmission.url;
      if (d.data.electronicSubmission && d.data.electronicSubmission.system) minwonSystem = d.data.electronicSubmission.system;
    }
  } catch {}
  view.innerHTML =
    '<div class="emg-warn"><span class="material-symbols-outlined">warning</span>' +
      '<span>이 화면은 신고를 대신하지 않습니다. 중대재해 발생 시 <strong>STEP 1 인명 구조·구급(119)</strong>이 최우선이며, <strong>관할 지방고용노동청 보고(STEP 2)가 산안법 제54조의 법정 보고 의무</strong>입니다. 보고서 작성(STEP 3)만으로는 신고가 완료되지 않습니다.</span></div>' +
    '<div class="emg-steps">' +
      // STEP 1 — 전화 (지금 즉시). 119/112 는 인명 구조·구급 우선조치이지 산안법 §54 "보고" 자체가 아니다(critic M1 L-4).
      '<section class="emg-step">' +
        '<div class="emg-step-head"><span class="emg-step-no">1</span><h3>지금 즉시 — 인명 구조·구급</h3><span class="emg-when">최우선 조치</span></div>' +
        '<p class="caption">제출처(법정 보고 대상): ' + escapeHtml(submitTo) + '</p>' +
        '<div class="emg-call-btns">' +
          '<a class="emg-call" href="tel:119"><span class="material-symbols-outlined">call</span>119 (소방·구급)</a>' +
          '<a class="emg-call secondary" href="tel:112"><span class="material-symbols-outlined">local_police</span>112 (경찰)</a>' +
          '<a class="emg-call secondary" href="tel:1350"><span class="material-symbols-outlined">support_agent</span>1350 (고용노동부)</a>' +
        '</div>' +
      '</section>' +
      // STEP 2 — e-노동민원 (지체없이)
      '<section class="emg-step">' +
        '<div class="emg-step-head"><span class="emg-step-no">2</span><h3>지체 없이 — ' + escapeHtml(minwonSystem) + '</h3><span class="emg-when">산안법 제54조 법정 보고</span></div>' +
        '<p class="caption">산안법 제54조②에 따라 관할 지방고용노동청에 <strong>지체 없이 보고</strong>해야 하는 본 절차입니다. 아래 링크는 새 탭에서 외부 사이트로 이동합니다.</p>' +
        '<a class="emg-link" href="' + escapeHtml(minwonUrl) + '" target="_blank" rel="noopener noreferrer"><span class="material-symbols-outlined">open_in_new</span>' + escapeHtml(minwonSystem) + ' 열기</a>' +
      '</section>' +
      // STEP 3 — 즉시보고서 작성
      '<section class="emg-step">' +
        '<div class="emg-step-head"><span class="emg-step-no">3</span><h3>즉시보고서 작성</h3><span class="emg-when">전화·전자 보고와 함께</span></div>' +
        '<p class="caption">중대재해 즉시보고서를 작성해 보관·증빙합니다. (작성만으로는 신고가 완료되지 않습니다.)</p>' +
        '<button type="button" class="Button primary" onclick="openEmergencyDoc(\\'' + EMERGENCY_DOC + '\\')"><span class="material-symbols-outlined">edit_document</span>즉시보고서 작성</button>' +
      '</section>' +
      // STEP 4 — 1개월 내 조사표 (후속 리마인드)
      '<section class="emg-step">' +
        '<div class="emg-step-head"><span class="emg-step-no">4</span><h3>1개월 이내 — 산업재해조사표</h3><span class="emg-when">후속 의무</span></div>' +
        '<p class="caption">재해 발생일로부터 1개월 이내에 산업재해조사표(별지 제30호)를 관할 노동청에 제출해야 합니다.</p>' +
        '<button type="button" class="Button secondary" onclick="openEmergencyDoc(\\'' + FOLLOWUP_DOC + '\\')"><span class="material-symbols-outlined">assignment</span>산업재해조사표 작성</button>' +
      '</section>' +
    '</div>';
}
// 비상 화면 → 보고서 작성 폼 진입 (작성=edit). 작성 후 결재/수신 상태기계에 합류.
function openEmergencyDoc(docId) {
  document.getElementById('emergency-view').style.display = 'none';
  const sel = document.getElementById('doc-select');
  if (sel) sel.value = docId;
  loadForm('doc:' + docId, 'edit');
}

// === 보관문서 검색·조회·일괄 내보내기 (P1-CU5, UC-17 감독 즉시제시) ===
let archiveItems = [];
async function openArchive() {
  activeView = 'archive';
  stopPolling();
  document.getElementById('home-view').style.display = 'none';
  document.getElementById('doc-view').style.display = 'none';
  const emg = document.getElementById('emergency-view'); if (emg) emg.style.display = 'none';
  const view = document.getElementById('archive-view');
  view.style.display = 'block';
  document.querySelectorAll('.agent-toolbar .agent-button').forEach((b) => b.classList.remove('is-active'));
  document.getElementById('nav-archive')?.classList.add('is-active');
  setStatus('info', '보관 문서를 불러오는 중...');
  try {
    const r = await fetch('/api/archive/list');
    const data = await r.json();
    archiveItems = data.ok ? (data.items || []) : [];
  } catch { archiveItems = []; }
  view.innerHTML =
    '<div class="agent-card elevated"><div class="arc-bar">' +
      '<h2><span class="material-symbols-outlined">inventory_2</span> 보관 문서</h2>' +
      '<input type="search" class="agent-input" placeholder="문서명·분류·일자로 검색" oninput="renderArchive(this.value)">' +
      '<div class="arc-actions">' +
        '<button type="button" class="Button secondary" onclick="batchExportArchive()"><span class="material-symbols-outlined">download</span>선택 일괄 내보내기</button>' +
      '</div>' +
    '</div><div id="arc-list"></div></div>';
  renderArchive('');
  setStatus('ok', '보관 문서 ' + archiveItems.length + '건');
}
function renderArchive(q) {
  const list = document.getElementById('arc-list');
  if (!list) return;
  const lower = (q || '').toLowerCase().trim();
  const items = lower ? archiveItems.filter((it) =>
    (it.title || '').toLowerCase().includes(lower) ||
    (it.docId || '').toLowerCase().includes(lower) ||
    humanizeCategory(it.category).toLowerCase().includes(lower) ||
    (it.archivedAt || '').toLowerCase().includes(lower)) : archiveItems;
  if (!items.length) { list.innerHTML = '<div class="arc-empty">' + (archiveItems.length ? '검색 결과가 없습니다.' : '보관된 문서가 없습니다 — 승인 시점에 보관됩니다.') + '</div>'; return; }
  list.innerHTML =
    '<table class="arc-table"><thead><tr>' +
      '<th><input type="checkbox" onchange="toggleAllArchive(this.checked)" title="전체 선택"></th>' +
      '<th>문서명</th><th>분류</th><th>보관 일시</th><th>형식</th><th>크기</th><th></th>' +
    '</tr></thead><tbody>' +
    items.map((it) =>
      '<tr>' +
        '<td><input type="checkbox" class="arc-check" data-docid="' + escapeHtml(it.docId) + '" data-filename="' + escapeHtml(it.filename) + '"></td>' +
        '<td>' + escapeHtml(it.title || it.docId) + '</td>' +
        '<td>' + escapeHtml(humanizeCategory(it.category)) + '</td>' +
        '<td>' + escapeHtml(String(it.archivedAt).slice(0, 16).replace('T', ' ')) + '</td>' +
        '<td>' + escapeHtml(it.format) + '</td>' +
        '<td>' + (it.byteSize ? (Math.round(it.byteSize / 102.4) / 10 + ' KB') : '') + '</td>' +
        '<td><button type="button" class="arc-link" onclick="viewArchived(\\'' + it.docId + '\\', \\'' + escapeHtml(it.filename) + '\\')">열람</button></td>' +
      '</tr>').join('') +
    '</tbody></table>';
}
function toggleAllArchive(checked) {
  document.querySelectorAll('.arc-check').forEach((c) => { c.checked = checked; });
}
// 보관문서 열람 — 읽기전용. 본문을 받아 새 탭(브라우저 인쇄·저장 가능)으로 표시.
async function viewArchived(docId, filename) {
  setStatus('info', '보관 문서 여는 중...');
  try {
    const r = await fetch('/api/archive/read?docId=' + encodeURIComponent(docId) + '&filename=' + encodeURIComponent(filename));
    const data = await r.json();
    if (!data.ok) { setStatus('err', '열람 실패: ' + (data.reason || 'unknown')); return; }
    const w = window.open('', '_blank');
    if (w) {
      const isHtml = /^\\s*</.test(data.content) || filename.endsWith('.html');
      w.document.write(isHtml ? data.content : '<pre style="white-space:pre-wrap;font-family:sans-serif;padding:24px">' + escapeHtml(data.content) + '</pre>');
      w.document.title = docTitleClient(docId) + ' — ' + filename;
      w.document.close();
    }
    setStatus('ok', '보관 문서 열람 — ' + filename);
  } catch (e) { setStatus('err', '오류: ' + e.message); }
}
function docTitleClient(docId) { const d = allDocs.find((x) => x.docId === docId); return d ? d.title : docId; }
// 선택 문서 일괄 내보내기 — 순차 Blob 다운로드(기존 a[download] 재사용, zip 의존 없음).
async function batchExportArchive() {
  const checks = Array.from(document.querySelectorAll('.arc-check')).filter((c) => c.checked);
  if (!checks.length) { setStatus('err', '내보낼 문서를 선택하세요.'); return; }
  setStatus('info', checks.length + '건 내보내는 중...');
  let done = 0;
  for (const c of checks) {
    const docId = c.dataset.docid; const filename = c.dataset.filename;
    try {
      const r = await fetch('/api/archive/read?docId=' + encodeURIComponent(docId) + '&filename=' + encodeURIComponent(filename));
      const data = await r.json();
      if (!data.ok) continue;
      const blob = new Blob([data.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = docId + '-' + filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      done++;
      await new Promise((res) => setTimeout(res, 150));   // 브라우저 다중 다운로드 차단 완화
    } catch {}
  }
  setStatus('ok', done + '건 내보내기 완료');
}

// === 역할 홈 (3 레인: 할 일 / 결재함·검토함 / 수신함) ===
async function goHome() {
  activeView = 'home';
  currentTarget = 'profile';
  stopPolling();
  document.getElementById('doc-view').style.display = 'none';
  const emg = document.getElementById('emergency-view'); if (emg) emg.style.display = 'none';
  const arc = document.getElementById('archive-view'); if (arc) arc.style.display = 'none';
  const home = document.getElementById('home-view');
  home.style.display = 'block';
  document.querySelectorAll('.agent-toolbar .agent-button').forEach((b) => b.classList.remove('is-active'));
  document.getElementById('nav-home')?.classList.add('is-active');
  home.innerHTML = '<div class="home-lanes">' +
    laneShell('todo', 'list_alt', '내가 할 일') +
    laneShell('approval', 'approval', '내 결재함 · 검토함') +
    laneShell('inbox', 'inbox', '내 수신함') +
    '</div>';
  setStatus('info', roleLabel(currentRole) + ' 홈 — 오늘 할 일을 불러오는 중...');
  await Promise.all([fillTodoLane(), fillWorkflowLanes()]);
}
function laneShell(key, icon, title) {
  return '<section class="lane" id="lane-' + key + '">' +
    '<div class="lane-head"><span class="material-symbols-outlined">' + icon + '</span>' +
    '<h2>' + title + '</h2><span class="lane-count" id="lane-count-' + key + '"></span></div>' +
    '<div class="lane-body" id="lane-body-' + key + '"><div class="lane-empty">불러오는 중...</div></div></section>';
}
function dueBadge(d) {
  if (d.overdue) return '<span class="badge badge-overdue"><span class="material-symbols-outlined">priority_high</span>기한 초과</span>';
  if (typeof d.daysUntil === 'number' && d.daysUntil <= 7) return '<span class="badge badge-imminent">D-' + d.daysUntil + '일</span>';
  return '<span class="badge badge-upcoming">D-' + (d.daysUntil ?? '?') + '일</span>';
}
async function fillTodoLane() {
  const body = document.getElementById('lane-body-todo');
  const count = document.getElementById('lane-count-todo');
  if (!body) return;
  try {
    const [dutiesRes, workflowRes] = await Promise.all([
      fetch('/api/duties'),
      fetch('/api/workflow/list?role=' + encodeURIComponent(currentRole)),
    ]);
    const data = await dutiesRes.json();
    const wfData = await workflowRes.json().catch(() => ({ ok: false, items: [] }));
    const rejected = (wfData.ok ? (wfData.items || []) : [])
      .filter((it) => it.state === 'rejected' && it.author === currentRole);
    if (!data.ok) { body.innerHTML = '<div class="lane-empty">의무 목록을 불러오지 못했습니다.</div>'; return; }
    const duties = (data.data && data.data.duties) || [];
    if (count) count.textContent = (duties.length + rejected.length) + '건';
    if (!duties.length && !rejected.length) { body.innerHTML = '<div class="lane-empty">30일 이내 마감 의무와 보완요청이 없습니다.</div>'; return; }
    const reworkHtml = rejected.map((it) =>
      '<button type="button" class="doc-card" onclick="openWorkflowDoc(\\'' + it.docId + '\\', \\'edit\\')">' +
        '<span class="doc-card-title">' + escapeHtml(it.title || it.docId) + '</span>' +
        '<span class="doc-card-meta">' + stateBadge(it.state) + '<span>보완 후 다시 결재 올리기</span></span></button>').join('');
    const dutyHtml = duties.slice(0, 30).map((d) =>
      '<button type="button" class="doc-card" onclick="openDocFromHome(\\'' + d.docId + '\\')">' +
        '<span class="doc-card-title">' + escapeHtml(d.title || d.docId) + '</span>' +
        '<span class="doc-card-meta">' + dueBadge(d) +
          '<span>' + escapeHtml(humanizeCategory(d.category)) + '</span>' +
          (d.nextDueDate ? '<span>' + escapeHtml(d.nextDueDate) + '</span>' : '') +
        '</span></button>').join('');
    body.innerHTML = reworkHtml + dutyHtml;
  } catch (e) {
    body.innerHTML = '<div class="lane-empty">오류: ' + escapeHtml(e.message) + '</div>';
  }
}
// 결재함/검토함 + 수신함 — viewer 자체 상태기계(_workflow) 기반. (P0-CU2 에서 채움)
async function fillWorkflowLanes() {
  const lanes = { approval: 'lane-body-approval', inbox: 'lane-body-inbox' };
  let items = [];
  try {
    const r = await fetch('/api/workflow/list?role=' + encodeURIComponent(currentRole));
    const data = await r.json();
    if (data.ok) items = data.items || [];
  } catch {}
  // 결재함: pending 이고 approver=현재역할 / 검토 대상. 보호 분류(J_건강)는 결재함에 노출하지 않음(F-wr-4).
  const approvals = items.filter((it) => it.state === 'pending' && it.approver === currentRole && !isProtectedDoc(it.docId));
  // 수신함: sent/received 이고 recipient=현재역할. 역할은 미인증 자가선택값(DP-1)이므로 보호 분류(J_건강)는
  // 제목·메타를 마스킹해 역할 전환만으로 §129 대상 문서 존재가 드러나지 않게 한다(critic M3-HIGH). 실제 열람은
  // isProtectedDoc → read-only + 본인 확인 게이트(healthUnlocked)에서 한 번 더 통제. 강한 인증은 범위 밖(F-wr-4).
  const inbox = items
    .filter((it) => (it.state === 'sent' || it.state === 'received') && it.recipient === currentRole)
    .map((it) => isProtectedDoc(it.docId) ? { ...it, title: '🔒 보호 문서 — 본인 확인 후 열람', masked: true } : it);
  fillCardLane(lanes.approval, 'approval', approvals, '결재·검토 대기 문서가 없습니다.', 'edit');
  fillCardLane(lanes.inbox, 'inbox', inbox, '수신한 문서가 없습니다.', 'view');
}
function fillCardLane(bodyId, key, items, emptyMsg, mode) {
  const body = document.getElementById(bodyId);
  const count = document.getElementById('lane-count-' + key);
  if (!body) return;
  if (count) count.textContent = items.length + '건';
  if (!items.length) { body.innerHTML = '<div class="lane-empty">' + emptyMsg + '</div>'; return; }
  body.innerHTML = items.map((it) =>
    '<button type="button" class="doc-card" onclick="openWorkflowDoc(\\'' + it.docId + '\\', \\'' + (mode || 'edit') + '\\')">' +
      '<span class="doc-card-title">' + escapeHtml(it.title || it.docId) + '</span>' +
      '<span class="doc-card-meta">' + stateBadge(it.state) +
        (it.author ? '<span>작성 ' + escapeHtml(roleLabel(it.author)) + '</span>' : '') +
        (it.updatedAt ? '<span>' + escapeHtml(String(it.updatedAt).slice(0, 16).replace('T', ' ')) + '</span>' : '') +
      '</span></button>').join('');
}
const STATE_LABEL = { draft: '작성 중', pending: '결재 대기', approved: '승인됨', rejected: '반려', sent: '발송됨', received: '수신 확인' };
const STATE_ICON = { draft: 'edit', pending: 'pending', approved: 'check_circle', rejected: 'cancel', sent: 'send', received: 'mark_email_read' };
function stateBadge(state) {
  const lbl = STATE_LABEL[state] || state || '';
  const ic = STATE_ICON[state] || 'info';
  return '<span class="badge badge-' + (state || 'draft') + '"><span class="material-symbols-outlined">' + ic + '</span>' + lbl + '</span>';
}
// docId → master 분류(category). allDocs 에 이미 로드됨(/api/list-docs). (P1-CU4 보호게이트)
function docCategory(docId) { const d = allDocs.find((x) => x.docId === docId); return d ? d.category : ''; }
// J_건강 = 건강진단/유소견 통보 등 §129 비밀보장 대상. 작성 진입 차단 + 본인 확인 게이트 + read-only.
function isProtectedDoc(docId) { return docCategory(docId) === 'J_건강'; }

function openDocFromHome(docId) {
  const sel = document.getElementById('doc-select');
  if (sel) sel.value = docId;
  // 보호 분류(J_건강)는 작성 모드 진입 차단 — 항상 열람(read-only)으로만 연다(F-wr-4 부분).
  loadForm('doc:' + docId, isProtectedDoc(docId) ? 'view' : 'edit');
}
// 수신함/검토함에서 진입 — 결재함(pending)은 결재 검토(edit), 수신함(sent/received)은 read-only 열람.
function openWorkflowDoc(docId, mode) { openDocFromHome2(docId, mode); }
function openDocFromHome2(docId, mode) {
  const sel = document.getElementById('doc-select');
  if (sel) sel.value = docId;
  const forced = isProtectedDoc(docId) ? 'view' : (mode || 'edit');
  loadForm('doc:' + docId, forced);
}

// === 우측 패널 모드 탭 ===
function setPreviewTab(tab) {
  previewTab = tab;
  document.querySelectorAll('.preview-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  if (currentTarget === 'profile' || !currentTarget.startsWith('doc:')) return;
  if (tab === 'form') { currentContext = null; lastGeneratedDoc = null; refreshFormPreview(true); }
  else if (tab === 'doc') { currentContext = null; generatePreviewOnly(); }
  else if (tab === 'graph') {
    const docId = currentTarget.replace('doc:', '');
    if (currentContext !== docId) handleAction({ name: 'assemble_doc_context' });
  } else if (tab === 'verify') {
    if (lastVerifyData) renderVerifyPanel(lastVerifyData);
    else renderPreview('법적 근거 검증', '<p class="caption">[법적 근거 검증] 버튼을 눌러 본문의 조문 인용 정합성·환각을 점검하세요.</p>', 'context', false);
  }
}

// 생성 본문 탭 — generate 만 (보관 X). 영구 보관은 승인 시점(wfTransition approve)에만 발생(W8).
async function generatePreviewOnly() {
  const docId = currentTarget.replace('doc:', '');
  setStatus('info', '본문 생성 중...');
  try {
    const fv = collectFormValues();
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId, draft: fv }) });
    const data = await r.json();
    if (!data.ok) { setStatus('err', '생성 실패: ' + data.reason); return; }
    const rawMd = data.content || data.preview || '';
    lastGeneratedDoc = { docId, content: rawMd, filename: docId + '-' + new Date().toISOString().slice(0, 10) + '.md' };
    lastRenderedMd = rawMd;
    renderPreview('생성 본문 — ' + (currentDocTitle || docId), renderMarkdownPreview(rawMd), 'doc', true);
    setStatus('ok', '본문 ' + (data.length || rawMd.length) + '자 생성 (보관은 승인 시)');
  } catch (e) { setStatus('err', '오류: ' + e.message); }
}

// === 결재 워크플로우 바 (P0-CU2 상태기계) ===
let currentWorkflow = null;     // 현재 docId 의 _workflow 상태
let lastVerify = null;          // 마지막 verify_safety_basis summary (검증 칩·게이트용)
let lastVerifyData = null;      // 마지막 verify 전체 결과 (검증 탭 재표시용)
const APPROVER_BY_ROLE = { safety_manager: 'site_manager', subcontractor_lead: 'site_manager', site_manager: 'client_orderer', client_orderer: 'client_orderer', worker_rep: 'site_manager' };
// === P2-CU9 — 문서 연계 (MSDS 등록↔교육 / 대장 라이프사이클) ===
// 연계 정의: source docId → { to(다음 docId), label(버튼), carry(현재 폼값 키 → 다음 폼 키 매핑), msg }.
// 신규 라우트 0 — 기존 loadForm + draft 시스템 재사용. 캐리오버는 viewer 자체 carryContext.
const DOC_LINKS = {
  msds_register: {
    to: 'msds_education_log',
    label: '이 화학물질로 MSDS 교육일지 작성',
    msg: 'MSDS 비치대장 작성 후 — 취급 작업자 교육 일지로 연계(F-sm-5).',
    carry: { chemicalList: 'chemicals', siteName: 'siteName' },
  },
  basic_safety_health_register: {
    to: 'design_safety_health_register',
    label: '설계 안전보건대장으로 단계 전환',
    msg: '기본 안전보건대장 → 설계 단계로 진행(발주→설계 라이프사이클, UC-16).',
    carry: { siteName: 'siteName' },
  },
  design_safety_health_register: {
    to: 'construction_safety_health_register',
    label: '공사 안전보건대장으로 단계 전환',
    msg: '설계 안전보건대장 → 공사 단계로 진행(설계→시공 라이프사이클).',
    carry: { siteName: 'siteName' },
  },
};
function renderLinkBar() {
  const bar = document.getElementById('link-bar');
  if (!bar) return;
  // doc 모드가 아니거나 read-only(view) 면 숨김 — 작성 연계만.
  if (!currentTarget.startsWith('doc:') || viewMode === 'view') { bar.style.display = 'none'; return; }
  const docId = currentTarget.replace('doc:', '');
  const link = DOC_LINKS[docId];
  if (!link) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML =
    '<span class="material-symbols-outlined" style="color:var(--info)">link</span>' +
    '<span class="link-msg">' + escapeHtml(link.msg) + '</span>' +
    '<button type="button" class="link-btn" onclick="openLinkedDoc(\\'' + docId + '\\')">' +
    '<span class="material-symbols-outlined">arrow_forward</span>' + escapeHtml(link.label) + '</button>';
}
// 연계 진입 — 현재 폼값에서 carry 키를 추출해 다음 문서로 캐리오버.
function openLinkedDoc(fromDocId) {
  const link = DOC_LINKS[fromDocId];
  if (!link) return;
  const cur = collectFormValues();
  const values = {};
  for (const [srcKey, dstKey] of Object.entries(link.carry || {})) {
    const v = cur[srcKey];
    if (v != null && String(v).trim() !== '') values[dstKey] = v;
  }
  carryContext = { target: 'doc:' + link.to, values };
  setStatus('info', link.label + ' — 연계 정보 ' + Object.keys(values).length + '건 이어받음');
  loadForm('doc:' + link.to, 'edit');
}
// 폼 로드 후 캐리오버 값을 매칭 필드에 주입(draft 복원과 동일 매칭). 일치 target 일 때만.
function applyCarryContext() {
  if (!carryContext || carryContext.target !== currentTarget) return;
  const values = carryContext.values || {};
  carryContext = null;   // 1회성
  const inputs = document.querySelectorAll('#form-container [data-field-id]');
  let applied = 0;
  for (const [key, val] of Object.entries(values)) {
    for (const el of inputs) {
      const mappedKey = fieldPathMap[el.dataset.fieldId] || el.dataset.fieldKey || el.dataset.fieldId;
      if (el.dataset.fieldId === key || el.dataset.fieldKey === key || mappedKey === key) {
        el.value = String(val == null ? '' : val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        applied++;
        break;
      }
    }
  }
  if (applied > 0) setStatus('ok', '연계 정보 ' + applied + '건 자동 채움 — 이어서 작성하세요.');
}

async function loadWorkflowBar() {
  renderLinkBar();   // P2-CU9 — 연계 바 (MSDS↔교육·대장 단계). doc 가 아니면 내부에서 숨김.
  const bar = document.getElementById('workflow-bar');
  if (!bar) return;
  if (currentTarget === 'profile' || !currentTarget.startsWith('doc:')) { bar.style.display = 'none'; return; }
  const docId = currentTarget.replace('doc:', '');
  currentWorkflow = null;
  lastVerify = null; lastVerifyData = null;   // 새 문서 로드 시 이전 검증 칩 초기화
  try {
    const r = await fetch('/api/workflow/get?docId=' + encodeURIComponent(docId));
    const data = await r.json();
    if (data.ok && data.data) currentWorkflow = data.data;
  } catch {}
  renderWorkflowBar();
}
function renderWorkflowBar() {
  const bar = document.getElementById('workflow-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  const w = currentWorkflow;
  const state = w ? w.state : 'draft';
  let actions = '';
  // draft/없음 → 작성자: 결재 올리기 + 단독 결재(승인)
  if (!w || state === 'draft' || state === 'rejected') {
    const defApprover = APPROVER_BY_ROLE[currentRole] || 'site_manager';
    actions =
      '<label class="agent-label" for="wf-approver">결재자</label>' +
      '<select id="wf-approver" class="agent-select agent-select-mini wf-approver">' +
        ROLES.map((r) => '<option value="' + r.id + '"' + (r.id === defApprover ? ' selected' : '') + '>' + r.label + '</option>').join('') +
      '</select>' +
      '<button type="button" class="Button primary" onclick="wfTransition(\\'submit_for_review\\')"><span class="material-symbols-outlined">send</span>결재 올리기</button>' +
      '<button type="button" class="Button secondary" onclick="wfTransition(\\'approve\\')"><span class="material-symbols-outlined">approval</span>단독 결재(승인)</button>';
  } else if (state === 'pending') {
    // 결재자: 승인 / 반려
    actions =
      '<button type="button" class="Button primary" onclick="wfTransition(\\'approve\\')"><span class="material-symbols-outlined">check_circle</span>승인</button>' +
      '<button type="button" class="Button secondary" onclick="wfReject()"><span class="material-symbols-outlined">cancel</span>반려</button>';
  } else if (state === 'approved') {
    actions =
      '<label class="agent-label" for="wf-recipient">수신자</label>' +
      '<select id="wf-recipient" class="agent-select agent-select-mini wf-approver">' +
        ROLES.map((r) => '<option value="' + r.id + '"' + (r.id === 'client_orderer' ? ' selected' : '') + '>' + r.label + '</option>').join('') +
      '</select>' +
      '<button type="button" class="Button primary" onclick="wfTransition(\\'send\\')"><span class="material-symbols-outlined">forward_to_inbox</span>수신자에게 발송</button>' +
      '<span class="wf-unauth" title="이 발송/수신확인은 본 앱 안에서의 공유·추적입니다. 관할 노동청 등 행정기관 정식 접수·제출은 별도 절차(예: 비상화면의 e-노동민원)로 이루어집니다.">※ 앱 내부 공유·추적 — 행정기관 정식 제출 아님</span>';
  } else if (state === 'sent') {
    actions = '<button type="button" class="Button primary" onclick="wfTransition(\\'acknowledge\\')"><span class="material-symbols-outlined">mark_email_read</span>수신 확인</button>';
  }
  let hist = '';
  if (w && w.history && w.history.length) {
    hist = '<ul class="wf-hist">' + w.history.map((h) =>
      '<li>' + escapeHtml((String(h.at).slice(0, 16).replace('T', ' '))) + ' · ' + escapeHtml(roleLabel(h.actor)) + ' · ' +
      escapeHtml(VERB_LABEL[h.verb] || h.verb) + (h.reason ? ' — ' + escapeHtml(h.reason) : '') +
      (h.note ? ' — ' + escapeHtml(h.note) : '') + '</li>').join('') + '</ul>';
  }
  // 법적 근거 검증 버튼 (P1-CU3) — 결재 전 게이트(F-site-7). sent/received 이후엔 숨김.
  const verifyBtn = (state === 'draft' || state === 'rejected' || state === 'pending' || state === 'approved')
    ? '<button type="button" class="Button secondary" onclick="runVerify()"><span class="material-symbols-outlined">verified_user</span>법적 근거 검증</button>'
    : '';
  bar.innerHTML = '<div class="wf-state">' + stateBadge(state) +
    (w && w.author ? '<span>작성 ' + escapeHtml(roleLabel(w.author)) + '</span>' : '') +
    (w && w.approver ? '<span>· 결재 ' + escapeHtml(roleLabel(w.approver)) + '</span>' : '') +
    (lastVerify ? '<span>· ' + verifyChip(lastVerify) + '</span>' : '') +
    ((w && (w.author || w.approver)) ? '<span class="wf-unauth" title="역할 스위처는 로그인·전자서명이 아닙니다. 작성/결재 라벨은 운영자가 선택한 역할값이며 법적 결재 서명을 대체하지 않습니다.">· ⚠ 역할은 미인증 자가선택값(서명 아님)</span>' : '') +
    '</div><div class="wf-actions">' + verifyBtn + actions + '</div>' + hist;
}
// 검증 정량 칩 (KEEP-G N/M 패턴 재사용)
function verifyChip(sum) {
  if (!sum) return '';
  const ok = (sum.supported || 0) + (sum.partial || 0);
  const halluc = sum.hallucinationCount || 0;
  const cls = halluc > 0 ? 'badge-rejected' : (ok === sum.total ? 'badge-approved' : 'badge-imminent');
  return '<span class="badge ' + cls + '"><span class="material-symbols-outlined">verified_user</span>근거 ' + ok + '/' + (sum.total || 0) + ' · 환각 ' + halluc + '</span>';
}
const VERB_LABEL = { submit_for_review: '결재 올림', approve: '승인', reject: '반려', send: '발송', acknowledge: '수신 확인', comment: '의견' };
const VERB_DONE_MSG = { submit_for_review: '결재 올림 — 결재함에 등록되었습니다', approve: '승인 완료 — 본문 생성·보관됨', reject: '반려 처리 — 작성자에게 보완 요청', send: '발송 완료 — 수신함에 등록', acknowledge: '수신 확인 완료' };
// 단일 전이 POST. 성공 시 워크플로우 객체 반환, 실패(409/400/500) 시 null + 에러 상태.
// 핵심(critic M3): 전이를 *먼저* 확정하고, generate/archive 같은 부작용은 전이 성공 *후에만* 한다.
async function postTransition(payload) {
  try {
    const r = await fetch('/api/workflow/transition', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json();
    if (!data.ok) { setStatus('err', '상태 전이 실패: ' + (data.reason || 'unknown')); return null; }
    return data.data;
  } catch (e) { setStatus('err', '오류: ' + e.message); return null; }
}
async function wfTransition(verb, extra) {
  const docId = currentTarget.replace('doc:', '');
  // 단독 결재(UC-19): draft/rejected 에서 approve 를 누르면 submit_for_review(→pending) 를 먼저 확정한 뒤 approve.
  // 가드(approve←pending)와 정합하고, 전이가 거절되면 어떤 부작용(보관)도 일어나지 않게 한다.
  if (verb === 'approve') {
    const st = currentWorkflow ? currentWorkflow.state : 'draft';
    if (st === 'draft' || st === 'rejected') {
      const fv = collectFormValues();
      try { await fetch('/api/draft/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId, formValues: fv, autosave: false }) }); } catch {}
      const submitted = await postTransition({ docId, verb: 'submit_for_review', actor: currentRole, approver: currentRole, title: currentDocTitle || docId });
      if (!submitted) return;
      currentWorkflow = submitted;
    }
  }
  const payload = { docId, verb, actor: currentRole, title: currentDocTitle || docId };
  if (verb === 'submit_for_review') {
    const sel = document.getElementById('wf-approver');
    payload.approver = sel ? sel.value : 'site_manager';
    const fv = collectFormValues();
    try { await fetch('/api/draft/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId, formValues: fv, autosave: false }) }); } catch {}
  }
  if (verb === 'send') { const sel = document.getElementById('wf-recipient'); payload.recipient = sel ? sel.value : 'client_orderer'; }
  if (extra && extra.reason) payload.reason = extra.reason;
  // 1) 전이 먼저 확정 (가드 통과해야 진행).
  const data = await postTransition(payload);
  if (!data) return;
  currentWorkflow = data;
  // 2) 승인이 확정된 *후에만* 본문 생성+영구 보관 (W8). 보관 실패는 상태를 되돌리지 않고 경고만.
  if (verb === 'approve') {
    setStatus('info', '승인됨 — 본문 생성·보관 중...');
    try { await handleAction({ name: 'submit_safety_document', payload: { docId, archive: true } }); } catch (e) { setStatus('err', '승인됨(상태 approved) — 단, 본문 보관 실패: ' + e.message); }
  }
  renderWorkflowBar();
  setStatus('ok', VERB_DONE_MSG[verb] || '상태 전이 완료');
}
function wfReject() {
  const reason = prompt('반려 사유를 입력하세요 (작성자에게 전달됩니다):', '');
  if (reason === null) return;
  wfTransition('reject', { reason });
}

// === 법적 근거 검증 (P1-CU3) — verify_safety_basis 호출 + "검증" 탭 렌더 ===
async function runVerify() {
  const docId = currentTarget.replace('doc:', '');
  setPreviewTab('verify');
  setStatus('info', '법적 근거 검증 중 — 본문 생성 후 조문 정합성·환각 대조...');
  // 검증 대상 본문 = 마지막 생성 본문, 없으면 즉석 generate.
  let bodyMd = (lastGeneratedDoc && lastGeneratedDoc.content) || lastRenderedMd || '';
  try {
    if (!bodyMd) {
      const fv = collectFormValues();
      const gr = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId, draft: fv }) });
      const gd = await gr.json();
      if (gd.ok) bodyMd = gd.content || gd.preview || '';
    }
    const r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: bodyMd }) });
    const data = await r.json();
    if (!data.ok) { setStatus('err', '검증 실패: ' + (data.reason || 'unknown')); renderPreview('법적 근거 검증', '<p class="caption">검증 실패: ' + escapeHtml(data.reason || '') + '</p>', 'doc', false); return; }
    lastVerify = (data.data && data.data.summary) || null;
    lastVerifyData = data.data || null;
    renderVerifyPanel(data.data);
    renderWorkflowBar();   // 검증 칩 갱신
    const s = lastVerify || {};
    setStatus('ok', '검증 완료 — 근거 ' + ((s.supported || 0) + (s.partial || 0)) + '/' + (s.total || 0) + ' · 환각 ' + (s.hallucinationCount || 0) + ' · 본문 미수록 인용 ' + (s.inlineUnresolvedCount || 0));
  } catch (e) { setStatus('err', '오류: ' + e.message); }
}
const VERIFY_STATUS_KO = { supported: '근거 충족', partial: '부분 충족', unsupported: '근거 미흡', invalid: '부적합' };
const VERIFY_STATUS_CLS = { supported: 'badge-approved', partial: 'badge-imminent', unsupported: 'badge-rejected', invalid: 'badge-rejected' };
function renderVerifyPanel(d) {
  if (!d || !d.summary) { renderPreview('법적 근거 검증', '<p class="caption">검증 결과가 없습니다.</p>', 'doc', false); return; }
  const s = d.summary;
  const parts = [];
  // 정량 요약 칩 (KEEP-G N/M)
  parts.push('<section class="ctx-section">');
  parts.push('<div class="ctx-chips">');
  parts.push('<span class="ctx-chip">검증 문장 ' + (s.total || 0) + '건</span>');
  parts.push('<span class="ctx-chip">근거 충족 ' + (s.supported || 0) + '</span>');
  parts.push('<span class="ctx-chip">부분 ' + (s.partial || 0) + '</span>');
  parts.push('<span class="ctx-chip">미흡 ' + (s.unsupported || 0) + '</span>');
  parts.push('<span class="ctx-chip' + ((s.hallucinationCount || 0) > 0 ? ' ctx-chip-iso' : '') + '">환각 인용 ' + (s.hallucinationCount || 0) + '</span>');
  parts.push('<span class="ctx-chip">본문 미수록 인용 ' + (s.inlineUnresolvedCount || 0) + '</span>');
  parts.push('</div>');
  // 도구 한계 명시(critic M1 L-5): verify_safety_basis 는 인용 조문의 *존재·증거 weight·환각 여부*를 점검할 뿐,
  // "이 조문이 이 주장에 실제로 적용되는가"(의미적 entailment)는 검증하지 않는다. "근거 충족"은 법적 보증이 아니며
  // 최종 적합성 판단은 안전관리자의 검토 책임이다.
  parts.push('<p class="caption">⚠ 이 검증은 인용 조문의 <strong>존재·증거 등급·환각 여부</strong>만 확인합니다. 조문이 해당 주장에 실제로 <strong>적용되는지(의미적 판단)는 검증하지 않으며</strong>, "근거 충족"이 법적 적합성을 보증하지 않습니다 — 최종 판단은 안전관리자가 하십시오.</p>');
  parts.push('</section>');
  // 문장별 판정
  const verdicts = d.verdicts || [];
  if (verdicts.length) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">rule</span> 문장별 근거 판정</h4><ul class="ctx-list">');
    for (const v of verdicts) {
      const cls = VERIFY_STATUS_CLS[v.status] || 'badge-upcoming';
      const lbl = VERIFY_STATUS_KO[v.status] || v.status;
      parts.push('<li><span class="badge ' + cls + '">' + escapeHtml(lbl) + '</span> ' + escapeHtml(humanizeLawSymbols(v.claim || '')) +
        ((v.reasons && v.reasons.length) ? '<div class="ctx-excerpt">' + escapeHtml(v.reasons.join(' · ')) + '</div>' : '') + '</li>');
    }
    parts.push('</ul></section>');
  }
  if (d.nextActions && d.nextActions.length) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">tips_and_updates</span> 다음 조치</h4><ul class="ctx-list">' +
      d.nextActions.map((a) => '<li>' + escapeHtml(a) + '</li>').join('') + '</ul></section>');
  }
  renderPreview('법적 근거 검증 — ' + (currentDocTitle || ''), parts.join(''), 'context', false);
}

let autoSaveTimer = null;

function setupAutoSave() {
  // 모든 input/textarea/select 에 입력 이벤트 바인딩 — 5초 debounce 자동 저장
  if (currentTarget === 'profile') return; // Profile 은 명시 저장만
  const docId = currentTarget.replace('doc:', '');
  const fields = document.querySelectorAll('[data-field-id]');
  for (const el of fields) {
    el.addEventListener('input', () => {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(async () => {
        const formValues = collectFormValues();
        try {
          const r = await fetch('/api/draft/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ docId, formValues, autosave: true }),
          });
          if (r.ok) setStatus('info', '자동 저장 완료 — ' + Object.keys(formValues).length + ' 필드');
        } catch {}
      }, 5000);
    });
  }
}

// 외부 도구(Claude Code·Codex)에서 draft 변경 감지 — 폴링 (3초)
let lastDraftUpdatedAt = null;
let pollHandle = null;
function stopPolling() { if (pollHandle) { clearInterval(pollHandle); pollHandle = null; } }
function startPolling() {
  stopPolling();
  pollHandle = setInterval(async () => {
    if (currentTarget === 'profile') return;
    const docId = currentTarget.replace('doc:', '');
    try {
      const r = await fetch('/api/draft/load?docId=' + encodeURIComponent(docId));
      const j = await r.json();
      if (!j.ok || !j.data?.found) return;
      const updatedAt = j.data.updatedAt;
      if (updatedAt && updatedAt !== lastDraftUpdatedAt) {
        lastDraftUpdatedAt = updatedAt;
        // 외부 변경 감지 — prefill 다시 적용
        await maybeLoadDraft({ external: true });
      }
    } catch {}
  }, 3000);
}

async function maybeLoadDraft(opts) {
  if (currentTarget === 'profile') return;
  const docId = currentTarget.replace('doc:', '');
  try {
    const r = await fetch('/api/draft/load?docId=' + encodeURIComponent(docId));
    const data = await r.json();
    if (!data.ok || !data.data?.found) return;
    const draft = data.data;
    lastDraftUpdatedAt = draft.updatedAt;
    // 폼에 값 복원
    let restored = 0;
    const inputs = Array.from(document.querySelectorAll('[data-field-id]'));
    for (const [key, val] of Object.entries(draft.formValues || {})) {
      for (const el of inputs) {
        const mappedKey = fieldPathMap[el.dataset.fieldId] || el.dataset.fieldKey || el.dataset.fieldId;
        if (el.dataset.fieldId === key || el.dataset.fieldKey === key || mappedKey === key) {
          // input type 별 value 정규화 (datetime-local·date·time·number 는 strict)
          let v = String(val == null ? '' : val);
          const t = el.type;
          if (t === 'date') {
            const m = v.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})/);
            v = m ? m[1] : '';
          } else if (t === 'datetime-local') {
            const m = v.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})[T ]?([0-9]{2}:[0-9]{2})?/);
            v = m ? (m[2] ? m[1] + 'T' + m[2] : m[1] + 'T00:00') : '';
          } else if (t === 'time') {
            const m = v.match(/([0-9]{2}:[0-9]{2})/);
            v = m ? m[1] : '';
          } else if (t === 'number') {
            const m = v.match(/-?[0-9]+(?:\\.[0-9]+)?/);
            v = m ? m[0] : '';
          }
          el.value = v;
          if (v) restored++;
          break;
        }
      }
    }
    if (restored > 0) {
      const prefix = (opts && opts.external) ? '🔄 외부 도구(Claude·Codex) 자동 작성 반영 — ' : '이전 작성 초안 복원 — ';
      setStatus('info', prefix + restored + ' 필드 (최종 수정 ' + draft.updatedAt.slice(0, 16) + ')');
    }
  } catch {}
}

async function loadForm(target, mode) {
  currentTarget = target;
  // 작성(edit) vs 수신/열람(view, read-only) 모드. profile 은 항상 edit. (P1-CU4)
  viewMode = (target !== 'profile' && mode === 'view') ? 'view' : 'edit';
  healthUnlocked = false;          // 새 문서 로드 시 보호 분류 본인 확인 게이트 초기화
  // 홈 → 문서 작업 영역 전환
  activeView = 'doc';
  document.getElementById('home-view').style.display = 'none';
  const emgView = document.getElementById('emergency-view'); if (emgView) emgView.style.display = 'none';
  const arcView = document.getElementById('archive-view'); if (arcView) arcView.style.display = 'none';
  document.getElementById('doc-view').style.display = 'block';
  // profile 은 우측 미리보기 없음 → 탭 숨김
  document.getElementById('preview-tabs').style.display = (target === 'profile') ? 'none' : 'flex';
  previewTab = 'form';
  document.querySelectorAll('.preview-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === 'form'));
  document.querySelectorAll('.agent-toolbar .agent-button').forEach((b) => b.classList.remove('is-active'));
  if (target === 'profile') document.getElementById('nav-profile')?.classList.add('is-active');
  setStatus('info', '폼 로드 중...');
  root.innerHTML = '';
  document.getElementById('preview-container').innerHTML = '';
  currentContext = null;            // 새 폼 로드 시 그래프 토글 상태 초기화
  lastGeneratedDoc = null;           // 이전 docId 의 generated 본문 상태 초기화
  currentDocTitle = '';
  currentRequiredLabels = [];        // P2-CU7 — 새 폼 로드 전 필수 라벨 초기화

  // 레이아웃 분기 — Profile 은 폼 단독, docId 양식은 좌우 분할
  const splitArea = document.querySelector('.split-area');
  if (target === 'profile') {
    splitArea?.classList.add('profile-mode');
  } else {
    splitArea?.classList.remove('profile-mode');
    // docId 제목 — 드롭다운 selected option 의 textContent 에서 추출
    const sel = document.getElementById('doc-select');
    const opt = sel?.options[sel.selectedIndex];
    if (opt && opt.value) {
      // "TBM 회의록 [점검·일지] ★" → "TBM 회의록"
      currentDocTitle = (opt.textContent || '').replace(/\s*\[.*?\].*$/, '').trim();
    }
  }

  // === read-only 수신/열람 모드 (P1-CU4) — 작성 폼 대신 게시본 열람 ===
  // 수신함(sent/received) 진입·보호 분류(J_건강)는 작성 폼을 띄우지 않고 게시본만 보여준다.
  if (viewMode === 'view' && target.startsWith('doc:')) {
    splitArea?.classList.add('profile-mode');   // 단일 컬럼 — 좌측에 게시본 단독
    document.getElementById('preview-tabs').style.display = 'none';
    stopPolling();
    await renderReadonlyView(target.replace('doc:', ''));
    loadWorkflowBar();              // 수신 확인(acknowledge) 액션은 workflow-bar 에서 노출
    return;
  }

  try {
    const r = await fetch('/api/form?target=' + encodeURIComponent(target));
    const data = await r.json();
    if (!data.ok) {
      setStatus('err', '실패: ' + (data.reason || 'unknown'));
      return;
    }
    fieldPathMap = data.fieldPathMap || {};
    currentRequiredLabels = data.requiredLabels || [];   // P2-CU7 필수 라벨
    render(data.messages, data.summary);
    setStatus('ok', data.summary || '폼 로드 완료');
    // draft 자동 복원 + autosave 바인딩 + 외부 변경 폴링
    await maybeLoadDraft();
    applyCarryContext();            // P2-CU9 — 연계 진입 캐리오버 주입(draft 복원 후, 빈 칸 채움)
    setupAutoSave();
    setupLivePreview();             // docId 양식이면 폼 입력 → /api/generate 호출 바인딩 (1.5s debounce)
    refreshFormPreview(true);       // 초기 1회 — generate 빈 draft 호출로 결재용 양식 골격 즉시 표시
    startPolling();
    loadWorkflowBar();              // 결재 상태기계 바 (P0-CU2) — profile 은 내부에서 숨김
  } catch (e) {
    setStatus('err', '오류: ' + e.message);
  }
}

// === read-only 게시본 열람 (P1-CU4) — 작성 폼 없이 본문만. 의견 코멘트 채널 포함. ===
async function renderReadonlyView(docId) {
  const title = currentDocTitle || docId;
  // 보호 분류(J_건강): 본인 확인 게이트 통과 전엔 본문 비공개(F-wr-4 부분, §129 비밀보장).
  if (isProtectedDoc(docId) && !healthUnlocked) {
    root.innerHTML =
      '<div class="readonly-doc"><div class="health-gate">' +
        '<span class="material-symbols-outlined health-gate-ic">lock</span>' +
        '<h3>' + escapeHtml(title) + '</h3>' +
        '<p class="caption">건강진단·유소견 통보는 본인에게만 공개되는 비밀 보장 대상(산안법 제129조)입니다. ' +
        '본인 확인 후 열람하세요. 타 역할의 홈에는 표시되지 않습니다.</p>' +
        '<button type="button" class="Button primary" onclick="unlockHealthDoc()"><span class="material-symbols-outlined">how_to_reg</span>본인 확인 후 열람</button>' +
      '</div></div>';
    setStatus('info', roleLabel(currentRole) + ' — 본인 확인이 필요한 보호 문서입니다.');
    return;
  }
  setStatus('info', '게시본 불러오는 중...');
  // 게시본 본문 — 저장된 draft 로 generate (수신 시점 본문). 실패하면 양식 골격(official-form) 으로 폴백.
  let bodyHtml = '';
  let rawMd = '';
  try {
    const fv = collectReadonlyValues(docId);
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId, draft: fv }) });
    const data = await r.json();
    if (data.ok) { rawMd = data.content || data.preview || ''; bodyHtml = renderMarkdownPreview(rawMd); }
  } catch {}
  if (!bodyHtml) {
    try {
      const r2 = await fetch('/api/official-form?docId=' + encodeURIComponent(docId));
      const d2 = await r2.json();
      if (d2.ok) { rawMd = d2.md || ''; bodyHtml = renderMarkdownPreview(rawMd); }
    } catch {}
  }
  lastRenderedMd = rawMd;
  lastGeneratedDoc = rawMd ? { docId, content: rawMd, filename: docId + '-' + new Date().toISOString().slice(0, 10) + '.md' } : null;
  root.innerHTML =
    '<div class="readonly-doc">' +
      '<div class="readonly-head"><span class="badge badge-sent"><span class="material-symbols-outlined">visibility</span>열람 전용</span>' +
        '<span class="caption">이 화면은 게시된 문서를 읽기 위한 것으로 수정할 수 없습니다.</span></div>' +
      '<h3 class="readonly-title">' + escapeHtml(title) + '</h3>' +
      '<div class="preview-body readonly-body">' + (bodyHtml || '<p class="caption">표시할 본문이 없습니다 — 작성·승인 후 게시됩니다.</p>') + '</div>' +
      buildReadonlyActions() +
      '<div class="readonly-comment">' +
        '<label class="agent-label" for="ro-comment">의견 남기기 (선택)</label>' +
        '<textarea id="ro-comment" class="agent-input" rows="2" placeholder="이 문서에 대한 의견·확인 메모를 남기면 이력에 기록됩니다"></textarea>' +
        '<button type="button" class="Button secondary" onclick="submitComment()"><span class="material-symbols-outlined">comment</span>의견 제출</button>' +
      '</div>' +
    '</div>';
  setStatus('ok', '열람 전용 — ' + title);
}
function buildReadonlyActions() {
  return '<div class="preview-actions readonly-actions">' +
    '<button type="button" class="Button secondary preview-action" onclick="onSaveMarkdown()" title="현재 본문을 .md 로 다운로드"><span class="material-symbols-outlined">download</span>MD 저장</button>' +
    '<button type="button" class="Button secondary preview-action" onclick="window.print()" title="브라우저 인쇄로 PDF 저장"><span class="material-symbols-outlined">print</span>인쇄/PDF</button>' +
    '</div>';
}
// 열람용 draft 값 — 저장된 draft 가 있으면 generate 가 서버에서 읽으므로 빈 객체로도 충분. (스텁)
function collectReadonlyValues(docId) { return {}; }
function unlockHealthDoc() {
  // 강한 인증은 계약상 보류(➖). 명시적 본인 확인 클릭만 게이트로 둔다.
  if (!confirm('본인 또는 열람 권한자임을 확인합니다. 계속하시겠습니까?')) return;
  healthUnlocked = true;
  renderReadonlyView(currentTarget.replace('doc:', ''));
}
async function submitComment() {
  const ta = document.getElementById('ro-comment');
  const text = (ta && ta.value || '').trim();
  if (!text) { setStatus('err', '의견을 입력하세요.'); return; }
  const docId = currentTarget.replace('doc:', '');
  // 의견은 상태 전이를 일으키지 않는 이력 메모 — acknowledge note 와 동일 채널 재사용(상태 불변).
  try {
    const r = await fetch('/api/workflow/transition', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docId, verb: 'comment', actor: currentRole, note: text, title: currentDocTitle || docId }) });
    const data = await r.json();
    if (!data.ok) { setStatus('err', '의견 제출 실패: ' + (data.reason || 'unknown')); return; }
    currentWorkflow = data.data;
    if (ta) ta.value = '';
    renderWorkflowBar();
    setStatus('ok', '의견이 이력에 기록되었습니다.');
  } catch (e) { setStatus('err', '오류: ' + e.message); }
}

function render(messages, summary) {
  // A2UI v0.9 렌더링 — createSurface + updateComponents
  const allComponents = {};
  for (const m of messages) {
    if (m.updateComponents) {
      for (const c of m.updateComponents.components) {
        allComponents[c.id] = c;
      }
      const rootId = m.updateComponents.root || 'root';
      const el = renderComponent(rootId, allComponents);
      root.appendChild(el);
    }
  }
}

function bindFieldMeta(el, c) {
  el.dataset.fieldId = c.id;
  if (c.fieldKey) el.dataset.fieldKey = c.fieldKey;
  if (c.draftPath) el.dataset.draftPath = c.draftPath;
  if (c.profilePath) el.dataset.profilePath = c.profilePath;
}

function renderComponent(id, all) {
  const c = all[id];
  if (!c) return document.createTextNode('[missing: ' + id + ']');

  switch (c.component) {
    case 'Column': {
      const div = document.createElement('div');
      div.className = 'Column';
      for (const childId of (c.children || [])) {
        div.appendChild(renderComponent(childId, all));
      }
      return div;
    }
    case 'Row': {
      const div = document.createElement('div');
      div.className = 'Row' + (c.distribution === 'spaceBetween' ? ' spaceBetween' : '');
      for (const childId of (c.children || [])) {
        div.appendChild(renderComponent(childId, all));
      }
      return div;
    }
    case 'Card': {
      const div = document.createElement('div');
      div.className = 'Card';
      if (c.child) div.appendChild(renderComponent(c.child, all));
      return div;
    }
    case 'Text': {
      const tag = c.usageHint === 'h1' ? 'h1' : c.usageHint === 'h2' ? 'h2' : c.usageHint === 'body' ? 'p' : 'small';
      const el = document.createElement(tag);
      el.className = c.usageHint || 'body';
      // 이모지 → Material Symbols 인라인 치환
      el.innerHTML = replaceEmojiWithIcons(c.text || '');
      return el;
    }
    case 'TextField': {
      const wrapper = document.createElement('div');
      wrapper.className = 'field-block';
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = c.label || '';
      // P2-CU7 — 필수 필드 별표 + 가드용 마킹
      if (isRequiredLabel(c.label)) {
        wrapper.dataset.required = '1';
        const star = document.createElement('span');
        star.className = 'req-star';
        star.textContent = '*';
        star.title = '필수 입력';
        label.appendChild(star);
      }
      wrapper.appendChild(label);

      const hint = c.usageHint || 'shortText';

      // 명백 enum 라벨 → select (성별/국적/고용형태/근로형태/혼인/잔존 위험도)
      const ENUM_BY_LABEL = {
        '성별': ['남', '여'],
        '국적': ['한국', '중국(조선족)', '중국(한족)', '베트남', '필리핀', '캄보디아', '네팔', '미얀마', '태국', '우즈베키스탄', '몽골', '인도네시아', '파키스탄', '러시아', '기타'],
        '고용형태': ['정규직', '계약직', '일용직', '도급', '파견', '단시간', '외주'],
        '근로형태': ['정규직', '계약직', '일용직', '도급', '파견'],
        '혼인': ['미혼', '기혼', '이혼', '사별', '비공개'],
        '잔존 위험도': ['1 (매우낮음)', '2 (낮음)', '3 (중간)', '4 (높음)', '5 (매우높음)'],
      };
      let enumLabel = null;
      const Lt = (c.label || '').trim();
      for (const k of Object.keys(ENUM_BY_LABEL)) {
        if (Lt === k || Lt.startsWith(k + ' ') || Lt.endsWith(' ' + k) || Lt === k + '$' ) { enumLabel = k; break; }
      }
      if (enumLabel) {
        const select = document.createElement('select');
        bindFieldMeta(select, c);
        const opts = [['', '— 선택 —'], ...ENUM_BY_LABEL[enumLabel].map(v => [v, v])];
        for (const [val, txt] of opts) {
          const o = document.createElement('option');
          o.value = val; o.textContent = txt;
          if (c.value === val) o.selected = true;
          select.appendChild(o);
        }
        wrapper.appendChild(select);
        return wrapper;
      }

      // check → 3-state 토글 (양호/불량/해당없음) + 추가 메모
      if (hint === 'check') {
        const group = document.createElement('div');
        group.className = 'check-toggle';
        const STATES = [
          { val: 'ok',  prefix: '[√]',     icon: 'check_circle',  text: '양호' },
          { val: 'ng',  prefix: '[X]',          icon: 'cancel',        text: '불량' },
          { val: 'na',  prefix: '[—]',     icon: 'remove',        text: '해당없음' },
        ];
        const note = document.createElement('input');
        note.type = 'text';
        note.className = 'check-note';
        note.placeholder = '추가 메모 (선택)';
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        bindFieldMeta(hidden, c);

        const buttons = [];
        let curState = '';
        // prefill 분석: c.value가 "[√] ..." 형태면 prefix 매칭
        const initVal = String(c.value ?? '');
        for (const s of STATES) {
          if (initVal.startsWith(s.prefix)) {
            curState = s.val;
            note.value = initVal.slice(s.prefix.length).trim();
            break;
          }
        }
        function syncHidden() {
          const st = STATES.find(s => s.val === curState);
          if (!st) { hidden.value = note.value; return; }
          hidden.value = note.value ? (st.prefix + ' ' + note.value) : st.prefix;
        }
        for (const s of STATES) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'check-btn check-btn-' + s.val + (curState === s.val ? ' active' : '');
          b.dataset.val = s.val;
          b.innerHTML = '<span class="material-symbols-outlined">' + s.icon + '</span>' + s.text;
          b.addEventListener('click', () => {
            curState = s.val;
            for (const bb of buttons) bb.classList.remove('active');
            b.classList.add('active');
            syncHidden();
            hidden.dispatchEvent(new Event('input', { bubbles: true }));
          });
          buttons.push(b);
          group.appendChild(b);
        }
        note.addEventListener('input', syncHidden);
        syncHidden();
        wrapper.appendChild(group);
        wrapper.appendChild(note);
        wrapper.appendChild(hidden);
        return wrapper;
      }

      // yesNo → select
      if (hint === 'yesNo') {
        const select = document.createElement('select');
        bindFieldMeta(select, c);
        for (const opt of [['', '— 선택 —'], ['예', '예 / 적합'], ['아니오', '아니오 / 부적합'], ['해당없음', '해당없음']]) {
          const o = document.createElement('option');
          o.value = opt[0]; o.textContent = opt[1];
          if (c.value === opt[0]) o.selected = true;
          select.appendChild(o);
        }
        wrapper.appendChild(select);
        return wrapper;
      }

      // longText → textarea
      if (hint === 'longText') {
        const ta = document.createElement('textarea');
        ta.value = String(c.value ?? '');
        ta.placeholder = c.placeholder || '';
        bindFieldMeta(ta, c);
        wrapper.appendChild(ta);
        appendFieldHint(wrapper, c);   // P2-CU7 인라인 힌트(폼 옆 가이드)
        return wrapper;
      }

      // 그 외 input — usageHint 별 type 매핑
      const TYPE_MAP = {
        date: 'date',
        datetime: 'datetime-local',
        time: 'time',
        number: 'number',
        currency: 'number',
        percentage: 'number',
        phone: 'tel',
        email: 'email',
        obscured: 'password',
        signature: 'text',
        businessNumber: 'text',
        corpNumber: 'text',
        shortText: 'text',
      };
      const input = document.createElement('input');
      input.type = TYPE_MAP[hint] || 'text';

      // input mode/pattern 보강
      if (hint === 'phone') input.inputMode = 'tel';
      if (hint === 'currency') { input.step = '1'; input.inputMode = 'numeric'; input.placeholder = c.placeholder || '원 단위 숫자만'; }
      if (hint === 'percentage') { input.step = '0.1'; input.inputMode = 'decimal'; input.min = '0'; input.max = '100'; }
      if (hint === 'businessNumber') { input.pattern = '\\\\d{3}-?\\\\d{2}-?\\\\d{5}'; input.placeholder = c.placeholder || '123-45-67890'; }
      if (hint === 'signature') input.placeholder = c.placeholder || '성명 (서명)';

      // value 정규화 — TS template literal escape 회피 위해 [0-9] 사용
      let v = c.value == null ? '' : String(c.value);
      if (input.type === 'date') {
        const m = v.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})/);
        v = m ? m[1] : '';
      } else if (input.type === 'datetime-local') {
        const m = v.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})[T ]?([0-9]{2}:[0-9]{2})?/);
        v = m ? (m[2] ? m[1] + 'T' + m[2] : m[1] + 'T00:00') : '';
      } else if (input.type === 'time') {
        const m = v.match(/([0-9]{2}:[0-9]{2})/);
        v = m ? m[1] : '';
      } else if (input.type === 'number') {
        const m = v.match(/-?[0-9]+(?:\\.[0-9]+)?/);
        v = m ? m[0] : '';
      }
      input.value = v;
      if (!input.placeholder) input.placeholder = c.placeholder || '';
      bindFieldMeta(input, c);
      wrapper.appendChild(input);
      appendFieldHint(wrapper, c);   // P2-CU7 인라인 힌트
      return wrapper;
    }
    case 'Button': {
      const btn = document.createElement('button');
      const isPrimary = c.action?.name?.includes('save') || c.action?.name?.includes('submit');
      btn.className = 'Button ' + (isPrimary ? 'primary' : 'secondary');
      // Material Symbols 매핑
      const ICON_MAP = {
        save_profile_from_form: 'save',
        submit_safety_document: 'send',
        assemble_doc_context: 'hub',
        clear_site_profile: 'delete',
      };
      const iconName = c.action?.name ? ICON_MAP[c.action.name] : null;
      if (iconName) {
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = iconName;
        btn.appendChild(icon);
      }
      const childEl = c.child ? renderComponent(c.child, all) : null;
      if (childEl) {
        // Text 컴포넌트는 emoji 제거 (이미 Material Symbol로 대체)
        if (childEl.tagName === 'SMALL' || childEl.tagName === 'P') {
          childEl.textContent = (childEl.textContent || '').replace(/^[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{1F000}-\\u{1F2FF}]\\s*/u, '');
        }
        btn.appendChild(childEl);
      }
      btn.onclick = (e) => {
        e.preventDefault();
        handleAction(c.action);
      };
      return btn;
    }
    default:
      const fb = document.createElement('div');
      fb.textContent = '[' + c.component + ']';
      return fb;
  }
}

// === P2-CU7 — 필수 마커 / 인라인 힌트 / 제출 가드 헬퍼 ===
// 라벨 정규화: 공백·괄호 부연·구분기호 제거 후 비교(폼 .md 라벨 ↔ A2UI 컴포넌트 라벨 표기 차이 흡수).
function normLabel(s) {
  return String(s || '')
    .replace(/\\([^)]*\\)/g, '')   // 괄호 부연 제거
    .replace(/[\\s·\\/]+/g, '')     // 공백·중점·슬래시 제거
    .trim();
}
function isRequiredLabel(label) {
  if (!label || !currentRequiredLabels.length) return false;
  const n = normLabel(label);
  if (!n) return false;
  for (const rl of currentRequiredLabels) {
    const rn = normLabel(rl);
    if (!rn) continue;
    if (n === rn || n.includes(rn) || rn.includes(n)) return true;
  }
  return false;
}
// 인라인 힌트 — 컴포넌트가 placeholder(예시값)만 들고 있으므로 "예: ..." 형태로 폼 옆에 노출(F-sub-6).
function appendFieldHint(wrapper, c) {
  const ph = c && c.placeholder ? String(c.placeholder).trim() : '';
  if (!ph) return;
  const hint = document.createElement('div');
  hint.className = 'field-hint';
  hint.textContent = '예: ' + ph;
  wrapper.appendChild(hint);
}
// 제출 전 필수 가드 — 누락 필드 하이라이트 + 첫 누락으로 스크롤. 누락 라벨 배열 반환(빈 배열이면 통과).
function checkRequiredFields() {
  const missing = [];
  let firstEl = null;
  document.querySelectorAll('#form-container .field-block').forEach((blk) => {
    blk.classList.remove('is-missing');
    if (blk.dataset.required !== '1') return;
    const inp = blk.querySelector('input, textarea, select');
    const val = inp ? String(inp.value || '').trim() : '';
    if (!val) {
      blk.classList.add('is-missing');
      const lbl = blk.querySelector('.label');
      missing.push(lbl ? (lbl.textContent || '').replace(/\\*$/, '').trim() : '필수 항목');
      if (!firstEl) firstEl = blk;
    }
  });
  if (firstEl) firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return missing;
}

function collectFormValues() {
  const values = {};
  // 모든 input/textarea/select 의 A2UI 바인딩 메타를 실제 draft key 로 매핑
  document.querySelectorAll('[data-field-id]').forEach((el) => {
    const fieldId = el.dataset.fieldId; // 예: "section-site-site-name-input"
    const fieldKey = el.dataset.fieldKey;
    if (currentTarget === 'profile') {
      const m = fieldId.match(/^section-[^-]+-(.+)-input$/);
      const fallbackKey = m ? m[1].replace(/-/g, '.') : fieldId;
      const formKey = fieldKey || Object.keys(fieldPathMap).find(k => fieldId.includes(k.replace(/\\./g, '-'))) || fallbackKey;
      values[formKey] = el.value;
    } else {
      const draftKey = fieldPathMap[fieldId] || fieldKey || fieldId;
      values[draftKey] = el.value;
    }
  });
  return values;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

// 단순 인라인 마크다운: bold(**) / italic(*) / inline-code / 줄바꿈
function inlineMd(s) {
  let html = escapeHtml(s);
  html = html.replace(/\\*\\*([^*\\n]+?)\\*\\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\\*([^*\\n]+?)\\*(?!\\*)/g, '$1<em>$2</em>');
  // inline code 처리 — backtick 매칭
  const BT = String.fromCharCode(96);
  const codeRe = new RegExp(BT + '([^' + BT + '\\n]+?)' + BT, 'g');
  html = html.replace(codeRe, '<code>$1</code>');
  html = html.replace(/\\n/g, '<br>');
  return html;
}

// 이모지 → Material Symbols 매핑 (텍스트 안 inline 치환)
const EMOJI_TO_MATERIAL = {
  '💡': 'lightbulb',
  '⚠️': 'warning', '⚠': 'warning',
  '📋': 'assignment',
  '🔄': 'sync',
  '📤': 'outbox',
  '⏰': 'alarm',
  '🗄️': 'inventory_2', '🗄': 'inventory_2',
  '⚖️': 'gavel', '⚖': 'gavel',
  '📜': 'description',
  '🛡': 'security', '🛡️': 'security',
  '🔗': 'link',
  '📅': 'calendar_today',
  '✏️': 'edit', '✏': 'edit',
  '📝': 'edit_note',
  '✅': 'check_circle',
  '❌': 'cancel',
  '🟢': 'circle',
  '🟡': 'circle',
  '🟠': 'circle',
  '🔴': 'circle',
  '⚪': 'circle',
  '🏗': 'engineering', '🏗️': 'engineering',
  '🔨': 'construction',
  '📦': 'inventory',
  '🎯': 'target',
  '📊': 'bar_chart',
  '🚧': 'construction',
  '🔍': 'search',
  '💾': 'save',
  '🗑': 'delete', '🗑️': 'delete',
  '👤': 'person',
  '👥': 'group',
  '🏢': 'apartment',
  '📞': 'call',
  '📧': 'mail',
  '🆘': 'sos',
};

function replaceEmojiWithIcons(text) {
  // 1) HTML escape 먼저
  let html = escapeHtml(text);
  // 2) 알려진 이모지 → Material Symbols span
  for (const [emoji, icon] of Object.entries(EMOJI_TO_MATERIAL)) {
    if (html.indexOf(emoji) === -1) continue;
    const span = '<span class="material-symbols-outlined inline-icon">' + icon + '</span>';
    html = html.split(emoji).join(span);
  }
  return html;
}

function renderPreview(title, html, kind, hasDownload) {
  const container = document.getElementById('preview-container');
  const icon = kind === 'context' ? 'hub' : 'description';
  const panelClass = kind === 'doc' ? 'preview-panel preview-doc' : 'preview-panel';
  // 결재 양식(doc) 미리보기일 때만 액션 4종 노출 — context(그래프) 는 액션 없음
  const actions = (kind === 'doc') ? buildPreviewActions() : '';
  container.innerHTML = '<div class="' + panelClass + '"><h3><span class="material-symbols-outlined">' + icon + '</span><span class="preview-title">' + escapeHtml(title) + '</span>' + actions + '</h3><div class="preview-body">' + html + '</div></div>';
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 우측 결재 양식 미리보기 액션 4종 (갱신·MD 저장·인쇄/PDF·초기화)
function buildPreviewActions() {
  return (
    '<div class="preview-actions">' +
      '<button type="button" class="Button secondary preview-action" onclick="onRefreshPreview()" title="우측 양식 다시 그리기"><span class="material-symbols-outlined">refresh</span>갱신</button>' +
      '<button type="button" class="Button secondary preview-action" onclick="onSaveMarkdown()" title="현재 양식을 .md 로 다운로드"><span class="material-symbols-outlined">download</span>MD 저장</button>' +
      '<button type="button" class="Button secondary preview-action" onclick="window.print()" title="브라우저 인쇄로 PDF 저장"><span class="material-symbols-outlined">print</span>인쇄/PDF</button>' +
      '<button type="button" class="Button secondary preview-action" onclick="onResetForm()" title="좌측 입력 초기화"><span class="material-symbols-outlined">restart_alt</span>초기화</button>' +
    '</div>'
  );
}

// 미리보기 갱신 — 현재 폼 입력 기준으로 즉시 우측 다시 그리기
function onRefreshPreview() {
  if (currentContext) { currentContext = null; } // 그래프 표시 중이었으면 양식으로 복귀
  if (lastGeneratedDoc) { lastGeneratedDoc = null; } // generate 본문 표시 중이었으면 양식으로 복귀
  refreshFormPreview(true);
  setStatus('info', '양식 갱신 완료');
}

// 현재 우측 마크다운을 .md 파일로 다운로드
function onSaveMarkdown() {
  if (!lastRenderedMd) { setStatus('err', '저장할 본문이 없습니다 — 양식을 먼저 갱신하세요'); return; }
  const docId = (currentTarget && currentTarget.startsWith('doc:')) ? currentTarget.replace('doc:', '') : 'document';
  const today = new Date().toISOString().slice(0, 10);
  const filename = docId + '-' + today + '.md';
  const blob = new Blob([lastRenderedMd], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus('ok', 'MD 다운로드 — ' + filename);
}

// 좌측 입력 초기화 — 모든 input/textarea/select + check 토글 + 서버 draft 삭제
async function onResetForm() {
  if (!confirm('현재 양식의 모든 입력값을 초기화하시겠습니까?')) return;
  // 1) 입력 컨트롤 비우기
  document.querySelectorAll('[data-field-id]').forEach((el) => {
    if (el.tagName === 'SELECT') {
      el.selectedIndex = 0;
    } else if (el.type === 'hidden') {
      el.value = '';
    } else {
      el.value = '';
    }
  });
  // 2) check 토글 active 해제 + 메모 비우기
  document.querySelectorAll('.check-btn.active').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.check-note').forEach((el) => { el.value = ''; });
  // 3) 서버 draft 삭제 (docId 모드만)
  if (currentTarget && currentTarget.startsWith('doc:')) {
    const docId = currentTarget.replace('doc:', '');
    try {
      await fetch('/api/draft/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ docId, formValues: {}, autosave: false }),
      });
    } catch { /* best-effort */ }
  }
  // 4) 우측 양식 placeholder 상태로 복귀
  lastGeneratedDoc = null;
  refreshFormPreview(true);
  setStatus('ok', '입력 초기화 완료');
}

// === 실시간 결재 양식 미리보기 ===
// /api/generate (generate_safety_document MCP) 를 호출해서 docId 의 결재용 양식 마크다운을 받음.
// 빈 draft → 양식 골격 + placeholder. 채워진 draft → 입력값 반영된 양식.
// 자동 양식 생성 (클라이언트 추출) 은 정밀한 결재 양식 (결재선·다열 표·헤더 강조) 불가능하여 폐기.
let liveGenerateInflight = false;

// 결재 양식 템플릿의 {{key}} placeholder 를 폼 입력값으로 치환.
// 폼에 없는 key 는 '미입력' 으로 (현장 안전관리자가 PDF 받아서 손으로 채우는 양식).
function fillFormTemplate(templateMd, draft) {
  let s = String(templateMd);
  // 1) 입력된 값으로 명시적 치환
  if (draft && typeof draft === 'object') {
    for (const key of Object.keys(draft)) {
      const v = (draft[key] == null ? '' : String(draft[key]).trim());
      if (!v) continue;
      const placeholder = '{{' + key + '}}';
      s = s.split(placeholder).join(v);
    }
  }
  // 2) 남은 {{...}} → '미입력'  (RegExp 생성자 + double-escape — backtick 회피)
  s = s.replace(new RegExp('\\\\{\\\\{[^}]+\\\\}\\\\}', 'g'), '미입력');
  return s;
}

async function refreshFormPreview(immediate) {
  if (currentTarget === 'profile' || !currentTarget.startsWith('doc:')) return;
  if (currentContext) return;     // 그래프 표시 중이면 덮지 않음
  if (lastGeneratedDoc) return;    // submit 본문 표시 중이면 덮지 않음

  const run = async () => {
    if (liveGenerateInflight) return; // 동시 호출 중복 방지
    liveGenerateInflight = true;
    try {
      const docId = currentTarget.replace('doc:', '');
      const draft = collectFormValues();

      // 1) 우선 결재 양식 템플릿 (src/templates/forms/{docId}.md) 시도
      try {
        const tplRes = await fetch('/api/official-form?docId=' + encodeURIComponent(docId));
        if (tplRes.ok) {
          const tplData = await tplRes.json();
          if (tplData.ok && tplData.md) {
            const filled = fillFormTemplate(tplData.md, draft);
            if (currentContext || lastGeneratedDoc) return;
            lastRenderedMd = filled; // MD 저장/인쇄에 사용
            renderPreview('실시간 양식 — ' + (currentDocTitle || ''), renderMarkdownPreview(filled), 'doc', false);
            return;
          }
        }
      } catch (e) { /* fallback 진행 */ }

      // 2) Fallback — 템플릿 없는 docId 는 기존 generate_safety_document
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ docId, draft }),
      });
      const data = await r.json();
      if (!data.ok) return;
      if (currentContext || lastGeneratedDoc) return;
      const rawMd = data.content || data.preview || '';
      lastRenderedMd = rawMd; // MD 저장/인쇄에 사용
      renderPreview('실시간 양식 — ' + (currentDocTitle || ''), renderMarkdownPreview(rawMd), 'doc', false);
    } catch (e) {
      // best-effort — 실패해도 silent
    } finally {
      liveGenerateInflight = false;
    }
  };

  if (immediate) {
    await run();
  } else {
    if (formPreviewDebounce) clearTimeout(formPreviewDebounce);
    // 템플릿 경로는 LLM 안 거치므로 200ms 빠른 debounce (입력 즉시 반영)
    formPreviewDebounce = setTimeout(run, 200);
  }
}

function setupLivePreview() {
  if (currentTarget === 'profile') return;
  const fields = document.querySelectorAll('[data-field-id]');
  for (const el of fields) {
    el.addEventListener('input', () => refreshFormPreview(false));
    el.addEventListener('change', () => refreshFormPreview(false));
  }
}

// 법령 기호 → 한국어 가독성 변환 (양식 본문 / 결재 문서용)
// MCP 도구는 § / Article 같은 영문/기호 표현을 그대로 출력 (Claude Desktop 등 다른 호스트와의 호환).
// viewer 는 화면 그리기 직전에 한국어 표현으로 치환.
function humanizeLawSymbols(text) {
  if (!text) return '';
  let s = String(text);
  // § N → 제N조. TS backtick 이 \\s / \\d 를 한 번 escape 해야 JS RegExp 가 정상 해석.
  s = s.replace(new RegExp('§\\\\s*(\\\\d+)', 'g'), '제$1조');
  // ¶ N → 제N항
  s = s.replace(new RegExp('¶\\\\s*(\\\\d+)', 'g'), '제$1항');
  // Art. N → 제N조 (영문 표기 보정)
  s = s.replace(new RegExp('\\\\bArt\\\\.?\\\\s*(\\\\d+)', 'g'), '제$1조');
  return s;
}

// 결재용 양식에 부적합한 개발자/도구 친화 메타를 제거 — string 조작 only (정규식 escape 회피).
// 제거 대상:
//   - 상단 "🚫 결재 사용 불가 ... validation.issues" 경고
//   - "(kordoc/pdftotext 검증 ...)" 내부 검증 메타
//   - "📝 빈칸 작성 가이드 ..." LLM 친화 안내 블록 (다음 ## 까지)
//   - "(그래프 추론 ...)" / "(ERIC-PP 위계 ...)" 도구 표현
//   - "## 적용 KOSHA Guide (0건)" 빈 섹션 (다음 ## 까지)
//   - "ERIC-PP 5계층 ..." 영문 설명 인용 줄
//   - "> 직접 매핑 N개 ..." 도구 메타 줄
//   - 하단 "ℹ️ 본 문서는 agent-safety-oss ..." 도구 라벨 (마지막 --- 부터 끝까지)
function stripGeneratedNoise(text) {
  if (!text) return '';
  // 1차 — preamble 메타·가이드 인용 제거 (첫 ## 헤더 전의 모든 > 인용 + --- 구분선)
  //         양식 본문은 ## 섹션부터 시작 — 그 위의 가이드 메타는 좌측 입력 영역에 위치해야 함
  const rawLines = String(text).split('\\n');
  let inPreamble = true;
  const preCleaned = [];
  for (const line of rawLines) {
    if (inPreamble) {
      if (line.startsWith('## ') || line.startsWith('### ')) {
        inPreamble = false;
        preCleaned.push(line);
        continue;
      }
      // # h1 헤더는 유지, 그 외 > 인용 / --- 구분선은 출력 영역에서 제거
      if (line.startsWith('>') || line.trim() === '---') continue;
      preCleaned.push(line);
    } else {
      preCleaned.push(line);
    }
  }
  const lines = preCleaned;

  // 2차 — 본문 안의 도구/개발자 친화 메타 제거 (기존 로직)
  const out = [];
  let skipBlock = false;

  function stripInlineParen(line, key) {
    const idx = line.indexOf(key);
    if (idx < 0) return line;
    const close = line.indexOf(')', idx);
    if (close < 0) return line;
    return (line.substring(0, idx).replace(/\\s+$/, '') + line.substring(close + 1)).replace(/\\s+\\./g, '.');
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (skipBlock) {
      if (line.startsWith('## ') || line.startsWith('---')) {
        skipBlock = false;
        // 이 줄(다음 ##) 은 살리는 게 자연스러움
      } else {
        continue;
      }
    }

    // 개발자용 결재 경고
    if (line.includes('🚫') && line.includes('결재 사용 불가')) continue;
    // LLM 용 빈칸 작성 가이드 진입
    // 작성 가이드 인용 블록 — 입력 영역에 위치할 가이드 메타 (출력에서 제거)
    if (line.includes('📝') && line.includes('작성 가이드')) { skipBlock = true; continue; }
    // 0건 KOSHA Guide 섹션
    if (line.startsWith('## ') && line.includes('적용 KOSHA Guide') && line.includes('(0건)')) {
      skipBlock = true; continue;
    }
    // ERIC-PP 5계층 도구 설명
    if (line.startsWith('> ') && line.includes('ERIC-PP') && line.includes('5계층')) continue;
    if (line.startsWith('> 직접 매핑')) continue;
    // 하단 disclaimer (--- 다음 5줄 내 agent-safety-oss 라벨이 있으면 끝까지 잘라냄)
    if (line.trim() === '---') {
      const rest = lines.slice(i + 1, i + 6).join(' ');
      if (rest.includes('agent-safety-oss')) break;
    }

    // 인라인 괄호 메타 정리
    let cleaned = line;
    cleaned = stripInlineParen(cleaned, '(kordoc/pdftotext');
    cleaned = stripInlineParen(cleaned, '(그래프 추론');
    cleaned = stripInlineParen(cleaned, '(ERIC-PP 위계');

    // ERIC-PP 단어 자체는 한국어로
    cleaned = cleaned.split('ERIC-PP 위계').join('통제수단 위계');
    cleaned = cleaned.split('ERIC-PP').join('통제수단');

    out.push(cleaned);
  }

  // 연속 빈 줄 정리
  return out.join('\\n').replace(new RegExp('\\\\n{3,}', 'g'), '\\n\\n').trim();
}

// 마크다운 본문을 HTML 양식으로 렌더 — marked CDN 사용, 미로드/파싱실패 시 vanilla 표 폴백(DP-3, P2-CU8).
// offline-first: 신규 네트워크 0. marked 가 차단된 환경(오프라인·CDN 미로드)에서도 결재용 표가 깨지지 않게 자체 렌더.
function renderMarkdownPreview(rawMd) {
  // 1) 법령 기호 한국어화  2) 개발자/도구 메타 제거 (결재용 양식 가독성)
  const ko = stripGeneratedNoise(humanizeLawSymbols(rawMd));
  if (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function') {
    try {
      marked.setOptions({ gfm: true, breaks: false });
      return '<div class="markdown">' + marked.parse(ko) + '</div>';
    } catch (e) {
      // 파싱 실패 → vanilla 폴백
    }
  }
  return '<div class="markdown">' + fallbackMd2Html(ko) + '</div>';
}

// === P2-CU8 — vanilla MD→HTML 폴백 (marked 미로드 시) ===
// 의존성 0. 결재용 양식은 표·제목·인용·목록 위주이므로 그 범위만 처리(GFM 표 포함).
function fallbackMd2Html(md) {
  const lines = String(md || '').split('\\n');
  const out = [];
  let i = 0;
  const isTableSep = (s) => /^\\s*\\|?[\\s:|-]*-[\\s:|-]*\\|?\\s*$/.test(s) && s.includes('-');
  const splitRow = (s) => s.replace(/^\\s*\\|/, '').replace(/\\|\\s*$/, '').split('|').map((c) => c.trim());
  let listOpen = false;
  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };
  while (i < lines.length) {
    const line = lines[i];
    // GFM 표: 헤더행 + 구분행
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      closeList();
      const head = splitRow(line);
      out.push('<table><thead><tr>' + head.map((h) => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        const cells = splitRow(lines[i]);
        out.push('<tr>' + cells.map((c) => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>');
        i++;
      }
      out.push('</tbody></table>');
      continue;
    }
    // 제목
    const h = line.match(/^(#{1,6})\\s+(.*)$/);
    if (h) { closeList(); const lv = h[1].length; out.push('<h' + lv + '>' + inlineMd(h[2]) + '</h' + lv + '>'); i++; continue; }
    // 수평선
    if (/^\\s*(-{3,}|\\*{3,}|_{3,})\\s*$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }
    // 인용
    if (/^\\s*>\\s?/.test(line)) { closeList(); out.push('<blockquote>' + inlineMd(line.replace(/^\\s*>\\s?/, '')) + '</blockquote>'); i++; continue; }
    // 목록
    if (/^\\s*[-*+]\\s+/.test(line)) {
      if (!listOpen) { out.push('<ul>'); listOpen = true; }
      out.push('<li>' + inlineMd(line.replace(/^\\s*[-*+]\\s+/, '')) + '</li>'); i++; continue;
    }
    // 빈 줄
    if (line.trim() === '') { closeList(); i++; continue; }
    // 일반 문단
    closeList();
    out.push('<p>' + inlineMd(line) + '</p>');
    i++;
  }
  closeList();
  return out.join('\\n');
}

// 마크다운 본문을 .md 파일로 다운로드 — 의존성 0, Blob URL 만 사용
function downloadMarkdown() {
  if (!lastGeneratedDoc || !lastGeneratedDoc.content) {
    setStatus('err', '다운로드할 본문이 없습니다');
    return;
  }
  const blob = new Blob([lastGeneratedDoc.content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = lastGeneratedDoc.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus('ok', 'MD 다운로드 — ' + lastGeneratedDoc.filename);
}

const HAZARD_CAT_KO = { physical: '물리적', chemical: '화학적', biological: '생물학적', ergonomic: '인간공학적', psychosocial: '심리사회적', psychological: '심리적', environmental: '환경적' };
const ERIC_KO = { Elimination: '제거', Substitution: '대체', Engineering: '공학적 통제', Administrative: '관리적 통제', PPE: '개인 보호구' };

// === 사용자 친화 변환 ===
// 카테고리 코드 (A_체제 등) → 한국어 대분류
const CATEGORY_KO = {
  A_체제: '안전보건 체제',
  B_위평: '위험성평가',
  C_교육: '안전보건 교육',
  D_작업계획: '작업계획',
  E_작업허가: '작업허가',
  F_도급: '도급 관리',
  G_점검: '안전점검·일지',
  H_화학: '화학물질',
  I_측정: '작업환경측정',
  J_건강: '건강관리',
  K_사고: '사고 대응',
  L_진단: '안전보건 진단',
  M_인증: '안전인증',
  N_비용: '안전관리비',
};
function humanizeCategory(c) { return c ? (CATEGORY_KO[c] || c) : ''; }

// 주기 IRI (cyc:daily 등) → 한국어
const CYCLE_KO = {
  'cyc:daily': '매일',
  'cyc:weekly': '매주',
  'cyc:monthly': '매월',
  'cyc:quarterly': '분기',
  'cyc:semi_annual': '반기',
  'cyc:annual': '매년',
  'cyc:ad_hoc': '수시',
  'cyc:as_needed': '수시',
  'cyc:every_2_days': '2일마다',
  'cyc:continuous': '상시',
  'cyc:work_unit': '작업단위',
  'cyc:per_work': '작업별',
  'cyc:on_construction_open': '현장 개설 시',
  'cyc:on_accident': '사고 발생 시',
  'cyc:on_appointment': '선임 시',
  'cyc:on_change': '변경 시',
  'cyc:on_design': '설계 시',
  'cyc:on_machinery': '기계 도입 시',
  'cyc:reference': '참고',
  'cyc:daily_weekly_monthly': '매일·매주·매월',
};
function humanizeCycle(c) {
  if (!c) return '';
  if (CYCLE_KO[c]) return CYCLE_KO[c];
  // fallback: 'cyc:foo_bar' → 'foo bar' (사용자에게 영문 코드 노출 최소화)
  return String(c).replace(/^cyc:/, '').replace(/_/g, ' ');
}

// industry 영문 → 한국어
const INDUSTRY_KO = {
  'construction': '건설업',
  'manufacturing': '제조업',
  'service': '서비스업',
  'mining': '광업',
  'all': '전 업종',
};
function humanizeIndustry(c) {
  if (!c) return '';
  return INDUSTRY_KO[c] || String(c);
}

// useFrequency 영문 → 한국어
const USE_FREQ_KO = {
  'low_for_small_construction': '중소건설현장 사용 빈도 낮음 (대형 건설사·임대사 위주)',
  'low': '사용 빈도 낮음',
  'medium': '사용 빈도 보통',
  'high': '사용 빈도 높음',
};
function humanizeUseFrequency(c) {
  if (!c) return '';
  return USE_FREQ_KO[c] || String(c).replace(/_/g, ' ');
}

// ISO 45001 클래스 → 한국어 (영문 병기 제거 — 안전관리자 친화)
const ISO_KO = {
  'iso45001:Hazard': '유해·위험요인',
  'iso45001:Risk': '위험성',
  'iso45001:Control': '통제수단',
  'iso45001:Permit': '작업허가',
  'iso45001:Incident': '사고·중대재해',
  'iso45001:Audit': '점검·심사',
  'iso45001:Worker': '근로자',
  'iso45001:Workplace': '사업장',
  'iso45001:Competence': '교육·자격',
};
function humanizeIso(c) {
  if (!c) return '';
  const ko = ISO_KO[c];
  if (ko) return 'ISO 45001 ' + ko;
  return c.replace(/^iso45001:/, '');
}

// 법령 prefix → 풀이름
const LAW_PREFIX_KO = {
  '산안법': '산업안전보건법',
  '산안법시행규칙': '산업안전보건법 시행규칙',
  '산안법시행령': '산업안전보건법 시행령',
  '기준규칙': '산업안전보건기준에 관한 규칙',
  '위평고시': '사업장 위험성평가에 관한 지침',
  '위험성평가-고시': '사업장 위험성평가에 관한 지침',
  '중처법': '중대재해 처벌 등에 관한 법률',
  '중처법시행령': '중대재해 처벌 등에 관한 법률 시행령',
  '중대재해처벌등에관한법률': '중대재해 처벌 등에 관한 법률',
  '중대재해처벌등에관한법률시행령': '중대재해 처벌 등에 관한 법률 시행령',
  '건진법': '건설기술진흥법',
  '건진법시행령': '건설기술진흥법 시행령',
  '건진법시행규칙': '건설기술진흥법 시행규칙',
};
// "산안법:175" 또는 "산안법:175:2" → "산업안전보건법 제175조 제2항"
function humanizePenalty(ref) {
  if (!ref || typeof ref !== 'string') return ref || '';
  const parts = ref.split(':').filter(Boolean);
  if (parts.length === 0) return ref;
  const lawName = LAW_PREFIX_KO[parts[0]] || parts[0];
  if (parts.length === 1) return lawName;
  let s = lawName + ' 제' + parts[1] + '조';
  if (parts[2]) s += ' 제' + parts[2] + '항';
  if (parts[3]) s += ' 제' + parts[3] + '호';
  return s;
}

// nextDueRule (compileDate + PnD/M/Y) → 사람 친화
function humanizeNextDue(rule) {
  if (!rule || typeof rule !== 'string') return rule == null ? '' : String(rule);
  function dur(p) {
    const m = p.match(/^P([0-9]+)([DMY])$/);
    if (!m) return p;
    const n = Number(m[1]); const u = m[2];
    if (u === 'D' && n === 1) return '매일';
    if (u === 'D' && n === 7) return '매주';
    if (u === 'D') return n + '일마다';
    if (u === 'M' && n === 1) return '매월';
    if (u === 'M' && n === 3) return '분기마다';
    if (u === 'M' && n === 6) return '반기마다';
    if (u === 'M') return n + '개월마다';
    if (u === 'Y' && n === 1) return '매년';
    if (u === 'Y') return n + '년마다';
    return p;
  }
  if (rule.indexOf('compileDate') >= 0) {
    // P_X 부분 추출 — 정규식 escape 회피 위해 split 사용
    const matches = rule.match(/P[0-9]+[DMY]/g) || [];
    const intervals = matches.map(dur);
    if (intervals.length > 1) return intervals.join(' · ');
    if (intervals.length === 1) return intervals[0];
  }
  // 한국어/트리거형 — compileDate + 부분만 제거
  return rule.split('compileDate').join('').replace(/^[ +]+/, '').trim();
}

// assemble_doc_context structuredContent → 사람 친화 HTML
function renderContextHumanFriendly(d) {
  if (!d) return '<p class="caption">데이터 없음</p>';
  const parts = [];

  // 헤더 (제목·목적)
  parts.push('<section class="ctx-section">');
  parts.push('<div class="ctx-purpose">' + escapeHtml(d.document.purpose || d.document.description || '') + '</div>');
  const meta = [];
  if (d.document.category) meta.push('<span class="ctx-chip">분류 ' + escapeHtml(humanizeCategory(d.document.category)) + '</span>');
  if (d.document.cycle) meta.push('<span class="ctx-chip">주기 ' + escapeHtml(humanizeCycle(d.document.cycle)) + '</span>');
  if (d.document.iso45001Class) meta.push('<span class="ctx-chip ctx-chip-iso" title="ISO 45001 안전보건경영시스템 표준 분류">' + escapeHtml(humanizeIso(d.document.iso45001Class)) + '</span>');
  parts.push('<div class="ctx-chips">' + meta.join('') + '</div>');
  parts.push('</section>');

  // 1. 법령 근거
  if (d.legalBasis && d.legalBasis.length) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">gavel</span> 이 문서의 법령 근거 (' + d.legalBasis.length + '개 조문)</h4>');
    parts.push('<ul class="ctx-list">');
    for (const a of d.legalBasis) {
      if (!a.found) {
        parts.push('<li class="ctx-li-warn">미존재: ' + escapeHtml(a.iri) + '</li>');
        continue;
      }
      const law = a.legislationIdentifier || '(법령 미상)';
      const art = a.articleNumber ? '제' + a.articleNumber + '조' : '';
      const title = a.title ? ' (' + a.title + ')' : '';
      parts.push('<li><strong>' + escapeHtml(law + ' ' + art + title) + '</strong>');
      if (a.excerpt) parts.push('<div class="ctx-excerpt">' + inlineMd(a.excerpt) + '</div>');
      parts.push('</li>');
    }
    parts.push('</ul></section>');
  }
  if (d.legalBasisExternal && d.legalBasisExternal.length) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">link</span> 외부 법령 인용</h4>');
    parts.push('<ul class="ctx-list">' + d.legalBasisExternal.map((x) => '<li>' + escapeHtml(humanizePenalty(x)) + '</li>').join('') + '</ul></section>');
  }

  // 2. 위험요인
  if (d.hazards && d.hazards.length) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">warning</span> 이 작업의 위험요인 (' + d.hazards.length + ')</h4>');
    parts.push('<div class="ctx-hazards">');
    for (const h of d.hazards) {
      if (!h.found) continue;
      const cat = HAZARD_CAT_KO[h.category] || h.category || '';
      parts.push('<div class="ctx-card-mini"><div class="ctx-card-head"><strong>' + escapeHtml(h.label || '(이름 없음)') + '</strong>' +
        (cat ? '<span class="ctx-chip ctx-chip-mini">' + escapeHtml(cat) + '</span>' : '') + '</div>' +
        (h.description ? '<div class="ctx-desc">' + inlineMd(h.description) + '</div>' : '') + '</div>');
    }
    parts.push('</div></section>');
  }

  // 3. 통제수단
  if (d.controls && d.controls.length) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">security</span> 권장 통제수단 (' + d.controls.length + ')</h4>');
    parts.push('<ul class="ctx-list">');
    for (const c of d.controls) {
      if (!c.found) continue;
      const eric = ERIC_KO[c.controlLevel] || ERIC_KO[c.ericLevel] || c.controlLevel || c.ericLevel || '';
      parts.push('<li><strong>' + escapeHtml(c.label || '(이름 없음)') + '</strong>' +
        (eric ? '<span class="ctx-chip ctx-chip-mini">' + escapeHtml(eric) + '</span>' : '') + '</li>');
    }
    parts.push('</ul></section>');
  }

  // 4. 공식 양식
  if (d.annex && d.annex.iri) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">description</span> 공식 양식</h4>');
    if (d.annex.found) {
      parts.push('<div class="ctx-callout">' + escapeHtml(d.annex.annexKind + ' 제' + d.annex.annexNumber + '호 — ' + d.annex.title) + '</div>');
    } else {
      parts.push('<div class="ctx-callout warn">매핑됐으나 노드 없음: ' + escapeHtml(d.annex.iri) + '</div>');
    }
    parts.push('</section>');
  }

  // 5. 라이프사이클
  if (d.lifecycle) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">schedule</span> 제출·보관</h4>');
    parts.push('<table class="ctx-table">');
    if (d.lifecycle.submitTo) parts.push('<tr><th>제출처</th><td>' + escapeHtml(d.lifecycle.submitTo) + '</td></tr>');
    if (d.lifecycle.submitDeadline) parts.push('<tr><th>마감</th><td>' + escapeHtml(d.lifecycle.submitDeadline) + '</td></tr>');
    if (d.lifecycle.electronicSubmission && d.lifecycle.electronicSubmission.available) {
      parts.push('<tr><th>전자제출</th><td><a href="' + escapeHtml(d.lifecycle.electronicSubmission.url) + '" target="_blank">' + escapeHtml(d.lifecycle.electronicSubmission.system || d.lifecycle.electronicSubmission.url) + '</a></td></tr>');
    }
    if (d.lifecycle.retention) parts.push('<tr><th>보관</th><td>' + escapeHtml(d.lifecycle.retention) + '</td></tr>');
    if (d.lifecycle.nextDueRule) parts.push('<tr><th>다음 작성</th><td>' + escapeHtml(humanizeNextDue(d.lifecycle.nextDueRule)) + '</td></tr>');
    if (d.lifecycle.penaltyOnMissing) parts.push('<tr><th>위반 시</th><td>' + escapeHtml(humanizePenalty(d.lifecycle.penaltyOnMissing)) + '</td></tr>');
    parts.push('</table></section>');
  }

  // 6. 연계 문서
  if (d.relatedDocs && d.relatedDocs.length) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">hub</span> 함께 작성·참조하는 문서 (' + d.relatedDocs.length + ')</h4>');
    parts.push('<ul class="ctx-list">');
    for (const r of d.relatedDocs.slice(0, 10)) {
      if (!r.found) continue;
      parts.push('<li><strong>' + escapeHtml(r.title || r.docId) + '</strong>' +
        (r.cycle ? '<span class="ctx-chip ctx-chip-mini">' + escapeHtml(humanizeCycle(r.cycle)) + '</span>' : '') + '</li>');
    }
    parts.push('</ul></section>');
  }

  // 7. 작성 항목 — 전체 표시 (requiredFields + sections.fields 통합)
  if (d.requiredFields && d.requiredFields.length) {
    parts.push('<section class="ctx-section"><h4 class="ctx-h"><span class="material-symbols-outlined">edit_note</span> 작성 항목 (' + d.requiredFields.length + ')</h4>');
    parts.push('<div class="ctx-fields">');
    for (const f of d.requiredFields) {
      parts.push('<span class="ctx-chip-field">' + escapeHtml(f.label || f.key) + '</span>');
    }
    parts.push('</div></section>');
  }

  // 그래프 점수
  parts.push('<section class="ctx-footer-stat">참조 해결 ' + (d.meta?.resolvedReferences || 0) + '/' + (d.meta?.totalReferences || 0) + ' · 그래프 첨부 ' + (d.document.completenessScore || 0) + '/7</section>');

  return parts.join('');
}

async function handleAction(action) {
  if (!action || !action.name) return;
  if (action.name === 'save_profile_from_form') {
    const formValues = collectFormValues();
    setStatus('info', '저장 중... (' + Object.keys(formValues).length + ' 필드)');
    const r = await fetch('/api/save-profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formValues }),
    });
    const data = await r.json();
    if (data.ok) {
      const s = data.summary || {};
      setStatus('ok', '저장 완료 — 사업장 ' + (s.siteUpdated ? '✓' : '·') + ' · 현장 ' + (s.projectUpdated ? '✓' : '·') + ' · 인력 ' + (s.personsUpdated || 0) + '명 · 필드 ' + (s.fieldsApplied || 0) + ' 적용');
    } else {
      setStatus('err', '저장 실패: ' + data.reason);
    }
  } else if (action.name === 'submit_safety_document') {
    const docId = action.payload?.docId || currentTarget.replace('doc:', '');
    // P2-CU7 — 제출 전 필수 가드. 누락 시 generate 차단 + 필드 하이라이트.
    const missing = checkRequiredFields();
    if (missing.length) {
      setStatus('err', '필수 항목 ' + missing.length + '건이 비어 있습니다 — ' + missing.slice(0, 3).join(', ') + (missing.length > 3 ? ' 외' : '') + '. 표시된 칸을 채운 뒤 다시 제출하세요.');
      return false;
    }
    // 1) 입력 폼 명시 저장 (manual)
    const formValues = collectFormValues();
    await fetch('/api/draft/save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docId, formValues, autosave: false }),
    });
    setStatus('info', '본문 생성 + 보관 중...');
    // 2) 본문 생성
    const r = await fetch('/api/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docId, draft: formValues }),
    });
    const data = await r.json();
    if (!data.ok) { setStatus('err', '생성 실패: ' + data.reason); return false; }
    // 3) 영구 보관
    const archiveRes = await fetch('/api/archive', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docId, content: data.content || data.preview, format: 'markdown', cleanupDraft: false }),
    });
    const archiveData = await archiveRes.json();
    // MD 다운로드용 본문 보관 (사용자가 .md 파일로 받아 Pandoc/한컴 등으로 PDF 변환)
    const today = new Date().toISOString().slice(0, 10);
    lastGeneratedDoc = {
      docId,
      content: data.content || data.preview || '',
      filename: docId + '-' + today + '.md',
    };
    if (archiveData.ok) {
      setStatus('ok', '본문 ' + data.length + '자 생성 + 영구 보관 (' + archiveData.data.filename + ') — 우측 상단 MD 다운로드 가능');
    } else {
      setStatus('ok', '본문 ' + data.length + '자 생성 (보관 실패: ' + archiveData.reason + ') — MD 다운로드는 가능');
    }
    const rawMd = data.content || data.preview || '';
    lastRenderedMd = rawMd; // MD 저장/인쇄에 사용 (LLM 본문 결과)
    renderPreview('생성된 본문 — ' + (currentDocTitle || docId), renderMarkdownPreview(rawMd), 'doc', true);   // P2-CU8 humanize
    currentContext = null; // 그래프 preview 가 doc preview 로 덮였으므로 context 토글 상태 초기화
    return true;   // 승인 게이트(wfTransition approve)가 본문 생성+보관 성공을 확인
  } else if (action.name === 'assemble_doc_context') {
    const docId = action.payload?.docId || currentTarget.replace('doc:', '');
    // 토글: 같은 docId 의 그래프가 이미 표시 중이면 양식으로 복귀 (빈 공간 X)
    if (currentContext === docId) {
      currentContext = null;
      setStatus('info', '온톨로지 그래프 접음 — 양식으로 복귀');
      refreshFormPreview(true); // 실시간 양식 다시 그리기
      return;
    }
    setStatus('info', '문서 컨텍스트 불러오는 중...');
    const r = await fetch('/api/assemble', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docId }),
    });
    const data = await r.json();
    if (data.ok) {
      const refs = data.summary || {};
      const title = data.data?.document?.title || docId;
      setStatus('ok', '문서 정보 로드 완료 — 그래프 참조 ' + (refs.resolvedReferences || 0) + '/' + (refs.totalReferences || 0) + ' (한번 더 누르면 접힘)');
      renderPreview('온톨로지 그래프 — ' + title, renderContextHumanFriendly(data.data), 'context');
      currentContext = docId;
    } else {
      setStatus('err', '로드 실패: ' + data.reason);
    }
  } else if (action.name === 'clear_site_profile') {
    if (!confirm('정말 초기화 하시겠습니까?')) return;
    setStatus('info', '초기화 중...');
    const r = await fetch('/api/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    const data = await r.json();
    if (data.ok) { setStatus('ok', '초기화 완료'); loadForm('profile'); }
    else setStatus('err', '초기화 실패');
  } else {
    setStatus('info', 'action: ' + action.name + ' (서버 미구현)');
  }
}

let allDocs = [];

async function loadDocList() {
  try {
    const r = await fetch('/api/list-docs');
    const data = await r.json();
    allDocs = data.docs || [];
  } catch { allDocs = []; }
  renderDocSelect(allDocs);
}

function renderDocSelect(docs) {
  const sel = document.getElementById('doc-select');
  // 1차 그룹핑 축 — 분류(category) 또는 작성 주기(frequency). 기본 분류별 (category 를 1급 IA 로 승격).
  const mode = (document.getElementById('group-mode') || {}).value || 'category';
  sel.innerHTML = '<option value="">— 문서 선택 (전체 ' + docs.length + '종) —</option>';
  const groups = {};
  for (const d of docs) {
    const key = mode === 'category' ? (d.category || '기타') : (d.frequency || '기타');
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  }
  // 그룹 자체 정렬 — 그룹 내 최고 priority 기준 (KEEP-B: priority 정렬 보존)
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const aMax = Math.max(...groups[a].map(x => x.priority || 0));
    const bMax = Math.max(...groups[b].map(x => x.priority || 0));
    return bMax - aMax;
  });
  for (const key of sortedKeys) {
    // 그룹 내부 2차 정렬 — priority(빈도+법령강제+중대재해) 우선 보존 (KEEP-B)
    groups[key].sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.title.localeCompare(b.title, 'ko'));
    const og = document.createElement('optgroup');
    const head = groups[key][0];
    og.label = mode === 'category'
      ? (humanizeCategory(key) + ' (' + groups[key].length + ')')
      : ((head.emoji || '') + ' ' + key + ' (' + groups[key].length + ')');
    for (const d of groups[key]) {
      const opt = document.createElement('option');
      opt.value = d.docId;
      // 분류 모드에서는 그룹 라벨에 분류가 이미 있으므로 제목만, 주기 모드에서는 분류 꼬리표 유지.
      opt.textContent = mode === 'category' ? d.title : (d.title + ' [' + humanizeCategory(d.category) + ']');
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
}

function filterDocs(q) {
  const lower = (q || '').toLowerCase().trim();
  if (!lower) { renderDocSelect(allDocs); return; }
  const filtered = allDocs.filter((d) =>
    d.docId.toLowerCase().includes(lower) ||
    d.title.toLowerCase().includes(lower) ||
    d.category.toLowerCase().includes(lower) ||
    d.frequency.toLowerCase().includes(lower),
  );
  renderDocSelect(filtered);
}

// 초기 로드 — profile 강제 진입 제거(F-wr-6). 역할 스위처 + 역할 홈이 첫 화면.
renderRoleBar();
loadDocList().then(() => goHome());
</script>
</body>
</html>`;

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { "Content-Type": contentType + "; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return send(res, 200, "text/html", HTML);
  }

  if (url.pathname === "/api/list-docs" && req.method === "GET") {
    const docs = loadMaster()
      .map((d: any) => {
        const freq = FREQ_ORDER[d.frequency] ?? 10;
        const lawForce = d.formStrictness === "법령강제" ? 25 : d.formStrictness === "고시" ? 15 : d.formStrictness === "KOSHA표준" ? 8 : 0;
        const penalty = String(d.penaltyOnMissing ?? "");
        const isSevere = penalty.includes("중처법") || d.category === "K_사고" ? 30 : 0;
        // 종합 priority — 사용빈도 + 법령강제 + 중대재해
        const priority = freq + lawForce + isSevere;
        const tags: string[] = [];
        if (d.formStrictness === "법령강제") tags.push("법령강제");
        if (d.category === "K_사고") tags.push("중대재해");
        if (penalty.includes("중처법")) tags.push("중처법");
        return {
          docId: d.docId,
          title: d.title,
          category: d.category,
          frequency: d.frequency,
          formStrictness: d.formStrictness,
          emoji: freqEmoji(d.frequency),
          priority,
          tags,
        };
      })
      .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "ko"));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, docs }));
  }

  // === 역할 홈 "내가 할 일" — list_upcoming_duties (기존 callMcp 재사용, 신규 네트워크 0) ===
  if (url.pathname === "/api/duties" && req.method === "GET") {
    const r = callMcp("list_upcoming_duties", {});
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, data: r.data }));
  }

  // === 비상 워크플로우 제출 정보 (P1-CU6) — get_submission_info (로컬 callMcp, 신규 네트워크 0) ===
  // 중대재해 즉시보고의 제출처·e-노동민원 URL 을 master 에서 실측. 외부링크는 클라이언트에서 사용자 클릭 시에만 열림.
  if (url.pathname === "/api/emergency-info" && req.method === "GET") {
    const r = callMcp("get_submission_info", { docId: "severe_accident_immediate_report" });
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, data: r.data }));
  }

  // === 법적 근거 검증 (P1-CU3) — verify_safety_basis (기존 callMcp 재사용, 신규 네트워크 0) ===
  if (url.pathname === "/api/verify" && req.method === "POST") {
    const body = await readBody(req);
    let p: any;
    try { p = JSON.parse(body); } catch { return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid json" })); }
    // 클라이언트가 명시 claims 를 주면 그대로, 아니면 본문(body) 전체를 단일 claim 으로 검증.
    let claims = Array.isArray(p.claims) && p.claims.length ? p.claims : null;
    if (!claims) {
      const text = String(p.body ?? "").trim();
      if (!text) return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "검증할 본문이 없습니다 — 생성 본문을 먼저 만드세요" }));
      // 본문을 줄 단위로 쪼개 인라인 법령 인용이 있는 문장을 claim 으로 (없으면 전체 1건).
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 4 && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("---"));
      const cited = lines.filter((l) => /제\s*\d+\s*조|§|산안|규칙|법|고시/.test(l)).slice(0, 12);
      const picked = cited.length ? cited : [text.slice(0, 1500)];
      claims = picked.map((c) => ({ claim: c, evidence: [] }));
    }
    const r = callMcpAllowError("verify_safety_basis", { claims });
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, data: r.data }));
  }

  // === 문서 상태기계 라우트 (DP-2, viewer 자체 _workflow/*.json) ===
  // 목록 — 역할 홈 결재함/수신함 채움.
  if (url.pathname === "/api/workflow/list" && req.method === "GET") {
    const items = listWorkflows()
      .map((w) => ({
        docId: w.docId, title: w.title || docTitle(w.docId), state: w.state,
        author: w.author, approver: w.approver, recipient: w.recipient, updatedAt: w.updatedAt,
      }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, items }));
  }
  // 단건 상태 조회 — 문서 열람 시 현재 상태/이력 표시.
  if (url.pathname === "/api/workflow/get" && req.method === "GET") {
    const docId = url.searchParams.get("docId") ?? "";
    if (!safeDocId(docId)) return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid docId" }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, data: readWorkflow(docId) }));
  }
  // 상태 전이 — submit_for_review / approve / reject / send / acknowledge.
  if (url.pathname === "/api/workflow/transition" && req.method === "POST") {
    const body = await readBody(req);
    let p: any;
    try { p = JSON.parse(body); } catch { return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid json" })); }
    const docId = String(p.docId ?? "");
    const verb = String(p.verb ?? "");
    const actor = String(p.actor ?? "");
    if (!safeDocId(docId)) return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid docId" }));
    let w = readWorkflow(docId) ?? { docId, title: docTitle(docId), state: "draft", updatedAt: "", history: [] } as WorkflowState;
    const now = new Date().toISOString();
    // 상태 전제 가드 (critic C2): 각 전이는 정해진 이전 상태에서만 허용. 위반 시 409 로 거절해
    // draft 를 acknowledge 하거나 승인 안 된 문서를 send 하는 모순 이력을 원천 차단한다.
    // comment 는 상태 불변 메모이므로 draft(작성중)만 제외하고 허용.
    const ALLOWED_PRIOR_STATE: Record<string, string[]> = {
      submit_for_review: ["draft", "rejected"],
      approve: ["pending"],
      reject: ["pending"],
      send: ["approved"],
      acknowledge: ["sent"],
      comment: ["pending", "approved", "sent", "received", "rejected"],
    };
    const allowedPrior = ALLOWED_PRIOR_STATE[verb];
    if (!allowedPrior) return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "unknown verb" }));
    if (!allowedPrior.includes(w.state)) {
      return send(res, 409, "application/json", JSON.stringify({
        ok: false,
        reason: `'${verb}' 전이는 현재 상태('${w.state}')에서 허용되지 않습니다 — 필요 상태: ${allowedPrior.join(" / ")}`,
        state: w.state,
      }));
    }
    // 역할은 미인증 자가선택값(localStorage 역할 스위처, DP-1) — 법적 결재 서명이 아님.
    // 이력 항목에 출처를 명시해 감사추적이 신원바인딩 결재로 오인되지 않게 한다.
    w.authMode = "self-selected-role";
    if (verb === "submit_for_review") {
      // 작성자: draft → pending. 작성자 자동 결재선 주입(F-sub-3) + approver 지정.
      w.state = "pending"; w.author = actor || w.author;
      if (p.approver) w.approver = String(p.approver);
      if (Array.isArray(p.coAuthors)) w.coAuthors = p.coAuthors.map(String);
      w.history.push({ actor, verb, at: now });
    } else if (verb === "approve") {
      // 결재자: pending → approved (단독 approve UC-19 도 verb=approve 로 기록).
      w.state = "approved"; w.approver = actor || w.approver;
      w.history.push({ actor, verb, at: now });
    } else if (verb === "reject") {
      // 반려: pending → draft + 사유. 작성자 홈에 보완요청 회귀(F-site-5).
      w.state = "rejected"; w.approver = actor || w.approver;
      w.history.push({ actor, verb, at: now, reason: p.reason ? String(p.reason) : undefined });
    } else if (verb === "send") {
      // approved → sent, recipient 지정 (발주자 등).
      w.state = "sent";
      if (p.recipient) w.recipient = String(p.recipient);
      w.history.push({ actor, verb, at: now });
    } else if (verb === "acknowledge") {
      // 수신자: sent → received + 타임스탬프 (P1-CU4 에서 UI 연결).
      w.state = "received"; w.recipient = actor || w.recipient;
      w.history.push({ actor, verb, at: now, note: p.note ? String(p.note) : undefined });
    } else if (verb === "comment") {
      // 의견 제출 — 상태 불변, 이력에 메모만 append (P1-CU4 열람 뷰 의견 채널, F-wr-5).
      w.history.push({ actor, verb, at: now, note: p.note ? String(p.note) : undefined });
    } else {
      return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "unknown verb" }));
    }
    if (p.title) w.title = String(p.title);
    try { writeWorkflow(w); } catch (e: any) {
      return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: e.message }));
    }
    return send(res, 200, "application/json", JSON.stringify({ ok: true, data: w }));
  }

  if (url.pathname === "/api/form" && req.method === "GET") {
    const target = url.searchParams.get("target") ?? "profile";
    let mcpRes;
    if (target === "profile") {
      mcpRes = callMcp("render_profile_input_form", { format: "json" });
    } else if (target.startsWith("doc:")) {
      const docId = target.slice(4);
      mcpRes = callMcp("render_a2ui_form", { docId, format: "json" });
    } else {
      return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid target" }));
    }

    if (!mcpRes.ok) {
      return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: mcpRes.reason }));
    }
    const data = mcpRes.data ?? {};
    let messages: any[] = [];
    try {
      const parsed = JSON.parse(mcpRes.text ?? "{}");
      messages = parsed.messages ?? [];
    } catch {
      messages = data.messages ?? [];
    }
    const summary = data.totalFields
      ? `${data.totalFields} 필드 · ${data.prefilledCount} 자동채움 · ${data.componentCount} 컴포넌트`
      : `${data.fieldCount ?? 0} 필드 · ${data.prefilledCount ?? 0} 자동채움 · ${data.componentCount ?? 0} 컴포넌트`;
    // P2-CU7 — 필수 라벨 추출. render_a2ui_form 출력은 *(필수)* 마커를 라벨에 싣지 않으므로
    // viewer 서버가 자체 번들 .md(custom→auto)를 직접 읽어 필수 라벨 토큰 집합을 만든다.
    // (MCP shape 불변 — render_a2ui_form 응답은 손대지 않고 viewer chrome 메타로만 동봉)
    let requiredLabels: string[] = [];
    if (target.startsWith("doc:")) {
      requiredLabels = extractRequiredLabels(target.slice(4));
    }
    return send(res, 200, "application/json", JSON.stringify({
      ok: true,
      messages,
      summary,
      fieldPathMap: data.fieldPathMap ?? {},
      requiredLabels,
    }));
  }

  if (url.pathname === "/api/save-profile" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid json" })); }
    const r = callMcp("save_profile_from_form", { formValues: parsed.formValues ?? {}, mode: "merge" });
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, summary: r.data }));
  }

  if (url.pathname === "/api/generate" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid json" })); }
    let draft = parsed.draft && typeof parsed.draft === "object" ? parsed.draft : {};
    if (Object.keys(draft).length === 0) {
      const saved = callMcp("load_form_draft", { docId: parsed.docId });
      if (saved.ok && saved.data?.found && saved.data?.formValues) draft = saved.data.formValues;
    }
    const r = callMcp("generate_safety_document", { docId: parsed.docId, draft });
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    const text = r.text ?? "";
    return send(res, 200, "application/json", JSON.stringify({ ok: true, length: text.length, content: text, preview: text.slice(0, 500) }));
  }

  if (url.pathname === "/api/clear" && req.method === "POST") {
    const r = callMcp("clear_site_profile", { confirm: true });
    return send(res, 200, "application/json", JSON.stringify({ ok: r.ok }));
  }

  // === 로컬 저장소 ===
  if (url.pathname === "/api/draft/save" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid json" })); }
    const r = callMcp("save_form_draft", { docId: parsed.docId, formValues: parsed.formValues ?? {}, autosave: !!parsed.autosave });
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, summary: r.data }));
  }

  if (url.pathname === "/api/draft/load" && req.method === "GET") {
    const docId = url.searchParams.get("docId") ?? "";
    const r = callMcp("load_form_draft", { docId });
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, data: r.data }));
  }

  if (url.pathname === "/api/archive" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid json" })); }
    const r = callMcp("archive_safety_document", { docId: parsed.docId, content: parsed.content ?? "", format: parsed.format ?? "html", cleanupDraft: !!parsed.cleanupDraft });
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, data: r.data }));
  }

  if (url.pathname === "/api/storage-stats" && req.method === "GET") {
    const r = callMcp("get_storage_stats", {});
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, data: r.data }));
  }

  // === 보관문서 목록·읽기 (P1-CU5) — 로컬 documents/ FS read 만. 신규 외부 네트워크 0. ===
  if (url.pathname === "/api/archive/list" && req.method === "GET") {
    return send(res, 200, "application/json", JSON.stringify({ ok: true, items: listArchivedFiles() }));
  }
  if (url.pathname === "/api/archive/read" && req.method === "GET") {
    const docId = url.searchParams.get("docId") ?? "";
    const filename = url.searchParams.get("filename") ?? "";
    const content = readArchivedFile(docId, filename);
    if (content === null) return send(res, 404, "application/json", JSON.stringify({ ok: false, reason: "문서를 찾을 수 없습니다" }));
    return send(res, 200, "application/json", JSON.stringify({ ok: true, docId, filename, content }));
  }

  // === 결재용 양식 반환 — custom/ 우선 → auto/ 폴백 ===
  // custom/ = 안전관리자가 가이드 기반으로 작성한 13섹션 종합 결재 양식 (현장 실무 표준)
  // auto/   = sections.fields 기반 KOSHA 양식 자동 생성 (94종)
  if (url.pathname === "/api/official-form" && req.method === "GET") {
    const docId = url.searchParams.get("docId") || "";
    if (!docId || !/^[a-zA-Z0-9_-]+$/.test(docId)) {
      return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid docId" }));
    }
    const filename = docId + ".md";

    // 1) custom/ 우선
    try {
      const customPath = resolve(FORMS_DIR_CUSTOM, filename);
      if (customPath.startsWith(FORMS_DIR_CUSTOM + "/")) {
        const md = readFileSync(customPath, "utf8");
        return send(res, 200, "application/json", JSON.stringify({ ok: true, docId, md, source: "custom" }));
      }
    } catch { /* custom 없으면 auto 폴백 */ }

    // 2) auto/ 폴백
    try {
      const autoPath = resolve(FORMS_DIR_AUTO, filename);
      if (autoPath.startsWith(FORMS_DIR_AUTO + "/")) {
        const md = readFileSync(autoPath, "utf8");
        return send(res, 200, "application/json", JSON.stringify({ ok: true, docId, md, source: "auto" }));
      }
    } catch { /* 둘 다 없음 */ }

    return send(res, 404, "application/json", JSON.stringify({ ok: false, reason: "form not found" }));
  }

  if (url.pathname === "/api/assemble" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { return send(res, 400, "application/json", JSON.stringify({ ok: false, reason: "invalid json" })); }
    const r = callMcp("assemble_doc_context", { docId: parsed.docId });
    if (!r.ok) return send(res, 500, "application/json", JSON.stringify({ ok: false, reason: r.reason }));
    const data = r.data ?? {};
    const meta = data.meta ?? {};
    return send(res, 200, "application/json", JSON.stringify({
      ok: true,
      data, // structured 전체 — 클라이언트가 한국어 라벨로 렌더
      summary: { totalReferences: meta.totalReferences ?? 0, resolvedReferences: meta.resolvedReferences ?? 0, unresolvedRefs: (meta.unresolvedRefs ?? []).length },
    }));
  }

  send(res, 404, "text/plain", "Not Found");
});

// 자동 브라우저 오픈 — macOS / Windows / Linux 크로스플랫폼.
// AGENT_SAFETY_NO_OPEN=1 이면 건너뜀 (CI·헤드리스·원격 서버 환경 배려).
function openBrowser(url: string): void {
  if (process.env.AGENT_SAFETY_NO_OPEN === "1") return;
  const [cmd, cmdArgs]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* 자동 오픈 실패는 무시 — 사용자가 출력된 URL 로 직접 접속 */
  }
}

/**
 * Viewer HTTP 서버를 기동한다. CLI 의 `viewer` 서브커맨드가 호출한다.
 * 포트 충돌(EADDRINUSE) 시 다른 포트 안내 후 종료.
 */
export function startViewer(): void {
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n[agent-safety-oss] 포트 ${PORT} 가 이미 사용 중입니다.\n` +
          `다른 포트로 실행: PORT=5180 npx -y agent-safety-oss viewer\n`,
      );
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n🛡  Agent Safety OSS — A2UI 폼 Viewer`);
    console.log(`    ${url}`);
    console.log(`\n브라우저가 자동으로 열리지 않으면 위 주소로 직접 접속하세요.`);
    console.log(`페이지에서 폼을 입력하고 저장하면 profile.jsonld 가 갱신됩니다.`);
    console.log(`종료: Ctrl+C\n`);
    openBrowser(url);
  });
}

// 직접 실행(tsx src/viewer.ts / node build/viewer.js) 시 자동 기동.
// CLI 의 `viewer` 서브커맨드는 import 후 startViewer() 를 명시 호출한다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startViewer();
}
