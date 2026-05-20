# Scripts

역할별 실행 스크립트 정리 기준.

| 디렉터리 | 용도 |
|---|---|
| `build/` | 빌드 보조, 패키징 산출물 복사 |
| `test/` | MCP 동작, 그래프 추론, 실제 입력 반응성 테스트 |
| `verify/` | JSON-LD, SHACL, essence/lightweight, 운영 온톨로지 검증 |
| `audit/` | 그래프 건강성, 커버리지, 법정문서 감사 |
| `quality/` | 생성 문서 품질 평가와 자동 보강 루프 |
| `sync/` | KOSHA, 법령, 양식 등 외부/원천 데이터 동기화 |
| `seed/` | 초기 노드, 법령, hazard/control, 표준 필드 시드 |
| `ontology/` | 온톨로지 정규화, 보강, 변환, RDF export |
| `migrations/` | 과거 라운드별 일회성 마이그레이션 |
| `dev/` | 실험, 데모, skeleton 검증, dogfooding |
| `data/` | 스크립트가 참조하는 로컬 사전/맵 |

반복 가능한 공개 명령은 `package.json`의 npm script를 우선 사용한다. 직접 실행할 때도 위 분류 경로를 기준으로 호출한다.
