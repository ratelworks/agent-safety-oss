# A2UI 데모 — 브라우저에서 폼 보기

`render_a2ui_form` 도구가 출력하는 A2UI v0.9 JSONL 을 브라우저에서 즉시 폼으로 렌더링하는 데모.

> A2UI 는 Google 의 Agent-to-UI 오픈 프로토콜. **선언적 데이터** (실행 코드 X) 로 폼·카드·리스트를 표현해 LLM 이 안전하게 UI 를 생성할 수 있게 합니다.

## 두 가지 사용법

### A. 정식 데모 — 폼 선택 + 자동 호출 (권장)

`npm run mcp:demo:viewer` 한 줄로 브라우저 데모 서버가 시작됩니다.

```bash
git clone https://github.com/ratelworks/agent-safety-oss.git
cd agent-safety-oss
npm install
npm run build
npm run mcp:demo:viewer
# → http://localhost:5174 자동 시작
```

브라우저에서:
1. 폼 종류 선택 (TBM 회의록 / 굴착 작업계획서 / 위험성평가 / 사이트 프로파일 등)
2. 서버가 MCP CLI 를 호출해서 A2UI JSONL 을 받아옵니다
3. 빈칸·플레이스홀더·법령 근거가 자동 표시된 폼이 렌더링됩니다
4. 입력 후 "제출" → `save_profile_from_form` 또는 `submit_safety_document` 흐름으로 전달

소스: [`scripts/dev/demo-a2ui-viewer.ts`](../scripts/dev/demo-a2ui-viewer.ts).

### B. 정적 단독 시연 — JSONL 직접 붙여넣기

서버 없이 `index.html` 만 브라우저로 열어도 됩니다. JSONL 만 어디서든 받아서 textarea 에 붙여넣어 보기 위한 모드.

```bash
# 1) 폼 JSONL 받기
npm run mcp:a2ui:demo > /tmp/form.jsonl
# 또는: node build/cli.js call render_a2ui_form --inputJson '{"docId":"work_plan_excavation","format":"jsonl"}' > /tmp/form.jsonl

# 2) 브라우저로 viewer 열기
open a2ui-demo/index.html

# 3) 화면 textarea 에 /tmp/form.jsonl 내용 붙여넣기
```

소스:
- [`index.html`](./index.html) — viewer UI (Pretendard 폰트 + JSONL 입력 textarea)
- [`viewer.js`](./viewer.js) — A2UI v0.9 컴포넌트 (Column · Row · Card · Text · TextField · ChoicePicker · Button · …) 렌더러. 의존성 0, vanilla JS.

## A2UI 폼이 지원되는 docId

`render_a2ui_form` 도구는 94 개 법정문서 docId 중 작성 가능한 양식 전체에 대응합니다. 자주 쓰이는 입력 예:

| docId | 설명 |
|---|---|
| `daily_tbm` | TBM 회의록 |
| `work_plan_excavation` | 굴착 작업계획서 (산안기준규칙 별표4) |
| `regular_risk_assessment` | 정기 위험성평가 |
| `safety_health_management_plan` | 안전보건관리계획 |
| `industrial_accident_report` | 산업재해조사표 |

전체 docId 는 `npm run mcp:tools` 또는 `node build/cli.js call list_legal_documents`.

## 주의

- 데모는 작성 보조의 시각화만 보여줍니다 — **실제 폼 제출·저장·결재선 워크플로우는 Claude Desktop · Codex CLI 등 MCP host 안에서 도구로 흐름**.
- A2UI 명세 자체의 한계: 뷰어는 선언적 렌더링만 담당, 클라이언트 측 동적 추가/삭제·실시간 유효성 검사·로컬 상태 저장은 불가. 동적 UX 가 필요하면 React/SaaS 가 적합합니다.
- 본 폴더는 npm 패키지 publish 시 포함 안 됨 (`package.json` files 배열에 미포함). GitHub repo 에서만 시연 자원으로 제공됩니다.
