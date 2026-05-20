# Task Statement

중소 건설사에서 실제로 사용할 수 있는 경량 운영 온톨로지 그래프를 구축한다. 기존 대형 운영 온톨로지 제품을 직접 언급하지 않고, 실용적 구조만 차용한다.

# Desired Outcome

- Semantic Layer: 법령, 문서, 작업, 위험, 통제, 증거, 출처가 표준 JSON-LD 기반으로 연결된다.
- Kinetic Layer: MCP 도구가 실행 가능한 ActionType으로 정리되고, 입력/출력/전제/증거/감사 기준을 가진다.
- Dynamic Layer: LLM은 그래프를 대체하지 않고 Harness를 통해 도구 조합, 설명, 누락 질문, lineage 응답만 수행한다.
- 현재 그래프가 이 구조를 얼마나 충족하는지 자동 평가할 수 있다.

# Known Facts / Evidence

- 현재 그래프 노드: 3,314개.
- 현재 그래프 엣지: 29,510개.
- MCP graph test는 5/5 통과.
- operational 목적상 `Document -> LegalBasis -> Article`, `Document -> Hazard -> Control`, `KOSHA Guide` 연결은 충분하다.
- 표준 JSON-LD expand는 dangling IRI와 context term 문제로 아직 실패한다.
- 기존 repo에 사용자 변경 가능성이 있는 dirty files가 있다: README.md, package.json, safety-document-guides-loader.ts, get/list guide tools.

# Constraints

- 기존 그래프를 축소하지 않는다.
- 기본 방향은 "경량"을 Palantir식 대형 온톨로지 대비 경량으로 이해한다.
- 특정 벤더명은 문서/README 대외 표현에 직접 언급하지 않는다.
- LLM은 법령/근거/필수 의무를 생성하지 않는다. MCP 그래프와 검증 도구가 진실 소스다.
- 기존 사용자 변경을 되돌리지 않는다.

# Unknowns / Open Questions

- 운영 프로파일을 npm 공개 표면에 즉시 포함할지, 내부 검증 단계로 먼저 둘지.
- Dynamic Layer harness가 별도 런타임으로 구현될지, MCP 도구 정책 문서와 검증 스크립트로 먼저 표현될지.
- Evidence 객체를 기존 graph/nodes에 대량 추가할지, 우선 profile metadata로 선언할지.

# Likely Codebase Touchpoints

- src/ontology/graph/context.jsonld
- src/ontology/graph/nodes/**
- src/ontology/operational/**
- scripts/verify-operational-ontology.ts
- package.json scripts
- docs/ARCHITECTURE.md 또는 신규 docs/OPERATIONAL-ONTOLOGY.md
