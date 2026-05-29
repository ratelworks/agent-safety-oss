/**
 * request_field_help
 *
 * Active Graph Authoring Loop (decision 002) — 필드 단위 동적 도움말 도구.
 *
 * 사용자가 A2UI 폼에서 특정 필드 옆 "?" 버튼을 클릭하거나,
 * LLM 이 사용자 입력값 currentValue 를 보고 작성 보조가 필요하다고 판단하면 호출.
 *
 * 그래프 traversal 로 결정론적 도움말 조립 (LLM 추측 0):
 *   - 노드 fields[fieldKey] 의 inputGuide·examples·checkPoints·standardFormat
 *   - 노드 _meta.writingGuide.fieldHints[label] (필드명 매칭)
 *   - 노드 _meta.writingGuide.commonMistakes (필드 관련 항목 우선)
 *   - 노드 _meta.writingGuide.bestPractices (필드 관련 항목 우선)
 *   - currentValue 가 있으면 commonMistakes 패턴 일치 검사 → 경고
 *
 * 반환:
 *   - content: Markdown 도움말 (LLM 이 그대로 폼에 push 가능)
 *   - structuredContent.a2uiUpdate: viewer 가 직접 적용 가능한 updateComponents JSONL
 *   - nextActions: LLM 후속 도구 추천
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { graphRepository } from "../lib/graph-repository.js";

const inputSchema = z.object({
  docId: z.string().describe("법정문서 docId (예: daily_tbm)"),
  fieldKey: z.string().describe("도움말이 필요한 필드 key (예: hazard1, workContent)"),
  currentValue: z
    .string()
    .optional()
    .describe("현재 사용자가 입력 중인 값 (있으면 commonMistakes 패턴 검사 추가)"),
  surfaceId: z
    .string()
    .default("safety-form")
    .describe("A2UI surface ID — a2uiUpdate 메시지에서 사용"),
});

type Input = z.infer<typeof inputSchema>;

interface FieldDefinition {
  key: string;
  label: string;
  inputGuide?: string;
  examples?: unknown[];
  checkPoints?: string[];
  standardFormat?: string;
  source?: string;
  required?: boolean;
  section?: string;
}

interface WritingGuide {
  fieldHints?: Record<string, string>;
  commonMistakes?: string[];
  bestPractices?: string[];
}

function findField(docNode: Record<string, any>, fieldKey: string): FieldDefinition | undefined {
  // 1) sections.fields 우선
  for (const sec of docNode.sections ?? []) {
    for (const f of sec.fields ?? []) {
      if (f.key === fieldKey) {
        return { ...f, section: sec.title };
      }
    }
  }
  // 2) requiredFields fallback (formAuthority=requiredFields 또는 sections 없을 때)
  for (const f of docNode.requiredFields ?? []) {
    if (f.key === fieldKey) return { ...f };
  }
  return undefined;
}

function normalizeForMatch(s: string): string {
  return s
    .replace(/\([^)]*\)/g, "")
    .replace(/[❶❷❸❹❺❻❼❽❾❿①-⑳]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function extractFieldHint(writingGuide: WritingGuide | undefined, field: FieldDefinition): string | undefined {
  if (!writingGuide?.fieldHints) return undefined;
  // 라벨 직접 매칭
  if (writingGuide.fieldHints[field.label]) return writingGuide.fieldHints[field.label];
  // key 매칭
  if (writingGuide.fieldHints[field.key]) return writingGuide.fieldHints[field.key];
  // 라벨 부분 매칭 — 정규화 후 양방향 substring
  const labelNorm = normalizeForMatch(field.label);
  for (const [k, v] of Object.entries(writingGuide.fieldHints)) {
    const kNorm = normalizeForMatch(k);
    if (!kNorm) continue;
    if (labelNorm.includes(kNorm) || kNorm.includes(labelNorm)) return v;
  }
  return undefined;
}

function pickRelatedMistakes(mistakes: string[] | undefined, field: FieldDefinition, currentValue?: string): {
  related: string[];
  matched: string[]; // currentValue 패턴 일치
} {
  const related: string[] = [];
  const matched: string[] = [];
  if (!mistakes) return { related, matched };

  const labelTokens = field.label.split(/[\s·,]/).filter((t) => t.length >= 2);

  for (const m of mistakes) {
    let isRelated = false;
    for (const t of labelTokens) {
      if (m.includes(t)) {
        isRelated = true;
        break;
      }
    }
    if (isRelated) related.push(m);
    // currentValue 패턴 일치 (단순 키워드 검사)
    if (currentValue && m.length > 0) {
      // "추상명사로 작성" 같은 경고 패턴 검사
      const abstractNounWarnings = ["추상명사", "추상 명사"];
      if (abstractNounWarnings.some((w) => m.includes(w))) {
        // currentValue 가 짧고 한 단어면 추상명사 의심
        const trimmed = currentValue.trim();
        if (trimmed.length > 0 && trimmed.length <= 6 && !/[\s,]/.test(trimmed)) {
          matched.push(m);
        }
      }
      // "서명 누락" 같은 경고
      if (m.includes("서명") && /서명|sign/i.test(field.label) && currentValue.trim() === "") {
        matched.push(m);
      }
    }
  }
  return { related, matched };
}

function pickRelatedPractices(practices: string[] | undefined, field: FieldDefinition): string[] {
  if (!practices) return [];
  const labelTokens = field.label.split(/[\s·,]/).filter((t) => t.length >= 2);
  return practices.filter((p) => labelTokens.some((t) => p.includes(t))).slice(0, 3);
}

function buildA2UIUpdate(
  surfaceId: string,
  field: FieldDefinition,
  helpText: string,
): Array<Record<string, unknown>> {
  // updateComponents 메시지 — help 카드를 폼에 push
  const helpCardId = `help-${field.key}-card`;
  const helpTextId = `help-${field.key}-text`;
  return [
    {
      updateComponents: {
        surfaceId,
        root: "root",
        components: [
          { id: helpCardId, component: "Card", child: helpTextId },
          { id: helpTextId, component: "Text", text: helpText, usageHint: "body" },
        ],
      },
    },
  ];
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args: Input = inputSchema.parse(rawInput);
  await graphRepository.ensureBuilt();

  const docNode = graphRepository.getDocument(args.docId) as Record<string, any> | undefined;
  if (!docNode) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] docId="${args.docId}" 그래프 노드 없음` }],
      isError: true,
      structuredContent: { docId: args.docId, fieldKey: args.fieldKey, found: false },
    };
  }

  const field = findField(docNode, args.fieldKey);
  if (!field) {
    const fieldKeys = [
      ...(docNode.sections ?? []).flatMap((s: any) => (s.fields ?? []).map((f: any) => f.key)),
      ...(docNode.requiredFields ?? []).map((f: any) => f.key),
    ].filter((k) => k);
    return {
      content: [
        {
          type: "text",
          text: `[FIELD_NOT_FOUND] docId="${args.docId}" 내 fieldKey="${args.fieldKey}" 미발견.\n\n사용 가능 fieldKey:\n${fieldKeys.slice(0, 30).map((k) => `  - ${k}`).join("\n")}`,
        },
      ],
      isError: true,
      structuredContent: { docId: args.docId, fieldKey: args.fieldKey, found: false, availableFields: fieldKeys },
    };
  }

  const writingGuide: WritingGuide | undefined = docNode._meta?.writingGuide;
  const fieldHint = extractFieldHint(writingGuide, field);
  const { related: relatedMistakes, matched: matchedMistakes } = pickRelatedMistakes(
    writingGuide?.commonMistakes,
    field,
    args.currentValue,
  );
  const relatedPractices = pickRelatedPractices(writingGuide?.bestPractices, field);

  // Markdown 도움말 조립
  const lines: string[] = [];
  lines.push(`# ${field.label} 작성 도움말`);
  lines.push("");
  if (field.section) lines.push(`> 섹션: ${field.section}`);
  if (field.required) lines.push(`> ⚠️ **필수 항목**`);
  if (field.source) lines.push(`> 출처: ${field.source}`);
  lines.push("");

  if (field.inputGuide) {
    lines.push(`## 작성 방법`);
    lines.push(field.inputGuide);
    lines.push("");
  }

  if (fieldHint) {
    lines.push(`## 그래프 힌트`);
    lines.push(fieldHint);
    lines.push("");
  }

  if (field.standardFormat) {
    lines.push(`## 표준 형식`);
    lines.push(`\`${field.standardFormat}\``);
    lines.push("");
  }

  if (field.examples && field.examples.length > 0) {
    lines.push(`## 예시`);
    for (const ex of field.examples.slice(0, 3)) {
      const text = typeof ex === "string" ? ex : JSON.stringify(ex);
      lines.push(`- ${text}`);
    }
    lines.push("");
  }

  if (field.checkPoints && field.checkPoints.length > 0) {
    lines.push(`## 체크포인트`);
    for (const c of field.checkPoints) lines.push(`- [ ] ${c}`);
    lines.push("");
  }

  if (matchedMistakes.length > 0) {
    lines.push(`## ⚠️ 입력값 경고`);
    lines.push(`> 현재 입력 "${args.currentValue}" 가 다음 흔한 실수에 해당할 수 있습니다:`);
    for (const m of matchedMistakes) lines.push(`- ${m}`);
    lines.push("");
  }

  if (relatedMistakes.length > 0) {
    lines.push(`## 흔한 실수 (이 필드 관련)`);
    for (const m of relatedMistakes.slice(0, 5)) lines.push(`- ❌ ${m}`);
    lines.push("");
  }

  if (relatedPractices.length > 0) {
    lines.push(`## 모범 사례 (이 필드 관련)`);
    for (const p of relatedPractices) lines.push(`- ✅ ${p}`);
    lines.push("");
  }

  const helpText = lines.join("\n");
  const a2uiUpdate = buildA2UIUpdate(args.surfaceId, field, helpText);

  return {
    content: [{ type: "text", text: helpText }],
    structuredContent: {
      docId: args.docId,
      fieldKey: args.fieldKey,
      fieldLabel: field.label,
      section: field.section,
      required: field.required ?? false,
      inputGuide: field.inputGuide,
      standardFormat: field.standardFormat,
      examples: field.examples,
      checkPoints: field.checkPoints,
      fieldHint,
      commonMistakes: relatedMistakes,
      matchedMistakes,
      bestPractices: relatedPractices,
      a2uiUpdate,
      nextActions: [
        ...(matchedMistakes.length > 0
          ? ["사용자에게 입력값 재검토 권고 (matchedMistakes 표시)"]
          : []),
        `suggest_controls_for_hazard 호출 — 위험요인 필드면 통제대책 추천`,
        `preview_review({docId: "${args.docId}", draft}) — 부분 검토로 누락 확인`,
        `get_safety_document_guide({docId: "${args.docId}"}) — 문서 전체 가이드 (writingGuide·commonMistakes·bestPractices 전체)`,
      ],
    },
  };
}

export const requestFieldHelpTool: ToolDefinition = {
  name: "request_field_help",
  title: "필드 단위 동적 작성 도움말 (Active Graph Authoring Loop)",
  description:
    "A2UI 폼의 특정 필드 작성 시 그래프 노드의 inputGuide·examples·checkPoints·standardFormat + _meta.writingGuide.fieldHints / commonMistakes / bestPractices 를 결정론적으로 조립하여 동적 도움말을 제공한다. currentValue 가 있으면 추상명사·서명 누락 등 패턴 일치 경고. decision 002 Active Graph Authoring Loop 2단계 (사용자 입력 trigger → LLM 능동 호출) 의 핵심 도구. 반환값 structuredContent.a2uiUpdate 를 viewer 가 직접 updateComponents 적용 가능. LLM 후속 도구 추천: suggest_controls_for_hazard / preview_review / get_safety_document_guide.",
  inputSchema,
  handler,
};
