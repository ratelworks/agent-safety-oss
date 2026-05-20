/**
 * company-key-tools.ts
 *
 * 라텔웍스 발행 키 관리 도구 4종.
 */
import { z } from "zod";
import {
  loadCompanyKey,
  saveCompanyKey,
  clearCompanyKey,
  getKeyPath,
  fetchCompanyProfile,
  syncToCloud,
  maskApiKey,
  maskCompanyProfile,
  maskBusinessNumber,
  maskPersonName,
  maskAddress,
  maskCompanyName,
} from "../lib/company-key.js";
import { loadProfile, saveProfile, makeId } from "../lib/site-profile.js";
import type { ToolDefinition as McpToolDefinition } from "../lib/types.js";

// ─── link_company_key ───
const LinkInput = z.object({
  apiKey: z.string().describe("라텔웍스 발행 API 키 (가입 후 이메일로 받은 ASF_xxxx_yyyy 형식)"),
  reveal: z.boolean().default(false).describe(
    "회사·사업자번호·대표자·주소를 평문으로 표시. 기본 false (마스킹). " +
    "MCP host transcript / 로그 등에 PII 가 평문으로 흘러갈 위험을 줄이려면 false 유지.",
  ),
});

const linkCompanyKey: McpToolDefinition = {
  name: "link_company_key",
  description:
    "라텔웍스 발행 API 키 등록 → 기업 프로파일을 자동 fetch 해서 로컬 SSoT (Site) 에 입력. 가입: https://ratelworks.co.kr/agenthq/api-key",
  inputSchema: LinkInput,
  handler: async (raw) => {
    const { apiKey, reveal } = LinkInput.parse(raw);
    if (!apiKey.startsWith("ASF_")) {
      return {
        content: [{ type: "text" as const, text: `[INVALID_KEY] 키 형식 오류 — 'ASF_xxxx_yyyy' 형식이어야 합니다.` }],
        structuredContent: { error: "invalid_key_format" },
        isError: true,
      };
    }

    // 1) 백엔드에서 프로파일 fetch
    const { profile, error } = await fetchCompanyProfile(apiKey);
    if (!profile) {
      return {
        content: [{
          type: "text" as const,
          text: `[FETCH_FAILED] 라텔웍스 백엔드 응답 실패\n\n  사유: ${error}\n\n  키 발급이 정상적으로 됐는지 ratelworks.co.kr/agenthq/api-key 에서 확인하세요.\n  네트워크 오프라인 상태에서는 register_site / register_person 등 도구로 직접 등록하세요.`,
        }],
        structuredContent: { error: "fetch_failed", reason: error },
        isError: true,
      };
    }

    // 2) 키 저장
    await saveCompanyKey({
      apiKey,
      companyId: profile.businessNumber,
      linkedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
    });

    // 3) 로컬 SSoT 에 Site 자동 입력
    const localProfile = await loadProfile();
    const siteId = makeId("site", profile.companyName);
    const newSite = {
      "@id": siteId,
      "@type": "Site" as const,
      name: profile.companyName,
      businessNumber: profile.businessNumber,
      address: profile.headquarters?.address ?? profile.address,
      ownerName: profile.ceoName,
      industryCode: profile.industryCode,
      workerCountTotal: profile.workerCountTotal,
      representativeContact: profile.representativeContact,
      establishedDate: profile.establishedDate,
    };
    const idx = localProfile.sites.findIndex((s) => s["@id"] === siteId);
    if (idx >= 0) localProfile.sites[idx] = newSite;
    else localProfile.sites.push(newSite);
    await saveProfile(localProfile);

    // text content 도 기본 마스킹 — MCP host transcript / 로그 등에 PII 평문 노출 차단.
    // reveal=true 명시 시만 평문 (사용자 본인이 본인 단말에서 확인 의도).
    const displayName = reveal ? profile.companyName : maskCompanyName(profile.companyName);
    const displayBn = reveal ? profile.businessNumber : maskBusinessNumber(profile.businessNumber);
    const displayCeo = reveal ? profile.ceoName : maskPersonName(profile.ceoName);
    const displayAddr = reveal ? profile.address : maskAddress(profile.address);
    return {
      content: [{
        type: "text" as const,
        text: `✅ 라텔웍스 키 연동 완료\n\n  회사: ${displayName}\n  사업자번호: ${displayBn}\n  대표자: ${displayCeo}\n  주소: ${displayAddr}${reveal ? "" : "\n\n  (PII 마스킹 적용 — 평문 확인은 reveal=true)"}\n\n자동 적용:\n  - SSoT 사업장 1개 등록 (\`${siteId}\`)\n  - 향후 모든 94종 양식이 자동 채움\n\n다음:\n  - register_project — 현장·공사 등록\n  - register_person — 직원 등록\n  - sync_to_cloud — 로컬 정보 클라우드 동기화 (선택)`,
      }],
      structuredContent: {
        // structuredContent 는 host LLM transcript·다른 도구 입력 등으로 흐를 수 있어
        // 항상 마스킹 (reveal 옵션 무관). 사용자 본인 확인용 평문은 text content + reveal=true.
        linked: true,
        company: maskCompanyProfile(profile),
        keyPath: getKeyPath(),
      },
    };
  },
};

