---
id: 001
status: accepted
date: 2026-05-21
deciders: 황룡, Claude
tags: [a2ui, viewer, ux, architecture, accessibility]
---

# 001. a2ui-demo → viewer 격상 — 데모가 아니라 운영 UI

## Context

agent-safety-oss 의 본질 목적:

- SAM 5,400사 / **14,000 안전관리자** 도달
- 19종 법정문서 매일 작성 보조
- 엔드유저 = QC + 감리원 + 안전관리자 (비-개발자)
- 주간 7h → 2h 10m (70%↓)

현재 `a2ui-demo/` 구조 문제:

1. 폴더명 `demo` — 일회성 시연 표현
2. `package.json` files 배열 미포함 — npm publish 시 제외
3. `index.html` title 굴착 작업계획서 고정, `viewer.js` Button action `submit_work_plan` 하드코딩 — 19종 중 1종만
4. README "주의": "실제 흐름은 MCP host 안에서" — 비-개발자 도달 경로 부정

Agent_HQ PHILOSOPHY.md §9 체크리스트로 검증:

| 항목 | 현재 | 평가 |
|------|-----|------|
| Agent-first | MCP 도구 17종 운영 | PASS |
| Protocol-first | A2UI v0.9 (Google 표준) | PASS |
| 4층 매핑 | A2UI 층이 데모 상태 | **FAIL** |
| Human fallback | 비-개발자가 도달할 경로 없음 | **FAIL** |
| Lineage | profile.jsonld 자동 채움 | PASS |
| 직원 역할 | 안전관리자 직접 사용 불가 | **FAIL** |
| A2UI | JSONL 생성 OK, 사용자 도달 미완성 | PARTIAL |

3개 항목 실패 — 본질 목적과 현재 architecture 의 충돌.

## Decision

**a2ui-demo/ 를 viewer/ 로 격상하여 운영 UI 본체로 승격한다.**

격상 범위:

1. 폴더명 `a2ui-demo/` → `viewer/`
2. `package.json` files 배열에 `viewer/` 포함 → npm publish 자원
3. 19종 법정문서 docId 동적 처리 (URL `?docId=daily_tbm` 등)
4. 폼 입력 + MD/PDF export 최소 흐름 지원
5. 의존성 0 원칙 유지 (vanilla JS) — viewer.js 의 본래 철학 보존
6. PDF 변환: 브라우저 `window.print()` + `@media print` CSS — 의존성 0 + A4 출력 표준

`render_a2ui_form` 도구의 description / `nextActions` 도 `viewer/` 를 동급 클라이언트로 인정하도록 갱신.

## Consequences

### Positive

- 비-개발자 안전관리자 직접 도달 가능 — 본질 목적 충족
- §9 체크리스트 3개 실패 항목 해소 (4층 매핑 / Human fallback / 직원 역할)
- npm 패키지 한 번 설치로 viewer 까지 묶임 — 배포 단순화
- vanilla JS 유지 → 정적 호스팅 가능 (GitHub Pages 등)
- Codex/CLI 등 비-A2UI 환경에서도 viewer URL 안내로 우회 가능

### Negative

- viewer.js 유지 비용↑ — 19종 동적 처리, A2UI 컴포넌트 풀 구현 부담
- PDF 미세 조정 한계 — 한글 폰트 임베드, 페이지 분할, 결재선 배치는 브라우저 print 기본 동작에 의존
- 동적 추가/삭제 / 실시간 유효성 검사 등 복잡 UX 는 여전히 한계 (A2UI 명세 자체 제약)
- MCP 호출 흐름이 서버 측 (`scripts/dev/viewer-server.ts`) 에 노출됨 — 보안 검토 필요

### Neutral

- DOCX/HWP export 는 본 decision 범위 외 — 후속 decision 002 후보
- React/Next 기반 web/ 격상은 viewer/ 한계 도달 시 decision 003 후보

## Alternatives Considered

1. **데모 유지 + Claude Desktop 권장** — 비-개발자 도달 불가, 본질 부정 → REJECT
2. **React/Next 기반 web/ 신규 개발** — 1-2주 소요, 의존성·번들 무게↑. viewer.js 격상 후에도 한계 도달하면 그때 후속 decision → DEFER
3. **본 결정 (viewer.js vanilla 확장)** ✅ — 최소한 + 즉시 가능 + 의존성 0 철학 보존

## Implementation

`.specs/in-progress/2026-05-21-a2ui-viewer-promotion.md` 참조.

## References

- `dev/Agent_HQ/PHILOSOPHY.md` §9 체크리스트
- agent-safety-oss/a2ui-demo/README.md (현재 데모 자체 한계 인정 문단)
