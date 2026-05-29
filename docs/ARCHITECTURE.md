# 아키텍처

`agent-safety-oss` 는 가벼운 한국 건설안전 온톨로지 그래프를 LLM 에이전트에 노출하는 stdio MCP 서버입니다.

이 아키텍처는 대규모 엔터프라이즈 플랫폼이 아니라 안전관리자·현장관리자를 위해 최적화되어 있습니다. 로컬 런타임은 작고, 들여다보기 쉬우며, 기존 MCP 클라이언트로 바로 쓸 수 있어야 합니다.

## 온톨로지 체계 안에서의 위치

이 저장소는 건설안전 온톨로지 그래프 자체의 최상위 정의가 아니라, 더 넓은 한국 건설 온톨로지 체계 안에서 **안전 도메인**을 구현한 오픈소스 참조 구현입니다.

```text
상위: 재사용 가능한 건설 공통 온톨로지 (도메인 무관 공통 식별자·계약)
  └─ 본 저장소: 안전 도메인 (agent-safety-oss)
       └─ 하위: 이 온톨로지를 사용하는 제품 런타임
```

구성 원칙:

- 상위 계층은 공통 계약과 재사용 가능한 건설 식별자를 정의합니다.
- 본 저장소는 안전에 특화된 그래프 노드, MCP 도구, 문서 워크플로우, 근거, 현장 액션을 구현합니다.
- 안전에 특화된 법령·문서·위험요인·대책·검토 규칙은 안전 도메인 안에 머무릅니다.
- 재사용 가능한 구현 패턴은 안전 도메인 지식을 걷어낸 뒤에야 상위 계층으로 승격할 수 있습니다.

## 런타임 경로

```text
MCP 클라이언트
  Claude Desktop / OpenAI Codex CLI / MCP Inspector
        |
        | stdio JSON-RPC
        v
src/cli.ts
  명령: serve / tools / call
        |
        v
src/index.ts
  McpServer 등록
        |
        v
src/tool-registry.ts
  <!-- INV:TOOLS_TOTAL -->92<!-- /INV:TOOLS_TOTAL --> 개 ToolDefinition
        |
        +--> src/tools/**
        |      검색, 가이드, 문서 생성, 검토, 현장 프로필,
        |      사진 근거, 안전 이슈, 시정 조치, 보고
        |
        +--> src/resources/**
        |      그래프 컨텍스트, 스켈레톤, 운영 프로필 리소스
        |
        +--> src/lib/**
               그래프 로더, 로컬 저장소, 검증기, KOSHA API 클라이언트
```

## 계층 모델

### 의미 층 (Semantic Layer)

무엇이 존재하고 어떻게 연결되는지를 정의합니다.

- 객체 타입 (운영 그래프, `src/ontology/operational/profile.jsonld` 기준 — **13개**): Site, Project, Contractor, WorkerRole, Equipment, WorkActivity, Hazard, Control, LegalDuty, SafetyDocument, Evidence, Incident, LegalArticle
- 관계 타입 (운영 그래프 — **8개**): hasHazard, mitigatedBy, legalBasis, guidedBy, relatedDocs, annexReference, evidences, resolves

> 의미 모델 (`docs/IDENTITY.md` §6/§7) 은 13객체 + SafetyReport (14번째 별개) + 14관계로 표현되며, 운영 그래프의 LegalDuty/Incident 가 의미 모델의 SafetyIssue/CorrectiveAction/SafetyReport 로 매핑된다. 두 추상화 (운영 그래프의 운영 정의 vs IDENTITY 의 의미 모델) 는 별개의 SSoT 다.
- 파일:
  - `src/ontology/graph/context.jsonld`
  - `src/ontology/graph/nodes/**`
  - `src/ontology/skeleton/skeleton.jsonld`
  - `src/ontology/operational/profile.jsonld`

### 실행 층 (Kinetic Layer)

그래프 객체를 실제 수행 가능한 작업으로 바꿉니다.

대표 액션:

- `assess_my_obligations`
- `assemble_doc_context`
- `generate_safety_document`
- `review_safety_document`
- `verify_safety_basis`
- `get_measures_by_risk`
- `field_safety_briefing`
- `upload_photo_evidence`
- `register_safety_issue`
- `record_corrective_action`
- `complete_action`
- `generate_safety_report`

각 액션은 출처(lineage)를 보존해야 합니다. 법령, 가이드, 그래프 노드, 근거, 로컬 저장소 참조를 가능한 한 구조화된 콘텐츠로 함께 반환합니다.

### 동적 층 (Dynamic Layer)

LLM 과 하네스가 자연어를 해석하고 도구 호출을 구성합니다.

LLM 이 할 수 있는 것:

- 누락된 필수 항목을 되묻기.
- 다음에 호출할 MCP 도구 선택.
- 안전관리자·현장관리자를 위해 그래프 결과 요약.
- 반환된 사실을 바탕으로 문안 초안 작성.

LLM 이 해서는 안 되는 것:

- 법적 근거를 지어내기.
- 누락된 필수 항목을 완료로 표시하기.
- 사람의 승인·서명·법적 책임을 대신하기.

## 데이터 저장소

### 저장소 내장 정적 그래프