// ─── unlink_company_key ───
const UnlinkInput = z.object({
  confirm: z.literal(true).describe("키 해제 확인"),
});

const unlinkCompanyKey: McpToolDefinition = {
  name: "unlink_company_key",
  description: "라텔웍스 키 연동 해제. 로컬 SSoT 는 유지됨. 클라우드 동기화는 중단됨.",
  inputSchema: UnlinkInput,
  handler: async () => {
    await clearCompanyKey();
    return {
      content: [{ type: "text" as const, text: `✅ 키 해제 완료. 로컬 SSoT 는 유지됨.` }],
      structuredContent: { unlinked: true },
    };
  },
};

// ─── get_company_info ───
const GetCompanyInfoInput = z.object({
  reveal: z.boolean().default(false).describe(
    "회사·사업자번호·대표자·주소를 평문으로 표시. 기본 false (마스킹). " +
    "MCP host transcript / 로그 등에 PII 가 평문으로 흘러갈 위험을 줄이려면 false 유지.",
  ),
});

const getCompanyInfo: McpToolDefinition = {
  name: "get_company_info",
  description: "현재 연동된 라텔웍스 키 + 기업 정보 조회. 키 미연동 시 가입 안내.",
  inputSchema: GetCompanyInfoInput,
  handler: async (raw) => {
    const { reveal } = GetCompanyInfoInput.parse(raw ?? {});
    const key = await loadCompanyKey();
    if (!key || !key.apiKey) {
      return {
        content: [{
          type: "text" as const,
          text:
            `🔓 라텔웍스 키 미연동\n\n` +
            `가입하면 다음 혜택:\n` +
            `  ✓ 사업자번호·회사명·대표 자동 입력\n` +
            `  ✓ 산재보험·안전보건경영방침 자동 fetch\n` +
            `  ✓ 여러 디바이스 SSoT 클라우드 동기화\n\n` +
            `가입: https://ratelworks.co.kr/agenthq/api-key\n` +
            `이메일로 ASF_xxxx_yyyy 키 받은 후 link_company_key 호출.`,
        }],
        structuredContent: { linked: false },
      };
    }
    // API 키 원문은 MCP 응답·로그·텔레메트리 어디에도 노출하지 않는다.
    // structuredContent 에는 마스킹된 식별자와 메타만 둔다.
    const keyMeta = {
      keyMasked: maskApiKey(key.apiKey),
      companyId: key.companyId,
      linkedAt: key.linkedAt,
      lastSyncedAt: key.lastSyncedAt,
      keyPath: getKeyPath(),
    };
    const { profile, error } = await fetchCompanyProfile(key.apiKey);
    if (!profile) {
      return {
        content: [{
          type: "text" as const,
          text: `⚠️ 키는 등록됨 but 백엔드 응답 실패 (오프라인?)\n  사유: ${error}\n  키 등록일: ${key.linkedAt}`,
        }],
        structuredContent: { linked: true, fetchError: error, ...keyMeta },
      };
    }
    const displayName = reveal ? profile.companyName : maskCompanyName(profile.companyName);
    const displayBn = reveal ? profile.businessNumber : maskBusinessNumber(profile.businessNumber);
    const displayCeo = reveal ? profile.ceoName : maskPersonName(profile.ceoName);
    const displayAddr = reveal ? profile.address : maskAddress(profile.address);
    return {
      content: [{
        type: "text" as const,
        text: `🟢 라텔웍스 키 연동 중\n\n  회사: ${displayName}\n  사업자번호: ${displayBn}\n  대표자: ${displayCeo}\n  주소: ${displayAddr}\n  마지막 동기화: ${key.lastSyncedAt ?? "없음"}${reveal ? "" : "\n\n  (PII 마스킹 적용 — 평문 확인은 reveal=true)"}`,
      }],
      structuredContent: { linked: true, company: maskCompanyProfile(profile), ...keyMeta },
    };
  },
};

// ─── sync_to_cloud ───
// 본 도구는 로컬 SSoT 를 라텔웍스 운영 클라우드(PUT /api/v1/company/profile)로
// 전송한다. persons 등에는 성명·연락처·이메일 등 PII 가 포함될 수 있으므로
// 사용자의 명시적 동의(confirm=true)가 필요하다. 기본은 preview — 무엇이
// 전송될지(카운트·카테고리·대상 URL·PII 포함 여부) 만 보고하고 전송하지 않는다.
const SyncInput = z.object({
  confirm: z
    .boolean()
    .optional()
    .describe(
      "true 일 때만 실제 전송. 생략·false 면 preview (어떤 데이터가 어디로 전송될지 보고만, 전송 0).",
    ),
});

