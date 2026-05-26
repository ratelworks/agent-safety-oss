---
id: 005
status: accepted
date: 2026-05-26
deciders: 황룡, Claude
tags: [ontology, graph-ssot, hallucination-check, legal-article, single-source-of-truth]
---

# 005. 그래프 SSoT 우선 환각검증 — 법령 식별자 단일화 + 결과물의 온톨로지 그래프 반영 보장

## Context

ADR 004(양방향 그래프 통합, v1.5.0)는 "LLM 이 그래프 SSoT 에서 IRI 인용 → 환각 차단"을 핵심 정신으로 박제했다. 그래프 데이터 레이어는 3중 게이트(`validate-shapes` SHACL / `audit:strict` / `verify:edge-context`)를 모두 통과하며 건강하다(2026-05-26 실측: 위반 0 / dangling 0 / cycle 0). `art:중처법시행령:4` 같은 조문 노드도 정상 존재한다.

그러나 **법령 본문·실존성을 다루는 코드 레이어가 그래프 SSoT 를 우회**하여, 같은 조문을 도구마다 다르게 취급하는 비대칭이 실측됐다.

### 실측 증거 (2026-05-26)

| 경로 | 입력 | 결과 | 그래프 반영 |
|------|------|------|:----------:|
| `getNode("art:중처법시행령:4")` | IRI | 노드 존재 ("사업주·경영책임자등의 안전·보건 확보의무") | — |
| **generate** `severe_accident_compliance` | doc.legalBasis = `art:중처법시행령:4/5` | 결과물에 중처법 시행령 §4 본문 정상 출현 | ✅ |
| **review** citations `중처법 시행령 §4` | 텍스트 ref | `fail / isError=true / "환각 가능성"` | ❌ |
| `legalRefToIri("중처법시행령","§4")` | 텍스트 | `null` (canonical 매핑 실패) | ❌ |

즉 **그래프에 정상 존재하고 generate 결과물에도 반영되는 조문을, review 의 환각검증은 차단한다.** 정당한 법령 인용이 환각으로 오판되어 안전관리자에게 `isError` 로 반려된다.

### 근본 원인 — 법령 식별자가 3개 레이어에서 분기

| 레이어 | 중처법 시행령 식별자 | SSoT 여부 | 도달성 |
|--------|---------------------|:--------:|:------:|
| 그래프 노드 (`articles/*.jsonld`) | `art:중처법시행령:4` | ✅ 진짜 SSoT | 존재 |
| MD 로더 LawCode (`safety-laws-loader.ts`) | `severe-accident-decree` | ✗ 자체 7종 | `guess` 가 `시행령`→`osha-decree` 선점, 도달 불가 |
| alias 테이블 (`article-iri-map.ts`) | (미등록) | ✗ 자체 alias | canonical `null` |

`review-safety-document.ts` 의 환각검증(`scanInlineCitations`, citations 검증)은 `getArticle`(MD grep) → `legalRefToIri`(alias) 순으로만 시도하고, **그래프 노드 `getNode` 를 직접 조회하지 않는다.** 반면 generate 의 `law-body-extractor.ts` 는 `loadArticleNodeDescription` 으로 그래프 노드 description 을 fallback 으로 읽어 결과적으로 반영된다 — 단 `KNOWN_NOT_INCLUDED` 하드코딩 목록 + MD 우선이라는 우회 구조에 의존한다.

## Decision

**법령 조문의 본문·실존성 판정은 그래프 노드(`art:`/`annex:` IRI)를 1차 SSoT 로 한다. MD 번들과 alias 테이블은 보조(본문 표시용)로 강등한다.**

### 1. 법령 ref → IRI 정규화 단일화

- 텍스트 ref("중처법 시행령 §4", "산안법 §36" 등) → `art:`/`annex:` IRI 변환을 **단일 함수**로 통일.
- 그래프에 존재하는 **모든** `art:` 노드 prefix(중처법시행령·건진법시행령 포함)를 커버. `safety-laws-loader.ts` 의 LawCode 7종 + `article-iri-map.ts` 의 `LAW_ALIASES` 분산을 단일 매핑으로 수렴.
- `guessLawCodeFromRef` 의 `시행령` 선점 버그 제거: 본법명("중처법"/"중대재해")과 수식어("시행령")를 결합 판정.

### 2. review 환각검증을 그래프 우선으로 재배선

