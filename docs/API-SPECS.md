# KOSHA OpenAPI 정확 명세 매트릭스

> 2026-04-25 직접 호출 검증 + data.go.kr 영문 가이드 + 사용자 제공 정확 URL 기반 SSoT
> 신규 도구 추가·기존 정정 시 이 문서를 우선 참조

---

## 0. 빠른 참조 (Cheatsheet)

| dataId | API명 | Base | Path | 필수 callApiId | 추가 필수 파라미터 |
|:-:|---|---|---|:-:|---|
| 15119137 | 사고사망 (전 업종) | apis.data.go.kr/B552468 | `/news_api02/getNews_api02` | **1040** | — |
| 15144147 | KOSHA Guide | apis.data.go.kr/B552468 | `/koshaguide/getKoshaGuide` | **1050** | — |
| 15121001 | 국내재해사례 | apis.data.go.kr/B552468 | `/disaster_api02/getdisaster_api02` | **1060** | — |
| 15121008 | 재해 첨부 | apis.data.go.kr/B552468 | `/disaster_attach_api02/Disaster_attach_api02` | **1070** | `boardno` |
| 15133935 | 건설업 일별 중대재해 | apis.data.go.kr/B552468 | `/constDsstr01/getconstDsstr01` | **1010** | `dsstrDy=YYYYMMDD` |
| 15139398 | 안전보건자료 링크 | apis.data.go.kr/B552468 | `/selectMediaList01/getselectMediaList01` | **1030** | `ctgr04_kr=Y` |
| 15139497 | 보호구 안전인증 | apis.data.go.kr/B552468 | `/oshci/getoshci` (XML) | — | `pteqgrCrtfcTyCd=BH` |
| 15001197 | MSDS 목록 | apis.data.go.kr/B552468 | `/msdschem/getChemList` (XML) | — | `searchWrd`, `searchCnd=0` |
| 15001197 | MSDS 섹션 상세 | apis.data.go.kr/B552468 | `/msdschem/getChemDetail{01..16}` (XML) | — | `chemId` (6자리 zero-pad) |

**공통 인증**: `serviceKey=DECODED_KEY` (URLSearchParams가 자동 인코딩)

---

## 1. 사고사망 게시판 (전 업종) — 15119137

### Endpoint
```
GET https://apis.data.go.kr/B552468/news_api02/getNews_api02
```

### 파라미터
| 이름 | 타입 | 필수 | 설명 |
|---|:-:|:-:|---|
| serviceKey | string | ✅ | 공공데이터포털 인증키 (디코딩) |
| pageNo | int | ✅ | 페이지번호 |
| numOfRows | int | ✅ | 한 페이지 결과 수 |
| **callApiId** | int | ✅ | **고정값 1040** |
| keyword | string | ⬜ | 게시판 제목 키워드 (KOSHA 측 일부 작동 — 단순 페이지네이션 우선) |
| business | string | ⬜ | 업종 (제조업/건설업/조선업) |

### 응답 필드 (item)
- `boardno` — 게시판 고유 번호
- `keyword` — 사고 한 줄 요약 (LLM에는 제목으로 활용)
- `contents` — 본문 (HTML 가능)
- `business` — 업종
- `atcflcnt` — 첨부 파일 개수

### 검증 호출
```bash
curl 'https://apis.data.go.kr/B552468/news_api02/getNews_api02?serviceKey=...&pageNo=1&numOfRows=3&callApiId=1040'
# → totalCount: 2798
```

---

## 2. KOSHA Guide — 15144147

### Endpoint
```
GET https://apis.data.go.kr/B552468/koshaguide/getKoshaGuide
```

### 파라미터
| 이름 | 타입 | 필수 | 설명 |
|---|:-:|:-:|---|
| serviceKey | string | ✅ | 인증키 |
| **callApiId** | int | ✅ | **고정값 1050** |
| pageNo | int | ⬜ | 기본 1 |
| numOfRows | int | ⬜ | 기본 10 |
| techGdlnNm | string | ⬜ | 지침명 키워드 (예: '굴착') |
| techGdlnNo | string | ⬜ | 지침번호 단건 (예: 'A-1-2018') |
| ofancYmd | string | ⬜ | 제정일 YYYYMMDD |

### 응답 필드 (item)
- `techGdlnNo` — 지침번호 (예: A-1-2018, C-103-2014)
- `techGdlnNm` — 지침명
- `techGdlnOfancYmd` — 제정일 (YYYY-MM-DD)
- `fileDownloadUrl` — PDF 직접 다운로드 URL

