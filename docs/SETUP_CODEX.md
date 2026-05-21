# OpenAI Codex CLI 설정

`agent-safety-oss` 를 OpenAI Codex CLI 에서 MCP server 로 등록하고 안전관리 도메인 도구 88개 (KOSHA 키 없이 약 82개) 를 사용하는 방법.

Codex CLI 는 본 OSS 의 **2대 메인 MCP host** 중 하나입니다 (Claude Desktop 과 대등 지원).

---

## 사전 준비

- **Node.js 20.19 이상** (`node --version` 으로 확인)
- **OpenAI Codex CLI 설치**: 공식 안내 (https://github.com/openai/codex) 참조
- (선택) `AGENTHQ_API_KEY` 환경변수 — 공공 OpenAPI 검색 도구 (약 9개) 활성화. 없어도 약 88개 도구 정상 동작.

---

## 1. config.toml 에 MCP server 등록

Codex CLI 의 설정 파일 `~/.codex/config.toml` 에 다음을 추가합니다:

```toml
[mcp_servers.agent-safety-oss]
command = "npx"
args = ["-y", "agent-safety-oss", "serve"]
```

공공 OpenAPI 검색 도구까지 활성화하려면 환경변수 추가:

```toml
[mcp_servers.agent-safety-oss]
command = "npx"
args = ["-y", "agent-safety-oss", "serve"]
env = { AGENTHQ_API_KEY = "ASF_xxxxxxxxxxxxxxx" }
```

> **로컬 소스 체크아웃** 사용 시 `command = "node"` + `args = ["/absolute/path/to/agent-safety-oss/build/cli.js", "serve"]` 로 대체.

---

## 2. 등록 확인

Codex CLI 재시작 후:

```bash
codex mcp list
```

`agent-safety-oss` 가 목록에 보이면 연결 완료. 도구 목록 확인:

```bash
codex mcp tools agent-safety-oss
```

88개 도구가 보여야 정상.

---

## 3. 동작 확인 — 자연어 요청

Codex CLI 세션에서 자연어로 요청:

```
오늘 굴착 5m + 도시가스 인접 작업의 작업계획서 초안을 만들어줘
```

Codex 가 자동으로 다음 도구를 조합 호출합니다:
- `analyze_construction_work_risks` — 위험요인 분석
- `get_measures_by_risk` — 안전대책
- `generate_safety_document(docId: "work_plan_excavation")` — 작업계획서 생성
- `review_safety_document` — 검수

결과는 양식·법령 근거·KOSHA Guide·빈칸 가이드가 포함된 완성 본문 Markdown.

---

## 4. 라텔웍스 회사 키 연동 (선택)

황룡건설(주) 또는 라텔웍스 발급 회사 키가 있으면:

```
라텔웍스에서 받은 AgentHQ 키 ASF_xxxx 를 등록해줘
```

→ `link_company_key` 도구 자동 호출. 사업장 SSoT 자동 등록으로 19종 법정문서 결재선·메타가 자동 채워집니다.

---

## 5. troubleshooting

### `codex mcp list` 에 안 보임
- `~/.codex/config.toml` 의 TOML 문법 확인 (`[mcp_servers.NAME]` 섹션 헤더, `args` 는 배열)
- Codex CLI 완전 재시작 (백그라운드 프로세스 포함)
- `npx -y agent-safety-oss serve` 를 터미널에서 직접 실행해 에러 없는지 확인

### 도구 호출 시 "tool not found"
- `codex mcp tools agent-safety-oss` 로 실 등록된 도구 명 확인
- 도구명 typo 확인 (현 안정판 v1.4.0 도구 목록은 README §"MCP 도구" 참조)

### 공공 OpenAPI 도구가 "API 키 필요" 반환
- `AGENTHQ_API_KEY` 환경변수가 Codex 프로세스에 전달됐는지 확인
- config.toml 의 `env = { ... }` 섹션 정상 작성 확인
- 키 발급: 라텔웍스 (alphamale@ratelworks.co.kr)

---

## 6. 그 외 host

- **Claude Desktop**: [docs/SETUP_CLAUDE_DESKTOP.md](./SETUP_CLAUDE_DESKTOP.md)
- **MCP Inspector**: 표준 MCP 1.x 프로토콜 — `npx -y agent-safety-oss serve` 명령으로 stdio transport 등록
- **OpenAI Agents SDK / 기타 MCP client**: 표준 MCP 1.x 프로토콜 — `npx -y agent-safety-oss serve` 명령 stdio transport 등록
