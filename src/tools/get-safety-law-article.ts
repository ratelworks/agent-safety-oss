import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  getArticle,
  listLaws,
  getLawHeaderMeta,
  type LawCode,
} from "../lib/safety-laws-loader.js";
import { legalRefToIri } from "../lib/article-iri-map.js";
import { getNode } from "../lib/graph-nodes-loader.js";
import { findMeasuresCiting, CONTROL_LEVEL_LABEL, type FieldMeasure } from "../lib/field-measures.js";

// 파일 최상단 상수 — 특정 조문 원문 조회
/** 법률인 법령 키 — 시행령·시행규칙·규칙(regulation)과 구분한다. 조문 노드의 법령 종류 표기는 일부가 섞여 있어 키로 가른다 */
const STATUTE_KEYS: ReadonlySet<string> = new Set(["산안법", "중처법", "건진법"]);
/** 조문 노드의 법령 종류 가운데 권고 기준인 것 (고시·지침) */
const NOTICE_LEGISLATION_TYPES: ReadonlySet<string> = new Set(["Notification", "Notice"]);
/** "굴착공사 표준안전 작업지침 제5조" · "… §5의2" → 법령명과 조 번호 */
const NOTICE_REF_PATTERN = /^(.*?)\s*(?:§\s*|제\s*)(\d+)\s*조?(?:\s*의\s*(\d+))?/;


/** 현장 감소대책 표시 선택지 — 조문만 필요한 호출은 'none' */
const FIELD_MEASURE_MODES = ["show", "none"] as const;
type FieldMeasureMode = (typeof FIELD_MEASURE_MODES)[number];

/** 조문 응답에 보여 줄 현장 대책 수 — 넘으면 줄인 건수를 적는다 (전체는 structuredContent 에) */
const MAX_FIELD_MEASURES_SHOWN = 12;

/** 이 조문을 근거로 한 공종 단계의 감소대책 — 조문이 현장에서 어떤 조치로 쓰이는지 */
async function fieldMeasureSection(
  iri: string | null,
  mode: FieldMeasureMode,
): Promise<{ md: string; data?: { total: number; works: string[]; measures: FieldMeasure[] } }> {
  if (!iri || mode === "none") return { md: "" };
  const measures = await findMeasuresCiting(iri);
  if (measures.length === 0) return { md: "" };
  const works = [...new Set(measures.flatMap((m) => m.works))].sort((a, b) => a.localeCompare(b, "ko"));
  const lines = [
    "",
    `## 이 조문을 근거로 한 현장 감소대책 — ${measures.length}건, 공종 ${works.length}개`,
    "",
    `> 공종 단계 자료에서 이 조문을 근거로 든 대책입니다. 조문의 문장이 아니라 현장 조치를 적은 문장입니다.`,
    "",
  ];
  for (const m of measures.slice(0, MAX_FIELD_MEASURES_SHOWN)) {
    const level = m.controlLevel ? ` [${CONTROL_LEVEL_LABEL[m.controlLevel] ?? m.controlLevel}]` : "";
    lines.push(`- ${m.scope ? `**${m.scope}** — ` : ""}${m.variant ? `(${m.variant}) ` : ""}${m.measure}${level} · ${m.works.join(", ")}`);
  }
  if (measures.length > MAX_FIELD_MEASURES_SHOWN) {
    lines.push(`- … 외 ${measures.length - MAX_FIELD_MEASURES_SHOWN}건 (전체는 structuredContent.fieldMeasures.measures)`);
  }
  lines.push("", `공종: ${works.join(", ")}`);
  return { md: lines.join("\n"), data: { total: measures.length, works, measures } };
}

const inputSchema = z.object({
  ref: z
    .string()
    .describe(
      "조문 참조 — 예: '산안법 §36', '§38', '산안기준규칙 §38', '중처법 §4', '산업안전보건법 시행규칙 §37'",
    ),
  lawCode: z
    .enum([
      "osha",
      "osha-decree",
      "osha-rule",
      "osha-standard",
      "severe-accident",
      "risk-assessment-notice",
    ])
    .optional()
    .describe("명시적 법령 코드 지정 (ref 에 법령명 없을 때)"),
  fieldMeasures: z
    .enum(FIELD_MEASURE_MODES)
    .default("show")
    .describe("이 조문을 근거로 한 현장 감소대책을 함께 볼지 — 'show'(기본) / 'none'(조문만)"),
});

