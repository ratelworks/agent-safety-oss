# Changelog

All notable changes to `agent-safety-oss` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] — 2026-05-24

**🎯 양방향 온톨로지 그래프 통합 — 실무 가용 수준 달성**. 핵심 설계 방향 ("트리 → 그래프 → LLM 도메인 전문성 자동 활용") 의 결정적 진전.

### Added — 3-단계 양방향 그래프 enrichment (decision 004)

- **Stage 1** `scripts/etl/enrich-guide-legal-edges.ts` — 1,039 KOSHA Guide 본문 전수 정규식 파싱 → art:* IRI 매핑 → `legalBasis` edge 자동 기입. **+1,550 신규 edge** (legalBasis 약 400 → 1,967). dangling 0 (가지 조문 29건 skip — audit:strict 회귀 차단).
- **Stage 2** `scripts/etl/enrich-article-reverse-edges.ts` — Stage 1 결과 역방향 인덱싱 → 각 art:* 노드의 `legalBasisOf` edge 기입. **+1,550 신규 edge** / 법령 조문 → 가이드 발견 가능 비율 **0% → 29.6%** (387/1,306).
- **Stage 3** `scripts/etl/enrich-document-guidedby.ts` — 법정문서 45개 (guidedBy 미보유) ↔ KOSHA Guide 자동 매핑. legalBasis traversal (의미적 정확성) + docId 키워드 fallback. **+131 신규 guidedBy edge** / 법정문서 guidedBy 보유율 **53% → 100%** (51/96 → 96/96).
- **Stage 4** `src/tools/assemble-doc-context.ts` 강화 — `koshaGuides` 결과 필드 신설. docNode.guidedBy traversal → 각 가이드 메타 (guideNo / title / category / bodyAvailable) 자동 노출. LLM 이 자연어 요청만으로 적용 가이드 즉시 발견.
- **decision** `decisions/004-bidirectional-graph-enrichment.md` — 결정/대안/결과 기록.

### Verification — 시나리오별 KOSHA Guide 자동 발견 (assemble_doc_context 호출)

| 시나리오 (사용자 자연어 요청 매핑) | 강화 전 | 강화 후 |
|---|:---:|:---:|
| daily_tbm (오늘 TBM 만들어줘) | 0 | **5** |
| ad_hoc_risk_assessment (수시 위험성평가) | 0 | **14** |
| industrial_accident_report (산재보고) | 0 | **4** |
| ppe_register (보호구 대장) | 0 | **5** |
| monthly_education_log (월간 교육) | 0 | **5** |

- 그래프 총 엣지: 29,730 → **32,961** (+3,231 신규 의미 edge)
- audit:strict / verify-graph: ✅ PASS (dangling 0, DAG cycle 0, critical 누락 0)
- mcp:test:smoke 22/22 PASS, mcp:test:graph reasoning/consistency/effect PASS
- docs:check 16개 문서 정합 (자동 marker 갱신)

### Impact (핵심 설계 방향 달성)

- **A2UI 폼 빈칸 자동 채움 100%** — 안전관리자가 폼 열면 가이드/법령/위험/통제 모두 자동 표시 (CLI 미숙련 사용자 부담 해소).
- **LLM 환각 차단 강화** — 그래프 SSoT 에서 가이드 IRI 인용 → 임의 가이드명 생성 차단.
- **트리 → 그래프 변환 본질 효과 실현** — LLM 이 도메인 전문성을 그래프 traversal 로 자동 활용.

---

## [1.4.2] — 2026-05-23

`inspect` CLI 신설 (`doctor` 의 정식 이름) + KOSHA Guide 본문 전수 회복 (1,037 → 1,039) + decision 003 Doc Drift Prevention (marker + sync-docs + docs:check + pre-commit).

### Added — decision 003 (Doc Drift Prevention)

3-Layer Defense 로 9개 문서의 카운트 ↔ 코드 drift 를 구조적으로 차단:

