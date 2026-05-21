/**
 * get_incident_response_workflow
 *
 * 산업재해 발생 시점부터 시간순 법정 의무를 일렬로 반환한다.
 * docs/LEGAL-DUTY-LIFECYCLE.md §5.1 응급 시나리오.
 *
 * severity:
 *   fatal     — 중대재해(사망·3개월 이상 휴업 2명 이상·직업성질병 1년 내 3명)
 *   serious   — 일반 산업재해 (휴업 3일 이상)
 *   minor     — 경미사고 (휴업 3일 미만)
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { findDoc } from "../lib/master-loader.js";
// Issue #6 — severity 자연어 alias (fatality/사망 등도 허용)
import { aliasedEnum, SEVERITY_ALIASES } from "../lib/input-aliases.js";

const inputSchema = z.object({
  severity: aliasedEnum(["fatal", "serious", "minor"] as const, SEVERITY_ALIASES).describe(
    "fatal=중대재해 / serious=휴업 3일 이상 / minor=경미사고. 자연어 alias 허용: fatality/death/사망→fatal, critical/major/중상→serious, light/slight/경상→minor.",
  ),
  incidentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("발생일 YYYY-MM-DD (생략 시 오늘 KST)"),
});


interface Step {
  whenLabel: string; // 사람 가독 시간 라벨
  offsetMinutes: number; // 발생 시점 +오프셋 (정렬용)
  required: boolean;
  action: string;
  legalBasis: string;
  docId?: string; // 마스터 SSoT 연결
  stakeholders: string[];
}

const FATAL_STEPS: Step[] = [
  {
    whenLabel: "T+0분 — 즉시",
    offsetMinutes: 0,
    required: true,
    action: "작업중지 명령권 행사 + 119 신고 + 경찰 신고 + 추가 피해 방지",
    legalBasis: "산안법 §51 (작업중지) / 의료법",
    stakeholders: ["현장소장", "관리감독자", "안전관리자"],
  },
  {
    whenLabel: "T+0분 — 즉시",
    offsetMinutes: 1,
    required: true,
    action: "사고 현장 보존 (이동 금지·증거 훼손 금지)",
    legalBasis: "산안법 §54 (중대재해 발생 시 보고) + 시행규칙 §67",
    stakeholders: ["사업주", "현장소장"],
  },
  {
    whenLabel: "T+30분 이내",
    offsetMinutes: 30,
    required: true,
    action: "관할 지방고용노동(지)청 + 안전보건공단 + 경찰서 즉시 보고 (전화·팩스·이메일)",
    legalBasis: "산안법 §54·시행규칙 §67 / 중대재해처벌법 §4",
    docId: "severe_accident_immediate_report",
    stakeholders: ["사업주", "안전보건관리책임자"],
  },
  {
    whenLabel: "T+24시간 이내",
    offsetMinutes: 24 * 60,
    required: true,
    action: "이사회·경영책임자 보고 + 재해자 가족 통지 + 작업중지 범위 확정",
    legalBasis: "중대재해처벌법 §4·시행령 §4",
    stakeholders: ["대표이사", "경영책임자", "안전보건총괄책임자"],
  },
  {
    whenLabel: "T+1주 이내",
    offsetMinutes: 7 * 24 * 60,
    required: true,
    action: "수시 위험성평가 실시 (재해 원인 작업에 대해)",
    legalBasis: "산안법 §36 / 위험성평가 고시 §15 ② 단서 (작업 재개 전)",
    docId: "ad_hoc_risk_assessment",
    stakeholders: ["안전관리자", "관리감독자", "근로자대표"],
  },
  {
    whenLabel: "T+1개월 이내",
    offsetMinutes: 30 * 24 * 60,
    required: true,
    action: "산업재해조사표 (별지 30호) 작성 + 관할 지방고용노동(지)청 제출",
    legalBasis: "산안법 §57·시행규칙 §73",
    docId: "industrial_accident_report",
    stakeholders: ["사업주", "안전관리자"],
  },
  {
    whenLabel: "T+1개월 이내",
    offsetMinutes: 30 * 24 * 60 + 1,
    required: true,
    action: "재발방지대책 수립 + 이행계획 작성 (ERIC 우선순위)",
    legalBasis: "중대재해처벌법 §4 ① 1호",
    docId: "severe_accident_compliance",
    stakeholders: ["경영책임자", "안전보건관리책임자", "안전관리자"],
  },
  {
    whenLabel: "T+3개월 이내",
    offsetMinutes: 90 * 24 * 60,
    required: false,
    action: "안전보건진단 명령 가능성 대비 (고용노동부 명령 시)",
    legalBasis: "산안법 §47 (안전보건진단)",
    stakeholders: ["사업주"],
  },
  {
    whenLabel: "반기 1회 (지속)",
    offsetMinutes: 180 * 24 * 60,
    required: true,
    action: "중대재해 재발방지 이행계획 점검 + 경영책임자 결재",
    legalBasis: "중대재해처벌법 시행령 §4·§5",
    docId: "severe_accident_compliance",
    stakeholders: ["경영책임자"],
  },
];

const SERIOUS_STEPS: Step[] = [
  {
    whenLabel: "T+0분 — 즉시",
    offsetMinutes: 0,
    required: true,
    action: "응급조치 + 의료기관 후송 + 작업중지 검토",
    legalBasis: "산안법 §51",
    stakeholders: ["관리감독자", "안전관리자"],
  },
  {
    whenLabel: "T+1일 이내",
    offsetMinutes: 24 * 60,
    required: true,
    action: "사고 현장 조사 + 직접·간접 원인 파악 + 사진·증거 수집",
    legalBasis: "산안법 §57",
    stakeholders: ["안전관리자", "관리감독자"],
  },
  {
    whenLabel: "T+1주 이내",
    offsetMinutes: 7 * 24 * 60,
    required: false,
    action: "수시 위험성평가 (해당 작업)",
    legalBasis: "위험성평가 고시 §15 ②",
    docId: "ad_hoc_risk_assessment",
    stakeholders: ["안전관리자"],
  },
  {
    whenLabel: "T+1개월 이내",
    offsetMinutes: 30 * 24 * 60,
    required: true,
    action: "산업재해조사표 (별지 30호) 작성 + 관할 지방고용노동(지)청 제출",
    legalBasis: "산안법 §57·시행규칙 §73",
    docId: "industrial_accident_report",
    stakeholders: ["사업주", "안전관리자"],
  },
];

const MINOR_STEPS: Step[] = [
  {
    whenLabel: "T+0분 — 즉시",
    offsetMinutes: 0,
    required: true,
    action: "응급조치 + 부상 정도 평가 + 의료기관 후송 결정",
    legalBasis: "산안법 §51",
    stakeholders: ["관리감독자"],
  },
  {
    whenLabel: "T+1일 이내",
    offsetMinutes: 24 * 60,
    required: true,
    action: "사고일지 기록 (자체 보관) + 원인·조치 내용 정리",
    legalBasis: "자체 안전관리 (휴업 3일 미만은 산재조사표 의무 없음)",
    stakeholders: ["안전관리자"],
  },
  {
    whenLabel: "차기 회의 시",
    offsetMinutes: 7 * 24 * 60,
    required: true,
    action: "TBM에서 사례 공유 + 재발방지 안내",
    legalBasis: "위험성평가 고시 §15 ④ 3호 (TBM)",
    docId: "daily_tbm",
    stakeholders: ["관리감독자", "전 작업자"],
  },
];

// Issue #5 (2026-05-21) — KST/UTC 9시간 오차 fix
// 이전: new Date("YYYY-MM-DDT00:00:00") 가 로컬 또는 UTC 자정으로 파싱되어
//      서버 timezone 에 따라 dueAt 이 9시간 이전(UTC 자정)으로 표시되는 회귀 발생.
// 이후: 항상 KST(+09:00) 자정 기준으로 산술 + ISO offset 명시.
function offsetToDate(incidentDate: string, minutes: number): string {
  // 입력은 YYYY-MM-DD (예: "2026-05-21"). KST(+09:00) 자정으로 명시 파싱.
  const kstMidnight = new Date(`${incidentDate}T00:00:00+09:00`);
  const due = new Date(kstMidnight.getTime() + minutes * 60_000);
  // KST 기준 ISO 문자열 — UTC ISO 에서 +9h 보정 후 substring.
  const kstMs = due.getTime() + 9 * 60 * 60_000;
  const kstIso = new Date(kstMs).toISOString();
  // "2026-05-21T00:30:00.000Z" → "2026-05-21 00:30 KST"
  return kstIso.slice(0, 16).replace("T", " ") + " KST";
}

// Issue #5 — KST 기준 오늘 날짜 (UTC slice 시 hours<9 인 새벽 호출에서 하루 빨라지는 문제 해소)
function todayKst(): string {
  const nowKstMs = Date.now() + 9 * 60 * 60_000;
  return new Date(nowKstMs).toISOString().slice(0, 10);
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);
  const incidentDate = args.incidentDate ?? todayKst();
  const steps =
    args.severity === "fatal" ? FATAL_STEPS : args.severity === "serious" ? SERIOUS_STEPS : MINOR_STEPS;

  const enriched = steps.map((s) => {
    const dueAt = offsetToDate(incidentDate, s.offsetMinutes);
    const docMeta = s.docId ? findDoc(s.docId) : undefined;
    return { ...s, dueAt, docMeta };
  });

  const lines: string[] = [];
  const sevLabel = { fatal: "🔴 중대재해 (Fatal)", serious: "🟠 일반 산업재해 (Serious)", minor: "🟡 경미사고 (Minor)" }[args.severity];
  lines.push(`# ${sevLabel} 대응 시간순 법정 의무`);
  lines.push("");
  lines.push(`**발생일**: ${incidentDate}`);
  lines.push(`**전체 의무**: 필수 ${enriched.filter((e) => e.required).length}건 + 권장 ${enriched.filter((e) => !e.required).length}건`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const e of enriched) {
    const badge = e.required ? "🔴 필수" : "🟡 권장";
    lines.push(`### ${badge} — ${e.whenLabel}`);
    lines.push(`**기한**: ${e.dueAt}`);
    lines.push(`**조치**: ${e.action}`);
    lines.push(`**법령**: ${e.legalBasis}`);
    lines.push(`**담당**: ${e.stakeholders.join(", ")}`);
    if (e.docMeta) {
      lines.push(`**연계 문서**: \`${e.docId}\` — ${e.docMeta.title}`);
      if (e.docMeta.submitTo) lines.push(`  - 제출: ${e.docMeta.submitTo}`);
      if (e.docMeta.electronicSubmission?.available) {
        lines.push(`  - 전자제출: ${e.docMeta.electronicSubmission.url}`);
      }
    } else if (e.docId) {
      lines.push(`**연계 문서**: \`${e.docId}\` (마스터 미연동)`);
    }
    lines.push("");
  }

  if (args.severity === "fatal") {
    lines.push("---");
    lines.push("");
    lines.push("> ⚠️ **중대재해처벌법** 적용 사업장은 경영책임자(대표이사·이사) 직접 형사처벌 대상.");
    lines.push("> 변호인 즉시 자문 + 모든 기록·증거 보존 + 작업중지 범위 신중 결정.");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      severity: args.severity,
      incidentDate,
      steps: enriched.map((e) => ({
        whenLabel: e.whenLabel,
        dueAt: e.dueAt,
        required: e.required,
        action: e.action,
        legalBasis: e.legalBasis,
        docId: e.docId ?? null,
        stakeholders: e.stakeholders,
        submitTo: e.docMeta?.submitTo ?? null,
        electronicSubmission: e.docMeta?.electronicSubmission ?? null,
      })),
      nextActions: [
        "각 docId 로 `get_safety_document_guide` 또는 `generate_safety_document` 호출",
        "산업재해조사표는 `get_submission_info({docId: \"industrial_accident_report\"})` 로 제출 정보 확인",
      ],
    },
  };
}

export const getIncidentResponseWorkflowTool: ToolDefinition = {
  name: "get_incident_response_workflow",
  title: "산업재해 시간순 법정 의무",
  description:
    "산업재해 발생 시점부터 시간순(T+0분 / 30분 / 24시간 / 1주 / 1개월 / 반기)으로 법정 의무를 반환한다. 라이프사이클 §5.1 응급 시나리오. 중대재해는 중처법 §4 + 산안법 §54 통합.",
  inputSchema,
  handler,
};
