export const DOCLANG_VERSION = "0.6";

import type { DocumentNode, DocumentSection, DocumentSectionField } from "./graph-nodes-loader.js";
import { kstToday } from "./datetime-kst.js";
import { renderIri } from "./iri-renderer.js";

const XML_ESCAPE_PATTERN = /[&<>"\u0000]/g;
const XML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "\u0000": "",
};
const TAG = {
  root: "doclang",
  head: "head",
  title: "title",
  description: "description",
  heading: "heading",
  text: "text",
  table: "table",
  caption: "caption",
  list: "list",
  listItem: "ldiv",
  pageBreak: "page_break",
  custom: "custom",
  fieldRegion: "field_region",
  fieldItem: "field_item",
  key: "key",
  value: "value",
} as const;
const OTSL = {
  dataCell: "fcel",
  columnHeader: "ched",
  rowHeader: "rhed",
  leftMerged: "lcel",
  upMerged: "ucel",
  crossMerged: "xcel",
  nextLine: "nl",
} as const;
const CUSTOM_TAG = {
  docId: "doc_id",
  documentIri: "document_iri",
  documentCategory: "document_category",
  legalBasis: "legal_basis",
  legalSource: "legal_source",
  iri: "iri",
} as const;
const VALUE_CLASS_FILLABLE = "fillable";
const LIST_CLASS_ORDERED = "ordered";
const LIST_CLASS_UNORDERED = "unordered";
const MIN_SPAN = 1;
const MIN_HEADING_LEVEL = 1;
const MAX_HEADING_LEVEL = 6;
const COMMON_META_KEYS = new Set(["documentNumber", "siteName", "compileDate", "compiler"]);
const COMMON_APPROVAL_KEYS = new Set([
  "compiler_sign",
  "compilerSign",
  "supervisor_sign",
  "supervisorSign",
  "principal_sign",
  "principalSign",
  "approver_name",
]);
const WORK_CONDITION_LABELS: Record<string, string> = {
  depthM: "굴착 깊이 (m)",
  heightM: "작업 높이 (m)",
  voltageV: "전압 (V)",
  workforce: "작업 인원 (명)",
  location: "작업 위치·상세",
  locationDetail: "작업 위치·상세",
  weather: "기상 조건",
  duration: "작업 시간",
  chemicalName: "취급 화학물질",
  spanM: "지간 길이 (m)",
};
const CONTROL_TIER_LABELS: Record<number, string> = {
  1: "1. 제거 (Elimination)",
  2: "2. 대체 (Substitution)",
  3: "3. 공학적 (Engineering)",
  4: "4. 관리적 (Administrative)",
  5: "5. 보호구 (PPE)",
};
const DEFAULT_SAFETY_DISCLAIMER =
  "본 문서는 agent-safety-oss 가 생성한 초안입니다. 결재·제출 전에 안전관리자 본인이 본문·법령 인용·필수 항목을 직접 검토하고, review_safety_document 도구로 환각·누락을 확인하세요. 작성 주체는 안전관리자이며 본 OSS 는 작성 보조만 수행합니다.";

type HeaderKind = "none" | "column" | "row";
type CellKind =
  | typeof OTSL.dataCell
  | typeof OTSL.leftMerged
  | typeof OTSL.upMerged
  | typeof OTSL.crossMerged;

interface AnchorMark {
  kind: typeof OTSL.dataCell;
  body: string;
  headerKind: HeaderKind;
}

interface SpanMark {
  kind: Exclude<CellKind, typeof OTSL.dataCell>;
}

type GridMark = AnchorMark | SpanMark;

export interface DoclangCellBlock {
  type: "heading" | "text" | "list" | "table";
  text?: unknown;
  level?: number;
  listType?: typeof LIST_CLASS_ORDERED | typeof LIST_CLASS_UNORDERED;
  children?: DoclangCellBlock[];
  table?: DoclangTable;
}

export interface DoclangTableCell {
  text?: unknown;
  blocks?: DoclangCellBlock[];
  colSpan?: number;
  rowSpan?: number;
  isHeader?: boolean;
}

export interface DoclangTable {
  caption?: string;
  rows: DoclangTableCell[][];
  hasHeader?: boolean;
  customXml?: string;
}

export interface DoclangKoshaGuideInfo {
  iri: string;
  guideNo: string;
  title: string;
}

export interface DoclangHazardInfo {
  iri: string;
  label: string;
  category: string;
  mitigatedBy?: string[];
  koshaArchiveFacets?: string[];
}

