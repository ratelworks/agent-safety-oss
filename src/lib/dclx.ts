/**
 * dclx.ts — DocLang 아카이브(.dclx)를 읽어 본문을 Markdown 으로 그린다
 *
 * KOSHA Guide 원본은 `.dclx`(DocLang 0.8 — LF AI & Data 문서 표준, ZIP 아카이브 안의 document.xml) 한 형식으로 보관한다.
 * 이 모듈은 의존성 없이(zlib + fast-xml-parser 없이 직접 토큰화) 아카이브에서 document.xml 을 꺼내고,
 * 조회 도구가 돌려줄 Markdown 을 그린다.
 *   - 제목(heading level N) → "#" N+1 개 (문서 제목 한 단계를 비워 둔다)
 *   - 표(OTSL 토큰) → 병합 셀(rowspan·colspan)을 살린 HTML 표
 *   - 그림 → "[그림] 캡션 (원본 N쪽)" — 그림 파일은 싣지 않으므로 원본 쪽 번호를 알려 준다
 */
import { inflateRawSync } from "node:zlib";

// ── 상수 ────────────────────────────────────────────────────────────
const DOCUMENT_ENTRY = "document.xml";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_EOCD_MIN = 22;
const ZIP_EOCD_SEARCH = 0xffff + ZIP_EOCD_MIN;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const MAX_HEADING_HASHES = 6;
/** 셀 자리 토큰 (OTSL) — 앵커(내용이 있는 칸)와 병합 표지 */
const ANCHOR_TOKENS = new Set(["fcel", "ecel", "ched", "rhed", "srow"]);
const HEADER_TOKENS = new Set(["ched", "rhed"]);
const MERGE_TOKENS = new Set(["lcel", "ucel", "xcel"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

interface XmlNode {
  name: string;
  children: (XmlNode | string)[];
}

/** ZIP 아카이브에서 이름이 같은 항목 하나를 꺼낸다 (중앙 디렉터리 기준). */
export function readZipEntry(zip: Buffer, entryName: string): Buffer | null {
  const start = Math.max(0, zip.length - ZIP_EOCD_SEARCH);
  let eocd = -1;
  for (let i = zip.length - ZIP_EOCD_MIN; i >= start; i -= 1) {
    if (zip.readUInt32LE(i) === ZIP_EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (zip.readUInt32LE(p) !== ZIP_CENTRAL_SIGNATURE) return null;
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLength);
    if (name === entryName) {
      if (zip.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) return null;
      const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === METHOD_STORED) return Buffer.from(data);
      if (method === METHOD_DEFLATE) return inflateRawSync(data);
      return null;
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** .dclx 아카이브 → document.xml 문자열 */
export function readDclxDocument(zip: Buffer): string {
  const entry = readZipEntry(zip, DOCUMENT_ENTRY);
  if (!entry) throw new Error("dclx 아카이브에 document.xml 이 없습니다");
  return entry.toString("utf8");
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") return String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? m;
  });
}

/** DocLang 마크업 → 요소 나무 (속성은 heading level·list class 만 쓰므로 이름 뒤에 붙여 둔다) */
export function parseDoclang(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", children: [] };
  const stack: XmlNode[] = [root];
  const pattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([a-zA-Z_][\w.-]*)([^>]*?)(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|([^<]+)/g;
  for (let m = pattern.exec(xml); m; m = pattern.exec(xml)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.children.push(m[1]);
    } else if (m[6] !== undefined) {
      top.children.push(decodeEntities(m[6]));
    } else if (m[3] !== undefined) {
      const [, , closing, name, attrs, selfClosing] = m;
      if (closing) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const level = attrs.match(/\blevel="(\d+)"/)?.[1];
      const node: XmlNode = { name: level ? `${name}:${level}` : name, children: [] };
      top.children.push(node);
      if (!selfClosing) stack.push(node);
    }
  }
  return root;
}

/** 글자 꾸밈 태그 — 낱말 가운데에 올 수 있어 걷어 낼 때 띄우지 않는다 */
const INLINE_TAG = /<\/?(?:bold|italic|underline|strikethrough|subscript|superscript|code|location)\b[^>]*>/g;

/**
 * document.xml → 검색용 글 (나무를 만들지 않고 태그만 걷는다 — 1,040건 첫 검색이 무거워지지 않게).
 * 표 안의 줄바꿈(<nl/>·칸 글 속 줄바꿈 문자)은 지워 낱말을 잇고("이동식\n크레인" → "이동식크레인" — 칸 경계는 태그 자리 공백으로 남는다),
 * 표 밖 <nl/> 은 줄바꿈으로 둔다.
 * 쪽 번호 같은 기계용 표지(<custom>)와 머리 정보(<head>)는 글이 아니다.
 */
export function doclangPlainText(xml: string): string {
  const text = xml
    .replace(/<head>[\s\S]*?<\/head>/g, " ")
    .replace(/<custom>[\s\S]*?<\/custom>/g, " ")
    .replace(/<table>[\s\S]*?<\/table>/g, (t) => t.replace(/<nl\s*\/>|\r?\n/g, ""))
    .replace(/<nl\s*\/>/g, "\n")
    .replace(INLINE_TAG, "")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text).replace(/[ \t]+/g, " ");
}

function baseName(node: XmlNode): string {
  return node.name.split(":")[0];
}

/** 글만 — <custom>(쪽 번호 등 기계용 표지)은 글이 아니다 */
function inlineText(node: XmlNode | string): string {
  if (typeof node === "string") return node;
  const name = baseName(node);
  if (name === "custom" || name === "location" || name === "caption") return "";
  const inner = node.children.map(inlineText).join("");
  if (name === "underline") return `<u>${inner}</u>`;
  if (name === "bold") return `**${inner}**`;
  if (name === "italic") return `*${inner}*`;
  if (name === "nl") return "\n";
  return inner;
}

function pageOf(node: XmlNode): string | undefined {
  const custom = node.children.find((c): c is XmlNode => typeof c !== "string" && baseName(c) === "custom");
  const page = custom?.children.find((c): c is XmlNode => typeof c !== "string" && baseName(c) === "page_number");
  return page ? page.children.map(inlineText).join("").trim() : undefined;
}

function captionOf(node: XmlNode): string {
  return node.children
    .filter((c): c is XmlNode => typeof c !== "string" && baseName(c) === "caption")
    .map((c) => c.children.map(inlineText).join("").trim())
    .filter(Boolean)
    .join(" / ");
}

function cellHtml(text: string): string {
  return text.trim().replace(/\n+/g, "<br>");
}

/** OTSL 표 → HTML 표 (앵커의 오른쪽 lcel 개수 = colspan, 아래 ucel 개수 = rowspan) */
export function tableToHtml(table: XmlNode): string {
  const rows: { token: string; content: string }[][] = [[]];
  let current: { token: string; content: string } | undefined;
  for (const child of table.children) {
    if (typeof child === "string") {
      if (current) current.content += child;
      continue;
    }
    const name = baseName(child);
    if (name === "caption" || name === "custom" || name === "location") continue;
    if (name === "nl") {
      rows.push([]);
      current = undefined;
    } else if (ANCHOR_TOKENS.has(name) || MERGE_TOKENS.has(name)) {
      current = { token: name, content: "" };
      rows[rows.length - 1].push(current);
    } else if (current) {
      // 셀 안의 블록(문단·목록·안긴 표)
      current.content += name === "table" ? tableToHtml(child) : `${inlineText(child)}\n`;
    }
  }
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  const lines: string[] = ["<table>"];
  const caption = captionOf(table);
  if (caption) lines.push(`<caption>${cellHtml(caption)}</caption>`);
  rows.forEach((row, r) => {
    let html = "<tr>";
    row.forEach((cell, c) => {
      if (!ANCHOR_TOKENS.has(cell.token)) return;
      let colspan = 1;
      while (row[c + colspan]?.token === "lcel") colspan += 1;
      let rowspan = 1;
      while (rows[r + rowspan]?.[c]?.token === "ucel" || rows[r + rowspan]?.[c]?.token === "xcel") rowspan += 1;
      const tag = HEADER_TOKENS.has(cell.token) ? "th" : "td";
      const attrs = `${colspan > 1 ? ` colspan="${colspan}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}`;
      html += `<${tag}${attrs}>${cellHtml(cell.content)}</${tag}>`;
    });
    lines.push(`${html}</tr>`);
  });
  lines.push("</table>");
  return lines.join("\n");
}

function listToMarkdown(node: XmlNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  const own: string[] = [];
  const nested: string[] = [];
  for (const child of node.children) {
    if (typeof child !== "string" && baseName(child) === "list") nested.push(listToMarkdown(child, depth + 1));
    else own.push(inlineText(child));
  }
  const text = own.join("").trim();
  return [text ? `${indent}${text}` : "", ...nested].filter(Boolean).join("\n");
}

/** 본문 요소 하나 — 글과 원본 쪽 번호 */
export interface DclxBlock {
  /** heading · text · list · footnote */
  type: string;
  text: string;
  /** 원본 PDF 쪽 번호 (요소에 없으면 앞 요소의 쪽을 잇는다) */
  page?: number;
  /** 제목이면 단계 */
  level?: number;
}

/**
 * document.xml → 본문 요소 목록 (제목·문단·목록·각주). 표·그림 안의 글은 넣지 않는다 — 목차 표가 조항 찾기를 흐리지 않게.
 * 조항·부록 위치를 원본 요소와 쪽 번호로 가리킬 때 쓴다.
 */
export function doclangBlocks(xml: string): DclxBlock[] {
  const root = parseDoclang(xml);
  const doc = root.children.find((c): c is XmlNode => typeof c !== "string" && baseName(c) === "doclang");
  if (!doc) throw new Error("DocLang 루트(<doclang>)가 없습니다");
  const out: DclxBlock[] = [];
  let page: number | undefined;
  for (const child of doc.children) {
    if (typeof child === "string") continue;
    const own = Number(pageOf(child));
    if (Number.isInteger(own) && own > 0) page = own;
    const name = baseName(child);
    const text = name === "list" ? listToMarkdown(child) : name === "heading" || name === "text" || name === "footnote" ? inlineText(child).trim() : "";
    if (!text) continue;
    out.push({ type: name, text, ...(page ? { page } : {}), ...(name === "heading" ? { level: Number(child.name.split(":")[1] ?? 1) } : {}) });
  }
  return out;
}

/** document.xml → Markdown 본문 */
export function doclangToMarkdown(xml: string): string {
  const root = parseDoclang(xml);
  const doc = root.children.find((c): c is XmlNode => typeof c !== "string" && baseName(c) === "doclang");
  if (!doc) throw new Error("DocLang 루트(<doclang>)가 없습니다");
  const blocks: string[] = [];
  for (const child of doc.children) {
    if (typeof child === "string") continue;
    const name = baseName(child);
    if (name === "head" || name === "page_break" || name === "field_region") continue;
    if (name === "heading") {
      const level = Number(child.name.split(":")[1] ?? 1);
      blocks.push(`${"#".repeat(Math.min(MAX_HEADING_HASHES, level + 1))} ${inlineText(child).trim()}`);
    } else if (name === "text") {
      const text = inlineText(child).trim();
      if (text) blocks.push(text);
    } else if (name === "list") {
      const text = listToMarkdown(child);
      if (text) blocks.push(text);
    } else if (name === "table") {
      blocks.push(tableToHtml(child));
    } else if (name === "picture") {
      const caption = captionOf(child);
      const page = pageOf(child);
      blocks.push(`[그림]${caption ? ` ${caption}` : ""}${page ? ` (원본 ${page}쪽)` : ""}`);
    } else if (name === "footnote") {
      blocks.push(`[각주] ${inlineText(child).trim()}`);
    } else {
      const text = inlineText(child).trim();
      if (text) blocks.push(text);
    }
  }
  return blocks.join("\n\n");
}
