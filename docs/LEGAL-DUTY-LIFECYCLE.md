# Legal Duty Lifecycle

> 목적: 안전관리자와 현장소장이 법정의무 문서를 인식, 작성, 검수, 결재, 제출, 보관하는 흐름을 하나의 운영 모델로 정리한다.

## 핵심 의도

한 사업장의 안전관리자가 94종 법정의무문서를 빠짐없이, 정확하게, 제때, 보관 의무까지 처리하도록 돕는다.

```text
인식 -> 작성 -> 검수 -> 결재 -> 제출 -> 보관
                                      |
                                      v
                                  다음 주기
```

## 6단계

### 1. 인식

질문:

```text
우리 현장에 어떤 안전보건 의무가 적용되는가?
```

대표 도구:

- `register_site`
- `register_project`
- `register_person`
- `assess_my_obligations`
- `list_safety_documents_by_cycle`
- `list_upcoming_duties`
- `query_applicability`

### 2. 작성

질문:

```text
이 문서는 어떤 항목을 어떻게 채워야 하는가?
```

대표 도구:

- `get_safety_document_guide`
- `assemble_doc_context`
- `get_official_form`
- `list_downloadable_forms`
- `generate_safety_document`
- `export_drafted_document`

### 3. 검수

질문:

```text
법령 근거가 맞고 필수 항목이 빠지지 않았는가?
```

대표 도구:

- `review_safety_document`
- `verify_safety_basis`
- `query_legal_basis`
- `query_penalty`

### 4. 결재

질문:

```text
누가 확인하고 누가 승인해야 하는가?
```

현재 방식:

- `register_person`으로 안전관리자, 관리감독자, 현장소장, 사업주, 근로자대표를 등록한다.
- `generate_safety_document`가 프로파일과 `approvalChain`을 사용해 결재선을 채운다.
- 필수 항목이 비어 있으면 결재 불가로 표시한다.

### 5. 제출

질문:

```text
어디에, 언제까지, 어떤 방식으로 제출해야 하는가?
```

대표 도구:

- `get_submission_info`
- `get_incident_response_workflow`
- `get_construction_stage_duties`

### 6. 보관

질문:

```text
얼마나 보관하고 다음 작성일은 언제인가?
```

대표 도구:

- `archive_safety_document`
- `list_archived_documents`
- `get_retention_status`
- `list_upcoming_duties`

## 현장 운영 사이클

법정문서 외에 매일 남겨야 하는 운영 기록은 별도 사슬로 관리한다.

```text
PhotoEvidence -> SafetyIssue -> CorrectiveAction -> SafetyReport
```

대표 도구:

- `upload_photo_evidence`
- `register_safety_issue`
- `list_open_issues`
- `record_corrective_action`
- `complete_action`
- `generate_safety_report`

## 안전관리자 관점

| 단계 | 실무 가치 |
|---|---|
| 인식 | 놓친 문서와 마감일을 줄인다. |
| 작성 | 법령, 위험, 통제대책을 같은 문서에 넣는다. |
| 검수 | LLM 환각과 필수 항목 누락을 잡는다. |
| 결재 | 사업장 프로파일로 결재선 반복 입력을 줄인다. |
| 제출 | 사고/선임/측정 등 제출 의무를 분리한다. |
| 보관 | 보관기간과 다음 작성 주기를 추적한다. |

## 현장소장 관점

| 단계 | 실무 가치 |
|---|---|
| 인식 | 오늘 작업에 필요한 문서와 조치를 빠르게 본다. |
| 작성 | TBM, 작업계획서, 작업허가서 초안을 받는다. |
| 검수 | 감독관에게 낼 수 없는 초안을 사전에 걸러낸다. |
| 결재 | 누가 확인해야 하는지 명확히 본다. |
| 제출 | 사고 발생 시 시간순 보고를 확인한다. |
| 보관 | 담당자가 바뀌어도 기록을 찾을 수 있다. |

## 현재 충분한 것

- 94 docId 마스터와 132 formId 양식 인덱스.
- 8 cycle 기반 문서 목록.
- 작성, 검수, 제출, 보관을 담당하는 MCP 도구.
- 현장 프로파일 기반 자동 채움.
- 로컬 초안/보관/사진/이슈/조치/보고 저장.

## 현재 보강할 것

- 제출 증빙, 서명 증빙, 교육 참석 증빙 같은 EvidenceType 확장.
- 일부 문서의 `submitTo`, `submitDeadline`, `nextDueRule` 정밀도 강화.
- 문서별 결재 역할 검증 강화.
- 하네스가 필수 입력 누락 시 질문하도록 강제하는 테스트 확대.

## 관련 SSoT

- `src/ontology/legal-duty-master.json`
- `src/ontology/forms/forms-map.json`
- `src/ontology/guides/*.json`
- `src/ontology/operational/profile.jsonld`
- `docs/OPERATIONAL-ONTOLOGY.md`
