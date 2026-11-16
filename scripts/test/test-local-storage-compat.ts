#!/usr/bin/env tsx
/**
 * test-local-storage-compat.ts — 단독 사용(로컬 저장) 회귀 시험
 *
 * 호스트 저장 주입 모드를 더한 뒤에도 단독 사용의 저장 위치·파일 모양·응답이 그대로인지 확인한다.
 *   - 기본: SAFETY_LOCAL_DIR 없이 임시 HOME 의 ~/.agent-safety-oss/ 아래에 쓴다
 *   - --local-dir: SAFETY_LOCAL_DIR 로 바꾼 폴더에 쓰고, HOME 에는 아무것도 쓰지 않는다
 * 인자 없이 실행하면 두 경우를 모두 돈다(두 번째는 새 프로세스 — 저장 모듈이 읽을 때 경로를 잡기 때문).
 *
 * 회사·사람 이름은 모두 가상이다.
 */
import { mkdtempSync, readdirSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// ── 상수 — 모듈을 읽기 전에 홈·로컬 저장을 정한다 ──
const MODE = process.argv.includes("--local-dir") ? "local-dir" : "home";
const HOME_DIR = mkdtempSync(join(tmpdir(), "local-compat-home-"));
process.env.HOME = HOME_DIR;
process.env.USERPROFILE = HOME_DIR;
process.env.AGENT_SAFETY_NO_OPEN = "1";
let STORE: string;
if (MODE === "local-dir") {
  STORE = mkdtempSync(join(tmpdir(), "local-compat-store-"));
  process.env.SAFETY_LOCAL_DIR = STORE;
} else {
  delete process.env.SAFETY_LOCAL_DIR;
  STORE = join(HOME_DIR, ".agent-safety-oss");
}
const SELF = fileURLToPath(import.meta.url);
const COMPANY = "샘플건설 다";
const PROFILE_KEYS = "@context,_meta,contractors,equipments,persons,projects,sites";
const DRAFT_KEYS = "autosave,createdAt,docId,formValues,manualSavedAt,updatedAt";
// 같은 밀리초에 두 번 보관하면 두 번째 파일에 -01 이 붙는다(local-storage.ts 의 기존 충돌 처리)
const TIMESTAMP_FILE = /^\d{4}-\d{2}-\d{2}-\d{6}-\d{3}(-\d{2})?\.md$/;

const { TOOLS } = await import("../../src/tool-registry.js");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  ❌ [${MODE}] ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
type Tool = { name: string; handler: (i: unknown) => Promise<any> };
const call = async (name: string, input: unknown): Promise<any> => (TOOLS as Tool[]).find((t) => t.name === name)!.handler(input);
const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const modeOf = (path: string): number => statSync(path).mode & 0o777;

// 프로필 — 사업장·현장 둘·인력이 한 파일(profile.jsonld)에
const site = await call("register_site", { name: COMPANY, businessNumber: "000-00-00000", address: "가상시 가상구 3", ownerName: "가상 대표" });
const siteId = site.structuredContent.site["@id"];
await call("register_project", { siteId, name: `${COMPANY} 1공구` });
await call("register_project", { siteId, name: `${COMPANY} 2공구` });
await call("register_person", { name: "가상 안전관리자", role: "안전관리자", projectId: `project:${COMPANY.replace(/\s+/g, "_")}_1공구` });
const profilePath = join(STORE, "profile.jsonld");
check("프로필은 profile.jsonld 한 파일", existsSync(profilePath) && site.structuredContent.profilePath === profilePath, site.structuredContent.profilePath);
const profile = readJson(profilePath);
check("프로필 파일 모양 그대로", Object.keys(profile).sort().join(",") === PROFILE_KEYS, Object.keys(profile).sort().join(","));
check("현장 둘·인력이 같은 파일에", profile.projects.length === 2 && profile.persons.length === 1 && profile.sites.length === 1);
check("현장별 프로필 파일을 따로 만들지 않음", !existsSync(join(STORE, "project_profile")) && !readdirSync(STORE).some((f) => f.startsWith("project")));
check("저장 폴더는 사용자 전용 권한", modeOf(STORE) === 0o700 && modeOf(profilePath) === 0o600, `${modeOf(STORE).toString(8)} ${modeOf(profilePath).toString(8)}`);

// 초안
const draft = await call("save_form_draft", { docId: "daily_tbm", formValues: { todayWork: "굴착" } });
const draftPath = join(STORE, "drafts", "daily_tbm.jsonld");
check("초안 위치 drafts/<docId>.jsonld", existsSync(draftPath) && draft.structuredContent.path === draftPath, draft.structuredContent.path);
check("초안 응답 글의 위치 표기 그대로", draft.content[0].text.includes("`~/.agent-safety-oss/drafts/daily_tbm.jsonld`"));
check("초안 파일 모양 그대로", Object.keys(readJson(draftPath)).sort().join(",") === DRAFT_KEYS, Object.keys(readJson(draftPath)).sort().join(","));

// 보관 — 같은 내용도 단독 사용에서는 파일이 하나씩 늘어난다(기존 동작)
const a1 = await call("archive_safety_document", { docId: "daily_tbm", content: `# ${COMPANY} TBM 본문`, format: "markdown" });
const a2 = await call("archive_safety_document", { docId: "daily_tbm", content: `# ${COMPANY} TBM 본문`, format: "markdown" });
const docDir = join(STORE, "documents", "daily_tbm");
const archived = readdirSync(docDir).filter((f) => f.endsWith(".md"));
check("보관 파일 documents/<docId>/<시각>.md", archived.length === 2 && archived.every((f) => TIMESTAMP_FILE.test(f)), archived.join(","));
check("보관 응답 경로는 로컬 파일", a1.structuredContent.path === join(docDir, a1.structuredContent.filename) && a2.structuredContent.filename !== a1.structuredContent.filename);
check("보관 응답에 호스트 칸이 없음", !("documentId" in a1.structuredContent) && !("deduplicated" in a1.structuredContent));

// 사진 — 원본을 photos/ 로 복사하고 기록을 남긴다
const src = join(mkdtempSync(join(tmpdir(), "local-compat-photo-")), "site.jpg");
writeFileSync(src, "가상 사진 바이트");
const photo = await call("upload_photo_evidence", { filePath: src, relatedTask: "activity:excavation_2m_plus", evidenceType: "before_action", capturedAt: "2026-11-17T09:00:00+09:00" });
const rec = photo.structuredContent.photo;
const photoFiles = readdirSync(join(STORE, "photos"));
check("사진 원본 복사 + 기록 jsonld", photoFiles.some((f) => f.endsWith(".jpg")) && photoFiles.some((f) => f.endsWith(".jsonld")), photoFiles.join(","));
check("사진 기록의 로컬 경로 칸 그대로", rec.storagePath?.startsWith(join(STORE, "photos")) && rec.originalFilePath === src && rec.fileUri.startsWith("file://") && !("fileRef" in rec));
check("사진 응답의 저장 위치는 로컬", photo.structuredContent.storageRoot === resolve(STORE));

// 이슈·조치·보고
const issue = await call("register_safety_issue", { relatedTask: "activity:excavation_2m_plus", relatedRisk: "hazard:fall_from_height", severity: "high", description: "가상 개구부", photoEvidence: rec.photoId });
check("이슈 기록 issues/*.jsonld", readdirSync(join(STORE, "issues")).filter((f) => f.endsWith(".jsonld")).length === 1);
const action = await call("record_corrective_action", { relatedIssue: issue.structuredContent.issue.issueId, action: "덮개 설치", assignee: "가상 관리감독자", dueBy: "2026-11-30" });
const actionFile = join(STORE, "actions", `${action.structuredContent.actionId}.json`);
check("조치 기록 actions/<actionId>.json", existsSync(actionFile) && /^action\.\d{8}\.01$/.test(action.structuredContent.actionId));
check("조치 기록에 호스트 재시도 키가 없음", !("retryKey" in readJson(actionFile)));
const report = await call("generate_safety_report", { period: "monthly", startDate: "2026-11-01", endDate: "2026-11-30" });
check("보고서 reports/<id>.json + .md", existsSync(join(STORE, "reports", "report.2026-11.generic.json")) && existsSync(join(STORE, "reports", "report.2026-11.generic.md")));
check("보고서 응답 경로는 로컬", String(report.structuredContent.jsonPath ?? report.structuredContent.report?.jsonPath ?? JSON.stringify(report.structuredContent)).includes(join(STORE, "reports")));

// 현장 거르기 — 이슈의 현장은 사진 증빙의 relatedSite 에서 오고, 조치 목록·보고서의 현장 거르기가 그 이슈를 찾아야 한다
const SITE_IRI = `project:${COMPANY.replace(/\s+/g, "_")}_2공구`;
const sitePhoto = await call("upload_photo_evidence", { filePath: src, relatedSite: SITE_IRI, relatedTask: "activity:excavation_2m_plus", evidenceType: "before_action", capturedAt: "2026-11-17T10:00:00+09:00" });
const siteIssue = await call("register_safety_issue", { relatedTask: "activity:excavation_2m_plus", relatedRisk: "hazard:fall_from_height", severity: "medium", description: "가상 2공구 난간 미설치", photoEvidence: sitePhoto.structuredContent.photo.photoId });
const siteAction = await call("record_corrective_action", { relatedIssue: siteIssue.structuredContent.issue.issueId, action: "난간 설치", assignee: "가상 관리감독자", dueBy: "2026-11-30" });
const sitePending = await call("list_pending_actions", { siteId: SITE_IRI });
check("현장 거르기: 조치 목록이 relatedSite 현장의 조치를 찾음", (sitePending.structuredContent.actions ?? []).some((a: any) => a.actionId === siteAction.structuredContent.actionId), JSON.stringify(sitePending.structuredContent).slice(0, 300));
const siteReport = await call("generate_safety_report", { siteId: SITE_IRI, period: "monthly", startDate: "2026-11-01", endDate: "2026-11-30" });
check("현장 거르기: 보고서가 relatedSite 현장의 이슈를 셈", (siteReport.structuredContent.report?.stats?.issueCount ?? siteReport.structuredContent.stats?.issueCount) === 1, JSON.stringify(siteReport.structuredContent).slice(0, 300));

// 한글 파일
const hwpx =await call("generate_safety_document", { docId: "daily_tbm", format: "hwpx", draft: { todayWork: "굴착" } });
check("한글 파일은 documents/<docId>/ 에 저장", String(hwpx.structuredContent.hwpxPath).startsWith(docDir) && existsSync(hwpx.structuredContent.hwpxPath));

// 활동 기록
const activity = readFileSync(join(STORE, "activity.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const types = new Set(activity.map((a) => a.type));
check("activity.log 한 줄 JSON 기록 그대로", ["draft_saved", "document_archived", "corrective_action_recorded", "safety_report_generated"].every((t) => types.has(t)), [...types].join(","));

// 저장 상태
const stats = await call("get_storage_stats", {});
check("저장 상태의 위치는 로컬 저장", stats.structuredContent.storageRoot === resolve(STORE) && stats.structuredContent.profileExists === true);

const everything = JSON.stringify([site, draft, a1, photo, issue, action, report, hwpx, stats]);
check("단독 사용 응답에 호스트 표기가 없음", !everything.includes("host-storage") && !everything.includes("host-file:"));
if (MODE === "local-dir") {
  check("SAFETY_LOCAL_DIR 를 쓰면 HOME 에 아무것도 쓰지 않음", readdirSync(HOME_DIR).length === 0, readdirSync(HOME_DIR).join(","));
}

console.log(`[local-storage-compat:${MODE}] ${pass} 통과 / ${fail} 실패`);
if (MODE === "home" && !process.argv.includes("--only")) {
  const child = spawnSync(process.execPath, [...process.execArgv, SELF, "--local-dir"], { stdio: "inherit", env: { ...process.env } });
  if (child.status !== 0) process.exit(1);
}
process.exit(fail > 0 ? 1 : 0);