- **L1 (이미 v1.4.1)**: `docs/INVENTORY.md` 자동 생성. `inventory-data.ts` 분리로 카운트 산출 단일 진원지 확보.
- **L2 신규**: `scripts/build/sync-docs.ts` — 9개 문서의 `<!-- INV:키 -->값<!-- /INV:키 -->` marker 영역을 INVENTORY 산출값으로 자동 갱신. `npm run build` 시 generate-inventory 직후 자동 실행. (실제 marker 키 13종은 `inventory-data.ts` 의 MARKER_MAP 참조)
- **L3 신규**: `scripts/build/sync-docs.ts --check` (= `npm run docs:check`) 가 marker 값과 INVENTORY 산출값을 비교 → 불일치 시 exit 1.
  - `.githooks/pre-commit` (husky 미사용, native git hook + `prepare` script 가 `core.hooksPath` 자동 설정)
  - `.github/workflows/ci.yml` CI step 추가
  - `npm test` 와 `prepublishOnly` 에 포함
- **decision**: `decisions/003-doc-drift-prevention.md` — alternatives 4종 비교 후 marker 방식 채택 사유 기록.
- **marker 키 13종**: `KOSHA_BODY`/`KOSHA_META`/`KOSHA_FAILURES` · `TOOLS_TOTAL`/`KEYLESS`/`KEYREQ`/`PLACEHOLDER`/`ACTIVE` · `LAW_LAST_SYNC`/`LAW_ARTICLES` · `GRAPH_TOTAL`/`DOCUMENTS_TOTAL` · `VERSION`.

### Added — `inspect` CLI

- **`node build/cli.js inspect`** — 시스템 정합성 점검의 정식 명령. `doctor` 는 v1.4.1 backward-compat alias 로 유지. (`docker inspect` / `kubectl inspect` 와 같은 "내부 구조 점검" 어휘 채택 — "doctor" 가 의료 메타포로 의미가 부정확하다는 점 정정)
- **KOSHA Guide 본문 ↔ 메타 차이 자동 검증** — `inspect` 와 `INVENTORY.md` 가 `src/ontology/graph/nodes/documents/guides/` (메타 1,039) 와 `src/ontology/kosha-guides/` (본문 1,039) 의 차이를 자동 검출. v1.4.2 에서 본문 = 메타 일치 회복.
- **`scripts/audit/audit-kosha-guide-gaps.ts`** — KOSHA Guide 카테고리별 번호 시퀀스 갭 자동 audit. KOSHA 발행 패턴 진단용.

### Fixed — KOSHA Guide 본문 2건 회복 (1,037 → 1,039)

- **A-142-2018** (디에탄올아민에 대한 작업환경측정 분석 기술지침) + **T-25-2021** (시험동물 조직 전처리 및 포매 지침) 본문 회복.
- 회복 메커니즘 정정: KOSHA OneAPI 15144147 응답의 `fileDownloadUrl` 이 fileOrdrNo=5 (0 bytes) 만 가리켰던 v1.4.1 의 한계를 v1.4.2 에서 **동일 fileId 의 fileOrdrNo 전수 시도** 로 해소.
  - A-142-2018: fileOrdrNo=4 → PDF 506KB → kordoc 변환 → 528 line MD
  - T-25-2021: fileOrdrNo=4 → HWP 26KB (KOSHA portal 측 PDF 자체가 0 bytes) → kordoc HWP 변환 → 261 line MD
- `_FAILURES.json` 풍부화 + history 기록 (failures 0건). v1.4.1 시점 등록 사유와 v1.4.2 해소 사유 모두 보존.

### Fixed — drift 8건 자동 정정 (marker 적용 시 발견)

| 위치 | 기존 | 정정 |
|---|---|---|
| README.md "키 없이 동작 81개" | 81 | 85 (TOOLS_KEYLESS) |
| README.md "패키지 버전" | 1.4.1 | 1.4.2 (VERSION) |
| README-EN.md "Package version" | 1.4.1 | 1.4.2 |
| README-EN.md "API key for 6 KOSHA Live tools" | 6 | 7 (TOOLS_KEYREQ) |
| SECURITY.md "현재 안정판" | 1.4.1 | 1.4.2 |
| SECURITY.md "KOSHA Guide 메타 (1,037 노드)" | 1,037 | 1,039 (메타 표현이 본문 카운트로 잘못 박힘) |
| OPERATIONAL-ONTOLOGY.md "release" | v1.4.1 · 92 tools · 1,037 | 모두 marker 화 |
| ARCHITECTURE.md "documents/guides/" | 1,037 (메타인데 본문 카운트) | 1,039 (메타) + 1,037 (본문 — v1.4.2 회복 후 1,039 자동 갱신) 분리 |

