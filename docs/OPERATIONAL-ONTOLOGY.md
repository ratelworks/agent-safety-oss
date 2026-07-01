# Operational Ontology Profile

> release: **v<!-- INV:VERSION -->1.7.0<!-- /INV:VERSION --> · <!-- INV:TOOLS_TOTAL -->92<!-- /INV:TOOLS_TOTAL --> tools · <!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY --> KOSHA Guides**
> 목적: 중소 건설사가 실제 업무에서 사용할 수 있는 경량 운영 온톨로지 그래프

## 1. 목적

이 프로젝트의 온톨로지는 지식 저장소가 아니라 안전관리 업무를 실행하기 위한 운영 그래프다.

AgentHQ 상위 구조에서 이 프로젝트의 위치는 다음이다.

```text
L0 AgentHQ Ontology Constitution
  └─ L1 AgentHQ Core
       └─ L2 construction-common
            └─ L3 safety domain pack
                 └─ L4 agent-safety-oss
                      └─ L5 Agent_* product runtime
```

따라서 이 프로젝트는 Core가 아니라 Safety domain pack의 참조 구현체다. `src/ontology/operational/profile.jsonld`는 안전 도메인의 운영 프로파일이며, 상위 Core 헌법을 대체하지 않는다.

핵심 목표는 다음이다.

- 현장, 공종, 작업, 위험, 통제, 법령, 문서, 증거를 연결한다.
- LLM이 법령 근거를 추측하지 않고 MCP 그래프와 도구 결과만 사용하게 한다.
- 중소 건설사 안전관리자와 현장소장이 TBM, 위험성평가, 작업허가, 사고보고, 점검, 증빙, 개선조치 업무를 처리할 수 있게 한다.
- 특정 모델, 하네스, 그래프 DB, 상용 플랫폼에 종속되지 않는다.

## 2. 3 Layer

### Semantic Layer

무엇이 존재하고 어떻게 연결되는지를 정의한다.

- `ObjectType` (operational profile 실측, **16개**): Site, Project, Contractor, WorkerRole, Equipment, WorkActivity, Hazard, Control, LegalDuty, SafetyDocument, Evidence, Incident, LegalArticle, Annex, SafetyIssue, CorrectiveAction
- `LinkType` (operational graph 실측, **8개**): hasHazard, mitigatedBy, legalBasis, guidedBy, relatedDocs, annexReference, evidences, resolves

의미 모델 (`docs/IDENTITY.md` §6/§7) 은 13객체 + SafetyReport (14번째 별개) + 14관계로 표현되며, operational 의 LegalDuty/Incident 가 의미 모델의 SafetyIssue/CorrectiveAction/SafetyReport 로 매핑된다. 두 추상화 (operational graph 실 정의 vs IDENTITY 의미 모델) 는 별개의 SSoT 다.
- 표준 기반: JSON-LD 1.1, RDF/OWL, SKOS, PROV-O, Dublin Core, schema.org

현재 SSoT 파일:

- `src/ontology/graph/context.jsonld`
- `src/ontology/graph/nodes/**`
- `src/ontology/skeleton/skeleton.jsonld`
- `src/ontology/operational/profile.jsonld`

### Kinetic Layer

그래프 객체에 대해 실행 가능한 업무 액션을 정의한다.

기본 ActionType:

- `assess_my_obligations`
- `assemble_doc_context`
- `generate_safety_document`
- `review_safety_document`
- `get_measures_by_risk`
- `field_safety_briefing`
- `verify_safety_basis`
- `upload_photo_evidence`
- `register_safety_issue`
- `record_corrective_action`
- `complete_action`

각 ActionType은 다음 조건을 가져야 한다.

- 실제 MCP tool에 연결된다.
- 읽는 객체 타입과 산출 객체 타입이 명시된다.
- 법령·가이드·증거 lineage를 보존한다.
- 필수 입력 누락 시 LLM이 임의로 채우지 않는다.

### Dynamic Layer

LLM과 하네스가 담당하는 층이다.

LLM은 다음을 수행한다.

- 자연어 요청을 해석한다.
- 적절한 MCP tool을 조합한다.
- 결과를 설명한다.
- 누락 정보를 질문한다.
- human fallback이 필요한 상황을 드러낸다.

LLM은 다음을 하지 않는다.

- 법령 근거를 생성하지 않는다.
- 그래프에 없는 의무를 사실처럼 말하지 않는다.
- 필수 증거를 추측으로 통과시키지 않는다.
- 사람의 법적 서명이나 고위험 승인 책임을 대체하지 않는다.

## 3. 운영 프로파일

