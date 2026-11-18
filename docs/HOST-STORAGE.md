# 호스트 저장 주입 모드

agent-safety-oss 는 혼자 쓰는 것이 기본입니다. MCP 서버·CLI·브라우저 입력 폼은 지금처럼 이 컴퓨터의 `~/.agent-safety-oss/`(또는 `SAFETY_LOCAL_DIR`)에 저장하며, 이 모드를 쓰지 않으면 아무것도 바뀌지 않습니다.

다른 서비스(호스트) 안에 엔진을 넣어 여러 회사·현장의 자료를 그 서비스의 저장소에 두려면 **호스트 저장 주입 모드**를 씁니다. 요청마다 엔진 인스턴스를 만들고, 저장·파일·시계·추적을 호스트가 넘깁니다.

## 쓰는 법

```ts
import { createSafetyEngine, getSafetyEngineManifest } from "agent-safety-oss/engine";

const engine = createSafetyEngine({
  storage,                          // 회사 하나로 고정한 저장: get(kind, id) · list(kind) · put(kind, id, value) · remove(kind, id)
  files,                            // 입력 파일(사진)을 호스트 파일 자리에서 읽기: read(ref) → { fileName, mimeType, bytes }
  clock: { now: () => new Date() }, // 같은 시각을 주면 같은 id·기록이 나온다
  trace: (event) => {},             // 이름과 숫자·참거짓 값만 담긴 추적
  scope: { projectId },             // 현장 고정 (생략하면 회사 범위)
});

const { ok, result, files: outFiles, writes } = await engine.call("register_safety_issue", input);
```

- `result` 는 MCP 응답과 같은 모양입니다(`content`·`structuredContent`).
- `outFiles` 는 엔진이 낸 문서 파일입니다(보관 문서 본문·서류 정본·한글 파일·운영 보고서 본문). 파일 이름·형식·바이트·SHA-256 이 있고, 저장은 호스트가 합니다.
- 서류 생성(`generate_safety_document`)이 내는 파일은 `format` 에 따라 다릅니다.

  | format | outFiles (순서대로) |
  |---|---|
  | `dclx` (기본) | 정본 `.dclx` 1개 |
  | `hwpx` | 정본 `.dclx`, 그 정본에서 만든 한글 `.hwpx` — 2개 |
  | `md`·`doclang` | 없음 (본문 글자만 `result` 에) |

  정본의 형식은 `application/zip`, 한글 파일은 `application/hwp+zip` 입니다. 파일 이름은 `<문서 종류>-<작성 시각(초)>-<내용 SHA-256 앞 8자>.<확장자>` 이고, `documentKind` 는 문서 종류입니다. 내보내기(`export_drafted_document`)는 `format: hwpx` 일 때만 한글 `.hwpx` 1개를 내고, 기본(`html`)과 `markdown` 은 결과 파일 없이 본문 글자만 돌려줍니다.
- `writes` 는 저장 인터페이스로 보낸 쓰기 목록입니다.
- `getSafetyEngineManifest()` 는 호스트 모드에서 쓸 수 있는 도구 목록(입력 스키마·저장·통신·사람 몫 포함)과 쓸 수 없는 도구를 돌려줍니다.
- 사진 올리기의 `filePath` 는 이 모드에서 로컬 경로가 아니라 호스트 파일 참조입니다. 엔진은 `files.read` 로 읽어 내용 해시만 기록하고 사진을 복사하지 않습니다.

## 이 모드가 지키는 것

- 저장 인터페이스 없이 만들면 거절합니다. 로컬 저장으로 조용히 돌아가지 않습니다.
- 홈 폴더·`SAFETY_LOCAL_DIR`·프로세스 공유 캐시에 쓰지 않습니다. 로컬 파일 쓰기는 이 모드에서 막혀 있습니다.
- 회사는 넘긴 저장 인스턴스가, 현장은 `scope.projectId` 가 정합니다. 인스턴스마다 실행 맥락이 따로라 동시에 돌아도 회사·현장 자료가 섞이지 않습니다.
- 현장을 고정하면 그 현장의 기록만 읽고 씁니다. 다른 현장을 지정한 입력이나 회사 프로필을 바꾸는 실행은 거절합니다. 회사 범위 실행에는 현장 기록이 보이지 않습니다.
- 회사 프로필(사업장, 현장에 속하지 않은 인력·장비)과 현장별 프로필(현장 정보와 그 현장의 인력·장비·수급업체)을 따로 저장합니다. 여러 현장이 한 프로필을 덮어쓰지 않습니다.
- 입력은 도구의 원래 스키마(추가 검사 포함)로 먼저 검사하고, 틀리면 아무것도 저장하지 않습니다.
- 한 번의 실행에서 필요한 것을 먼저 읽고, 메모리에서 계산한 뒤, 도구가 성공하면 마지막에 한 번에 씁니다. 같은 실행 안에서 쓴 뒤 다시 읽지 않습니다.
- 같은 문서·같은 내용의 보관은 한 기록, 같은 사진은 같은 사진 id 가 됩니다. 같은 시각·같은 입력으로 다시 실행하면 같은 id 로 다시 씁니다.

