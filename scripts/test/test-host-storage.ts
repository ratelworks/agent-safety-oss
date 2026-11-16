#!/usr/bin/env tsx
/**
 * test-host-storage.ts — 호스트 저장 주입 모드 회귀 시험
 *
 *   1. 도구 특성 목록 = 등록 도구 (빠짐·남음 없음), 문서 표가 목록과 같음
 *   2. 저장 인터페이스 없이 시작하면 거절 / 모르는 도구·로컬 전용 도구·틀린 입력은 저장 전에 거절
 *   3. 저장을 쓰는 도구 흐름 — 쓴 뒤 읽기 없음(엄격 저장), 밝힌 특성과 실제 실행 대조
 *   4. 홈·SAFETY_LOCAL_DIR·작업 폴더에 쓰기 0 (임시 HOME 으로 확인)
 *   5. 동시에 도는 두 회사 격리
 *   6. 현장 고정 — 다른 현장 쓰기 거절, 다른 현장·회사 기록 안 보임, 현장별 프로필 키 분리
 *   7. 실패·재실행 — 입력 파일 읽기 실패, 저장 중 실패(부분), 같은 시각으로 다시 실행하면 같은 id, 내용 해시로 중복 방지
 *   8. 외부 통신 도구를 뺀 나머지 도구 전수 — 특성 대조 + 로컬 쓰기 0
 *
 * 회사·사람 이름은 모두 가상이다.
 */
import { mkdtempSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 — 모듈을 읽기 전에 홈·로컬 저장을 빈 임시 폴더로 바꾼다 ──
const HOME_DIR = mkdtempSync(join(tmpdir(), "host-storage-home-"));
const LOCAL_DIR = mkdtempSync(join(tmpdir(), "host-storage-local-"));
process.env.HOME = HOME_DIR;
process.env.USERPROFILE = HOME_DIR;
process.env.SAFETY_LOCAL_DIR = LOCAL_DIR;
process.env.AGENT_SAFETY_NO_OPEN = "1";
delete process.env.SAFETY_TRACE_DIR;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const START = Date.parse("2026-11-17T01:00:00.000Z");
const COMPANY_A = "샘플건설 가";
const COMPANY_B = "샘플건설 나";
const KIND_PATTERN = /^[a-z][a-z0-9_]{0,30}$/;
const MAX_ID_LENGTH = 200;
const DOC_TABLE_START = "<!-- HOST-TOOLS:START -->";
const DOC_TABLE_END = "<!-- HOST-TOOLS:END -->";

const engineModule = await import("../../src/engine/index.js");
const { createSafetyEngine, createMemorySafetyStorage, SafetyEngineError, getSafetyEngineManifest, TOOL_TRAITS } = engineModule;
type SafetyStorage = import("../../src/engine/index.js").SafetyStorage;
const { TOOLS } = await import("../../src/tool-registry.js");
const { renderHostToolTable } = await import("../build/generate-host-tool-table.js");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectError(name: string, code: string, fn: () => Promise<unknown> | unknown): Promise<any> {
  try {
    await fn();
    check(name, false, `오류 없이 끝남 (기대 ${code})`);
    return undefined;
  } catch (err) {
    const ok = err instanceof SafetyEngineError && err.code === code;
    check(name, ok, ok ? "" : `${(err as any)?.code ?? ""} ${(err as Error)?.message ?? err}`);
    return err;
  }
}

// ── 엄격 저장: 실행 하나에서 쓴 뒤 읽기·틀린 종류·긴 id·JSON 아닌 값을 잡는다 ──
interface Strict {
  storage: SafetyStorage;
  inner: ReturnType<typeof createMemorySafetyStorage>;
  violations: string[];
  calls: { get: number; list: number; put: number; remove: number };
  begin(): void;
  failPutAt?: number;
}
function strictStorage(inner = createMemorySafetyStorage()): Strict {
  let wrote = false;
  let putsThisRun = 0;
  const s: Strict = {
    inner,
    violations: [],
    calls: { get: 0, list: 0, put: 0, remove: 0 },
    begin() {
      wrote = false;
      putsThisRun = 0;
    },
    storage: {
      async get(kind, id) {
        s.calls.get += 1;
        if (wrote) s.violations.push(`get after write ${kind}/${id}`);
        if (!KIND_PATTERN.test(kind)) s.violations.push(`kind ${kind}`);
        return inner.get(kind, id);
      },
      async list(kind) {
        s.calls.list += 1;
        if (wrote) s.violations.push(`list after write ${kind}`);
        if (!KIND_PATTERN.test(kind)) s.violations.push(`kind ${kind}`);
        return inner.list(kind);
      },
      put(kind, id, value) {
        s.calls.put += 1;
        wrote = true;
        putsThisRun += 1;
        if (s.failPutAt !== undefined && putsThisRun === s.failPutAt) throw new Error("가상 저장 장애");
        if (!KIND_PATTERN.test(kind)) s.violations.push(`kind ${kind}`);
        if (id.length > MAX_ID_LENGTH) s.violations.push(`id length ${id.length}`);
        if (value === undefined || JSON.stringify(value) === undefined) s.violations.push(`value ${kind}/${id}`);
        inner.put(kind, id, value);
      },
      remove(kind, id) {
        s.calls.remove += 1;
        wrote = true;
        inner.remove(kind, id);
      },
    },
  };
  return s;
}

function memoryFiles(entries: Record<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    reader: {
      async read(ref: string) {
        reads.push(ref);
        const text = entries[ref];
        if (text === undefined) throw new Error(`없는 파일: ${ref}`);
        return { fileName: ref, mimeType: "image/jpeg", bytes: new TextEncoder().encode(text) };
      },
    },
  };
}

