/**
 * datetime-kst.ts
 *
 * Issue #5 lateral dependency fix (2026-05-22) — KST(+09:00) 기준 일자 산술 공통 유틸.
 *
 * 본 OSS 의 모든 법정 의무 (TBM·작업계획서·산재조사표·정기 위험성평가 등) 는
 * **한국 시간 (KST/+09:00)** 기준 일자로 발효·마감된다. JavaScript 의 기본 `new Date()` 와
 * `toISOString()` 은 UTC 기준이므로 KST 새벽 0~9시 호출 시 "오늘" 이 어제로 잘못 산정되는
 * 회귀가 발생한다.
 *
 * 사용 패턴:
 *   import { kstToday, kstAddDays, parseKstDate, formatKstDate } from "../lib/datetime-kst.js";
 *
 *   const today = kstToday();           // "2026-05-22" (KST 기준)
 *   const dueIn7 = kstAddDays(today, 7); // "2026-05-29"
 *   const sameDay = parseKstDate("2026-05-22"); // KST 자정 Date 객체
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * KST 기준 오늘 날짜 (YYYY-MM-DD).
 * UTC `toISOString()` 에 +9h 보정 후 substring.
 */
export function kstToday(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * KST 기준 오늘 일시 (YYYY-MM-DD HH:mm) — 활동 로그·trace 등에 유용.
 */
export function kstNow(): string {
  const iso = new Date(Date.now() + KST_OFFSET_MS).toISOString();
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * KST 기준 ISO 형식 (YYYY-MM-DDTHH:mm:ss+09:00) — 저장·재파싱 안전.
 */
export function kstIsoNow(): string {
  const iso = new Date(Date.now() + KST_OFFSET_MS).toISOString();
  return iso.slice(0, 19) + "+09:00";
}

/**
 * YYYY-MM-DD 문자열을 KST 자정 Date 객체로 변환.
 * `new Date("2026-05-22")` 는 UTC 자정으로 해석되므로 직접 사용 금지.
 */
export function parseKstDate(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T00:00:00+09:00`);
}

/**
 * 날짜 문자열에 일수 더하기 (KST 자정 안전).
 * 예: kstAddDays("2026-05-22", 7) → "2026-05-29"
 */
export function kstAddDays(yyyyMmDd: string, days: number): string {
  const base = parseKstDate(yyyyMmDd);
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  // KST 기준 substring — toISOString 은 UTC 라 +9h 보정
  return new Date(next.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 두 KST 일자 사이의 일수 차이 (b - a, 음수 가능).
 * 시간대 안전 — 둘 다 KST 자정 기준으로 정규화 후 ms 차이 / 86400000.
 */
export function kstDayDiff(a: string, b: string): number {
  const ms = parseKstDate(b).getTime() - parseKstDate(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Date 객체를 KST 기준 YYYY-MM-DD 로 포맷.
 * `Date.toISOString().slice(0,10)` 은 UTC 라 부적절.
 */
export function formatKstDate(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 디버그·로그용 사람 가독 — "2026-05-22 14:30 KST"
 */
export function formatKstHuman(d: Date = new Date()): string {
  const iso = new Date(d.getTime() + KST_OFFSET_MS).toISOString();
  return iso.slice(0, 16).replace("T", " ") + " KST";
}
