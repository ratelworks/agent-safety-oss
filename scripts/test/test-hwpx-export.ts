#!/usr/bin/env tsx
/**
 * test-hwpx-export.ts — HWPX(한글) 내보내기 회귀 시험
 *
 *   1. 패키지 구성 — ZIP 을 직접 읽어 항목 순서·mimetype 무압축·CRC·XML 정합 확인
 *   2. 내용 — 제목·문단·굵게·목록·표가 본문 XML 에 들어가고 특수 문자가 바뀌는지
 *   3. 문서 96종 전부를 HWPX 로 만들고 본문 XML 이 읽히는지
 *   4. 결재·제출용 정리 — 작성 안내와 검사 상태 머리말이 빠지는지
 *   5. 도구 연동 — generate_safety_document·export_drafted_document 의 hwpx 형식이 파일을 저장하는지
 *
 * 한글 프로그램에서 실제로 열리는지는 이 시험이 확인하지 않는다(프로그램이 있어야 한다).
 */
import { inflateRawSync, crc32 } from "node:zlib";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser, XMLValidator } from "fast-xml-parser";

// ── 상수 ────────────────────────────────────────────────────────────
// 저장 폴더는 도구를 불러오기 전에 임시 폴더로 돌린다(사용자 자료를 건드리지 않는다)
process.env.SAFETY_LOCAL_DIR = mkdtempSync(join(tmpdir(), "hwpx-export-test-"));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCUMENTS_DIR = join(ROOT, "src", "ontology", "graph", "nodes", "documents");
const EXPECTED_ENTRIES = [
  "mimetype",
  "version.xml",
  "META-INF/container.xml",
  "Contents/content.hpf",
  "Contents/header.xml",
  "Contents/section0.xml",
  "Preview/PrvText.txt",
];
const OWNER_ONLY_MODE = 0o600;

const { markdownToHwpx, HWPX_MIME_TYPE } = await import("../../src/lib/hwpx-writer.js");
const { toApprovalCopy } = await import("../../src/lib/approval-copy.js");
const { TOOLS } = await import("../../src/tool-registry.js");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Entry { name: string; method: number; data: Buffer; crcOk: boolean }

