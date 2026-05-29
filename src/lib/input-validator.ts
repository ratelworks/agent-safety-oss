// ─────────────────────────────────────────────────────────────────────────────
// input-validator.ts (v0.14 — 사용자 입력 사실성 검증)
//
// 교차 검증 외부 평가 잔존 결함:
//   "GHS·법규 분류 오류 + 수치 부정확 + 미래 일자"
//
// 본 OSS는 사용자 입력을 그대로 출력 → 입력 *형식 + 단순 사실성* 검증.
// 도메인 정확성 (LD50 수치 등)은 외부 DB 연동 (KOSHA Live MSDS API)으로 후속.
//
// 검증 항목:
//   - 날짜 형식 + 미래/과거 일자
//   - CAS No 형식 + 체크섬
//   - GHS H-code/P-code 형식
//   - UN No 형식
//   - 노출기준 (TWA·STEL·IDLH) 단위 형식
//   - 결재선 서명 누락
// ─────────────────────────────────────────────────────────────────────────────

// Issue #5 lateral (2026-05-22) — KST 기준 TODAY
import { kstToday } from "./datetime-kst.js";

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggested?: string;
}

// module 상수 — 모듈 로드 시점 KST 자정.
// 새벽 0~9시 호출에서 UTC slice 시 어제로 잘못 잡히던 문제 해소.
// 장시간 실행 서버에서는 TODAY 가 어제로 박힐 가능성 있으나 본 OSS 는 단발 호출 위주 — 무시 가능.
const TODAY = kstToday();

// ─── 날짜 검증 ───
export function validateDate(field: string, value: string | undefined, allowFuture = false): ValidationIssue | null {
  if (!value) return null;
  const m = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return { field, severity: "warning", message: "날짜 형식 미준수 (YYYY-MM-DD)" };
  }
  const inputDate = m[0];
  if (!allowFuture && inputDate > TODAY) {
    return {
      field,
      severity: "error",
      message: `미래 일자 (${inputDate} > 오늘 ${TODAY})`,
      suggested: "오늘 또는 과거 일자로 정정",
    };
  }
  return null;
}

// ─── CAS No 검증 (체크섬) ───
// 형식: NNNNNNN-NN-N (체크섬 = sum(digit × position) mod 10, 우→좌)
export function validateCasNo(field: string, value: string | undefined): ValidationIssue | null {
  if (!value) return null;
  const m = value.match(/(\d{2,7})-(\d{2})-(\d)/);
  if (!m) {
    return { field, severity: "warning", message: "CAS No 형식 미준수 (NNNNNNN-NN-N)" };
  }
  const digits = (m[1] + m[2]).split("").map(Number);
  const checksum = m[3];
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    sum += digits[digits.length - 1 - i] * (i + 1);
  }
  if (String(sum % 10) !== checksum) {
    return {
      field,
      severity: "error",
      message: `CAS No 체크섬 오류 (${m[0]}, 계산 ${sum % 10} ≠ 입력 ${checksum})`,
      suggested: "정확한 CAS No 재확인 (KOSHA MSDS DB)",
    };
  }
  return null;
}

// ─── GHS H-code 검증 ───
// H200~H299 (물리위험), H300~H399 (건강위험), H400~H499 (환경위험)
export function validateHCode(field: string, value: string | undefined): ValidationIssue | null {
  if (!value) return null;
  const codes = value.match(/H\d{3}/g);
  if (!codes) return null; // H-code 없으면 검증 안 함
  const invalid: string[] = [];
  for (const c of codes) {
    const n = parseInt(c.slice(1), 10);
    if (!((n >= 200 && n < 300) || (n >= 300 && n < 400) || (n >= 400 && n < 500))) {
      invalid.push(c);
    }
  }
  if (invalid.length > 0) {
    return {
      field,
      severity: "error",
      message: `잘못된 GHS H-code: ${invalid.join(", ")} (유효 범위 H200~H499)`,
    };
  }
  return null;
}

// ─── GHS P-code 검증 (P101~P501) ───
export function validatePCode(field: string, value: string | undefined): ValidationIssue | null {
  if (!value) return null;
  const codes = value.match(/P\d{3}(\+P\d{3})*/g);
  if (!codes) return null;
  // P-code는 100~501 범위 (대략)
  const allCodes = value.match(/P\d{3}/g) ?? [];
  const invalid: string[] = [];
  for (const c of allCodes) {
    const n = parseInt(c.slice(1), 10);
    if (n < 100 || n > 600) invalid.push(c);
  }
  if (invalid.length > 0) {
    return {
      field,
      severity: "error",
      message: `잘못된 GHS P-code: ${invalid.join(", ")}`,
    };
  }
  return null;
}

