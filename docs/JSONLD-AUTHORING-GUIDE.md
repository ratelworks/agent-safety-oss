# JSON-LD 노드 작성 가이드라인

> agent-safety-oss 그래프(`src/ontology/graph/nodes/`)의 모든 노드는 이 가이드를 따른다. 위반은 PR 차단. 자동 검증: `scripts/verify/verify-graph-integrity.ts` + `scripts/audit/audit-legal-duty-coverage.ts` + (P0/A5 이후) SHACL Shape.

---

## 1. 핵심 원칙

1. **표준 우선**: schema.org > W3C 표준(dc/prov/skos/owl/rdfs/sh/foaf/time) > ISO 45001 > 도메인 vocab(safety:)
2. **자유 키 금지**: context.jsonld에 없는 키는 노드에 추가하지 않는다. 새 키가 필요하면 먼저 context에 정의.
3. **출처는 반드시 추적**: 모든 노드는 `dc:created` + `wasGeneratedBy` 또는 `_meta.publishedBy` 둘 중 하나를 갖는다.
4. **IRI는 prefix로**: 절대 IRI(`https://...`) 직접 사용 금지. 항상 `prefix:slug` 형태.

---

## 2. 모든 노드 공통 필수 필드

```jsonc
{
  "@context": "../../context.jsonld",   // 상대 경로 고정 (depth 보정 시만 변경)
  "@id": "doc:safety_health_management_policy",   // prefix:slug 필수
  "@type": ["Document", "DigitalDocument"],       // 배열 권장 (다중 클래스)
  "verificationStatus": "verified",     // verified | pending | auto-aligned
  "dataQualityTier": "verified",        // verified | curated | auto-aligned (P1 이후 필수)
  "_meta": {
    "publishedBy": "법제처 국가법령정보센터",
    "sourceUrl": "https://www.law.go.kr/...",
    "fetchedAt": "2026-04-28",
    "licenseHint": "저작권법 제7조 비보호 (자유 인용)"
  }
}
```

### `@id` IRI 패턴 (context.jsonld 등록 prefix만 사용)

| 노드 타입 | prefix | 예시 |
|---|---|---|
| Act (법률) | `act:` | `act:산안법` |
| Article | `art:` | `art:산안법:14` |
| Annex (별표·별지) | `annex:` | `annex:기준규칙:별표7` |
| Document (법정문서) | `doc:` | `doc:safety_health_management_policy` |
| Hazard | `hazard:` | `hazard:acute_toxic_gas` |
| Control | `control:` | `control:ppe_respirator` |
| Activity | `activity:` | `activity:excavation_2m_plus` |
| Cycle | `cyc:` | `cyc:monthly` |
| Method (KRAS 등) | `method:` | `method:5x4_matrix` |
| Manual / Statistic / Source / Entity | `manual:`, `stat:`, `src:`, `entity:` | |

---

## 3. 노드 타입별 표준 패턴

### 3.1 Document (법정의무문서)

```jsonc
{
  "@context": "../../context.jsonld",
  "@id": "doc:risk_assessment_regular",
  "@type": ["Document", "DigitalDocument"],
  "docId": "risk_assessment_regular",
  "title": "정기 위험성평가",
  "alternativeNames": ["정기평가"],
  "description": "...",
  "cycle": "cyc:annual",
  "trigger": "...",
  "applicableWhen": { "appliesTo": "applic:all_workplace", "scaleNotes": "..." },
  "exemptedWhen": { "reasons": ["..."] },
  "legalBasis": ["art:산안법:36", "art:고시:위험성평가:15"],
  "requiredFields": [
    { "key": "f_1_사업장명", "label": "사업장명", "source": "위험성평가 고시 제15조", "inputGuide": "...", "examples": ["..."] }
  ],
  "retention": "5년",
  "penaltyOnMissing": "penalty:산안법:175",
  "relatedDocs": ["doc:risk_assessment_initial", "doc:risk_assessment_ad_hoc"],
  "iso45001Class": "iso45001:Risk",
  "_meta": { "publishedBy": "...", "fetchedAt": "..." }
}
```

### 3.2 Article (법령 조문)

`@type` = `["Article", "Legislation"]` — schema:Legislation 표준 채택 필수.

필수 schema 필드: `legislationIdentifier`, `legislationDate` (xsd:date), `legislationType` (Act/Decree/Rule/Notice), `legislationLegalForce` (InForce/Repealed), `jurisdiction` ("KR"), `temporalCoverage` (`2025-10-01/..`).

### 3.3 Hazard

```jsonc
{
  "@id": "hazard:fall",
  "@type": "Hazard",
  "label": "추락",
  "category": "physical",   // physical | chemical | biological | ergonomic | psychological
  "iso45001Class": "iso45001:Hazard",
  "mitigatedBy": ["control:fall_arrest_system", "control:scaffold"],
  "koshaArchiveFacets": ["facet:ctgr04/16"]
}
```

### 3.4 Control

```jsonc
{
  "@id": "control:ppe_respirator",
  "@type": "Control",
  "label": "송기마스크",
  "controlLevel": "PPE",        // Elimination | Substitution | Engineering | Administrative | PPE
  "ericLevel": "PPE",
  "iso45001Class": "iso45001:Control"
}
```

