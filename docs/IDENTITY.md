# agent-safety-oss 정체성

> 이 문서는 프로젝트의 제품 정체성 SSoT다. README, 문서, 신규 기능, GitHub 설명은 이 문서를 기준으로 정렬한다.

## 한 문장 정의

agent-safety-oss 는 **건설현장의 법정 안전문서 작성을 더 빠르고 정확하게** 하는 오픈소스 도구다. 산안법·기준규칙·중처법·KOSHA Guide 본문이 도구 안에 내장돼, 안전관리자·현장소장이 매일·매주·매월 작성하는 **19종 법정 안전관리 문서** (TBM·작업계획서·위험성평가·MSDS·산재조사표 등) 의 작성과 검토를 돕는다. **작성 주체는 안전관리자, MCP 는 보조**.

**주요 MCP host**: **Claude Desktop · OpenAI Codex CLI** 두 host 만 메인 지원. 설정은 host 별 안내 (`docs/SETUP_CLAUDE_DESKTOP.md` · `docs/SETUP_CODEX.md`) 참조.

번들 공공데이터:
- **법령 본문 MD <!-- INV:LAW_BUNDLE_COUNT -->10<!-- /INV:LAW_BUNDLE_COUNT -->개** (합계 약 <!-- INV:LAW_ARTICLES -->76<!-- /INV:LAW_ARTICLES -->조): 산안법·시행령·시행규칙·기준규칙·중처법·중처법 시행령·위험성평가 고시·건진법·건진법 시행령·건진법 시행규칙
- **KOSHA Guide <!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY -->건** (본문) + **<!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META -->건** (메타, 2026.1 재정비 후 유효본)
- **부처별 분산 공공데이터 통합**: 법제처·KOSHA·고용노동부·국토부 등 자료를 같은 온톨로지 그래프로 묶어 LLM 이 관계 따라가며 도메인 추론 가능

## 핵심 사용자

| 사용자 | 매일 겪는 문제 | 이 프로젝트가 주는 것 |
|---|---|---|
| 안전관리자 | 법정문서, 법령 근거, KOSHA 자료, 현장 증빙이 흩어져 있음 | cycle별 의무 확인, 그래프 기반 문서 생성, 법령 인용 검수, 이슈/조치/보고 기록 |
| 현장소장 | 안전업무를 겸임하면서 공정, 협력업체, 발주처 대응까지 처리해야 함 | 오늘 작업 기준 위험/대책/TBM/보호구/허가 여부를 자연어로 확인 |
| 신규 담당자 | 이전 담당자의 폴더 구조와 판단 맥락을 알기 어려움 | 로컬 프로파일, 초안, 보관문서, 사진, 이슈, 조치 이력으로 인수인계 |

## 비목표

- 무거운 SaaS를 새로 만드는 것
- 사람의 법적 판단, 서명, 승인 책임을 대체하는 것
- LLM이 법령 근거를 생성하게 하는 것
- 모든 산업을 처음부터 포괄하는 거대 지식그래프
- 문서 자동화만 하고 의미 관계를 버리는 것
- 자동 결재 환상 (시나리오 평가 7/7 PARTIAL+ — 사용자 빈칸 채움 필수)

## 4계층 역할 분리

```text
Semantic Layer  안전관리 객체와 관계
Kinetic Layer   그래프 객체에 대한 실행 가능한 MCP 액션
Dynamic Layer   LLM과 하네스의 상황 해석, 도구 조합, 질문
Human Layer     검토, 수정, 승인, 제출, 책임 판단
```

## 핵심 객체

