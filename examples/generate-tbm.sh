#!/usr/bin/env bash
# 일일 TBM(Tool-Box Meeting) 본문을 generate_safety_document 로 생성.
# draft 는 fieldKey 기반 (A2UI 폼과 동일 키). archive=false 이므로 LocalStorage 미저장.
set -euo pipefail

DATE_TIME="${1:-$(date +%Y-%m-%dT%H:%M)}"

agent-safety-oss-mcp call submit_safety_document --inputJson "$(cat <<JSON
{
  "docId": "daily_tbm",
  "draft": {
    "tbmDate": "$DATE_TIME",
    "todayWork": "예시: A동 굴착 2m 이상 작업",
    "weather": "맑음",
    "attendeeCount": 8
  },
  "archive": false
}
JSON
)" | head -60
