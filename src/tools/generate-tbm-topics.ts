// SPDX-License-Identifier: MIT
// 출처: 이 도구는 저장소 내 JSON-LD 그래프와 daily-tbm schema 사실만 사용한다.
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import dailyTbmGuide from "../ontology/guides/daily-tbm.json" with { type: "json" };
import {
  buildControlMeasuresForHazard,
  findActivity,
  formatEricLevel,
  getGraphNode,
  isPpeControl,
  readString,
  resolveSourceLinks,
  toGraphRef,
  toStringArray,
  type ControlMeasure,
  type GraphNode,
  type GraphRef,
  type SourceLink,
} from "./get-measures-by-risk.js";
import { getWorkSteps, type ResolvedWorkSteps } from "../lib/work-steps.js";

// 파일 최상단 상수 - TBM markdown 출력 제한
const DEFAULT_TIME_ZONE = "Asia/Seoul";
const MAX_HAZARDS = 5;
const MAX_CONTROLS = 5;
const MAX_PPE = 4;
const MAX_CITATIONS = 3;
// 단계별 확인 — 오늘 하는 단계가 특정되면 그 단계의 근거를, 아니면 단계별 재해유형만 보여 준다
const MAX_STEP_BASIS_FOCUSED = 3;
const MAX_STEP_BASIS_OVERVIEW = 1;
/** 재해유형 한 칸에 보여 줄 위험요인 수 — 단계를 짚었을 때 / 공종 전체를 볼 때 */
const MAX_STEP_RISKS_FOCUSED = 4;
const MAX_STEP_RISKS_OVERVIEW = 1;
const MAX_MEASURES_PER_RISK = 3;

// 매일 사이클 흐름: TBM 주제 생성 후 → 본문 문서 생성 / 통제수단·PPE 보완 / 사진 증빙 업로드.
const SUGGESTED_NEXT_TOOLS = [
  "generate_safety_document",
  "get_measures_by_risk",
  "upload_photo_evidence",
] as const;

interface DailyTbmGuide {
  docId: string;
  title: string;
  requiredFields?: Array<{ key: string; label: string; source?: string }>;
  standardForm?: { requiredFields?: string[] };
  legalBasis?: string[];
}

interface TbmHazard {
  iri: string;
  label: string;
  specificity?: string;
  description?: string;
  chain: {
    activity: GraphRef;
    relation: "hasHazard";
    hazard: GraphRef;
  };
}

interface TbmControl {
  iri: string;
  label: string;
  ericLevel?: number;
  ericLevelLabel: string;
  controlSpecificity?: string;
  directActivityMatch: boolean;
  hazard: GraphRef;
  chain: {
    activity: GraphRef;
    hasHazard: GraphRef;
    mitigatedBy: GraphRef;
  };
}