### 검증 호출
```bash
curl '.../koshaguide/getKoshaGuide?serviceKey=...&callApiId=1050&numOfRows=3&techGdlnNm=굴착'
# → totalCount: 4 (굴착 관련 KOSHA Guide)
```

### ⚠️ 주의
- 코드 v0.1 이전 결함: 파라미터 `keyword`/`guideNo`/`category` 사용 → KOSHA가 무시 → 빈 응답
- 정정: 정확한 파라미터명 `techGdlnNm`/`techGdlnNo`/`ofancYmd`

---

## 3. 국내재해사례 게시판 — 15121001

### Endpoint
```
GET https://apis.data.go.kr/B552468/disaster_api02/getdisaster_api02
```
**주의**: `disaster_api/getDisaster_api`(02 없음·D 대문자) 옛 endpoint는 deprecated. **`02` 추가 + 소문자 g**

### 파라미터
| 이름 | 타입 | 필수 | 설명 |
|---|:-:|:-:|---|
| serviceKey | string | ✅ | 인증키 |
| **callApiId** | int | ✅ | **고정값 1060** |
| pageNo | int | ✅ | |
| numOfRows | int | ✅ | |
| business | string | ⬜ | 업종 (제조업/건설업/조선업/서비스업) |
| keyword | string | ⬜ | 게시판 제목 키워드 |

### 응답 필드 (item)
- `boardno` — 게시판 번호 (재해 첨부 1070 호출 시 사용)
- `keyword` — 사고 한 줄 요약
- `contents` — 본문
- `business` — 업종
- `atcflcnt` — 첨부 개수

### 검증 호출
```bash
curl '.../disaster_api02/getdisaster_api02?serviceKey=...&pageNo=1&numOfRows=3&callApiId=1060'
# → totalCount: 6311
```

---

## 4. 국내재해사례 첨부파일 — 15121008

### Endpoint
```
GET https://apis.data.go.kr/B552468/disaster_attach_api02/Disaster_attach_api02
```
**주의**: `D`는 대문자 (D-isaster_attach_api02)

### 파라미터
| 이름 | 타입 | 필수 | 설명 |
|---|:-:|:-:|---|
| serviceKey | string | ✅ | 인증키 |
| **callApiId** | int | ✅ | **고정값 1070** |
| **boardno** | string | ✅ | 게시판 번호 (15121001 응답의 boardno, 예: '20260413162017EK5XMP') |
| pageNo | int | ✅ | |
| numOfRows | int | ✅ | |

### 응답 필드 (item)
- `filenm` — 첨부 파일명
- `filepath` — 다운로드 URL (KOSHA portal로 리다이렉트)
- `boardno` — 입력값 echo

### 검증 호출
```bash
curl '.../disaster_attach_api02/Disaster_attach_api02?serviceKey=...&callApiId=1070&boardno=20260413162017EK5XMP'
# → 첨부 PDF URL
```

---

## 5. 건설업 일별 중대재해 — 15133935

### Endpoint
```
GET https://apis.data.go.kr/B552468/constDsstr01/getconstDsstr01
```

### 파라미터
| 이름 | 타입 | 필수 | 설명 |
|---|:-:|:-:|---|
| serviceKey | string | ✅ | 인증키 |
| **callApiId** | int | ✅ | **고정값 1010** |
| **dsstrDy** | string | ✅ | 재해일자 YYYYMMDD (단일 일자만) |
| pageNo | int | ⬜ | |
| numOfRows | int | ⬜ | |

### 응답 필드 (item)
- `jobPrcsNm` — 작업공종 (예: 맨홀 및 관부설작업)
- `dtlJobPrcsNm` — 세부공정
- `ocmtNm` — 기인물 (예: 토사)
- `dsstrKndNm` — 재해종류 (예: 붕괴)
- `dsstrDtlCn` — 사고개요
- `rsknsDcrsMsrsCn` — **위험성 감소대책 (KOSHA 공식)** ⭐

### 검증 호출
```bash
curl '.../constDsstr01/getconstDsstr01?serviceKey=...&callApiId=1010&dsstrDy=20210601'
# → totalCount: 1, 굴착 매몰 사고 + KOSHA 공식 감소대책 4개
```

### 데이터 범위
- 공개: 2017~2021 (실시간 갱신 아님)
- 최신 사망사고는 15119137 (전 업종) 사용 권장

---

## 6. 안전보건자료 링크 — 15139398

### Endpoint
```
GET https://apis.data.go.kr/B552468/selectMediaList01/getselectMediaList01
```

