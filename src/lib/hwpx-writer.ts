/**
 * hwpx-writer.ts — Markdown 문서를 HWPX(한글) 파일로 만든다. 외부 의존성 없음(Node 표준 zlib 만 사용).
 *
 * HWPX 는 OWPML(KS X 6101) XML 을 ZIP 으로 묶은 형식이다.
 *   mimetype · version.xml · META-INF/container.xml · Contents/content.hpf ·
 *   Contents/header.xml(글꼴·글자 모양·문단 모양) · Contents/section0.xml(본문) · Preview/PrvText.txt
 *
 * 지원하는 Markdown: 제목(#~####), 문단, 굵게(**), 목록(-, *, 1.), 체크 상자, 인용(>), 표, 코드 블록, 구분선.
 * 그림·각주·중첩 표는 다루지 않는다. 이 도구가 만드는 문서 본문을 옮기는 데 필요한 범위만 구현한다.
 *
 * 패키지 구성과 요소 배열은 MIT 라이선스의 kordoc(github.com/chrisryugj/kordoc)이 만든 HWPX 를 참고했다.
 */

import { deflateRawSync, crc32 } from "node:zlib";

// ── 상수 ────────────────────────────────────────────────────────────
export const HWPX_MIME_TYPE = "application/hwp+zip";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
const GENERATOR = "agent-safety-oss";
/** A4 세로 (HWPUNIT = 1/7200 인치) */
const PAGE = { width: 59528, height: 84188, marginSide: 5670, marginTop: 5670, marginBottom: 4252, marginHeader: 2835 };
const TEXT_WIDTH = PAGE.width - PAGE.marginSide * 2;
const FONT_LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"];
const FONTS = ["함초롬바탕", "함초롬돋움"];
const FONT_BODY = 0;
const FONT_HEADING = 1;
const BORDER_NONE = 1;
const BORDER_SOLID = 2;
const CELL_MARGIN = 141;
const ROW_HEIGHT = 1500;
const MIN_COLUMN_WEIGHT = 4;
const MAX_COLUMN_WEIGHT = 40;
const PREVIEW_TEXT_LIMIT = 1000;
const ZIP_VERSION = 20;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
/** 1980-01-01 00:00 — 같은 입력이면 같은 파일이 나오도록 시각을 고정한다 */
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = 0x0021;

/** 글자 모양 — id 는 배열 순서 */
const CHAR = { body: 0, bold: 1, title: 2, h2: 3, h3: 4, h4: 5, small: 6, smallBold: 7 } as const;
const CHAR_SPECS: Array<{ height: number; bold: boolean; font: number }> = [
  { height: 1000, bold: false, font: FONT_BODY },
  { height: 1000, bold: true, font: FONT_BODY },
  { height: 1800, bold: true, font: FONT_HEADING },
  { height: 1400, bold: true, font: FONT_HEADING },
  { height: 1200, bold: true, font: FONT_HEADING },
  { height: 1100, bold: true, font: FONT_HEADING },
  { height: 900, bold: false, font: FONT_BODY },
  { height: 900, bold: true, font: FONT_BODY },
];

/** 문단 모양 — id 는 배열 순서 */
const PARA = { body: 0, title: 1, heading: 2, list: 3, quote: 4, cell: 5, cellCenter: 6, code: 7 } as const;
const PARA_SPECS: Array<{ align: string; indent: number; left: number; prev: number; next: number; lineSpacing: number }> = [
  { align: "JUSTIFY", indent: 0, left: 0, prev: 0, next: 300, lineSpacing: 160 },
  { align: "CENTER", indent: 0, left: 0, prev: 0, next: 800, lineSpacing: 160 },
  { align: "LEFT", indent: 0, left: 0, prev: 800, next: 300, lineSpacing: 160 },
  { align: "LEFT", indent: -1000, left: 1400, prev: 0, next: 100, lineSpacing: 150 },
  { align: "LEFT", indent: 0, left: 1000, prev: 100, next: 300, lineSpacing: 150 },
  { align: "LEFT", indent: 0, left: 0, prev: 0, next: 0, lineSpacing: 130 },
  { align: "CENTER", indent: 0, left: 0, prev: 0, next: 0, lineSpacing: 130 },
  { align: "LEFT", indent: 0, left: 600, prev: 0, next: 0, lineSpacing: 130 },
];

// ── 타입 ────────────────────────────────────────────────────────────
interface Run {
  text: string;
  bold: boolean;
}

type Block =
  | { kind: "paragraph"; para: number; char: number; boldChar: number; runs: Run[] }
  | { kind: "table"; rows: Run[][][]; hasHeader: boolean };

export interface HwpxOptions {
  /** 문서 제목 — 패키지 메타에 기록 */
  title?: string;
}

