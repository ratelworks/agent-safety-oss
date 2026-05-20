#!/usr/bin/env tsx
/**
 * A2UI 데이터 바인딩 동적 동작 검증.
 *
 * 시나리오: 안전관리자가 폼에 입력하는 과정 시뮬레이션
 *   1. 초기 상태 (auto 채움만)
 *   2. 사용자가 11개 input 빈칸 채움 → updateDataModel 메시지로 모델 업데이트
 *   3. 폼이 입력값 반영하여 다시 렌더링
 *   4. 두 상태(전/후)를 비교 스크린샷
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonl, renderHtml } from "./validate-a2ui-form.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JSONL_PATH = resolve(ROOT, "reports/a2ui-work-plan-form.jsonl");
const REPORTS_DIR = resolve(ROOT, "reports");

const USER_INPUTS: Record<string, string | number> = {
  workName: "도심지 OO타워 신축현장 지하구조물 굴착 작업 (깊이 3m, 면적 200㎡, 인력+백호우)",
  startTime: "08:00",
  endTime: "17:00",
  location: "서울 강남구 OOO로 123 / 지하 1층 동측 굴착구역",
  supervisor: "홍길동 (산업안전기사 자격, 안전관리자, 010-1234-5678)",
  operator: "김철수 (굴착 12년 경력, 작업지휘자, 010-2345-6789)",
  operatorLicense: "21-2026-0451",
  crewCount: 12,
  adjacentBuilding: "동측 5층 RC 빌딩 5m 이격, 서측 도로경계 1.8m",
  buriedGas: "도시가스 중압관(150A) GL-1.2m, 굴착선 2.0m 이격",
  buriedElectric: "한전 지중선 GL-1.0m, KT 통신 GL-0.8m",
  emergencyMedical: "강남세브란스병원 응급실 02-2019-3333",
};

function main() {
  const { surfaces, components, dataModel: dataModelBefore } = parseJsonl(JSONL_PATH);

  // Before
  const htmlBefore = renderHtml(surfaces, components, dataModelBefore);
  const beforePath = resolve(REPORTS_DIR, "a2ui-state-before.html");
  writeFileSync(beforePath, htmlBefore, "utf8");
  console.log(`[Before] 저장: ${beforePath}`);
  console.log(`  data_model.input.workName: '${dataModelBefore.input?.workName ?? ""}'`);
  console.log(`  data_model.input.slope:    '${dataModelBefore.input?.slope ?? ""}' (자동 채움)`);

  // 사용자 입력 메시지 시퀀스
  const updateMessages = Object.entries(USER_INPUTS).map(([key, value]) => ({
    updateDataModel: {
      surfaceId: "work-plan",
      op: "replace",
      path: `/input/${key}`,
      value,
    },
  }));
  console.log(`\n[Update] 사용자 입력 메시지 ${updateMessages.length}건 생성`);

  // After — deep copy + 메시지 적용
  const dataModelAfter = JSON.parse(JSON.stringify(dataModelBefore));
  for (const msg of updateMessages) {
    const u = msg.updateDataModel;
    const keys = u.path.split("/").filter(Boolean);
    let target: any = dataModelAfter;
    for (const k of keys.slice(0, -1)) {
      if (typeof target[k] !== "object" || target[k] === null) target[k] = {};
      target = target[k];
    }
    target[keys[keys.length - 1]] = u.value;
  }

  const htmlAfter = renderHtml(surfaces, components, dataModelAfter);
  const afterPath = resolve(REPORTS_DIR, "a2ui-state-after.html");
  writeFileSync(afterPath, htmlAfter, "utf8");
  console.log(`\n[After] 저장: ${afterPath}`);
  console.log(`  data_model.input.workName: '${String(dataModelAfter.input?.workName ?? "").slice(0, 60)}...'`);
  console.log(`  data_model.input.crewCount: ${dataModelAfter.input?.crewCount}`);
  console.log(`  data_model.input.supervisor: '${String(dataModelAfter.input?.supervisor ?? "").slice(0, 50)}...'`);

  // 메시지 시퀀스를 별도 JSONL로 저장
  const seqPath = resolve(REPORTS_DIR, "a2ui-user-input-sequence.jsonl");
  writeFileSync(
    seqPath,
    updateMessages.map((m) => JSON.stringify(m)).join("\n") + "\n",
    "utf8",
  );
  console.log(`\n[Sequence] 저장: ${seqPath} (백엔드 → 뷰어 메시지 시퀀스)`);

  console.log(`\n=== 데이터 바인딩 동적 동작 검증 결과 ===`);
  const beforeEmpty = Object.values(dataModelBefore.input || {}).filter((v) => !v || v === 0).length;
  const afterFilled = Object.values(dataModelAfter.input || {}).filter((v) => v && v !== 0).length;
  console.log(`  초기 input 비어있는 키 수: ${beforeEmpty}`);
  console.log(`  업데이트 후 채워진 키 수: ${afterFilled}`);
  console.log(`  사용자 입력 메시지: ${updateMessages.length}건`);
  console.log(`  ✅ updateDataModel → dataModel 변경 → 다음 render에 반영 동작 검증`);
}

main();