## 저장 종류

| 종류 | id | 내용 |
|---|---|---|
| `profile` | `company` | 회사 프로필 |
| `project_profile` | 현장 식별자 | 현장별 프로필 |
| `draft` | 문서 종류 | 작성 중 양식 입력값 |
| `document` | 문서 종류/내용 해시 | 보관 문서 기록(본문은 결과 파일) |
| `photo` | 사진 id | 사진 증빙 기록 |
| `issue` | 이슈 id | 안전 이슈 |
| `action` | 조치 id | 개선조치 |
| `report` | 보고서 id | 운영 보고서 |
| `activity` | 기록 id | 쓰기 작업 활동 기록 |

현장을 고정한 실행에서는 현장에 속하는 종류(초안·문서·사진·이슈·조치·보고·활동)의 id 앞에 현장 표지가 붙습니다.

## 오류

실패는 `SafetyEngineError` 의 `code` 로 나뉩니다. `commit_failed` 말고는 아무것도 쓰지 않은 상태입니다.

| code | 뜻 |
|---|---|
| `storage_required` | 저장 인터페이스 없이 만들려 함 |
| `invalid_option` | 시작 옵션 모양이 틀림 |
| `unknown_tool` / `tool_unavailable` | 없는 도구 / 이 모드에서 쓰지 않는 도구 |
| `invalid_input` | 입력이 도구 스키마와 맞지 않음 |
| `scope_mismatch` | 고정한 현장 밖을 쓰려 함 |
| `file_read_failed` | 입력 파일을 호스트 파일 자리에서 읽지 못함 |
| `storage_read_failed` | 저장 인터페이스 읽기 실패 |
| `tool_failed` | 도구 실행 중 오류 |
| `commit_failed` | 마지막 저장 중 실패 — `details` 에 쓴 것(`written`)·실패한 것(`failed`)·못 쓴 것(`notWritten`)과 결과 파일이 나뉨. 같은 시각·같은 입력으로 다시 실행하면 같은 id 로 다시 씀 |
| `catalog_mismatch` / `local_write_blocked` | 엔진 결함을 막은 것 — 저장하지 않음 |

## 도구별 저장·통신·사람 몫

- **저장**: 없음 = 값만 계산 / 읽기 / 쓰기 / 단독 사용 전용 = 이 모드에서 거절(회사 키 연결·클라우드 전송)
- **통신**: 외부 = 이 컴퓨터 밖(공공 API·공단 자료실)과 통신
- **파일**: 결과 `files` 로 문서 파일을 냄
- **사람 몫**: 사람이 해야 하는 최소한의 몫입니다. 호스트의 권한 규칙은 이보다 엄격할 수 있습니다
- **현장 칸**: 현장을 고정한 실행에서 비어 있으면 그 현장으로 채우고, 다르면 거절하는 입력 칸

<!-- HOST-TOOLS:START -->
등록 도구 92개 — 저장 없음 55 · 읽기 16 · 쓰기 17 · 단독 사용 전용 4 / 외부 통신 14 · 파일을 냄 5 · 사람 몫 6