export interface DoclangControlInfo {
  iri: string;
  label: string;
  ericLevel: number;
}

export interface SafetyDocumentDoclangInput {
  document: DocumentNode;
  draft: Record<string, unknown>;
  sections: DocumentSection[];
  kosha: DoclangKoshaGuideInfo[];
  hazards: DoclangHazardInfo[];
  controls: DoclangControlInfo[];
  directControlIris: ReadonlySet<string>;
  legalBodyByIri: ReadonlyMap<string, string | undefined>;
  hazardFallbackSuppressed: boolean;
  documentCategory: string;
  missingRequiredCount: number;
  statusText?: string;
  safetyDisclaimer?: string;
}

function escapeXml(value: unknown): string {
  return String(value ?? "").replace(XML_ESCAPE_PATTERN, (char) => XML_ESCAPE_MAP[char] ?? "");
}

function escapeXmlAttribute(value: unknown): string {
  return escapeXml(value);
}

function attrString(attrs: Record<string, unknown> = {}): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${escapeXmlAttribute(value)}"`)
    .join("");
}

function element(tag: string, body: string, attrs?: Record<string, unknown>): string {
  return `<${tag}${attrString(attrs)}>${body}</${tag}>`;
}

function emptyElement(tag: string, attrs?: Record<string, unknown>): string {
  return `<${tag}${attrString(attrs)}/>`;
}

function clampSpan(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return MIN_SPAN;
  return Math.max(MIN_SPAN, Math.trunc(value));
}

function clampHeadingLevel(level: number | undefined): number {
  if (typeof level !== "number" || !Number.isFinite(level)) return MIN_HEADING_LEVEL;
  return Math.min(MAX_HEADING_LEVEL, Math.max(MIN_HEADING_LEVEL, Math.trunc(level)));
}

function toText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      return `${value.length}건 (상세 입력 참조)`;
    }
    return value.map((item) => toText(item)).filter(Boolean).join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeRows(rows: DoclangTableCell[][]): { rows: DoclangTableCell[][]; rowCount: number; colCount: number } {
  const rowCount = rows.length;
  const colCount = Math.max(0, ...rows.map((row) => row.length));
  return {
    rowCount,
    colCount,
    rows: rows.map((row) => Array.from({ length: colCount }, (_, index) => row[index] ?? { text: "" })),
  };
}

function getCell(table: DoclangTable, row: number, col: number): DoclangTableCell | undefined {
  return table.rows[row]?.[col];
}

function hasHeaderBelow(table: DoclangTable, row: number, col: number): boolean {
  for (let r = row + 1; r < table.rows.length; r += 1) {
    if (getCell(table, r, col)?.isHeader === true) return true;
  }
  return false;
}

function hasHeaderRight(table: DoclangTable, row: number, col: number): boolean {
  const colCount = table.rows[row]?.length ?? 0;
  for (let c = col + 1; c < colCount; c += 1) {
    if (getCell(table, row, c)?.isHeader === true) return true;
  }
  return false;
}

function detectHeaderKind(table: DoclangTable, row: number, col: number, cell: DoclangTableCell): HeaderKind {
  if (cell.isHeader === true) {
    if (hasHeaderRight(table, row, col) && !hasHeaderBelow(table, row, col)) return "row";
    if (hasHeaderBelow(table, row, col) && !hasHeaderRight(table, row, col)) return "column";
    return col === 0 && row > 0 ? "row" : "column";
  }
  return table.hasHeader === true && row === 0 ? "column" : "none";
}

function cellTag(headerKind: HeaderKind): string {
  if (headerKind === "column") return OTSL.columnHeader;
  if (headerKind === "row") return OTSL.rowHeader;
  return OTSL.dataCell;
}

function serializeListBlock(block: DoclangCellBlock): string {
  const listClass = block.listType === LIST_CLASS_ORDERED ? LIST_CLASS_ORDERED : LIST_CLASS_UNORDERED;
  const children = (block.children ?? []).map((child) => serializeCellBlock(child)).filter(Boolean).join("\n");
  const body = [emptyElement(TAG.listItem) + escapeXml(block.text), children].filter(Boolean).join("\n");
  return element(TAG.list, body, { class: listClass });
}

function serializeCellBlock(block: DoclangCellBlock): string {
  if (block.type === "heading") {
    return element(TAG.heading, escapeXml(block.text), { level: clampHeadingLevel(block.level) });
  }
  if (block.type === "list") return serializeListBlock(block);
  if (block.type === "table" && block.table) return tableToOtsl(block.table);
  const text = toText(block.text);
  return text.trim() ? element(TAG.text, escapeXml(text)) : "";
}

