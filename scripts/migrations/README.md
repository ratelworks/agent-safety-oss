# scripts/migrations

1회성 마이그레이션 스크립트 보존 디렉토리.

## 원칙

- 본 디렉토리 스크립트는 **이미 실행 완료**되어 결과가 그래프 노드(`src/ontology/graph/nodes/`) 또는 데이터에 흡수됨
- 재실행 시 **부작용 가능** — 파일 덮어쓰기, 중복 노드 생성, prefix 충돌
- npm scripts 등록 안 됨 (`package.json` 미참조)
- 보존 목적: history 추적 + 동일 시나리오 재현 시 참고

## 분류

| 그룹 | 스크립트 | 목적 |
|---|---|---|
| audit-fix | `audit-fix-bidirectional.ts`, `audit-fix-facet-reach.ts`, `audit-fix-final.ts` | 양방향 링크 보강, facet 도달성, penalty inverse |
| connect | `connect-orphans.ts`, `connect-orphan-hazards-and-annexes.ts` | orphan 노드 cross-reference |
| fill | `fill-coverage-gaps.ts`, `fill-hazard-descriptions.ts`, `fill-stub-doc-forms.ts` | 누락 필드 일괄 보강 |
| fix | `fix-dangling-and-add-docs.ts`, `fix-fragment-and-typos.ts`, `fix-legalbasis-inverse.ts` | dangling 참조 정정 |
| gap | `gap1-fetch-missing-kosha-guides.ts`, `gap2-fill-input-guides.ts`, `gap3-sif-patterns.ts` | KOSHA Guide 222종, inputGuide 23필드, SIF 79패턴 |
| migrate | `migrate-cycle-prefix.ts` | `cycle:` → `cyc:` prefix 마이그레이션 (911건) |
| phase | `phase-a1-*`, `phase-a2-*` | 사고문서 그래프 매핑, facet 그래프화 |
| round | `round[1-9]*` | 1차~9차 도메인 보강 (MSDS·위험성평가·환각 정정 등) |
| seed | `seed-domain-edges.ts`, `seed-domain-nodes.ts`, `seed-extra-admin-docs.ts` | 초기 노드 시드 |
| sync | `sync-reverse-edges.ts` | inverse edge 동기화 |

## 재실행 시 주의

```bash
# 그래프 백업 권장
cp -r src/ontology/graph src/ontology/graph.bak.$(date +%Y%m%d)

# 실행
npx tsx scripts/migrations/<script>.ts

# 회귀 검증 필수
npm run audit:graph-v2 && npm run audit:expand
```
