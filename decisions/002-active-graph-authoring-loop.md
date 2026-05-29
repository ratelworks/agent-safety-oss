---
id: 002
status: accepted
date: 2026-05-21
deciders: 황룡, Claude
tags: [a2ui, ontology-graph, llm, authoring, review, writing-guide]
---

# 002. Active Graph Authoring Loop — A2UI ↔ LLM ↔ Graph 능동 루프

## Context

본 OSS 의 본질 우선순위 (사용자 황룡 2026-05-21 명시):

1. **온톨로지 그래프를 활용한 작성 보조와 가이드라인**
2. **완성된 문서에 대한 검토**
3. **a2ui 를 이용해서 작성자에게 필요한 정보들을 능동적으로 가져올 수 있도록 LLM 과 연결**

양식 외형 동일성(HWP/PDF 주입)은 본질 1~3 완성 이후의 후속 모듈로 분리.

### 현재 자원 vs 활용 — 10개 갭

조사 결과 (rules/decisions.md / rules/specs.md 박제용 요약):

| 코드 | 사실 | 영향 |
|---|---|---|
| F1 | docs JSONLD 에 `requiredFields`(공식 양식 1:1) + `sections`(generic) 공존 | 두 양식 정의 충돌 |
| F2 | `render-a2ui-form.ts:232-241` flattenFields() 가 sections 우선 → requiredFields 무시 | KOSHA 1:1 검증된 32 필드(daily_tbm) 누락 |
| F3 | `_meta.writingGuide` (fieldHints·commonMistakes·bestPractices) — A2UI/generate/review 미참조 | 작성 보조 자원 사장 |
| F4 | 공식 PDF/HWP 132 종 내장 vs. draft 주입 경로 없음 | 양식 외형 갭 (후속) |
| F5 | viewer/ 미존재 (ADR 001 spec T2~T5 미진행) | 비-개발자 도달 경로 미완성 |
| F6 | `_meta.writingGuide` 보유 노드 **17/97 (18%)** | 작성 보조 커버리지 부족 |
| F7 | `checkPoints` **1,302건** 풍부 — generate 만 사용 | A2UI/review 누락 |
| F8 | `review-safety-document.ts:808-811` 도 sections 우선 → requiredFields 무시 | review 정합성↓ |
| F9 | L2 의미 검수는 단 **2 docId** (risk_assessment + work_plan_excavation) | 17 docId 는 L1 만 |
| F10 | `reviewRules` (severity 별 blocker/warning/manual_review) 설계 우수 | 노드별 보강 필요 |

### 핵심 진단

현재 `render-a2ui-form.ts` 는 **정적 1회 렌더**:
- Action 2개만 (`submit_safety_document`, `assemble_doc_context`)
- 사용자 입력 → LLM 호출 → 그래프 정보 능동 끌어옴 → 폼 동적 업데이트 **루프 메커니즘 부재**
- A2UI 프로토콜 자체는 `updateComponents` / `updateDataModel` 로 양방향 지원하는데 코드가 미활용

작성 보조 자원 (writingGuide / checkPoints / assemble_doc_context / analyze_construction_work_risks / get_measures_by_risk / get_kosha_archive_files / query_legal_basis 등) 은 풍부한데 **A2UI 폼이 능동적으로 끌어오는 trigger 가 없어 사장**.

## Decision

**A2UI ↔ LLM ↔ Graph 의 3단계 능동 루프를 본 OSS 의 작성·보조·검토 흐름의 본체로 채택한다.**

```
[A2UI 폼]                  [LLM (MCP host)]           [Graph 도구들]
사용자 입력 신호  ────→    도구 체이닝 결정   ────→  assemble_doc_context
                                                      analyze_construction_work_risks
                                                      get_measures_by_risk
                                                      compile_safety_references
                                                      query_legal_basis
                                                      get_kosha_archive_files
                                                      ...
폼 동적 업데이트  ←────    updateComponents   ←──── 결과 조립
(가이드·추천·경고)
```

### 3 단계 루프

**1단계 — 폼 초기 렌더 (현재 + 강화)**:
- `render_a2ui_form` 의 info-card 에 `assemble_doc_context` 결과 인라인 (법령·hazard·control·관련문서·라이프사이클)
- 필드별 `_meta.writingGuide.fieldHints` + `checkPoints` 노출
- 필드별 `commonMistakes` / `bestPractices` 를 guide 컴포넌트 하단에 표시

**2단계 — 사용자 입력 trigger → LLM 능동 호출**:
A2UI 액션 4종 신설 (각각 MCP 도구로 등록 → LLM 이 자연스럽게 체이닝):

| 액션 | payload | LLM 체이닝 |
|------|---------|----------|
| `analyze_work_context` | `{ docId, workName, workContent, workConditions }` | analyze_construction_work_risks + get_kosha_archive_files + query_legal_basis |
| `suggest_controls_for_hazard` | `{ hazard 입력값 }` | get_measures_by_risk + ERIC-PP 정렬 + KOSHA Guide 매핑 |
| `request_field_help` | `{ docId, fieldKey, currentValue }` | 노드 _meta.writingGuide + checkPoints + 동일 docId 예시 조회 |
| `preview_review` | `{ docId, draft (부분) }` | review_safety_document 부분 호출 + 환각·누락 실시간 |

각 도구는 결과를 `updateComponents` JSONL 로 반환 — viewer/Claude Desktop 이 폼에 동적 push.

