# Inventory (자동 생성)

> **본 문서는 `npm run build` 시 `scripts/build/generate-inventory.ts` 가 자동 생성합니다. 수동 편집 금지** — drift 차단용.

- 생성 시각: 2026-11-17T14:12:03+09:00
- 법령 데이터 최신 동기화: **2026-11-17**
- 양식 인덱스 컴파일: 2026-04-29

---

## 1. MCP 도구

| 항목 | 수 |
|---|---:|
| 전체 등록 도구 | **92** |
| API 키 불필요 (keyless) | 84 |
| API 키 필요 (data.go.kr / KOSHA OneAPI) | 8 |
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
- `search_safety_law_smart`

## 2. 그래프 노드

- 카테고리 1단계 노드 (직속 `.jsonld`): **4668**
- 전체 노드 (재귀, KOSHA Guide 1,040건 포함): **5826**
- 엣지 (주요 EDGE_FIELDS): **46148**

| 카테고리 | 1단계 | 재귀 (서브디렉토리 포함) |
|---|---:|---:|
| articles | 2420 | 2420 |
| documents | 96 | 1136 |
| chapters | 551 | 551 |
| annexes | 321 | 321 |
| kosha-media | 231 | 231 |
| supplements | 220 | 220 |
| acts | 157 | 157 |
| facets | 0 | 118 |
| patterns | 110 | 110 |
| capabilities | 92 | 92 |
| subtasks | 90 | 90 |
| activities | 50 | 50 |
| controls | 50 | 50 |
| hazards | 38 | 38 |
| conditions | 35 | 35 |
| penalties | 27 | 27 |
| events | 24 | 24 |
| applicabilities | 22 | 22 |
| entities | 19 | 19 |
| interpretations | 19 | 19 |
| work_types | 16 | 16 |
| sources | 15 | 15 |
| cycles | 13 | 13 |
| methods | 13 | 13 |
| equipment | 10 | 10 |
| iso45001 | 9 | 9 |
| manuals | 8 | 8 |
| object_sets | 7 | 7 |
| statistics | 3 | 3 |
| kosha_guides | 2 | 2 |
| **전체** | **4668** | **5826** |

## 3. KOSHA Guide 본문 / 메타

| 항목 | 수 | 비고 |
|---|---:|---|
| 그래프 메타 (.jsonld) | **1040** | KOSHA OneAPI 15144147 가 인지한 가이드 메타 |
| 원본 (.dclx) | **1040** | 공단 포털 원본 PDF 를 DocLang 0.8 아카이브로 변환 (공식 validator 통과본) |
| 원본 주소·SHA-256 기록 | 1040 | `_SOURCES.json` — 공단 포털 원본 PDF 주소와 해시 |
| 공단 포털 현행 (제정·개정) | 1039 | |
| 공단 포털 폐지 | 1 | W-14-2022 |
| 본문 미수집 | 0 | (없음 — 본문 = 메타) |

> ⚠️ KOSHA Guide 원본(.dclx)에는 그림 파일을 싣지 않고 그림 자리·캡션·원본 쪽 번호만 남긴다. 표는 병합 셀까지 보존한다. 정확한 원본은 `_SOURCES.json` 의 `sourceUrl`.

## 4. 법령 본문 (핵심 조문 발췌)

> ⚠️ **본 OSS 의 법령 번들은 건설안전 실무 핵심 조문 발췌 — 전문 (全文) 아님**. 전체 법령은 [법제처](https://www.law.go.kr) 직접 참조 필수. 위험성평가 고시 (제2026-73호, 2026-11-04 전부개정) 는 34조 전문 수록.

| 법령 | 수록 조문 | 전체 조문 | 커버리지 | 마지막 동기화 | 현행 호수 |
|---|---:|---:|:---:|:---:|---|
| 건진법 시행규칙 | 1 | (영역 한정) | (영역 한정) | 2026-09-28 | 국토교통부령 제1597호 |
| 건진법 시행령 | 1 | (영역 한정) | (영역 한정) | 2026-09-28 | 대통령령 제36404호 |
| 건진법 | 2 | (영역 한정) | (영역 한정) | 2026-09-28 | 법률 제21065호 |
| 산안기준규칙 | 10 | 671 | 1.5% | 2026-11-03 | 고용노동부령 제450호 |
| 산안법 시행규칙 | 7 | 252 | 2.8% | 2026-11-03 | 고용노동부령 제477호 |
| 산안법 시행령 | 3 | 159 | 1.9% | 2026-11-03 | 대통령령 제36540호 |
| 산업안전보건법 | 13 | 175 | 7.4% | 2026-11-03 | 법률 제22122호 |
| 위험성평가 고시 | 34 | 34 | **전문** | 2026-11-17 | 제2026-73호 |
| 중처법 시행령 | 13 | 14 | 92.9% | 2026-09-28 | 대통령령 제35805호 |
| 중대재해처벌법 | 6 | 16 | 37.5% | 2026-09-28 | — |
| **합계** | **90** | — | — | — | — |

**저작권**: 저작권법 §7 — 비보호 저작물 (자유 인용·재배포)

## 4-1. 법정의무 문서 마스터 (`legal-duty-master.json`)

- 19종 법정 안전관리 문서: **19** (안전관리자가 매일·매주·매월 작성)
- 94 docId 마스터: **94** (legal-duty-master.json 의 documents 총 카운트 — 19종 + 세분화된 사이클·범위·발주처별 변형)

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

8개 문서 (README · CHANGELOG · SECURITY · ARCHITECTURE · IDENTITY · DATA_SOURCES · CONTRIBUTING · OPERATIONAL-ONTOLOGY) 의 marker 영역은 `sync-docs.ts` 가 본 inventory 산출값으로 자동 갱신합니다. `npm run docs:check` 가 CI/pre-commit 에서 drift 차단.

---

**제공: 황룡건설(주) · 개발: 주식회사 라텔웍스** · 라이선스: MIT · 공공누리