// ─── UN No 형식 (4자리 숫자) ───
export function validateUnNo(field: string, value: string | undefined): ValidationIssue | null {
  if (!value) return null;
  const m = value.match(/UN\s*(\d{4})/i);
  if (!m) {
    if (/UN/i.test(value)) {
      return { field, severity: "warning", message: "UN No 형식 (UN 4자리)" };
    }
    return null;
  }
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 3540) {
    return { field, severity: "warning", message: `UN No 범위 의심 (${m[1]}, 표준 1~3540)` };
  }
  return null;
}

// ─── TWA/노출기준 형식 ───
// "TWA 1mg/m³" or "TWA 1 mg/m³"
export function validateExposureLimit(field: string, value: string | undefined): ValidationIssue | null {
  if (!value) return null;
  if (!/TWA|STEL|IDLH/i.test(value)) return null;
  if (!/\d+\s*(mg\/m³|ppm|µg\/m³|mg\/L)/i.test(value)) {
    return {
      field,
      severity: "warning",
      message: "노출기준 단위 명시 필요 (mg/m³·ppm·µg/m³ 등)",
    };
  }
  return null;
}

// ─── 결재선 서명 누락 ───
export function validateApprovalChain(
  field: string,
  chain: Array<{ role: string; name: string; signed?: boolean; date?: string }> | undefined,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!chain || chain.length === 0) {
    issues.push({ field, severity: "error", message: "결재선 미작성" });
    return issues;
  }
  // 최소 사업주 + 관리감독자
  const roles = chain.map((c) => c.role);
  if (!roles.some((r) => r.includes("사업주") || r.includes("대표"))) {
    issues.push({ field, severity: "error", message: "결재선 — 사업주/대표 누락" });
  }
  for (const a of chain) {
    if (!a.name || a.name.includes("미작성")) {
      issues.push({ field, severity: "error", message: `결재선 ${a.role} 성명 누락` });
    }
    if (!a.signed) {
      issues.push({ field: `${field}.${a.role}`, severity: "warning", message: `${a.role} 미서명` });
    }
    if (a.date) {
      const dateIssue = validateDate(`${field}.${a.role}.date`, a.date);
      if (dateIssue) issues.push(dateIssue);
    }
  }
  return issues;
}

// ─── 종합 검증 ───
export interface ValidationReport {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  summary: { total: number; errors: number; warnings: number };
}

export function buildReport(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const info = issues.filter((i) => i.severity === "info");
  return {
    errors,
    warnings,
    info,
    summary: { total: issues.length, errors: errors.length, warnings: warnings.length },
  };
}

// generate-safety-document 의 getFieldValue 와 동일한 우선순위로 값 존재 확인.
// "키 존재" 만으로 통과시키지 않는다 — 빈 문자열·공백·빈 배열·false 등은 모두
// 미작성으로 간주해야 결재 가능 판정의 신뢰성이 유지된다.
function hasFilledValue(
  draft: Record<string, unknown> & {
    sections?: Record<string, Record<string, unknown>>;
    raw?: Record<string, unknown>;
  },
  fieldKey: string,
): boolean {
  const isFilled = (v: unknown): boolean => {
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "boolean") return v === true;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return true;
  };
  const sections = (draft.sections ?? {}) as Record<string, Record<string, unknown>>;
  for (const sec of Object.values(sections)) {
    if (sec && typeof sec === "object" && fieldKey in sec) {
      if (isFilled(sec[fieldKey])) return true;
    }
  }
  if (fieldKey.includes(".")) {
    const [outer, inner] = fieldKey.split(".", 2);
    const o = (draft as Record<string, unknown>)[outer];
    if (o && typeof o === "object" && inner in (o as Record<string, unknown>)) {
      if (isFilled((o as Record<string, unknown>)[inner])) return true;
    }
  }
  if (fieldKey in draft && isFilled((draft as Record<string, unknown>)[fieldKey])) return true;
  if (draft.raw && fieldKey in draft.raw && isFilled(draft.raw[fieldKey])) return true;
  return false;
}