const inputSchema = z
  .object({
    activityId: z
      .string()
      .optional()
      .describe("작업 활동 IRI (예: activity:excavation_2m_plus)"),
    activityLabel: z
      .string()
      .optional()
      .describe("작업 활동 한글 라벨 또는 키워드 (예: 굴착, 비계 조립)"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("TBM 일자 YYYY-MM-DD. 생략하면 한국시간 오늘 날짜를 사용한다."),
  })
  .refine((v) => Boolean(v.activityId || v.activityLabel), {
    message: "activityId 또는 activityLabel 중 하나는 필요합니다.",
  });

type Input = z.infer<typeof inputSchema>;

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  // 공종 이름("강관비계", "지하연속벽")은 작업 활동 이름과 다를 수 있다 — 단계 자료에서 공종을 찾아 연결된 작업으로 잇는다
  const workSteps = input.activityLabel ? await getWorkSteps(input.activityLabel) : null;
  const activityMatch =
    findActivity(input) ??
    (workSteps?.result.activity ? findActivity({ activityId: workSteps.result.activity }) : null);
  const stepTopics = workSteps ? buildStepTopics(workSteps.result, input.activityLabel ?? "") : undefined;

  if (!activityMatch) {
    const payload = {
      query: input,
      found: false,
      message: "그래프에서 입력 작업 활동을 찾지 못했습니다.",
      suggestedNextTools: SUGGESTED_NEXT_TOOLS,
    };
    return {
      content: [{ type: "text", text: "# TBM 주제 생성 실패\n\n" + payload.message }],
      structuredContent: payload,
    };
  }

  const activityRef = toGraphRef(activityMatch.node);
  const hazards = resolveActivityHazards(activityMatch.node);
  const selectedHazards = hazards.slice(0, MAX_HAZARDS);
  const majorHazards = selectedHazards.map((hazard) => toTbmHazard(activityRef, hazard));
  const controls = collectControls(activityRef, selectedHazards).slice(0, MAX_CONTROLS);
  const ppe = collectPpeControls(activityRef, selectedHazards).slice(0, MAX_PPE);
  const graphSources = resolveSourceLinks(activityMatch.node, ...hazards);
  const koshaGuides = graphSources.filter((s) => s.sourceType === "kosha_guide");
  const legalArticles = ensureLegalArticles(graphSources);
  const tbmSchema = extractTbmSchema();

  const payload = {
    query: input,
    found: true,
    tbmDate: input.date ?? todayInKorea(),
    matchedActivity: {
      iri: activityMatch.iri,
      label: activityMatch.label,
      score: activityMatch.score,
      matchedBy: activityMatch.matchedBy,
    },
    dailyTbmSchema: tbmSchema,
    topics: {
      todayWork: {
        iri: activityRef.iri,
        label: activityRef.label,
      },
      majorHazards,
      safetyMeasures: controls,
      requiredPpe: ppe,
      citations: {
        koshaGuides: koshaGuides.slice(0, MAX_CITATIONS),
        legalArticles: legalArticles.slice(0, MAX_CITATIONS),
      },
      ...(stepTopics ? { workSteps: stepTopics } : {}),
    },
    graphTraversal: {
      start: activityRef.iri,
      chains: [
        "activity --hasHazard--> hazard",
        "hazard --mitigatedBy--> control",
        "activity/hazard --guidedBy--> doc:kosha_guide",
        "activity/hazard --regulatedBy--> art",
      ],
    },
    license: "MIT. 그래프 노드의 출처·라이선스는 각 node._meta.licenseHint 및 sourceUrl을 따른다.",
    suggestedNextTools: SUGGESTED_NEXT_TOOLS,
  };

  return {
    content: [{ type: "text", text: renderTbmMarkdown(payload) }],
    structuredContent: payload,
  };
}

interface StepTopics {
  group: string;
  work: string;
  /** 작업명에 단계 이름이 들어 있으면 그 단계들 (예: "강관비계 조립 및 해체" → 조립·해체) */
  focusStep?: string;
  steps: Array<{
    name: string;
    hazards: Array<{
      hazardLabel: string;
      /** 위험요인과 대책 (중요도 높은 것부터) */
      risks: Array<{ statement: string; priority?: string; measures: string[] }>;
      basis: Array<{ ref: string; title: string; controlLevel?: string }>;
    }>;
  }>;
  /** 이 공사를 다루는 표준안전 작업지침 (권고 기준) */
  relatedNotices?: ResolvedWorkSteps["relatedNotices"];
  /** 연결된 작업과 관련된 문서 (작성 조건에 해당할 때만 필요) */
  relatedDocuments?: ResolvedWorkSteps["relatedDocuments"];
  notice: string;
}