function fixedClock(start = START) {
  let t = start;
  return {
    clock: { now: () => new Date(t) },
    advance(ms: number) {
      t += ms;
    },
  };
}

type Engine = ReturnType<typeof createSafetyEngine>;
const traceEvents: Array<{ name: string; values?: Record<string, number | boolean> }> = [];
async function callOn(engine: Engine, strict: Strict, tool: string, input: unknown) {
  strict.begin();
  return engine.call(tool, input);
}

// ════════════════════════════════════════════════════════════════════
// 1. 특성 목록 = 등록 도구, 문서 표
// ════════════════════════════════════════════════════════════════════
const registered = TOOLS.map((t) => t.name);
const traitNames = Object.keys(TOOL_TRAITS);
check("등록 도구는 92개", registered.length === 92, String(registered.length));
check("특성 목록에 모든 등록 도구가 있음", registered.every((n) => traitNames.includes(n)), registered.filter((n) => !traitNames.includes(n)).join(","));
check("특성 목록에 등록되지 않은 도구가 없음", traitNames.every((n) => registered.includes(n)), traitNames.filter((n) => !registered.includes(n)).join(","));
const manifest = getSafetyEngineManifest();
check("공개 목록 = 호스트 도구 + 제외 도구", manifest.tools.length + manifest.excluded.length === registered.length);
check("제외 도구는 회사 키 도구 4개", manifest.excluded.map((e) => e.tool).sort().join(",") === "get_company_info,link_company_key,sync_to_cloud,unlink_company_key");
check("목록의 입력 스키마는 도구 원래 스키마 그대로", manifest.tools.every((t) => t.inputSchema === TOOLS.find((d) => d.name === t.name)!.inputSchema));
const doc = readFileSync(join(ROOT, "docs", "HOST-STORAGE.md"), "utf8");
const docTable = doc.slice(doc.indexOf(DOC_TABLE_START) + DOC_TABLE_START.length, doc.indexOf(DOC_TABLE_END)).trim();
check("문서의 도구 표가 특성 목록과 같음 (npm run docs:host-tools 로 다시 생성)", docTable === renderHostToolTable().trim());

// ════════════════════════════════════════════════════════════════════
// 2. 시작·입력 거절
// ════════════════════════════════════════════════════════════════════
await expectError("저장 인터페이스 없이 시작하면 거절", "storage_required", () => createSafetyEngine({} as any));
await expectError("저장 인터페이스 모양이 틀리면 거절", "storage_required", () => createSafetyEngine({ storage: { get: async () => undefined } } as any));
await expectError("현장 식별자가 비면 거절", "invalid_option", () => createSafetyEngine({ storage: createMemorySafetyStorage(), scope: { projectId: " " } }));
{
  const s = strictStorage();
  const engine = createSafetyEngine({ storage: s.storage, clock: fixedClock().clock });
  await expectError("모르는 도구는 거절", "unknown_tool", () => callOn(engine, s, "no_such_tool", {}));
  await expectError("회사 키 도구는 호스트 모드에서 거절", "tool_unavailable", () => callOn(engine, s, "link_company_key", { apiKey: "ASF_test" }));
  await expectError("클라우드 전송 도구는 호스트 모드에서 거절", "tool_unavailable", () => callOn(engine, s, "sync_to_cloud", { confirm: true }));
  const bad = await expectError("틀린 입력은 거절", "invalid_input", () => callOn(engine, s, "register_site", { name: COMPANY_A }));
  check("틀린 입력 오류에 칸 목록", Array.isArray(bad?.details?.issues) && bad.details.issues.length >= 3);
  // 원래 스키마의 추가 검사(refine)까지 지킨다 — 사진은 filePath·fileUri 중 하나만
  await expectError("원래 스키마의 추가 검사도 지킴", "invalid_input", () =>
    callOn(engine, s, "upload_photo_evidence", { filePath: "a.jpg", fileUri: "https://example.com/a.jpg", relatedTask: "activity:x", evidenceType: "inspection", capturedAt: "2026-11-17T09:00:00+09:00" }),
  );
  check("거절한 입력은 저장을 건드리지 않음", s.calls.get + s.calls.list + s.calls.put + s.calls.remove === 0, JSON.stringify(s.calls));
}