// ─── Document 입력 자동 검증 ───
// docDef.sections 가 있으면 sections.fields[].key 가 권위 — generic renderer 와 일치.
// docDef.sections 가 없을 때만 legacy requiredFields 로 fallback.
type SectionField = { key: string; label?: string; required?: boolean };
type DocSection = { title?: string; fields?: SectionField[] };
export function validateDocumentInput(
  _docId: string,
  draft: Record<string, unknown> & {
    metadata?: { planDate?: string };
    approvalChain?: Array<{ role: string; name: string; signed?: boolean; date?: string }>;
    sections?: Record<string, Record<string, unknown>>;
  },
  docDef?: {
    requiredFields?: Array<{ key: string; label: string; source?: string }>;
    sections?: DocSection[];
  },
): ValidationReport {
  const issues: ValidationIssue[] = [];

  // 1. 작성일 미래 차단
  const planDate = draft.metadata?.planDate;
  const dateIssue = validateDate("metadata.planDate", planDate);
  if (dateIssue) issues.push(dateIssue);

  // 1.5. 필수 입력값 누락 검증
  // 우선순위: docDef.sections (renderer 와 동일 키) → docDef.requiredFields (legacy)
  // sections 가 정의된 docId 는 generic renderer 가 sections.fields[].key 로 매칭하므로
  // validator 도 동일 기준을 사용해야 한다 (이중 기준으로 인한 false-positive 차단).
  const sectionFields = (docDef?.sections ?? [])
    .flatMap((s) => s.fields ?? [])
    .filter((f) => f.required !== false);

  if (sectionFields.length > 0) {
    for (const f of sectionFields) {
      const baseKey = f.key.split(".").pop() ?? f.key;
      // key·label 양방향 매칭 — 값이 실제 채워졌는지만 본다. 키만 존재하고
      // 값이 빈 문자열·공백·빈 배열·false 인 경우는 미작성으로 처리한다.
      const found =
        hasFilledValue(draft, f.key) ||
        (baseKey !== f.key && hasFilledValue(draft, baseKey)) ||
        (f.label ? hasFilledValue(draft, f.label) : false);
      if (!found) {
        issues.push({
          field: `sections.${f.key}`,
          severity: "error",
          message: `필수 항목 미작성: ${f.label ?? f.key}`,
          suggested: "결재 전 반드시 작성 — 미작성 시 법정문서 효력 없음",
        });
      }
    }
  } else if (docDef?.requiredFields) {
    for (const rf of docDef.requiredFields) {
      const baseKey = rf.key.split(".").pop() ?? rf.key;
      const found =
        hasFilledValue(draft, rf.key) ||
        (baseKey !== rf.key && hasFilledValue(draft, baseKey));
      if (!found) {
        issues.push({
          field: `sections.${rf.key}`,
          severity: "error",
          message: `필수 항목 미작성: ${rf.label}${rf.source ? ` (근거: ${rf.source})` : ""}`,
          suggested: "결재 전 반드시 작성 — 미작성 시 법정문서 효력 없음",
        });
      }
    }
  }

  // 2. 결재선
  issues.push(...validateApprovalChain("approvalChain", draft.approvalChain));

  // 3. sections 내용 자동 검증 (CAS·H-code·UN No·노출기준 등)
  const sections = draft.sections ?? {};
  for (const [secKey, sec] of Object.entries(sections)) {
    if (!sec || typeof sec !== "object") continue;
    for (const [fk, fv] of Object.entries(sec as Record<string, unknown>)) {
      const v = String(fv ?? "");
      const fieldPath = `sections["${secKey}"].${fk}`;
      // CAS No 검증
      if (/cas/i.test(fk)) {
        const i = validateCasNo(fieldPath, v);
        if (i) issues.push(i);
      }
      // H-code
      if (/hazard|hazardStatement|ghs/i.test(fk)) {
        const i = validateHCode(fieldPath, v);
        if (i) issues.push(i);
      }
      // P-code
      if (/precautionary/i.test(fk)) {
        const i = validatePCode(fieldPath, v);
        if (i) issues.push(i);
      }
      // UN No
      if (/un/i.test(fk) && /UN\s*\d/.test(v)) {
        const i = validateUnNo(fieldPath, v);
        if (i) issues.push(i);
      }
      // 노출기준
      if (/exposure|TLV|TWA/i.test(fk)) {
        const i = validateExposureLimit(fieldPath, v);
        if (i) issues.push(i);
      }
      // 일자 (날짜 키 패턴)
      if (/Date$|date$|일자$/i.test(fk) && fv) {
        const i = validateDate(fieldPath, v, /기한|만료|유효|예정/i.test(fk));
        if (i) issues.push(i);
      }
    }
  }

  return buildReport(issues);
}
