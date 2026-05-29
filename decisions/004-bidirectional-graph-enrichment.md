---
id: 004
status: accepted
date: 2026-05-24
deciders: 황룡, Claude
tags: [ontology, kosha-guide, graph-traversal, semantic-integration]
---

# 004. 양방향 그래프 통합 — 가이드 본문 → 법령 인용 자동 추출 + 역방향 매핑 + 도구 강화

## Context

기존 KOSHA Guide 그래프화는 "수량적 완료" (메타 1,039 + 본문 1,039) 와 "의미적 통합" 사이에 큰 격차가 있었다.

측정 결과 (v1.4.2 시점):

| 차원 | 상태 |
|---|---|
| 가이드 메타 + 본문 | 1,039 / 1,039 (100%) |
| WorkActivity → 가이드 | 41 / 41 (100%) |
| Hazard → 가이드 | 38 / 38 (100%) |
| **법정문서 → 가이드** | **51 / 96 (53%)** |
| **법령 조문 → 가이드 (역방향)** | **0 / 1,306 (0%)** |
| 가이드 본문에 인용된 법령 | 약 757건 가이드가 평균 2.1건 인용 (그래프 edge 미기록) |

사용자 본질 기획 — "기존 트리 구조 전문 자료를 온톨로지 그래프화 → LLM 이 도메인 전문성 이해하기 쉬운 구조" — 와 큰 격차. 안전관리자가 자연어로 "굴착 작업 TBM" 요청 시 LLM 이 그래프 traversal 로 적용 KOSHA Guide 를 자동 발견하지 못하는 상태.

## Decision

**3-단계 양방향 그래프 통합** + **도구 코드 강화** 로 의미 통합 격차 해소.

### Stage 1 — 가이드 본문 → 법령 인용 자동 추출 (`scripts/etl/enrich-guide-legal-edges.ts`)

- 1,039 .md 본문 전수 정규식 파싱 (긴 패턴 우선 / 가지 조문 "X조의Y" 포함)
- 11개 법령명 패턴 → art:* IRI 매핑 (기준규칙/산안법/시행규칙/시행령/중처법/위평고시/건진법)
- art:* 풀 dangling 검증 → 미등록 가지 조문 29건 skip (audit:strict 회귀 차단)
- 각 가이드 .jsonld 의 `legalBasis` edge (audit-graph-health EDGE_PROPS 표준) 에 기록
- 결과: **+1,550 신규 legalBasis edge** (legalBasis 약 400 → 1,967)

### Stage 2 — 법령 조문 → 가이드 역방향 매핑 (`scripts/etl/enrich-article-reverse-edges.ts`)

- Stage 1 결과 forward edges 역방향 인덱싱
- 각 art:* 노드의 `legalBasisOf` edge 에 가이드 IRI 기록
- 결과: **+1,550 신규 legalBasisOf edge** / 법령 조문 → 가이드 발견 가능 비율 **0% → 29.6%** (387/1,306)

### Stage 3 — 법정문서 ↔ 가이드 자동 매핑 (`scripts/etl/enrich-document-guidedby.ts`)

매핑 룰 (의미적 정확성 우선):
1. 문서의 legalBasis → 각 art:* 의 legalBasisOf 가이드 풀 union (Stage 2 활용)
2. docId 키워드 fallback (보호구 → M/E, 교육 → H/G 등)
3. `doc:kosha_guide/` prefix 필터 (legalBasisOf 에 가이드 외 다른 객체 섞임 방지)

- 결과: **+131 신규 guidedBy edge** / 법정문서 guidedBy 보유율 **53% → 100%** (51/96 → 96/96)

### Stage 4 — `assemble_doc_context` 도구 강화 (실무 가용성 직결)

기존 도구는 `guidedBy` edge 를 completeness score 에만 활용 (출력 누락).

강화:
- `AssembledContext.koshaGuides` 필드 신설 (iri / guideNo / title / category / publishedBy / bodyAvailable)
- docNode.guidedBy traversal → 각 가이드 노드 메타 조회 → 결과에 포함
- `doc:kosha_guide/` prefix 필터 (정확도)
- meta.totalReferences 에 koshaGuides 카운트 포함

실측 시나리오 결과 (강화 전 / 후):
| 시나리오 | guides 자동 발견 |
|---|---|
| daily_tbm | 0 → **5** |
| ad_hoc_risk_assessment | 0 → **14** |
| industrial_accident_report | 0 → **4** |
| ppe_register | 0 → **5** |
| monthly_education_log | 0 → **5** |
| msds_register | 0 (키워드 fallback 매핑 실패 — Stage 5 후보) |

## Consequences

### Positive (사용자 본질 기획 달성)

- **트리 → 그래프 변환의 핵심 효과 실현**: LLM 이 자연어 요청 ("TBM 작성") 만으로 적용 가이드 5개 + 법령 6건 + 위험 3건 + 통제 16건 자동 발견.
- **A2UI 폼 빈칸 자동 채움**: 폼 안에 가이드/법령 표시 영역 100% 채워짐 (이전 절반 빈칸).
- **환각 차단 강화**: LLM 이 그래프 SSoT 에서 가이드 IRI 인용 → 임의 가이드명 생성 차단.
- **총 신규 edge +3,231 / dangling 0 / audit:strict PASS / mcp:test:smoke 22/22 PASS / mcp:test:graph PASS**.

### Negative

- legalBasis edge 가 가이드 노드에 추가되면서 ontology v2 audit 의 일부 키 분포 변동 (전체 임계값 통과).
- msds_register 등 일부 문서 매핑 실패 (docId 키워드 fallback 룰 보강 후보).
- 974 dormant 가이드 (법령/문서/작업에서 인용 안 됨) 는 별도 활성화 작업 — long tail, 다음 세션 후보.

## Alternatives Considered

1. **단순 카테고리 매칭 만** — 의미적 정확성 부족 (예: M 카테고리 = 모든 기계 가이드 → 노이즈).
2. **LLM 기반 의미 매칭** — 정확성 ↑ 하지만 비용 ↑ + 결정론적 reproducibility 부족.
3. **본문 인용 + 역방향 + 카테고리 fallback (이번 결정)** ✅ — 정확성 + 자동화 + reproducibility 모두 충족.

## References

- `agentsafety_kosha_guide_publication_purpose` 메모리 — KOSHA 발행 목적 (실무자 활용 자동화)
- `agent_safety_oss_identity` 메모리 — 4계층 (Ontology/Model/Harness/Human) + 19종 법정문서 + KOSHA Guide 1,039
- audit-graph-health.ts EDGE_PROPS — 31개 표준 edge 필드
- scripts/etl/enrich-guide-legal-edges.ts / enrich-article-reverse-edges.ts / enrich-document-guidedby.ts (v1.5.0 신설)
- src/tools/assemble-doc-context.ts (v1.5.0 강화)
