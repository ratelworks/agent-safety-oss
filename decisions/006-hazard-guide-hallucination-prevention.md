---
id: 006
status: accepted
date: 2026-05-26
deciders: 황룡, Claude
tags: [hallucination, over-dump, hazard, document-quality, graph-ssot, purpose-alignment]
---

# 006. 위험·가이드 환각 차단 — 근거 명확한 것만 제시 (over-dump = 위험요인 환각)

## Context

본 OSS의 목적(사용자 명시 2026-05-26): **안전 실무자(안전관리자·현장소장)의 법정문서 작성 보조 + 근거에 기반한 올바른 안전 도메인 지식 전달.** 모든 기능의 최종 척도는 "안전 실무자에게 근거 기반 올바른 지식을 전달하는가"이며, **올바름(정확한 근거) > 양(커버리지)**.

이 척도로 결과물을 실측한 결과, generate가 **위험요인 환각**을 생성하고 있음이 드러났다.

### 실측 (2026-05-26)

`honorary_safety_supervisor_appointment`(명예안전감독관 선임서)를 generate하면:
> **## 식별된 위험 요소 (그래프 추론 — KOSHA Guide N건 기반)**
> 추락 / 붕괴 / 방사선 노출 / 익사 / … (22개)

선임서에 방사선·익사 위험은 **근거가 없다.** 그런데 "그래프 추론 · KOSHA Guide 기반"이라 **출처를 달아 근거 있는 것처럼 제시**한다. 안전관리자는 이를 신뢰 → 근거 없는 위험을 올바른 지식으로 오인. 이는 ADR 005에서 차단한 **법령 인용 환각과 같은 종류의 오류**이며, 본 OSS 정체성(환각 차단)과 목적에 정면 위배다.

### over-dump 전수 (비가이드 96개 문서)

| 모드 | 문서 | 위험 수 | 비고 |
|------|:---:|------|------|
| 화이트리스트(hasHazard 지정) | 63 | 대부분 2~6, 최대 15 | 정밀 |
| **가이드폴백(hasHazard 없음)** | 33 | 30·25·25·22·20·19·18·16… | **over-dump** |

상위: construction_safety_health_register(가이드61→위험30), work_plan(15→25), honorary_safety_supervisor_appointment(5→22), legal_summary_posting(5→19).

### 근본 원인 (3층)

1. **측정 척도가 실사용 품질을 못 봄**: `mcp:test:quality`의 hazards 산식(`expectedHazards 포함률`)은 over-dump 무페널티, koshaGuide는 순수 개수. → 88.4점이 환각을 통과시킴.
2. **over-dump는 결과물 내용으로만 보임**: 측정 점수로는 안 잡힘.
3. **연쇄 인과**: ADR 004가 guidedBy를 53%→100%로 무차별 부착(행정문서 포함, docId 키워드 fallback) → generate `loadHazards`가 hasHazard 없으면 guidedBy→causedBy로 위험 폴백 → 행정문서에 위험 16~30개. **양(커버리지 100%)을 채우려다 올바름을 희생**한 전형.

## Decision

**위험·가이드는 근거가 명확한 것만 제시한다. 근거 없는 위험/가이드를 그래프 추론인 양 제시하는 것을 환각으로 간주하고 차단한다** (ADR 005 법령 환각 원칙을 위험·가이드로 확장).

### C안 — 문서 성격별 차등 (행정 자동차단 + 작업 화이트리스트 점진)

1. **행정성 문서**(선임·게시·대장·신청·교육·보고 — 위험요인이 본질적으로 불필요): generate `loadHazards`에서 documentCategory 기반으로 **guidedBy→causedBy 위험 폴백 비활성화**. hasHazard 화이트리스트가 없으면 **위험 0**(선임서·게시물에 위험 안 붙음).
2. **작업성 문서**(작업계획서·점검표·위험성평가 — 특정 작업 위험을 다룸): hasHazard 화이트리스트 우선. 화이트리스트 미작성분은 점진적으로 적합 위험 지정(별도 데이터 작업). 폴백 유지 시에도 적정 cap.

### 측정 척도 보강

`document-quality-test.ts`의 hazards 산식에 **over-dump 페널티**(expectedHazards 대비 과다 시 감점), koshaGuide에 **관련성** 반영. 안 그러면 환각 차단 개선이 점수로 검증되지 않는다(현재는 많을수록 고득점).

## Acceptance Criteria

**핵심 기준:** 안전 실무자에게 근거 없는 위험·가이드가 전달되지 않는다.

- [ ] honorary_safety_supervisor_appointment·legal_summary_posting·construction_safety_health_register generate → 위험 0 또는 근거 있는 적정 수 (환각 22~30개 제거)
- [ ] 회귀: severe_accident_compliance 등 작업문서는 적합 위험 유지(중처법시행령 §4 본문 등 ADR 005 결과 보존)
- [ ] over-dump 전수 재측정: 가이드폴백 16~30개 문서 해소
- [ ] 측정 척도 보강 후 over-dump가 점수에 페널티로 반영됨
- [ ] 게이트: audit:strict / validate-shapes / verify:edge-context / mcp:test:smoke / mcp:test:graph PASS

## Alternatives Considered

1. **A안 (category 자동차단만)** — 행정문서 즉시 해결, 작업문서 over-dump(work_plan 25) 잔존.
2. **B안 (문서별 화이트리스트 전수)** — 정밀하나 33개 도메인 작업량 큼, 즉시성 부족.
3. **C안 (행정 자동차단 + 작업 점진 화이트리스트)** ✅ — 행정 환각 즉시 차단 + 작업 정밀화 단계적. 즉시성과 정확성 균형.
4. **measurement만 고치기** — 환각 자체는 안 막음. 기각.

## Consequences

### Positive
- 위험요인 환각 차단 → 목적(근거 기반 올바른 지식) 부합, 안전 실무자 신뢰 회복.
- 측정 척도가 관련성을 봐서 향후 개선이 검증 가능.
- ADR 005(법령)·004(가이드 통합)와 일관: 그래프 근거 명확한 것만 제시.

### Negative
- ADR 004의 "guidedBy 100% 커버리지"가 부분 무력화(행정문서 가이드는 위험 추론에 안 쓰임) — 의도된 후퇴(양→올바름).
- 작업문서 화이트리스트 점진 작성은 도메인 작업량 잔존(별도 추적).

## References

- 목적·원칙: 안전 실무자에게 근거 기반 올바른 지식 전달 — 정확한 근거(올바름) > 커버리지(양)
- ADR 005 (법령 환각 그래프 SSoT 우선 검증) — 본 ADR은 그 원칙의 위험·가이드 확장
- ADR 004 (양방향 그래프 통합 — guidedBy 100%) — over-dump 연쇄 인과의 출발
- `src/tools/generate-safety-document.ts` loadHazards(167-191) / inferCategoryFromDocId(214-234) / `_meta.documentCategory`
- `scripts/quality/document-quality-test.ts` hazards 산식(172-180) / koshaGuide(160-164)
- 2026-05-26 실측: over-dump 전수(가이드폴백 33개 위험 16~30) vs 화이트리스트 63개(2~6)
