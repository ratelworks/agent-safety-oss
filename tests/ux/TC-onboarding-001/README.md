# TC-onboarding-001

## Persona
First-time visitor (안전관리자) — agent-safety-oss를 처음 접한 사용자. 안전 실무 경력은 있으나 npm/CLI 경험은 적다.

## Hypothesis
README가 'Within 5 seconds' / '5초 진입' 카드를 약속하므로, 페이지 진입 직후 첫 viewport(1280×1800, 스크롤 0)에 `npx -y agent-safety-oss ...` 설치 명령이 가시되어야 한다.

## Severity
HIGH (원본 발굴 표기: P1)

## Truth Direction
expected-behavior — 기대 동작 스냅샷(온보딩 meta 신호가 충족됨을 기록). 실행 로그상 CP1~CP4 전부 PASS, exit 0. status: active (회귀 검증 대상).

## Origin
- 발굴: UX 탐색 dogfooding 2026-05-28 (discovery_id: DGF-asof-2026-05-28-001)
- 스위트 승격: 2026-05-28 (자산 복사) — case_meta.json·README.md는 2026-06-23 표준 정합 보강

## Critical Points
- CP1: Repo main page 200 + README article 렌더
- CP2: README에 설치 명령(`npx` + 패키지명) 노출
- CP3: 공개 활동 지표(stars·forks 카운터) 가시
- CP4: Issues 탭 도달 가능

## 실행

```bash
# 표준 회귀 (재현성 확인용)
~/.claude/scripts/webwright-python tests/ux/TC-onboarding-001/final_runs/run_0/final_script.py

# 시계열 추적 (run_<N+1>/ 새로 생성)
WEBWRIGHT_FRESH=1 ~/.claude/scripts/webwright-python tests/ux/TC-onboarding-001/final_runs/run_0/final_script.py
```

자산 형식 표준: 테스트 스위트(type:ux) 규약.