/** 단계 자료를 TBM 에 쓸 분량으로 줄인다. 작업명이 단계를 가리키면 그 단계만 근거와 함께 남긴다. */
function buildStepTopics(ws: ResolvedWorkSteps, label: string): StepTopics {
  const labelTokens = label.split(/[\s.,()·]+/).filter((t) => t.length >= 2);
  const workName = ws.work.replace(/\s/g, "");
  const focused = ws.steps.filter((step) =>
    labelTokens.some((t) => !workName.includes(t) && step.name.includes(t)),
  );
  const chosen = focused.length > 0 ? focused : ws.steps;
  const maxBasis = focused.length > 0 ? MAX_STEP_BASIS_FOCUSED : MAX_STEP_BASIS_OVERVIEW;
  return {
    group: ws.group,
    work: ws.work,
    ...(focused.length > 0 ? { focusStep: focused.map((step) => step.name).join("·") } : {}),
    steps: chosen.map((step) => ({
      name: step.name,
      hazards: step.hazards.map((h) => ({
        hazardLabel: h.hazardLabel,
        risks: [...h.risks]
          .sort((x, y) => (y.priority?.length ?? 0) - (x.priority?.length ?? 0))
          .slice(0, focused.length > 0 ? MAX_STEP_RISKS_FOCUSED : MAX_STEP_RISKS_OVERVIEW)
          .map((r) => ({
            statement: r.statement,
            ...(r.priority ? { priority: r.priority } : {}),
            measures: r.measures.slice(0, MAX_MEASURES_PER_RISK).map((m) => m.measure),
          })),
        basis: h.basis.slice(0, maxBasis).map((b) => ({
          ref: b.ref,
          // 가이드는 조항 제목(번호는 ref 에 이미 있다), 조문은 조문 제목
          title: b.text && b.kind === "kosha_guide" ? b.text.replace(/^[\d.]+\s+/, "") : b.title,
          ...(b.controlLevel ? { controlLevel: b.controlLevel } : {}),
        })),
      })),
    })),
    ...(ws.relatedNotices ? { relatedNotices: ws.relatedNotices } : {}),
    ...(ws.relatedDocuments ? { relatedDocuments: ws.relatedDocuments } : {}),
    notice:
      "공종의 작업 단계마다 살필 재해유형과 근거를 연결한 참고 자료입니다. 현장 조건에 맞는지 확인하고, 여기 없는 위험요인도 추가로 찾아야 합니다.",
  };
}

function resolveActivityHazards(activityNode: GraphNode): GraphNode[] {
  const hazardScope = readRecord(activityNode.hazardScope);
  const specificHazards = toStringArray(hazardScope.specific);
  const allHazards = uniqueStrings([
    ...specificHazards,
    ...toStringArray(activityNode.hasHazard),
    ...toStringArray(activityNode.causedBy),
  ]);
  const specificSet = new Set(specificHazards);

  return allHazards
    .map((iri) => getGraphNode(iri))
    .filter((node): node is GraphNode => Boolean(node))
    .sort((a, b) => hazardPriority(b, specificSet) - hazardPriority(a, specificSet));
}

function hazardPriority(node: GraphNode, specificSet: Set<string>): number {
  const iri = toGraphRef(node).iri;
  const specificity = readString(node.specificity);
  if (specificSet.has(iri)) return 3;
  if (specificity === "specific") return 2;
  return 1;
}

function toTbmHazard(activity: GraphRef, hazard: GraphNode): TbmHazard {
  const hazardRef = toGraphRef(hazard);
  return {
    iri: hazardRef.iri,
    label: hazardRef.label,
    specificity: readString(hazard.specificity),
    description: shorten(readString(hazard.description) ?? "", 120),
    chain: {
      activity,
      relation: "hasHazard",
      hazard: hazardRef,
    },
  };
}

function collectControls(activity: GraphRef, hazards: GraphNode[]): TbmControl[] {
  const byIri = new Map<string, TbmControl>();

  for (const hazard of hazards) {
    const hazardRef = toGraphRef(hazard);
    for (const measure of buildControlMeasuresForHazard(hazard)) {
      if (measure.iri.startsWith("control:eric_")) continue;
      if (byIri.has(measure.iri)) continue;
      byIri.set(measure.iri, toTbmControl(activity, hazardRef, measure));
    }
  }

  return [...byIri.values()].sort(sortControls);
}

function collectPpeControls(activity: GraphRef, hazards: GraphNode[]): TbmControl[] {
  const byIri = new Map<string, TbmControl>();

  for (const hazard of hazards) {
    const hazardRef = toGraphRef(hazard);
    for (const measure of buildControlMeasuresForHazard(hazard)) {
      const node = getGraphNode(measure.iri);
      if (!isPpeControl(measure) && !(node && isPpeControl(node))) continue;
      if (byIri.has(measure.iri)) continue;
      byIri.set(measure.iri, toTbmControl(activity, hazardRef, measure));
    }
  }

  return [...byIri.values()].sort(sortControls);
}

