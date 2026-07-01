# Security Policy

## 보안 정책

**agent-safety-oss** 는 한국 중소 건설사의 안전관리 데이터를 다룹니다. 사용자의 사업장 정보·작업자 명단·현장 사진 등이 LocalStorage 에 저장되므로 보안은 본질적 의무입니다.

---

## 1. 지원 버전

| 버전 | 보안 패치 지원 | 비고 |
|---|:--:|---|
| 1.7.x | ✅ | 현재 안정판 (v<!-- INV:VERSION -->1.7.1<!-- /INV:VERSION -->) |
| 1.6.x | ⚠️ | 이전 안정판 (v1.6.1) — critical-only 패치 (2026-09-13 까지 3개월) |

> 차기 minor release 시 직전 버전의 critical-only 지원 기간(3개월)이 본 표에 자동 갱신됩니다.

---

## 2. 취약점 신고

보안 취약점을 발견하시면 **공개 issue 가 아닌** 다음 경로로 신고해 주세요:

- 이메일: `alphamale@ratelworks.co.kr` (제목: `[SECURITY] agent-safety-oss`)
- 연락 정보: ㈜라텔웍스 (RATEL WORKS INC., 사업자등록번호 386-87-03858)

48 시간 내 1차 회신, 7 일 내 분석 및 수정 일정 공유합니다.

---

## 3. 데이터 저장 정책

### 3.1 LocalStorage 위치

```
~/.agent-safety-oss/
├── profile.json            사업장·법인·작업자 프로파일 (PII 포함)
├── company-key.json        라텔웍스 발행 AgentHQ API 키
├── drafts/                 작성 중 양식 (PII 가능)
├── archive/                완료 양식
├── photos/{YYYY/MM/DD}/    현장사진 (사용자 PII 가능)
├── issues/                 안전 이슈
├── actions/                개선조치
├── reports/                운영 보고서
└── traces/{YYYY-MM-DD}.jsonl  PROV-O Activity (감사용)
```

### 3.2 환경변수 override

| 환경변수 | 효과 |
|---|---|
| `SAFETY_LOCAL_DIR` | LocalStorage 루트 변경 — `profile.jsonld` · `company-key.json` · `drafts/` · `documents/` · `photos/` · `issues/` · `actions/` · `reports/` · `activity.log` 모두 영향. |
| `SAFETY_TRACE_DIR` | Trace 파일 저장 위치 변경 |
| `SAFETY_TRACE_DISABLE=true` | Trace 자동 기록 비활성화 |

### 3.3 PII (개인정보) 처리

본 OSS 는 다음 PII 를 LocalStorage 에 저장합니다:

- 작업자 성명 / 직책 / 소속 (`profile.json`)
- 사업주 성명 / 사업자등록번호 (`profile.json`)
- 현장사진 (얼굴·신원 정보 포함 가능)
- 양식의 자유 입력 필드

**처리 원칙**:
- ✅ 기본 동작: 모든 데이터는 사용자 로컬에만 저장 (자동 서버 전송 없음)
- ✅ 공공 OpenAPI 중계 시: 검색어·메타만 전송 (PII 0)
- ✅ 라텔웍스 클라우드 동기화 (`sync_to_cloud`): **사용자 명시 opt-in** — `confirm: true` 호출 시에만 라텔웍스 운영 백엔드 (`PUT /api/v1/company/profile`) 로 전송됩니다. `confirm` 생략 시 preview 모드로 무엇이 어디로 전송될지 보고만 하고 전송하지 않습니다. 전송 대상 카테고리(`persons`·`sites`·`contractors`)에는 PII 가 포함될 수 있습니다.
- ✅ 파일 권한: 사용자만 읽기·쓰기 가능
- ❌ 서드파티 분석·추적 코드 미포함

### 3.4 PII·보존·삭제·마스킹 사용자 책임

**v<!-- INV:VERSION -->1.7.1<!-- /INV:VERSION --> 정합** — 본 OSS 는 데이터 영속 위치만 제공하며, 다음은 **사용자(안전관리자·현장 관리자)의 책임 영역**입니다:

