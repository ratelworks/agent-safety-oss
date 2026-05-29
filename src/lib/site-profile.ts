/**
 * site-profile.ts
 *
 * 사용자 사업장·현장 SSoT (Single Source of Truth).
 *
 * 한 번 등록한 사업장·현장·직원·장비·수급업체 정보는 모든 94종 양식에서 자동 참조됨.
 *
 * 저장 위치: ~/.agent-safety-oss/profile.jsonld
 *   - 사용자 홈 디렉토리에 영구 저장
 *   - 파일 형식: JSON-LD (그래프 호환)
 *   - 직접 편집 가능
 *
 * 사용 흐름:
 *   1) register_site_profile 로 사업장 등록
 *   2) register_project 로 현장 등록 (사업장 1개에 현장 여러 개 가능)
 *   3) register_person / register_equipment / register_contractor 추가
 *   4) generate_safety_document(useProfile: true) 시 자동 채움
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { ensureSecureDir, writeSecureJson } from "./secure-fs.js";
// Issue #5 lateral (2026-05-22) — KST 기준 작성일 자동 채움
import { kstToday } from "./datetime-kst.js";

// SAFETY_LOCAL_DIR 환경변수가 있으면 그 디렉토리를 루트로 사용. photo·issue·action·report
// 등 다른 로컬 저장소(corrective-action-storage 의 getSafetyLocalDir)와 동일 정책.
// 테스트·CLI 격리 시 빈 임시 디렉토리를 지정하면 홈 프로필이 새지 않는다.
// 모듈 로드 시점 한 번이 아니라 호출 시점에 평가 — 환경변수 변경이 즉시 반영되게.
function getProfileDir(): string {
  const override = process.env.SAFETY_LOCAL_DIR?.trim();
  return override ? resolve(override) : resolve(homedir(), ".agent-safety-oss");
}
function getProfileFilePath(): string {
  return resolve(getProfileDir(), "profile.jsonld");
}

export interface Site {
  "@id": string;
  "@type": "Site";
  name: string;
  businessNumber: string;
  address: string;
  industryCode?: string;
  industrySubCategory?: string;            // 업종 세분류 (예: 종합건설업 - 토목건축공사업)
  ownerName: string;
  ownerSignature?: string;
  workerCountTotal?: number;
  representativeContact?: string;
  establishedDate?: string;
  headOfficeAddress?: string;              // 본사 주소 (현장과 다른 경우)
  safetyHealthPolicy?: string;             // 안전보건경영방침 본문 (산안법 §14)
  safetyHealthPolicyDate?: string;         // 방침 공표일
  industrialInsuranceNo?: string;          // 산재보험 사업장관리번호
  employmentInsuranceNo?: string;          // 고용보험 사업장관리번호
  iso45001Class?: "iso45001:Workplace";    // ISO 45001 매핑
}

export interface Project {
  "@id": string;
  "@type": "Project";
  site: string;
  name: string;
  contractAmount?: number;
  contractPeriod?: { start: string; end: string };
  constructionType?: string;
  scale?: string;
  address?: string;
  ordererName?: string;
  designerName?: string;
  supervisorName?: string;                 // 감리자명
  workerCount?: { male: number; female: number };
  safetyCostBudget?: number;
  // 인접시설 (굴착·전기·기계작업 시 영향)
  adjacentFacilities?: {
    gas?: { exists: boolean; depth?: string; provider?: string };          // 도시가스 매설
    power?: { exists: boolean; voltage?: string; type?: "overhead" | "underground" };  // 전력선
    waterSupply?: { exists: boolean; depth?: string };                     // 상수도
    sewerage?: { exists: boolean; depth?: string };                        // 하수도
    communication?: { exists: boolean; provider?: string };                // 통신선
    railway?: { exists: boolean; distance?: string };                      // 철도·지하철 인접
    other?: string;
  };
  // 특수적용 (특정 공사·구조 시 추가 의무)
  specialApplications?: {
    apartment?: boolean;                   // 공동주택 (산안기준규칙 §38의 추가 적용)
    psc?: boolean;                         // PSC 구조물 (시공·해체 특별기준)
    asbestos?: boolean;                    // 석면 함유 (석면안전관리법)
    explosive?: boolean;                   // 발파작업 (총포·도검·화약류단속법)
    underwater?: boolean;                  // 수중작업 (잠수기능사 의무)
    radiation?: boolean;                   // 방사선 (원자력안전법)
    confined?: boolean;                    // 밀폐공간 작업 (산안기준규칙 §618~)
  };
  iso45001Class?: "iso45001:Workplace";
}

export interface Person {
  "@id": string;
  "@type": "Person";
  site?: string;
  project?: string;
  name: string;
  role: string;
  title?: string;
  qualification?: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  nationality?: string;                    // 한국 / 베트남 / 중국 ...
  isForeign?: boolean;                     // 외국인 여부 (별도 안내·교육 의무)
  preferredLanguage?: string;              // ko / vi / zh-CN / th / en — TBM 다국어 안내용
  employer?: string;
  employmentType?: "정규" | "계약" | "일용" | "파견" | "도급";
  hireDate?: string;
  // 자격증 (관리감독자·기능공·운전자 자격 검증)
  certifications?: Array<{
    name: string;                          // 산업안전기사 / 굴삭기운전기능사 / 비계기능사 등
    certNo?: string;                       // 자격번호
    issuedBy?: string;                     // 한국산업인력공단
    issuedDate?: string;
    expiresOn?: string;                    // 갱신 의무 자격 (기중기 면허 등)
  }>;
  // 교육이력 (산안법 §29 정기·신규·작업변경·특별교육)
  trainings?: Array<{
    name: string;
    type?: "정기" | "신규" | "작업변경" | "특별" | "관리감독자" | "MSDS";
    date: string;
    hours?: number;
    instructor?: string;
    institution?: string;                  // 위탁기관 (KOSHA·고용노동부 등록기관)
  }>;
  healthChecks?: Array<{
    type: string;                          // 일반 / 특수 / 배치전 / 수시
    date: string;
    result: string;                        // 정상A / 정상B / 요관찰C / 유소견D1/D2
    institution?: string;
  }>;
  signature?: string;
  iso45001Class?: "iso45001:Worker";
}

export interface Equipment {
  "@id": string;
  "@type": "Equipment";
  site?: string;
  project?: string;
  name: string;
  model?: string;
  manufacturer?: string;
  serialNumber?: string;
  ratedCapacity?: string;
  workingRadius?: string;
  installLocation?: string;
  // 안전인증·자율안전확인 (산안법 §84·§89)
  safetyCertType?: "안전인증" | "자율안전확인" | "해당없음";
  safetyCertNo?: string;                   // 안전인증번호
  // 검사이력 (산안법 §93 안전검사)
  safetyInspectionDate?: string;           // 최근 검사일 (legacy 호환)
  safetyInspectionCertNo?: string;         // 최근 검사번호 (legacy 호환)
  inspections?: Array<{
    type: "안전검사" | "정기점검" | "수시점검" | "정밀안전진단";
    date: string;
    result: "합격" | "불합격" | "조건부합격";
    certNo?: string;
    nextDueDate?: string;
    inspector?: string;
  }>;
  // 자격운전자 (자격번호 포함)
  qualifiedOperators?: string[];           // legacy: 이름만
  qualifiedOperatorsDetail?: Array<{
    name: string;
    certName: string;                      // 굴삭기운전기능사 / 기중기운전기능사 등
    certNo: string;
    expiresOn?: string;
  }>;
  iso45001Class?: "iso45001:Workplace";    // 작업장 구성요소
}

export interface Contractor {
  "@id": string;
  "@type": "Contractor";
  project: string;
  name: string;
  ceo: string;
  businessNumber?: string;
  contractAmount?: number;
  scope?: string;                          // 도급 범위 (예: 철근콘크리트 / 토공 / 전기)
  contractPeriod?: { start: string; end: string };
  representativeOnSite?: string;
  workerCount?: number;
  safetyManagerName?: string;
  safetyManagerCertNo?: string;            // 안전관리자 자격번호
  // 안전관리비 분담 (산안법 §72·하도급법)
  safetyCostShareRate?: number;            // 분담률 (0.0 ~ 1.0)
  safetyCostShareAmount?: number;          // 분담 금액 (원)
  subcontractRate?: number;                // 전체 도급률 (이중·삼중 도급 추적)
  // 도급단계
  contractTier?: 1 | 2 | 3;                // 1=원도급, 2=하도급, 3=재하도급
  iso45001Class?: "iso45001:Workplace";
}

export interface Profile {
  "@context": {
    "@vocab": "https://agent-safety-oss/vocab/profile#";
  };
  _meta: {
    version: string;
    createdAt: string;
    updatedAt: string;
    description: string;
  };
  sites: Site[];
  projects: Project[];
  persons: Person[];
  equipments: Equipment[];
  contractors: Contractor[];
}

const EMPTY_PROFILE: Profile = {
  "@context": {
    "@vocab": "https://agent-safety-oss/vocab/profile#",
  },
  _meta: {
    version: "0.1.0",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    description: "사용자 SSoT — 사업장·현장·직원·장비·수급업체 정보. 94종 양식이 자동 참조.",
  },
  sites: [],
  projects: [],
  persons: [],
  equipments: [],
  contractors: [],
};

// 교차 검증: cache key 를 path 로 변경.
// SAFETY_LOCAL_DIR env 변경 시 cache 가 stale 한 path 의 profile 을 그대로 반환하던
// 회귀 해소. Map<path, Profile> 으로 path-aware cache. invalidateProfileCache 는
// 전체 clear (보수적 — 한 path 만 무효화하고 싶으면 cache.delete(path) 사용 가능).
const profileCache: Map<string, Profile> = new Map();

export async function loadProfile(): Promise<Profile> {
  const path = getProfileFilePath();
  const cached = profileCache.get(path);
  if (cached) return cached;
  try {
    const txt = await readFile(path, "utf8");
    const parsed: Profile = JSON.parse(txt);
    profileCache.set(path, parsed);
    return parsed;
  } catch (err) {
    return EMPTY_PROFILE;
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  await ensureSecureDir(getProfileDir());
  profile._meta.updatedAt = new Date().toISOString();
  const path = getProfileFilePath();
  await writeSecureJson(path, profile);
  profileCache.set(path, profile);
}

export function invalidateProfileCache(): void {
  profileCache.clear();
}

export function getProfilePath(): string {
  return getProfileFilePath();
}

// 헬퍼 — IRI 자동 생성
export function makeId(type: "site" | "project" | "person" | "equipment" | "contractor", name: string): string {
  const slug = name.replace(/\s+/g, "_").replace(/[(){}.,/\\]/g, "").slice(0, 50);
  return `${type}:${slug}`;
}

// 핵심 — docId + draft 보강 (자동 채움)
export function autoFillFromProfile(
  draft: Record<string, unknown>,
  options: {
    siteId?: string;
    projectId?: string;
    profile: Profile;
    docId: string;
  },
): { draft: Record<string, unknown>; appliedFields: string[] } {
  const { profile, siteId, projectId, docId } = options;
  const draftCopy = { ...draft };
  const applied: string[] = [];

  const site = siteId ? profile.sites.find((s) => s["@id"] === siteId) : profile.sites[0];
  const project = projectId
    ? profile.projects.find((p) => p["@id"] === projectId)
    : profile.projects.find((p) => p.site === site?.["@id"]);

  if (!site && !project) return { draft: draftCopy, appliedFields: [] };

  const fillIfEmpty = (key: string, value: unknown): void => {
    if (draftCopy[key] === undefined || draftCopy[key] === null || draftCopy[key] === "") {
      draftCopy[key] = value;
      applied.push(key);
    }
  };

  // 사업장 / 현장 메타 (모든 docId 공통)
  if (site) {
    fillIfEmpty("siteName", project?.name ?? site.name);
    fillIfEmpty("businessNumber", site.businessNumber);
    fillIfEmpty("address", project?.address ?? site.address);
    fillIfEmpty("industryCode", site.industryCode ?? "");
    fillIfEmpty("principalName", site.ownerName);
    fillIfEmpty("ownerName", site.ownerName);
    fillIfEmpty("department", `${site.name} ${docId.startsWith("work_permit") ? "안전관리팀" : "안전관리부서"}`);
  }
  if (project) {
    fillIfEmpty("projectName", project.name);
    // projectInfo 합성도 사용자가 draftCopy 에 명시한 값 우선.
    // normalizeDraftAliases 가 metadata.{projectName,contractAmount,contractPeriod} 를
    // draft 로 옮겼다면 그 값으로 합성. profile stale 값이 표에 박히는 회귀 방지.
    const projName = (draftCopy.projectName as string | undefined) ?? project.name;
    const projAmount = draftCopy.contractAmount ?? project.contractAmount;
    const projPeriodStr =
      typeof draftCopy.contractPeriod === "string"
        ? draftCopy.contractPeriod
        : project.contractPeriod
          ? `${project.contractPeriod.start}~${project.contractPeriod.end}`
          : "";
    fillIfEmpty("projectInfo", `${projName}, ${projAmount ?? ""}원, ${projPeriodStr}`);
    fillIfEmpty("contractAmount", project.contractAmount);
    fillIfEmpty("contractPeriod", project.contractPeriod ? `${project.contractPeriod.start} ~ ${project.contractPeriod.end}` : undefined);
    fillIfEmpty("constructionType", project.constructionType);
    fillIfEmpty("constructionScale", project.scale);
    fillIfEmpty("siteAddress", project.address ?? site?.address);
    fillIfEmpty("workerCount", project.workerCount ? `남 ${project.workerCount.male} + 여 ${project.workerCount.female} = ${project.workerCount.male + project.workerCount.female}명` : undefined);
  }

  // 사업장 1개 + 현장 1개면 site·project 매칭 무시 (느슨한 매칭)
  const looseMatch = profile.sites.length <= 1 && profile.projects.length <= 1;
  const personMatchesContext = (p: Person): boolean => {
    if (looseMatch) return true;
    if (p.site === site?.["@id"]) return true;
    if (p.project === project?.["@id"]) return true;
    return false;
  };

  // 작성자 = 안전관리자 (Person role=안전관리자)
  const safetyManager = profile.persons.find(
    (p) => (p.role.includes("안전관리자") || p.role.includes("보건관리자")) && personMatchesContext(p),
  );
  if (safetyManager) {
    fillIfEmpty("compiler", `${safetyManager.name} (${safetyManager.role})`);
    fillIfEmpty("compilerSign", `${safetyManager.name} (서명)`);
    fillIfEmpty("compiler_sign", `${safetyManager.name} (서명)`);
    fillIfEmpty("safetyChecker_name", `${safetyManager.name} (${safetyManager.role}, 서명)`);
    fillIfEmpty("safetyChecker_dept", `${site?.name} ${safetyManager.role}`);
    fillIfEmpty("measurer", safetyManager.name);
  }

  // 관리감독자
  const supervisor = profile.persons.find(
    (p) => p.role.includes("관리감독자") && personMatchesContext(p),
  );
  if (supervisor) {
    fillIfEmpty("supervisor_sign", `${supervisor.name} (서명)`);
    fillIfEmpty("supervisorSign", `${supervisor.name} (서명)`);
  }

  // 사업주 / 현장소장 / 안전보건관리책임자
  const principal = profile.persons.find(
    (p) =>
      (p.role.includes("현장소장") ||
       p.role.includes("안전보건관리책임자") ||
       p.role.includes("사업주")) &&
      personMatchesContext(p),
  );
  if (principal) {
    fillIfEmpty("principal_sign", `${principal.name} (${principal.role}, 서명)`);
    fillIfEmpty("principalSign", `${principal.name} (${principal.role}, 서명)`);
    fillIfEmpty("approver_name", `${principal.name} (${principal.role}, 서명)`);
  }

  // 근로자대표
  const workerRep = profile.persons.find(
    (p) => p.role.includes("근로자대표") && personMatchesContext(p),
  );

  // 결재선 자동 구성 (사업주/관리감독자/근로자대표).
  // name·title 은 profile 로 자동 채우되, signed·date 는 명시적 결재 절차 전까지 미입력 상태로 둔다.
  // signed:true 자동 표기는 "결재 완료" 인상을 유발해 실 결재 전 문서 효력을 오인하게 만든다.
  // 사용자가 실 결재 후 별도 입력 (draft.approvalChain 명시 또는 update_approval 도구) 으로 서명·일자 표기.
  if (!draftCopy.approvalChain && (principal || supervisor || workerRep)) {
    const chain: any[] = [];
    if (principal) chain.push({ role: "사업주", name: principal.name, title: principal.title ?? principal.role, signed: false, date: undefined });
    if (supervisor) chain.push({ role: "관리감독자", name: supervisor.name, title: supervisor.title ?? supervisor.role, signed: false, date: undefined });
    if (workerRep) chain.push({ role: "근로자대표", name: workerRep.name, title: workerRep.title ?? workerRep.role, signed: false, date: undefined });
    if (chain.length > 0) {
      draftCopy.approvalChain = chain;
      applied.push("approvalChain");
    }
  }

  // 작성 일자 (오늘 KST — Issue #5 lateral)
  fillIfEmpty("compileDate", kstToday());

  // 안전보건관리비 — 자동 계산 (산안법 §72 1.97% 일반건설)
  if (project && (docId === "safety_health_mgmt_cost_plan" || docId === "construction_safety_management_plan")) {
    const calcBase = project.safetyCostBudget ?? Math.floor((project.contractAmount ?? 0) * 0.91); // 재료+직접노무비 추정
    fillIfEmpty("calcBaseAmount", `${calcBase}원 (도급금액 91% 추정)`);
    fillIfEmpty("applicableRate", "1.97% (일반건설(갑) 50억 미만)");
    fillIfEmpty("totalCost", `${Math.floor(calcBase * 0.0197)}원`);
  }

  return { draft: draftCopy, appliedFields: applied };
}