function toTbmControl(
  activity: GraphRef,
  hazard: GraphRef,
  measure: ControlMeasure,
): TbmControl {
  return {
    iri: measure.iri,
    label: measure.label,
    ericLevel: measure.ericLevel,
    ericLevelLabel: measure.ericLevelLabel,
    controlSpecificity: measure.controlSpecificity,
    directActivityMatch: measure.appliesToActivity.includes(activity.iri),
    hazard,
    chain: {
      activity,
      hasHazard: hazard,
      mitigatedBy: { iri: measure.iri, label: measure.label },
    },
  };
}

function sortControls(a: TbmControl, b: TbmControl): number {
  const aLevel = a.ericLevel ?? 99;
  const bLevel = b.ericLevel ?? 99;
  if (a.directActivityMatch !== b.directActivityMatch) {
    return Number(b.directActivityMatch) - Number(a.directActivityMatch);
  }
  if (aLevel !== bLevel) return aLevel - bLevel;
  const aSpecific = a.controlSpecificity === "specific" ? 1 : 0;
  const bSpecific = b.controlSpecificity === "specific" ? 1 : 0;
  if (aSpecific !== bSpecific) return bSpecific - aSpecific;
  return a.label.localeCompare(b.label, "ko");
}

function ensureLegalArticles(graphSources: SourceLink[]): SourceLink[] {
  const legalArticles = graphSources.filter((s) => s.sourceType === "law_article");
  if (legalArticles.length > 0) return legalArticles;

  const guide = dailyTbmGuide as DailyTbmGuide;
  const fallbackNode = { legalBasis: guide.legalBasis ?? [] } as GraphNode;
  return resolveSourceLinks(fallbackNode).filter((s) => s.sourceType === "law_article");
}

function extractTbmSchema(): {
  docId: string;
  title: string;
  requiredFields: Array<{ key: string; label: string; source?: string }>;
  standardRequiredFields: string[];
} {
  const guide = dailyTbmGuide as DailyTbmGuide;
  return {
    docId: guide.docId,
    title: guide.title,
    requiredFields: (guide.requiredFields ?? []).filter((field) =>
      ["required_01", "required_02", "required_04", "required_05", "required_06"].includes(
        field.key,
      ),
    ),
    standardRequiredFields: (guide.standardForm?.requiredFields ?? []).slice(0, 8),
  };
}