### 파라미터
| 이름 | 타입 | 필수 | 설명 |
|---|:-:|:-:|---|
| serviceKey | string | ✅ | 인증키 |
| **callApiId** | int | ✅ | **고정값 1030** |
| **ctgr04_kr** | string | ✅ | **고정값 'Y'** (한국어 자료) |
| pageNo | int | ✅ | |
| numOfRows | int | ✅ | |
| ctgr01 | string | ⬜ | 제작유형 코드 (책자/OPS/교안/영상) |
| ctgr02 | string | ⬜ | 업종 코드 |
| ctgr03 | string | ⬜ | 재해유형 코드 |

### 응답 필드 (item)
- `MED_SJ_NM` — 자료 제목
- `MED_URL` — KOSHA portal 직접 링크
- `MED_COMPY_DY` — 등록일 (YYYY-MM-DD)

### 검증 호출
```bash
curl '.../selectMediaList01/getselectMediaList01?serviceKey=...&callApiId=1030&ctgr04_kr=Y&numOfRows=2'
# → totalCount: 29020
```

---

## 7. 보호구 안전인증 — 15139497 (XML 전용)

### Endpoint
```
GET https://apis.data.go.kr/B552468/oshci/getoshci
```

### 파라미터
| 이름 | 타입 | 필수 | 설명 |
|---|:-:|:-:|---|
| serviceKey | string | ✅ | 인증키 |
| **pteqgrCrtfcTyCd** | string | ✅ | **고정값 'BH'** (보호구 인증 유형) |
| pageNo | int | ✅ | |
| numOfRows | int | ✅ | |

### 응답 필드 (item) — KOSHA 실제 필드명 (camelCase 일부)
- `crtfcNo` — 인증번호 (예: 09-AV2CR-0202)
- `mfplntNm` — 제조공장명
- `pteqgrCpctyGradNm` — 성능등급 (예: 보통작업용 중단화)
- `pteqgrFomNm` — 형식 (모델명, 예: YPJ-601)
- `ptqgrCrtfcPrdlstNm` — 인증품목명 (예: 정전기 안전화 가죽제)
- `pteqgrCanclResnSeNm` — 인증취소 사유 (있으면)

### ⚠️ 주의
- 응답 형식 XML (JSON 미지원)
- v0.1 이전 결함: 코드가 `ctfcNo`/`prtcDvcNm`/`mnfcFctNm` 등 잘못된 필드명 사용 → 모든 결과 빈 객체
- 정정: KOSHA 실측 필드명으로 매핑

### 검증 호출
```bash
curl '.../oshci/getoshci?serviceKey=...&pageNo=1&numOfRows=2&pteqgrCrtfcTyCd=BH'
# → totalCount: 12668
```

---

## 8. 물질안전보건자료 (MSDS) — 15001197 (XML 전용)

### 8.1 목록 조회
```
GET https://apis.data.go.kr/B552468/msdschem/getChemList
```

### 파라미터
| 이름 | 타입 | 필수 | 설명 |
|---|:-:|:-:|---|
| serviceKey | string | ✅ | 인증키 |
| **searchWrd** | string | ✅ | 검색어 (한글 화학물질명/영문/CAS 번호) |
| **searchCnd** | int | ✅ | **고정값 0** (화학물질명 기본 검색) |
| pageNo | int | ✅ | |
| numOfRows | int | ✅ | |

### 응답 필드 (item)
- `chemId` — **화학물질 ID** (6자리 문자열, **detail 호출 시 zero-pad 필수**) ⭐
- `chemNameKor` — 한글 화학물질명
- `casNo` — CAS 번호 (예: 71-43-2)
- `enNo` — EU 번호
- `keNo` — 한국 등록번호
- `unNo` — UN 번호
- `lastDate` — 최종 갱신일

### 검증 호출
```bash
curl '.../msdschem/getChemList?serviceKey=...&searchWrd=벤젠&searchCnd=0&numOfRows=3&pageNo=1'
# → totalCount: 777, [{chemId:001008, chemNameKor:벤젠, casNo:71-43-2,...}, ...]
```

### 8.2 섹션 상세 조회
```
GET https://apis.data.go.kr/B552468/msdschem/getChemDetail{01..16}
```

16개 섹션:
| Section | 의미 |
|:-:|---|
| 01 | 화학제품과 회사 정보 |
| 02 | 유해성·위험성 |
| 03 | 구성성분 정보 |
| 04 | 응급조치 요령 |
| 05 | 폭발·화재 시 대처방법 |
| 06 | 누출 사고 시 대처방법 |
| 07 | 취급 및 저장방법 |
| 08 | 노출방지 및 개인보호구 |
| 09 | 물리화학적 특성 |
| 10 | 안정성 및 반응성 |
| 11 | 독성에 관한 정보 |
| 12 | 환경에 미치는 영향 |
| 13 | 폐기 시 주의사항 |
| 14 | 운송에 필요한 정보 |
| 15 | 법적 규제현황 |
| 16 | 기타 참고사항 |

