#!/usr/bin/env bash
# search_safety_laws → get_safety_law_article 체이닝 예제.
# 위험성평가 키워드로 산안법·기준규칙 매칭 후 첫 결과의 조문 본문을 그대로 출력한다.
set -euo pipefail

KEYWORD="${1:-위험성평가}"

echo "=== 1) search_safety_laws (keyword='$KEYWORD') ==="
agent-safety-oss-mcp call search_safety_laws --keyword "$KEYWORD" | head -40

echo
echo "=== 2) get_safety_law_article (산안기준규칙 §38) ==="
agent-safety-oss-mcp call get_safety_law_article \
  --inputJson '{"ref":"산안기준규칙 §38"}' | head -40