향후 동일 종류 drift 는 pre-commit hook + CI 가 차단.

### Fixed — 외부 공개 기준 정밀 audit (README/examples/docs 전수)

추가 발견된 stale + 정정:

| 위치 | 기존 | 정정 |
|---|---|---|
| README.md "현재 상태: v1.4.1 npm publish" | 1.4.1 (두 곳) | `VERSION` marker (현재값 자동 갱신) |
| README.md "12+ source, 11개 도구" | 11 | 13 source (실측 표 row 수) |
| README.md "운영 그래프 3,336 노드 / 29,642 엣지" | stale | 1단계 2,212 + 재귀 3,369 (KOSHA 1,039 포함) / 엣지 약 29,730 (audit 와 동일 산출) |
| README.md "Control 45 / WorkActivity 41 / Hazard 38" | Control 45 stale | 50 정정 + marker |
| README.md "들어 있는 것" 섹션 8건 카운트 | 일부 stale | 모두 marker 화 |
| README-EN.md "Current Status" 표 5건 | 일부 stale | DOCID_MASTER/FORMS_*/GRAPH_*/CONTROLS marker |
| IDENTITY.md "89개 MCP 도구" | 89 | `TOOLS_TOTAL` marker (당시 92) |
| IDENTITY.md "Control 45개" | 45 | 50 marker |
| IDENTITY.md "운영 그래프 3,336/29,642" | stale | 3,369 (재귀) / 29,730 marker |
| OPERATIONAL-ONTOLOGY.md "Full graph 3,336 / edges 29,642" | stale | 3,369 / 29,730 marker + 1단계 분리 명시 |
| ARCHITECTURE.md "132 formIds" | 하드코딩 | `FORMS_TOTAL` marker (당시 132) |
| **examples/generate-tbm.sh, mcp-list-tools.sh, search-laws.sh** | **`agent-safety-oss-mcp`** (stale binary — 외부 사용자 100% 실행 실패) | **`npx -y agent-safety-oss`** (글로벌 미설치 환경도 동작) |
| examples/README.md "89개 카탈로그 출력" | stale | "현재 수: docs/INVENTORY.md 참조 — 자동 산출" |
| examples/mcp-list-tools.sh "도구 70개" 주석 | stale | INVENTORY.md 참조 안내 |

### Added — Inventory marker 키 11종 확장 + 산출 SSoT 분리

`scripts/build/inventory-data.ts` 신설 — `generate-inventory.ts` + `sync-docs.ts` 양쪽이 동일 산출 로직 사용. 신규 marker 키:

- 그래프 노드 (1단계 vs 재귀 분리): `GRAPH_TOTAL` (재귀, KOSHA 1,039 포함) · `GRAPH_TOPLEVEL` (카테고리 직속) · `GRAPH_EDGES` (audit-graph-health EDGE_PROPS 31개 와 1:1 일치)
- 핵심 그래프 객체: `GRAPH_ACTIVITIES` / `GRAPH_HAZARDS` / `GRAPH_CONTROLS`
- 법정문서: `DOCID_MASTER` (legal-duty-master.json documents 카운트)
- 양식: `FORMS_TOTAL` / `FORMS_HWP` / `FORMS_PDF` / `FORMS_XLSX` / `FORMS_MD`
- 법령: `LAW_BUNDLE_COUNT`

`countGraphEdges` 가 정규식 추정 (5,164) → audit-graph-health 와 동일한 JSON parse + EDGE_PROPS 카운트 (29,730) 로 정확화.

### Verification

