/**
 * site-profile-tools.ts
 *
 * 5종 register_* + get_site_profile + clear_site_profile 도구.
 * 사용자 SSoT (사업장·현장·직원·장비·수급업체) CRUD.
 */
import { z } from "zod";
import {
  loadProfile,
  saveProfile,
  invalidateProfileCache,
  getProfilePath,
  makeId,
  Profile,
  Site,
  Project,
  Person,
  Equipment,
  Contractor,
} from "../lib/site-profile.js";
import type { ToolDefinition as McpToolDefinition } from "../lib/types.js";
// Issue #7 (2026-05-21) — MCP 응답 텍스트 PII 마스킹.
// structuredContent 는 평문 유지 (저장·재호출용), 사용자 표시 text 만 마스킹.
import { maskBusinessNumber, maskName, maskPhone, maskEmail } from "../lib/pii-masking.js";

// ─── register_site ───
const RegisterSiteInput = z.object({
  name: z.string().describe("사업장명 (예: 황룡건설(주))"),
  businessNumber: z.string().describe("사업자등록번호 (예: 123-45-67890)"),
  address: z.string().describe("사업장 주소"),
  ownerName: z.string().describe("대표자 성명"),
  industryCode: z.string().optional().describe("KSIC 5자리 (예: 41112 건설업)"),
  workerCountTotal: z.number().optional().describe("상시 근로자 수"),
  representativeContact: z.string().optional().describe("대표 연락처"),
  establishedDate: z.string().optional().describe("설립일 YYYY-MM-DD"),
});

const registerSite: McpToolDefinition = {
  name: "register_site",
  description:
    "사용자 SSoT — 사업장 등록. 한 번 등록 후 모든 94종 양식이 자동 참조. 저장 위치: ~/.agent-safety-oss/profile.jsonld",
  inputSchema: RegisterSiteInput,
  handler: async (raw) => {
    const input = RegisterSiteInput.parse(raw);
    const profile = await loadProfile();
    const newSite = {
      "@id": makeId("site", input.name),
      "@type": "Site",
      ...input,
    } as Site;
    const idx = profile.sites.findIndex((s) => s["@id"] === newSite["@id"]);
    if (idx >= 0) profile.sites[idx] = newSite;
    else profile.sites.push(newSite);
    await saveProfile(profile);
    return {
      content: [
        {
          type: "text" as const,
          text: `✅ 사업장 등록 완료\n\n  ID: \`${newSite["@id"]}\`\n  이름: ${newSite.name}\n  사업자번호: ${maskBusinessNumber(newSite.businessNumber)}\n  대표자: ${maskName(newSite.ownerName)}\n\n저장 위치: ${getProfilePath()}\n\n> 🔒 PII 보호 — 사업자번호·대표자명은 표시용으로 마스킹됨 (저장된 structuredContent 는 평문 유지).\n다음 단계: register_project / register_person 으로 현장·직원 추가.`,
        },
      ],
      structuredContent: { site: newSite, profilePath: getProfilePath() },
    };
  },
};

// ─── register_project ───
const RegisterProjectInput = z.object({
  siteId: z.string().describe("사업장 ID (register_site 결과). 예: 'site:황룡건설(주)'"),
  name: z.string().describe("현장·공사명"),
  contractAmount: z.number().optional().describe("도급금액 (원)"),
  contractStart: z.string().optional().describe("계약 시작 YYYY-MM-DD"),
  contractEnd: z.string().optional().describe("계약 종료 YYYY-MM-DD"),
  constructionType: z.string().optional().describe("공사 종류 (건축·토목·전기 등)"),
  scale: z.string().optional().describe("공사 규모 (예: 지하1+지상7, 연면적 5800㎡)"),
  address: z.string().optional().describe("현장 주소"),
  ordererName: z.string().optional().describe("발주자명"),
  designerName: z.string().optional().describe("설계사명"),
  workerMale: z.number().optional().describe("남성 근로자 수"),
  workerFemale: z.number().optional().describe("여성 근로자 수"),
  safetyCostBudget: z.number().optional().describe("안전보건관리비 예산 (원)"),
});