// 어떤 카테고리에 PII 가 포함될 수 있는지 사용자에게 고지.
type SyncCategoryMeta = { label: string; containsPii: boolean; piiNote?: string };
const SYNC_CATEGORIES: Record<"sites" | "projects" | "persons" | "equipments" | "contractors", SyncCategoryMeta> = {
  sites: { label: "사업장", containsPii: true, piiNote: "사업자번호·대표자명" },
  projects: { label: "현장", containsPii: false },
  persons: { label: "직원", containsPii: true, piiNote: "성명·연락처·이메일·생년월일·자격·교육이력 등" },
  equipments: { label: "장비", containsPii: false },
  contractors: { label: "수급업체", containsPii: true, piiNote: "수급업체명·대표·연락처" },
};

const syncToCloudTool: McpToolDefinition = {
  name: "sync_to_cloud",
  description:
    "로컬 SSoT (사업장·현장·직원·장비·수급업체) 를 라텔웍스 운영 클라우드에 전송 (PUT /api/v1/company/profile). PII 포함 가능. 기본은 preview — 실제 전송하려면 confirm: true 필수. 다른 디바이스에서 link_company_key 시 자동 복원.",
  inputSchema: SyncInput,
  handler: async (raw) => {
    const { confirm } = SyncInput.parse(raw ?? {});
    const key = await loadCompanyKey();
    if (!key || !key.apiKey) {
      return {
        content: [{ type: "text" as const, text: `[NO_KEY] 라텔웍스 키 미연동. link_company_key 먼저 호출.` }],
        structuredContent: { error: "no_key" },
        isError: true,
      };
    }
    const localProfile = await loadProfile();
    const payload = {
      sites: localProfile.sites,
      projects: localProfile.projects,
      persons: localProfile.persons,
      equipments: localProfile.equipments,
      contractors: localProfile.contractors,
    };
    const counts = {
      sites: payload.sites.length,
      projects: payload.projects.length,
      persons: payload.persons.length,
      equipments: payload.equipments.length,
      contractors: payload.contractors.length,
    };
    const containsPii = (Object.keys(counts) as Array<keyof typeof counts>).some(
      (k) => counts[k] > 0 && SYNC_CATEGORIES[k].containsPii,
    );
    const destination =
      process.env.RATELWORKS_RELAY_URL?.trim() ||
      "https://agent-safety-oss-622699652854.asia-northeast3.run.app";
    const endpoint = `${destination.replace(/\/$/, "")}/api/v1/company/profile`;

    // preview — confirm 가 명시적으로 true 가 아니면 전송하지 않는다.
    if (confirm !== true) {
      const piiCategories = (Object.keys(SYNC_CATEGORIES) as Array<keyof typeof SYNC_CATEGORIES>)
        .filter((k) => counts[k] > 0 && SYNC_CATEGORIES[k].containsPii)
        .map((k) => `  · ${SYNC_CATEGORIES[k].label} (${counts[k]}건): ${SYNC_CATEGORIES[k].piiNote ?? ""}`);
      const text =
        `🔍 sync_to_cloud preview (전송 0)\n\n` +
        `  대상: PUT ${endpoint}\n` +
        `  사업장 ${counts.sites} / 현장 ${counts.projects} / 직원 ${counts.persons} / 장비 ${counts.equipments} / 수급업체 ${counts.contractors}\n` +
        (piiCategories.length > 0
          ? `\n⚠️ 다음 카테고리에 PII 가 포함되어 외부로 전송됩니다:\n${piiCategories.join("\n")}\n`
          : `\n  (PII 카테고리 데이터 없음)\n`) +
        `\n실제 전송하려면 sync_to_cloud 를 confirm: true 로 다시 호출하세요.`;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: {
          synced: false,
          preview: true,
          counts,
          containsPii,
          destination: endpoint,
          categories: SYNC_CATEGORIES,
        },
      };
    }

    const { ok, error } = await syncToCloud(key.apiKey, payload);
    if (!ok) {
      return {
        content: [{ type: "text" as const, text: `[SYNC_FAILED] ${error}` }],
        structuredContent: { synced: false, error, destination: endpoint },
        isError: true,
      };
    }
    // 마지막 동기화 시간 갱신
    await saveCompanyKey({ ...key, lastSyncedAt: new Date().toISOString() });
    return {
      content: [{
        type: "text" as const,
        text:
          `✅ 클라우드 동기화 완료\n\n` +
          `  대상: PUT ${endpoint}\n` +
          `  사업장: ${counts.sites}\n  현장: ${counts.projects}\n  직원: ${counts.persons}\n  장비: ${counts.equipments}\n  수급업체: ${counts.contractors}`,
      }],
      structuredContent: { synced: true, counts, containsPii, destination: endpoint },
    };
  },
};

export const COMPANY_KEY_TOOLS: McpToolDefinition[] = [
  linkCompanyKey,
  unlinkCompanyKey,
  getCompanyInfo,
  syncToCloudTool,
];