function serializeCellBody(cell: DoclangTableCell): string {
  if (cell.blocks?.length) {
    const body = cell.blocks.map((block) => serializeCellBlock(block)).filter(Boolean);
    if (body.length > 0) return body.join("");
  }
  return escapeXml(toText(cell.text));
}

function createMarkGrid(inputTable: DoclangTable): GridMark[][] {
  const normalized = normalizeRows(inputTable.rows);
  const table: DoclangTable = { ...inputTable, rows: normalized.rows };
  const mark: (GridMark | null)[][] = Array.from(
    { length: normalized.rowCount },
    () => Array<GridMark | null>(normalized.colCount).fill(null),
  );

  for (let row = 0; row < normalized.rowCount; row += 1) {
    for (let col = 0; col < normalized.colCount; col += 1) {
      if (mark[row]?.[col]) continue;

      const cell = getCell(table, row, col);
      if (!cell) {
        mark[row][col] = { kind: OTSL.dataCell, body: "", headerKind: "none" };
        continue;
      }

      const colSpan = clampSpan(cell.colSpan);
      const rowSpan = clampSpan(cell.rowSpan);

      for (let dRow = 0; dRow < rowSpan && row + dRow < normalized.rowCount; dRow += 1) {
        for (let dCol = 0; dCol < colSpan && col + dCol < normalized.colCount; dCol += 1) {
          if (dRow === 0 && dCol === 0) {
            mark[row][col] = {
              kind: OTSL.dataCell,
              body: serializeCellBody(cell),
              headerKind: detectHeaderKind(table, row, col, cell),
            };
          } else {
            mark[row + dRow][col + dCol] = {
              kind: dRow === 0 ? OTSL.leftMerged : dCol === 0 ? OTSL.upMerged : OTSL.crossMerged,
            };
          }
        }
      }
    }
  }

  return mark.map((row) =>
    row.map((cell) => cell ?? { kind: OTSL.dataCell, body: "", headerKind: "none" }),
  );
}

export function tableToOtsl(table: DoclangTable): string {
  const mark = createMarkGrid(table);
  const lines: string[] = [`<${TAG.table}>`];

  if (table.caption?.trim()) lines.push(element(TAG.caption, escapeXml(table.caption)));
  if (table.customXml) lines.push(table.customXml);

  for (const row of mark) {
    let line = "";
    for (const cell of row) {
      if (cell.kind === OTSL.dataCell) {
        line += emptyElement(cellTag(cell.headerKind)) + cell.body;
      } else {
        line += emptyElement(cell.kind);
      }
    }
    lines.push(line + emptyElement(OTSL.nextLine));
  }

  lines.push(`</${TAG.table}>`);
  return lines.join("\n");
}

function metadataToHead(document: DocumentNode): string {
  const entries = [
    element(TAG.title, escapeXml(document.title)),
    document.description ? element(TAG.description, escapeXml(document.description)) : "",
  ].filter(Boolean);
  return element(TAG.head, entries.join("\n"));
}

function customXml(entries: Array<{ tag: string; value?: unknown; values?: unknown[]; itemTag?: string }>): string {
  const body = entries
    .map((entry) => {
      if (entry.values) {
        const itemTag = entry.itemTag ?? CUSTOM_TAG.iri;
        const items = entry.values.map((value) => element(itemTag, escapeXml(value))).join("");
        return items ? element(entry.tag, items) : "";
      }
      if (entry.value === undefined || entry.value === null || entry.value === "") return "";
      return element(entry.tag, escapeXml(entry.value));
    })
    .filter(Boolean)
    .join("");
  return body ? element(TAG.custom, body) : "";
}

function heading(level: number, text: string, custom = ""): string {
  return element(TAG.heading, custom + escapeXml(text), { level: clampHeadingLevel(level) });
}

function textElement(text: unknown): string {
  const value = toText(text);
  return value.trim() ? element(TAG.text, escapeXml(value)) : "";
}

function listElement(items: unknown[], listClass: typeof LIST_CLASS_ORDERED | typeof LIST_CLASS_UNORDERED = LIST_CLASS_UNORDERED): string {
  const body = items
    .map((item) => emptyElement(TAG.listItem) + escapeXml(toText(item)))
    .filter((item) => item !== emptyElement(TAG.listItem))
    .join("\n");
  return body ? element(TAG.list, body, { class: listClass }) : "";
}

