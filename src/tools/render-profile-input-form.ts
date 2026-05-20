/**
 * render_profile_input_form
 *
 * 모든 94종 법정문서가 자동 채움하는 *공통 핵심 메타*만 받는 단순 폼.
 *
 * 본질: autoFillFromProfile() 이 실제 fillIfEmpty 호출하는 14 필드만.
 *   Site:    siteName / businessNumber / address / industryCode / ownerName (5)
 *   Project: projectName / contractPeriod / contractAmount / constructionType / siteAddress (5)
 *   Person:  안전관리자·관리감독자·현장소장·근로자대표 성명 (4)
 *
 * 부가 정보(자격번호·연락처·산재보험번호·안전보건경영방침 본문·인접시설·검사이력 등)는
 * 자동 채움 대상이 *아니므로* 본 폼에서 제외. 필요 시 register_person/equipment/contractor
 * 도구로 별도 등록.
 *
 * A2UI 한계 준수:
 *   - 동적 추가/삭제 없음 → 4 결재선 고정
 *   - 추가 직원·장비·수급업체는 register_* 도구
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { loadProfile } from "../lib/site-profile.js";

const inputSchema = z.object({
  surfaceId: z.string().default("profile-form"),
  format: z.enum(["jsonl", "json"]).default("jsonl"),
  /** 기존 profile 자동 채움 (편집 모드) */
  prefillFromExisting: z.boolean().default(true),
});


interface A2UIComponent {
  id: string;
  component: string;
  [key: string]: unknown;
}

// 섹션별 필드 정의 (key, label, inputGuide, examples, profile path)
interface FormField {
  key: string; // form-field-* id
  label: string;
  profilePath: string; // profile.jsonld dot-path (예: "sites[0].name")
  inputGuide: string;
  examples: string[];
}

// === 핵심 공통 메타 — autoFillFromProfile 이 매 양식마다 채우는 14 필드 ===

const SITE_FIELDS: FormField[] = [
  { key: "site.name", label: "사업장명", profilePath: "sites[0].name", inputGuide: "법인등기부등본 또는 사업자등록증 상의 정식 명칭", examples: ["황룡건설(주)"] },
  { key: "site.businessNumber", label: "사업자등록번호", profilePath: "sites[0].businessNumber", inputGuide: "10자리, 하이픈 포함", examples: ["123-45-67890"] },
  { key: "site.address", label: "사업장 소재지", profilePath: "sites[0].address", inputGuide: "도로명주소 (모든 양식 사업장 주소로 사용)", examples: ["서울특별시 강남구 테헤란로 123"] },
  { key: "site.industryCode", label: "업종 (KSIC 코드)", profilePath: "sites[0].industryCode", inputGuide: "산재보험 사업종류 코드 또는 KSIC", examples: ["41122 (종합건설업)"] },
  { key: "site.ownerName", label: "대표자 성명", profilePath: "sites[0].ownerName", inputGuide: "결재선·서명에 사용", examples: ["황 룡"] },
];

const PROJECT_FIELDS: FormField[] = [
  { key: "project.name", label: "공사명 (현장명)", profilePath: "projects[0].name", inputGuide: "발주처 계약서 상의 공식 공사명 (건설 외 사업장은 비워둠)", examples: ["서울 OO구 OO동 신축공사"] },
  { key: "project.contractStart", label: "공사 시작일", profilePath: "projects[0].contractPeriod.start", inputGuide: "YYYY-MM-DD", examples: ["2026-04-01"] },
  { key: "project.contractEnd", label: "공사 종료일", profilePath: "projects[0].contractPeriod.end", inputGuide: "YYYY-MM-DD", examples: ["2027-12-31"] },
  { key: "project.contractAmount", label: "도급금액 (원)", profilePath: "projects[0].contractAmount", inputGuide: "안전관리비 산정 기준 (50억 이상은 추가 의무)", examples: ["1500000000"] },
  { key: "project.constructionType", label: "공종", profilePath: "projects[0].constructionType", inputGuide: "건설산업기본법 시행령 별표 1", examples: ["건축공사업", "토목공사업"] },
];