// ════════════════════════════════════════════════════════════════════
// 3·4. 회사 하나의 전체 흐름 (회사 범위)
// ════════════════════════════════════════════════════════════════════
async function companyFlow(company: string, opts: { strict: Strict; files: ReturnType<typeof memoryFiles>; tick?: () => Promise<void> }) {
  const { strict, files } = opts;
  const clock = fixedClock();
  const engine = createSafetyEngine({ storage: strict.storage, files: files.reader, clock: clock.clock, trace: (e) => traceEvents.push(e as any) });
  const tick = opts.tick ?? (async () => {});
  const out: Record<string, any> = {};
  const step = async (tool: string, input: unknown) => {
    await tick();
    clock.advance(1000);
    const r = await callOn(engine, strict, tool, input);
    out[tool] = r;
    return r;
  };
  const siteName = company;
  await step("register_site", { name: siteName, businessNumber: "000-00-00000", address: "가상시 가상구 1", ownerName: `${company} 대표` });
  const siteId = (out.register_site.result.structuredContent as any).site["@id"];
  await step("register_project", { siteId, name: `${company} 1공구`, contractAmount: 1_500_000_000, constructionType: "건축공사" });
  const projectId = (out.register_project.result.structuredContent as any).project["@id"];
  await step("register_person", { name: `${company} 안전관리자`, role: "안전관리자", projectId });
  await step("register_person", { name: `${company} 소장`, role: "현장소장", siteId });
  await step("get_site_profile", {});
  await step("save_form_draft", { docId: "daily_tbm", formValues: { todayWork: `${company} 굴착 작업` } });
  await step("save_form_draft", { docId: "daily_tbm", formValues: { place: "1공구" }, autosave: true });
  await step("load_form_draft", { docId: "daily_tbm" });
  await step("list_form_drafts", {});
  await step("archive_safety_document", { docId: "daily_tbm", content: `# ${company} TBM\n\n오늘 작업: 굴착`, format: "markdown" });
  out.archive_first = out.archive_safety_document;
  await step("archive_safety_document", { docId: "daily_tbm", content: `# ${company} TBM\n\n오늘 작업: 굴착`, format: "markdown" });
  out.archive_again = out.archive_safety_document;
  await step("list_archived_documents", {});
  await step("get_storage_stats", {});
  await step("upload_photo_evidence", { filePath: "upload-001.jpg", relatedTask: "activity:excavation_2m_plus", evidenceType: "before_action", capturedAt: "2026-11-17T09:00:00+09:00" });
  out.photo_first = out.upload_photo_evidence;
  await step("upload_photo_evidence", { filePath: "upload-001.jpg", relatedTask: "activity:excavation_2m_plus", evidenceType: "before_action", capturedAt: "2026-11-17T09:00:00+09:00" });
  out.photo_again = out.upload_photo_evidence;
  const photoId = (out.photo_first.result.structuredContent as any).photo.photoId;
  await step("register_safety_issue", { relatedTask: "activity:excavation_2m_plus", relatedRisk: "hazard:fall_from_height", severity: "high", description: `${company} 개구부 덮개 없음`, photoEvidence: photoId });
  const issueId = (out.register_safety_issue.result.structuredContent as any).issue.issueId;
  await step("get_photo_evidence", { photoId });
  await step("list_open_issues", {});
  await step("get_safety_issue", { issueId });
  await step("record_corrective_action", { relatedIssue: issueId, action: "개구부 덮개 설치", assignee: `${company} 관리감독자`, dueBy: "2026-11-20" });
  const actionId = (out.record_corrective_action.result.structuredContent as any).actionId;
  await step("list_pending_actions", {});
  out.pending_before = out.list_pending_actions;
  await step("complete_action", { actionId, completionNote: "설치 완료" });
  await step("get_corrective_action", { actionId });
  await step("update_issue_status", { issueId, status: "resolved", note: "조치 완료" });
  await step("generate_safety_report", { period: "monthly", startDate: "2026-11-01", endDate: "2026-11-30" });
  await step("list_safety_reports", {});
  await step("generate_safety_document", { docId: "daily_tbm", draft: { todayWork: "굴착" } });
  out.generate_md = out.generate_safety_document;
  await step("generate_safety_document", { docId: "daily_tbm", format: "hwpx", draft: { todayWork: "굴착" } });
  await step("export_drafted_document", { docId: "daily_tbm", format: "hwpx", draft: { todayWork: "굴착" } });
  await step("render_a2ui_form", { docId: "daily_tbm" });
  await step("render_profile_input_form", {});
  await step("assess_my_obligations", {});
  await step("submit_safety_document", { docId: "daily_tbm", draft: { todayWork: "굴착" }, archive: true });
  await step("save_profile_from_form", { formValues: { "site.name": siteName, "site.address": "가상시 가상구 2" } });
  out.ids = { siteId, projectId, photoId, issueId, actionId };
  return { engine, out, clock };
}

