/**
 * pii-masking.ts
 *
 * Issue #7 (2026-05-21) — MCP 응답 텍스트의 PII 평문 노출 차단.
 *
 * 원칙:
 *   - 사용자 표시용 text (content[0].text) 에서만 마스킹
 *   - structuredContent 는 평문 유지 (파일 저장·재호출용)
 *   - 마스킹은 식별 가능성↓ 가독성↑ 균형 — 끝 2~3자만 노출
 *
 * 적용 대상:
 *   - 사업자등록번호 (10자리 NNN-NN-NNNNN)
 *   - 법인등록번호 (13자리)
 *   - 주민등록번호 (생년월일 + 7자리)
 *   - 성명 (한국·영문)
 *   - 전화번호 (휴대전화·일반·팩스)
 *   - 이메일
 *   - 주소 (시·도 + 시·군·구 유지, 상세 주소 마스킹)
 */

// 사업자등록번호 — "123-45-67890" → "***-**-67890" (끝 5자리 유지, 발급 사실 확인 가능 수준)
export function maskBusinessNumber(value: string | undefined | null): string {
  if (!value) return "(미입력)";
  const cleaned = value.replace(/\s/g, "");
  // 표준 포맷 NNN-NN-NNNNN
  const m = cleaned.match(/^(\d{3})-?(\d{2})-?(\d{5})$/);
  if (m) return `***-**-${m[3]}`;
  // 비표준 — 끝 5자리만
  if (cleaned.length >= 5) return `***-${cleaned.slice(-5)}`;
  return "***";
}

// 법인등록번호 — "110111-0123456" → "******-*123456"
export function maskCorpNumber(value: string | undefined | null): string {
  if (!value) return "(미입력)";
  const cleaned = value.replace(/\s/g, "");
  const m = cleaned.match(/^(\d{6})-?(\d{7})$/);
  if (m) return `******-${m[2].slice(-3).padStart(7, "*")}`;
  if (cleaned.length >= 3) return `***-${cleaned.slice(-3)}`;
  return "***";
}

// 성명 마스킹
//   - 한국어 2자: 김안 → 김*
//   - 한국어 3자 이상: 김안전 → 김*전 / 황룡길동 → 황**동
//   - 영문 단일: John → J***
//   - 영문 복합: John Doe → J*** D** / Nguyen Van A → N***** V** A
export function maskName(value: string | undefined | null): string {
  if (!value) return "(미입력)";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "(미입력)";

  // 한국어 (한글만으로 구성)
  if (/^[가-힣]+$/.test(trimmed)) {
    if (trimmed.length <= 1) return "*";
    if (trimmed.length === 2) return trimmed[0] + "*";
    return trimmed[0] + "*".repeat(trimmed.length - 2) + trimmed[trimmed.length - 1];
  }

  // 영문·혼합 — 공백으로 분리 후 각 토큰 부분 마스킹
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    const p = parts[0];
    if (p.length <= 1) return p[0] ?? "*";
    return p[0] + "*".repeat(Math.max(p.length - 1, 1));
  }
  return parts
    .map((p) => {
      if (!p) return "";
      if (p.length === 1) return p; // 이니셜은 그대로
      return p[0] + "*".repeat(Math.max(p.length - 1, 1));
    })
    .join(" ");
}

// 전화번호 — 끝 4자리 유지
//   - 02-000-0000 → 02-***-0000
//   - 010-1234-5678 → 010-****-5678
//   - +82-10-1234-5678 → +82-***-****-5678
//   - 02000000 → 02***0000 (구분자 없는 경우)
export function maskPhone(value: string | undefined | null): string {
  if (!value) return "(미입력)";
  const cleaned = value.trim();
  // 구분자가 있는 표준 포맷
  if (cleaned.includes("-")) {
    const parts = cleaned.split("-");
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const head = parts[0];
      const masked = parts.slice(1, -1).map((p) => "*".repeat(p.length));
      return [head, ...masked, last].join("-");
    }
  }
  // 구분자 없음 — 끝 4자리만 유지
  if (cleaned.length >= 4) return "*".repeat(cleaned.length - 4) + cleaned.slice(-4);
  return "*".repeat(cleaned.length);
}

// 이메일 — 첫 1자만 + 도메인 유지
//   john.doe@example.com → j***@example.com
export function maskEmail(value: string | undefined | null): string {
  if (!value) return "(미입력)";
  const at = value.indexOf("@");
  if (at < 0) return value[0] + "***";
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 1) return local + "***" + domain;
  return local[0] + "***" + domain;
}

// 주소 — 시·도 + 시·군·구 까지만 유지, 이후 상세는 마스킹
//   "서울 강남구 테헤란로 123 5층" → "서울 강남구 ***"
//   "충청남도 아산시 염치읍 충무로431번길 9" → "충청남도 아산시 ***"
export function maskAddress(value: string | undefined | null): string {
  if (!value) return "(미입력)";
  const trimmed = value.trim();
  // 광역시·도 + 시·군·구 패턴 후 나머지 마스킹
  const m = trimmed.match(
    /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|[가-힣]+(특별시|광역시|특별자치시|특별자치도|도))\s*([가-힣]+(시|군|구))?/,
  );
  if (m) {
    const head = m[0];
    if (head.length < trimmed.length) return `${head} ***`;
    return head;
  }
  // 패턴 매칭 실패 시 절반만 노출
  if (trimmed.length <= 4) return "***";
  return trimmed.slice(0, Math.ceil(trimmed.length / 3)) + " ***";
}

// 마스킹 적용 여부를 옵션으로 — 향후 verbose=true 옵션 대응
export interface MaskOptions {
  enabled?: boolean;
}

export function applyMask<T>(value: T | undefined | null, masker: (v: any) => string, opts?: MaskOptions): string {
  if (opts?.enabled === false) return String(value ?? "(미입력)");
  return masker(value as any);
}
