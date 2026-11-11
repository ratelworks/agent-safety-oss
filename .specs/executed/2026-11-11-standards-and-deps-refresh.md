---
spec_id: 2026-11-11-standards-and-deps-refresh
status: executed
created: 2026-11-11
priority: P1
estimated_hours: 10
---

# 외부 규격·의존성 최신화 — DocLang 0.8 · A2UI 1.0 · npm 의존성

v1.9.0(`82c627b`) 기준 점검(2026-11-11)에서 확인된, 상류 규격보다 뒤처진 출력과 낡은 의존성을 현행으로 맞춘다.
버전 올림·CHANGELOG·태그·게시는 이 명세 범위 밖이다(반영 뒤 별도로 한다).

## 작업 1 — npm 의존성

현황(`npm outdated`, 2026-11-11): 범위 안 갱신 6건, 주 버전 차이 3건. `npm audit` 낮음 1건(fast-xml-parser ≤5.11.2, GHSA-474x-hrwr-fgx4 — `stopNodes` 미사용이라 실제 노출 없음).

- SYSTEM SHALL 범위 안 갱신을 반영한다: `fast-xml-parser` ^5.12.0(하한 올림), `n3` 2.13.x, `kordoc` 4.24.63 이상, `@zazuko/env-node` 3.1.3, `@types/n3` 1.26.6, `@types/node` 22.20.5.
- SYSTEM SHALL `commander` 를 14.x 로 올린다(14 는 Node >=20, 15 는 Node >=22.12 를 요구하므로 15 는 올리지 않는다). `src/cli.ts` 의 모든 하위 명령·옵션이 올리기 전과 같은 인자를 받고 같은 출력을 내야 한다.
- SYSTEM SHALL `typescript` 를 7.x 로 올려 본다. `npm run typecheck`·`npm run build`·`npm test` 가 통과하고 `build/` 산출물(파일 목록·`.d.ts` 존재)이 올리기 전과 같으면 반영한다. 통과시키려면 소스 동작을 바꿔야 하거나 `tsx`·빌드 스크립트가 지원하지 않으면 5.9 에 두고, 막힌 지점(오류 원문)을 이 명세 끝에 기록한다.
- `engines`(>=20.19.0), CI 매트릭스, `@types/node` 주 버전(22)은 바꾸지 않는다(지원 범위 축소는 별도 결정).

완료 기준
- [x] `npm audit` 취약점 0건
- [x] `npm run typecheck`, `npm test`, `npm run test:full` 통과 — TypeScript 7.0.2 반영(`types` 기본값이 비어 `tsconfig.json` 에 `node` 명시), 빌드 산출물 파일 목록 5,062개 동일
- [x] `node build/cli.js tools` 의 도구 수와 `node build/cli.js --help` 출력이 올리기 전과 같다 — commander 14 가 남는 인자를 기본 거부해 `call` 명령에 허용을 명시(그 전에는 스모크 시험 13건 실패)

## 작업 2 — DocLang 출력을 0.8 로

현황: `src/lib/doclang-serializer.ts` 가 `<doclang version="0.6">`(네임스페이스 없음)을 낸다. 공식 검증기 0.8.0(`pip install "doclang[schematron-saxon]==0.8.*"`, `doclang validate <파일>`)에 `daily_tbm` 출력을 넣으면 XSD 실패(`Element 'doclang': No matching global declaration`), 루트를 `<doclang xmlns="https://www.doclang.ai/ns/v0" version="0.8">` 로만 바꾸면 XSD·Schematron 모두 통과한다. 다른 문서 종류는 아직 검증하지 않았다.

- WHEN `generate_safety_document` 가 `format: "doclang"` 으로 호출될 때, SYSTEM SHALL 루트에 `xmlns="https://www.doclang.ai/ns/v0"` 와 `version="0.8"` 을 적는다(`DOCLANG_VERSION = "0.8"`).
- SYSTEM SHALL 문서 노드 전 종류의 DocLang 출력이 공식 검증기 0.8 의 XSD·Schematron 을 통과하게 한다. 통과하지 못하는 요소가 나오면 0.8 규격의 요소로 고친다(검증을 건너뛰거나 내용을 빼서 통과시키지 않는다).
- README 의 "DocLang v0.6" 표기와 도구 설명의 버전 표기를 0.8 로 고친다.
- `scripts/test/test-doclang-output.ts` 는 버전 기대값을 상수에서 읽고, 네임스페이스 선언을 검사한다(선언이 빠진 입력은 실패하는 대조군 포함).

완료 기준
- [x] 문서 노드 전 종류를 DocLang 으로 뽑아 공식 검증기 0.8.0 에 넣은 결과: 96종 · 통과 96 · 실패 0
- [x] `npm run mcp:test:doclang` 통과
- [x] 저장소에 `version="0.6"`·"DocLang v0.6" 표기가 남지 않는다(CHANGELOG 과거 항목, 시험의 대조군 제외)

## 작업 3 — A2UI 출력과 viewer 를 1.0 으로

상류(`github.com/a2ui-project/a2ui`) `specification/versions.json` 기준 1.0 이 current, 0.9.1·0.9 는 previous 다. 기준 문서: `specification/v1_0/docs/evolution_guide.md`(0.9→1.0 변경 전문), `specification/v1_0/json/agent_to_renderer.json`·`renderer_to_agent.json`·`common_types.json`, 기본 카탈로그 `catalogs/basic/v1/catalog.json`(catalogId `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`), 공식 예제 `specification/v1_0/test/cases/contact_form_example.jsonl`. 구현 전에 이 파일들을 raw 로 받아 전문을 읽는다.

현황(`render_a2ui_form`, `daily_tbm`): "v0.9" 로 표기하지만 0.9 정식 스키마와도 다르다.