const strictA = strictStorage();
const filesA = memoryFiles({ "upload-001.jpg": "가상 사진 바이트 A" });
const flowA = await companyFlow(COMPANY_A, { strict: strictA, files: filesA });
const o = flowA.out;
check("모든 단계가 성공", Object.entries(o).filter(([k]) => !["ids"].includes(k)).every(([, r]) => r.ok === true), Object.entries(o).filter(([k, r]) => k !== "ids" && r.ok !== true).map(([k]) => k).join(","));
check("엄격 저장: 쓴 뒤 읽기·형식 위반 없음", strictA.violations.length === 0, strictA.violations.slice(0, 5).join(" / "));
const snapA = strictA.inner.snapshot();
check("회사 프로필과 현장별 프로필이 따로 저장됨", Boolean(snapA.profile?.company) && Object.keys(snapA.project_profile ?? {}).length === 1);
const projectRecord: any = Object.values(snapA.project_profile ?? {})[0];
check("현장 인력은 현장별 프로필에, 현장 밖 인력은 회사 프로필에", projectRecord?.persons?.length === 1 && (snapA.profile!.company as any).persons.length === 1);
check("초안은 한 기록에 합쳐 저장", Object.keys(snapA.draft ?? {}).length === 1 && Object.keys((snapA.draft!.daily_tbm as any).formValues).length === 2);
check("같은 문서·같은 내용은 한 기록 (내용 해시)", Object.keys(snapA.document ?? {}).filter((id) => id.startsWith("daily_tbm/")).length === 2, Object.keys(snapA.document ?? {}).join(","));
check("다시 보관하면 기록을 늘리지 않음", o.archive_again.writes.length === 0 && (o.archive_again.result.structuredContent as any).deduplicated === true);
check("다시 보관해도 본문 파일은 다시 넘김 (파일 저장 재시도용)", o.archive_again.files.length === 1 && o.archive_again.files[0].sha256 === o.archive_first.files[0].sha256);
check("보관 본문 파일의 내용", new TextDecoder().decode(o.archive_first.files[0].bytes).includes(`${COMPANY_A} TBM`) && o.archive_first.files[0].mimeType.startsWith("text/markdown"));
check("사진 바이트는 호스트 파일에서 읽고 복사하지 않음", filesA.reads.includes("upload-001.jpg") && o.photo_first.files.length === 0);
const photoRec: any = (o.photo_first.result.structuredContent as any).photo;
check("사진 기록에 호스트 파일 참조·내용 해시", photoRec.fileRef === "upload-001.jpg" && /^[0-9a-f]{64}$/.test(photoRec.sha256) && photoRec.fileUri === "host-file:upload-001.jpg" && !photoRec.storagePath && !photoRec.originalFilePath);
check("같은 사진을 다시 올리면 같은 photoId·기록 늘지 않음", o.photo_again.writes.length === 0 && (o.photo_again.result.structuredContent as any).photo.photoId === photoRec.photoId);
check("이슈 등록이 사진 기록에 연결을 씀", ((snapA.photo as any)[photoRec.photoId]).evidences.includes(o.ids.issueId));
check("조치 기록·완료", (snapA.action as any)[o.ids.actionId]?.status === "resolved");
check("이슈 상태 변경", (snapA.issue as any)[o.ids.issueId]?.status === "resolved");
check("미완료 조치 목록에 조치가 보임", (o.pending_before.result.structuredContent as any)?.actions?.length === 1 || JSON.stringify(o.pending_before.result.structuredContent).includes(o.ids.actionId));
check("보고서 기록 + Markdown 파일", Object.keys(snapA.report ?? {}).length === 1 && o.generate_safety_report.files.length === 1 && o.generate_safety_report.files[0].documentKind === "safety_report");
check("보고서가 이슈·조치를 모음", JSON.stringify(Object.values(snapA.report ?? {})[0]).includes(o.ids.issueId));
check("한글 파일은 결과 파일로", o.generate_safety_document.files.length === 1 && o.generate_safety_document.files[0].fileName.endsWith(".hwpx") && o.generate_safety_document.files[0].bytes.byteLength > 1000);
check("내보내기 한글 파일도 결과 파일로", o.export_drafted_document.files.length === 1 && String((o.export_drafted_document.result.structuredContent as any).hwpxPath).startsWith("host-storage/"));
check("문서 생성이 주입한 프로필로 자동 채움", o.generate_md.result.content.some((c: any) => String(c.text).includes(`${COMPANY_A} 1공구`)) && o.generate_md.files.length === 0);
check("제출 도구의 보관은 기록 + 파일", o.submit_safety_document.files.length === 1 && o.submit_safety_document.writes.some((w: any) => w.kind === "document"));
check("활동 기록이 쓰기 작업마다 남음", Object.keys(snapA.activity ?? {}).length >= 6, String(Object.keys(snapA.activity ?? {}).length));
const allOutputs = JSON.stringify(Object.values(o).map((r: any) => r?.result));
check("응답에 로컬 경로가 없음", !allOutputs.includes(HOME_DIR) && !allOutputs.includes(LOCAL_DIR) && !allOutputs.includes(".agent-safety-oss/"), "");
check("추적 이벤트는 이름과 숫자·참거짓만", traceEvents.length > 0 && traceEvents.every((e) => typeof e.name === "string" && Object.values(e.values ?? {}).every((v) => typeof v === "number" || typeof v === "boolean")));
// 프로필 지우기는 회사·현장 프로필을 모두 지운다
{
  const r = await callOn(flowA.engine, strictA, "clear_site_profile", { confirm: true });
  const after = strictA.inner.snapshot();
  check("프로필 지우기 — 현장별 프로필 기록 삭제", r.ok && Object.keys(after.project_profile ?? {}).length === 0 && r.writes.some((w) => w.op === "remove"));
  check("프로필 지우기 — 회사 프로필 비움", ((after.profile?.company as any)?.sites ?? []).length === 0);
}