function tableCell(text: unknown, isHeader = false, extra: Partial<DoclangTableCell> = {}): DoclangTableCell {
  return { text, isHeader, ...extra };
}

function keyValueTable(caption: string, rows: Array<[unknown, unknown]>): string {
  return tableToOtsl({
    caption,
    hasHeader: true,
    rows: [
      [tableCell("항목", true), tableCell("내용", true)],
      ...rows.map(([key, value]) => [tableCell(key, true), tableCell(value)]),
    ],
  });
}

function simpleTable(caption: string, headers: string[], rows: unknown[][]): string {
  return tableToOtsl({
    caption,
    hasHeader: true,
    rows: [
      headers.map((header) => tableCell(header, true)),
      ...rows.map((row) => row.map((value) => tableCell(value))),
    ],
  });
}

function getRawFieldValue(draft: Record<string, unknown>, fieldKey: string, fieldLabel?: string): unknown {
  const sections = (draft.sections ?? {}) as Record<string, Record<string, unknown>>;
  for (const sec of Object.values(sections)) {
    if (fieldKey in sec) return sec[fieldKey];
    if (fieldLabel && fieldLabel in sec) return sec[fieldLabel];
  }
  if (fieldKey.includes(".")) {
    const [outer, inner] = fieldKey.split(".", 2);
    const outerValue = draft[outer];
    if (outerValue && typeof outerValue === "object" && inner in (outerValue as Record<string, unknown>)) {
      return (outerValue as Record<string, unknown>)[inner];
    }
  }
  if (fieldKey in draft) return draft[fieldKey];
  if (fieldLabel && fieldLabel in draft) return draft[fieldLabel];
  const raw = draft.raw;
  if (raw && typeof raw === "object" && fieldKey in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>)[fieldKey];
  }
  if (fieldLabel && raw && typeof raw === "object" && fieldLabel in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>)[fieldLabel];
  }
  return undefined;
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function buildMetaRows(document: DocumentNode, draft: Record<string, unknown>): Array<[string, unknown]> {
  const metadata = (draft.metadata ?? {}) as Record<string, unknown>;
  const siteName = draft.siteName ?? draft.projectName ?? metadata.siteName ?? metadata.projectName ?? "(미작성)";
  const planDate = draft.compileDate ?? draft.planDate ?? metadata.planDate ?? metadata.assessmentDate ?? kstToday();
  const supervisor = draft.supervisor ?? draft.compiler ?? draft.principal_sign ?? metadata.supervisor;
  const period =
    draft.workPeriod ??
    draft.validPeriod ??
    draft.effectivePeriod ??
    metadata.workPeriod ??
    metadata.validPeriod ??
    metadata.effectivePeriod;
  const docNumber =
    draft.documentNumber ?? draft.documentId ?? "(자동) DOC-" + String(planDate ?? "YYYYMMDD").replace(/-/g, "") + "-001";
  const rows: Array<[string, unknown]> = [
    ["docId", document.docId],
    ["문서번호", docNumber],
    ["현장명/사업장명", siteName],
    ["작성일", planDate],
  ];
  if (!isEmptyValue(period)) rows.push(["작업기간/유효기간", period]);
  if (!isEmptyValue(supervisor)) rows.push(["작성책임자", supervisor]);
  return rows;
}

function renderApprovalChain(draft: Record<string, unknown>): string {
  const chain = Array.isArray(draft.approvalChain) ? draft.approvalChain : [];
  const rows = chain.length > 0
    ? chain.map((item) => {
        const row = item as Record<string, unknown>;
        return [row.role ?? "", row.name ?? "", row.signed ? "서명" : "(미서명)", row.date ?? "(미기재)"];
      })
    : [
        ["사업주", "(미작성)", "(미서명)", "(미기재)"],
        ["관리감독자", "(미작성)", "(미서명)", "(미기재)"],
        ["근로자대표", "(미작성)", "(미서명)", "(미기재)"],
      ];
  return simpleTable("결재선", ["역할", "성명", "서명", "일자"], rows);
}

function shouldSkipGenericSection(sec: DocumentSection): boolean {
  const keys = (sec.fields ?? []).map((field) => field.key);
  if (keys.length === 0) return false;
  if (keys.every((key) => COMMON_META_KEYS.has(key)) && /문서\s*메타|사업장\s*정보/.test(sec.title)) return true;
  if (keys.every((key) => COMMON_APPROVAL_KEYS.has(key)) && /결재선/.test(sec.title)) return true;
  return false;
}