const registerProject: McpToolDefinition = {
  name: "register_project",
  description: "사용자 SSoT — 현장·공사 등록. 사업장 1개에 현장 여러 개 가능.",
  inputSchema: RegisterProjectInput,
  handler: async (raw) => {
    const input = RegisterProjectInput.parse(raw);
    const profile = await loadProfile();
    const project: Project = {
      "@id": makeId("project", input.name),
      "@type": "Project",
      site: input.siteId,
      name: input.name,
      contractAmount: input.contractAmount,
      contractPeriod: input.contractStart && input.contractEnd ? { start: input.contractStart, end: input.contractEnd } : undefined,
      constructionType: input.constructionType,
      scale: input.scale,
      address: input.address,
      ordererName: input.ordererName,
      designerName: input.designerName,
      workerCount: input.workerMale !== undefined && input.workerFemale !== undefined ? { male: input.workerMale, female: input.workerFemale } : undefined,
      safetyCostBudget: input.safetyCostBudget,
    };
    const idx = profile.projects.findIndex((p) => p["@id"] === project["@id"]);
    if (idx >= 0) profile.projects[idx] = project;
    else profile.projects.push(project);
    await saveProfile(profile);
    return {
      content: [{ type: "text" as const, text: `✅ 현장 등록\n  ID: \`${project["@id"]}\`\n  이름: ${project.name}\n  사업장: ${input.siteId}\n\n다음: register_person / register_equipment / register_contractor` }],
      structuredContent: { project },
    };
  },
};

// ─── register_person ───
const RegisterPersonInput = z.object({
  name: z.string().describe("성명"),
  role: z.string().describe("역할 (안전관리자/관리감독자/현장소장/근로자대표/사업주/작업자/신호수 등)"),
  siteId: z.string().optional().describe("소속 사업장 ID"),
  projectId: z.string().optional().describe("소속 현장 ID"),
  title: z.string().optional().describe("직책"),
  qualification: z.string().optional().describe("자격 (예: 산업안전기사, 5년 경력)"),
  phone: z.string().optional().describe("연락처"),
  email: z.string().optional().describe("이메일"),
  birthDate: z.string().optional().describe("생년월일 YYYY-MM-DD"),
  nationality: z.string().optional().describe("국적"),
  employer: z.string().optional().describe("소속업체"),
  employmentType: z.enum(["정규", "계약", "일용", "파견", "도급"]).optional(),
  hireDate: z.string().optional().describe("입사일"),
});

const registerPerson: McpToolDefinition = {
  name: "register_person",
  description: "사용자 SSoT — 직원·근로자 등록. role 에 '안전관리자', '관리감독자', '현장소장', '근로자대표' 명시 시 결재선 자동 구성됨.",
  inputSchema: RegisterPersonInput,
  handler: async (raw) => {
    const input = RegisterPersonInput.parse(raw);
    const profile = await loadProfile();
    const person = {
      "@id": makeId("person", input.name),
      "@type": "Person",
      ...input,
      site: input.siteId,
      project: input.projectId,
    } as Person;
    const idx = profile.persons.findIndex((p) => p["@id"] === person["@id"]);
    if (idx >= 0) profile.persons[idx] = person;
    else profile.persons.push(person);
    await saveProfile(profile);
    return {
      content: [{ type: "text" as const, text: `✅ 직원 등록\n  ID: \`${person["@id"]}\`\n  ${maskName(person.name)} (${person.role})${person.qualification ? ", " + person.qualification : ""}\n\n> 🔒 성명은 마스킹됨 (structuredContent 평문 유지).` }],
      structuredContent: { person },
    };
  },
};

