import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPABILITIES_DIR = resolve(__dirname, "ontology", "graph", "nodes", "capabilities");
const CAPABILITIES_RESOURCE_URI = "safety://graph/capabilities";
const CAPABILITY_CONTEXT_URI = "safety://graph/context";

export type CapabilityCategory =
  | "kosha_search"
  | "accident_search"
  | "safety_materials"
  | "sif_archive"
  | "construction"
  | "safety_doc"
  | "site_profile"
  | "meta";

export type CapabilityIRI = `safety:capability/${string}`;

export interface CapabilityRegistryEntry {
  capabilityIRI: CapabilityIRI;
  category: CapabilityCategory;
}

export const CAPABILITY_REGISTRY_ENTRIES = [
  ["search_accident_cases", { capabilityIRI: "safety:capability/search_accident_cases", category: "accident_search" }],
  ["get_accident_case_attachments", { capabilityIRI: "safety:capability/get_accident_case_attachments", category: "accident_search" }],
  ["search_construction_fatal_accidents", { capabilityIRI: "safety:capability/search_construction_fatal_accidents", category: "accident_search" }],
  ["search_all_fatal_accidents", { capabilityIRI: "safety:capability/search_all_fatal_accidents", category: "accident_search" }],
  ["search_safety_materials", { capabilityIRI: "safety:capability/search_safety_materials", category: "safety_materials" }],
  ["search_msds", { capabilityIRI: "safety:capability/search_msds", category: "safety_materials" }],
  ["search_ppe_certification", { capabilityIRI: "safety:capability/search_ppe_certification", category: "safety_materials" }],
  ["search_kosha_archive", { capabilityIRI: "safety:capability/search_kosha_archive", category: "kosha_search" }],
  ["list_kosha_archive_facets", { capabilityIRI: "safety:capability/list_kosha_archive_facets", category: "kosha_search" }],
  ["search_safety_laws", { capabilityIRI: "safety:capability/search_safety_laws", category: "kosha_search" }],
  ["search_sif_archive", { capabilityIRI: "safety:capability/search_sif_archive", category: "sif_archive" }],
  ["list_construction_subtasks", { capabilityIRI: "safety:capability/list_construction_subtasks", category: "construction" }],
  ["get_safety_law_article", { capabilityIRI: "safety:capability/get_safety_law_article", category: "kosha_search" }],
  ["list_core_safety_laws", { capabilityIRI: "safety:capability/list_core_safety_laws", category: "kosha_search" }],
  ["get_foreign_worker_resource_links", { capabilityIRI: "safety:capability/get_foreign_worker_resource_links", category: "safety_materials" }],
  ["get_kras_method", { capabilityIRI: "safety:capability/get_kras_method", category: "safety_doc" }],
  ["get_kosha_archive_files", { capabilityIRI: "safety:capability/get_kosha_archive_files", category: "kosha_search" }],
  ["get_project_info", { capabilityIRI: "safety:capability/get_project_info", category: "meta" }],
  ["get_official_form", { capabilityIRI: "safety:capability/get_official_form", category: "safety_doc" }],
  ["query_legal_basis", { capabilityIRI: "safety:capability/query_legal_basis", category: "safety_doc" }],
  ["query_penalty", { capabilityIRI: "safety:capability/query_penalty", category: "safety_doc" }],
  ["list_safety_documents_by_cycle", { capabilityIRI: "safety:capability/list_safety_documents_by_cycle", category: "safety_doc" }],
  ["get_safety_document_guide", { capabilityIRI: "safety:capability/get_safety_document_guide", category: "safety_doc" }],
  ["get_risk_assessment_schema", { capabilityIRI: "safety:capability/get_risk_assessment_schema", category: "safety_doc" }],
  ["get_work_plan_schema", { capabilityIRI: "safety:capability/get_work_plan_schema", category: "safety_doc" }],
  ["get_tbm_schema", { capabilityIRI: "safety:capability/get_tbm_schema", category: "safety_doc" }],
  ["get_ops_schema", { capabilityIRI: "safety:capability/get_ops_schema", category: "safety_doc" }],
  ["get_work_permit_schema", { capabilityIRI: "safety:capability/get_work_permit_schema", category: "safety_doc" }],
  ["list_kras_methods", { capabilityIRI: "safety:capability/list_kras_methods", category: "safety_doc" }],
  ["choose_assessment_method", { capabilityIRI: "safety:capability/choose_assessment_method", category: "safety_doc" }],
  ["verify_safety_basis", { capabilityIRI: "safety:capability/verify_safety_basis", category: "safety_doc" }],
  ["review_safety_document", { capabilityIRI: "safety:capability/review_safety_document", category: "safety_doc" }],
  ["generate_safety_document", { capabilityIRI: "safety:capability/generate_safety_document", category: "safety_doc" }],
  ["submit_safety_document", { capabilityIRI: "safety:capability/submit_safety_document", category: "safety_doc" }],
  ["query_applicability", { capabilityIRI: "safety:capability/query_applicability", category: "safety_doc" }],
  ["field_safety_briefing", { capabilityIRI: "safety:capability/field_safety_briefing", category: "construction" }],
  ["analyze_construction_work_risks", { capabilityIRI: "safety:capability/analyze_construction_work_risks", category: "construction" }],
  ["compile_safety_references", { capabilityIRI: "safety:capability/compile_safety_references", category: "safety_doc" }],
  ["query_delegation_chain", { capabilityIRI: "safety:capability/query_delegation_chain", category: "safety_doc" }],
  ["query_guide_links", { capabilityIRI: "safety:capability/query_guide_links", category: "safety_doc" }],
  ["register_site", { capabilityIRI: "safety:capability/register_site", category: "site_profile" }],
  ["register_project", { capabilityIRI: "safety:capability/register_project", category: "site_profile" }],
  ["register_person", { capabilityIRI: "safety:capability/register_person", category: "site_profile" }],
  ["register_equipment", { capabilityIRI: "safety:capability/register_equipment", category: "site_profile" }],
  ["register_contractor", { capabilityIRI: "safety:capability/register_contractor", category: "site_profile" }],
  ["get_site_profile", { capabilityIRI: "safety:capability/get_site_profile", category: "site_profile" }],
  ["clear_site_profile", { capabilityIRI: "safety:capability/clear_site_profile", category: "site_profile" }],
  ["link_company_key", { capabilityIRI: "safety:capability/link_company_key", category: "site_profile" }],
  ["unlink_company_key", { capabilityIRI: "safety:capability/unlink_company_key", category: "site_profile" }],
  ["get_company_info", { capabilityIRI: "safety:capability/get_company_info", category: "site_profile" }],
  ["sync_to_cloud", { capabilityIRI: "safety:capability/sync_to_cloud", category: "site_profile" }],
  ["assess_my_obligations", { capabilityIRI: "safety:capability/assess_my_obligations", category: "safety_doc" }],
  ["get_submission_info", { capabilityIRI: "safety:capability/get_submission_info", category: "safety_doc" }],
  ["get_retention_status", { capabilityIRI: "safety:capability/get_retention_status", category: "safety_doc" }],
  ["list_upcoming_duties", { capabilityIRI: "safety:capability/list_upcoming_duties", category: "safety_doc" }],
  ["get_incident_response_workflow", { capabilityIRI: "safety:capability/get_incident_response_workflow", category: "safety_doc" }],
  ["get_construction_stage_duties", { capabilityIRI: "safety:capability/get_construction_stage_duties", category: "construction" }],
  ["list_downloadable_forms", { capabilityIRI: "safety:capability/list_downloadable_forms", category: "safety_doc" }],
  ["export_drafted_document", { capabilityIRI: "safety:capability/export_drafted_document", category: "safety_doc" }],
  ["assemble_doc_context", { capabilityIRI: "safety:capability/assemble_doc_context", category: "safety_doc" }],
  ["render_a2ui_form", { capabilityIRI: "safety:capability/render_a2ui_form", category: "meta" }],
  // ADR 002 Active Graph Authoring Loop — 4 신규 도구 (v1.4.0)
  ["request_field_help", { capabilityIRI: "safety:capability/request_field_help", category: "safety_doc" }],
  ["suggest_controls_for_hazard", { capabilityIRI: "safety:capability/suggest_controls_for_hazard", category: "safety_doc" }],
  ["analyze_work_context", { capabilityIRI: "safety:capability/analyze_work_context", category: "construction" }],
  ["preview_review", { capabilityIRI: "safety:capability/preview_review", category: "safety_doc" }],
  ["render_profile_input_form", { capabilityIRI: "safety:capability/render_profile_input_form", category: "site_profile" }],
  ["save_profile_from_form", { capabilityIRI: "safety:capability/save_profile_from_form", category: "site_profile" }],
  ["save_form_draft", { capabilityIRI: "safety:capability/save_form_draft", category: "meta" }],
  ["load_form_draft", { capabilityIRI: "safety:capability/load_form_draft", category: "meta" }],
  ["list_form_drafts", { capabilityIRI: "safety:capability/list_form_drafts", category: "meta" }],
  ["archive_safety_document", { capabilityIRI: "safety:capability/archive_safety_document", category: "meta" }],
  ["list_archived_documents", { capabilityIRI: "safety:capability/list_archived_documents", category: "meta" }],
  ["get_storage_stats", { capabilityIRI: "safety:capability/get_storage_stats", category: "meta" }],
  // ─── 외부 평가 P0-1 정합 — 누락 entry 일괄 추가 ───
  // KOSHA Live (2)
  ["search_safety_law_smart", { capabilityIRI: "safety:capability/search_safety_law_smart", category: "kosha_search" }],
  ["get_kosha_guide_md", { capabilityIRI: "safety:capability/get_kosha_guide_md", category: "kosha_search" }],
  // 분석 (3)
  ["get_measures_by_risk", { capabilityIRI: "safety:capability/get_measures_by_risk", category: "safety_doc" }],
  ["get_ppe_by_task", { capabilityIRI: "safety:capability/get_ppe_by_task", category: "safety_doc" }],
  ["generate_tbm_topics", { capabilityIRI: "safety:capability/generate_tbm_topics", category: "safety_doc" }],
  // Photo evidence (4) — 현장 cycle
  ["upload_photo_evidence", { capabilityIRI: "safety:capability/upload_photo_evidence", category: "site_profile" }],
  ["list_photos_by_site", { capabilityIRI: "safety:capability/list_photos_by_site", category: "site_profile" }],
  ["list_photos_by_task", { capabilityIRI: "safety:capability/list_photos_by_task", category: "site_profile" }],
  ["get_photo_evidence", { capabilityIRI: "safety:capability/get_photo_evidence", category: "site_profile" }],
  // Safety issue (4) — 현장 cycle
  ["register_safety_issue", { capabilityIRI: "safety:capability/register_safety_issue", category: "safety_doc" }],
  ["list_open_issues", { capabilityIRI: "safety:capability/list_open_issues", category: "safety_doc" }],
  ["update_issue_status", { capabilityIRI: "safety:capability/update_issue_status", category: "safety_doc" }],
  ["get_safety_issue", { capabilityIRI: "safety:capability/get_safety_issue", category: "safety_doc" }],
  // Corrective action (4) — 현장 cycle
  ["record_corrective_action", { capabilityIRI: "safety:capability/record_corrective_action", category: "safety_doc" }],
  ["complete_action", { capabilityIRI: "safety:capability/complete_action", category: "safety_doc" }],
  ["list_pending_actions", { capabilityIRI: "safety:capability/list_pending_actions", category: "safety_doc" }],
  ["get_corrective_action", { capabilityIRI: "safety:capability/get_corrective_action", category: "safety_doc" }],
  // Safety report (2) — 현장 cycle
  ["generate_safety_report", { capabilityIRI: "safety:capability/generate_safety_report", category: "safety_doc" }],
  ["list_safety_reports", { capabilityIRI: "safety:capability/list_safety_reports", category: "safety_doc" }],
] as const satisfies readonly (readonly [string, CapabilityRegistryEntry])[];

