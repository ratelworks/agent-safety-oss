/**
 * save_profile_from_form
 *
 * render_profile_input_form 의 사용자 입력 dataModel(JSON object)을 받아 profile.jsonld 갱신.
 * 기존 register_site/project/person/equipment/contractor 7도구를 단일 진입점으로 통합.
 *
 * 입력 형식:
 *   formValues: {
 *     "site.name": "황룡건설(주)",
 *     "site.businessNumber": "123-45-67890",
 *     ...
 *     "project.name": "서울 OO현장",
 *     ...
 *     "person0.name": "홍길동",  // index 0=안전관리자, 1=관리감독자, 2=현장소장, 3=근로자대표
 *     ...
 *     "equipment0.name": "타워크레인",
 *     ...
 *     "contractor0.name": "(주)OO건설",
 *     ...
 *   }
 *
 * 처리:
 *   - 빈 값 무시 (기존 값 유지)
 *   - profile 5 entity 모두 갱신
 *   - @id 자동 생성 (없는 경우)
 *
 * 후속:
 *   - 더 많은 직원·장비·수급업체는 register_person/equipment/contractor 도구 사용
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  loadProfile,
  saveProfile,
  invalidateProfileCache,
  makeId,
  type Site,
  type Project,
  type Person,
  type Equipment,
  type Contractor,
  type Profile,
} from "../lib/site-profile.js";

const PERSON_ROLES = ["안전관리자", "관리감독자", "현장소장", "근로자대표"];

const inputSchema = z.object({
  formValues: z.record(z.string()).describe("폼 입력값 — key: 'site.name', 'project.name', 'person0.name' 등"),
  /** 기존 profile 덮어쓰기 vs 병합 */
  mode: z.enum(["merge", "replace"]).default("merge"),
});


function trim(s: string | undefined | null): string | undefined {
  if (s === undefined || s === null) return undefined;
  const t = String(s).trim();
  return t.length > 0 ? t : undefined;
}