// ─── register_equipment ───
const RegisterEquipmentInput = z.object({
  name: z.string().describe("장비명 (예: 타워크레인 TC-A동)"),
  model: z.string().optional().describe("모델명 (예: LIEBHERR 280EC-H 12)"),
  manufacturer: z.string().optional(),
  serialNumber: z.string().optional(),
  ratedCapacity: z.string().optional().describe("정격하중 (예: 12톤)"),
  workingRadius: z.string().optional().describe("작업반경"),
  safetyInspectionDate: z.string().optional().describe("안전검사 일자"),
  safetyInspectionCertNo: z.string().optional().describe("안전검사필증 번호"),
  qualifiedOperators: z.array(z.string()).optional().describe("자격 운전자 person:* IDs"),
  installLocation: z.string().optional(),
  siteId: z.string().optional(),
  projectId: z.string().optional(),
});

const registerEquipment: McpToolDefinition = {
  name: "register_equipment",
  description: "사용자 SSoT — 기계·장비 등록. 작업계획서·작업허가서·점검표에 자동 참조.",
  inputSchema: RegisterEquipmentInput,
  handler: async (raw) => {
    const input = RegisterEquipmentInput.parse(raw);
    const profile = await loadProfile();
    const eq = {
      "@id": makeId("equipment", input.name),
      "@type": "Equipment",
      ...input,
      site: input.siteId,
      project: input.projectId,
    } as Equipment;
    const idx = profile.equipments.findIndex((e) => e["@id"] === eq["@id"]);
    if (idx >= 0) profile.equipments[idx] = eq;
    else profile.equipments.push(eq);
    await saveProfile(profile);
    return {
      content: [{ type: "text" as const, text: `✅ 장비 등록\n  ID: \`${eq["@id"]}\`\n  ${eq.name}${eq.model ? " (" + eq.model + ")" : ""}` }],
      structuredContent: { equipment: eq },
    };
  },
};

// ─── register_contractor ───
const RegisterContractorInput = z.object({
  projectId: z.string().describe("도급 대상 현장 ID"),
  name: z.string().describe("수급업체명"),
  ceo: z.string().describe("대표자"),
  businessNumber: z.string().optional(),
  contractAmount: z.number().optional(),
  scope: z.string().optional().describe("작업 범위"),
  contractStart: z.string().optional(),
  contractEnd: z.string().optional(),
  representativeOnSite: z.string().optional().describe("현장 책임자명"),
  workerCount: z.number().optional(),
  safetyManagerName: z.string().optional(),
});

const registerContractor: McpToolDefinition = {
  name: "register_contractor",
  description: "사용자 SSoT — 수급업체 등록. 도급계약·협의체·합동점검 등 도급 관련 양식에 자동 참조.",
  inputSchema: RegisterContractorInput,
  handler: async (raw) => {
    const input = RegisterContractorInput.parse(raw);
    const profile = await loadProfile();
    const c: Contractor = {
      "@id": makeId("contractor", input.name),
      "@type": "Contractor",
      project: input.projectId,
      name: input.name,
      ceo: input.ceo,
      businessNumber: input.businessNumber,
      contractAmount: input.contractAmount,
      scope: input.scope,
      contractPeriod: input.contractStart && input.contractEnd ? { start: input.contractStart, end: input.contractEnd } : undefined,
      representativeOnSite: input.representativeOnSite,
      workerCount: input.workerCount,
      safetyManagerName: input.safetyManagerName,
    };
    const idx = profile.contractors.findIndex((x) => x["@id"] === c["@id"]);
    if (idx >= 0) profile.contractors[idx] = c;
    else profile.contractors.push(c);
    await saveProfile(profile);
    return {
      content: [{ type: "text" as const, text: `✅ 수급업체 등록\n  ID: \`${c["@id"]}\`\n  ${c.name} (대표 ${maskName(c.ceo)})${c.businessNumber ? `, 사업자 ${maskBusinessNumber(c.businessNumber)}` : ""}\n\n> 🔒 대표자명·사업자번호는 마스킹됨 (structuredContent 평문 유지).` }],
      structuredContent: { contractor: c },
    };
  },
};

