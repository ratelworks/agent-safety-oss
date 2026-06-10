# Data Sources

이 문서는 현재 코드가 사용하는 데이터 출처와 사용 원칙을 정리한다. API별 정확한 endpoint와 파라미터는 [API-SPECS.md](./API-SPECS.md)를 기준으로 한다.

## 데이터 원칙

1. 안전관리자와 현장소장이 제출하거나 보관할 문서에는 법령 근거와 기술 권고를 구분한다.
2. 법령 본문은 번들 자료를 우선 사용한다.
3. KOSHA Guide, 재해사례, MSDS, 안전보건자료, 보호구 인증은 출처와 등급을 표시한다.
4. KOSHA 원문 자료는 임의 재가공·대량 재배포하지 않는다. **KOSHA Guide 본문은 <!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY -->건 번들** (kordoc 추출 MD, 공공누리 출처표시·변경금지 명시. `get_kosha_guide_md` 도구로 offline·keyless 조회). 정부 양식 원본 HWP/PDF/XLSX 는 공공누리 라이선스에 따라 선별 번들 (출처 표기, 사용자 편의 우선).
5. LLM이 법령 근거를 생성하지 않도록 graph IRI와 evidence metadata를 함께 반환한다.

## 주요 출처

| 영역 | 출처 | 사용 도구 | 근거 등급 |
|---|---|---|---|
| 산업안전보건법령 | 법제처 국가법령정보센터, 고용노동부 | `search_safety_laws`, `get_safety_law_article`, `list_core_safety_laws` | mandatory |
| 위험성평가 고시 | 고용노동부 | `get_risk_assessment_schema`, `get_kras_method`, `choose_assessment_method` | mandatory/recommended |
| KOSHA Guide | 한국산업안전보건공단 | `get_kosha_guide_md` (번들 <!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY -->건) | recommended |
| KOSHA 안전보건자료실 | KOSHA portal24 | `search_kosha_archive`, `get_kosha_archive_files` | reference |
| 재해사례 | KOSHA OpenAPI | `search_accident_cases`, `get_accident_case_attachments` | reference |
| 건설업 중대재해 | KOSHA OpenAPI | `search_construction_fatal_accidents`, `search_all_fatal_accidents` | reference |
| MSDS | KOSHA OpenAPI | `search_msds` | reference |
| 보호구 인증 | KOSHA OpenAPI | `search_ppe_certification` | reference |
| 법정문서 마스터 | 프로젝트 curated graph | `assess_my_obligations`, `list_safety_documents_by_cycle`, `get_safety_document_guide` | mandatory metadata |
| 양식 인덱스 | 고용노동부, 법제처, KOSHA, 자동 생성 양식 | `get_official_form`, `list_downloadable_forms` | form/reference |

## 번들 데이터

```text
src/ontology/safety-laws/*.md       법령 본문 <!-- INV:LAW_BUNDLE_COUNT -->10<!-- /INV:LAW_BUNDLE_COUNT -->개 (합계 약 <!-- INV:LAW_ARTICLES -->79<!-- /INV:LAW_ARTICLES -->조)
src/ontology/legal-duty-master.json <!-- INV:DOCID_MASTER -->94<!-- /INV:DOCID_MASTER --> docId 마스터
src/ontology/forms/forms-map.json   <!-- INV:FORMS_TOTAL -->132<!-- /INV:FORMS_TOTAL --> formId 인덱스
src/ontology/forms/auto/*.md        <!-- INV:FORMS_MD -->94<!-- /INV:FORMS_MD --> 자동 생성 양식
src/ontology/guides/*.json          <!-- INV:DOCUMENTS_TOTAL -->19<!-- /INV:DOCUMENTS_TOTAL --> 풀가이드
src/ontology/graph/nodes/**         그래프 노드
src/ontology/kras-methods/*.md      KRAS 방법론
```

## Live API

공공 OpenAPI는 다음 경우에 사용한다.

- 최신 재해사례 검색
- KOSHA Guide 본문 조회
- MSDS 원문 섹션 조회
- 안전보건자료실 자료 검색
- 보호구 인증 조회

일반 사용자는 선택적으로 `AGENTHQ_API_KEY`를 설정한다. 운영팀 또는 자체 중계를 운영하는 조직만 `DATA_GO_KR_KEY`를 직접 설정한다.

