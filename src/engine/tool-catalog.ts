/**
 * tool-catalog.ts — 등록 도구마다 저장·통신·파일·사람 필요 여부
 *
 * 호스트가 도구를 연결하기 전에 읽는 목록이다. 도구를 추가하면 여기에도 한 줄을 더해야 한다
 * (시험이 등록 도구 목록과 이 목록이 같은지 확인한다). 호스트 실행에서는 이 값과 실제 실행을 대조해
 * 밝히지 않은 저장·파일 효과가 나오면 저장하지 않고 오류를 낸다.
 *
 *   access   none  = 저장을 읽지도 쓰지도 않는다 / read = 읽기만 / write = 쓴다(읽기 포함)
 *   storage  none  = 값만 계산 / injected = 호스트가 준 저장만 / local-only = 단독 사용 전용(호스트 모드에서 거절)
 *   effects  files = 문서 파일을 낸다(결과 files) / external = 이 컴퓨터 밖(공공 API·클라우드)과 통신한다
 *   human    사람이 해야 하는 몫 — 엔진의 최소 제약이다. 호스트 권한표는 이보다 엄격할 수 있다
 *   siteField  현장(공사) 식별자 칸 — 현장으로 고정한 실행에서 비어 있으면 그 현장으로 채우고, 다르면 거절한다
 *   fileFields 호스트 파일 참조를 받는 칸 — 호스트 모드에서는 로컬 경로가 아니라 호스트 파일 자리의 참조다
 */

export type SafetyToolAccess = "none" | "read" | "write";
export type SafetyToolStorage = "none" | "injected" | "local-only";
export type SafetyHumanKind = "approve" | "register" | "auth" | "judge";

export interface SafetyHumanRequirement {
  kind: SafetyHumanKind;
  reason: string;
  /** 사람이 필요한 조건(사람이 읽는 글). 없으면 항상 */
  when?: string;
}

export interface SafetyToolTraits {
  access: SafetyToolAccess;
  storage: SafetyToolStorage;
  effects: { files: boolean; external: boolean };
  human?: SafetyHumanRequirement;
  siteField?: string;
  fileFields?: readonly string[];
  /** storage 가 local-only 인 까닭 */
  localOnlyReason?: string;
}

// ── 묶음 ────────────────────────────────────────────────────────────
const PURE: SafetyToolTraits = { access: "none", storage: "none", effects: { files: false, external: false } };
const PURE_FILES: SafetyToolTraits = { access: "none", storage: "none", effects: { files: true, external: false } };
const EXTERNAL: SafetyToolTraits = { access: "none", storage: "none", effects: { files: false, external: true } };
const READ: SafetyToolTraits = { access: "read", storage: "injected", effects: { files: false, external: false } };
const WRITE: SafetyToolTraits = { access: "write", storage: "injected", effects: { files: false, external: false } };

const LOCAL_KEY_REASON =
  "회사 키를 이 컴퓨터의 로컬 저장에 두고 발행처 서비스와 통신한다 — 호스트 안에서는 호스트의 인증·전송 정책을 따른다";