| 도구 | 저장 | 통신 | 파일 | 사람 몫 | 현장 칸 |
|---|---|---|---|---|---|
| `search_accident_cases` | 없음 | 외부 |  |  |  |
| `get_accident_case_attachments` | 없음 | 외부 |  |  |  |
| `search_construction_fatal_accidents` | 없음 | 외부 |  |  |  |
| `search_all_fatal_accidents` | 없음 | 외부 |  |  |  |
| `search_safety_materials` | 없음 | 외부 |  |  |  |
| `search_msds` | 없음 | 외부 |  |  |  |
| `search_ppe_certification` | 없음 | 외부 |  |  |  |
| `search_safety_law_smart` | 없음 | 외부 |  |  |  |
| `search_kosha_archive` | 없음 | 외부 |  |  |  |
| `list_kosha_archive_facets` | 없음 | 외부 |  |  |  |
| `search_safety_laws` | 없음 |  |  |  |  |
| `get_kosha_guide_md` | 없음 |  |  |  |  |
| `search_sif_archive` | 없음 |  |  |  |  |
| `list_construction_subtasks` | 없음 |  |  |  |  |
| `get_safety_law_article` | 없음 |  |  |  |  |
| `list_core_safety_laws` | 없음 |  |  |  |  |
| `get_foreign_worker_resource_links` | 없음 |  |  |  |  |
| `get_kras_method` | 없음 |  |  |  |  |
| `get_kosha_archive_files` | 없음 | 외부 |  |  |  |
| `get_project_info` | 없음 |  |  |  |  |
| `get_official_form` | 없음 |  |  |  |  |
| `query_legal_basis` | 없음 |  |  |  |  |
| `query_penalty` | 없음 |  |  |  |  |
| `list_safety_documents_by_cycle` | 없음 |  |  |  |  |
| `get_safety_document_guide` | 없음 |  |  |  |  |
| `get_risk_assessment_schema` | 없음 |  |  |  |  |
| `get_work_plan_schema` | 없음 |  |  |  |  |
| `get_tbm_schema` | 없음 |  |  |  |  |
| `get_ops_schema` | 없음 |  |  |  |  |
| `get_work_permit_schema` | 없음 |  |  |  |  |
| `list_kras_methods` | 없음 |  |  |  |  |
| `choose_assessment_method` | 없음 |  |  |  |  |
| `verify_safety_basis` | 없음 |  |  |  |  |
| `review_safety_document` | 없음 |  |  |  |  |
| `generate_safety_document` | 읽기 |  | 냄 |  | `projectId` |
| `submit_safety_document` | 쓰기 |  | 냄 |  |  |
| `query_applicability` | 없음 |  |  |  |  |
| `field_safety_briefing` | 없음 |  |  |  |  |
| `analyze_construction_work_risks` | 없음 |  |  |  |  |
| `compile_safety_references` | 없음 |  |  |  |  |
| `get_measures_by_risk` | 없음 |  |  |  |  |
| `get_ppe_by_task` | 없음 |  |  |  |  |
| `generate_tbm_topics` | 없음 |  |  |  |  |
| `query_delegation_chain` | 없음 |  |  |  |  |
| `query_guide_links` | 없음 |  |  |  |  |
| `register_site` | 쓰기 |  |  |  |  |
| `register_project` | 쓰기 |  |  |  |  |
| `register_person` | 쓰기 |  |  |  | `projectId` |
| `register_equipment` | 쓰기 |  |  |  | `projectId` |
| `register_contractor` | 쓰기 |  |  |  | `projectId` |
| `get_site_profile` | 읽기 |  |  |  |  |
| `clear_site_profile` | 쓰기 |  |  | 승인 — 사업장·현장·인력 프로필 전체를 지운다 — 되돌릴 수 없다 |  |
| `link_company_key` | 단독 사용 전용 | 외부 |  | 인증 — 발행받은 회사 키를 등록한다 — 키 소유자가 직접 한다 |  |
| `unlink_company_key` | 단독 사용 전용 |  |  | 승인 — 로컬에 둔 회사 키를 지운다 |  |
| `get_company_info` | 단독 사용 전용 | 외부 |  |  |  |
| `sync_to_cloud` | 단독 사용 전용 | 외부 |  | 승인 — 개인정보가 들어 있을 수 있는 프로필을 바깥 클라우드로 보낸다 — 사용자의 명시적 동의가 필요하다 (confirm 이 true 일 때(실제 전송)) |  |
| `assess_my_obligations` | 읽기 |  |  |  |  |
| `get_submission_info` | 없음 |  |  |  |  |
| `get_retention_status` | 없음 |  |  |  |  |
| `list_upcoming_duties` | 없음 |  |  |  |  |
| `get_incident_response_workflow` | 없음 |  |  |  |  |
| `get_construction_stage_duties` | 없음 |  |  |  |  |
| `list_downloadable_forms` | 없음 |  |  |  |  |
| `export_drafted_document` | 없음 |  | 냄 |  |  |
| `assemble_doc_context` | 없음 |  |  |  |  |
| `render_a2ui_form` | 읽기 |  |  |  |  |
| `render_profile_input_form` | 읽기 |  |  |  |  |
| `save_profile_from_form` | 쓰기 |  |  |  |  |
| `request_field_help` | 없음 |  |  |  |  |
| `suggest_controls_for_hazard` | 없음 |  |  |  |  |
| `analyze_work_context` | 없음 |  |  |  |  |
| `preview_review` | 없음 |  |  |  |  |
| `record_corrective_action` | 쓰기 |  |  |  |  |
| `complete_action` | 쓰기 |  |  | 판단 — 개선조치가 실제로 끝났는지는 현장에서 확인한 사람이 정한다 |  |
| `list_pending_actions` | 읽기 |  |  |  | `siteId` |
| `get_corrective_action` | 읽기 |  |  |  |  |
| `generate_safety_report` | 쓰기 |  | 냄 |  | `siteId` |
| `list_safety_reports` | 읽기 |  |  |  | `siteId` |
| `save_form_draft` | 쓰기 |  |  |  |  |
| `load_form_draft` | 읽기 |  |  |  |  |
| `list_form_drafts` | 읽기 |  |  |  |  |
| `archive_safety_document` | 쓰기 |  | 냄 |  |  |
| `list_archived_documents` | 읽기 |  |  |  |  |
| `get_storage_stats` | 읽기 |  |  |  |  |
| `upload_photo_evidence` | 쓰기 |  |  |  | `relatedSite` |
| `list_photos_by_site` | 읽기 |  |  |  | `siteId` |
| `list_photos_by_task` | 읽기 |  |  |  |  |
| `get_photo_evidence` | 쓰기 |  |  |  |  |
| `register_safety_issue` | 쓰기 |  |  |  |  |
| `list_open_issues` | 읽기 |  |  |  | `siteId` |
| `update_issue_status` | 쓰기 |  |  | 판단 — 이슈가 해소·확인됐는지는 현장에서 확인한 사람이 정한다 (status 가 resolved 또는 verified 일 때) |  |
| `get_safety_issue` | 읽기 |  |  |  |  |
<!-- HOST-TOOLS:END -->
