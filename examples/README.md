# Examples

agent-safety-oss 사용 예제. 각 예제는 외부 의존성 없이 단독 실행 가능.

| 파일 | 용도 |
|------|------|
| [`claude-desktop-config.json`](./claude-desktop-config.json) | Claude Desktop 설치 — `mcpServers` 항목 추가 예 |
| [`generate-tbm.sh`](./generate-tbm.sh) | CLI 로 일일 TBM 작성 (`generate_safety_document` 호출) |
| [`search-laws.sh`](./search-laws.sh) | CLI 로 산안법·기준규칙 검색 + 조문 본문 조회 |
| [`mcp-list-tools.sh`](./mcp-list-tools.sh) | 등록된 MCP 도구 89개 카탈로그 출력 |

## 사전 준비

```bash
npm install -g agent-safety-oss
# 또는 로컬 빌드:
npm install && npm run build
```

LocalStorage(`~/.agent-safety-oss/`)는 첫 실행 시 자동 생성됩니다. 별도 설정 불필요.

## 공공 OpenAPI 사용 시

`get_kosha_guide_md` 외 7개 Live 도구는 라텔웍스 운영 Relay (`KOSHA_RELAY_URL` 기본값) 를 통해 단일 키로 동작합니다. 사용자 키 발급 불필요. 자체 키로 직접 호출하려면 `.env` 에 `DATA_GO_KR_KEY=<발급키>` + `KOSHA_RELAY_URL=` (빈 값) 을 명시하세요.
