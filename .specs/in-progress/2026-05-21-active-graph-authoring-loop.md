---
spec_id: 2026-05-21-active-graph-authoring-loop
status: in-progress
created: 2026-05-21
priority: P0
estimated_hours: 24
references:
  - decisions/002-active-graph-authoring-loop.md
  - decisions/001-a2ui-viewer-promotion.md
---

# Active Graph Authoring Loop

## Requirements (EARS 형식)

### R1 — A2UI 폼이 그래프 컨텍스트를 능동 노출

- WHEN `render_a2ui_form({docId})` 가 호출될 때, SYSTEM SHALL info-card 영역에 `assemble_doc_context` 결과 (법령근거·hazard·control·관련문서·라이프사이클) 의 핵심 요약을 인라인으로 포함한다.
- WHEN 노드에 `_meta.writingGuide` 가 존재할 때, SYSTEM SHALL 폼 상단 또는 필드 guide 영역에 fieldHints / commonMistakes / bestPractices 를 시각화한다.
- WHEN 노드의 필드가 `checkPoints` 를 가질 때, SYSTEM SHALL 해당 필드 guide 컴포넌트에 체크포인트를 점검 항목 리스트로 표시한다.

### R2 — A2UI 액션 4종으로 LLM 능동 호출

- WHEN 사용자가 작업명/내용을 입력하고 "이 작업의 위험·KOSHA·법령 보기" 버튼을 클릭할 때, SYSTEM SHALL `analyze_work_context` 액션을 발생시켜 LLM 이 analyze_construction_work_risks + get_kosha_archive_files + query_legal_basis 를 체이닝하도록 한다.
- WHEN 사용자가 위험요인 필드를 입력하고 "통제대책 추천" 버튼을 클릭할 때, SYSTEM SHALL `suggest_controls_for_hazard` 액션을 발생시킨다.
- WHEN 사용자가 필드 옆 "?" 도움말 버튼을 클릭할 때, SYSTEM SHALL `request_field_help({docId, fieldKey, currentValue})` 액션을 발생시켜 LLM 이 노드의 fieldHints + checkPoints + 동일 docId 예시를 동적으로 제공하도록 한다.
- WHEN 사용자가 "현재까지 작성 검토" 버튼을 클릭할 때, SYSTEM SHALL `preview_review` 액션을 발생시켜 LLM 이 review_safety_document 를 부분 호출하고 결과를 폼에 동적 push 하도록 한다.

### R3 — 신규 MCP 도구 4종

- WHEN MCP host 가 LLM 도구 카탈로그를 조회할 때, SYSTEM SHALL `analyze_work_context`, `suggest_controls_for_hazard`, `request_field_help`, `preview_review` 4 도구를 노출한다.
- IF 각 도구의 description 에 다음 도구 추천(nextActions) 이 명시되어 있을 때, SYSTEM SHALL LLM 이 자연스럽게 체이닝하도록 유도한다.

### R4 — 결정론·환각 0 원칙 유지

- WHEN 신규 도구가 결과를 조립할 때, SYSTEM SHALL 그래프 노드 IRI / 번들 법령 / KOSHA Guide 메타에서 결정론적으로 도출하며, LLM 추측을 본문에 포함하지 않는다.
- IF 그래프 노드에 정보가 없을 때, SYSTEM SHALL 빈 결과 + "그래프 미매핑" 명시로 응답한다.

### R5 — 빌드·번들 회귀 차단

- WHEN typecheck / build / mcp:tools 실행 시, SYSTEM SHALL 신규 도구 4종 추가로 인한 회귀 0건이어야 한다.
- IF 도구 count regression CI 단계가 있을 때, SYSTEM SHALL README badge / docs 의 도구 수와 자동 동기화한다.

## Acceptance Criteria

- [ ] `render_a2ui_form({docId: "daily_tbm"})` 출력 components 에 assemble_doc_context 요약 포함 (legalBasis ≥1 / hazards ≥1 / controls ≥1)
- [ ] daily_tbm 의 `_meta.writingGuide.fieldHints` 가 폼 guide 컴포넌트에 표시됨 (`fieldGuideHints` 키 노출)
- [ ] daily_tbm 의 `_meta.writingGuide.commonMistakes` / `bestPractices` 가 info-card 또는 별도 컴포넌트에 노출됨
- [ ] 폼 actions Row 에 4개 신규 버튼 추가 — `analyze_work_context` / `suggest_controls_for_hazard` / `request_field_help` / `preview_review`
- [ ] 신규 도구 4개가 `node build/cli.js tools` 에 등장
- [ ] 각 도구 description 에 nextActions 또는 chain hint 포함
- [ ] `npm run typecheck:src` + `npm run build` 통과
- [ ] `npm run mcp:test:smoke` 통과
- [ ] 환각 0 검증: 각 도구 결과는 graph IRI 또는 bundle 법령 출처 명시

