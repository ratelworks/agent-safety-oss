#!/usr/bin/env bash
# 공개 저장소 첫 화면과 Issues 이동을 재검증한다.
set -euo pipefail
BROWSER_PORT="${BROWSER_PORT:-agent-browser}"; export BROWSER_PORT  # 브라우저 명령 — 다른 도구로 돌릴 땐 BROWSER_PORT 로 바꾼다(이 스크립트는 고치지 않는다)

BASE_URL="${BASE_URL:-https://github.com/ratelworks/agent-safety-oss}"
README_SELECTOR='#readme article, article.markdown-body'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNS="$HERE/runs"
if [[ -n "${UX_RUN_ID:-}" ]]; then
  [[ "$UX_RUN_ID" =~ ^[0-9]+$ ]] || { echo 'UX_RUN_ID는 숫자여야 합니다' >&2; exit 2; }
  RUN_DIR="$RUNS/run_$UX_RUN_ID"
elif [[ "${UX_FRESH:-0}" == 1 ]]; then
  mkdir -p "$RUNS"
  RUN_ID=0
  until mkdir "$RUNS/run_$RUN_ID" 2>/dev/null; do
    [[ -d "$RUNS/run_$RUN_ID" ]] || exit 2
    RUN_ID=$((RUN_ID + 1))
  done
  RUN_DIR="$RUNS/run_$RUN_ID"
else
  RUN_DIR="$RUNS/run_0"
fi
mkdir -p "$RUN_DIR/screenshots"
LOG="$RUN_DIR/log.txt"
: > "$LOG"

SESSION="ux-onboarding-$(uuidgen)"
ab() { timeout 35 "$BROWSER_PORT" --session "$SESSION" "$@"; }
trap 'ab close >/dev/null 2>&1 || true' EXIT
text() { ab --json get text "$1" | jq -er 'if .success then .data.text else error(.error) end'; }
wait_visible() { ab wait --timeout 15000 "$1" --state visible >/dev/null; }
shot() { ab screenshot "$RUN_DIR/screenshots/$1.png" >/dev/null; }
log() { printf '%s\n' "$*" | tee -a "$LOG"; }

ab set viewport 1280 1800 >/dev/null
ab open "$BASE_URL" >/dev/null
status="$(ab --json network requests --type document | jq --arg url "$BASE_URL" '[.data.requests[] | select(.url == $url) | .status] | last // 0')"
cp1=false
if [[ "$status" == 200 ]] && wait_visible "$README_SELECTOR"; then cp1=true; fi
shot final_execution_1_repo_loaded

cp2=false
if readme="$(text "$README_SELECTOR")" && [[ "$readme" == *npx* && "$readme" == *agent-safety-oss* ]]; then
  cp2=true
  ab eval 'Array.from(document.querySelectorAll("#readme article code, article.markdown-body code, #readme article pre, article.markdown-body pre")).find(el => el.textContent.includes("npx") && el.textContent.includes("agent-safety-oss"))?.scrollIntoView({block:"center"})' >/dev/null
fi
shot final_execution_2_install_command_visible

ab eval 'window.scrollTo({top: 0, behavior: "instant"})' >/dev/null
stars_json=null forks_json=null cp3=false
# 활동 지표는 보이는 글("46 stars"·"9 forks")로 찾는다 — GitHub 의 요소 id 는 화면 개편마다 바뀐다
counts="$(ab --json eval '(() => { const find = (re) => [...document.querySelectorAll("a, span, strong")].map((e) => (e.innerText || "").trim()).find((s) => re.test(s)) ?? null; return { stars: find(/^[0-9.,]+k?\s+stars?$/i), forks: find(/^[0-9.,]+k?\s+forks?$/i) }; })()' | jq -c '.data.result // {}')"
stars="$(jq -r '.stars // empty' <<<"$counts")"
forks="$(jq -r '.forks // empty' <<<"$counts")"
if [[ -n "$stars" && -n "$forks" ]]; then
  stars_json="$(jq -n --arg value "$stars" '$value')"
  forks_json="$(jq -n --arg value "$forks" '$value')"
  cp3=true
fi
shot final_execution_3_counters_visible

# Issues 탭은 역할·이름으로 누른다(요소 id 에 기대지 않는다)
if ab find role link click --name Issues --exact >/dev/null; then
  ab wait --timeout 30000 --url '**/issues**' >/dev/null || true
fi
issues="$(ab --json get url | jq -er '.data.url')"
cp4=false
if [[ "$issues" == */issues* ]]; then cp4=true; fi
shot final_execution_4_issues_tab

log "CP_STATUS $(jq -cn --argjson a "$cp1" --argjson b "$cp2" --argjson c "$cp3" --argjson d "$cp4" '{CP1:$a, CP2:$b, CP3:$c, CP4:$d}')"
log "final: $(jq -cn --arg repo "$BASE_URL" --argjson status "$status" --argjson stars "$stars_json" --argjson forks "$forks_json" --argjson install "$cp2" --arg issues "$issues" '{repo_url:$repo, http_status:$status, stars_label:$stars, forks_label:$forks, has_install_command:$install, issues_tab_url_after_click:$issues}')"
if [[ "$cp1$cp2$cp3$cp4" == truetruetruetrue ]]; then log PASS; else log FAIL; exit 1; fi