| 항목 | 사용자 책임 | OSS 책임 |
|---|---|---|
| **보존 기간** | <!-- INV:DOCUMENTS_TOTAL -->19<!-- /INV:DOCUMENTS_TOTAL -->종 법정 문서의 법정 보존 (3~30년) 준수 — 사용자가 `SAFETY_LOCAL_DIR` 백업·아카이브 관리 | `*.jsonld` 노드에 `retention` 메타 명시 |
| **삭제** | 보존 만료 시 사용자가 직접 폴더 삭제 (자동 만료 삭제 없음) | 삭제 시 다른 노드와의 참조 무결성은 사용자 책임 |
| **마스킹** | 사진의 얼굴·번호판, 양식의 PII 항목 마스킹은 사용자 선택 (자동 마스킹 X) | photo metadata 의 `redaction: true` 플래그 지원만 |
| **암호화** | 디스크 암호화는 OS 수준 (macOS FileVault / Windows BitLocker / Linux LUKS) 권장 | 파일 권한 0600 (사용자만 읽기·쓰기) — `secure-fs.ts` |
| **감사 로그** | `SAFETY_LOCAL_DIR/traces/` 에 PROV-O 형식 자동 기록 (`SAFETY_TRACE_DISABLE=true` 로 끌 수 있음) | 도구 호출 매번 trace 1줄 자동 append |
| **백업** | 사용자 책임 (예: 회사 NAS · GitHub Private Repo · 클라우드 sync 도구) | 백업 자동화 없음 |
| **공유 디바이스** | 동일 사용자 PC 가정. 다중 사용자 격리 시 `SAFETY_LOCAL_DIR` 별도 지정 권장 | 별도 사용자 인증 없음 |

**고위험 PII 처리 권고**:
- 현장사진은 신원·번호판이 식별 가능한 경우 사용자가 모자이크 후 저장
- 작업자 주민등록번호·전화번호·주소 등은 본 OSS 기본 양식에 입력 필드 없음. 사용자가 자유 입력으로 추가하면 본인 책임
- 협력업체 정보는 사용자 동의 후 저장. 라텔웍스 클라우드 동기화는 명시 opt-in
- 디바이스 분실 시 PII 노출 위험. OS 수준 디스크 암호화 + 화면 잠금 필수

**감사 로그 (traces)**:
- 위치: `$SAFETY_LOCAL_DIR/traces/{YYYY-MM-DD}.jsonl`
- 형식: PROV-O (Activity·Agent·Entity)
- 보존: 사용자 책임 (자동 삭제 없음)
- 비활성화: `SAFETY_TRACE_DISABLE=true` 환경 변수

---

## 4. 외부 통신

본 OSS 는 다음 외부 서버와 통신합니다:

| 서버 | 용도 | 전송 정보 | PII |
|---|---|---|:--:|
| `apis.data.go.kr/B552468/*` | 공공 OpenAPI (직접 호출 시) | 검색어·페이지 / `serviceKey` (사용자 키) | ❌ |
| `agentsafetyrelay-622699652854.asia-northeast3.run.app` | 라텔웍스 KOSHA Relay (기본) | 검색어·페이지 / `AGENTHQ_API_KEY` | ❌ |
| `agent-safety-oss-622699652854.asia-northeast3.run.app/api/v1/company/profile` (GET) | `link_company_key` 기업 프로파일 fetch | `AGENTHQ_API_KEY` 만 | ❌ |
| `agent-safety-oss-622699652854.asia-northeast3.run.app/api/v1/company/profile` (PUT) | `sync_to_cloud` SSoT 업로드 — **`confirm: true` opt-in 시에만** | sites / projects / persons / equipments / contractors (사용자 동의 시 PII 포함) | ⚠️ opt-in |
| `portal.kosha.or.kr` | KOSHA 안전보건자료실 (비로그인) | 검색어 | ❌ |
| `www.law.go.kr` | 법제처 (선택, 미배포) | — | ❌ |

