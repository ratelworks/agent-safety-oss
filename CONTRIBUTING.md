# Contributing to agent-safety-oss

기여 환영합니다. 본 OSS 의 정체성·구조에 부합하는 기여를 받아들이기 위해 다음 가이드를 따라 주세요.

---

## 1. 정체성 정합 (모든 기여의 1차 검증선)

기여 전 [`docs/IDENTITY.md`](./docs/IDENTITY.md) 를 반드시 읽어 주세요. 모든 PR 은 다음 게이트를 통과해야 머지됩니다:

```
1. 중소 건설사 부담 X        (npm 5분 / RAM <500MB / IT 인력 0)
2. SaaS·platform 흉내 X      (가벼운 의미 계층만)
3. 온톨로지 기반              (그래프 노드·관계로 표현)
4. 한국 건설 specific        (별표 4 / KOSHA / 법령)
5. 공공 인프라                (MIT / npm)
6. No-Lock-In                 (모델·하네스 무관, MCP 표준만 의존)
7. 매일 사용 가능             (현장 사이클 6 항목 통과)
```

---

## 2. 기여 영역

### 2.1 환영하는 기여

- 그래프 노드 보강 (Activity·Hazard·Control·Article·KOSHA Guide)
- 정체성 SSoT 13 객체에 부합하는 클래스·관계 강화
- KOSHA OneAPI · 법제처 · 다른 공공 API 통합
- 다국어 (한국어/영어 외 — 외국인 노동자 13개국어)
- LLM 환각 차단 강화 (verify_safety_basis 보강)
- 사용자 친화 UI (A2UI Form Schema)

### 2.2 거부되는 기여 (정체성 충돌)

- ❌ 자체 LLM 또는 AI 모델 통합 (No-Lock-In 위반)
- ❌ 무거운 platform / SaaS 기능 (Workshop UI · Pipeline Builder 등)
- ❌ 한국 건설 도메인 외 일반 안전관리 (도메인 분리 원칙)
- ⚠️ 본문 재배포 — KOSHA Guide 본문은 1,037건 번들 포함 (`get_kosha_guide_md` 로 offline 조회). 정부 양식 원본 HWP/PDF/XLSX 는 공공누리 라이선스에 따라 선별 번들 (출처 표기, 사용자 편의 우선). 
- ❌ 의사결정 자동화 (판단은 사람·LLM)

---

## 3. 개발 환경 설정

```bash
# 1. clone + install
git clone https://github.com/ratelworks/agent-safety-oss.git
cd agent-safety-oss
npm install

# 2. 빌드
npm run build

# 3. essence gate 실행
npm run check:essence
npm run check:lightweight

# 4. 도구 호출 시뮬
npm run mcp:tools                # 89 Tool 목록
node build/cli.js call get_measures_by_risk --inputJson '{"hazardId":"hazard:fall_from_height"}'

# 5. MCP Inspector
npm run mcp:inspect
```

### 3.1 환경변수

```bash
# A. 라텔웍스 발행 키 (즉시 발급)
# AGENTHQ_API_KEY=<라텔웍스 발행 키>

# B. 또는 자체 data.go.kr 키 (즉시 신청)
# DATA_GO_KR_KEY=<발급 키>

# LocalStorage 위치 변경
# SAFETY_LOCAL_DIR=/path/to/storage
```

---

## 4. 코딩 규칙

### 4.1 언어 / 환경

- **언어**: TypeScript (ES Module)
- **Node**: >= 20.19 (package.json `engines.node` SSoT, CI matrix 20.19 + 22.x)
- **빌드**: `tsc` + `tsx scripts/build/copy-ontology-assets.ts`
- **linter**: typecheck strict (`npm run typecheck`)

### 4.2 그래프 노드 (`src/ontology/graph/nodes/{category}/*.jsonld`)