export const CAPABILITY_IRI_BY_TOOL = new Map<string, CapabilityIRI>(
  CAPABILITY_REGISTRY_ENTRIES.map(([toolName, entry]) => [toolName, entry.capabilityIRI]),
);

export const CAPABILITY_CATEGORY_BY_TOOL = new Map<string, CapabilityCategory>([
  ["search_accident_cases", "accident_search"],
  ["get_accident_case_attachments", "accident_search"],
  ["search_construction_fatal_accidents", "accident_search"],
  ["search_all_fatal_accidents", "accident_search"],
  ["search_safety_materials", "safety_materials"],
  ["search_msds", "safety_materials"],
  ["search_ppe_certification", "safety_materials"],
  ["search_kosha_archive", "kosha_search"],
  ["list_kosha_archive_facets", "kosha_search"],
  ["search_safety_laws", "kosha_search"],
  ["search_sif_archive", "sif_archive"],
  ["list_construction_subtasks", "construction"],
  ["get_safety_law_article", "kosha_search"],
  ["list_core_safety_laws", "kosha_search"],
  ["get_foreign_worker_resource_links", "safety_materials"],
  ["get_kras_method", "safety_doc"],
  ["get_kosha_archive_files", "kosha_search"],
  ["get_project_info", "meta"],
  ["get_official_form", "safety_doc"],
  ["query_legal_basis", "safety_doc"],
  ["query_penalty", "safety_doc"],
  ["list_safety_documents_by_cycle", "safety_doc"],
  ["get_safety_document_guide", "safety_doc"],
  ["get_risk_assessment_schema", "safety_doc"],
  ["get_work_plan_schema", "safety_doc"],
  ["get_tbm_schema", "safety_doc"],
  ["get_ops_schema", "safety_doc"],
  ["get_work_permit_schema", "safety_doc"],
  ["list_kras_methods", "safety_doc"],
  ["choose_assessment_method", "safety_doc"],
  ["verify_safety_basis", "safety_doc"],
  ["review_safety_document", "safety_doc"],
  ["generate_safety_document", "safety_doc"],
  ["submit_safety_document", "safety_doc"],
  ["query_applicability", "safety_doc"],
  ["field_safety_briefing", "construction"],
  ["analyze_construction_work_risks", "construction"],
  ["compile_safety_references", "safety_doc"],
  ["query_delegation_chain", "safety_doc"],
  ["query_guide_links", "safety_doc"],
  ["register_site", "site_profile"],
  ["register_project", "site_profile"],
  ["register_person", "site_profile"],
  ["register_equipment", "site_profile"],
  ["register_contractor", "site_profile"],
  ["get_site_profile", "site_profile"],
  ["clear_site_profile", "site_profile"],
  ["link_company_key", "site_profile"],
  ["unlink_company_key", "site_profile"],
  ["get_company_info", "site_profile"],
  ["sync_to_cloud", "site_profile"],
  ["assess_my_obligations", "safety_doc"],
  ["get_submission_info", "safety_doc"],
  ["get_retention_status", "safety_doc"],
  ["list_upcoming_duties", "safety_doc"],
  ["get_incident_response_workflow", "safety_doc"],
  ["get_construction_stage_duties", "construction"],
  ["list_downloadable_forms", "safety_doc"],
  ["export_drafted_document", "safety_doc"],
  ["assemble_doc_context", "safety_doc"],
  ["render_a2ui_form", "meta"],
  // ADR 002 Active Graph Authoring Loop — 4 신규 도구 (v1.4.0)
  ["request_field_help", "safety_doc"],
  ["suggest_controls_for_hazard", "safety_doc"],
  ["analyze_work_context", "construction"],
  ["preview_review", "safety_doc"],
  ["render_profile_input_form", "site_profile"],
  ["save_profile_from_form", "site_profile"],
  ["save_form_draft", "meta"],
  ["load_form_draft", "meta"],
  ["list_form_drafts", "meta"],
  ["archive_safety_document", "meta"],
  ["list_archived_documents", "meta"],
  ["get_storage_stats", "meta"],
  // 누락 entry (외부 평가 P0-1 보강)
  ["search_safety_law_smart", "kosha_search"],
  ["get_kosha_guide_md", "kosha_search"],
  ["get_measures_by_risk", "safety_doc"],
  ["get_ppe_by_task", "safety_doc"],
  ["generate_tbm_topics", "safety_doc"],
  ["upload_photo_evidence", "site_profile"],
  ["list_photos_by_site", "site_profile"],
  ["list_photos_by_task", "site_profile"],
  ["get_photo_evidence", "site_profile"],
  ["register_safety_issue", "safety_doc"],
  ["list_open_issues", "safety_doc"],
  ["update_issue_status", "safety_doc"],
  ["get_safety_issue", "safety_doc"],
  ["record_corrective_action", "safety_doc"],
  ["complete_action", "safety_doc"],
  ["list_pending_actions", "safety_doc"],
  ["get_corrective_action", "safety_doc"],
  ["generate_safety_report", "safety_doc"],
  ["list_safety_reports", "safety_doc"],
]);