function sectionTitle(index: number, section: DocumentSection): string {
  const hasOwnNumber = /^\s*(\d+[\.\-)]|[①-⑳]|\([0-9]+\)|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ][\s.\-]|[가나다라마바사아자차]\.\s)/.test(
    section.title,
  );
  return hasOwnNumber ? section.title : `${index}. ${section.title}`;
}

function renderSection(index: number, section: DocumentSection, draft: Record<string, unknown>): string {
  const custom = customXml([{ tag: CUSTOM_TAG.legalSource, value: section.legalSource }]);
  const body = [heading(2, sectionTitle(index, section), custom)];

  if (section.fields.length > 0) {
    body.push(keyValueTable(section.title, section.fields.map((field) => {
      const value = getRawFieldValue(draft, field.key, field.label);
      return [field.label, isEmptyValue(value) ? "" : toText(value)];
    })));
  }

  const guideLines = section.fields
    .filter((field) => isEmptyValue(getRawFieldValue(draft, field.key, field.label)) && field.inputGuide)
    .flatMap((field) => [
      `${field.label}: ${field.inputGuide}`,
      field.standardFormat ? `표준 형식: ${field.standardFormat}` : "",
      ...(field.examples ?? []).map((example) => `예시: ${toText(example)}`),
      field.checkPoints?.length ? `체크포인트: ${field.checkPoints.join(" / ")}` : "",
    ])
    .filter(Boolean);
  if (guideLines.length > 0) body.push(listElement(guideLines));

  if (section.notes?.length) body.push(...section.notes.map((note) => textElement(note)));
  return body.filter(Boolean).join("\n");
}

function renderWorkConditions(draft: Record<string, unknown>): string {
  const workConditions = draft.workConditions;
  if (!workConditions || typeof workConditions !== "object" || Array.isArray(workConditions)) return "";
  const rows = Object.entries(workConditions as Record<string, unknown>).map(([key, value]) => [
    WORK_CONDITION_LABELS[key] ?? key,
    value,
  ]);
  return rows.length > 0 ? keyValueTable("작업 조건", rows as Array<[unknown, unknown]>) : "";
}

function renderHazards(input: SafetyDocumentDoclangInput): string {
  const title = input.hazards.length === 0 && input.hazardFallbackSuppressed
    ? "식별된 위험 요소"
    : `식별된 위험 요소 (그래프 추론 — KOSHA Guide ${input.kosha.length}건 기반)`;
  if (input.hazards.length === 0) {
    return [heading(2, title), textElement(
      input.hazardFallbackSuppressed
        ? "본 문서는 행정·선임·게시·보고 성격으로 특정 작업 위험요인을 다루지 않습니다 (위험요인 미해당)."
        : "(그래프 매핑된 Hazard 없음)",
    )].join("\n");
  }
  return [
    heading(2, title),
    simpleTable(
      "위험 요소",
      ["위험 분류", "카테고리"],
      input.hazards.map((hazard) => [hazard.label, hazard.category]),
    ),
  ].join("\n");
}

function renderControls(input: SafetyDocumentDoclangInput): string {
  const headingXml = heading(2, "권장 안전대책 (ERIC-PP 위계 — 그래프 추론)");
  if (input.controls.length === 0) return [headingXml, textElement("(그래프 매핑된 Control 없음)")].join("\n");

  const rows = input.controls.slice(0, 15).map((control) => [
    CONTROL_TIER_LABELS[control.ericLevel] ?? control.ericLevel,
    control.label,
    input.directControlIris.has(control.iri) ? "직접" : "—",
  ]);
  return [
    headingXml,
    textElement("ERIC-PP 5계층은 제거, 대체, 공학적, 관리적, 보호구 순으로 상위 계층 통제를 우선 적용합니다."),
    simpleTable("권장 안전대책", ["위계", "대책", "매핑"], rows),
  ].join("\n");
}

function renderKosha(input: SafetyDocumentDoclangInput): string {
  if (input.kosha.length === 0) {
    return [heading(2, "적용 KOSHA Guide (0건)"), textElement("(매핑된 KOSHA Guide 없음)")].join("\n");
  }
  return [
    heading(2, `적용 KOSHA Guide (${input.kosha.length}건)`),
    simpleTable("적용 KOSHA Guide", ["번호", "제목"], input.kosha.slice(0, 30).map((guide) => [guide.guideNo, guide.title])),
  ].join("\n");
}