| 항목 | 현재 출력 | 1.0 |
|---|---|---|
| 메시지 `version` | 없음 | 모든 메시지에 `"version": "1.0"` |
| `updateComponents.root` | 있음 | 정의에 없음 — 루트는 id `root` 인 컴포넌트 |
| `catalogId` | `"standard"` | 기본 카탈로그 URL |
| 스타일 힌트 | `usageHint` | `variant` |
| Text 제목 | `usageHint: h1/h2` | `variant` 는 `caption`·`body` 뿐 — 제목은 Markdown(`# 제목`) |
| TextField | `shortText`·`longText`·`date`·`datetime`·`signature`, `value` 없음 | `variant` 는 `shortText`·`longText`·`number`·`obscured`, `value` 필수(`{"@path": "/…"}` 바인딩) |
| 검증·접근성 키 | — | `@checks`·`@accessibility`(컴포넌트 루트의 `@` 접두) |

- SYSTEM SHALL `render_a2ui_form`·`render_profile_input_form` 과 `a2uiUpdate` 를 돌려주는 도구(`request_field_help`·`analyze_work_context`·`suggest_controls_for_hazard` 등)의 모든 메시지가 1.0 스키마(`agent_to_renderer.json`)와 기본 카탈로그 v1 을 통과하게 한다.
- 날짜·일시·시각 필드는 `DateTimeInput`, 예/아니오 필드는 `ChoicePicker`, 그 밖(서명·점검표 표기 포함)은 `TextField` 로 옮긴다. 양식 필드 키와 세부 입력 종류는 `@metadata.extensions`(`fieldKey`·`inputKind`)에 싣는다. 기본 카탈로그에 없는 컴포넌트·속성은 쓰지 않는다. 필드 안내·예시·점검 사항처럼 지금 비표준 속성으로 싣는 정보는 `Text`(`caption`) 컴포넌트나 `@metadata.extensions` 로 옮기되, 화면에 보이던 정보가 사라지지 않게 한다.
- (구현 중 정정) 문서 노드에는 필드별 필수 여부 데이터가 없어 `@checks` 는 싣지 않는다 — 없는 필수 표시를 만들어내지 않는다. 필수 누락 검토는 종전대로 `preview_review`·`review_safety_document` 가 맡는다.
- 부분 갱신(`a2uiUpdate`)은 폼의 보조 패널 컴포넌트를 함께 다시 보내 새 카드가 폼 트리에 붙게 한다(종전에는 어느 부모에도 연결되지 않았다).
- SYSTEM SHALL `src/viewer.ts` 가 1.0 메시지를 렌더한다 — `version` 확인, `variant`, Markdown 제목, `@path` 바인딩된 초기값을 데이터 모델에서 읽는다. 버전이 다른 메시지는 렌더하지 않고 알린다. 폼 입력 → `generate_safety_document` 호출 → 결과 내려받기 흐름이 옮기기 전과 같이 동작해야 한다.
- 도구 설명·capability 노드·README·docs 의 "A2UI v0.9" 표기를 1.0 으로 고친다. 도구 결과의 `a2uiVersion` 은 `"1.0"`.
- 공식 스키마(1.0 `json/*.json`, 기본 카탈로그)를 시험 fixture 로 저장소에 넣고(Apache-2.0 — `NOTICE.md` 에 출처·라이선스 추가), 문서 노드 전 종류의 `render_a2ui_form` 출력과 `render_profile_input_form` 출력, `a2uiUpdate` 를 내는 도구의 대표 출력을 그 스키마로 검증하는 시험을 `npm test` 에 건다. 스키마 검증기가 필요하면 개발 의존성으로만 더한다. 시험에는 실패해야 하는 입력(예: `version` 없는 메시지, `usageHint` 를 쓴 컴포넌트)을 대조군으로 함께 둔다.

완료 기준
- [x] 문서 노드 전 종류 × `render_a2ui_form` 출력이 1.0 스키마·기본 카탈로그 검증 통과: 96종 · 통과 96 · 실패 0 (`npm run mcp:test:a2ui-schema` 128 통과 / 0 실패)
- [x] `npm run mcp:test:a2ui` 와 새 스키마 시험 통과, 대조군 입력 8종은 실패
- [x] viewer 를 띄워 브라우저로 확인: `daily_tbm` 폼 렌더(입력 14칸, 제목·날짜 입력 정상) → 입력 → 작성 완료 → 본문에 입력값 반영, 사업장 정보 저장 뒤 자동 채움 값이 데이터 모델에서 입력칸으로 들어감, 옛 버전 메시지는 렌더하지 않음
- [x] 저장소에 "A2UI v0.9"·`usageHint` 표기가 남지 않는다(CHANGELOG 과거 항목, 시험의 대조군 제외) — 입력 파일이 없어 돌지 않던 옛 자체 검증 스크립트 2개는 공식 스키마 시험으로 대체해 지웠다

## 공통

- `npm run typecheck`, `npm test`, `npm run test:full`, `npm run check:oss-hygiene`, `npm run docs:check` 통과.
- 문서 본문 생성 결과(Markdown)는 이 작업으로 바뀌지 않아야 한다.

## 범위 밖

- Node 20 지원 종료(`engines` 올림)와 그에 딸린 `commander` 15·`@types/node` 주 버전 올림
- 버전 올림·CHANGELOG·태그·npm 게시
- 2026-12-08 시행 산업안전보건법 개정 반영(시행 뒤 별도 작업)

## 확인된 별도 문제 (이 명세에서 고치지 않음)

- viewer 가 저장된 초안을 복원할 때 빈 값까지 덮어써, 초안 저장 뒤에 등록한 사업장 정보가 그 문서 폼에 자동으로 채워지지 않는다(이번 변경 전부터의 동작).
