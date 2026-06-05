"""TC-onboarding-001: GitHub repo onboarding meta snapshot (stars, forks, install command, issues tab).

Standard Webwright type:ux asset template.
- RUN_DIR resolved from script location (next_run_id or env override).
- Default: overwrite run_0 (regression reproducibility). WEBWRIGHT_FRESH=1 → new run_<N+1>.
- SSoT: ~/.claude/rules/testsuite.md (Webwright integration section).
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

# === Webwright Workspace Contract — standard RUN_DIR resolver ===
_THIS = Path(__file__).resolve()
if _THIS.parent.name.startswith("run_") and _THIS.parent.parent.name == "final_runs":
    TC_DIR = _THIS.parent.parent.parent
else:
    TC_DIR = _THIS.parent
RUNS_DIR = TC_DIR / "final_runs"


def _next_run_id() -> int:
    if not RUNS_DIR.exists():
        return 0
    nums = []
    for p in RUNS_DIR.glob("run_*"):
        suffix = p.name.split("_", 1)[1]
        if suffix.isdigit():
            nums.append(int(suffix))
    return (max(nums) + 1) if nums else 0


def _resolve_run_dir() -> Path:
    forced = os.getenv("WEBWRIGHT_RUN_ID")
    if forced is not None:
        rid = int(forced)
    elif os.getenv("WEBWRIGHT_FRESH") == "1":
        rid = _next_run_id()
    elif (RUNS_DIR / "run_0").exists():
        rid = 0
    else:
        rid = 0
    rd = RUNS_DIR / f"run_{rid}"
    rd.mkdir(parents=True, exist_ok=True)
    (rd / "screenshots").mkdir(exist_ok=True)
    return rd


RUN_DIR = _resolve_run_dir()
SHOT_DIR = RUN_DIR / "screenshots"
LOG_PATH = RUN_DIR / "final_script_log.txt"


def log(step: int, msg: str) -> None:
    line = f"step {step} action: {msg}"
    print(line)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


# === Case-specific configuration ===
URL = "https://github.com/ratelworks/agent-safety-oss"
PACKAGE_NAME = "agent-safety-oss"
VIEWPORT_HEIGHT = 1800
NAV_TIMEOUT = 30_000
SELECTOR_TIMEOUT = 15_000


def main() -> int:
    LOG_PATH.write_text("", encoding="utf-8")
    cp_status: dict[str, bool] = {}
    final_datum: dict = {
        "repo_url": URL,
        "http_status": None,
        "stars_label": None,
        "forks_label": None,
        "has_install_command": False,
        "issues_tab_url_after_click": None,
    }

    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": VIEWPORT_HEIGHT})
        page = ctx.new_page()

        # --- CP1: repo page loads (HTTP 200 + README article rendered) ---
        log(1, f"GET {URL}")
        response = page.goto(URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        status = response.status if response else 0
        final_datum["http_status"] = status

        readme_loaded = False
        try:
            page.wait_for_selector("#readme article, article.markdown-body", timeout=SELECTOR_TIMEOUT)
            readme_loaded = True
        except Exception as e:
            log(1, f"README selector wait failed: {e}")

        cp_status["CP1"] = (status == 200 and readme_loaded)
        page.screenshot(path=str(SHOT_DIR / "final_execution_1_repo_loaded.png"), full_page=False)
        log(1, f"status={status} readme_loaded={readme_loaded} -> CP1={cp_status['CP1']}")

        # --- CP2: install command present in README ---
        has_install = False
        try:
            readme_text = page.locator("#readme article, article.markdown-body").first.inner_text(timeout=SELECTOR_TIMEOUT)
            has_install = ("npx" in readme_text) and (PACKAGE_NAME in readme_text)
        except Exception as e:
            log(2, f"README inner_text failed: {e}")
        final_datum["has_install_command"] = has_install
        cp_status["CP2"] = has_install

        if has_install:
            page.evaluate("""() => {
                const article = document.querySelector('#readme article') || document.querySelector('article.markdown-body');
                if (!article) return;
                const codes = article.querySelectorAll('code, pre');
                for (const el of codes) {
                    if (el.textContent && el.textContent.includes('npx') && el.textContent.includes('agent-safety-oss')) {
                        el.scrollIntoView({ block: 'center' });
                        return;
                    }
                }
            }""")
            page.wait_for_timeout(500)
        page.screenshot(path=str(SHOT_DIR / "final_execution_2_install_command_visible.png"), full_page=False)
        log(2, f"has_install_command={has_install} -> CP2={cp_status['CP2']}")

        # --- CP3: activity counters visible (stars + forks) ---
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(300)

        stars_label = None
        forks_label = None
        try:
            stars_label = page.locator("#repo-stars-counter-star").first.inner_text(timeout=SELECTOR_TIMEOUT)
            forks_label = page.locator("#repo-network-counter").first.inner_text(timeout=SELECTOR_TIMEOUT)
        except Exception as e:
            log(3, f"counter inner_text failed: {e}")

        final_datum["stars_label"] = stars_label
        final_datum["forks_label"] = forks_label
        cp_status["CP3"] = bool(stars_label is not None and forks_label is not None)
        page.screenshot(path=str(SHOT_DIR / "final_execution_3_counters_visible.png"), full_page=False)
        log(3, f"stars={stars_label!r} forks={forks_label!r} -> CP3={cp_status['CP3']}")

        # --- CP4: Issues tab reachable ---
        # GitHub uses Turbo/PJAX; click alone doesn't always block until URL changes.
        # Use expect_navigation context to wait until the URL actually matches /issues.
        try:
            with page.expect_navigation(url=lambda u: "/issues" in u, timeout=NAV_TIMEOUT):
                page.click("#issues-tab", timeout=SELECTOR_TIMEOUT)
            current_url = page.url
            final_datum["issues_tab_url_after_click"] = current_url
            cp_status["CP4"] = "/issues" in current_url
        except Exception as e:
            log(4, f"issues-tab navigation failed: {e}")
            final_datum["issues_tab_url_after_click"] = page.url
            cp_status["CP4"] = "/issues" in page.url
        page.screenshot(path=str(SHOT_DIR / "final_execution_4_issues_tab.png"), full_page=False)
        log(4, f"after_click_url={final_datum['issues_tab_url_after_click']} -> CP4={cp_status['CP4']}")

        browser.close()

    log(99, f"CP_STATUS {cp_status}")
    log(100, f"FINAL_DATUM {final_datum}")

    print("\n=== FINAL ===")
    for cp, ok in cp_status.items():
        print(f"  {cp}: {'PASS' if ok else 'FAIL'}")
    print(f"final_datum: {final_datum}")
    print(f"run_dir: {RUN_DIR}")

    return 0 if cp_status and all(cp_status.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
