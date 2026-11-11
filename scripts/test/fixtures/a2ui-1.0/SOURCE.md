# A2UI 1.0 스키마 (시험 자료)

이 폴더의 JSON·JSONL 파일은 A2UI 프로젝트의 공식 규격 파일을 수정 없이 복사한 것입니다.

- 출처: https://github.com/a2ui-project/a2ui (커밋 `24d1bf9c830071f74c9c908433e73cc6cbe0aa33`)
- 라이선스: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
- 용도: `npm run mcp:test:a2ui-schema` 가 이 스키마로 A2UI 출력을 검증합니다. npm 패키지에는 포함되지 않습니다.

| 파일 | 상류 경로 |
|---|---|
| `agent_to_renderer.json` | `specification/v1_0/json/agent_to_renderer.json` |
| `renderer_to_agent.json` | `specification/v1_0/json/renderer_to_agent.json` |
| `common_types.json` | `specification/v1_0/json/common_types.json` |
| `catalog_definition.json` | `specification/v1_0/json/catalog_definition.json` |
| `basic_catalog.json` | `catalogs/basic/v1/catalog.json` |
| `contact_form_example.jsonl` | `specification/v1_0/test/cases/contact_form_example.jsonl` |

규격이 바뀌면 같은 경로에서 다시 받아 교체하고 위 커밋을 갱신합니다.