- 모든 노드: `@context`, `@id`, `@type` 필수
- 다국어: `label`, `description` 한국어 우선 + 영문 권장
- IRI: `safety:` (안전 specific) 또는 `cc:` (건설 도메인 공통)
- PROV-O: `wasGeneratedBy` / `generatedAtTime` / `wasDerivedFrom` / `hadPrimarySource` / `contentHash` 필수

### 4.3 MCP Tool (`src/tools/*.ts`)

- `ToolDefinition` interface 준수
- `zod inputSchema` 필수
- `structuredContent` 에 그래프 IRI + label + 사슬 메타 포함
- `text` 에 안전관리자 친화 markdown
- 한국어 description (LLM 모델명 박지 않음 — No-Lock-In)
- LLM 환각 차단: 그래프 fact 만 인용, 외부 데이터 X

### 4.4 SHACL Shape (`src/ontology/skeleton/shapes.ttl` + `shapes/safety-shapes.ttl`)

- `sh:closed false` (확장 친화)
- `sh:message` 한국어
- 새 클래스 추가 시 NodeShape 동시 추가

---

## 5. PR 절차

### 5.1 PR 작성

```bash
# 새 브랜치
git checkout -b feat/your-feature

# 변경
git commit -m "feat(scope): 한국어 설명

상세 설명...

Continues: <기준 commit hash>
Work-Scope: agent-safety-oss

Co-Authored-By: <기여자>"
```

### 5.2 자동 검증 (CI — `.github/workflows/ci.yml` SSoT)

PR 머지 전 다음이 자동 실행됩니다 (Node matrix 20.19 + 22.x):

```
npm audit --audit-level=high   # high+ 취약점 회귀 차단
npm run typecheck              # TypeScript 0 에러
npm run build                  # tsc + ontology asset copy
npm run verify-graph           # IRI 형식 / 도메인 외 참조 / JSON-LD expand
npm run validate-shapes:strict # SHACL declarative 룰
npm run audit:strict           # 그래프 건강성 (dangling / 19종 추론 / DAG / 매트릭스 밀도)
node build/cli.js tools --json # 도구 수 ≥89 게이트
# Smoke 6종: search_safety_laws / get_safety_law_article / analyze_construction_work_risks /
#            compile_safety_references / verify_safety_basis / npm pack dry-run
```

로컬 사전 검증 (CI 와 동일 경로):
```bash
tsx scripts/dev/skeleton-gates.ts        # skeleton 6/6
tsx scripts/dev/skeleton-graph-check.ts  # graph 6/6
```

### 5.3 PR 체크리스트

- [ ] IDENTITY.md 7 게이트 통과
- [ ] 해당 변경의 dogfooding 시나리오 1+ 추가
- [ ] 한국어 description / label / comment
- [ ] 환각 마커 0 (`HALLUCINATION_PATTERNS`)
- [ ] essence gate 9/9
- [ ] 그래프 변경 시 graph-check 6/6 유지

---

## 6. 커밋 메시지 규칙

```
<type>(<scope>): <한국어 요약>

<상세 설명>

Continues: <hash>
Session-Id: <세션 ID>
Agent-Source: <claude-code | a-codex | manual>
Work-Scope: agent-safety-oss

Co-Authored-By: <이름>
```

`<type>`: feat / fix / docs / chore / refactor / test
`<scope>`: agent-safety-oss 또는 세부 모듈

---

## 7. 라이선스

본 OSS 에 기여하는 것은 [MIT 라이선스](./LICENSE) 하에 코드를 배포하는 것에 동의하는 것입니다.

KOSHA / 법령 / 정부 양식 등 외부 자료 라이선스는 [`SECURITY.md` §9](./SECURITY.md) 참조.

---

## 8. 행동 강령

- 한국어·영어 모두 환영
- 안전관리는 사람의 생명에 직결됩니다. 정확성·검증을 우선
- 정치적·종교적 논쟁 자제
- LLM 환각·잘못된 인용을 발견하면 즉시 issue 보고

---

문의: `alphamale@ratelworks.co.kr` · ㈜라텔웍스 · GitHub Issues
