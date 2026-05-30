# Claude Desktop Setup

`agent-safety-oss`를 Claude Desktop에 MCP 서버로 연결하는 방법입니다.

## 준비물

- Claude Desktop
- Node.js 20.19 이상
- 선택: 공공 OpenAPI 검색용 `AGENTHQ_API_KEY`

키 없이도 다음 기능은 사용할 수 있습니다.

- 번들 법령 검색/조회
- 운영 그래프 traversal
- 법정문서 가이드
- 문서 생성과 검수
- 현장 프로파일, 사진, 이슈, 조치, 보고서 로컬 저장

공공 OpenAPI가 필요한 기능은 재해사례, MSDS 원문, KOSHA Guide 본문, 보호구 인증 등 외부 조회 도구입니다.

## 설정 파일 위치

| OS | 경로 |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

> 아래 `npx` 경로면 **별도 설치 없이 바로** 사용할 수 있습니다 (npm 최신 publish 본을 자동으로 받아 실행). 소스 빌드본 직접 연결은 "소스 빌드본으로 사용" 섹션 참조 (fork·개발자용).

## npx로 사용 (권장)

```json
{
  "mcpServers": {
    "agent-safety-oss": {
      "command": "npx",
      "args": ["-y", "agent-safety-oss", "serve"]
    }
  }
}
```

## npm global 설치로 사용

```bash
npm install -g agent-safety-oss
```

```json
{
  "mcpServers": {
    "agent-safety-oss": {
      "command": "agent-safety-oss",
      "args": ["serve"]
    }
  }
}
```

## 소스 빌드본으로 사용 (fork·개발자용)

```bash
git clone https://github.com/ratelworks/agent-safety-oss.git
cd agent-safety-oss
npm install
npm run build
```

```json
{
  "mcpServers": {
    "agent-safety-oss": {
      "command": "node",
      "args": ["/absolute/path/to/agent-safety-oss/build/cli.js", "serve"]
    }
  }
}
```

## 공공 OpenAPI 키 설정

필요할 때만 추가합니다.

```json
{
  "mcpServers": {
    "agent-safety-oss": {
      "command": "npx",
      "args": ["-y", "agent-safety-oss", "serve"],
      "env": {
        "AGENTHQ_API_KEY": "ASF_xxxx_yyyy"
      }
    }
  }
}
```

data.go.kr 키를 자체 발급해 직접 쓰는 방식도 지원합니다. `.env` 에 `DATA_GO_KR_KEY=<발급키>` 를 설정하면 됩니다.

## 재시작

1. Claude Desktop을 완전히 종료합니다 (창 닫기만으론 부족 — macOS 는 `Cmd+Q`, Windows 는 트레이 아이콘 우클릭 → Quit).
2. 다시 실행합니다.
3. 입력창 우측 하단의 망치(🔨) 아이콘을 클릭하면 활성 MCP 서버 목록이 보입니다. `agent-safety-oss` 가 보이면 연결 완료입니다.

## 키 등록 (자연어, 환경변수 미설정 시)

`claude_desktop_config.json` 의 `env` 에 키를 박지 않았다면 Claude 에 한국어로 다음과 같이 요청하면 됩니다.

```text
라텔웍스에서 받은 AgentHQ API 키 ASF_xxxx_yyyy 를 등록해줘.
```

내부에서 `link_company_key` 도구가 호출되어 `~/.agent-safety-oss/company-key.json` 에 0o600 권한으로 저장됩니다. 등록 후엔 공공 OpenAPI <!-- INV:TOOLS_KEYREQ -->7<!-- /INV:TOOLS_KEYREQ -->개 도구가 즉시 동작합니다. 등록 상태 확인은 `get_company_info`, 해제는 `unlink_company_key`.

## 첫 요청 예시

```text
30억, 상시 12명 건설현장에 적용되는 안전보건 의무를 알려줘.
```

```text
오늘 굴착 작업 TBM 주제와 필요한 보호구를 정리해줘.
```

```text
MSDS 비치대장 초안을 작성하고 법령 근거가 맞는지 검수해줘.
```

```text
중대재해가 발생했을 때 지금부터 어떤 보고를 해야 하는지 시간순으로 알려줘.
```

## 현장 프로파일 등록 예시

```text
우리 회사 사업장 정보를 등록해줘.
사업장명은 ○○건설, 사업자번호는 (10자리 사업자등록번호), 대표자는 홍길동이야.
현장은 천안 신축현장, 도급금액은 30억, 상시근로자는 12명이야.
안전관리자는 김안전, 현장소장은 이소장이야.
```

Claude가 `register_site`, `register_project`, `register_person` 계열 도구를 호출하면 이후 문서의 사업장명, 현장명, 결재선이 자동 채워집니다.

## 문제 해결

### 도구가 보이지 않음

- JSON 문법을 확인합니다.
- `node --version`이 20.19 이상인지 확인합니다.
- `npx -y agent-safety-oss tools`가 터미널에서 실행되는지 확인합니다.
- Claude Desktop을 완전히 종료 후 재실행합니다.

### 소스 빌드본이 실행되지 않음

- `npm run build`를 먼저 실행합니다.
- `build/cli.js` 경로를 절대경로로 지정합니다.
- `build/index.js`가 아니라 `build/cli.js`에 `serve` 인자를 붙입니다.

### 공공 OpenAPI만 실패함

- 번들 기능은 정상인데 외부 검색만 실패한다면 `AGENTHQ_API_KEY` 설정 여부를 확인합니다.
- 운영팀이 자체 data.go.kr 키를 직접 사용하는 경우 `.env.example`의 운영팀 전용 섹션을 따릅니다.

### 응답이 너무 김

- "요약만", "결재에 필요한 항목만", "현장소장용으로 5줄"처럼 범위를 좁혀 요청합니다.
- 도구에 `summaryOnly` 옵션이 있는 경우 Claude가 자동으로 사용할 수 있습니다.

## 로그 위치

| OS | 로그 위치 |
|---|---|
| macOS | `~/Library/Logs/Claude/mcp-server-agent-safety-oss.log` |
| Windows | `%APPDATA%\Claude\logs\mcp-server-agent-safety-oss.log` |

정상 기동 시 CLI 배너에 패키지명, 버전, 제공/개발 주체가 출력됩니다.
