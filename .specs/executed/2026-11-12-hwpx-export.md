---
spec_id: 2026-11-12-hwpx-export
status: executed
created: 2026-11-12
priority: P1
---

# HWPX(한글) 내보내기 내장

## Requirements

- WHEN 사용자가 문서 생성 또는 내보내기에서 형식 `hwpx` 를 고르면, SYSTEM SHALL 한글에서 열리는 HWPX 파일을 문서 보관 폴더에 저장하고 경로를 돌려준다.
- SYSTEM SHALL 외부 프로그램·추가 런타임 의존성 없이 파일을 만든다.
- 파일 본문은 결재·제출용으로 정리한다(작성 안내·검사 상태 머리말 제외, 법령 기호 한글 표기).

## Design

- `src/lib/hwpx-writer.ts` — Markdown → OWPML(header·section) → ZIP. Node 표준 `zlib`(deflateRaw·crc32)만 사용. 시각 고정으로 같은 입력이면 같은 바이트.
- `src/lib/approval-copy.ts` — 결재·제출용 정리(브라우저 미리보기와 같은 규칙).
- `src/lib/hwpx-export.ts` — 정리 + 저장(소유자 전용 권한).
- 도구: `generate_safety_document`·`export_drafted_document` 의 `format: "hwpx"`. 브라우저 입력 폼: `POST /api/export-hwpx` + "한글 저장" 버튼.
- 기존 문서 생성 엔진 패키지를 의존성으로 넣는 안은 채택하지 않았다 — 설치 크기가 수백 MB 로 늘어 "가벼운 로컬 도구" 방향과 맞지 않는다. 패키지 구성과 요소 배열만 참고했다(NOTICE 기재).

## 확인

- 회귀 시험 `mcp:test:hwpx` 30건(패키지 구성·CRC·XML 정합·내용·문서 96종 전부·도구 연동).
- 다른 구현의 HWPX 파서로 3종을 읽어 글자·표가 추출되는 것 확인.
- 실제 한글 프로그램(macOS)에서 TBM 문서를 열어 제목·표·결재선이 표시되고 40초 동안 열려 있는 것 확인(3쪽). 1종만 확인했다.

## 한계

- 공식 서식의 칸 배치 재현 아님. 그림·병합 칸·중첩 표 미지원.
- 한글 프로그램에서의 확인은 자동 시험에 없다.