### 3.5 Cycle / Method / Manual / Statistic

각 타입의 `@type`을 정확히 사용. 본문(`description`) + `_meta` 필수. 그 외 필드는 도메인 의미에 맞게.

---

## 4. 출처 추적 (W3C 표준)

### Dublin Core (dc:)
```jsonc
"creator": "entity:ratelworks",        // dc:creator (@id)
"created": "2026-04-28",                // dc:created (xsd:date)
"modified": "2026-04-29",               // dc:modified (xsd:date)
"dcLicense": "MIT",                     // dc:license
"rights": "공공누리 제1유형",            // dc:rights
"language": "ko"                        // dc:language
```

### PROV-O (prov:)
```jsonc
"wasGeneratedBy": "src:scaffold_missing_nodes_v0.4",   // prov:wasGeneratedBy
"wasDerivedFrom": ["art:산안법:14", "manual:moel_safety_handbook_2024"],  // @set
"wasAttributedTo": "entity:ratelworks",
"generatedAtTime": "2026-04-28T12:00:00Z"
```

### `_meta` (도메인 호환 필드, dc/prov 보완)

`_meta`는 자동 sync 메타 보관용. 신규 노드는 가능한 dc/prov 사용. 자동 수집 메타(lawServiceMST 등)만 `_meta`.

---

## 5. ISO 45001 매핑

9개 핵심 클래스 매핑 (P0/A3 이후 필수):

| ISO 45001 | 우리 클래스 | 매핑 키 |
|---|---|---|
| iso45001:Hazard | safety:Hazard | `iso45001Class: "iso45001:Hazard"` |
| iso45001:Risk | safety:RiskAssessment / Document(risk_*) | `iso45001Class: "iso45001:Risk"` |
| iso45001:Control | safety:Control | `iso45001Class: "iso45001:Control"` |
| iso45001:Permit | Document(work_permit_*) | `iso45001Class: "iso45001:Permit"` |
| iso45001:Incident | Document(accident_*) | `iso45001Class: "iso45001:Incident"` |
| iso45001:Audit | Document(audit_*, inspection_*) | `iso45001Class: "iso45001:Audit"` |
| iso45001:Worker | safety:Person (역할별) | `iso45001Class: "iso45001:Worker"` |
| iso45001:Workplace | safety:Site / safety:Project | `iso45001Class: "iso45001:Workplace"` |
| iso45001:Competence | Document(training_*, education_*) | `iso45001Class: "iso45001:Competence"` |

A3 단계에서 `owl:equivalentClass` 매핑은 별도 `src/ontology/graph/iso45001-mapping.jsonld`로 분리.

---

## 6. dataQualityTier

| 값 | 의미 | 적용 |
|---|---|---|
| `verified` | 1차 출처(법제처/KOSHA/고용노동부)에서 직접 가져왔고 사람이 검수 | 법령 조문, 별표·별지, 공식 양식 |
| `curated` | 2차 가공(요약·재배열)했지만 사람이 검수 | Document 메타, Hazard 정의 |
| `auto-aligned` | 자동 스크립트로 생성됐고 LLM 출력 가능성 | 일괄 정합 결과 |

→ 신규 노드는 반드시 셋 중 하나. 누락은 SHACL 검증 시 차단(A5 이후).

---

## 7. Don'ts

- ❌ 절대 IRI 직접 사용 (`"https://safety.ratelworks.org/document/x"` 금지) → `"doc:x"`
- ❌ context에 없는 키 추가 (자유 키 금지). 새 키는 먼저 context.jsonld 등록.
- ❌ `@type`을 빠뜨리거나 문자열 카테고리(`"문서"`)로 사용. 항상 등록된 클래스 IRI.
- ❌ `_meta` 안에만 출처 두기. dc/prov 표준이 우선이고 `_meta`는 자동 sync 메타로 한정.
- ❌ `relatedDocs` / `references` / `legalBasis`에 dangling IRI. 참조 대상 노드가 그래프에 존재해야 한다.
- ❌ 한국어 키와 영어 키 혼용 (`"제목": "..."`은 금지, 항상 `"title"`).

---

## 8. 검증 (작성 후 필수)

```bash
npm run build                                       # tsc + 자산 복사
npx tsx scripts/verify/verify-graph-integrity.ts           # dangling 0 / IRI 형식
npx tsx scripts/audit/audit-legal-duty-coverage.ts        # 마스터 ↔ 노드 ↔ 양식 정합
# A5 이후
npx tsx scripts/verify/validate-shacl.ts                   # SHACL Shape 무결성
```

세 가지 모두 통과해야 머지 가능.

---

## 9. 관련 문서

- `src/ontology/graph/context.jsonld` — vocabulary SSoT
- `src/ontology/legal-duty-master.json` — <!-- INV:DOCID_MASTER -->94<!-- /INV:DOCID_MASTER -->종 법정의무 SSoT
- `docs/LEGAL-DUTY-LIFECYCLE.md` — 6단계 라이프사이클 (인식·작성·검수·결재·제출·보관)
- `dev.md` 제2조 5축 모델 — 새 도구 분류
- `dev.md` 제4조 법령 인용 규칙 — 정확한 §·항·호 인용