// ── 문자열 ──────────────────────────────────────────────────────────
/** XML 1.0 에 쓸 수 없는 제어 문자를 지우고 특수 문자를 바꾼다 */
function xmlText(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 한글 기본 글꼴에 없는 그림 문자를 지운다 (법령 기호·체크 표시 같은 일반 기호는 남긴다) */
function stripPictographs(value: string): string {
  return value.replace(/[\u{1F000}-\u{1FAFF}\u{FE0F}\u{200D}\u{2139}]/gu, "");
}

// ── Markdown 읽기 ───────────────────────────────────────────────────
/** 한 줄 안의 서식을 풀어 굵기 구간으로 나눈다 — 링크는 글자만, 기울임·코드 표시는 지운다 */
function parseInline(source: string): Run[] {
  const text = stripPictographs(source)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<br\s*\/?>/gi, " ");
  const runs: Run[] = [];
  const parts = text.split("**");
  // ** 가 짝이 맞지 않으면 굵게로 해석하지 않는다
  if (parts.length % 2 === 0) return [{ text: text.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2"), bold: false }];
  parts.forEach((part, index) => {
    const cleaned = part.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2").replace(/~~([^~]+)~~/g, "$1");
    if (cleaned !== "") runs.push({ text: cleaned, bold: index % 2 === 1 });
  });
  return runs;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function paragraph(para: number, char: number, boldChar: number, text: string): Block {
  return { kind: "paragraph", para, char, boldChar, runs: parseInline(text) };
}

const HEADING_CHARS = [CHAR.title, CHAR.h2, CHAR.h3, CHAR.h4];

/** Markdown 을 문단·표 블록으로 나눈다 */
export function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];
  const flush = (): void => {
    if (buffer.length > 0) blocks.push(paragraph(PARA.body, CHAR.body, CHAR.bold, buffer.join(" ")));
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flush();
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        blocks.push({ kind: "paragraph", para: PARA.code, char: CHAR.small, boldChar: CHAR.smallBold, runs: [{ text: stripPictographs(lines[i]).replace(/\*\*/g, ""), bold: false }] });
        i += 1;
      }
      continue;
    }
    if (trimmed === "") {
      flush();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length, HEADING_CHARS.length);
      const char = HEADING_CHARS[level - 1];
      blocks.push(paragraph(level === 1 ? PARA.title : PARA.heading, char, char, heading[2].replace(/\s+#+$/, "")));
      continue;
    }
    if (trimmed.startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flush();
      const rows: Run[][][] = [splitTableRow(trimmed).map(parseInline)];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[i]).map(parseInline));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "table", rows, hasHeader: true });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      const text = trimmed.replace(/^>\s?/, "");
      if (text !== "") blocks.push(paragraph(PARA.quote, CHAR.small, CHAR.smallBold, text));
      continue;
    }
    const checkbox = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(trimmed);
    if (checkbox) {
      flush();
      blocks.push(paragraph(PARA.list, CHAR.body, CHAR.bold, `${checkbox[1] === " " ? "□" : "■"} ${checkbox[2]}`));
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flush();
      blocks.push(paragraph(PARA.list, CHAR.body, CHAR.bold, `- ${bullet[1]}`));
      continue;
    }
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      flush();
      blocks.push(paragraph(PARA.list, CHAR.body, CHAR.bold, `${ordered[1]}. ${ordered[2]}`));
      continue;
    }
    buffer.push(trimmed);
  }
  flush();
  return blocks;
}

// ── OWPML 쓰기 ──────────────────────────────────────────────────────
function seven(value: number | string): string {
  return ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"].map((k) => `${k}="${value}"`).join(" ");
}