기본 동작에서는 PII 가 외부로 전송되지 않습니다. `sync_to_cloud` 도구는 사용자가 명시적으로 `confirm: true` 를 지정한 경우에만 PII 가 포함된 SSoT 를 라텔웍스 운영 클라우드로 업로드합니다. 검색어가 PII 일 가능성은 사용자 입력에 한정 (예: 작업자 성명을 직접 검색).

---

## 5. 의존성 보안

### 5.1 npm 의존성

```bash
npm audit
```

`npm audit` 자체는 `prepublishOnly` 에 포함되지 않습니다. CI workflow (`.github/workflows/ci.yml`) 의 `npm audit --audit-level=high` 단계가 PR / push 시 자동 차단합니다.

### 5.2 KOSHA OneAPI

라텔웍스 KOSHA Relay 는 단일 운영 키 (`DATA_GO_KR_KEY`) 로 외부 사용자 진입장벽을 해소합니다. 키는 Cloud Run 환경변수에만 존재하며 npm 패키지에 포함되지 않습니다.

---

## 6. 인증 요구사항

| 도구 그룹 | 인증 |
|---|---|
| 그래프 조회 (get_kosha_guide_md·get_safety_law_article 등) | **불필요** |
| 공공 OpenAPI (search_msds 등) | AgentHQ API 키 (라텔웍스 무료 발급) 또는 사용자 자체 `DATA_GO_KR_KEY` |
| Site profile 조작 (register_site·register_person 등) | LocalStorage (사용자 로컬, 외부 X) |

### 6.1 키 거버넌스 차이 — AgentHQ vs `DATA_GO_KR_KEY` (외부 리뷰 P2, 2026-05-22)

KOSHA OneAPI <!-- INV:TOOLS_KEYREQ -->7<!-- /INV:TOOLS_KEYREQ -->개 도구는 두 가지 키 경로 중 하나를 선택할 수 있습니다. 두 경로의 거버넌스 차이는 다음과 같습니다.

| 항목 | **AgentHQ API 키** (라텔웍스 발행, 기본 권장) | **`DATA_GO_KR_KEY`** (사용자 직접 발급) |
|---|---|---|
| 발급 경로 | 라텔웍스에 무료 발급 신청 (`alphamale@ratelworks.co.kr`) | data.go.kr 가입 → 활용신청 |
| 호출 경로 | `agentsafetyrelay-...run.app` (라텔웍스 Cloud Run relay) → KOSHA | 사용자 → KOSHA 직접 |
| 라텔웍스 관측 가능 항목 | **호출 시각·도구명·파라미터·응답 byte 크기** (relay 액세스 로그) | **없음** (라텔웍스 미경유) |
| PII 노출 | 호출 파라미터에 사업자번호·성명 포함 시 라텔웍스가 ephemeral 로 통과 — 영구 저장 X, 외부 전송 X | 라텔웍스 미경유 |
| Rate limit | **60 req/min/IP** (relay 단일 키 보호용 — 라텔웍스 부담분) | 사용자 키의 OpenAPI 호출 한도 (data.go.kr 정책, 보통 일 1,000~10,000건) |
| 키 수명 | 라텔웍스가 회수 가능 (불법 사용·라이선스 위반 등) | 사용자 본인 키 — 라텔웍스 회수 불가 |
| Production 안정성 | relay 가용성 의존 | data.go.kr 가용성 의존 |
| 익명성 | 라텔웍스가 호출 패턴 관측 가능 | 라텔웍스 미관측 |
| 비용 | 무료 (라텔웍스 부담) | 무료 (data.go.kr 정책) |
| 추천 use case | 학습·평가·소규모 production·익명성 비중요 | 대규모 production·라텔웍스 관측 회피 필요·키 자율 관리 |

**라텔웍스 측 약속** (relay 운영 정책):
1. 호출 파라미터·응답 본문은 **로그·저장소에 영구 보관하지 않음** (액세스 로그만 7일 보존)
2. 호출 메타데이터 (시각·도구명·byte 크기) 는 **로그 보안 보호** + 라텔웍스 직원 익명화 후 집계만 사용
3. 사용자 식별 정보 (사업자번호·성명·연락처 등 PII) 는 **로그 redaction** 처리
4. 키 회수 사유는 라이선스 위반·법적 요청·악용 의심에 한정. **수익화 목적 회수 없음** — 키는 무상 제공.