// ════════════════════════════════════════════════════════════════════
// 5. 동시에 도는 두 회사
// ════════════════════════════════════════════════════════════════════
{
  const sA = strictStorage();
  const sB = strictStorage();
  // 두 흐름의 단계를 번갈아 끼워 넣는다
  const yieldTurn = async () => {
    await new Promise((r) => setImmediate(r));
  };
  const [fa, fb] = await Promise.all([
    companyFlow(COMPANY_A, { strict: sA, files: memoryFiles({ "upload-001.jpg": "가상 사진 바이트 A" }), tick: yieldTurn }),
    companyFlow(COMPANY_B, { strict: sB, files: memoryFiles({ "upload-001.jpg": "가상 사진 바이트 B" }), tick: yieldTurn }),
  ]);
  const a = JSON.stringify(sA.inner.snapshot());
  const b = JSON.stringify(sB.inner.snapshot());
  check("동시 실행 — 두 흐름 모두 성공", [fa, fb].every((f) => Object.entries(f.out).filter(([k]) => k !== "ids").every(([, r]) => (r as any).ok === true)));
  check("동시 실행 — 회사 가 저장에 회사 나 자료 없음", a.includes(COMPANY_A) && !a.includes(COMPANY_B));
  check("동시 실행 — 회사 나 저장에 회사 가 자료 없음", b.includes(COMPANY_B) && !b.includes(COMPANY_A));
  check("동시 실행 — 사진 내용이 달라 photoId 가 다름", fa.out.ids.photoId !== fb.out.ids.photoId);
  check("동시 실행 — 엄격 저장 위반 없음", sA.violations.length + sB.violations.length === 0);
}

// ════════════════════════════════════════════════════════════════════
// 6. 현장 고정 — 한 회사 저장을 두 현장이 나눠 씀
// ════════════════════════════════════════════════════════════════════
{
  const shared = strictStorage();
  const clock = fixedClock();
  const files = memoryFiles({ "p1.jpg": "현장1 사진", "p2.jpg": "현장2 사진" });
  const company = createSafetyEngine({ storage: shared.storage, files: files.reader, clock: clock.clock });
  const P1 = "project:가상_1공구";
  const P2 = "project:가상_2공구";
  const site1 = createSafetyEngine({ storage: shared.storage, files: files.reader, clock: clock.clock, scope: { projectId: P1 } });
  const site2 = createSafetyEngine({ storage: shared.storage, files: files.reader, clock: clock.clock, scope: { projectId: P2 } });
  const reg = await callOn(company, shared, "register_site", { name: COMPANY_A, businessNumber: "000-00-00000", address: "가상시", ownerName: "가상 대표" });
  const siteId = (reg.result.structuredContent as any).site["@id"];
  await callOn(company, shared, "register_project", { siteId, name: "가상 1공구" });
  await callOn(company, shared, "register_project", { siteId, name: "가상 2공구" });
  check("회사 범위 등록 — 현장마다 프로필 기록", Object.keys(shared.inner.snapshot().project_profile ?? {}).sort().join(",") === [P1, P2].sort().join(","));

  clock.advance(1000);
  await callOn(site1, shared, "save_form_draft", { docId: "daily_tbm", formValues: { todayWork: "1공구 작업" } });
  const d2 = await callOn(site2, shared, "load_form_draft", { docId: "daily_tbm" });
  check("현장 2 는 현장 1 의 초안을 못 봄", (d2.result.structuredContent as any).found === false);
  const dc = await callOn(company, shared, "list_form_drafts", {});
  check("회사 범위는 현장 기록을 못 봄", (dc.result.structuredContent as any).count === 0);
  await callOn(site2, shared, "save_form_draft", { docId: "daily_tbm", formValues: { todayWork: "2공구 작업" } });
  const draftIds = Object.keys(shared.inner.snapshot().draft ?? {});
  check("같은 문서 종류의 초안이 현장마다 따로", draftIds.length === 2 && draftIds.every((id) => id.startsWith("scope:")));

  await expectError("현장 1 실행에서 현장 2 사진 등록 거절", "scope_mismatch", () =>
    callOn(site1, shared, "upload_photo_evidence", { filePath: "p1.jpg", relatedSite: P2, relatedTask: "activity:x", evidenceType: "inspection", capturedAt: "2026-11-17T09:00:00+09:00" }),
  );
  await expectError("현장 1 실행에서 현장 2 인력 등록 거절", "scope_mismatch", () => callOn(site1, shared, "register_person", { name: "가상 작업자", role: "작업자", projectId: P2 }));
  await expectError("현장 1 실행에서 다른 현장 프로필 만들기 거절", "scope_mismatch", () => callOn(site1, shared, "register_project", { siteId, name: "가상 2공구", contractAmount: 1 }));
  await expectError("현장 실행에서 회사 프로필 바꾸기 거절", "scope_mismatch", () => callOn(site1, shared, "register_site", { name: "다른 가상 회사", businessNumber: "000-00-00000", address: "가상시", ownerName: "가상" }));
  const p1person = await callOn(site1, shared, "register_person", { name: "가상 1공구 관리감독자", role: "관리감독자" });
  const snap = shared.inner.snapshot();
  check("현장 칸을 비우면 고정 현장으로 채움 → 그 현장 프로필에만", p1person.ok && (snap.project_profile as any)[P1].persons.length === 1 && !(snap.project_profile as any)[P2].persons?.length);
  const prof2 = await callOn(site2, shared, "get_site_profile", {});
  const prof2json = JSON.stringify(prof2.result.structuredContent);
  check("현장 2 프로필 조회 — 현장 1 정보 안 보임, 회사 사업장은 보임", !prof2json.includes("가상 1공구") && prof2json.includes(COMPANY_A));

  const up = await callOn(site1, shared, "upload_photo_evidence", { filePath: "p1.jpg", relatedTask: "activity:excavation_2m_plus", evidenceType: "before_action", capturedAt: "2026-11-17T09:00:00+09:00" });
  check("현장 실행의 사진은 그 현장으로", (up.result.structuredContent as any).photo.relatedSite === P1);
  const iss = await callOn(site1, shared, "register_safety_issue", { relatedTask: "activity:excavation_2m_plus", relatedRisk: "hazard:fall_from_height", severity: "medium", description: "1공구 이슈", photoEvidence: (up.result.structuredContent as any).photo.photoId });
  const issueId = (iss.result.structuredContent as any).issue.issueId;
  const act = await callOn(site1, shared, "record_corrective_action", { relatedIssue: issueId, action: "조치", assignee: "가상 담당", dueBy: "2026-11-20" });
  check("현장 실행의 조치는 그 현장으로", (act.result.structuredContent as any).action.siteId === P1);
  const pend = await callOn(site1, shared, "list_pending_actions", {});
  check("현장 미완료 조치 목록에 그 현장 조치", JSON.stringify(pend.result.structuredContent).includes((act.result.structuredContent as any).actionId));
  const open2 = await callOn(site2, shared, "list_open_issues", {});
  check("현장 2 는 현장 1 이슈를 못 봄", (open2.result.structuredContent as any).count === 0);
  const get2 = await callOn(site2, shared, "get_safety_issue", { issueId });
  check("현장 2 가 현장 1 이슈 id 로 조회해도 없음", (get2.result.structuredContent as any).found === false);
  const rep = await callOn(site1, shared, "generate_safety_report", { period: "monthly", startDate: "2026-11-01", endDate: "2026-11-30" });
  check("현장 보고서가 그 현장 이슈를 모음", JSON.stringify(rep.result.structuredContent).includes(issueId) && (rep.result.structuredContent as any).siteId === P1);
  await expectError("현장 고정 실행에서 다른 현장 보고서 거절", "scope_mismatch", () => callOn(site1, shared, "generate_safety_report", { siteId: P2, period: "monthly", startDate: "2026-11-01", endDate: "2026-11-30" }));
  check("현장 고정 시험 — 엄격 저장 위반 없음", shared.violations.length === 0, shared.violations.join(" / "));
}

