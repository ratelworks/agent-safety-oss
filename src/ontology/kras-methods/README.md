# KRAS 위험성평가 방법론 번들

> **출처**: 한국산업안전보건공단(KOSHA) 산업안전포털 KRAS — `https://portal.kosha.or.kr/kras/evaluation/kras-method`
> **저작권**: KOSHA 자료 (공공누리 유형 확정 전이며, 본 번들은 방법론의 **명칭·절차 개요·적용 조건**만 인용 수준으로 정리. 원문 PDF 재배포 아님)
> **마지막 동기화**: 2026-04-24

KRAS(KOSHA Risk Assessment System)는 한국산업안전보건공단이 제공하는 공식 위험성평가 방법론 체계입니다. 본 번들은 7개 방법의 **개요·적용 조건·단계별 절차** 를 LLM 가드레일용으로 요약했습니다.

## 7개 방법 비교

| 코드 | 방법 | 적용 대상 | 정량/정성 | 비고 |
|---|---|---|:---:|---|
| `3step` | 위험성 수준 3단계 판단법 | 소규모·초보 사업장 | 정성 | 상·중·하 직관적 판단 |
| `checklist` | 체크리스트법 | 표준화된 반복 작업 | 정성 | ○/× 체크, 단순 작성 시 누락 위험 |
| `key_factor` | 핵심요인 기술법 (OPS) | 중·소규모 단순 작업 | 정성 | HSE/ILO 기반, One Point Sheet |
| `frequency_severity` | 빈도·강도법 | 정량 평가 필요 사업장 | 정량 | 가능성×중대성 매트릭스 (5×4 or 3×3) |
| `occupational_health` | 산업보건 위험성평가법 | 보건관리 영역 | 정성 | 보건체계·작업환경·건강관리 3분야 |
| `chemical` | 화학물질 위험성평가 (CHARM) | 화학물질 취급 사업장 | 정성 | MSDS·작업환경측정 활용, 영국 HSE Control Banding 기반 |
| `construction_continuous` | 건설업 최초·상시·수시·정기 평가 | 건설현장 (의무) | 정성 | 매월 1회 상시평가 + 변경 시 수시 + 연 1회 정기 |

## 공통 절차 (3단계)

모든 KRAS 방법은 다음 3단계 구조를 따름:

```
유해·위험요인 파악  →  위험성 결정  →  위험성 감소대책 수립·실행
```

방법 차이는 **2단계 "위험성 결정"** 의 판단 기법.

## 방법 선택 가이드 (LLM 의사결정용)

| 사업장 조건 | 권장 방법 (1순위) | 보조 방법 |
|---|---|---|
| **건설현장** (모든 규모) | `construction_continuous` | 작업별로 `frequency_severity` 또는 `key_factor` |
| 소규모 제조업 (50인↓) | `3step` 또는 `key_factor` | `checklist` |
| 중·대규모 제조업 | `frequency_severity` | `checklist` |
| 화학물질 다량 취급 | `chemical` | + `frequency_severity` |
| 직업병 위험 (소음·분진·근골격계 등) | `occupational_health` | + `chemical` |
| 표준 작업 반복 | `checklist` | - |

## 파일 구성

```
src/ontology/kras-methods/
├── README.md (이 파일)
├── 3step.md                       # 위험성 수준 3단계 판단법
├── checklist.md                   # 체크리스트법
├── key-factor.md                  # 핵심요인 기술법 OPS
├── frequency-severity.md          # 빈도·강도법
├── occupational-health.md         # 산업보건 위험성평가법
├── chemical.md                    # 화학물질 위험성평가 CHARM
└── construction-continuous.md     # 건설 최초·상시·수시·정기 평가
```

## 법적 근거

- **산업안전보건법 §36** — 사업주의 위험성평가 의무
- **산업안전보건법 시행규칙 §37·§38** — 실시 시기·결과 기록·보존(3년)
- **고용노동부 고시 제2024-76호** — 사업장 위험성평가에 관한 지침 (시행 2025-01-02)

## LLM 사용 가이드

이 번들은 다음 Tool 들이 참조합니다:
- `list_kras_methods()` — 7개 방법 메타 반환
- `choose_assessment_method({industry, scale, subject})` — 사업장 조건에 맞는 방법 추천
- `get_kras_method({method})` — 특정 방법 상세 조회
- `get_risk_assessment_schema({method})` — 선택한 방법의 평가서 양식 반환

LLM 이 위험성평가서를 작성할 때 반드시 이 번들에서 적합한 방법을 먼저 선택한 뒤, 해당 방법의 절차에 따라 진행할 것.