- `inspect` 출력: 본문 1039 · 메타 1039 (본문 = 메타 일치) · verified 14 / partial 960 / raw 65 / failed 0
- TOOLS = CAPABILITY_REGISTRY = .jsonld = 92/92/92
- `npm run docs:check` PASS (9개 문서 정합, 0 drift)
- `npm run build` PASS (generate-inventory + sync-docs 통합)
- pre-commit hook 차단 동작 검증 (drift 시뮬레이션 → exit 1 → `docs:sync` 자동 정정)
- mcp:test:smoke 29/29 PASS

### Added

- **`node build/cli.js inspect`** — 시스템 정합성 점검의 정식 명령. `doctor` 는 v1.4.1 backward-compat alias 로 유지. (`docker inspect` / `kubectl inspect` 와 같은 "내부 구조 점검" 어휘 채택 — "doctor" 가 의료 메타포로 의미가 부정확하다는 점 정정)
- **KOSHA Guide 본문 ↔ 메타 차이 자동 검증** — `inspect` 와 `INVENTORY.md` 가 `src/ontology/graph/nodes/documents/guides/` (메타 1,039) 와 `src/ontology/kosha-guides/` (본문 1,037) 의 차이를 자동 검출하고 `_FAILURES.json` 과의 정합도 검증. drift 발생 시 ⚠️ 경고.
- **`_FAILURES.json` 풍부화** — 미수집 가이드 2건의 제목 · 카테고리 · KOSHA OneAPI 측 사유 · 사용자 우회 경로 (KOSHA 자료마당 직접 검색) 명시.
- **`scripts/audit/audit-kosha-guide-gaps.ts`** — KOSHA Guide 카테고리별 번호 시퀀스 갭 자동 audit. KOSHA 발행 패턴 진단용.

### Fixed

- README/README-EN 의 KOSHA Guide 표기 — `1,037 본문` 단일 표기에서 `본문 1,037 + 메타 1,039 (PDF 미제공 2건 명시)` 로 정정. 메타와 본문이 다르다는 사실을 정직 공개.
- `_FAILURES.json` 의 "폐기 판정" 표현 정정 — 실제는 KOSHA OneAPI 측 PDF 응답 부재 (가이드 자체는 KOSHA 자료마당에 존재). 사용자가 직접 다운로드 가능한 경로 명시.
- 미수집 가이드의 실체 기입 — A-142-2018 "디에탄올아민에 대한 작업환경측정 분석 기술지침" · T-25-2021 "시험동물 조직 전처리 및 포매 지침".

### Verification

- `inspect` 출력: 본문 1037 · 메타 1039 (본문 미수집 2: A-142-2018, T-25-2021) — `_FAILURES.json` 등록 완료
- TOOLS = CAPABILITY_REGISTRY = .jsonld = 92/92/92
- mcp:test:smoke 29/29 PASS

## [1.4.1] — 2026-05-22

자동 inventory 생성과 doctor CLI 도입으로 문서 정확도와 시스템 진단 능력 강화. 카운트·표현 정정 및 거버넌스 명시 동반.

### Added

- **`docs/INVENTORY.md` 자동 생성** (`scripts/build/generate-inventory.ts`) — `npm run build` 시 TOOLS · capability · KOSHA Guide · 법령 조문 · 양식 · 그래프 노드 카운트를 코드/데이터에서 직접 산출. 수동 표기 drift 차단.
- **`doctor` CLI 명령** (`node build/cli.js doctor`) — 시스템 무결성 진단. 도구·Capability SSoT 정합 / 그래프 노드 / KOSHA Guide 추출 품질 / 법령 동기화 stale 경고 / 사용자 환경 (profile + API 키) 점검. `--json` 옵션.
- **KOSHA Guide 추출 품질 등급 자동 분류** — verified / partial / raw (빈 `<table>` 잔재 기준).
- **`SECURITY.md §6.1`** — AgentHQ 키 vs `DATA_GO_KR_KEY` 거버넌스 차이 비교표 + 라텔웍스 relay 운영 정책 4항 (영구 보관 X / 로그 redaction / 수익화 회수 없음 / 회수 사유 한정) 명시.

### Fixed