// ════════════════════════════════════════════════════════════════════
// 7. 실패·재실행
// ════════════════════════════════════════════════════════════════════
{
  const s = strictStorage();
  const clock = fixedClock();
  const noFiles = createSafetyEngine({ storage: s.storage, clock: clock.clock });
  const before = s.calls.put;
  await expectError("파일 인터페이스 없이 사진 올리기 → 파일 읽기 실패", "file_read_failed", () =>
    callOn(noFiles, s, "upload_photo_evidence", { filePath: "x.jpg", relatedTask: "activity:x", evidenceType: "inspection", capturedAt: "2026-11-17T09:00:00+09:00" }),
  );
  const broken = createSafetyEngine({ storage: s.storage, clock: clock.clock, files: { read: async () => { throw new Error("올림 자리에 없음"); } } });
  await expectError("호스트 파일 읽기 실패 → 파일 읽기 실패", "file_read_failed", () =>
    callOn(broken, s, "upload_photo_evidence", { filePath: "x.jpg", relatedTask: "activity:x", evidenceType: "inspection", capturedAt: "2026-11-17T09:00:00+09:00" }),
  );
  await expectError("호스트 모드에서 file 주소는 거절", "invalid_input", () =>
    callOn(noFiles, s, "upload_photo_evidence", { fileUri: "file:///tmp/x.jpg", relatedTask: "activity:x", evidenceType: "inspection", capturedAt: "2026-11-17T09:00:00+09:00" }),
  );
  await expectError("없는 사진을 잇는 이슈 등록 → 도구 실패", "tool_failed", () =>
    callOn(noFiles, s, "register_safety_issue", { relatedTask: "activity:x", relatedRisk: "hazard:fall_from_height", severity: "low", description: "가상", photoEvidence: "photo:none" }),
  );
  check("실패한 실행은 아무것도 쓰지 않음", s.calls.put === before);

  // 이슈를 먼저 만든다
  const ok = createSafetyEngine({ storage: s.storage, clock: clock.clock });
  const iss = await callOn(ok, s, "register_safety_issue", { relatedTask: "activity:x", relatedRisk: "hazard:fall_from_height", severity: "low", description: "가상 이슈" });
  const issueId = (iss.result.structuredContent as any).issue.issueId;
  // 조치 기록 = 조치 + 활동 두 건. 두 번째 쓰기에서 저장이 실패한다
  clock.advance(60_000);
  const input = { relatedIssue: issueId, action: "가상 조치", assignee: "가상 담당", dueBy: "2026-11-30" };
  s.failPutAt = 2;
  const err = await expectError("저장 중 실패 → commit_failed", "commit_failed", () => callOn(ok, s, "record_corrective_action", input));
  check("부분 실패 — 쓴 것·실패한 것·못 쓴 것을 나눔", err?.details?.written?.length === 1 && err?.details?.failed?.kind === "activity" && Array.isArray(err?.details?.notWritten));
  s.failPutAt = undefined;
  const partial = s.inner.snapshot();
  check("부분 실패 뒤 조치 기록 1건만 남음", Object.keys(partial.action ?? {}).length === 1);
  const again = await callOn(ok, s, "record_corrective_action", input);
  const final = s.inner.snapshot();
  check("같은 시각·같은 입력으로 다시 실행 → 같은 조치 id", again.ok && Object.keys(final.action ?? {}).length === 1 && (again.result.structuredContent as any).actionId === Object.keys(partial.action ?? {})[0]);
  check("다시 실행으로 빠진 활동 기록을 채움", Object.values(final.activity ?? {}).filter((a: any) => a.type === "corrective_action_recorded").length === 1);

  // 같은 시각으로 같은 이슈를 다시 등록하면 같은 id (중복 없음)
  const issAgain = await callOn(ok, s, "register_safety_issue", { relatedTask: "activity:x", relatedRisk: "hazard:fall_from_height", severity: "low", description: "가상 이슈 2" });
  const issRetry = await callOn(ok, s, "register_safety_issue", { relatedTask: "activity:x", relatedRisk: "hazard:fall_from_height", severity: "low", description: "가상 이슈 2" });
  check("같은 시각 재실행 → 같은 이슈 id", (issAgain.result.structuredContent as any).issue.issueId === (issRetry.result.structuredContent as any).issue.issueId);

  // 쓰기를 밝히지 않은 도구가 쓰면 저장하지 않는다 (특성 대조)
  const original = TOOL_TRAITS.get_photo_evidence;
  (TOOL_TRAITS as any).get_photo_evidence = { ...original, access: "read" };
  const ph = await callOn(ok, s, "upload_photo_evidence", { fileUri: "https://example.com/a.jpg", relatedTask: "activity:x", evidenceType: "inspection", capturedAt: "2026-11-17T09:00:00+09:00" });
  await callOn(ok, s, "register_safety_issue", { relatedTask: "activity:x", relatedRisk: "hazard:fall_from_height", severity: "low", description: "가상 이슈 3", photoEvidence: (ph.result.structuredContent as any).photo.photoId });
  // get_photo_evidence 는 연결 이슈를 사진 기록에 덧붙여 쓴다 — 이미 있으면 쓰지 않으므로 연결을 하나 지워 둔다
  const photoKey = Object.keys(s.inner.snapshot().photo ?? {})[0]!;
  const photoValue: any = s.inner.snapshot().photo![photoKey];
  s.inner.put("photo", photoKey, { ...photoValue, evidences: [] });
  const putsBefore = s.calls.put;
  await expectError("밝히지 않은 쓰기 → catalog_mismatch, 저장 안 함", "catalog_mismatch", () => callOn(ok, s, "get_photo_evidence", { photoId: photoValue.photoId }));
  check("특성 대조 실패 시 저장 안 함", s.calls.put === putsBefore);
  (TOOL_TRAITS as any).get_photo_evidence = original;
  check("실패·재실행 시험 — 엄격 저장 위반 없음", s.violations.length === 0, s.violations.join(" / "));
}