export function getCapabilityIRI(toolName: string): CapabilityIRI | undefined {
  return CAPABILITY_IRI_BY_TOOL.get(toolName);
}

export function getCapabilityCategory(toolName: string): CapabilityCategory | undefined {
  return CAPABILITY_CATEGORY_BY_TOOL.get(toolName);
}

// capability 노드 71개를 단일 MCP Resource 로 노출한다.
export function registerCapabilities(server: McpServer): void {
  server.registerResource(
    "graph-capabilities",
    CAPABILITIES_RESOURCE_URI,
    {
      title: "Safety Capability Registry",
      description:
        "88 MCP tools 를 safety:Capability/prov:Plan 노드로 묶은 capability registry. LLM 이 toolName, category, action, object type 을 한 번에 읽는 entry point.",
      mimeType: "application/ld+json",
    },
    async () => {
      const files = (await readdir(CAPABILITIES_DIR))
        .filter((fileName) => fileName.endsWith(".jsonld"))
        .sort();
      const nodes = await Promise.all(
        files.map(async (fileName) => {
          const text = await readFile(resolve(CAPABILITIES_DIR, fileName), "utf-8");
          return JSON.parse(text) as unknown;
        }),
      );
      const graph = {
        "@context": CAPABILITY_CONTEXT_URI,
        "@id": CAPABILITIES_RESOURCE_URI,
        "@type": "safety:GraphCategory",
        category: "capabilities",
        count: nodes.length,
        "@graph": nodes,
      };
      return {
        contents: [
          {
            uri: CAPABILITIES_RESOURCE_URI,
            mimeType: "application/ld+json",
            text: JSON.stringify(graph, null, 2),
          },
        ],
      };
    },
  );
}