function headerXml(): string {
  const fontfaces = FONT_LANGS.map(
    (lang) =>
      `<hh:fontface lang="${lang}" fontCnt="${FONTS.length}">` +
      FONTS.map(
        (face, id) =>
          `<hh:font id="${id}" face="${face}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>`,
      ).join("") +
      "</hh:fontface>",
  ).join("");
  const border = (id: number, type: string): string =>
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
    ["left", "right", "top", "bottom"].map((side) => `<hh:${side}Border type="${type}" width="0.12 mm" color="#000000"/>`).join("") +
    "</hh:borderFill>";
  const charProperties = CHAR_SPECS.map(
    (spec, id) =>
      `<hh:charPr id="${id}" height="${spec.height}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="${BORDER_NONE}"${spec.bold ? ' bold="1"' : ""}>` +
      `<hh:fontRef ${seven(spec.font)}/><hh:ratio ${seven(100)}/><hh:spacing ${seven(0)}/><hh:relSz ${seven(100)}/><hh:offset ${seven(0)}/></hh:charPr>`,
  ).join("");
  const paraHeads = [1, 2, 3, 4, 5, 6, 7]
    .map(
      (level) =>
        `<hh:paraHead start="1" level="${level}" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="DIGIT" charPrIDRef="4294967295" checkable="0"/>`,
    )
    .join("");
  const paraProperties = PARA_SPECS.map(
    (spec, id) =>
      `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0" textDir="AUTO">` +
      `<hh:align horizontal="${spec.align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>` +
      `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
      `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>` +
      `<hh:margin><hc:intent value="${spec.indent}" unit="HWPUNIT"/><hc:left value="${spec.left}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${spec.prev}" unit="HWPUNIT"/><hc:next value="${spec.next}" unit="HWPUNIT"/></hh:margin>` +
      `<hh:lineSpacing type="PERCENT" value="${spec.lineSpacing}"/>` +
      `<hh:border borderFillIDRef="${BORDER_NONE}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`,
  ).join("");
  return (
    `${XML_DECL}\n<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" version="1.4" secCnt="1">` +
    `<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>` +
    `<hh:fontfaces itemCnt="${FONT_LANGS.length}">${fontfaces}</hh:fontfaces>` +
    `<hh:borderFills itemCnt="2">${border(BORDER_NONE, "NONE")}${border(BORDER_SOLID, "SOLID")}</hh:borderFills>` +
    `<hh:charProperties itemCnt="${CHAR_SPECS.length}">${charProperties}</hh:charProperties>` +
    `<hh:tabProperties itemCnt="0"/>` +
    `<hh:numberings itemCnt="1"><hh:numbering id="1" start="0">${paraHeads}</hh:numbering></hh:numberings>` +
    `<hh:bullets itemCnt="0"/>` +
    `<hh:paraProperties itemCnt="${PARA_SPECS.length}">${paraProperties}</hh:paraProperties>` +
    `<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>` +
    `</hh:refList><hh:compatibleDocument targetProgram="HWP2018"><hh:layoutCompatibility/></hh:compatibleDocument></hh:head>`
  );
}

/** 구역 설정 — 첫 문단의 첫 글자 묶음 안에 들어간다 */
function sectionSetupXml(): string {
  const noteNumbering = '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>';
  return (
    `<hp:secPr textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">` +
    `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
    `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
    `<hp:pagePr landscape="WIDELY" width="${PAGE.width}" height="${PAGE.height}" gutterType="LEFT_ONLY"><hp:margin header="${PAGE.marginHeader}" footer="${PAGE.marginHeader}" gutter="0" left="${PAGE.marginSide}" right="${PAGE.marginSide}" top="${PAGE.marginTop}" bottom="${PAGE.marginBottom}"/></hp:pagePr>` +
    `<hp:footNotePr>${noteNumbering}<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>` +
    `<hp:endNotePr>${noteNumbering}<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>` +
    `</hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>`
  );
}

function runsXml(runs: Run[], char: number, boldChar: number, leading = ""): string {
  const list = runs.length > 0 ? runs : [{ text: "", bold: false }];
  return list
    .map((run, index) => `<hp:run charPrIDRef="${run.bold ? boldChar : char}">${index === 0 ? leading : ""}<hp:t>${xmlText(run.text)}</hp:t></hp:run>`)
    .join("");
}

function paragraphXml(para: number, char: number, boldChar: number, runs: Run[], leading = ""): string {
  return `<hp:p paraPrIDRef="${para}" styleIDRef="0">${runsXml(runs, char, boldChar, leading)}</hp:p>`;
}

function runsLength(runs: Run[]): number {
  return runs.reduce((sum, run) => sum + [...run.text].length, 0);
}

/** 열 너비 — 가장 긴 칸의 글자 수에 비례(너무 좁거나 넓지 않게 범위를 둔다) */
function columnWidths(rows: Run[][][], columns: number): number[] {
  const weights = Array.from({ length: columns }, (_, col) =>
    Math.min(MAX_COLUMN_WEIGHT, Math.max(MIN_COLUMN_WEIGHT, ...rows.map((row) => runsLength(row[col] ?? [])))),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.floor((TEXT_WIDTH * w) / total));
  widths[columns - 1] += TEXT_WIDTH - widths.reduce((a, b) => a + b, 0);
  return widths;
}

