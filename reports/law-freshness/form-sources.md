# 양식 원본 주소 점검 기록

- 점검일: 2026-11-03
- 대상: 양식 지도(`src/ontology/forms/forms-map.json`)의 출처 주소·내려받기 주소 전부, 그리고 같은 주소를 쓰는 노드·안내 문서
- 방법: 주소마다 실제 요청(리다이렉트 따라감)해 응답 코드·형식·크기 확인. 산업안전포털(portal.kosha.or.kr)은 화면 주소를 모두 200 으로 돌려주는 단일 페이지 앱이라, 메뉴 주소는 브라우저로 열어 화면 제목까지 확인했다.

## 1. 고친 주소

| 이전 주소 | 상태 | 바꾼 주소 | 쓰는 곳 |
|-----------|------|-----------|---------|
| `https://kras.kosha.or.kr` (http 포함) | 접속 거부 — KRAS 가 산업안전포털로 옮겨감 | 양식 출처: `https://portal.kosha.or.kr/kras/evaluation/risk-data` (KRAS > 위험성평가 안내 > 위험성평가 자료실) | 양식 지도 4건, 위험성평가 문서 노드 4건(최초·정기·수시·월간), 위험성평가 안내 4건, 자동 생성 양식 4건 |
| 〃 | 〃 | 평가 실시 안내: `https://portal.kosha.or.kr/kras/implement/real` (KRAS > 위험성평가 실시) | 위험성평가 방법 안내 4건(빈도·강도법, 3단계, 화학물질, 보건) |
| 〃 | 〃 | TBM: `https://portal.kosha.or.kr/kras/tbm/diary` (KRAS > 작업전 안전점검(TBM) > TBM 일지작성) | TBM 안내 1건 |
| 작업환경측정 결과 제출처 "고용노동부 전산 시스템 (kras.kosha.or.kr)" | KRAS 는 작업환경측정 제출 시스템이 아님 | 시행규칙 제188조 문구로: 시료채취를 마친 날부터 30일 이내 관할 지방고용노동관서에 결과보고서(별지 제82호)·결과표(별지 제83호) 제출, 측정기관이 측정한 경우 측정기관이 전자적 방법으로 제출 | 작업환경측정 결과 통보 노드 1건 |
| `https://www.kosha.or.kr/ebook/fcatalog/download.jsp?kd=feb&sdir=544` | 500 | 같은 전자책의 파일 이름이 붙은 내려받기 주소(`…sdir=544&fn=TBM 실행 시나리오 및 회의록 양식.pdf`, 200·PDF·56,779바이트 — 번들 파일과 크기 같음) | 양식 지도 1건(TBM 회의록) |
| `https://www.kosha.or.kr/ebook/fcatalog/download.jsp?kd=feb&sdir=612` | 500 | 같은 전자책의 파일 이름이 붙은 내려받기 주소(`…sdir=612&fn=602 공단 유해위험작업 안전작업허가 지침.pdf`, 200·1,472,334바이트 — 번들 파일과 크기 같음) | 양식 지도 9곳(안전작업허가 지침 P-94 와 붙임 허가서 5종) |
| `https://oshri.kosha.or.kr/extappKosha/kosha/guidance/` | 404 | `https://portal.kosha.or.kr/archive/resources/tech-support` (산업안전포털 > 기술지원규정(KOSHA GUIDE)) | 양식 지도 1건(밀폐공간 작업 프로그램 기술지침 H-80-2021) |

### 밀폐공간 기술지침(H-80-2021) 참고

- H-80-2021 은 현행 목록에서 **E-G-18-2026 「밀폐공간 작업프로그램 수립 및 시행에 관한 기술지원규정」**으로 바뀌었다(번들 가이드 본문에 E-G-18-2026 수록). 양식 지도 항목에 이 사실을 `note` 로 적었다.
- 번들 PDF(H-80-2021)의 내려받기 주소(`oshri.kosha.or.kr/…musculoskeletalPreventionData_A.do?mode=download…`)는 200·PDF·402,129바이트로 살아 있어 그대로 둔다. PDF 를 최신본으로 바꾸는 일은 이번 범위가 아니다.
- E-G-18-2026 원본 파일 주소(`portal.kosha.or.kr/openapi/v1/file/down/…`)는 "파일이 존재하지 않습니다"를 돌려줘 내려받기 주소로 쓰지 않았다.

## 2. 점검 결과 (고친 뒤)

양식 지도의 주소 41개(출처·내려받기 중복 제거) 모두 200 응답.

| 구분 | 개수 |
|------|-----:|
| 법제처(law.go.kr) | 11 |
| 고용노동부(moel.go.kr) | 13 |
| KOSHA(kosha.or.kr·oshri·msds·portal) | 16 |
| 기타 | 1 |

※ 200 은 서버가 응답했다는 뜻이다. 산업안전포털 화면 주소(`/kras/...`, `/archive/...`)는 브라우저로 열어 화면 제목이 해당 메뉴인 것을 확인했다(위험성평가 자료실·위험성평가 방법·TBM 일지작성·기술지원규정 메뉴 링크).