/** ZIP 을 직접 읽는다 — 중앙 목록을 따라가며 항목을 풀고 CRC 를 대조 */
function readZip(buffer: Buffer): Entry[] {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("ZIP 끝 표지 없음");
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("중앙 목록 표지 오류");
    const method = buffer.readUInt16LE(pos + 10);
    const expectedCrc = buffer.readUInt32LE(pos + 16);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString("utf8");
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    entries.push({ name, method, data, crcOk: crc32(data) === expectedCrc });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function sectionOf(buffer: Buffer): string {
  return readZip(buffer).find((e) => e.name === "Contents/section0.xml")!.data.toString("utf8");
}

async function callTool(name: string, input: Record<string, unknown>): Promise<{ text: string; structured: Record<string, unknown>; isError: boolean }> {
  const tool = (TOOLS as Array<{ name: string; handler: (i: unknown) => Promise<any> }>).find((t) => t.name === name)!;
  const r = await tool.handler(input);
  return { text: r.content?.[0]?.text ?? "", structured: r.structuredContent ?? {}, isError: r.isError === true };
}

// 1. 패키지 구성
const SAMPLE = "# 제목 문서\n\n본문 **굵게** 와 A & B <C>.\n\n## 1. 절\n\n- 항목\n- [x] 확인함\n1. 첫째\n\n| 역할 | 성명 |\n|---|---|\n| 사업주 | 홍길동 |\n\n> 인용\n\n```\n제38조 <개정>\n```\n";
const sample = markdownToHwpx(SAMPLE, { title: "시험 & <문서>" });
const entries = readZip(sample);
check("항목 구성과 순서", JSON.stringify(entries.map((e) => e.name)) === JSON.stringify(EXPECTED_ENTRIES), entries.map((e) => e.name).join(","));
check("mimetype 이 첫 항목·무압축·정해진 값", entries[0].method === 0 && entries[0].data.toString("utf8") === HWPX_MIME_TYPE);
check("모든 항목의 CRC 일치", entries.every((e) => e.crcOk));
for (const e of entries.filter((x) => x.name.endsWith(".xml") || x.name.endsWith(".hpf"))) {
  check(`XML 정합: ${e.name}`, XMLValidator.validate(e.data.toString("utf8")) === true);
}
check("같은 입력이면 같은 파일", markdownToHwpx(SAMPLE, { title: "시험 & <문서>" }).equals(sample));
check("제목의 특수 문자 변환", entries.find((e) => e.name === "Contents/content.hpf")!.data.toString("utf8").includes("<opf:title>시험 &amp; &lt;문서&gt;</opf:title>"));

// 2. 내용
const section = sectionOf(sample);
check("구역 설정이 첫 문단에 한 번", (section.match(/<hp:secPr /g) ?? []).length === 1 && section.indexOf("<hp:secPr ") < section.indexOf("<hp:t>"));
check("제목 글자", section.includes("<hp:t>제목 문서</hp:t>"));
check("굵게 구간 분리", /charPrIDRef="1"><hp:t>굵게<\/hp:t>/.test(section));
check("특수 문자 변환", section.includes("A &amp; B &lt;C&gt;.") && section.includes("제38조 &lt;개정&gt;"));
check("목록·체크 상자·번호", section.includes("<hp:t>- 항목</hp:t>") && section.includes("<hp:t>■ 확인함</hp:t>") && section.includes("<hp:t>1. 첫째</hp:t>"));
check("표 2행 2열", section.includes('rowCnt="2" colCnt="2"') && (section.match(/<hp:tc /g) ?? []).length === 4);
check("표 머리 행 표시", (section.match(/<hp:tc name="" header="1"/g) ?? []).length === 2);
const parsed = new XMLParser({ ignoreAttributes: false }).parse(section) as Record<string, unknown>;
check("본문 XML 이 읽힘", "hs:sec" in parsed);
check("표로 시작해도 구역 설정이 문단에 실림", sectionOf(markdownToHwpx("| a | b |\n|---|---|\n| 1 | 2 |\n")).indexOf("<hp:secPr ") < sectionOf(markdownToHwpx("| a | b |\n|---|---|\n| 1 | 2 |\n")).indexOf("<hp:tbl "));
check("빈 입력도 파일이 됨", readZip(markdownToHwpx("")).length === EXPECTED_ENTRIES.length);
check("제어 문자 제거", !sectionOf(markdownToHwpx(`가${String.fromCharCode(7)}나`)).includes(String.fromCharCode(7)));

// 3·4. 문서 96종
const docIds = readdirSync(DOCUMENTS_DIR)
  .filter((f) => f.endsWith(".jsonld"))
  .map((f) => (JSON.parse(readFileSync(join(DOCUMENTS_DIR, f), "utf8")) as { docId: string }).docId);
let built = 0;
const broken: string[] = [];
const noisy: string[] = [];
for (const docId of docIds) {
  const md = (await callTool("generate_safety_document", { docId, useProfile: false })).text;
  const copy = toApprovalCopy(md);
  if (/결재 사용 불가|자동 검사 통과|작성 가이드|structuredContent|agent-safety-oss 가 생성한/.test(copy)) noisy.push(docId);
  const xml = sectionOf(markdownToHwpx(copy));
  if (XMLValidator.validate(xml) !== true || !xml.includes("<hp:t>")) broken.push(docId);
  else built += 1;
}
check(`문서 ${docIds.length}종 모두 HWPX 본문 생성`, docIds.length > 0 && built === docIds.length, broken.slice(0, 3).join(","));
check("결재·제출용 정리 — 안내·머리말 제거", noisy.length === 0, noisy.slice(0, 3).join(","));

// 5. 도구 연동
const generated = await callTool("generate_safety_document", { docId: "daily_tbm", useProfile: false, format: "hwpx", draft: { todayWork: "굴착" } });
const generatedPath = String(generated.structured.hwpxPath ?? "");
check("문서 생성(hwpx)이 파일 경로를 돌려줌", !generated.isError && generatedPath.endsWith(".hwpx") && generated.text.includes(generatedPath));
check("저장 파일이 임시 저장 폴더 안에 있음", generatedPath.startsWith(process.env.SAFETY_LOCAL_DIR!));
const saved = readFileSync(generatedPath);
check("저장 파일이 HWPX 패키지", readZip(saved)[0].data.toString("utf8") === HWPX_MIME_TYPE && sectionOf(saved).includes("굴착"));
check("저장 파일은 소유자만 읽고 씀", (statSync(generatedPath).mode & 0o777) === OWNER_ONLY_MODE);
check("파일 크기 보고 일치", generated.structured.hwpxBytes === saved.length);
const exported = await callTool("export_drafted_document", { docId: "daily_tbm", format: "hwpx", draft: { todayWork: "양중 작업" } });
check("내보내기(hwpx)가 파일을 저장", !exported.isError && sectionOf(readFileSync(String(exported.structured.hwpxPath))).includes("양중 작업"));
const md = await callTool("generate_safety_document", { docId: "daily_tbm", useProfile: false });
check("대조군: 기본 형식은 파일 경로를 돌려주지 않음", md.structured.hwpxPath === undefined && md.text.startsWith(">"));

console.log(`[hwpx-export] ${pass} 통과 / ${fail} 실패 (문서 ${docIds.length}종)`);
process.exit(fail > 0 ? 1 : 0);
