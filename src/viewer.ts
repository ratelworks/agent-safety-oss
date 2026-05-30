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
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    .field-block input, .field-block textarea, .field-block select { width: 100%; }
    .check-toggle { flex-wrap: wrap; gap: var(--space-1); }
    .check-btn { flex: 1; min-width: calc(33% - var(--space-2)); padding: 0 var(--space-2); font-size: 13px; }
    .Button { width: 100%; justify-content: center; }
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

<div class="agent-toolbar">
  <button onclick="loadForm('profile')" id="nav-profile" class="agent-button material is-active">
    <span class="material-symbols-outlined">apartment</span>
    공통 메타 (Profile)
  </button>
  <div class="agent-input-group">
    <label class="agent-label" for="doc-select">법정문서 폼 (94종):</label>
    <select id="doc-select" class="agent-select" onchange="if (this.value) loadForm('doc:' + this.value)">
      <option value="">— 선택 —</option>
    </select>
    <input type="search" id="doc-search" class="agent-input" placeholder="docId·title 검색" oninput="filterDocs(this.value)">
  </div>
</div>

<div id="status"></div>

<div class="split-area">
  <div id="form-container"></div>
  <div id="preview-container"></div>
</div>

<footer class="agent-footer">
  Provided by <strong>황룡건설(주)</strong> · Developed by <a href="mailto:alphamale@ratelworks.co.kr">R/ITEL WORKS</a>
</footer>

</div><!-- /.layout -->

<script>
let currentTarget = 'profile';
let fieldPathMap = {};
let lastGeneratedDoc = null;     // { docId, content, filename } — generate 본문 (MD 다운로드 호환)
let currentContext = null;       // 마지막으로 표시한 assemble_doc_context 의 docId — 토글용
let currentDocTitle = '';        // 현재 docId 의 한국어 제목 (실시간 양식 미리보기 헤더)
let formPreviewDebounce = null;  // 폼 입력 시 양식 미리보기 갱신 debounce
let lastRenderedMd = '';         // 우측에 마지막으로 그린 마크다운 본문 (MD 저장/인쇄용)

const root = document.getElementById('form-container');
const status = document.getElementById('status');

const STATUS_ICON = { ok: 'check_circle', err: 'error', info: 'info' };
function setStatus(kind, msg) {
  status.className = kind;
  const iconName = STATUS_ICON[kind] || 'info';
  // prefix 이모지 제거 + 본문 이모지 → Material Symbols 인라인 치환
  const cleanMsg = (msg || '').replace(/^✅\s*|^❌\s*|^⚠️?\s*|^💡\s*|^🔄\s*/, '');
  status.innerHTML = '<span class="material-symbols-outlined">' + iconName + '</span><span>' + replaceEmojiWithIcons(cleanMsg) + '</span>';
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

async function loadForm(target) {
  currentTarget = target;
  document.querySelectorAll('.agent-toolbar .agent-button').forEach((b) => b.classList.remove('is-active'));
  if (target === 'profile') document.getElementById('nav-profile')?.classList.add('is-active');
  setStatus('info', '폼 로드 중...');
  root.innerHTML = '';
  document.getElementById('preview-container').innerHTML = '';
  currentContext = null;            // 새 폼 로드 시 그래프 토글 상태 초기화
  lastGeneratedDoc = null;           // 이전 docId 의 generated 본문 상태 초기화
  currentDocTitle = '';

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

  try {
    const r = await fetch('/api/form?target=' + encodeURIComponent(target));
    const data = await r.json();
    if (!data.ok) {
      setStatus('err', '실패: ' + (data.reason || 'unknown'));
      return;
    }
    fieldPathMap = data.fieldPathMap || {};
    render(data.messages, data.summary);
    setStatus('ok', data.summary || '폼 로드 완료');
    // draft 자동 복원 + autosave 바인딩 + 외부 변경 폴링
    await maybeLoadDraft();
    setupAutoSave();
    setupLivePreview();             // docId 양식이면 폼 입력 → /api/generate 호출 바인딩 (1.5s debounce)
    refreshFormPreview(true);       // 초기 1회 — generate 빈 draft 호출로 결재용 양식 골격 즉시 표시
    startPolling();
  } catch (e) {
    setStatus('err', '오류: ' + e.message);
  }
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

// 마크다운 본문을 HTML 양식으로 렌더 — marked CDN 사용, 미로드 시 raw 폴백
function renderMarkdownPreview(rawMd) {
  // 1) 법령 기호 한국어화  2) 개발자/도구 메타 제거 (결재용 양식 가독성)
  const ko = stripGeneratedNoise(humanizeLawSymbols(rawMd));
  if (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function') {
    try {
      marked.setOptions({ gfm: true, breaks: false });
      return '<div class="markdown">' + marked.parse(ko) + '</div>';
    } catch (e) {
      // 파싱 실패 시 raw 폴백
    }
  }
  return '<pre class="markdown" style="white-space:pre-wrap;font-family:var(--font-mono);font-size:12px">' + escapeHtml(ko) + '</pre>';
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
    if (!data.ok) { setStatus('err', '생성 실패: ' + data.reason); return; }
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
    renderPreview('생성된 본문 — ' + docId, renderMarkdownPreview(rawMd), 'doc', true);
    currentContext = null; // 그래프 preview 가 doc preview 로 덮였으므로 context 토글 상태 초기화
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
  const r = await fetch('/api/list-docs');
  const data = await r.json();
  allDocs = data.docs || [];
  renderDocSelect(allDocs);
}

function renderDocSelect(docs) {
  const sel = document.getElementById('doc-select');
  sel.innerHTML = '<option value="">— 선택 (전체 ' + docs.length + '종, 빈도·법령강제·중대재해 우선) —</option>';
  const groups = {};
  for (const d of docs) {
    if (!groups[d.frequency]) groups[d.frequency] = [];
    groups[d.frequency].push(d);
  }
  // 그룹 자체 정렬 — 그룹 내 최고 priority 기준
  const sortedFreqs = Object.keys(groups).sort((a, b) => {
    const aMax = Math.max(...groups[a].map(x => x.priority || 0));
    const bMax = Math.max(...groups[b].map(x => x.priority || 0));
    return bMax - aMax;
  });
  for (const freq of sortedFreqs) {
    // 그룹 내 정렬도 priority 우선
    groups[freq].sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.title.localeCompare(b.title, 'ko'));
    const og = document.createElement('optgroup');
    og.label = (groups[freq][0].emoji || '') + ' ' + freq + ' (' + groups[freq].length + ')';
    for (const d of groups[freq]) {
      const opt = document.createElement('option');
      opt.value = d.docId;
      // 제목 + [카테고리] — ★ 같은 시각 단서는 양식·결재 문서에 잘못 묻을 위험이 있어 제거.
      // 법령강제·중대재해 강조는 그룹 라벨 (빈도 emoji + 그룹명) 단위로 이미 표현됨.
      opt.textContent = d.title + ' [' + humanizeCategory(d.category) + ']';
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

// 초기 로드
loadDocList();
loadForm('profile');
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
    return send(res, 200, "application/json", JSON.stringify({
      ok: true,
      messages,
      summary,
      fieldPathMap: data.fieldPathMap ?? {},
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
