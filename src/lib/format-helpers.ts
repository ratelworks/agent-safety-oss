// 파일 최상단 상수 — 공통 포맷팅 헬퍼
// KOSHA·법제처 등 외부 API 가 반환하는 raw 형식을 사용자 표시용으로 변환

// YYYYMMDD → YYYY-MM-DD (KOSHA 자료실 응답의 contsRegYmd 등)
export function formatYYYYMMDD(yyyymmdd: string | undefined): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "-";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