function renderTbmMarkdown(payload: {
  tbmDate: string;
  matchedActivity: { iri: string; label: string };
  dailyTbmSchema: {
    title: string;
    requiredFields: Array<{ key: string; label: string; source?: string }>;
  };
  topics: {
    todayWork: GraphRef;
    majorHazards: TbmHazard[];
    safetyMeasures: TbmControl[];
    requiredPpe: TbmControl[];
    citations: {
      koshaGuides: SourceLink[];
      legalArticles: SourceLink[];
    };
    workSteps?: StepTopics;
  };
}): string {
  const lines = [
    `# TBM 회의 주제 (${payload.tbmDate})`,
    "",
    "## 오늘의 작업",
    `- ${payload.topics.todayWork.label} (\`${payload.topics.todayWork.iri}\`)`,
    `- 양식: ${payload.dailyTbmSchema.title}`,
    `- 필수 항목: ${payload.dailyTbmSchema.requiredFields.map((f) => f.label).join(", ")}`,
    "",
    "## 주요 위험요인",
  ];

  for (const hazard of payload.topics.majorHazards.slice(0, MAX_HAZARDS)) {
    const detail = hazard.description ? ` - ${hazard.description}` : "";
    lines.push(`- ${hazard.label} (\`${hazard.iri}\`)${detail}`);
  }
  if (payload.topics.majorHazards.length === 0) lines.push("- 그래프에 연결된 위험요인이 없습니다.");

  lines.push("", "## 안전조치");
  for (const control of payload.topics.safetyMeasures.slice(0, MAX_CONTROLS)) {
    lines.push(
      `- ${control.label} (\`${control.iri}\`) - ${formatEricLevel(control.ericLevel)}, 관련 위험: ${control.hazard.label}`,
    );
  }
  if (payload.topics.safetyMeasures.length === 0) lines.push("- 그래프에 연결된 안전조치가 없습니다.");

  lines.push("", "## 필요 보호구");
  for (const ppe of payload.topics.requiredPpe.slice(0, MAX_PPE)) {
    lines.push(`- ${ppe.label} (\`${ppe.iri}\`) - 관련 위험: ${ppe.hazard.label}`);
  }
  if (payload.topics.requiredPpe.length === 0) lines.push("- 그래프에서 PPE 통제수단을 찾지 못했습니다.");

  lines.push("", "## 관련 KOSHA Guide");
  for (const guide of payload.topics.citations.koshaGuides.slice(0, MAX_CITATIONS)) {
    const url = guide.sourceUrl ? ` - ${guide.sourceUrl}` : "";
    lines.push(`- ${guide.label} (\`${guide.iri}\`)${url}`);
  }
  if (payload.topics.citations.koshaGuides.length === 0) lines.push("- 그래프에 KOSHA Guide 링크가 없습니다.");

  lines.push("", "## 관련 법조");
  for (const article of payload.topics.citations.legalArticles.slice(0, MAX_CITATIONS)) {
    const law = article.legislationIdentifier ? `${article.legislationIdentifier} ` : "";
    const url = article.sourceUrl ? ` - ${article.sourceUrl}` : "";
    lines.push(`- ${law}${article.label} (\`${article.iri}\`)${url}`);
  }
  if (payload.topics.citations.legalArticles.length === 0) lines.push("- 그래프에 법령 조문 링크가 없습니다.");

  const ws = payload.topics.workSteps;
  if (ws) {
    lines.push("", `## 단계별 확인 — ${ws.work}${ws.focusStep ? ` (${ws.focusStep})` : ""}`);
    for (const step of ws.steps) {
      lines.push(`- **${step.name}**`);
      for (const h of step.hazards) {
        const basis = h.basis.map((b) => `${b.ref} ${b.title}`.trim()).join(" / ");
        lines.push(`  - ${h.hazardLabel}${basis ? ` — ${basis}` : ""}`);
        for (const r of h.risks) {
          lines.push(`    - ${r.priority ? `${r.priority} ` : ""}${r.statement}${r.measures.length > 0 ? ` → ${r.measures.join(" / ")}` : ""}`);
        }
      }
    }
    if (ws.relatedNotices && ws.relatedNotices.length > 0) {
      lines.push("", "### 함께 볼 표준안전 작업지침 (권고 기준)");
      for (const n of ws.relatedNotices) {
        const arts = n.articles.map((x) => `${x.ref.split(" ").pop()} ${x.title}`).join(", ");
        lines.push(`- ${n.law}${arts ? ` — ${arts}` : ""}`);
      }
    }
    if (ws.relatedDocuments && ws.relatedDocuments.length > 0) {
      lines.push("", "### 관련 문서 (작성 조건에 해당하는지 확인)");
      for (const doc of ws.relatedDocuments) {
        lines.push(`- ${doc.title} (\`${doc.docId}\`)${doc.when ? ` — 작성 시점: ${doc.when}` : ""}`);
      }
    }
    lines.push("", `> ${ws.notice}`);
  }

  return lines.join("\n");
}

function todayInKorea(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function shorten(value: string, maxLength: number): string | undefined {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

export const generateTbmTopicsTool: ToolDefinition = {
  name: "generate_tbm_topics",
  title: "TBM 회의 주제 생성",
  description:
    "작업 활동 IRI 또는 한글 라벨로 그래프를 탐색해 당일 TBM 회의용 markdown을 생성한다. 오늘의 작업, 주요 위험요인, 안전조치, 필요 보호구, KOSHA Guide, 법령 조문을 저장소 JSON-LD와 daily_tbm schema 사실만으로 구성한다.",
  inputSchema,
  handler,
};
