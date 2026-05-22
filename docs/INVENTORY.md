# Inventory (자동 생성)

> **본 문서는 `npm run build` 시 `scripts/build/generate-inventory.ts` 가 자동 생성합니다. 수동 편집 금지** — drift 차단용.

- 생성 시각: 2026-05-22T16:06:46+09:00
- 법령 데이터 최신 동기화: **2026-05-18**
- 양식 인덱스 컴파일: 2026-04-29

---

## 1. MCP 도구

| 항목 | 수 |
|---|---:|
| 전체 등록 도구 | **92** |
| API 키 불필요 (keyless) | 85 |
| API 키 필요 (data.go.kr / KOSHA OneAPI) | 7 |
| 라이선스 placeholder (데이터 없음) | 2 |
| **실질 활성 도구** | **90** |

**라이선스 placeholder 도구** (의도된 빈 상태 — 공공누리 변경금지 라이선스 준수):
- `search_sif_archive` — 사용자가 `npm run sync-kosha` 로 공식 데이터를 별도 로드해야 동작
- `list_construction_subtasks` — 사용자가 `npm run sync-kosha` 로 공식 데이터를 별도 로드해야 동작

**API 키 필요 도구** (data.go.kr 또는 라텔웍스 발행 키):
- `search_accident_cases`
- `get_accident_case_attachments`
- `search_construction_fatal_accidents`
- `search_all_fatal_accidents`
- `search_safety_materials`
- `search_msds`
- `search_ppe_certification`

## 2. 그래프 노드

| 카테고리 | 노드 수 |
|---|---:|
| articles | 1306 |
| annexes | 227 |
| patterns | 110 |
| documents | 96 |
| capabilities | 92 |
| chapters | 55 |
| controls | 50 |
| activities | 41 |
| hazards | 38 |
| events | 24 |
| applicabilities | 22 |
| entities | 19 |
| interpretations | 19 |
| work_types | 16 |
| sources | 15 |
| cycles | 13 |
| methods | 13 |
| equipment | 10 |
| iso45001 | 9 |
| penalties | 9 |
| acts | 8 |
| manuals | 8 |
| object_sets | 7 |
| statistics | 3 |
| kosha_guides | 2 |
| facets | 0 |
| **전체** | **2212** |

## 3. KOSHA Guide 본문

| 항목 | 수 |
|---|---:|
| 전체 본문 (.md) | **1037** |
| 추출 실패 (`_FAILURES.json`) | 2 |

**추출 품질 등급** (빈 `<table>` 잔재 기준 자동 분류):

| 등급 | 기준 | 수 | 비율 |
|---|---|---:|---:|
| **verified** | 빈 `<table>` 0건 — 본문 정상 | 14 | 1.4% |
| **partial** | 빈 `<table>` 1~10건 — 표 일부 손실, 본문 텍스트 정상 | 958 | 92.4% |
| **raw** | 빈 `<table>` 11+건 — kordoc 변환 잔재 다수, 본문은 텍스트로 가독 가능 | 65 | 6.3% |

> ⚠️ KOSHA Guide 는 PDF → kordoc 변환 결과로, 일부 시각적 서식 손실 가능. LLM 인용 시 본문 텍스트만 사용 권장. 정확한 원본은 각 파일의 `원본 URL` 참조.

## 4. 법령 본문 (핵심 조문 발췌)

> ⚠️ **본 OSS 의 법령 번들은 건설안전 실무 핵심 조문 발췌 — 전문 (全文) 아님**. 전체 법령은 [법제처](https://www.law.go.kr) 직접 참조 필수. 단, 위험성평가 고시 (2024-76호) 는 전문 (23조) 수록.

| 법령 | 수록 조문 | 전체 조문 | 커버리지 | 마지막 동기화 | 현행 호수 |
|---|---:|---:|:---:|:---:|---|
| 건진법 §62 영역 | 4 | (영역 한정) | (영역 한정) | 2026-05-18 | — |
| 산안기준규칙 | 10 | 671 | 1.5% | 2026-04-26 | — |
| 산안법 시행규칙 | 4 | 252 | 1.6% | 2026-04-26 | — |
| 산안법 시행령 | 3 | 159 | 1.9% | 2026-04-26 | — |
| 산업안전보건법 | 10 | 175 | 5.7% | 2026-04-26 | : |
| 위험성평가 고시 | 26 | 23 | 113.0% | 2026-04-24 | — |
| 중처법 시행령 | 13 | 14 | 92.9% | 2026-05-18 | — |
| 중대재해처벌법 | 6 | 16 | 37.5% | 2026-04-26 | — |
| **합계** | **76** | — | — | — | — |

**저작권**: 저작권법 §7 — 비보호 저작물 (자유 인용·재배포)

## 5. 양식 인덱스 (`forms-map.json`)

| 포맷 | 수 | 비고 |
|---|---:|---|
| HWP | 14 | 공식 양식 (고용노동부·KOSHA·법제처 원본) |
| MD | 94 | 자동 생성 양식 (sections.fields 기반) |
| PDF | 23 | 공식 양식 (고용노동부·KOSHA·법제처 원본) |
| XLSX | 1 | 공식 양식 (고용노동부·KOSHA·법제처 원본) |
| **합계** | **132** | — |

**라이선스**: 공공누리 (KOREA Open Government License) — 출처 표시 + 비영리·영리 자유 사용·배포

## 6. 데이터 신뢰성 요약

- **법령**: 법제처 OpenAPI `lawService` 직접 추출 + 본문 100% 검증 (개별 \.md 헤더 참조)
- **KOSHA Guide**: PDF → kordoc 변환 — 본문 텍스트 보존, 일부 표 서식 잔재. 등급 분포 위 §3 참조.
- **그래프 노드**: SHACL 검증 통과, IRI dangling 0
- **자동 검증 게이트** (CI): `audit:strict` / `verify:tool-capability` (92/92/92) / `verify:edge-context` / `validate-shapes:strict` / `npm audit --audit-level=high`
- **개정 미반영 가능성**: 본 번들은 마지막 동기화일 기준 스냅샷. 그 이후 법령 개정·KOSHA Guide 신규는 미반영. 결재·인용 전 법제처/KOSHA 원본 재확인 권장.

## 7. 본 문서 갱신

```bash
npm run build              # 자동 생성 (빌드 단계 통합)
npx tsx scripts/build/generate-inventory.ts  # 수동 실행
```

CI 단계에서 본 문서가 최신 상태와 일치하는지 검증할 수 있도록 `check:inventory-drift` 추가 예정.

---

**제공: 황룡건설(주) · 개발: 주식회사 라텔웍스** · 라이선스: MIT · 공공누리
