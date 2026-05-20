/**
 * company-key.ts
 *
 * 라텔웍스 발행 API 키 + 기업 프로파일 fetch.
 *
 * 흐름:
 *   1) 사용자가 https://ratelworks.co.kr/agenthq/api-key 가입
 *   2) 라텔웍스가 이메일로 ASF_xxxx_yyyy 키 발송
 *   3) 사용자가 link_company_key 도구로 키 등록
 *   4) MCP 가 라텔웍스 백엔드로 기업 프로파일 fetch → 로컬 SSoT 자동 입력
 *
 * 저장 위치: ~/.agent-safety-oss/company-key.json
 *   { apiKey, companyId, linkedAt }
 *
 * 백엔드 API:
 *   GET https://agent-safety-oss-622699652854.asia-northeast3.run.app/api/v1/company/profile
 *     Authorization: Bearer ASF_xxxx_yyyy
 *   응답: { businessNumber, companyName, ceoName, address, contact, ... }
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { ensureSecureDir, writeSecureJson, writeSecureText } from "./secure-fs.js";
import { invalidateAgentHqKeyCache } from "../config/env.js";

// SAFETY_LOCAL_DIR 환경변수가 있으면 그 디렉토리를 루트로 사용. site-profile·photo·
// issue·action·report 와 동일 정책 (lazy 평가 — 호출 시점 env 우선).
// 테스트·CLI 가 임시 디렉토리로 격리해도 ~/.agent-safety-oss/company-key.json
// 이 새지 않도록 한다. CONTRIBUTING §3.2 / SECURITY §3 의 SAFETY_LOCAL_DIR 표준.
function getKeyDir(): string {
  const override = process.env.SAFETY_LOCAL_DIR?.trim();
  return override ? resolve(override) : resolve(homedir(), ".agent-safety-oss");
}
function getKeyFilePath(): string {
  return resolve(getKeyDir(), "company-key.json");
}

const RELAY_BASE = process.env.RATELWORKS_RELAY_URL ?? "https://agent-safety-oss-622699652854.asia-northeast3.run.app";

export interface CompanyKeyData {
  apiKey: string;
  companyId?: string;
  linkedAt: string;
  lastSyncedAt?: string;
}

export interface CompanyProfile {
  businessNumber: string;
  companyName: string;
  ceoName: string;
  address: string;
  industryCode?: string;
  representativeContact?: string;
  email?: string;
  workerCountTotal?: number;
  establishedDate?: string;
  // 산재보험
  insurance?: {
    carrier: string;
    subscriptionNumber: string;
  };
  // 안전보건경영
  safetyManagement?: {
    policyVersion?: string;
    annualGoal?: string;
    lastReview?: string;
  };
  // 본사
  headquarters?: {
    address: string;
    phone: string;
  };
}

export async function loadCompanyKey(): Promise<CompanyKeyData | null> {
  try {
    const txt = await readFile(getKeyFilePath(), "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function saveCompanyKey(data: CompanyKeyData): Promise<void> {
  await ensureSecureDir(getKeyDir());
  await writeSecureJson(getKeyFilePath(), data);
  // AGENTHQ_API_KEY 프로세스 캐시를 강제 무효화한다. 키 미등록 상태에서 한 번
  // 캐시가 null 로 굳은 뒤 link_company_key 가 호출돼도 동일 프로세스에서
  // 재시작 전까지 KOSHA Live API 가 계속 실패하던 결함을 방지한다.
  invalidateAgentHqKeyCache();
}

export async function clearCompanyKey(): Promise<void> {
  try {
    await writeSecureText(getKeyFilePath(), "{}");
  } catch {}
  // unlink 후에도 동일 프로세스에서 기존 키 캐시로 relay 호출이 이어지는 것을 막는다.
  invalidateAgentHqKeyCache();
}

export function getKeyPath(): string {
  return getKeyFilePath();
}

// API 키 원문 노출 차단용 마스킹. MCP structuredContent·로그·텔레메트리 등 어떤
// 외부 표면에 키를 보낼 때도 이 함수를 거친 값만 사용한다.
//   ASF_xxxxxxxx_yyyy → ASF_****_yyyy
//   ASF_abc → ASF_****        (last4 미만이면 last4 생략)
//   짧거나 prefix 없는 키 → ****_yyyy 또는 ****
export function maskApiKey(apiKey: string | undefined | null): string {
  if (!apiKey || typeof apiKey !== "string") return "";
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) return "";
  const last4 = trimmed.length >= 8 ? trimmed.slice(-4) : "";
  const suffix = last4 ? `_${last4}` : "";
  if (trimmed.startsWith("ASF_")) return `ASF_****${suffix}`;
  return `****${suffix}`;
}

// 이메일·전화번호 등 회사 단위 PII 필드 마스킹. 키와 동일한 의도 —
// MCP structuredContent 가 host LLM transcript·다른 도구 입력 등으로
// 흐를 때 회사 연락처가 평문으로 나가지 않도록 한다. text content (사용자에게
// 보여주는 한국어 본문) 에는 raw 노출 — 사용자 본인이 자기 회사 정보를
// 볼 권리가 있다고 가정한다 (sync_to_cloud 의 confirm 경계와 같은 기준).
function maskEmail(v: string): string {
  const m = v.match(/^([^@]+)@(.+)$/);
  if (!m) return "***";
  const local = m[1];
  const domain = m[2];
  const localHead = local.slice(0, 1);
  return `${localHead}***@${domain.replace(/^[^.]+/, "***")}`;
}

function maskPhone(v: string): string {
  // 한국 전화번호 패턴 — 마지막 4자리만 노출.
  const digits = v.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `***-****-${digits.slice(-4)}`;
}

function maskSubscriptionNumber(v: string): string {
  if (!v || v.length < 6) return "***";
  return `${v.slice(0, 2)}****${v.slice(-2)}`;
}

// 사업자번호 (XXX-XX-XXXXX) — 앞 3자리만 노출, 나머지 마스킹.
export function maskBusinessNumber(v: string | undefined | null): string {
  if (!v) return "***";
  const digits = String(v).replace(/\D/g, "");
  if (digits.length < 5) return "***";
  return `${digits.slice(0, 3)}-**-*****`;
}

// 사람 이름 — 성만 노출 + 나머지 별표.
export function maskPersonName(v: string | undefined | null): string {
  if (!v) return "***";
  const t = String(v).trim();
  if (t.length <= 1) return "***";
  return `${t.slice(0, 1)}${"*".repeat(Math.max(1, t.length - 1))}`;
}

// 주소 — 시·구 까지만 노출, 나머지 마스킹.
export function maskAddress(v: string | undefined | null): string {
  if (!v) return "***";
  const t = String(v).trim();
  // 한국 주소 패턴 — "시 / 구 / 동" 단위 토큰 3개까지만.
  const tokens = t.split(/\s+/);
  if (tokens.length <= 2) return "***";
  return `${tokens.slice(0, 2).join(" ")} ***`;
}

// 회사명 — 그대로 노출 (사명 자체는 공개 정보 — 사업자등록증·등기부등본 에 등재).
// 단 본 helper 는 향후 정책 변경 시 한 자리에서 토글 가능하도록 둔다.
export function maskCompanyName(v: string | undefined | null): string {
  return v ? String(v) : "***";
}

export interface MaskedCompanyProfile {
  businessNumber?: string;
  companyName?: string;
  ceoName?: string;
  address?: string;
  industryCode?: string;
  representativeContact?: string; // masked
  email?: string; // masked
  workerCountTotal?: number;
  establishedDate?: string;
  insurance?: { carrier: string; subscriptionNumber: string }; // subscriptionNumber masked
  safetyManagement?: { policyVersion?: string; annualGoal?: string; lastReview?: string };
  headquarters?: { address: string; phone: string }; // phone masked
}

// CompanyProfile 의 PII 필드만 마스킹한 사본을 반환. 원본은 변경하지 않는다.
export function maskCompanyProfile(p: CompanyProfile): MaskedCompanyProfile {
  const out: MaskedCompanyProfile = {
    businessNumber: p.businessNumber,
    companyName: p.companyName,
    ceoName: p.ceoName,
    address: p.address,
    industryCode: p.industryCode,
    workerCountTotal: p.workerCountTotal,
    establishedDate: p.establishedDate,
    safetyManagement: p.safetyManagement,
  };
  if (p.representativeContact) out.representativeContact = maskPhone(p.representativeContact);
  if (p.email) out.email = maskEmail(p.email);
  if (p.insurance) {
    out.insurance = {
      carrier: p.insurance.carrier,
      subscriptionNumber: maskSubscriptionNumber(p.insurance.subscriptionNumber),
    };
  }
  if (p.headquarters) {
    out.headquarters = {
      address: p.headquarters.address,
      phone: p.headquarters.phone ? maskPhone(p.headquarters.phone) : "",
    };
  }
  return out;
}

/** 라텔웍스 백엔드에서 기업 프로파일 fetch (실패 시 null) */
export async function fetchCompanyProfile(apiKey: string): Promise<{ profile: CompanyProfile | null; error?: string }> {
  try {
    const url = `${RELAY_BASE}/api/v1/company/profile`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: (AbortSignal as any).timeout?.(10_000) ?? undefined,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { profile: null, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    return { profile: data as CompanyProfile };
  } catch (e) {
    return { profile: null, error: (e as Error).message };
  }
}

/** 클라우드 백엔드에 SSoT 동기화 — Site/Person/Equipment 등 업로드 */
export async function syncToCloud(
  apiKey: string,
  payload: { sites?: any[]; projects?: any[]; persons?: any[]; equipments?: any[]; contractors?: any[] },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${RELAY_BASE}/api/v1/company/profile`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: (AbortSignal as any).timeout?.(15_000) ?? undefined,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