function num(s: string | undefined): number | undefined {
  const t = trim(s);
  if (t === undefined) return undefined;
  const n = Number(t.replace(/[,_]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

interface SaveStats {
  siteUpdated: boolean;
  projectUpdated: boolean;
  personsUpdated: number;
  equipmentsUpdated: number;
  contractorsUpdated: number;
  fieldsApplied: number;
  fieldsSkipped: number;
}

async function applyFormValues(
  profile: Profile,
  formValues: Record<string, string>,
  mode: "merge" | "replace",
): Promise<SaveStats> {
  const stats: SaveStats = {
    siteUpdated: false,
    projectUpdated: false,
    personsUpdated: 0,
    equipmentsUpdated: 0,
    contractorsUpdated: 0,
    fieldsApplied: 0,
    fieldsSkipped: 0,
  };

  if (mode === "replace") {
    profile.sites = [];
    profile.projects = [];
    profile.persons = [];
    profile.equipments = [];
    profile.contractors = [];
  }

  // 1. Site (단일)
  const siteName = trim(formValues["site.name"]);
  if (siteName) {
    const existing = profile.sites[0];
    const site: Site = existing ?? {
      "@id": makeId("site", siteName),
      "@type": "Site",
      name: siteName,
      businessNumber: trim(formValues["site.businessNumber"]) ?? "",
      address: trim(formValues["site.address"]) ?? "",
      ownerName: trim(formValues["site.ownerName"]) ?? "",
    };
    site.name = siteName;
    if (trim(formValues["site.businessNumber"])) site.businessNumber = trim(formValues["site.businessNumber"])!;
    if (trim(formValues["site.address"])) site.address = trim(formValues["site.address"])!;
    if (trim(formValues["site.industryCode"])) site.industryCode = trim(formValues["site.industryCode"]);
    if (trim(formValues["site.ownerName"])) site.ownerName = trim(formValues["site.ownerName"])!;
    if (num(formValues["site.workerCountTotal"]) !== undefined) site.workerCountTotal = num(formValues["site.workerCountTotal"]);
    if (trim(formValues["site.industrialInsuranceNo"])) site.industrialInsuranceNo = trim(formValues["site.industrialInsuranceNo"]);
    if (trim(formValues["site.safetyHealthPolicy"])) site.safetyHealthPolicy = trim(formValues["site.safetyHealthPolicy"]);
    site.iso45001Class = "iso45001:Workplace";
    if (!existing) profile.sites = [site];
    else profile.sites[0] = site;
    stats.siteUpdated = true;
    stats.fieldsApplied += Object.keys(formValues).filter((k) => k.startsWith("site.") && trim(formValues[k])).length;
  } else {
    stats.fieldsSkipped += Object.keys(formValues).filter((k) => k.startsWith("site.")).length;
  }

  // 2. Project (단일)
  const projectName = trim(formValues["project.name"]);
  if (projectName) {
    const siteRef = profile.sites[0]?.["@id"] ?? makeId("site", "default");
    const existing = profile.projects[0];
    const project: Project = existing ?? {
      "@id": makeId("project", projectName),
      "@type": "Project",
      site: siteRef,
      name: projectName,
    };
    project.name = projectName;
    project.site = siteRef;
    if (trim(formValues["project.address"])) project.address = trim(formValues["project.address"]);
    if (num(formValues["project.contractAmount"]) !== undefined) project.contractAmount = num(formValues["project.contractAmount"]);
    const cs = trim(formValues["project.contractStart"]);
    const ce = trim(formValues["project.contractEnd"]);
    if (cs && ce) project.contractPeriod = { start: cs, end: ce };
    if (trim(formValues["project.constructionType"])) project.constructionType = trim(formValues["project.constructionType"]);
    if (trim(formValues["project.ordererName"])) project.ordererName = trim(formValues["project.ordererName"]);
    if (trim(formValues["project.designerName"])) project.designerName = trim(formValues["project.designerName"]);
    if (trim(formValues["project.supervisorName"])) project.supervisorName = trim(formValues["project.supervisorName"]);
    const wm = num(formValues["project.workerMale"]);
    const wf = num(formValues["project.workerFemale"]);
    if (wm !== undefined || wf !== undefined) {
      project.workerCount = { male: wm ?? 0, female: wf ?? 0 };
    }
    project.iso45001Class = "iso45001:Workplace";
    if (!existing) profile.projects = [project];
    else profile.projects[0] = project;
    stats.projectUpdated = true;
    stats.fieldsApplied += Object.keys(formValues).filter((k) => k.startsWith("project.") && trim(formValues[k])).length;
  } else {
    stats.fieldsSkipped += Object.keys(formValues).filter((k) => k.startsWith("project.")).length;
  }

  // 3. Person — 4 표준 역할
  const siteRef = profile.sites[0]?.["@id"];
  const projectRef = profile.projects[0]?.["@id"];
  for (let i = 0; i < PERSON_ROLES.length; i++) {
    const role = PERSON_ROLES[i];
    const name = trim(formValues[`person${i}.name`]);
    if (!name) continue;
    // 기존 같은 역할 매칭
    const existingIdx = profile.persons.findIndex((p) => p.role.includes(role));
    const person: Person = existingIdx >= 0 ? profile.persons[existingIdx] : {
      "@id": makeId("person", `${role}_${name}`),
      "@type": "Person",
      name,
      role,
    };
    person.name = name;
    person.role = role;
    if (siteRef) person.site = siteRef;
    if (projectRef) person.project = projectRef;
    if (trim(formValues[`person${i}.phone`])) person.phone = trim(formValues[`person${i}.phone`]);
    if (trim(formValues[`person${i}.qualification`])) person.qualification = trim(formValues[`person${i}.qualification`]);
    if (trim(formValues[`person${i}.title`])) person.title = trim(formValues[`person${i}.title`]);
    person.iso45001Class = "iso45001:Worker";
    if (existingIdx >= 0) profile.persons[existingIdx] = person;
    else profile.persons.push(person);
    stats.personsUpdated++;
    stats.fieldsApplied += Object.keys(formValues).filter((k) => k.startsWith(`person${i}.`) && trim(formValues[k])).length;
  }

  // 4. Equipment — 2 슬롯
  for (let i = 0; i < 2; i++) {
    const name = trim(formValues[`equipment${i}.name`]);
    if (!name) continue;
    const existingIdx = i;
    const eq: Equipment = profile.equipments[existingIdx] ?? {
      "@id": makeId("equipment", `${name}_${i}`),
      "@type": "Equipment",
      name,
    };
    eq.name = name;
    if (siteRef) eq.site = siteRef;
    if (projectRef) eq.project = projectRef;
    if (trim(formValues[`equipment${i}.serialNumber`])) eq.serialNumber = trim(formValues[`equipment${i}.serialNumber`]);
    if (trim(formValues[`equipment${i}.safetyInspectionDate`])) eq.safetyInspectionDate = trim(formValues[`equipment${i}.safetyInspectionDate`]);
    eq.iso45001Class = "iso45001:Workplace";
    profile.equipments[existingIdx] = eq;
    stats.equipmentsUpdated++;
    stats.fieldsApplied += Object.keys(formValues).filter((k) => k.startsWith(`equipment${i}.`) && trim(formValues[k])).length;
  }
  // 빈 슬롯 정리
  profile.equipments = profile.equipments.filter((e) => e?.name);

  // 5. Contractor — 2 슬롯
  for (let i = 0; i < 2; i++) {
    const name = trim(formValues[`contractor${i}.name`]);
    if (!name) continue;
    const existingIdx = i;
    const co: Contractor = profile.contractors[existingIdx] ?? {
      "@id": makeId("contractor", `${name}_${i}`),
      "@type": "Contractor",
      project: projectRef ?? "project:default",
      name,
      ceo: trim(formValues[`contractor${i}.ceo`]) ?? "",
    };
    co.name = name;
    if (projectRef) co.project = projectRef;
    if (trim(formValues[`contractor${i}.ceo`])) co.ceo = trim(formValues[`contractor${i}.ceo`])!;
    if (trim(formValues[`contractor${i}.scope`])) co.scope = trim(formValues[`contractor${i}.scope`]);
    co.iso45001Class = "iso45001:Workplace";
    profile.contractors[existingIdx] = co;
    stats.contractorsUpdated++;
    stats.fieldsApplied += Object.keys(formValues).filter((k) => k.startsWith(`contractor${i}.`) && trim(formValues[k])).length;
  }
  profile.contractors = profile.contractors.filter((c) => c?.name);

  return stats;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);
  const profile = await loadProfile();
  const stats = await applyFormValues(profile, args.formValues, args.mode);

  await saveProfile(profile);
  invalidateProfileCache();

  const lines: string[] = [];
  lines.push(`# Profile 저장 완료`);
  lines.push("");
  lines.push(`✅ 사업장 (Site):     ${stats.siteUpdated ? "갱신" : "변경 없음"}`);
  lines.push(`✅ 현장 (Project):    ${stats.projectUpdated ? "갱신" : "변경 없음"}`);
  lines.push(`✅ 핵심 인력:         ${stats.personsUpdated}명 갱신`);
  lines.push(`✅ 주요 장비:         ${stats.equipmentsUpdated}대 갱신`);
  lines.push(`✅ 수급업체:          ${stats.contractorsUpdated}곳 갱신`);
  lines.push("");
  lines.push(`적용된 필드: ${stats.fieldsApplied}`);
  lines.push("");
  lines.push(`이제 모든 94종 법정의무문서가 위 정보를 자동으로 채웁니다.`);
  lines.push("");
  lines.push(`다음 단계:`);
  lines.push(`  • generate_safety_document({docId: "daily_tbm"}) — 자동 채움 적용 본문 생성`);
  lines.push(`  • assemble_doc_context({docId: "..."}) — 그래프 컨텍스트 + profile prefill`);
  lines.push(`  • render_a2ui_form({docId: "..."}) — A2UI 양식 폼 (자동 채움된 값으로 시작)`);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      ...stats,
      profileSummary: {
        sites: profile.sites.length,
        projects: profile.projects.length,
        persons: profile.persons.length,
        equipments: profile.equipments.length,
        contractors: profile.contractors.length,
      },
      nextActions: [
        "generate_safety_document 으로 자동 채움 양식 생성",
        "render_a2ui_form 으로 자동 채움된 양식 폼 출력",
        "추가 직원은 register_person 도구",
      ],
    },
  };
}

export const saveProfileFromFormTool: ToolDefinition = {
  name: "save_profile_from_form",
  title: "Profile 폼 입력 저장",
  description:
    "render_profile_input_form 의 dataModel JSON 을 받아 profile.jsonld 에 일괄 저장. 5 entity (Site/Project/Person×4/Equipment×2/Contractor×2) 통합 처리. 빈 값 무시 (mode=merge). 한 번 저장하면 94종 법정의무문서가 자동 채움.",
  inputSchema,
  handler,
};
