# Changelog

All notable changes to `agent-safety-oss` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.1] — 2026-05-22

**외부 리뷰 (npm 첫 publish 직후) 의 모든 코드/문서 drift 지적을 실제 코드 교차 검증 후 일괄 해소**.

### Added — 자동 inventory & doctor (외부 리뷰 P0/P1)

- **`scripts/build/generate-inventory.ts`** — 빌드 시 자동 실행되어 `docs/INVENTORY.md` 갱신. TOOLS·capability·KOSHA Guide·법령 조문·양식·그래프 노드 카운트를 코드/데이터에서 직접 산출, README/docs 의 수동 카운트 drift 차단.
- **`docs/INVENTORY.md`** — 자동 산출 카운트 + 법령 데이터 기준일 통합 표시 + KOSHA Guide 추출 품질 등급 분포 (verified/partial/raw) + stub 도구 명시.
- **`node build/cli.js doctor`** — 시스템 무결성 진단 CLI 명령. 도구·Capability SSoT 정합 / 그래프 노드 카운트 / KOSHA Guide 등급 분포 / 법령 동기화 stale 경고 / 사용자 환경 (profile + API 키) 점검. `--json` 옵션으로 머신 가독.

### Fixed — 실측 vs 문서 drift 일괄 해소 (외부 리뷰 P0)