## Design

### 흐름 다이어그램

```
[viewer / Claude Desktop / MCP Inspector]
    │
    │  사용자: "오늘 TBM 작성"
    │  → MCP call: render_a2ui_form({docId: "daily_tbm"})
    ↓
[agent-safety-oss MCP]
    │
    │  1. graph node 로드
    │  2. assemble_doc_context 내부 호출 → 법령/hazard/control 요약
    │  3. _meta.writingGuide 추출
    │  4. sections 또는 requiredFields 평탄화 (formAuthority 메타 기반)
    │  5. 각 필드에 checkPoints + fieldHints 부착
    │  6. A2UI v0.9 JSONL 조립 (createSurface + updateComponents)
    │     · header / info-card (graph 요약) / writingGuide-card / fields-section / actions (6 버튼)
    ↓
[A2UI 클라이언트]
    │  · 폼 렌더 → 사용자 입력
    │
    ├─→ "이 작업의 위험·KOSHA 보기" 버튼
    │     │  action: analyze_work_context({docId, workName, workContent})
    │     ↓
    │     [LLM] tool chain:
    │           analyze_construction_work_risks
    │           + get_kosha_archive_files
    │           + query_legal_basis
    │     ↓
    │     [A2UI updateComponents] 동적 패널 push
    │
    ├─→ "통제대책 추천" 버튼
    │     │  action: suggest_controls_for_hazard({hazard})
    │     ↓
    │     [LLM] tool chain: get_measures_by_risk + ERIC-PP 정렬
    │     ↓
    │     [A2UI updateComponents] 추천 카드 push
    │
    ├─→ 필드 옆 "?" 버튼
    │     │  action: request_field_help({docId, fieldKey, currentValue})
    │     ↓
    │     [LLM] tool chain: assemble_doc_context.fieldHints + 노드 examples
    │     ↓
    │     [A2UI updateComponents] 도움말 push
    │
    ├─→ "현재까지 검토" 버튼
    │     │  action: preview_review({docId, draft})
    │     ↓
    │     [LLM] tool chain: review_safety_document (부분 모드)
    │     ↓
    │     [A2UI updateComponents] 검토 결과 push
    │
    └─→ "작성 완료" 버튼
          │  action: submit_safety_document({docId, draft})
          ↓
          [LLM] tool chain: generate_safety_document → review_safety_document → 최종
```

### 신규 도구 4종 인터페이스

#### `analyze_work_context`
```
Input: { docId: string, workName: string, workContent?: string, workConditions?: object }
Output:
  - content: text (Markdown 요약)
  - structuredContent:
      hazards: HazardInfo[]  (analyze_construction_work_risks 결과)
      koshaGuides: KoshaArchiveFile[]
      legalArticles: ArticleInfo[]
      a2uiUpdate: A2UIMessage[]  (선택, viewer 직접 적용 가능)
      nextActions: string[]
```

#### `suggest_controls_for_hazard`
```
Input: { hazard: string, docId?: string, scale?: ScaleInfo }
Output:
  - content: text (ERIC-PP 위계 표)
  - structuredContent:
      controls: ControlInfo[]  (ericLevel 순)
      relatedKoshaGuides: KoshaGuideInfo[]
      a2uiUpdate: A2UIMessage[]
      nextActions: string[]
```

#### `request_field_help`
```
Input: { docId: string, fieldKey: string, currentValue?: string }
Output:
  - content: text (필드 가이드)
  - structuredContent:
      fieldLabel: string
      inputGuide: string
      examples: string[]
      checkPoints: string[]
      fieldHint: string  (_meta.writingGuide.fieldHints[label])
      commonMistakes: string[]  (관련만)
      bestPractices: string[]  (관련만)
      a2uiUpdate: A2UIMessage[]
      nextActions: string[]
```

