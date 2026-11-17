// ─────────────────────────────────────────────────────────────────────────────
// doclang-reader.ts — DocLang 문서(XML)를 읽어 본문 블록(제목·문단·목록·표)으로 옮긴다.
//
// 한글(HWPX) 파일은 이 블록에서 바로 만든다 — 정본(.dclx)이 먼저고 한글 파일은 정본에서 내보낸다.
// 정본의 글은 Markdown 서식이 아니므로 한글 파일로 갈 때 Markdown 으로 바꿨다가 다시 읽지 않는다
// (다시 읽으면 "10*20*30" 이 기울임으로 읽혀 "102030" 이 되는 식으로 값이 바뀐다 — 칸마다 감싸기를 더하는 방식은 한 곳만 빠져도 샌다).
// Markdown 은 사람이 읽을 미리보기·내보내기 응답용으로만 만들고, 그때 기호를 감싼다(blocksToMarkdown 한 곳).
// agent-safety-oss 가 만든 정본 DocLang(제목·문단·표·목록)을 그대로 옮기고, 다른 도구가 만든 DocLang 도
// 글자를 잃지 않게 읽는다(모르는 요소는 안의 글자를 문단으로). 내려받은 문서의 글은 그대로 옮길 뿐 실행하지 않는다.
//   건너뛰는 것  <head>(제목만 쓴다) · <custom>(문서 정보) · <field_region>(본문 표와 같은 값의 목록) · <location> · <page_break>
//   표(OTSL)     ched·rhed·fcel·ecel 은 새 칸, lcel·ucel·xcel(합친 칸)은 빈 칸, nl 은 줄 끝
// ─────────────────────────────────────────────────────────────────────────────