// 4 표준 결재선 역할 — 양식의 결재선·서명 자동 구성
const PERSON_ROLES: Array<{ role: string; profileRoleKeyword: string; required: boolean }> = [
  { role: "안전관리자", profileRoleKeyword: "안전관리자", required: true },
  { role: "관리감독자", profileRoleKeyword: "관리감독자", required: true },
  { role: "현장소장", profileRoleKeyword: "현장소장", required: true },
  { role: "근로자대표", profileRoleKeyword: "근로자대표", required: false },
];

function makePersonFields(roleSlot: number, role: string): FormField[] {
  return [
    {
      key: `person${roleSlot}.name`,
      label: `${role} 성명`,
      profilePath: `persons[${roleSlot}].name`,
      inputGuide: `결재선·서명에 자동 입력 (${role}은 산안법상 ${role.includes("안전관리자") ? "§17" : role.includes("관리감독자") ? "§16" : role.includes("현장소장") ? "§62 안전보건총괄책임자" : "§37"} 근거)`,
      examples: ["홍길동"],
    },
  ];
}

interface PrefillMap {
  [key: string]: string;
}

async function buildPrefill(): Promise<PrefillMap> {
  const profile = await loadProfile();
  const out: PrefillMap = {};

  const site = profile.sites[0];
  if (site) {
    if (site.name) out["site.name"] = site.name;
    if (site.businessNumber) out["site.businessNumber"] = site.businessNumber;
    if (site.address) out["site.address"] = site.address;
    if (site.industryCode) out["site.industryCode"] = site.industryCode;
    if (site.ownerName) out["site.ownerName"] = site.ownerName;
  }

  const project = profile.projects[0];
  if (project) {
    if (project.name) out["project.name"] = project.name;
    if (project.contractPeriod?.start) out["project.contractStart"] = project.contractPeriod.start;
    if (project.contractPeriod?.end) out["project.contractEnd"] = project.contractPeriod.end;
    if (project.contractAmount !== undefined) out["project.contractAmount"] = String(project.contractAmount);
    if (project.constructionType) out["project.constructionType"] = project.constructionType;
  }

  // 결재선 4 역할 성명만
  for (let i = 0; i < PERSON_ROLES.length; i++) {
    const roleDef = PERSON_ROLES[i];
    const matched = profile.persons.find((p) => p.role.includes(roleDef.profileRoleKeyword));
    if (matched) {
      out[`person${i}.name`] = matched.name;
    }
  }

  return out;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);
  const surface = args.surfaceId;

  const prefill = args.prefillFromExisting ? await buildPrefill() : {};

  const components: A2UIComponent[] = [];

  // root
  components.push({
    id: "root",
    component: "Column",
    children: ["title", "intro", "intro-note", "section-site", "section-project", "section-person", "actions"],
  });

  components.push({ id: "title", component: "Text", text: "공통 메타 등록 (모든 양식 자동 채움)", usageHint: "h1" });
  components.push({
    id: "intro",
    component: "Text",
    text: "94종 법정문서가 공통으로 사용하는 핵심 14개 필드만 받습니다. 사업장 5 + 공사 5 + 결재선 4명. 한 번 입력하면 모든 양식에 자동 채움.",
    usageHint: "body",
  });
  components.push({
    id: "intro-note",
    component: "Text",
    text: "💡 자격번호·연락처·산재보험번호·안전보건경영방침 본문 등 양식별 부가 정보는 별도 등록 도구로 추가하세요.",
    usageHint: "caption",
  });

  // 섹션 빌더
  function buildSection(sectionId: string, title: string, fields: FormField[]): void {
    const sectionChildren: string[] = [`${sectionId}-title`];
    components.push({ id: `${sectionId}-title`, component: "Text", text: title, usageHint: "h2" });

    for (const f of fields) {
      const fieldId = `${sectionId}-${f.key.replace(/\./g, "-")}`;
      sectionChildren.push(fieldId);
      components.push({
        id: fieldId,
        component: "Column",
        children: [`${fieldId}-input`, `${fieldId}-guide`],
      });
      components.push({
        id: `${fieldId}-input`,
        component: "TextField",
        fieldKey: f.key,
        profilePath: f.profilePath,
        label: f.label,
        value: prefill[f.key] ?? "",
        placeholder: f.examples[0] ?? "",
        usageHint: f.label.includes("본문") ? "longText" : "shortText",
      });
      const guide = `💡 ${f.inputGuide}` + (f.examples[0] ? ` · 예: ${f.examples[0]}` : "");
      components.push({ id: `${fieldId}-guide`, component: "Text", text: guide, usageHint: "caption" });
    }

    components.push({ id: sectionId, component: "Card", child: `${sectionId}-col` });
    components.push({ id: `${sectionId}-col`, component: "Column", children: sectionChildren });
  }

  buildSection("section-site", "1. 사업장 (5)", SITE_FIELDS);
  buildSection("section-project", "2. 현재 공사 (5, 건설업만)", PROJECT_FIELDS);

  // 결재선 4 역할 — 성명만
  const personFields: FormField[] = [];
  for (let i = 0; i < PERSON_ROLES.length; i++) {
    personFields.push(...makePersonFields(i, PERSON_ROLES[i].role));
  }
  buildSection("section-person", "3. 결재선 4 인력 (성명만)", personFields);

  // actions
  components.push({
    id: "actions",
    component: "Row",
    children: ["save-btn", "clear-btn"],
    distribution: "spaceBetween",
  });
  components.push({
    id: "save-btn",
    component: "Button",
    child: "save-text",
    action: { name: "save_profile_from_form", payload: { surfaceId: surface } },
  });
  components.push({ id: "save-text", component: "Text", text: "💾 저장 — 이후 모든 양식에 자동 채움" });
  components.push({
    id: "clear-btn",
    component: "Button",
    child: "clear-text",
    action: { name: "clear_site_profile", payload: { confirm: true } },
  });
  components.push({ id: "clear-text", component: "Text", text: "🗑 초기화" });

  const messages = [
    { createSurface: { surfaceId: surface, catalogId: "standard" } },
    { updateComponents: { surfaceId: surface, root: "root", components } },
  ];

  // 모든 form key → profile path 매핑 (save_profile_from_form 가 사용)
  const fieldPathMap: Record<string, string> = {};
  for (const f of SITE_FIELDS) fieldPathMap[f.key] = f.profilePath;
  for (const f of PROJECT_FIELDS) fieldPathMap[f.key] = f.profilePath;
  for (let i = 0; i < PERSON_ROLES.length; i++) {
    for (const f of makePersonFields(i, PERSON_ROLES[i].role)) fieldPathMap[f.key] = f.profilePath;
  }

  const output =
    args.format === "jsonl"
      ? messages.map((m) => JSON.stringify(m)).join("\n")
      : JSON.stringify({ messages }, null, 2);

  return {
    content: [{ type: "text", text: output }],
    structuredContent: {
      surfaceId: surface,
      sections: 3,
      siteFields: SITE_FIELDS.length,
      projectFields: PROJECT_FIELDS.length,
      personSlots: PERSON_ROLES.length,
      totalFields: SITE_FIELDS.length + PROJECT_FIELDS.length + PERSON_ROLES.length,
      prefilledCount: Object.keys(prefill).length,
      componentCount: components.length,
      fieldPathMap,
      a2uiVersion: "v0.9",
      principle: "공통 메타만 — autoFillFromProfile 이 매 양식마다 fillIfEmpty 호출하는 14 필드",
      nextActions: [
        "Claude Desktop / MCP Inspector 가 폼 렌더 → 사용자 입력",
        "사용자가 LLM 에 입력값 전달 → save_profile_from_form 호출",
        "이후 generate_safety_document / render_a2ui_form 시 자동 채움",
        "추가 부가 정보(자격번호·연락처·산재보험번호 등)는 register_person/site 등 도구로",
      ],
    },
  };
}

export const renderProfileInputFormTool: ToolDefinition = {
  name: "render_profile_input_form",
  title: "공통 메타 입력 폼 (모든 양식 자동 채움)",
  description:
    "94종 법정문서가 공통으로 사용하는 핵심 14 필드만 받는 A2UI v0.9 폼. 사업장 5(사업장명·사업자번호·주소·업종코드·대표자) + 현재 공사 5(공사명·기간·금액·공종) + 결재선 4명(안전관리자·관리감독자·현장소장·근로자대표 성명). 한 번 저장하면 모든 양식이 자동 채움. 부가 정보는 register_* 도구로 별도 등록.",
  inputSchema,
  handler,
};