```text
src/ontology/legal-duty-master.json       <!-- INV:DOCID_MASTER -->94<!-- /INV:DOCID_MASTER --> 개 법정 의무 docId
src/ontology/forms/forms-map.json         <!-- INV:FORMS_TOTAL -->132<!-- /INV:FORMS_TOTAL --> 개 formId
src/ontology/forms/auto/*.md              <!-- INV:FORMS_MD -->94<!-- /INV:FORMS_MD --> 개 생성된 마크다운 양식
src/ontology/guides/*.json                <!-- INV:DOCUMENTS_TOTAL -->19<!-- /INV:DOCUMENTS_TOTAL --> 개 전체 가이드
src/ontology/safety-laws/*.md             <!-- INV:LAW_BUNDLE_COUNT -->8<!-- /INV:LAW_BUNDLE_COUNT --> 개 내장 법령 MD (산안법·시행령·시행규칙·기준규칙·중처법·중처법 시행령·위험성평가 고시·건진법 §62 영역)
src/ontology/graph/nodes/**               그래프 노드와 엣지
src/ontology/operational/profile.jsonld   운영 프로필
```

### 로컬 사용자 저장소

```text
~/.agent-safety-oss/
  profile.jsonld
  drafts/
  documents/
  photos/
  issues/
  actions/
  reports/
  traces/
```

로컬 디렉토리는 `0o700`, 파일은 `0o600` 권한으로 생성됩니다.

## 도구 그룹

| 그룹 | 목적 |
|---|---|
| 검색·조회 | KOSHA 자료실, KOSHA Guide, MSDS, 안전 자료, 보호구 인증, 로컬 법령 검색 |
| 의무 생애주기 | 적용 대상 판정, 임박 의무, 제출, 보존, 사고 워크플로우 |
| 문서 워크플로우 | 가이드, 그래프 컨텍스트, 생성, 내보내기, 검토, 환각 검사 |
| 현장 사이클 | 사진 근거, 안전 이슈, 시정 조치, 안전 보고 |
| 프로필 | 현장·프로젝트·인원·장비·협력업체 등록 |
| 양식·UI | 공식 양식, 초안 저장/불러오기/보관, A2UI 폼 렌더링 |

## 그래프 노드 카테고리 (명명 정합)

P1-5 — `safety://graph/{category}` 의 카테고리 의미를 명확히:

| 카테고리 | 노드 수 | 역할 | IRI 패턴 |
|---|---|---|---|
| `documents` | 1,135 (재귀: 1단계 96 + guides/ <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META -->) | <!-- INV:DOCUMENTS_TOTAL -->19<!-- /INV:DOCUMENTS_TOTAL -->종 법정 문서 + KOSHA Guide <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> (`guides/` 하위) | `doc:annual/...`, `doc:kosha_guide/{code}` |
| `documents/guides/` | <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> | **KOSHA Guide canonical 노드 위치** (메타. 본문 <!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY -->) | `doc:kosha_guide/{code}` |
| `kosha_guides` | 2 | 레거시 원천 메타 1건 + Manual 절 1건 (v1.3.x 에서 documents/guides·manuals 로 이동 예정) | `doc:kosha_guide/Z-26-2022`, `kosha:P-94:4.2.1.4` |
| `articles` | 1,306 | 법령 조문 (산안법·기준규칙·중처법·건진법 등) | `art:{law}:{num}` |
| `annexes` | 227 | 별표·서식 | `annex:{law}:{num}` |
| `manuals` | 8 | KOSHA Guide 절 단위 또는 외부 매뉴얼 | `kosha:{guide}:{section}` |
| `chapters` | 55 | 법령 편/장/절 | `chapter:{law}:{num}장` |

**원칙** (재귀 로딩 + 명명 정합):
- KOSHA Guide <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META -->건 (메타) / <!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY -->건 (본문, 미수집 <!-- INV:KOSHA_FAILURES -->0<!-- /INV:KOSHA_FAILURES -->건 — `_FAILURES.json`) 의 canonical 위치는 `documents/guides/`
- `kosha_guides/` 폴더는 잔존 2건만 (v1.3.x 정리 예정)
- 리소스 `safety://graph/documents` 가 1,135 전체 (guides <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> 포함) 노출
- 리소스 `safety://graph/kosha_guides` 는 잔존 2건만 (오해 방지 안내 필요)

## 근거 모델 (Evidence Model)

```ts
basisType = law | regulation | kosha_guide | accident_case | safety_material | msds | statistics | ppe_certification
legalWeight = mandatory | recommended | reference
```

표준 매핑:

| 근거 타입 | 법적 효력 |
|---|---|
| law, regulation | mandatory (의무) |
| kosha_guide | recommended (권고) |
| accident_case, safety_material, msds, statistics, ppe_certification | reference (참고) |

`verify_safety_basis` 는 "의무", "반드시", "금지", "위반" 같은 단어를 유효한 법적 근거 없이 사용한 주장에 대해, 근거 없는 mandatory 주장을 환각 마커로 차단합니다.

## 검증 게이트

```bash
npm run typecheck
npm run build
npm run ontology:operational
npm run mcp:test:graph
npm run audit:strict
npx tsx scripts/test/field-test-workflows.ts
npx tsx scripts/quality/field-test-quality-eval.ts
```

현재 관측된 게이트 결과:

- 운영 프로필: 38/38 통과
- 그래프 추론: 5/5 통과, 재현율 100%, 정밀도 100%
- 그래프 일관성: ISO 45001 카테고리 일관성 100%
- 엄격 그래프 감사: 통과
- 현장 워크플로우: 4개 시나리오, 29/29 단계
- 현장 품질: 평균 8.65/10

## 확장 규칙

기능을 추가할 때:

1. 먼저 그래프 노드와 엣지를 추가하거나 재사용한다.
2. 그 액션이 안전관리자·현장관리자에게 의미가 있을 때만 도구를 추가한다.
3. IRI 출처(lineage)를 포함한 구조화된 콘텐츠를 반환한다.
4. 검증 스크립트를 추가하거나 갱신한다.
5. 사용자 대면 워크플로우가 바뀌면 README 와 관련 문서를 갱신한다.