### 파라미터
| 이름 | 타입 | 필수 | 설명 |
|---|:-:|:-:|---|
| serviceKey | string | ✅ | 인증키 |
| **chemId** | string | ✅ | **6자리 zero-padded 문자열** (예: '001008'). 1008로 보내면 빈 응답! |
| pageNo | int | ⬜ | |
| numOfRows | int | ⬜ | |

### 응답 필드 (item)
- `msdsItemCode` — 항목 코드 (예: A02, B0402)
- `msdsItemNameKor` — 한글 항목명 (예: '제품명', '유해성·위험성 분류', '예방조치')
- `itemDetail` — 항목 본문
- `lev` — 들여쓰기 레벨 (1=대분류, 2=세부)
- `upMsdsItemCode` — 상위 항목 코드
- `ordrIdx` — 정렬 순서

### ⚠️ 주의 (시행착오 끝에 발견)
1. **endpoint host**: `msds.kosha.or.kr` 별도 서버가 아니라 `apis.data.go.kr/B552468` 통합 게이트웨이 사용
2. **파라미터명**: `chemNm`/`casNo`/`searchValue`/`searchCondition` 모두 KOSHA에서 무시. 정확한 이름은 `searchWrd` + `searchCnd`
3. **chemId 6자리 zero-pad**: XML 파서가 "001008"을 정수 1008로 변환해버림. detail 호출 시 `String(chemId).padStart(6, "0")` 필수
4. **응답 필드**: `kmcNo`/`chemNm`/`chemNmKor`/`chemNmEng` 모두 무존재. 실제는 `chemId`/`chemNameKor`/`casNo`

### 검증 호출
```bash
# 목록
curl '.../msdschem/getChemList?serviceKey=...&searchWrd=벤젠&searchCnd=0'
# → totalCount: 777

# 섹션 02 (유해성·위험성)
curl '.../msdschem/getChemDetail02?serviceKey=...&chemId=001008'
# → GHS 분류, 유해문구 H225/H304/H315/H319/H340 등
```

---

## 부록 A: 공통 응답 구조

```xml
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE.</resultMsg>
  </header>
  <body>
    <items>
      <item>...</item>
      <item>...</item>
    </items>
    <totalCount>N</totalCount>
    <pageNo>1</pageNo>
    <numOfRows>10</numOfRows>
  </body>
</response>
```

JSON 응답 시 `response.body.items.item` 또는 `body.items.item` 두 가지 wrapper 패턴 모두 처리 필요.

`resultCode`:
- `00` NORMAL_SERVICE — 정상
- `30` SERVICE KEY IS NOT REGISTERED — 키 미인증 또는 활용신청 미승인
- `99` UNKNOWN_ERROR — 알 수 없는 오류 (대부분 callApiId 누락 또는 잘못)

---

## 부록 B: 공통 결함 패턴 (다음 API 추가 시 점검)

| 결함 | 증상 | 진단 방법 |
|---|---|---|
| `callApiId` 누락 | 200 OK + body 없음 (header만) 또는 빈 items | 영문 가이드(en/data/...) 또는 활용가이드 docx 확인 |
| 파라미터명 추측 (camelCase 가정) | totalCount 0 + items 비어 있음 | 활용가이드 docx 또는 사용자 정확 URL 제공 |
| 응답 필드명 추측 | 응답은 오는데 모든 필드 빈 문자열 | 직접 curl로 raw JSON/XML 확인 |
| ID zero-pad 누락 | 목록은 OK, detail 호출만 빈 응답 | 직접 curl로 padded vs 비-padded 비교 |
| endpoint path 옛 버전 | HTTP 500 "Unexpected errors" | 영문 가이드 페이지에서 정확한 path 확인 |

---

## 부록 C: 신규 API 도입 절차 (의무)

```
1. data.go.kr/data/{dataId}/openapi.do 한국어 페이지 → "활용가이드 다운로드" docx
2. data.go.kr/en/data/{dataId}/openapi.do 영문 페이지 → 추가 검증 (Service URL · Parameters · callApiId)
3. curl로 직접 호출 → raw response 확인 (필드명·구조)
4. 실측한 정확한 파라미터·응답 필드로 코드 작성
5. 본 docs/API-SPECS.md 에 추가
6. e2e-smoke 시나리오 추가
```

**금지**: 코드 작성 → 호출 실패 → 추측 변경 → 반복 (시행착오로 시간 낭비)
