# TC-onboarding-001: GitHub repo onboarding meta snapshot

## Task
A first-time visitor lands on the public GitHub repo page and decides within seconds whether the project is worth trying. This case captures the meta signals that drive that decision (install command in README, activity level via stars/forks counters, and reachability of the Issues channel for feedback).

## Persona
External safety officer (Korea SME construction sector) who discovered the project via a search engine. Not a GitHub power user. Skims the page top-down. Expects an install command early in the README and wants to confirm the project is alive before investing time.

## Critical Points
- [ ] CP1: Repo main page responds 200 and renders the README article container.
- [ ] CP2: README exposes an install instruction matching the project standard (`npx` invocation containing the package name).
- [ ] CP3: Public activity counters are visible — stars counter element present, forks counter element present.
- [ ] CP4: Issues tab is reachable (navigation link clickable, lands on the issues list URL).

## Ground Truth (research-verified 2026-05-28)
- Repo URL: https://github.com/ratelworks/agent-safety-oss (HTTP 200)
- Install command standard: `npx -y agent-safety-oss` (per project README convention)
- Stable selectors (GitHub UI 2026 layout):
  - README article: `#readme article` or `article.markdown-body`
  - Stars counter: `#repo-stars-counter-star`
  - Forks counter: `#repo-network-counter`
  - Issues tab: `#issues-tab`

## Browser Config
- engine: firefox (headless)
- viewport: 1280×1800
- nav timeout: 30s
- selector timeout: 15s

## Final Datum
```
{
  "repo_url": "https://github.com/ratelworks/agent-safety-oss",
  "http_status": <int>,
  "stars_label": "<string from #repo-stars-counter-star>",
  "forks_label": "<string from #repo-network-counter>",
  "has_install_command": <bool>,
  "issues_tab_url_after_click": "<string>"
}
```

## Success Criteria
All CP1..CP4 PASS. Process exits 0. Four screenshots produced under `final_runs/run_<N>/screenshots/`:
- `final_execution_1_repo_loaded.png`
- `final_execution_2_install_command_visible.png`
- `final_execution_3_counters_visible.png`
- `final_execution_4_issues_tab.png`
