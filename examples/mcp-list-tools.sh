#!/usr/bin/env bash
# 등록된 MCP 도구 70개 카탈로그를 JSON 으로 출력 (검증·연결 점검용).
# CI 의 smoke 단계와 동일 — 도구 수 회귀 시 즉시 감지.
set -euo pipefail

agent-safety-oss-mcp tools --json | node -e "
let s = '';
process.stdin.on('data', d => s += d);
process.stdin.on('end', () => {
  const tools = JSON.parse(s);
  console.log('총 ' + tools.length + ' 개 도구 등록됨');
  const byCategory = {};
  for (const t of tools) {
    const cat = (t.name.match(/^[a-z]+/) ?? ['etc'])[0];
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }
  console.log('카테고리별:', byCategory);
});
"