// ───── 상수 ─────
const MAX_HEADING_LEVEL = 6;
const SKIP = new Set(["custom", "field_region", "location", "page_break", "src"]);
const CELL_START = new Set(["ched", "rhed", "fcel", "ecel", "srow", "corn"]);
const CELL_MERGED = new Set(["lcel", "ucel", "xcel"]);
const ROW_END = "nl";
/** 머리칸 이름이 이것이면 항목·내용 표 — 표 제목 줄을 따로 두지 않는다 */
const PAIR_HEADER = ["항목", "내용"];
const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
/** 이보다 깊게 들어간 요소는 읽지 않는다 — 비정상 문서로 멈추지 않게 */
const MAX_DEPTH = 200;
/** 블록 안에 블록이 있는 요소 — 안으로 들어가 읽는다 */
const BLOCK_TAGS = ["heading", "table", "list", "text"];
/** Markdown 의 글자 서식 기호 — 미리보기 Markdown 에서 글자 그대로 남기도록 역슬래시로 감싼다 */
const INLINE_MARKS = /[\\`*_[\]~<>!]/g;

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<XmlNode | string>;
}

/** 본문 블록 — 글은 서식이 아니라 적힌 글자 그대로다 */
export type DocBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "text"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  /** rows[0] 이 머리 줄. 칸 안의 줄바꿈은 "\n". pair = 항목·내용 표(표 제목을 따로 두지 않는다) */
  | { kind: "table"; caption: string; rows: string[][]; pair: boolean };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return ENTITY[code] ?? whole;
  });
}

const localName = (name: string): string => name.slice(name.indexOf(":") + 1);

/** XML 을 나무로 — DocLang 문서를 읽을 만큼만 (주석·처리 지시는 버린다) */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(token)) {
    const top = stack[stack.length - 1] as XmlNode;
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2] !== undefined) {
      if (stack.length > 1 && localName(m[2]) === top.tag) stack.pop();
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[localName(a[1] as string)] = decode(a[2] ?? a[3] ?? "");
      const node: XmlNode = { tag: localName(m[3]), attrs, children: [] };
      top.children.push(node);
      if (m[5] !== "/" && stack.length < MAX_DEPTH) stack.push(node);
    } else if (m[6] !== undefined) top.children.push(decode(m[6]));
  }
  return root;
}

/** 요소 안의 글자 — 건너뛸 요소는 빼고, <content> 안의 줄바꿈은 살린다 */
function textOf(node: XmlNode | string, keepLines = false): string {
  if (typeof node === "string") return keepLines ? node : node.replace(/\s+/g, " ");
  if (SKIP.has(node.tag)) return "";
  return node.children.map((c) => textOf(c, keepLines || node.tag === "content")).join("");
}

const tidy = (s: string): string => s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();

/** 여러 줄 글을 줄마다 문단 블록으로 */
const textBlocks = (text: string): DocBlock[] =>
  tidy(text)
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ kind: "text", text: line }));

function tableBlock(node: XmlNode): DocBlock[] {
  let caption = "";
  const rows: string[][] = [];
  let cells: string[] = [];
  let current: number | null = null;
  const endRow = (): void => {
    if (cells.length > 0) rows.push(cells);
    cells = [];
    current = null;
  };
  for (const child of node.children) {
    if (typeof child !== "string" && child.tag === "caption") {
      caption = tidy(textOf(child, true));
      continue;
    }
    if (typeof child !== "string" && CELL_START.has(child.tag)) {
      cells.push("");
      current = cells.length - 1;
      continue;
    }
    if (typeof child !== "string" && CELL_MERGED.has(child.tag)) {
      cells.push("");
      current = null;
      continue;
    }
    if (typeof child !== "string" && child.tag === ROW_END) {
      endRow();
      continue;
    }
    if (current !== null) cells[current] = (cells[current] ?? "") + textOf(child, true);
  }
  endRow();
  if (rows.length === 0) return caption ? [{ kind: "text", text: caption }] : [];
  const width = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => "")].map(tidy));
  const head = padded[0] ?? [];
  const pair = head.length === PAIR_HEADER.length && head.every((h, i) => h === PAIR_HEADER[i]);
  return [{ kind: "table", caption, rows: padded, pair }];
}

function listBlock(node: XmlNode): DocBlock[] {
  const ordered = /ordered/.test(node.attrs["class"] ?? "") && !/unordered/.test(node.attrs["class"] ?? "");
  const items: string[] = [];
  let current: string | null = null;
  for (const child of node.children) {
    if (typeof child !== "string" && child.tag === "ldiv") {
      if (current !== null) items.push(current);
      current = "";
      continue;
    }
    const text = textOf(child, true);
    if (current === null) {
      if (text.trim()) current = text;
    } else current += text;
  }
  if (current !== null) items.push(current);
  const lines = items.map((item) => tidy(item).replace(/\n/g, " ")).filter(Boolean);
  return lines.length > 0 ? [{ kind: "list", ordered, items: lines }] : [];
}

/** DocLang 문서의 제목 — <head><title>, 없으면 첫 제목(heading) */
function findTitle(root: XmlNode): string {
  const doc = root.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "doclang") ?? root;
  const head = doc.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "head");
  const title = head?.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "title");
  if (title) return tidy(textOf(title, true));
  const heading = doc.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "heading");
  return heading ? tidy(textOf(heading)) : "";
}

/** <custom><doc_id> — 이 도구가 만든 문서의 종류 id (없으면 null) */
function findDocId(node: XmlNode): string | null {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (child.tag === "doc_id") return tidy(textOf(child)) || null;
    const inner = findDocId(child);
    if (inner) return inner;
  }
  return null;
}

/** DocLang 문서를 본문 블록으로 — 작성 안내 줄은 원래 DocLang 에 없다 */
export function doclangToBlocks(xml: string): { blocks: DocBlock[]; title: string; docId: string | null } {
  const root = parseXml(xml);
  const doc = root.children.find((c): c is XmlNode => typeof c !== "string" && c.tag === "doclang");
  if (!doc) throw new Error("DocLang 문서가 아닙니다(<doclang> 요소가 없습니다)");
  const blocks: DocBlock[] = [];
  const walk = (node: XmlNode): void => {
    for (const child of node.children) {
      if (typeof child === "string") {
        if (child.trim()) blocks.push({ kind: "text", text: tidy(child) });
        continue;
      }
      if (child.tag === "head" || SKIP.has(child.tag)) continue;
      if (child.tag === "heading") {
        const level = Math.min(Math.max(Number.parseInt(child.attrs["level"] ?? "1", 10) || 1, 1), MAX_HEADING_LEVEL);
        const text = tidy(textOf(child));
        if (text) blocks.push({ kind: "heading", level, text });
      } else if (child.tag === "table") blocks.push(...tableBlock(child));
      else if (child.tag === "list") blocks.push(...listBlock(child));
      else if (child.tag === "text" || child.tag === "content" || child.tag === "caption") blocks.push(...textBlocks(textOf(child, true)));
      else if (child.children.some((c) => typeof c !== "string" && BLOCK_TAGS.includes(c.tag))) walk(child);
      else {
        const text = tidy(textOf(child, true));
        if (text) blocks.push({ kind: "text", text });
      }
    }
  };
  walk(doc);
  return { blocks, title: findTitle(root), docId: findDocId(doc) };
}

// ───── 미리보기 Markdown ─────
/** 글자 서식 기호를 감싼다 — Markdown 으로 읽어도 적힌 글자 그대로 보이게 */
const escapeInline = (s: string): string => s.replace(INLINE_MARKS, "\\$&");
/** 한 줄 글 — 줄 첫머리의 블록 기호(제목 #·목록 - + 1.·표 |·인용 >·코드·구분선)도 감싼다 */
const escapeLine = (s: string): string =>
  escapeInline(s)
    .replace(/^(\s*)([-+#|])/, "$1\\$2")
    .replace(/^(\s*\d+)([.)])(\s)/, "$1\\$2$3");
const cellText = (s: string): string => escapeInline(s).replace(/\|/g, "\\|").replace(/\n/g, "<br>");

/** 본문 블록을 Markdown 으로 — 모든 글은 여기서 한 번 감싼다 */
export function blocksToMarkdown(blocks: DocBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") out.push(`${"#".repeat(block.level)} ${escapeInline(block.text)}`, "");
    else if (block.kind === "text") out.push(escapeLine(block.text), "");
    else if (block.kind === "list") out.push(...block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : "-"} ${escapeInline(item)}`), "");
    else {
      const [head = [], ...rest] = block.rows;
      if (block.caption && !block.pair) out.push(`### ${escapeInline(block.caption)}`, "");
      out.push(`| ${head.map(cellText).join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
      for (const row of rest) out.push(`| ${row.map(cellText).join(" | ")} |`);
      out.push("");
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** DocLang 문서를 결재·제출용 Markdown 으로 (미리보기·내보내기 응답용) */
export function doclangToPreviewMarkdown(xml: string): { markdown: string; title: string; docId: string | null } {
  const read = doclangToBlocks(xml);
  return { markdown: blocksToMarkdown(read.blocks), title: read.title, docId: read.docId };
}