#### `preview_review`
```
Input: { docId: string, draft: object, scope?: "all" | "required-only" | "hallucination-only" }
Output:
  - content: text (REVISION_NEEDED 헤더 + 요약)
  - structuredContent:
      overall: "pass" | "needs_revision" | "fail"
      summary: { pass, warn, manual_review, fail }
      missingRequired: string[]  (필수 미작성 라벨)
      hallucinations: { reference, reason }[]
      checks: CheckResult[]
      a2uiUpdate: A2UIMessage[]
      nextActions: string[]
```

### `render_a2ui_form` 강화 — 컴포넌트 구조

```
root (Column)
├── header (Text, h1)              — 문서 제목
├── info-card (Card)
│    └── info-col (Column)
│         ├── info-purpose
│         ├── info-meta
│         ├── info-laws
│         ├── info-graph-context   (NEW: assemble_doc_context 요약 — hazards/controls/relatedDocs)
│         └── info-lifecycle       (NEW: submitTo/submitDeadline/retention)
├── guide-card (Card)              (NEW: _meta.writingGuide 노출)
│    └── guide-col (Column)
│         ├── guide-mistakes       — commonMistakes (있을 때만)
│         └── guide-practices      — bestPractices (있을 때만)
├── fields-section (Column)
│    └── field-N (Column) × N
│         ├── field-N-label (Text, h2)
│         ├── field-N-input (TextField)
│         ├── field-N-guide (Text, caption)       — inputGuide + examples
│         ├── field-N-checkpoints (Text, caption) (NEW: checkPoints 점검 항목)
│         └── field-N-hint (Text, caption)        (NEW: _meta.writingGuide.fieldHints[label])
└── actions (Row)
     ├── analyze-btn               (NEW: analyze_work_context)
     ├── controls-btn              (NEW: suggest_controls_for_hazard)
     ├── help-btn                  (NEW: request_field_help)
     ├── preview-review-btn        (NEW: preview_review)
     ├── preview-btn               (existing: assemble_doc_context)
     └── submit-btn                (existing: submit_safety_document)
```

## File Structure

```
agent-safety-oss/
├── decisions/
│   └── 002-active-graph-authoring-loop.md       ← 작성 완료
├── .specs/in-progress/
│   └── 2026-05-21-active-graph-authoring-loop.md ← 본 파일
├── src/tools/
│   ├── render-a2ui-form.ts                       ← 강화 (info-card + guide-card + 4 액션)
│   ├── analyze-work-context.ts                   ← 신규
│   ├── suggest-controls-for-hazard.ts            ← 신규
│   ├── request-field-help.ts                     ← 신규
│   └── preview-review.ts                         ← 신규
└── src/
    └── tool-registry.ts                          ← 4 도구 import + TOOLS 배열 추가
```

## Tasks

본 spec 의 작업 단위는 TaskList #1 ~ #6 과 1:1 매핑:

- [x] T1 — decision 002 작성
- [x] T2 — .specs/in-progress 작성 (본 파일)
- [ ] T3 — render-a2ui-form.ts 강화
- [ ] T4 — 신규 도구 4종 작성
- [ ] T5 — tool-registry.ts 등록
- [ ] T6 — typecheck + build + smoke 통과

P2~P5 (데이터 보강) 는 별도 spec 으로 분리 (Phase 1B).
P1C (viewer/ 격상) 은 decision 001 spec 으로 진행 (병행).

## References

- decisions/002-active-graph-authoring-loop.md
- decisions/001-a2ui-viewer-promotion.md (viewer 격상 — 본 spec 의 클라이언트 측 완성)
- 사용자 메시지 2026-05-21: 본질 우선순위 정의
- src/tools/render-a2ui-form.ts (강화 대상)
- src/tools/assemble-doc-context.ts (inline 자원)
- src/tools/analyze-construction-work-risks.ts (LLM 체이닝 대상)
- src/tools/get-measures-by-risk.ts (LLM 체이닝 대상)
- src/tools/get-kosha-archive-files.ts (LLM 체이닝 대상)
- src/tools/query-legal-basis.ts (LLM 체이닝 대상)
- src/tools/get-safety-document-guide.ts (writingGuide 참조 패턴)
- src/tools/review-safety-document.ts (preview_review 위임 대상)
- src/ontology/graph/nodes/documents/daily-tbm.jsonld (_meta.writingGuide 예시)
- `~/.claude/rules/specs.md` (T7 .specs/ phase gate)