// ════════════════════════════════════════════════════════════════════
// 8. 외부 통신 도구를 뺀 나머지 도구 전수
// ════════════════════════════════════════════════════════════════════
const SAMPLE_INPUTS: Record<string, unknown> = {
  search_safety_laws: { keyword: "추락" },
  get_safety_law_article: { ref: "산안법 제36조" },
  get_foreign_worker_resource_links: { language: "vi" },
  get_kras_method: { method: "3step" },
  query_legal_basis: { docId: "daily_tbm" },
  query_penalty: { docId: "daily_tbm" },
  get_safety_document_guide: { docId: "daily_tbm" },
  get_work_permit_schema: { permitType: "hot_work" },
  choose_assessment_method: { industry: "construction", scale: "small" },
  verify_safety_basis: { claims: [{ claim: "사업주는 조치를 해야 한다", evidence: [{ basisType: "law", legalWeight: "mandatory", title: "근거", source: "LAW_MCP", reference: "산안법 제36조" }] }] },
  review_safety_document: { docId: "daily_tbm" },
  generate_safety_document: { docId: "daily_tbm" },
  submit_safety_document: { docId: "daily_tbm" },
  query_applicability: { docId: "daily_tbm" },
  field_safety_briefing: { workOrTopic: "굴착 작업" },
  analyze_construction_work_risks: { workType: "굴착" },
  compile_safety_references: { workType: "굴착" },
  get_measures_by_risk: { hazardLabel: "추락" },
  get_ppe_by_task: { activityLabel: "굴착" },
  generate_tbm_topics: { activityLabel: "굴착" },
  query_delegation_chain: { startRef: "산안법 제36조" },
  query_guide_links: { docId: "daily_tbm" },
  get_submission_info: { docId: "daily_tbm" },
  get_retention_status: { docId: "daily_tbm", compileDate: "2026-11-17" },
  get_incident_response_workflow: { severity: "serious" },
  get_construction_stage_duties: { stage: "active" },
  export_drafted_document: { docId: "daily_tbm", draft: {} },
  assemble_doc_context: { docId: "daily_tbm" },
  render_a2ui_form: { docId: "daily_tbm" },
  request_field_help: { docId: "daily_tbm", fieldKey: "todayWork" },
  suggest_controls_for_hazard: { hazard: "추락" },
  analyze_work_context: { docId: "daily_tbm", workName: "굴착 작업" },
  preview_review: { docId: "daily_tbm", draft: {} },
  register_site: { name: COMPANY_A, businessNumber: "000-00-00000", address: "가상시", ownerName: "가상 대표" },
  register_project: { siteId: "site:샘플건설_가", name: "가상 3공구" },
  register_person: { name: "가상 근로자", role: "작업자" },
  register_equipment: { name: "가상 굴착기" },
  register_contractor: { projectId: "project:가상_3공구", name: "가상 협력사", ceo: "가상 대표" },
  clear_site_profile: { confirm: true },
  save_profile_from_form: { formValues: { "site.name": COMPANY_A } },
  record_corrective_action: { relatedIssue: "issue:none", action: "가상", assignee: "가상", dueBy: "2026-11-30" },
  complete_action: { actionId: "action.20261117.99", completionNote: "가상" },
  get_corrective_action: { actionId: "action.20261117.99" },
  generate_safety_report: { period: "weekly", startDate: "2026-11-16", endDate: "2026-11-22" },
  save_form_draft: { docId: "daily_tbm", formValues: { a: "b" } },
  load_form_draft: { docId: "daily_tbm" },
  archive_safety_document: { docId: "daily_tbm", content: "가상 본문 열 글자 이상", format: "markdown" },
  upload_photo_evidence: { fileUri: "https://example.com/p.jpg", relatedTask: "activity:x", evidenceType: "inspection", capturedAt: "2026-11-17T09:00:00+09:00" },
  list_photos_by_site: { since: "2026-11-01T00:00:00+09:00" },
  list_photos_by_task: { activityId: "activity:x" },
  get_photo_evidence: { photoId: "photo:none" },
  register_safety_issue: { relatedTask: "activity:x", relatedRisk: "hazard:fall_from_height", severity: "low", description: "가상" },
  update_issue_status: { issueId: "issue:none", status: "in_progress", note: "가상" },
  get_safety_issue: { issueId: "issue:none" },
};
{
  const s = strictStorage();
  const engine = createSafetyEngine({ storage: s.storage, clock: fixedClock().clock, files: memoryFiles({}).reader });
  const hostTools = manifest.tools.filter((t) => !t.effects.external);
  const failures: string[] = [];
  const notOk: string[] = [];
  let okCount = 0;
  for (const tool of hostTools) {
    try {
      const r = await callOn(engine, s, tool.name, SAMPLE_INPUTS[tool.name] ?? {});
      if (r.ok) okCount += 1;
      else notOk.push(`${tool.name}(오류 응답)`);
    } catch (err) {
      const code = (err as any)?.code;
      notOk.push(`${tool.name}(${code})`);
      if (code === "catalog_mismatch" || code === "local_write_blocked" || code === "invalid_input" || code === "storage_read_failed") {
        failures.push(`${tool.name}: ${code} ${(err as Error).message}`);
      }
    }
  }
  console.log(`  전수 실행: 외부 통신을 뺀 호스트 도구 ${hostTools.length}개 — 성공 응답 ${okCount}${notOk.length ? ` · 그 밖 ${notOk.join(", ")}` : ""}`);
  check(`전수 실행 — 특성 대조·로컬 쓰기·입력 오류 없음 (${hostTools.length}개 중 성공 ${okCount})`, failures.length === 0, failures.join(" / "));
  check("전수 실행 — 대부분 성공", okCount >= hostTools.length - 5, `${okCount}/${hostTools.length}`);
  check("전수 실행 — 엄격 저장 위반 없음", s.violations.length === 0, s.violations.join(" / "));
}

// ════════════════════════════════════════════════════════════════════
// 4. 로컬 쓰기 0
// ════════════════════════════════════════════════════════════════════
const homeEntries = readdirSync(HOME_DIR);
const localEntries = readdirSync(LOCAL_DIR);
check("임시 HOME 에 아무것도 쓰지 않음", homeEntries.length === 0, homeEntries.join(","));
check("SAFETY_LOCAL_DIR 에 아무것도 쓰지 않음", localEntries.length === 0, localEntries.join(","));
check("작업 폴더에 host-storage 폴더를 만들지 않음", !existsSync(join(process.cwd(), "host-storage")) && !existsSync(join(ROOT, "host-storage")));

console.log(`[host-storage] ${pass} 통과 / ${fail} 실패 (호스트 도구 ${manifest.tools.length}개 · 제외 ${manifest.excluded.length}개)`);
process.exit(fail > 0 ? 1 : 0);