## 공공 OpenAPI source 매핑 (13 source)

본 OSS 가 그래프 작성 보조에 통합한 공공 데이터 source 와 호출 도구의 매핑이다.

| Source | 영역 | 호출 도구 |
|---|---|---|
| KOSHA OneAPI 15121001 / 15121008 | 재해사례 + 첨부 | `search_accident_cases` · `get_accident_case_attachments` |
| KOSHA OneAPI 15133935 | 건설 사망사고 통계 | `search_construction_fatal_accidents` |
| KOSHA OneAPI 15119137 | 전 업종 사망사고 | `search_all_fatal_accidents` |
| KOSHA OneAPI 15139398 | 안전보건자료실 (외국인 13개국어) | `search_safety_materials` · `get_foreign_worker_resource_links` |
| KOSHA OneAPI 15001197 | MSDS (화학물질안전) | `search_msds` |
| KOSHA OneAPI 15139497 | 보호구 안전인증 (KCs) | `search_ppe_certification` |
| KOSHA OneAPI 15123696 | 안전보건법령 스마트검색 (AI 유사어) | `search_safety_law_smart` |
| KOSHA OneAPI 15144147 | KOSHA Guide PDF 다운로드 (현재 번들 <!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY -->) | (offline 번들로 대체) |
| KOSHA OneAPI 15087828 | 건설 공종 분류 (구조 분류) | `analyze_construction_work_risks` (fallback) |
| KOSHA OneAPI 15116595 | 공종 ↔ KOSHA Guide 매핑 | `analyze_construction_work_risks` (fallback) |
| KOSHA OneAPI 15140383 | SIF 아카이브 (사망 고위험요인) | `search_sif_archive` |
| KOSHA portal24 | 안전보건자료실 8,976건 (OPS·동영상·교안) | `search_kosha_archive` · `list_kosha_archive_facets` · `get_kosha_archive_files` |
| 법제처 OpenAPI (law.go.kr) | 안전관리 법령 <!-- INV:LAW_BUNDLE_COUNT -->10<!-- /INV:LAW_BUNDLE_COUNT -->건 핵심 조문 발췌 (전문 아님) | (offline 번들 + 향후 동적 확장) |

## 향후 추가 가능 공공 데이터

다음 공공 데이터도 그래프 통합 후보다 (contributor 환영 — [Issue](https://github.com/ratelworks/agent-safety-oss/issues) 로 제안).

- **법제처 OpenAPI** 동적 확장 (안전 외 인접 법령 — 산업안전기준에 관한 규칙 외)
- **KOSHA-MS** 안전보건경영시스템 인증 사업장 명부
- **KCs/KCs Self** 안전인증·자율안전인증 통합 (현재 보호구만)
- **고용노동부** 산업재해 통계연보 (분기·연도별 추이)
- **국토교통부** 건설공사 안전관리 종합정보망 (CSI)
- **환경부** 화학물질 정보 (PRTR · 유해성 등급)
- **소방청** 위험물 안전관리 정보
- **건설근로자공제회** 안전교육 이수 자료

## 근거 등급

| basisType | legalWeight | 사용 방식 |
|---|---|---|
| law, regulation | mandatory | 의무 판단, 결재/제출 문서의 법적 근거 |
| kosha_guide | recommended | 기술적 권고, 작업 방법, 개선대책 |
| accident_case | reference | 유사 재해사례와 교육자료 |
| safety_material | reference | OPS, 교안, 영상, 외국인 자료 |
| msds | reference | 제조/수입자 MSDS 확인을 보조 |
| statistics | reference | 비교와 설명 |
| ppe_certification | reference | 인증 보호구 확인 |

## 라이선스와 주의

- 코드: MIT
- 법령 본문: 저작권법 제7조 비보호 저작물
- KOSHA/고용노동부 자료: 각 자료의 공공누리와 공공데이터 이용조건 준수
- MSDS 응답은 참고용이며 사업주의 실제 MSDS 작성, 제공, 비치 의무를 대체하지 않는다.
- KOSHA Guide는 기술적 권고이며 법령상 강제 의무와 구분한다.

## 관련 문서

- [API-SPECS.md](./API-SPECS.md)
- [NOTICE.md](../NOTICE.md)
- [SECURITY.md](../SECURITY.md)