function renderLegalBasis(input: SafetyDocumentDoclangInput): string {
  const legalBasis = input.document.legalBasis ?? [];
  if (legalBasis.length === 0) return "";
  const body = [heading(2, "법령 근거")];
  for (const iri of legalBasis) {
    const excerpt = input.legalBodyByIri.get(iri);
    body.push(heading(3, renderIri(iri), customXml([{ tag: CUSTOM_TAG.legalBasis, values: [iri] }])));
    if (excerpt) body.push(textElement(excerpt.length >= 200 ? `${excerpt.slice(0, 200)} ⋯ (전문은 별첨)` : excerpt));
  }
  if (input.document.penaltyOnMissing) {
    const penalties = Array.isArray(input.document.penaltyOnMissing)
      ? input.document.penaltyOnMissing
      : [input.document.penaltyOnMissing];
    body.push(heading(3, "위반 시 처벌"));
    body.push(listElement(penalties.map((penalty) => renderIri(penalty))));
  }
  return body.filter(Boolean).join("\n");
}

function renderEmergencyContacts(draft: Record<string, unknown>): string {
  const contacts = (draft.emergencyContacts ?? {}) as Record<string, unknown>;
  return [
    heading(2, "비상연락망"),
    listElement([
      `119 (소방): ${contacts.fire ?? "119"}`,
      `관할 지방고용노동청: ${contacts.labor ?? "(미기재 — 작성 필수)"}`,
      `응급의료기관: ${contacts.hospital ?? "(미기재 — 작성 필수)"}`,
      `사업주 비상연락: ${contacts.owner ?? "(미기재 — 작성 필수)"}`,
    ]),
  ].join("\n");
}

function renderWorkerNotification(draft: Record<string, unknown>): string {
  const notification = draft.workerNotification;
  if (!notification || typeof notification !== "object" || Array.isArray(notification)) return "";
  const wn = notification as Record<string, unknown>;
  return [
    heading(2, "근로자 통지"),
    listElement([
      `통지 방법: ${wn.method ?? "(미기재 — TBM·게시·서명 권장)"}`,
      `통지 일자: ${wn.date ?? "(미기재)"}`,
      `통지 증빙: ${wn.evidence ?? "(미기재)"}`,
    ]),
  ].join("\n");
}

function fieldRegion(sections: DocumentSection[], draft: Record<string, unknown>): string {
  const fields = sections.flatMap((section) => section.fields ?? []);
  if (fields.length === 0) return "";
  const items = fields.map((field: DocumentSectionField) => {
    const value = getRawFieldValue(draft, field.key, field.label);
    const valueXml = isEmptyValue(value)
      ? element(TAG.value, "", { class: VALUE_CLASS_FILLABLE })
      : element(TAG.value, escapeXml(toText(value)));
    return element(TAG.fieldItem, element(TAG.key, escapeXml(field.label || field.key)) + valueXml);
  });
  return element(TAG.fieldRegion, `\n${items.join("\n")}\n`);
}

export function serializeSafetyDocumentToDoclang(input: SafetyDocumentDoclangInput): string {
  const document = input.document;
  const draft = input.draft;
  const custom = customXml([
    { tag: CUSTOM_TAG.docId, value: document.docId },
    { tag: CUSTOM_TAG.documentIri, value: document["@id"] },
    { tag: CUSTOM_TAG.documentCategory, value: input.documentCategory },
    { tag: CUSTOM_TAG.legalBasis, values: document.legalBasis ?? [] },
  ]);
  const genericSections = input.sections.filter((section) => !shouldSkipGenericSection(section));
  const body = [
    metadataToHead(document),
    textElement(input.statusText),
    heading(1, document.title, custom),
    document.description ? textElement(document.description) : "",
    keyValueTable("문서 메타", buildMetaRows(document, draft)),
    renderApprovalChain(draft),
    renderWorkConditions(draft),
    ...genericSections.map((section, index) => renderSection(index + 1, section, draft)),
    renderHazards(input),
    renderControls(input),
    renderKosha(input),
    renderLegalBasis(input),
    renderEmergencyContacts(draft),
    renderWorkerNotification(draft),
    input.document.retention ? textElement(`보존: ${input.document.retention}`) : "",
    textElement(input.safetyDisclaimer ?? DEFAULT_SAFETY_DISCLAIMER),
    fieldRegion(genericSections, draft),
  ].filter(Boolean);

  return `<${TAG.root} version="${DOCLANG_VERSION}">\n${body.join("\n")}\n</${TAG.root}>\n`;
}