| 객체 | 의미 | 현재 표현 |
|---|---|---|
| Site / Project | 사업장과 현장 | local profile + graph object type |
| Contractor | 수급업체 | local profile + 도급 문서 |
| WorkerRole / Person | 안전관리자, 현장소장, 관리감독자, 근로자대표 | local profile + 결재선 자동 채움 |
| Equipment | 장비와 기계 | local profile + 작업계획서/점검표 연결 |
| WorkActivity | 실제 작업 | <!-- INV:GRAPH_ACTIVITIES -->41<!-- /INV:GRAPH_ACTIVITIES -->개 activity node |
| Hazard | 위험요인 | <!-- INV:GRAPH_HAZARDS -->38<!-- /INV:GRAPH_HAZARDS -->개 hazard node |
| Control | 통제대책과 보호구 | <!-- INV:GRAPH_CONTROLS -->50<!-- /INV:GRAPH_CONTROLS -->개 control node, ERIC-PP 위계 |
| LegalArticle | 법령 조문 | 1,306개 article node (산안법 영역 거의 전수 + 건진법 §62 안전관리 영역 4건) |
| SafetyDocument | 법정의무 문서 | <!-- INV:DOCID_MASTER -->94<!-- /INV:DOCID_MASTER --> docId master + document graph node (KOSHA Guide <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> 포함) |
| Evidence | 사진, 문서, 제출 증빙 | PhotoEvidence부터 시작 |
| SafetyIssue | 현장 이슈 | local storage + graph chain |
| CorrectiveAction | 개선조치 | local storage + resolves chain |
| SafetyReport | 운영 보고서 | 법정문서와 분리된 이슈/조치 합본 |

## 핵심 관계

```text
WorkActivity -> hasHazard -> Hazard
Hazard -> mitigatedBy -> Control
SafetyDocument -> legalBasis -> LegalArticle
SafetyDocument -> guidedBy -> KOSHA Guide
SafetyDocument -> relatedDocs -> SafetyDocument
PhotoEvidence -> evidences -> SafetyIssue
SafetyIssue -> requiresAction -> CorrectiveAction
CorrectiveAction -> resolves -> SafetyIssue
SafetyReport -> includes -> SafetyIssue
```

## 운영 검증 기준

본질 질문:

> 중소 건설사 안전관리자와 현장소장이 매일 사용할 수 있는가?

검증 항목:

1. 현장 프로파일을 한 번 등록하면 문서 메타와 결재선이 자동 채워진다.
2. 8개 cycle 기준으로 의무 문서를 찾을 수 있다.
3. `WorkActivity -> Hazard -> Control` 사슬이 문서 작성에 실제 반영된다.
4. 법령 근거는 그래프와 번들 본문에서만 나온다.
5. 필수 입력이 없으면 결재 불가 또는 보강 필요로 표시한다.
6. 사진, 이슈, 조치, 보고서가 로컬 저장소에 남는다.
7. 담당자가 바뀌어도 기록과 그래프 사슬로 인수인계할 수 있다.

## 현재 충분한 것

- <!-- INV:TOOLS_TOTAL -->92<!-- /INV:TOOLS_TOTAL -->개 MCP 도구가 검색, 조회, 문서, 검수, 현장 사이클, 로컬 저장을 포괄한다.
- <!-- INV:DOCID_MASTER -->94<!-- /INV:DOCID_MASTER --> docId 법정의무 마스터와 <!-- INV:FORMS_TOTAL -->132<!-- /INV:FORMS_TOTAL --> formId 양식 인덱스가 정합된다.
- 운영 그래프는 <!-- INV:GRAPH_TOTAL -->3,369<!-- /INV:GRAPH_TOTAL --> 노드 (재귀, KOSHA Guide <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> 포함) 와 약 <!-- INV:GRAPH_EDGES -->32,963<!-- /INV:GRAPH_EDGES --> 엣지로 중소 건설사 사용 범위에는 충분하다.
- `ontology:operational`, `mcp:test:graph`, `audit:strict`가 통과한다.
- 4개 필드 시나리오에서 29/29 단계가 통과한다.

## 현재 부족한 것

- Site/Project/Contractor/WorkerRole은 런타임 프로파일 중심이며 정적 graph node 물질화는 아직 제한적이다.
- 법정 제출 증거 타입은 PhotoEvidence 이후 서명, 교육 참석, 제출 영수증, 조치 전후 증거로 더 세분화해야 한다.
- Dynamic Layer 정책은 profile로 선언되어 있지만 모든 외부 하네스에서 자동 강제되는 수준은 아니다.
- 일부 문서, 특히 `safety_health_manager_appointment`와 `regular_risk_assessment`는 그래프/작성가이드 품질 보강 여지가 있다.

## 변경 이력

| 일자 | 변경 |
|---|---|
| 2026-05-04 | README와 핵심 문서를 안전관리자/현장소장 실사용자 관점으로 재정렬 |
| 2026-05-03 | 13 객체, 14 관계, 7 핵심 Tool 정체성 초안 정리 |
