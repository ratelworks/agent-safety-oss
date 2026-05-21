---
spec_id: 2026-05-21-a2ui-viewer-promotion
status: in-progress
created: 2026-05-21
priority: P1
estimated_hours: 8
references:
  - decisions/001-a2ui-viewer-promotion.md
---

# a2ui-demo → viewer 격상

## Requirements (EARS 형식)

### R1 — 19종 동적 처리
- WHEN `render_a2ui_form` 도구가 임의의 docId 로 호출될 때, SYSTEM SHALL `viewer/` 가 해당 docId 의 A2UI JSONL 을 받아 폼으로 렌더한다.
- IF docId 가 19종 법정문서 (daily_tbm, work_plan_excavation, regular_risk_assessment 등) 중 어느 것이든, SYSTEM SHALL 동일한 viewer 인터페이스로 작동한다.

### R2 — 비-개발자 도달
- WHEN 비-개발자 안전관리자가 `viewer/` URL 에 접근할 때, SYSTEM SHALL MCP host 설치 없이 폼 입력 → 결과 export 까지 완결한다.
- IF 사용자가 CLI / MCP Inspector 를 모르더라도, SYSTEM SHALL 브라우저 한 곳에서 작업을 완료할 수 있어야 한다.

### R3 — 필드 채우기
- WHEN 폼이 렌더링될 때, SYSTEM SHALL profile.jsonld 자동 채움 (prefill) 값을 표시하고, 빈 칸은 입력 가능하게 한다.
- IF 필드가 필수일 때, SYSTEM SHALL 시각 표지 (`*`) 를 표시하고 미입력 시 제출을 차단한다.

### R4 — MD export
- WHEN 사용자가 "MD 다운로드" 를 클릭할 때, SYSTEM SHALL 입력값을 `generate_safety_document` MCP 호출로 전달하여 반환 MD 텍스트를 `{docId}-{YYYY-MM-DD}.md` 파일로 다운로드한다.

### R5 — PDF export
- WHEN 사용자가 "PDF 다운로드" 를 클릭할 때, SYSTEM SHALL MD 를 HTML 로 렌더한 후 `window.print()` 트리거로 사용자가 "PDF 로 저장" 을 선택하게 한다.
- IF 인쇄용 CSS (`@media print`) 가 정의되어 있을 때, SYSTEM SHALL A4 페이지 / 한국어 폰트 / 결재란 / 페이지 번호를 표준 형식으로 출력한다.

### R6 — 의존성 0 원칙
- IF 새로운 npm 의존성을 추가해야 할 때, SYSTEM SHALL 단일 의존성 (예: marked) 까지만 허용하고, 그 외는 vanilla JS 로 구현한다.

## Acceptance Criteria

- [ ] `viewer/` 폴더에서 `daily_tbm`, `work_plan_excavation`, `regular_risk_assessment` 3종 docId 가 모두 렌더된다
- [ ] 폼 입력 → MD 다운로드 → 정확한 MD 파일이 받아진다 (generate_safety_document 결과와 일치)
- [ ] 폼 입력 → PDF 인쇄 다이얼로그 → A4 1페이지 이상 출력 가능
- [ ] `package.json` files 배열에 `viewer/` 포함, `npm pack` 검증 시 viewer/ 파일이 패키지에 들어감
- [ ] 기존 `npm run mcp:demo:viewer` 가 `npm run mcp:viewer` 로 동작
- [ ] `render-a2ui-form.ts` description / nextActions 에 viewer/ 가 동급 클라이언트로 등재
- [ ] 의존성 추가는 0 또는 marked 단일만
- [ ] README 의 "데모" 표현이 viewer 로 전면 교체

## Design

### 흐름 다이어그램

```
[사용자 브라우저]
    │
    │  GET /viewer?docId=daily_tbm
    ↓
[viewer-server.ts (Node)]
    │
    │  MCP call: render_a2ui_form({ docId: "daily_tbm" })
    ↓
[agent-safety-oss MCP]
    │
    │  A2UI v0.9 JSONL 반환
    ↓
[viewer.js (브라우저)]
    │  · createSurface + updateComponents 적용
    │  · profile.jsonld prefill 표시
    │  · 사용자 입력 채우기
    │
    ↓ (제출)
    │
    │  POST /api/generate  { docId, draft }
    ↓
[viewer-server.ts]
    │
    │  MCP call: generate_safety_document({ docId, draft })
    ↓
[agent-safety-oss MCP]
    │
    │  MD 반환
    ↓
[viewer.js]
    │  · MD 다운로드 버튼 활성
    │  · "PDF 다운로드" → marked → HTML → window.print()
    ↓
[사용자]
    · {docId}-2026-05-21.md
    · 인쇄 다이얼로그 → PDF 저장
```

### 의존성

- 기존: 0 (vanilla JS)
- 신규: `marked` (MD → HTML 변환, 단일 의존성)
- 거부: jsPDF, html2pdf, puppeteer (의존성 0 원칙)

## File Structure

```
agent-safety-oss/
├── viewer/                      ← (신규) a2ui-demo/ 리네임
│   ├── index.html               ← title/UX 갱신
│   ├── viewer.js                ← 19종 동적 + MD/PDF export
│   ├── print.css                ← (신규) @media print 규칙
│   └── README.md                ← "viewer" 정체성 명시
├── scripts/dev/
│   └── viewer-server.ts         ← demo-a2ui-viewer.ts 리네임
├── decisions/
│   └── 001-a2ui-viewer-promotion.md  ← 작성 완료
├── .specs/in-progress/
│   └── 2026-05-21-a2ui-viewer-promotion.md  ← 이 파일
├── src/tools/render-a2ui-form.ts  ← description/nextActions 갱신
├── package.json                   ← files 배열 / scripts 갱신
└── README.md                      ← "viewer 로 직접 접근" 섹션 추가
```

## Tasks

본 spec 의 작업 단위는 TaskList #1 ~ #5 와 1:1 매핑:

- [x] T1 — ADR + .specs/ 결정 박제 (본 파일)
- [ ] T2 — 폴더 리네임 + 메타파일 갱신
- [ ] T3 — viewer.js 확장 (19종 docId 동적)
- [ ] T4 — 폼 입력 + MD/PDF export 흐름
- [ ] T5 — README + 문서 정비

## References

- decisions/001-a2ui-viewer-promotion.md
- Agent_HQ PHILOSOPHY.md §9
- MEMORY: agentsafety_central_distribution_vision
- `~/.claude/rules/specs.md` (T7)
- 기존 a2ui-demo/{index.html, viewer.js, README.md}
- src/tools/render-a2ui-form.ts
- src/tools/render-profile-input-form.ts