- 순서: 텍스트 ref → IRI 정규화 → **`getNode(IRI)` (그래프 SSoT) 우선** → 존재하면 `exists:true`.
- `getArticle`(MD grep)은 본문 발췌·표시 보조로만 사용. 실존성 판정의 1차 근거가 아니다.
- 그래프에 노드가 있으면 환각이 아니다. 노드도 없고 정규화도 실패할 때만 환각 후보.

### 3. generate 본문 발췌도 그래프 우선으로 표준화

- `law-body-extractor.ts` 의 `KNOWN_NOT_INCLUDED` 하드코딩 의존 제거 방향: `art:` IRI 는 **그래프 노드 description 을 우선** 조회하고, MD 본문은 더 길거나 정식 표기가 필요할 때 보강.
- 효과: 신규 조문 노드가 추가돼도 하드코딩 갱신 없이 자동 반영.

### 4. generate ↔ review 결과물 일관성 (사용자 최우선 요구)

- generate 가 본문 발췌에 쓰는 SSoT == review 가 실존성 검증에 쓰는 SSoT == **그래프 노드**.
- 한 도구가 본문을 그래프에서 채우는데 다른 도구가 같은 조문을 환각으로 막는 모순을 구조적으로 제거.

## Acceptance Criteria

**핵심 기준 (그래프 반영 보장):** 그래프에 `art:` 노드가 존재하는 모든 조문은 (a) generate 결과물에 본문이 반영되고, (b) review 에서 환각으로 오판되지 않는다.

- [ ] review citations/inline `중처법 시행령 §4` → `pass` (환각 아님, `isError` 미부착)
- [ ] 회귀: `severe_accident_compliance` generate → 중처법 시행령 §4 본문 그래프 출현 **유지**
- [ ] 대조군 회귀: `중처법 §4`·`산안법 시행령 §42` 정상 pass 유지, 진짜 환각(`산안기준규칙 §9999`)은 여전히 `fail`
- [ ] 그래프 무결성 게이트 전부 유지: `validate-shapes` / `audit:strict` / `verify:edge-context` PASS
- [ ] `mcp:test:smoke` / `mcp:test:graph` PASS

## Alternatives Considered

1. **alias 테이블에 "중처법 시행령" 한 줄만 추가** — 즉효지만 식별자 3중 분기 근본 문제 잔존. 다음 누락 조문에서 재발. ✗
2. **MD 번들에 중처법시행령.md 추가** — 본문은 채우나 LawCode `guess` 라우팅 버그·SSoT 분산 미해결. ✗
3. **그래프 노드 SSoT 우선 + ref→IRI 단일화 (이번 결정)** ✅ — 그래프가 이미 권위 SSoT(SHACL·audit PASS)이므로 코드를 거기에 맞춤. ADR 004 정신과 정합.

## Consequences

### Positive
- 정당한 법령 인용이 환각으로 차단되는 P0 신뢰성 결함 해소.
- generate 결과물과 review 검증이 동일 그래프 SSoT → 결과물 일관성 보장.
- 신규 조문 노드 추가 시 하드코딩 갱신 불필요(자동 반영).
- ADR 004 "그래프 SSoT 환각차단" 정신을 코드 레이어까지 관철.

### Negative
- `safety-laws-loader.ts` LawCode 체계·`law-body-extractor.ts` `KNOWN_NOT_INCLUDED` 등 기존 우회 코드 정리 범위가 있음(점진 가능).
- ref→IRI 정규화가 그래프 노드 prefix 와 동기화돼야 함 → 그래프 prefix 추가 시 정규화 매핑도 갱신(단일 지점이라 관리 용이).

## References

- ADR 004 (양방향 그래프 통합) — "그래프 SSoT 에서 IRI 인용 → 환각 차단" 정신
- `src/lib/safety-laws-loader.ts` `guessLawCodeFromRef` (시행령 선점 버그) / `src/lib/article-iri-map.ts` `LAW_ALIASES` (중처법시행령 누락)
- `src/tools/review-safety-document.ts` (환각검증 — 그래프 우회) / `src/lib/law-body-extractor.ts` (generate — 노드 fallback 보유)
- `src/ontology/graph/nodes/articles/중처법시행령-§4.jsonld` (실재 노드)
- 2026-05-26 실측: `getNode` 성공 vs `legalRefToIri` null / generate 본문 반영 vs review 환각 차단