- **KOSHA Guide 본문 카운트 정정** — 9개 문서 (`README` / `CHANGELOG` / `SECURITY` / `ARCHITECTURE` / `IDENTITY` / `DATA_SOURCES` / `CONTRIBUTING` / `README-EN` / `OPERATIONAL-ONTOLOGY`) 의 `1,039` → 실측 **`1,037`** (`kosha-guides/*.md` 직접 카운트 + `_FAILURES.json` 2건 분리). 향후 자동 inventory 가 SSoT.
- **법령 본문 표현 정확화** — `"안전관리 법령 8개 본문"` → `"8건 핵심 조문 발췌 (산안법 10조 / 시행령 3조 / 시행규칙 4조 / 기준규칙 10조 / 중처법 7조 / 중처법시행령 13조 / 위평고시 23조 전문 / 건진법 §62 영역 4조 — 합계 약 77조, 전체 법령 아님)"`. 산안법 175조 中 5.7% 만 수록임을 명시. 개별 `safety-laws/*.md` 헤더는 이미 정직 명시, 최상위 README/IDENTITY 만 정정.
- **라이선스 placeholder 도구 명시** — `search_sif_archive` / `list_construction_subtasks` 가 공공누리 변경금지 라이선스 준수용 의도된 placeholder 임을 INVENTORY 와 README 5초 진입 카드에 명시. **실질 활성 도구 90** (92 = 85 keyless + 7 키 필요 + 2 placeholder).
- **npm publish 상태 안내 갱신** — `README` / `README-EN` / `SETUP_CLAUDE_DESKTOP` 의 "publish 전 (E404)" / "not yet published" 표현 제거. publish 완료 상태 반영.

### Verification

- `mcp:test:smoke` 29/29 PASS
- `test-active-graph-authoring-loop` 25/25 PASS
- `doctor` 출력: TOOLS = CAPABILITY_REGISTRY = .jsonld = 92/92/92 · 그래프 2,212 · KOSHA 1,037 (verified 14 · partial 958 · raw 65 · failed 2) · 법령 최신 2026-05-18
- INVENTORY.md 자동 생성 (133 lines) — `npm run build` 시 자동

## [1.4.0] — 2026-05-21

**Active Graph Authoring Loop + a2ui-demo → viewer 격상 + 사용자 onboarding 이슈 5건 fix**

본 릴리스는 decision 002 (Active Graph Authoring Loop) 도입과 decision 001 (viewer 격상) 을 한 번에 묶고, 첫 publish 직후 발견된 사용자 onboarding 이슈 5건을 함께 해소한다.

### Added — Active Graph Authoring Loop (decision 002)

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
- `decisions/002-active-graph-authoring-loop.md` — decision 기록
- `.specs/in-progress/2026-05-21-active-graph-authoring-loop.md` — EARS 요구사항·디자인·태스크
- `scripts/test/test-active-graph-authoring-loop.ts` — 통합 시나리오 (daily_tbm + work_plan_excavation + 그래프 SSoT 일관성) 25 checks PASS

### Added — viewer 격상 (decision 001)

데모 위치에 있던 A2UI 폼 viewer 를 운영 자원으로 격상. 비-개발자 안전관리자가 MCP host (Claude Desktop / Codex / MCP Inspector) 없이도 브라우저에서 직접 사용 가능.

- 본문 생성 후 **MD 파일 다운로드** 버튼 (`{docId}-{YYYY-MM-DD}.md`) — 의존성 0 (Blob URL 만 사용)
- `decisions/001-a2ui-viewer-promotion.md` — decision 표준 도입
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

본질 우선순위 (사용자 황룡 2026-05-21 명시): **(1) 온톨로지 그래프 기반 작성 보조와 가이드라인 (2) 완성 문서 검토 (3) A2UI 가 작성자에게 필요한 정보를 능동적으로 가져올 수 있도록 LLM 과 연결**. decision 002 가 세 본질을 동시 충족. decision 001 의 viewer 격상은 14,000 안전관리자 (SAM 5,400사) 도달 — Agent_HQ PHILOSOPHY §9 의 Human fallback / 직원 역할 항목 해소. 이슈 5건 fix 는 npm 첫 publish 후 사용자 onboarding 마찰 직접 해소.

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
