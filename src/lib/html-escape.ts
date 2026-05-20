/**
 * html-escape.ts
 *
 * HTML 컨텍스트(텍스트 노드·속성 양쪽)에서 안전하게 사용 가능한 5자 escape.
 * 작은따옴표(') 도 포함해야 attribute='...' 컨텍스트의 XSS 를 차단한다.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
