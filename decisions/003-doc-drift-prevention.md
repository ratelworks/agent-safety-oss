---
id: 003
status: accepted
date: 2026-05-23
deciders: 황룡, Claude
tags: [drift, inventory, docs, governance]
---

# 003. README/문서 ↔ 코드 drift 구조적 차단 — INVENTORY marker + sync-docs + docs-check

## Context

agent-safety-oss 는 외부 평가/사용자 onboarding 마다 README · CHANGELOG · SECURITY · ARCHITECTURE · IDENTITY · DATA_SOURCES · CONTRIBUTING · README-EN · OPERATIONAL-ONTOLOGY 9 개 문서의 카운트가 코드와 어긋나는 drift 가 반복 발생했다.

대표 사례:
- v1.4.1 fix 항목 중 단일 항목이 "9 개 문서의 KOSHA Guide 본문 `1,039` → 실측 `1,037` 정정". 9 곳에 수동으로 박힌 동일 숫자.
- v1.4.0 release 직후에도 92 도구 / 90 활성 표기 mix-up 으로 사용자 onboarding 5 건 이슈 동시 발생.
- v1.3.1 doc-sync HIGH 1 (README badge 버전 어긋남) 별도 hotfix 커밋.

v1.4.1 에서 `docs/INVENTORY.md` 를 `npm run build` 시 `scripts/build/generate-inventory.ts` 가 자동 생성하도록 SSoT 1 층은 확보했다. 그러나 README 등 9 개 문서의 본문은 여전히 사람이 직접 숫자를 박는다 — 동일 drift 가 재발할 수 있다.

## Decision

**3-Layer Defense — Marker + Sync + Check.**

### L1. SSoT (이미 있음)

- `docs/INVENTORY.md` 가 `npm run build` 시 코드/데이터에서 직접 카운트 산출.
- 모든 카운트의 단일 진원지 (Single Source of Truth).

### L2. Marker + sync-docs (이번 decision 신설)

각 문서의 카운트 위치에 다음 형태의 marker 를 삽입한다:

```markdown
**KOSHA Guide 본문 <!-- INV:KOSHA_BODY -->1,037<!-- /INV:KOSHA_BODY -->건**
```

`scripts/build/sync-docs.ts` 가 `npm run build` 의 INVENTORY 생성 직후에 실행되어, INVENTORY 산출값으로 9 개 문서의 marker 영역을 자동 갱신한다. 사람이 직접 숫자를 박을 필요가 없다.

지원 marker 키:
- `KOSHA_BODY` · `KOSHA_META` · `KOSHA_FAILURES`
- `TOOLS_TOTAL` · `TOOLS_KEYLESS` · `TOOLS_KEYREQ` · `TOOLS_PLACEHOLDER` · `TOOLS_ACTIVE`
- `LAW_LAST_SYNC` · `LAW_ARTICLES`
- `GRAPH_TOTAL` · `DOCUMENTS_TOTAL`
- `VERSION` (package.json 의 단일 진원지)

포맷 옵션:
- 기본: 천 단위 콤마 (`1,037`). 숫자 형식이 아닌 키 (`LAW_LAST_SYNC`) 는 raw.
- shields.io badge URL 안의 숫자는 별도 정규식 갱신 — marker 가 URL 안에 들어가면 파싱 깨짐.

### L3. docs-check (이번 decision 신설)

`scripts/check/docs-check.ts` 가 marker 영역의 현재 값과 INVENTORY 산출값을 비교. 불일치 시 exit 1.

발화 지점:
- `npm test` (개발 중)
- `.husky/pre-commit` (commit 차단)
- `.github/workflows/*.yml` (CI 강제)

`--fix` 옵션으로 자동 정정 모드도 제공.

## Consequences

### Positive

- 9 개 문서의 drift 100% 차단 (수동 편집 없이 INVENTORY 가 갱신되면 자동 전파).
- 외부 리뷰어 / 신규 기여자가 보는 첫 문서가 항상 코드와 일치 — 신뢰 회복.
- v1.4.1 의 "9 곳 동일 숫자 수동 정정" 같은 hotfix 가 영구 제거.

### Negative

- README · CHANGELOG 등 본문에 `<!-- INV:... -->` 가 보임. 사람이 markdown 소스를 볼 때 가독성 일부 손상. (렌더링은 영향 없음 — HTML comment.)
- marker 키가 INVENTORY 산출 항목과 동기화돼야 한다. 신규 키 추가 시 양쪽 모두 갱신 필요.
- pre-commit hook 우회 (`--no-verify`) 또는 husky 미설치 환경에서는 L3 가 작동 안 함. CI 가 최종 방어선.

## Alternatives Considered

1. **handlebars/mustache 템플릿** — README 를 `.tmpl.md` 로 두고 빌드 시 렌더링.
   - 단점: github.com 의 README.md 렌더링은 raw 파일을 쓰기 때문에 .tmpl 은 무용. 결국 산출된 README.md 를 다시 커밋해야 함. marker 방식과 동일한 외형이지만 별도 파일 관리 부담.

2. **JSON 참조 링크** — README 에 직접 숫자 박지 말고 "[INVENTORY 참조]" 링크만.
   - 단점: 외부 사용자가 README 첫 화면에서 핵심 카운트를 즉시 못 봄. onboarding 마찰.

3. **수동 작성 유지 + 더 강한 CI 검증** — INVENTORY 가 SSoT 라는 점만 CI 가 강제, 수동 정정 부담은 그대로.
   - 단점: drift 발생 시 차단만 되지 자동 정정 안 됨. fix PR 부담 그대로.

4. **이번 결정 (L1 + L2 + L3)** ✅
   - 자동 갱신 + 자동 검증의 결합. drift 발생 자체를 차단.

## References

- v1.4.1 CHANGELOG (외부 리뷰 drift 일괄 해소 — 본 decision 의 직접 동기)
- `scripts/build/generate-inventory.ts` (L1)
- `scripts/build/sync-docs.ts` (L2, 본 decision 로 신설)
- `scripts/check/docs-check.ts` (L3, 본 decision 로 신설)