- **KOSHA Guide 카운트**: README/CHANGELOG/SECURITY/ARCHITECTURE/IDENTITY/DATA_SOURCES/CONTRIBUTING/README-EN/OPERATIONAL-ONTOLOGY 의 `1,039` → 실측 `1,037` (kosha-guides/*.md 직접 카운트 + `_FAILURES.json` 2건 분리). 향후 drift 는 자동 inventory 가 차단.
- **법령 표현 정직화**: "안전관리 법령 8개 본문" → "8건 핵심 조문 발췌 (산안법 10조 / 시행령 3조 / 시행규칙 4조 / 기준규칙 10조 / 중처법 7조 / 중처법시행령 13조 / 위평고시 23조 **전문** / 건진법 §62 영역 4조 — 합계 약 77조, 전체 법령 아님)". 산안법 175조 中 5.7% 만 수록임을 명시. 개별 `safety-laws/*.md` 헤더에는 이미 정직 명시되어 있었으나 최상위 README/IDENTITY 가 과장돼 정정.
- **stub 도구 명시**: `search_sif_archive` / `list_construction_subtasks` 가 공공누리 변경금지 라이선스 준수용 의도된 placeholder 임을 INVENTORY 와 README 5초 진입 카드에 명시. "92개 (85 keyless + 7 키 필요 + **2 placeholder**)" 형식.
- **npm publish 상태**: README/README-EN/SETUP_CLAUDE_DESKTOP 의 "npm publish 전 (E404)" / "not yet published" 표현 제거. v1.4.0 publish 완료 반영.

### Added — SECURITY 키 거버넌스 (외부 리뷰 P2)

- **SECURITY.md §6.1**: AgentHQ 키 (라텔웍스 발행) vs `DATA_GO_KR_KEY` (사용자 직접 발급) 거버넌스 차이 비교표 (관측 가능성·rate limit·익명성·키 수명·prod 안정성). 라텔웍스 relay 운영 정책 4항 (영구 보관 X / 로그 redaction / 수익화 회수 없음 등) 명시.

### 보류 (코드 수정 외 영역)

- 황룡건설 외 2~3개 현장 독립 필드 테스트 결과 공개 — 비즈니스 영역, 향후 사용자 도입 사례 확보 후
- 커뮤니티 신호 (star/fork/contributor) — 시간 해결 영역
- 법령 전문 (全文) 번들 — 라이선스 (저작권법 §7 비보호이나 변경금지) + 크기 (산안기준규칙 671조 전체 ≈ 수십 MB) trade-off, 후속 ADR

### Verification

- mcp:test:smoke 29/29 PASS
- test-active-graph-authoring-loop 25/25 PASS
- `doctor` 출력: TOOLS = CAPABILITY_REGISTRY = .jsonld = 92/92/92 / 그래프 2,212 / KOSHA 1,037 (verified 14 / partial 958 / raw 65 / failed 2) / 법령 최신 2026-05-18
- INVENTORY.md 자동 생성 (133 lines) — npm run build 시 자동

## [1.4.0] — 2026-05-21

**Active Graph Authoring Loop + a2ui-demo → viewer 격상 + 사용자 onboarding 이슈 5건 fix**

본 릴리스는 ADR 002 (Active Graph Authoring Loop) 도입과 ADR 001 (viewer 격상) 을 한 번에 묶고, 첫 publish 직후 발견된 사용자 onboarding 이슈 5건을 함께 해소한다.

### Added — Active Graph Authoring Loop (ADR 002)

**A2UI ↔ LLM ↔ Graph 의 능동 루프** 도입. 사용자 입력이 LLM 의 도구 체이닝을 trigger 하고, 결과가 `updateComponents` 로 폼에 동적 push 되는 작성 보조 패턴.

신규 MCP 도구 4종 (총 88 → 92):
- `request_field_help` — 필드 단위 동적 도움말 (inputGuide·examples·checkPoints + `_meta.writingGuide.fieldHints`/`commonMistakes`/`bestPractices` 결정론 조립). `currentValue` 가 있으면 추상명사·서명 누락 등 패턴 일치 경고.
- `suggest_controls_for_hazard` — 위험요인 입력 → ERIC-PP 위계 (제거·대체·공학·관리·PPE) 정렬 통제대책 추천 (`mitigatedBy` 그래프 traversal).
- `analyze_work_context` — 작업명·내용·조건 입력 → 위험·통제·법령·KOSHA Guide 종합 컨텍스트. `workConditions.depthM`/`heightM`/`confinedSpace` 등 조건 기반 §38·§42·§618 적용성 룰 자동 발동.
- `preview_review` — 작성 중 부분 검토 (`scope: all|required-only|hallucination-only`). 최종 `review_safety_document` 와 직교 — 가드레일 vs 결재 직전 검증.

`render_a2ui_form` 강화:
- info-card 에 그래프 컨텍스트 inline (hazards/controls/relatedDocs/legalArticles/koshaGuides)
- `_meta.writingGuide.commonMistakes`/`bestPractices` 를 신규 `guide-card` 로 노출
- 필드별 `checkPoints` + `fieldHints` 동시 표시 (라벨 정규화 후 양방향 substring 매칭)
- actions Row 에 6 액션 버튼 — analyze/controls/help/preview-review/assemble/submit

문서·인프라:
- `decisions/002-active-graph-authoring-loop.md` — ADR 박제
- `.specs/in-progress/2026-05-21-active-graph-authoring-loop.md` — EARS 요구사항·디자인·태스크
- `scripts/test/test-active-graph-authoring-loop.ts` — 통합 시나리오 (daily_tbm + work_plan_excavation + 그래프 SSoT 일관성) 25 checks PASS

### Added — viewer 격상 (ADR 001)

데모 위치에 있던 A2UI 폼 viewer 를 운영 자원으로 격상. 비-개발자 안전관리자가 MCP host (Claude Desktop / Codex / MCP Inspector) 없이도 브라우저에서 직접 사용 가능.

- 본문 생성 후 **MD 파일 다운로드** 버튼 (`{docId}-{YYYY-MM-DD}.md`) — 의존성 0 (Blob URL 만 사용)
- `decisions/001-a2ui-viewer-promotion.md` — ADR 표준 도입
- `.specs/` 디렉토리 — phase gate spec (`plans/` → `in-progress/` → `executed/`)
- `render_a2ui_form` 도구 description / nextActions 에 viewer 가 동급 A2UI 호환 클라이언트로 등재

### Added — CLI DX 강화 (Issue #4)

- `node build/cli.js tools --with-schema` — 각 도구의 `inputSchema` (properties · required · type · enum · description) JSON 출력
- `node build/cli.js tools describe <toolName>` — 단일 도구 상세 (인터랙티브 형식 + 호출 예시 자동 생성)
- `tools` 사람 가독 출력에 각 도구 **필수 필드 한 줄** 추가
- 의존성 0 유지 — `zod-to-json-schema` 미사용, `src/lib/schema-introspection.ts` 자체 변환

### Fixed

- **Issue #3** — CLI `--key "value"` 따옴표 string 이 자동 number coerce 되어 Zod `z.string()` 거부되던 회귀. `src/lib/schema-introspection.ts` 가 inputSchema 의 expected type (`string`/`number`/`boolean`/`array`/`object`/`enum`) 을 추출, `parseKeyValueArgs` 가 키별로 coerce 결정. 예: `--industryCode "41"` 은 이제 string `"41"` 로 보존됨.
- **Issue #5** — `get_incident_response_workflow` 의 `dueAt` 이 UTC 자정 파싱으로 KST(+09:00) 대비 9시간 빨라지던 회귀. 모든 일자 산술을 `+09:00` 기준으로 명시 + `2026-05-21 00:30 KST` 형식으로 명시 표시. 호출 시각 fallback 도 `kstToday()` 로 KST 기준 계산.
- **Issue #5 lateral** — 같은 KST/UTC 회귀가 박혀 있던 **8곳 일괄 fix**. `src/lib/datetime-kst.ts` 공통 유틸 신설 (`kstToday`/`kstAddDays`/`kstDayDiff`/`parseKstDate`/`formatKstDate`/`kstIsoNow`). 적용처: `list_upcoming_duties` (asOf + 내일 fallback), `get_retention_status` (asOf), `generate_safety_document` (planDate fallback), `site-profile` (compileDate auto-fill), `input-validator` (TODAY 모듈 상수), `master-loader.computeNextDueDate` (compileDate + P{N}{D|M|Y} 산술), `trace-recorder` (활동 로그 일자), `local-storage.timestamp` (보관 timestamp 파일명). KST 새벽 0~9시 호출 시 "오늘"이 어제로 잘못 산정되던 회귀가 모든 시간 의존 도구에서 해소됨.
- **Issue #6** — enum/필드명 자연어 alias 미지원. `src/lib/input-aliases.ts` 의 `aliasedEnum` / `withFieldAliases` 헬퍼 도입. `severity: fatality|death|사망 → fatal`, `critical|major|중상 → serious`, `light|slight|경상 → minor` 영문·한국어 alias 지원. `field_safety_briefing` 도 `topic`/`workName`/`작업명` 등을 `workOrTopic` 으로 자동 정규화.
- **Issue #6 lateral** — 같은 패턴이 사용자 진입점 4곳에 추가 박힘 — 일괄 alias 확대. `INDUSTRY_ALIASES` (건설/건축/토목/제조/공장/서비스/기타 + 영문 변형) 가 `assess_my_obligations.industry` + `query_applicability.industry` 에 적용. `STAGE_ALIASES` (착공전/사전/시공중/진행/준공/완공 + before/during/after) 가 `get_construction_stage_duties.stage` 에 적용. `PERIOD_ALIASES` (주/주간/매주/월/월간/매월) 가 `generate_safety_report.period` + `list_safety_reports.period` 에 적용.
- **Issue #7** — `register_site`/`register_person`/`register_contractor` 응답 텍스트에 사업자등록번호·대표자명 평문 노출. `src/lib/pii-masking.ts` 신설 — 표시용 text 만 마스킹 (`***-**-67890` / `J*** D**`), `structuredContent` 는 평문 유지 (파일 저장·재호출용). `get_site_profile` 출력에도 일괄 적용. (※ `company-key-tools` 는 이미 자체 `reveal=true` 마스킹 메커니즘 보유 — lateral 점검 결과 추가 작업 불필요.)
- **결함 #1 (릴리즈 전 점검)** — `suggest_controls_for_hazard` 가 빈 문자열 / whitespace 입력에 silent fail (isError 미설정, 결과 없음). 명시적 거부 + `error: "empty_hazard"` + nextActions 안내.
- **결함 #2 (릴리즈 전 점검)** — `analyze_work_context` 가 도메인 외 입력 (서비스/제조/화학공정 등) 에도 docId 의 기본 hazard/control 을 반환해 사용자가 비-건설 작업에 건설 매핑을 적용할 위험. `domainBoundary` 시그널 신설 — `scope.json` excluded 키워드 감지 + `matchedActivities + matchedWorktypes` 모두 0 일 때 응답 상단에 ⚠️ 도메인 경계 안내 + `structuredContent.domainBoundary` 노출.

### Breaking
- npm script `mcp:demo:viewer` → `mcp:viewer` 로 변경
- `a2ui-demo/` 폴더 제거 — JSONL 정적 시연 기능은 운영 viewer (`npm run mcp:viewer`) 로 통합
- `scripts/dev/demo-a2ui-viewer.ts` → `scripts/dev/viewer-server.ts` 로 리네임

### Documentation
- README / README-EN — viewer 본격 사용법 + PDF 변환 가이드 (Pandoc / 한컴오피스 / Typora 안내)
- `viewer-server.ts` 주석 — 데모 표현 제거, 운영 위치 명시
- README badge `tools` 88 → 92

### Rationale

본질 우선순위 (사용자 황룡 2026-05-21 명시): **(1) 온톨로지 그래프 기반 작성 보조와 가이드라인 (2) 완성 문서 검토 (3) A2UI 가 작성자에게 필요한 정보를 능동적으로 가져올 수 있도록 LLM 과 연결**. ADR 002 가 세 본질을 동시 충족. ADR 001 의 viewer 격상은 14,000 안전관리자 (SAM 5,400사) 도달 — Agent_HQ PHILOSOPHY §9 의 Human fallback / 직원 역할 항목 해소. 이슈 5건 fix 는 npm 첫 publish 후 사용자 onboarding 마찰 직접 해소.

## [1.3.1] — 2026-05-20

**npm 첫 publish 직후 patch — version 시점 정합**

v1.3.0 npm publish 후 git tag 가 가리키는 commit 과 publish 된 commit 사이의 시점 차이를 해소하고, 외부 평가 보고서를 반영한 후속 정리를 단일 release 로 묶었습니다.

### 변경 사항

- 외부 평가 보고서 (2026-05-20) 반영 — P0/P1 6건 해소
  - tool-registry.ts 의 stale 주석 ("80 도구") 을 TOOLS.length SSoT 표기로 정정
  - ensureGraphBuilt 가 buildIndex 만 호출하던 결함 → buildIndex + buildGraph 통합
  - loadArchivedDocument 의 path traversal 가드 (`..` / `/` / `\\` / 정상화 prefix 검증)
  - assemble_doc_context excerpt 가 article 전체 description 노출 → `slice(0, 500)` 발췌
  - 로컬 저장소 경로 SSoT — `src/config/paths.ts` 신규 + local-storage / trace-recorder 통합
  - link_company_key · get_company_info text content PII 기본 마스킹 + `reveal: true` 명시 옵션
- 회귀 정정 — trace-recorder 가 SAFETY_LOCAL_DIR 미반영하던 결함 해소
- .env.example · 코드 주석의 옛 이름 (`agent-safety-oss-mcp`) 잔여 정정

### 외부 사용자 영향

- npm `npm update agent-safety-oss` 또는 `npm install -g agent-safety-oss@latest` 로 즉시 받기 가능
- 입력 호환성 변화 없음 (모든 도구 동일 schema · 동일 출력 구조)
- 단 PII 기본 마스킹 도입 — `link_company_key` / `get_company_info` text 본문이 마스킹 표시. 평문 확인은 `reveal: true` 명시.

## [1.3.0] — 2026-05-19

**첫 PUBLIC release — 한국 건설안전 작성 보조 MCP**

안전관리자·현장소장이 매일·매주·매월 작성하는 19종 법정 안전관리 문서
(TBM·작업계획서·위험성평가·MSDS·작업허가서·산재조사표 등) 를 정확하고
빠르게 작성하도록 옆에서 돕는 작성 보조 MCP 서버.

### 안전관리자가 받는 실질 가치

- **88개 도구** 모두 작성 보조 직접 동작
- **1,037 KOSHA Guide 본문 번들** (offline, keyless — 인터넷 없이 가이드 발췌)
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
- 1,037 KOSHA Guide 본문 (offline, MD 형식)
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
- KOSHA Guide 본문 (1,037건): 공공누리 출처표시·변경금지

### 제공·개발

- 주식회사 라텔웍스 (Ratelworks Inc.) — <alphamale@ratelworks.co.kr>