type Input = z.infer<typeof inputSchema>;

/** 조문 노드로만 수록한 고시·지침의 조문을 찾아 응답을 만든다. 법령명을 식별하지 못하면 null. */
async function findNoticeArticle(ref: string, mode: FieldMeasureMode): Promise<McpToolResult | null> {
  const m = ref.trim().match(NOTICE_REF_PATTERN);
  if (!m || !m[1].trim()) return null;
  const { canonical } = legalRefToIri(m[1].trim(), `§${m[2]}`);
  if (!canonical) return null;
  const num = m[3] ? `${m[2]}의${m[3]}` : m[2];
  const iri = `art:${canonical}:${num}`;
  const node = (await getNode(iri)) as
    | { title?: string; description?: string; legislationIdentifier?: string; legislationDate?: string; legislationType?: string; _meta?: Record<string, unknown> }
    | undefined;
  if (!node?.description) return null;
  const lawName = node.legislationIdentifier ?? canonical;
  const meta = node._meta ?? {};
  // 근거 등급은 찾은 경로가 아니라 조문 노드에 적힌 법령 종류로 정한다 — 법·시행령·규칙은 의무, 고시·지침은 권고
  const isNotice = NOTICE_LEGISLATION_TYPES.has(node.legislationType ?? "");
  const md = [
    `# ${lawName} §${num} ${node.title ?? ""}`,
    "",
    `> **법령**: ${lawName}${meta.admRulNo ? ` (고용노동부고시 제${String(meta.admRulNo)}호)` : ""}`,
    `> **조문**: §${num} ${node.title ?? ""}`,
    `> **발령일**: ${node.legislationDate ?? "(미기재)"}`,
    `> **출처 URL**: ${typeof meta.sourceUrl === "string" ? meta.sourceUrl : "https://www.law.go.kr"}`,
    `> **마지막 동기화**: ${typeof meta.fetchedAt === "string" ? meta.fetchedAt : "(미기재)"}`,
    `> **저작권**: 저작권법 §7 비보호 저작물 (자유 인용)`,
    "",
    "---",
    "",
    node.description,
    "",
    "---",
    "",
    isNotice
      ? "**인용 시 근거 등급**: `basisType: notice` / `legalWeight: recommended` — 사업주에게 지도·권고하는 기술상 지침입니다. 법적 의무는 상위 법령(산업안전보건법·안전보건규칙) 조문으로 확인하세요."
      : "**인용 시 근거 등급**: `basisType: law | regulation` / `legalWeight: mandatory`",
  ].join("\n");
  const field = await fieldMeasureSection(iri, mode);
  return {
    content: [{ type: "text", text: md + field.md }],
    structuredContent: {
      query: { ref },
      found: true,
      ...(field.data ? { fieldMeasures: field.data } : {}),
      iri,
      law: lawName,
      article: num,
      title: node.title ?? "",
      source: "graph_node",
      basisType: isNotice ? "notice" : STATUTE_KEYS.has(canonical) ? "law" : "regulation",
      legalWeight: isNotice ? "recommended" : "mandatory",
    },
  };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});

  const article = await getArticle(input.ref, input.lawCode as LawCode | undefined);

  // 본문 파일로 수록하지 않고 조문 노드로만 가진 고시·지침은 노드에서 찾는다
  if (!article) {
    const fromGraph = await findNoticeArticle(input.ref, input.fieldMeasures);
    if (fromGraph) return fromGraph;
  }

  if (!article) {
    const availableLaws = listLaws()
      .map((l) => `- ${l.shortName} (${l.code})`)
      .join("\n");
    const md = [
      `# 조문 조회 실패: "${input.ref}"`,
      "",
      "매칭되는 조문이 번들에 없습니다. 다음을 확인하세요:",
      "",
      "1. 법령명을 포함해서 재시도 (예: `산안법 §36`, `산안기준규칙 §38`)",
      "2. `search_safety_laws` 로 키워드 기반 검색",
      "3. 번들에 없는 조문은 법제처 원문 확인: https://www.law.go.kr",
      "",
      "## 번들된 법령 목록",
      "",
      availableLaws,
    ].join("\n");

    return {
      content: [{ type: "text", text: md }],
      structuredContent: {
        query: input,
        found: false,
        availableLaws: listLaws(),
      },
    };
  }

  // 법령 헤더 메타 조회 (검토 상태·기준일·출처 URL)
  const headerMeta = await getLawHeaderMeta(article.lawCode);

  const statusBadge = (() => {
    switch (headerMeta.reviewStatus) {
      case "verified":
        return "✅ 원문 대조 완료";
      case "partial":
        return "🟡 부분 검증 (일부 조문만 확인됨)";
      case "needs_review":
        return "⚠ 조문 재대조 권장";
      default:
        return "ℹ️ 검토 상태 미기재";
    }
  })();

  // MD 응답
  const md = [
    `# ${article.lawShortName} ${article.ref} ${article.title}`,
    "",
    `> **법령**: ${article.lawShortName}`,
    `> **조문**: ${article.ref} ${article.title}`,
    `> **현행 기준**: ${headerMeta.currentLawId ?? "(법령 헤더 미기재)"}`,
    `> **출처 URL**: ${headerMeta.sourceUrl ?? "https://www.law.go.kr"}`,
    `> **마지막 동기화**: ${headerMeta.lastSyncedAt ?? "(미기재)"}`,
    `> **검토 상태**: ${statusBadge}`,
    headerMeta.manualReviewRequired
      ? `> **검토 필요 여부**: ${headerMeta.manualReviewRequired}`
      : "",
    headerMeta.nextReviewDue
      ? `> **다음 검토 권장**: ${headerMeta.nextReviewDue}`
      : "",
    `> **저작권**: 저작권법 §7 비보호 저작물 (자유 인용)`,
    "",
    "---",
    "",
    article.body.replace(/^##\s+§[^\n]+\n/, ""), // 헤딩 중복 제거
    "",
    "---",
    "",
    "**인용 시 근거 등급**: `basisType: law | regulation` / `legalWeight: mandatory`",
    "",
    headerMeta.reviewStatus === "verified"
      ? "> ✅ 본 조문은 법제처 현행본과 직접 대조 검증 완료."
      : headerMeta.reviewStatus === "partial"
        ? "> 🟡 본 법령은 일부 조문만 원문 검증됨. 해당 조문 인용 전 법제처 현행본 확인 권장."
        : "> ⚠ 본 법령은 기준일 메타만 확인됐으며 개별 조문 원문 재대조를 권장한다. 법적 판단·판례 참조 시 법제처 공식본 필수.",
  ]
    .filter((x) => x !== "")
    .join("\n");

  const articleIri = legalRefToIri(article.lawShortName, article.ref).iri;
  const field = await fieldMeasureSection(articleIri, input.fieldMeasures);

  return {
    content: [{ type: "text", text: md + field.md }],
    structuredContent: {
      query: input,
      found: true,
      ...(articleIri ? { iri: articleIri } : {}),
      ...(field.data ? { fieldMeasures: field.data } : {}),
      article: {
        lawCode: article.lawCode,
        lawShortName: article.lawShortName,
        ref: article.ref,
        title: article.title,
        basisType: "law",
        legalWeight: "mandatory",
      },
      lawMeta: headerMeta,
    },
  };
}

export const getSafetyLawArticleTool: ToolDefinition = {
  name: "get_safety_law_article",
  title: "법령 조문 본문 조회",
  description:
    "특정 법령 조문의 원문을 Markdown 으로 반환. ref 는 '산안법 §36', '§38', '산안기준규칙 §38', '중처법 §4' 같이 법령명+조번호 형식. LLM 이 위험성평가·작업계획서 작성 시 'mandatory 근거' 로 이 응답을 그대로 인용. 저작권법 §7 비보호 저작물이라 복제·재배포 자유.",
  inputSchema,
  handler,
};
