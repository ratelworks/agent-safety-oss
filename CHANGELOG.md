# Changelog

All notable changes to `agent-safety-oss` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-05-19

**첫 PUBLIC release — 한국 건설안전 작성 보조 MCP**

안전관리자·현장소장이 매일·매주·매월 작성하는 19종 법정 안전관리 문서
(TBM·작업계획서·위험성평가·MSDS·작업허가서·산재조사표 등) 를 정확하고
빠르게 작성하도록 옆에서 돕는 작성 보조 MCP 서버.

### 안전관리자가 받는 실질 가치

- **88개 도구** 모두 작성 보조 직접 동작
- **1,039 KOSHA Guide 본문 번들** (offline, keyless — 인터넷 없이 가이드 발췌)
- **8개 법령 본문 번들** (산안법·시행령·시행규칙·기준규칙·중처법·중처법 시행령·위험성평가 고시·건진법 §62 영역)
- **19종 법정문서 그래프 추론 14/14** (100%)
- **도구별 결과 일관성 보장** (같은 docId 어느 도구로 호출해도 결과 같음)
- **API 키 발급 3 경로 명확화** (라텔웍스 무료 · 자체 data.go.kr · 사내 RELAY)
- **LLM 환각 차단 자동 검증** (강제 표현 시 법령 IRI 인용 자동 검증)
- **외국인 13개국어 자료 링크** (E-9 비자 노동자 안전교육)

### 5초 진입

Claude Desktop / OpenAI Codex CLI 두 host 메인 지원. `npm` 한 줄.

설정 파일에 다음 한 블록만 추가:

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

자세히는 [README](./README.md).

### 핵심 자료

- 88 MCP tools
- 1,039 KOSHA Guide 본문 (offline, MD 형식)
- 8개 법령 본문 (offline)
- 94 docId 마스터 + 132 form index
- 3,336 노드 운영 그래프 (작업·위험·통제·법령·문서·증빙·조치·보고)
- 19종 법정문서 양식 + 결재선 + 보존기간

### 책임 경계

본 OSS 는 **법적 강제 효력이 없는 작성 보조 도구**입니다.
작성된 양식의 법적 검토·승인·정부 제출·사고 책임은 안전관리자·현장소장에게 있습니다.

### 라이선스

- 코드: MIT
- 안전관리 법령 본문: 저작권법 §7 비보호 (자유 인용)
- KOSHA Guide 본문 (1,039건): 공공누리 출처표시·변경금지

### 제공·개발

- 주식회사 라텔웍스 (Ratelworks Inc.) — <alphamale@ratelworks.co.kr>