**3단계 — 최종 검토 & 완성 (기존 활용)**:
- `submit_safety_document` (작성 완료) + `review_safety_document` (전체 검토)
- preview_review 누적 결과 → 최종 review 가 점진 차감

### 데이터 보강 트랙 (병행)

- **P2**: `_meta.writingGuide` 노드 커버리지 17 → 50 (핵심 19종 우선)
- **P3**: L2 의미 검수 reviewRules 보강 2 → 19 docId (그래프 traversal 기반 자동 점검)
- **P4**: checkPoints 를 review-safety-document.ts 에 통합 (1,302건 warn 활용)
- **P5**: 노드별 `formAuthority` 메타로 sections vs requiredFields 우선순위 노드별 명시

P1 (코드 수정) → P2~P5 (데이터 보강) 순차 진행. P1 은 즉시 효과 / P2~P5 는 누적 효과.

## Consequences

### Positive

- 작성 보조 자원이 **그래프에서 폼으로 능동 흐름** — 안전관리자가 별도 도구 호출 학습 불요
- LLM 이 사용자 입력 맥락을 보고 그래프 도구를 자연 체이닝 → MCP 본질(에이전트가 도구 발견·체이닝) 충족
- A2UI 프로토콜의 `updateComponents` 진가 활용 — 정적 폼 → 동적 협업 UI
- 검토(review)가 작성 중에도 부분 호출 — "결재 직전 한 번 검토" → "작성 중 실시간 가드레일"
- writingGuide / checkPoints / reviewRules 노드 보강 시 코드 수정 없이 자동 풍부화 (그래프 기반 일반화)

### Negative

- A2UI 폼이 더 복잡해짐 — info-card / guide / suggestion 영역 등 컴포넌트 수↑
- LLM 도구 호출 횟수↑ — Claude Desktop 등 MCP host 의 토큰 비용 증가 (단 그래프는 결정론적 → 환각 비용은 0)
- viewer/ 미존재로 A2UI 양방향 흐름을 끝까지 검증하려면 ADR 001 spec T2~T5 진행 필요 (병행)
- `_meta.writingGuide` 노드 80개 보강은 시간 소모 (P2 단독으로 1~3주)

### Neutral

- 양식 외형 동일성 (F4) 은 본 ADR 범위 외 — 후속 ADR 003 후보 (HWP fill / PDF AcroForm / 1:1 HTML 재현)
- viewer/ T2~T5 진행 (ADR 001) 은 본 ADR 과 직교 — 둘 다 진행 시 시너지

## Alternatives Considered

1. **Path A: F2+F3 단순 패키지 (정적 보조만)** — render-a2ui-form 만 수정해서 writingGuide / checkPoints 정적 노출. 1-2일 소모. 그러나 LLM 능동 호출 루프 미구현 → 사용자 메시지("능동적으로 가져올 수 있도록")와 충돌 → REJECT
2. **Path B: F2+F3+F4 양식 외형 동시 진행** — HWP/PDF inject 까지 한 번에. 5-7일 소모. 그러나 사용자 우선순위(작성 품질 + 그래프 보조 + 검토)와 외형 동일성은 직교, 본질 1~3 가 더 시급 → DEFER (후속 ADR)
3. **Path C: 그래프 보조 + A2UI 능동 루프 (본 결정)** ✅ — 3단계 루프로 본질 1~3 동시 충족. P1 (코드 3-5일) + P2~P5 (데이터 보강 누적) 순차.
4. **Path D: A2UI 폐기 + Web UI 신규 개발** — React/Next 기반 web/ 신규. 1-2주 소모, 의존성·번들 무게↑. A2UI vanilla 철학 부정 → REJECT (viewer/ 격상 후 한계 도달 시 후속 ADR)

## Implementation

`.specs/in-progress/2026-05-21-active-graph-authoring-loop.md` 참조.

Phase 1A (코드 수정, 3-5일):
- render-a2ui-form.ts 강화 (writingGuide + checkPoints + assemble_doc_context inline + 4종 액션 버튼)
- 신규 도구 4종 작성 + tool-registry 등록
- 빌드 검증

Phase 1B (데이터 보강, 1-3주 누적):
- P2: writingGuide 17 → 50 노드
- P3: L2 의미 검수 2 → 19 docId (reviewRules 보강)
- P4: checkPoints → review 통합
- P5: formAuthority 메타 추가

Phase 1C (viewer/, 4-7일):
- ADR 001 spec T2~T5 진행 — viewer 격상 + A2UI 양방향 흐름 클라이언트 구현

## References

- 사용자 메시지 2026-05-21: "온톨로지 그래프를 활용한 작성 보조와 가이드라인, 완성된 문서에 대한 검토이고 a2ui 를 이용해서 작성자에게 필요한 정보들을 능동적으로 가져올 수 있도록 LLM 과 연결"
- decisions/001-a2ui-viewer-promotion.md (ADR 001 — viewer 격상)
- `src/tools/render-a2ui-form.ts:232-241` (F2 sections 우선)
- `src/tools/review-safety-document.ts:808-811` (F8 review 도 sections 우선)
- `src/tools/assemble-doc-context.ts` (그래프 traversal 결과 조립)
- `src/ontology/graph/nodes/documents/daily-tbm.jsonld:431-470` (_meta.writingGuide 예시)
- Agent_HQ PHILOSOPHY.md §9 (Agent-first / Protocol-first / 4층 매핑 / Human fallback)