운영 프로파일은 다음 파일에 있다.

```text
src/ontology/operational/profile.jsonld
```

이 파일은 기존 그래프를 축소하지 않는다. 대신 전체 그래프 위에 중소 건설사 업무에 필요한 운영 관점을 얹는다.

```text
Full Graph
  법령, 조문, 문서, KOSHA Guide, 위험, 통제, 이벤트 전체 지식

Operational Profile
  중소 건설사 업무에서 즉시 필요한 객체, 관계, 액션, 하네스 정책

MCP Runtime
  tool/resource 호출로 실제 업무 실행
```

## 4. 검증

운영 준비도 검증:

```bash
npm run ontology:operational
```

검증 항목:

- profile JSON-LD expand
- full graph node availability
- ObjectType별 graph category coverage
- LinkType별 edge count coverage
- ActionType별 MCP tool 연결
- Skeleton Action contract 19개 이상
- Dynamic HarnessPolicy 4개
- EvidenceType 3개 이상

보고서:

```text
artifacts/test-results/core/operational-ontology-report.json
```

주의: 이 검증은 운영 활용성 gate다. 전체 RDF 공개 품질은 별도 gate로 확인한다.

```bash
npm run audit:expand
npm run audit:graph-v2
npm run audit:strict
```

검증 결과 (2026-07-02):

- Operational ontology: 41/41 통과
- Full graph: <!-- INV:GRAPH_TOTAL -->3,369<!-- /INV:GRAPH_TOTAL --> nodes (재귀, KOSHA Guide <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> 포함). 카테고리 1단계만 = <!-- INV:GRAPH_TOPLEVEL -->2,212<!-- /INV:GRAPH_TOPLEVEL --> (Article 1,306 + Document 96 + Annex 227 + Acts 8 + ...).
- Graph edges: 약 <!-- INV:GRAPH_EDGES -->32,963<!-- /INV:GRAPH_EDGES --> (주요 EDGE_FIELDS: mitigatedBy / causedBy / hasArticle / guidedBy / partOf …)
- Semantic object type: 16/16 통과
- Semantic link type: 6/6 통과
- Kinetic action type: 12/12 통과
- Dynamic harness contract: 5/5 통과
- `mcp:test:graph`: reasoning, consistency, effect 모두 통과
- `audit:strict`: 임계값 모두 통과

## 5. 현재 충분한 것

- 그래프 규모: 수천 개 노드와 수만 개 엣지로 중소 건설사 사용에는 충분하다.
- 핵심 사슬: `WorkActivity -> Hazard -> Control`, `SafetyDocument -> LegalArticle`, `Document -> KOSHA Guide` 흐름이 있다.
- Kinetic 기반: 문서 조립, 문서 생성, 문서 검토, 의무 판정, 위험-통제 조회, 사진 증빙, 안전 이슈, 개선조치 도구가 있다.
- 결정론 의무 판정: Applicability 노드 22개 (JSON Logic 조건 + 법령 근거 IRI + legalWeight) 가 사업장 규모·업종 기반 의무 적용 판정을 그래프에서 결정론적으로 내린다 (`query_applicability` · `assess_my_obligations`).
- Resource 기반: MCP Resource로 skeleton, graph category, graph context, operational profile을 노출한다.

## 6. 현재 부족한 것

- 전체 JSON-LD publish gate는 아직 별도 보강이 필요하다.
- Site/Project/Contractor/WorkerRole은 runtime profile 중심이고, graph node로는 아직 충분히 물질화되지 않았다.
- Evidence는 PhotoEvidence와 local storage tool 중심으로 시작됐고, 법정 제출 증거 타입은 더 세분화해야 한다.
- Dynamic Layer 정책은 profile로 선언됐지만, 모든 하네스에서 자동 강제되는 수준은 아니다.

## 7. 다음 구축 순서

1. `npm run ontology:operational`을 기본 운영 gate로 유지한다 (dangling IRI·context term 은 `audit:expand`·`audit:graph-v2` 게이트가 0건으로 유지 중).
2. Site, Project, Contractor, WorkerRole을 graph node category로 승격할지 결정한다.
3. EvidenceType을 사진, 서명, 교육 참석, 점검 결과, 제출 영수증, 조치 전후 증거로 확장한다.
4. 각 ActionType의 `precondition`, `requiredEvidence`, `humanFallback`을 SHACL 또는 JSON Logic으로 고정한다 (의무 적용 판정은 Applicability 노드로 이미 결정론화 — 액션 전제조건은 미착수).
5. 하네스별 테스트에서 LLM이 법령 근거를 생성하지 않는지 검증한다.