function tableXml(block: Extract<Block, { kind: "table" }>, tableId: number): string {
  const columns = Math.max(...block.rows.map((row) => row.length));
  const widths = columnWidths(block.rows, columns);
  const rowsXml = block.rows
    .map((row, rowIndex) => {
      const header = block.hasHeader && rowIndex === 0;
      const cells = Array.from({ length: columns }, (_, col) => {
        const runs = row[col] ?? [];
        const inner = header
          ? paragraphXml(PARA.cellCenter, CHAR.bold, CHAR.bold, runs)
          : paragraphXml(PARA.cell, CHAR.body, CHAR.bold, runs);
        return (
          `<hp:tc name="" header="${header ? 1 : 0}" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="${BORDER_SOLID}">` +
          `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${inner}</hp:subList>` +
          `<hp:cellAddr colAddr="${col}" rowAddr="${rowIndex}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${widths[col]}" height="${ROW_HEIGHT}"/>` +
          `<hp:cellMargin left="${CELL_MARGIN}" right="${CELL_MARGIN}" top="${CELL_MARGIN}" bottom="${CELL_MARGIN}"/></hp:tc>`
        );
      }).join("");
      return `<hp:tr>${cells}</hp:tr>`;
    })
    .join("");
  return (
    `<hp:tbl id="${tableId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${block.rows.length}" colCnt="${columns}" cellSpacing="0" borderFillIDRef="${BORDER_SOLID}" noShading="0">` +
    `<hp:sz width="${TEXT_WIDTH}" widthRelTo="ABSOLUTE" height="${ROW_HEIGHT * block.rows.length}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="600"/><hp:inMargin left="510" right="510" top="${CELL_MARGIN}" bottom="${CELL_MARGIN}"/>${rowsXml}</hp:tbl>`
  );
}

function sectionXml(blocks: Block[]): string {
  const setup = sectionSetupXml();
  let tableId = 1000;
  // 구역 설정은 첫 문단에 실려야 한다 — 문서가 표로 시작하면 빈 문단을 앞에 둔다
  const list: Block[] = blocks.length > 0 && blocks[0].kind === "paragraph" ? blocks : [paragraph(PARA.body, CHAR.body, CHAR.bold, ""), ...blocks];
  const body = list
    .map((block, index) => {
      const leading = index === 0 ? setup : "";
      if (block.kind === "paragraph") return paragraphXml(block.para, block.char, block.boldChar, block.runs, leading);
      tableId += 1;
      return `<hp:p paraPrIDRef="${PARA.body}" styleIDRef="0"><hp:run charPrIDRef="${CHAR.body}">${tableXml(block, tableId)}</hp:run></hp:p>`;
    })
    .join("");
  return `${XML_DECL}\n<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;
}

function previewText(blocks: Block[]): string {
  const lines = blocks.map((block) =>
    block.kind === "paragraph"
      ? block.runs.map((r) => r.text).join("")
      : block.rows.map((row) => row.map((cell) => cell.map((r) => r.text).join("")).join(" ")).join("\n"),
  );
  return lines.join("\n").slice(0, PREVIEW_TEXT_LIMIT);
}

// ── ZIP 쓰기 ────────────────────────────────────────────────────────
interface ZipEntry {
  name: string;
  data: Buffer;
  /** mimetype 은 압축하지 않고 맨 앞에 둔다 (패키지 형식 규칙) */
  store?: boolean;
}

function zip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.store ? ZIP_METHOD_STORE : ZIP_METHOD_DEFLATE;
    const body = entry.store ? entry.data : deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(ZIP_FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(ZIP_DOS_TIME, 10);
    local.writeUInt16LE(ZIP_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(ZIP_VERSION, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(ZIP_FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(ZIP_DOS_TIME, 12);
    central.writeUInt16LE(ZIP_DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, body);
    centralParts.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

// ── 공개 함수 ───────────────────────────────────────────────────────
/** Markdown 문서를 HWPX 파일 내용으로 바꾼다. 같은 입력이면 같은 바이트가 나온다 */
export function markdownToHwpx(markdown: string, options: HwpxOptions = {}): Buffer {
  const blocks = parseMarkdownBlocks(markdown);
  const title = xmlText(options.title ?? "");
  const text = (value: string): Buffer => Buffer.from(value, "utf8");
  return zip([
    { name: "mimetype", data: text(HWPX_MIME_TYPE), store: true },
    {
      name: "version.xml",
      data: text(
        `${XML_DECL}\n<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="${GENERATOR}" appVersion="1"/>`,
      ),
    },
    {
      name: "META-INF/container.xml",
      data: text(
        `${XML_DECL}\n<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>`,
      ),
    },
    {
      name: "Contents/content.hpf",
      data: text(
        `${XML_DECL}\n<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">` +
          `<opf:metadata><opf:title>${title}</opf:title><opf:meta name="generator" content="${GENERATOR}"/></opf:metadata>` +
          `<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/></opf:manifest>` +
          `<opf:spine><opf:itemref idref="header" linear="no"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`,
      ),
    },
    { name: "Contents/header.xml", data: text(headerXml()) },
    { name: "Contents/section0.xml", data: text(sectionXml(blocks)) },
    { name: "Preview/PrvText.txt", data: text(previewText(blocks)) },
  ]);
}
