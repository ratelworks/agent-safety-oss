# Suite: onboarding (agent-safety-oss 첫 진입 온보딩 회귀)

> **목적**: 첫 방문 안전관리자의 GitHub repo 온보딩 meta 신호(설치 명령·활동 지표·Issues 채널)를 회귀로 고정. README '5초 진입' 약속과 실제 UX의 불일치를 잡는다.
> **소유 모듈**: `README.md`(설치 명령 가시성) · GitHub repo meta(stars/forks/issues 카운터·탭)
> **type**: ux
> **실행 모델**: Webwright 재실행 — `~/.claude/scripts/webwright-python tests/ux/{TC-id}/final_runs/run_0/final_script.py`. PASS = exit 0 + 모든 CP 스크린샷 생성 + `final_script_log.txt`의 final datum이 `plan.md` ground truth와 매칭.

## Cases

```yaml
id: TC-onboarding-001
suite: onboarding
type: ux
intent: 첫 방문 안전관리자가 repo 진입 직후 설치 명령·활동 지표·Issues 채널에 도달 가능한가 (온보딩 meta 신호)
contract:
  given: 처음 방문한 안전관리자 페르소나, viewport 1280×1800, 스크롤 0
  when: 공개 GitHub repo 페이지 진입
  then: CP1 repo 200 + README article 렌더 / CP2 npx 설치명령 노출 / CP3 stars·forks 카운터 가시 / CP4 Issues 탭 도달
severity: P1
origin: dogfooding-discovery
status: active
runner: a-qa
executor: ~/.claude/scripts/webwright-python tests/ux/TC-onboarding-001/final_runs/run_0/final_script.py
created_at: 2026-05-28T16:45:00+09:00
```
