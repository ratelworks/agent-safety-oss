# 007 — DocLang 출력 포맷 옵션 (format: "md" | "doclang")

- 상태: 채택 (2026-06-12)
- 선행: [001 — A2UI viewer 격상](001-a2ui-viewer-promotion.md)이 "비-md export는 후속 결정"으로 예약한 자리의 1차 응답

## Context

19종 법정문서의 본질은 *내용*이 아니라 **양식**이다 — 다단 헤더, 병합셀, 결재선, 고정 칸. 그런데 현재 출력 포맷의 양 끝이 모두 LLM 전달에 부적합하다:

- **Markdown**: 병합셀·다단 헤더·양식 필드(빈칸) 개념이 없다. 현재 md 출력은 "양식의 표현"이 아니라 "내용의 선형화"다.
- **HWPX**: 표현력은 완전하지만 스타일 XML 노이즈가 본문의 수십 배라 LLM이 직접 다루기에 부적합하다.

DocLang(LF AI & Data 표준 XML, OTSL 표 직렬화)은 정확히 이 중간 지점 — "복잡한 문서를 LLM에 전달"하기 위해 설계된 포맷이다. 부가 가치:

1. **양식 수준 검수** — 병합 구조·빈칸 위치를 LLM이 판단 재료로 쓸 수 있다.
2. **RAG 코퍼스 균질성** — HWP 원본에서 변환된 기존 문서 코퍼스와 같은 포맷으로 합류한다.
3. **그래프 연결 보존** — 법령 근거 IRI 등 도메인 메타를 element-level `<custom>` 슬롯에 실어, 생성 시점부터 의미 연결된 문서가 축적된다.

## Decision

1. **교체가 아닌 계층 추가** — `generate_safety_document`에 `format: "md" | "doclang"` 파라미터. 기본값 `"md"`(기존 무중단), `"doclang"`은 experimental opt-in.
2. **렌더러 레지스트리** — SSoT는 자체 구조화 데이터(Document/sections). DocLang은 직렬화 타깃이며, 스펙 어휘는 `src/lib/doclang-serializer.ts` 한 곳에만 존재한다. 스펙이 변동해도 직렬화기 한 장만 교체한다.
3. **버전 각인** — 산출물 루트에 `<doclang version="0.6">` 명시. 축적 코퍼스의 마이그레이션 추적 근거.
4. **의미 계층 불변** — `structuredContent`는 포맷 선택과 무관하게 항상 동일 반환.
5. **점진 도입** — 중앙 렌더러(`renderGeneric`) 경로의 `generate_safety_document`부터. 변형 렌더러(TBM 등)는 후속.

## Consequences

- (+) 기존 사용자 무중단 — semver minor 추가.
- (+) DocLang 스펙(v0.6, 진화 중) 변동 리스크가 opt-in 사용자로 한정된다.
- (−) 직렬화기 모듈 1개의 유지보수가 추가된다. 스펙 어휘가 이 모듈 밖으로 새면 변경 비용이 번진다 — 경계 준수 필수.
- (−) OTSL·`<custom>` 등 스펙 제약(예: root-level `<custom>`은 validator 실패)을 테스트로 고정해야 한다.

## 미해결 (후속)

- md 대비 DocLang 표현의 LLM 검수 정확도 우위는 정량 미검증 — 같은 문서의 양 포맷 비교 테스트 케이스로 후속 측정 후 experimental 해제 판단.
- viewer 다운로드 포맷 선택, 프로파일 기본 포맷 저장은 본 결정 범위 외.