// ─── get_site_profile ───
const GetProfileInput = z.object({
  type: z.enum(["all", "sites", "projects", "persons", "equipments", "contractors"]).default("all").describe("조회 종류"),
});

const getSiteProfile: McpToolDefinition = {
  name: "get_site_profile",
  description: "사용자 SSoT 조회 — 등록된 사업장·현장·직원·장비·수급업체 전체 또는 카테고리별.",
  inputSchema: GetProfileInput,
  handler: async (raw) => {
    const input = GetProfileInput.parse(raw);
    const profile = await loadProfile();
    const lines: string[] = [];
    lines.push(`# 사용자 SSoT 프로파일 (${getProfilePath()})\n`);
    lines.push(`📅 갱신: ${profile._meta.updatedAt}\n`);
    if (input.type === "all" || input.type === "sites") {
      lines.push(`## 사업장 ${profile.sites.length}개`);
      for (const s of profile.sites) lines.push(`  - \`${s["@id"]}\` ${s.name} | 사업자번호 ${maskBusinessNumber(s.businessNumber)} | 대표 ${maskName(s.ownerName)}`);
      lines.push("");
    }
    if (input.type === "all" || input.type === "projects") {
      lines.push(`## 현장 ${profile.projects.length}개`);
      for (const p of profile.projects) lines.push(`  - \`${p["@id"]}\` ${p.name} (${p.contractAmount?.toLocaleString() ?? "-"}원, 사업장: ${p.site})`);
      lines.push("");
    }
    if (input.type === "all" || input.type === "persons") {
      lines.push(`## 직원·근로자 ${profile.persons.length}명`);
      for (const p of profile.persons) lines.push(`  - \`${p["@id"]}\` ${maskName(p.name)} (${p.role})${p.qualification ? " — " + p.qualification : ""}`);
      lines.push("");
    }
    if (input.type === "all" || input.type === "equipments") {
      lines.push(`## 장비 ${profile.equipments.length}대`);
      for (const e of profile.equipments) lines.push(`  - \`${e["@id"]}\` ${e.name}${e.model ? " (" + e.model + ")" : ""}`);
      lines.push("");
    }
    if (input.type === "all" || input.type === "contractors") {
      lines.push(`## 수급업체 ${profile.contractors.length}개`);
      for (const c of profile.contractors) lines.push(`  - \`${c["@id"]}\` ${c.name} (대표 ${maskName(c.ceo)}, 현장: ${c.project})`);
      lines.push("");
    }
    lines.push(`> 🔒 PII (사업자번호·성명) 은 표시용으로 마스킹됨. 원본은 \`${getProfilePath()}\` 에 평문 저장.`);
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      structuredContent: { profile, profilePath: getProfilePath() },
    };
  },
};

// ─── clear_site_profile ───
const ClearProfileInput = z.object({
  confirm: z.literal(true).describe("진짜 삭제할지 확인 (true)"),
});

const clearSiteProfile: McpToolDefinition = {
  name: "clear_site_profile",
  description: "⚠️ 모든 SSoT 프로파일 삭제. 복구 불가.",
  inputSchema: ClearProfileInput,
  handler: async () => {
    const empty: Profile = {
      "@context": { "@vocab": "https://agent-safety-oss/vocab/profile#" },
      _meta: {
        version: "0.1.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: "사용자 SSoT (초기화됨)",
      },
      sites: [],
      projects: [],
      persons: [],
      equipments: [],
      contractors: [],
    };
    await saveProfile(empty);
    invalidateProfileCache();
    return { content: [{ type: "text" as const, text: "✅ 프로파일 초기화 완료" }] };
  },
};

export const SITE_PROFILE_TOOLS: McpToolDefinition[] = [
  registerSite,
  registerProject,
  registerPerson,
  registerEquipment,
  registerContractor,
  getSiteProfile,
  clearSiteProfile,
];