/** 등록 도구 92개 — 등록 순서대로 */
export const TOOL_TRAITS: Readonly<Record<string, SafetyToolTraits>> = {
  // 1. 검색 — 공공 API (키 필요)
  search_accident_cases: EXTERNAL,
  get_accident_case_attachments: EXTERNAL,
  search_construction_fatal_accidents: EXTERNAL,
  search_all_fatal_accidents: EXTERNAL,
  search_safety_materials: EXTERNAL,
  search_msds: EXTERNAL,
  search_ppe_certification: EXTERNAL,
  search_safety_law_smart: EXTERNAL,
  // 1. 검색 — 공단 자료실 (키 불필요, 통신)
  search_kosha_archive: EXTERNAL,
  list_kosha_archive_facets: EXTERNAL,
  // 1. 검색 — 번들
  search_safety_laws: PURE,
  get_kosha_guide_md: PURE,
  search_sif_archive: PURE,
  list_construction_subtasks: PURE,
  // 2. 조회
  get_safety_law_article: PURE,
  list_core_safety_laws: PURE,
  get_foreign_worker_resource_links: PURE,
  get_kras_method: PURE,
  get_kosha_archive_files: EXTERNAL,
  get_project_info: PURE,
  get_official_form: PURE,
  query_legal_basis: PURE,
  query_penalty: PURE,
  // 3. 가이드
  list_safety_documents_by_cycle: PURE,
  get_safety_document_guide: PURE,
  get_risk_assessment_schema: PURE,
  get_work_plan_schema: PURE,
  get_tbm_schema: PURE,
  get_ops_schema: PURE,
  get_work_permit_schema: PURE,
  list_kras_methods: PURE,
  choose_assessment_method: PURE,
  // 4. 검증·작성
  verify_safety_basis: PURE,
  review_safety_document: PURE,
  generate_safety_document: { ...READ, effects: { files: true, external: false }, siteField: "projectId" },
  submit_safety_document: { ...WRITE, effects: { files: true, external: false } },
  query_applicability: PURE,
  // 5. 공종 → 자료 묶음
  field_safety_briefing: PURE,
  analyze_construction_work_risks: PURE,
  compile_safety_references: PURE,
  get_measures_by_risk: PURE,
  get_ppe_by_task: PURE,
  generate_tbm_topics: PURE,
  query_delegation_chain: PURE,
  query_guide_links: PURE,
  // 6. 사업장·현장 프로필
  register_site: WRITE,
  register_project: WRITE,
  register_person: { ...WRITE, siteField: "projectId" },
  register_equipment: { ...WRITE, siteField: "projectId" },
  register_contractor: { ...WRITE, siteField: "projectId" },
  get_site_profile: READ,
  clear_site_profile: {
    ...WRITE,
    human: { kind: "approve", reason: "사업장·현장·인력 프로필 전체를 지운다 — 되돌릴 수 없다" },
  },
  // 7. 회사 키 — 단독 사용 전용
  link_company_key: {
    access: "write",
    storage: "local-only",
    effects: { files: false, external: true },
    human: { kind: "auth", reason: "발행받은 회사 키를 등록한다 — 키 소유자가 직접 한다" },
    localOnlyReason: LOCAL_KEY_REASON,
  },
  unlink_company_key: {
    access: "write",
    storage: "local-only",
    effects: { files: false, external: false },
    human: { kind: "approve", reason: "로컬에 둔 회사 키를 지운다" },
    localOnlyReason: LOCAL_KEY_REASON,
  },
  get_company_info: {
    access: "read",
    storage: "local-only",
    effects: { files: false, external: true },
    localOnlyReason: LOCAL_KEY_REASON,
  },
  sync_to_cloud: {
    access: "read",
    storage: "local-only",
    effects: { files: false, external: true },
    human: {
      kind: "approve",
      reason: "개인정보가 들어 있을 수 있는 프로필을 바깥 클라우드로 보낸다 — 사용자의 명시적 동의가 필요하다",
      when: "confirm 이 true 일 때(실제 전송)",
    },
    localOnlyReason: LOCAL_KEY_REASON,
  },
  // 8. 라이프사이클 진단·출력
  assess_my_obligations: READ,
  get_submission_info: PURE,
  get_retention_status: PURE,
  list_upcoming_duties: PURE,
  get_incident_response_workflow: PURE,
  get_construction_stage_duties: PURE,
  list_downloadable_forms: PURE,
  export_drafted_document: PURE_FILES,
  assemble_doc_context: PURE,
  render_a2ui_form: READ,
  render_profile_input_form: READ,
  save_profile_from_form: WRITE,
  // 8. 작성 보조
  request_field_help: PURE,
  suggest_controls_for_hazard: PURE,
  analyze_work_context: PURE,
  preview_review: PURE,
  // 9. 조치·보고
  record_corrective_action: WRITE,
  complete_action: {
    ...WRITE,
    human: { kind: "judge", reason: "개선조치가 실제로 끝났는지는 현장에서 확인한 사람이 정한다" },
  },
  list_pending_actions: { ...READ, siteField: "siteId" },
  get_corrective_action: READ,
  generate_safety_report: { ...WRITE, effects: { files: true, external: false }, siteField: "siteId" },
  list_safety_reports: { ...READ, siteField: "siteId" },
  // 10. 초안·보관
  save_form_draft: WRITE,
  load_form_draft: READ,
  list_form_drafts: READ,
  archive_safety_document: { ...WRITE, effects: { files: true, external: false } },
  list_archived_documents: READ,
  get_storage_stats: READ,
  // 10. 사진·이슈
  upload_photo_evidence: { ...WRITE, siteField: "relatedSite", fileFields: ["filePath"] },
  list_photos_by_site: { ...READ, siteField: "siteId" },
  list_photos_by_task: READ,
  // 연결된 이슈를 찾으면 사진 기록에 연결을 덧붙여 쓴다
  get_photo_evidence: WRITE,
  register_safety_issue: WRITE,
  list_open_issues: { ...READ, siteField: "siteId" },
  update_issue_status: {
    ...WRITE,
    human: {
      kind: "judge",
      reason: "이슈가 해소·확인됐는지는 현장에서 확인한 사람이 정한다",
      when: "status 가 resolved 또는 verified 일 때",
    },
  },
  get_safety_issue: READ,
};

export function toolTraits(name: string): SafetyToolTraits | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_TRAITS, name) ? TOOL_TRAITS[name] : undefined;
}
