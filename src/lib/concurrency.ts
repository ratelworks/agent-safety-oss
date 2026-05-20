// 파일 최상단 상수 — 동시 실행 제한 헬퍼
// MSDS 섹션처럼 업스트림 호출이 폭주할 때 N 개씩만 동시 실행.

/**
 * items 배열의 각 원소에 task 를 병렬로 적용하되 동시 실행 개수를 limit 로 제한.
 * - 반환 순서는 입력 순서와 동일
 * - 어떤 task 가 reject 하면 해당 결과는 undefined 대신 catch-wrapping
 *   (업스트림 일부 실패로 전체가 무너지는 상황 방지)
 */
export async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (items.length === 0) return [];
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<U>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: safeLimit }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await task(items[i], i);
    }
  });

  await Promise.all(runners);
  return results;
}
