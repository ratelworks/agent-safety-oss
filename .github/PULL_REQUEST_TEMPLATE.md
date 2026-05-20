<!--
PR 제출 전:
  · CONTRIBUTING.md 의 7 게이트 충족 확인
  · `npm run typecheck && npm run check:essence && npm run check:lightweight` 통과 확인
  · CHANGELOG.md `[Unreleased]` 에 변경 요약 추가
  · PII / 시크릿 / 내부 인프라 URL 노출 없음 확인
-->

## 요약

<!-- 1-3 줄로 이 PR 이 무엇을 바꾸는가 -->

## 동기 / 배경

<!-- 어떤 문제를 해결하는가. 관련 이슈가 있으면 `Closes #123` 형식으로 -->

## 변경 유형

- [ ] 🐛 버그 수정 (동작 변경 없음)
- [ ] ✨ 신규 기능 (새 도구·노드·관계·게이트)
- [ ] 📚 문서·예제
- [ ] 🧪 테스트·게이트 보강
- [ ] 🔧 리팩토링 (외부 동작 동일)
- [ ] ⚠️ Breaking change (사용자 영향 있음)

## IDENTITY 7 게이트 자체 평가

> 모든 신규 기능 PR 은 [`docs/IDENTITY.md`](../docs/IDENTITY.md) §12 의 7 게이트를 통과해야 합니다. 버그 수정·문서·리팩토링은 영향 없는 게이트 N/A 표시 OK.

- [ ] 1. 중소 건설사 부담 X (npm 5분 / RAM <500MB / IT 인력 0)
- [ ] 2. SaaS·platform 흉내 X (가벼운 의미 계층만)
- [ ] 3. 온톨로지 기반 (그래프 노드·관계로 표현)
- [ ] 4. 한국 건설 specific (별표 4 / KOSHA / 법령)
- [ ] 5. 공공 인프라 (MIT / npm)
- [ ] 6. No-Lock-In (모델·하네스 무관, MCP 표준만 의존)
- [ ] 7. 매일 사용 가능 (현장 사이클 6 항목)

## 검증

<!-- 어떤 게이트·테스트가 통과했는지 -->

- [ ] `npm run typecheck` (src + scripts)
- [ ] `npm run check:essence` (G1-G9)
- [ ] `npm run check:lightweight` (L1-L4)
- [ ] `npm run mcp:test:smoke` 또는 영향 받는 시나리오 테스트
- [ ] (해당 시) `npm run audit:strict` / `npm run validate-shapes:strict`

## 사용자 영향

<!-- API / CLI / 도구 인터페이스 / 환경변수에 변화가 있는가. CHANGELOG `[Unreleased]` 에 어떻게 적었는가 -->

## 추가 컨텍스트

<!-- 스크린샷·trace·관련 PR·후속 작업 등 -->

## 체크리스트

- [ ] CHANGELOG.md `[Unreleased]` 갱신
- [ ] PII / 시크릿 / 내부 인프라 URL 노출 없음
- [ ] 본인 작업물에 한해 author / contributor 출처 표기 정합
- [ ] 외부 데이터 (KOSHA · 법령 · 양식) 출처와 라이선스 표기 ([`NOTICE.md`](../NOTICE.md))