**사용자 선택권**:
- 가벼운 사용 → AgentHQ 키 (편의성)
- 라텔웍스 관측 회피 필요 → `DATA_GO_KR_KEY` (익명성)
- 두 키 모두 설정 시 → AgentHQ 우선 (relay 경유)

키 변경: `register_company_key` MCP 도구 또는 `~/.agent-safety-oss/company-key.json` 직접 편집.

---

## 7. 위협 모델

본 OSS 가 방어하는 위협:

- ✅ **PII 자동 외부 전송 차단**: 기본 동작은 로컬 저장. `sync_to_cloud` 는 명시적 `confirm: true` opt-in 시에만 라텔웍스 클라우드로 PII 를 업로드하며, 그 외 경로에서는 PII 가 외부로 나가지 않습니다.
- ✅ **API 키 노출 차단**: serviceKey 로그·캐시 키에서 redact. MCP `get_company_info` 응답에는 AgentHQ API 키 원문 대신 `ASF_****_xxxx` 형태의 마스킹 값만 노출합니다.
- ✅ **XML/JSON injection**: `processEntities: false` (XXE 방어)
- ✅ **응답 폭주**: `MAX_RESPONSE_BYTES = 10 MiB` 제한
- ✅ **Rate limit 폭주**: KOSHA Relay 60 req/min/IP

본 OSS 가 방어하지 못하는 위협 (사용자 책임):

- ❌ 사용자 PC 자체 침해 (LocalStorage 파일 접근)
- ❌ 사용자가 외부 클라우드 (Drive 등) 에 사진을 업로드한 경우
- ❌ 사용자가 그래프에 등록한 정보의 정확성

---

## 8. 보안 게이트

`prepublishOnly` 에서 자동 실행 (`package.json` 정의):

```bash
npm run build                # tsc + ontology assets copy
npm run check:essence        # essence gate 9 (그래프·인용·환각)
npm run check:lightweight    # 경량 가드레일 4 (크기·RAM·latency)
npm run verify-all           # JSON-LD/SHACL/KOSHA/p0/audit 10개 통합
npm run form-conformance     # 94 docId 양식 정합
npm run quality-regression   # 품질 회귀 (10점 만점 시나리오)
```

CI workflow (`.github/workflows/ci.yml`) 는 별도로 `npm audit --audit-level=high`, `typecheck:src` → `build` → `typecheck:scripts`, SHACL strict 등 추가 게이트를 PR/push 시점에 차단합니다.

---

## 9. 라이선스 / 저작권

| 자료 | 라이선스 |
|---|---|
| 본 OSS 코드 | MIT |
| 산안법·시행령·시행규칙·기준규칙·중처법·고시 (`src/ontology/safety-laws/`) | 저작권법 §7 비보호 (자유 인용) |
| KOSHA Guide 메타 (<!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> 노드) | 공공누리 출처표시·변경금지 (`_meta.licenseHint`) |
| KOSHA Guide 본문 (<!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY -->건 번들) | 공공누리 출처표시·변경금지 (npm 패키지 내장, `get_kosha_guide_md` 도구로 offline 조회) |
| 정부 양식 (`src/ontology/forms/*.pdf|.hwp`) | 행정안전부·KOSHA 발행 (출처 표기) |

---

## 10. 책임 한계

본 OSS 는 **법적 강제 효력이 없는 검색·인용·작성 보조 도구**입니다. 다음은 사용자 책임:

- 작성된 양식의 법적 검토·승인
- 정부 제출 책임
- 현장 안전 의사결정
- 사고 발생 시 책임

LLM 의 자동 작성 결과는 항상 **담당 안전관리자가 검토 후 승인**해야 합니다 (IDENTITY.md §6 — "Human = 승인·수정·책임 판단").

---

문의: `alphamale@ratelworks.co.kr` · ㈜라텔웍스
