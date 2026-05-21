/**
 * analyze_work_context
 *
 * Active Graph Authoring Loop (ADR 002) — 작업명/내용 입력 시 그래프 종합 컨텍스트 조립.
 *
 * 사용자가 A2UI 폼에서 작업명 (workName) 과 작업내용 (workContent) 을 입력하고
 * "이 작업의 위험·KOSHA·법령 보기" 버튼을 클릭하면, LLM 이 본 도구를 호출하여
 * 그래프 traversal 로 작업 맥락에 맞는 위험요인·통제·법령·KOSHA Guide 를 종합 조립한다.
 *
 * 본 도구는 다음 도구들의 조합 wrapper 가 아니라, A2UI 폼 통합용으로 결과를
 * a2uiUpdate 메시지로도 함께 반환하는 데 본질이 있다. LLM 이 별도로 각 도구를
 * 호출하지 않고도 폼에 즉시 동적 컴포넌트를 push 할 수 있다.
 *
 * 흐름 (결정론적):
 *   1. workName 토큰을 work_type / activity 노드 라벨과 매칭
 *   2. 매칭 work_type 의 hasHazard → hazards (또는 docId 의 hasHazard)
 *   3. hazards.mitigatedBy → controls (ERIC 정렬)
 *   4. docId 의 legalBasis → 법령 조문 (excerpt 200자)
 *   5. hazards.koshaArchiveFacets + work_type.guidedBy → 관련 KOSHA Guide
 *   6. workConditions (depth/height/voltage 등) → applicableWhen 평가
 *
 * 반환:
 *   - content: Markdown 컨텍스트 요약
 *   - structuredContent.a2uiUpdate: viewer 가 적용 가능한 updateComponents JSONL
 *   - nextActions: LLM 후속 도구 추천
 */
import { z } from "zod";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { graphRepository } from "../lib/graph-repository.js";
import { renderIri } from "../lib/iri-renderer.js";
import { extractArticleBody, extractAnnexBody } from "../lib/law-body-extractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// activities / work_types 인덱스 — 작업명 매칭용
const ACTIVITY_DIR = (() => {
  const candidates = [
    resolve(__dirname, "../ontology/graph/nodes/activities"),
    resolve(__dirname, "../../src/ontology/graph/nodes/activities"),
  ];
  for (const p of candidates) {
    try {
      readdirSync(p);
      return p;
    } catch {}
  }
  return null;
})();

const WORKTYPE_DIR = (() => {
  const candidates = [
    resolve(__dirname, "../ontology/graph/nodes/work_types"),
    resolve(__dirname, "../../src/ontology/graph/nodes/work_types"),
  ];
  for (const p of candidates) {
    try {
      readdirSync(p);
      return p;
    } catch {}
  }
  return null;
})();

const HAZARDS_DIR = (() => {
  const candidates = [
    resolve(__dirname, "../ontology/graph/nodes/hazards"),
    resolve(__dirname, "../../src/ontology/graph/nodes/hazards"),
  ];
  for (const p of candidates) {
    try {
      readdirSync(p);
      return p;
    } catch {}
  }
  return null;
})();

interface IndexedNode {
  iri: string;
  label: string;
  slug?: string;
  raw: Record<string, any>;
}

let ACTIVITY_INDEX: IndexedNode[] | null = null;
let WORKTYPE_INDEX: IndexedNode[] | null = null;

function loadDir(dir: string | null): IndexedNode[] {
  if (!dir) return [];
  const out: IndexedNode[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonld")) continue;
    try {
      const n = JSON.parse(readFileSync(join(dir, f), "utf8"));
      out.push({
        iri: String(n["@id"] ?? ""),
        label: String(n.label ?? n.title ?? ""),
        slug: n.slug,
        raw: n,
      });
    } catch {}
  }
  return out;
}

function loadActivityIndex(): IndexedNode[] {
  if (!ACTIVITY_INDEX) ACTIVITY_INDEX = loadDir(ACTIVITY_DIR);
  return ACTIVITY_INDEX;
}
function loadWorktypeIndex(): IndexedNode[] {
  if (!WORKTYPE_INDEX) WORKTYPE_INDEX = loadDir(WORKTYPE_DIR);
  return WORKTYPE_INDEX;
}

const inputSchema = z.object({
  docId: z.string().describe("작성 중 문서 docId (예: daily_tbm, work_plan_excavation)"),
  workName: z.string().describe("작업명 (예: '굴착 작업', '거푸집 해체', '용접')"),
  workContent: z
    .string()
    .optional()
    .describe("작업내용 상세 (선택, 토큰 매칭 강화)"),
  workConditions: z
    .record(z.unknown())
    .optional()
    .describe("작업 조건 (depthM·heightM·voltageV·confinedSpace 등 — applicableWhen 평가)"),
  surfaceId: z
    .string()
    .default("safety-form")
    .describe("A2UI surface ID"),
});

type Input = z.infer<typeof inputSchema>;

function matchByLabel(query: string, index: IndexedNode[], limit = 5): IndexedNode[] {
  const out: Array<{ node: IndexedNode; score: number }> = [];
  const tokens = query
    .toLowerCase()
    .split(/[\s,·\(\)\/]+/)
    .filter((t) => t.length >= 2);

  for (const n of index) {
    let score = 0;
    const labelLower = n.label.toLowerCase();
    const slugLower = (n.slug ?? "").toLowerCase();
    if (n.label === query) score += 100;
    else if (n.label.includes(query) || query.includes(n.label)) score += 50;
    for (const t of tokens) {
      if (labelLower.includes(t)) score += 10;
      if (slugLower.includes(t)) score += 8;
    }
    if (score > 0) out.push({ node: n, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((x) => x.node);
}

interface HazardSummary {
  iri: string;
  label: string;
  category?: string;
  mitigatedByIris: string[];
}

interface ControlSummary {
  iri: string;
  label: string;
  ericLevel: number;
}

const ERIC_LABELS: Record<number, string> = {
  1: "1.제거",
  2: "2.대체",
  3: "3.공학",
  4: "4.관리",
  5: "5.PPE",
};

// 결함 #2 (2026-05-22) — 도메인 외 입력 시그널 (scope.json 의 excluded 영역).
// 본 OSS 는 건설안전 한정 — 제조업·서비스업·화학공정·전기설비·농업 등은 별도 OSS 영역.
const OUT_OF_DOMAIN_KEYWORDS = [
  // 제조업·일반 산업
  "제조",
  "공장",
  "프레스",
  "사출",
  "전단기",
  "선반",
  "밀링",
  // 서비스·사무
  "서비스",
  "사무",
  "콜센터",
  "물류센터",
  "배송",
  // 화학·공정안전
  "PSM",
  "공정안전",
  "석유화학",
  "정유",
  "화학공정",
  // 농업·어업
  "농업",
  "농작",
  "어업",
  "어선",
  // 전기·정보통신 설비 (건설현장 가설전기 제외)
  "발전소",
  "변전소",
  "송전선",
  // 일반 보건
  "사무직",
];

function detectOutOfDomain(workName: string, workContent?: string): string | null {
  const text = `${workName} ${workContent ?? ""}`;
  for (const kw of OUT_OF_DOMAIN_KEYWORDS) {
    if (text.includes(kw)) return kw;
  }
  return null;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args: Input = inputSchema.parse(rawInput);
  await graphRepository.ensureBuilt();

  // 1. workName → activity / work_type 매칭
  const query = `${args.workName} ${args.workContent ?? ""}`.trim();
  const matchedActivities = matchByLabel(args.workName, loadActivityIndex(), 5);
  const matchedWorktypes = matchByLabel(args.workName, loadWorktypeIndex(), 5);

  // 결함 #2 — 도메인 외 입력 감지 (work_type/activity 매칭 0 + 도메인 외 키워드)
  const outOfDomainHit = detectOutOfDomain(args.workName, args.workContent);
  const noMatch = matchedActivities.length === 0 && matchedWorktypes.length === 0;
  const domainBoundary = outOfDomainHit || noMatch
    ? {
        outOfDomainSignal: outOfDomainHit ?? null,
        matchedActivities: matchedActivities.length,
        matchedWorktypes: matchedWorktypes.length,
        note:
          outOfDomainHit
            ? `입력 "${outOfDomainHit}" 가 건설안전 도메인 외 영역으로 추정됨 (scope.json excluded). 본 OSS 는 건설현장 안전관리 한정 — 제조·화학공정·서비스·농업·일반 산업기계는 별도 도메인 OSS (예: agent-machinery-safety) 영역.`
            : `workName "${args.workName}" 가 그래프의 어떤 work_type/activity 와도 매칭되지 않음. 건설안전 도메인 입력이 맞는지 확인 필요. 입력 예시: '거푸집 해체', '비계 설치', '굴착 작업', '타워크레인 신호', '용접 작업'.`,
      }
    : null;

  // 2. docId 기반 hazard / control / 법령 traversal
  const docNode = graphRepository.getDocument(args.docId) as Record<string, any> | undefined;
  const hazardIris = new Set<string>();
  const directControlIris = new Set<string>();
  const legalIris: string[] = [];
  const guideIris = new Set<string>();

  if (docNode) {
    for (const h of docNode.hasHazard ?? []) hazardIris.add(h);
    for (const c of docNode.mitigatedBy ?? []) directControlIris.add(c);
    for (const l of docNode.legalBasis ?? []) legalIris.push(l);
    for (const g of docNode.guidedBy ?? []) guideIris.add(g);
  }

  // 3. work_type 매칭에서 hazards / KOSHA guide 보강
  for (const wt of matchedWorktypes) {
    for (const h of wt.raw.hasHazard ?? []) hazardIris.add(h);
    for (const g of wt.raw.guidedBy ?? []) guideIris.add(g);
    for (const c of wt.raw.mitigatedBy ?? []) directControlIris.add(c);
  }

  // 4. hazards 노드 로드
  const hazards: HazardSummary[] = [];
  for (const iri of hazardIris) {
    const n = graphRepository.getNode(iri) as Record<string, any> | undefined;
    if (!n) continue;
    hazards.push({
      iri,
      label: String(n.label ?? iri),
      category: n.category,
      mitigatedByIris: n.mitigatedBy ?? [],
    });
  }

  // 5. controls 로드 (직접 + hazard 경유)
  const allControlIris = new Set<string>(directControlIris);
  for (const h of hazards) for (const c of h.mitigatedByIris) allControlIris.add(c);
  const controls: ControlSummary[] = [];
  for (const iri of allControlIris) {
    const n = graphRepository.getNode(iri) as Record<string, any> | undefined;
    if (!n) continue;
    controls.push({
      iri,
      label: String(n.label ?? n.title ?? iri),
      ericLevel: Number(n.ericLevel ?? 4),
    });
  }
  controls.sort((a, b) => a.ericLevel - b.ericLevel);

  // 6. 법령 본문 발췌 (200자)
  const legalArticles: Array<{ iri: string; name: string; excerpt?: string }> = [];
  await Promise.all(
    legalIris.map(async (l) => {
      let body: string | undefined;
      try {
        if (l.startsWith("art:")) body = await extractArticleBody(l, 200);
        else if (l.startsWith("annex:")) body = await extractAnnexBody(l, 200);
      } catch {}
      legalArticles.push({ iri: l, name: renderIri(l), excerpt: body });
    }),
  );

  // 7. KOSHA Guide 메타 로드
  const koshaGuides: Array<{ iri: string; guideNo?: string; title?: string }> = [];
  for (const iri of guideIris) {
    const n = graphRepository.getNode(iri) as Record<string, any> | undefined;
    if (!n) continue;
    koshaGuides.push({
      iri,
      guideNo: n._meta?.guideNo ?? iri.split("/").pop(),
      title: n.title ?? n.label,
    });
  }

  // 8. workConditions applicableWhen 평가 (간단 — depthM, heightM)
  const conditionWarnings: string[] = [];
  if (args.workConditions) {
    const depth = Number(args.workConditions.depthM ?? args.workConditions.workDepth ?? 0);
    const height = Number(args.workConditions.heightM ?? args.workConditions.workHeight ?? 0);
    if (depth >= 2)
      conditionWarnings.push(
        `굴착깊이 ${depth}m ≥ 2m — 산안기준규칙 §38 작업계획서·붕괴방호 룰 발동`,
      );
    if (height >= 2)
      conditionWarnings.push(
        `작업높이 ${height}m ≥ 2m — 산안기준규칙 §42 추락방호 (안전대·방호망) 룰 발동`,
      );
    if (args.workConditions.confinedSpace === true)
      conditionWarnings.push(`밀폐공간 작업 — 송기마스크·산소측정 룰 발동 (기준규칙 §618)`);
    if (args.workConditions.hotWork === true)
      conditionWarnings.push(`화기작업 — 작업허가서·소화기 룰 발동`);
  }

  // Markdown 조립
  const lines: string[] = [];
  lines.push(`# 📋 작업 컨텍스트 — "${args.workName}"`);
  lines.push("");
  if (args.workContent) lines.push(`> 내용: ${args.workContent}`);
  if (docNode) lines.push(`> 문서: ${docNode.title} (\`${args.docId}\`)`);
  lines.push("");

  // 결함 #2 — 도메인 외 입력 시그널 (상단 우선 노출)
  if (domainBoundary) {
    lines.push(`## ⚠️ 도메인 경계 신호`);
    lines.push(`> ${domainBoundary.note}`);
    lines.push("");
    if (domainBoundary.outOfDomainSignal) {
      lines.push(
        `본 OSS 는 **건설현장 안전관리** 한정 (scope.json). 결과 hazards/controls/법령 은 docId 의 기본 매핑이며 입력 작업과 직접 연관 없을 수 있습니다.`,
      );
      lines.push("");
    }
  }

  if (matchedWorktypes.length > 0 || matchedActivities.length > 0) {
    lines.push(`## 🔍 그래프 매칭`);
    if (matchedWorktypes.length > 0) {
      lines.push(`### 공종 (work_type) ${matchedWorktypes.length}건`);
      for (const wt of matchedWorktypes.slice(0, 3))
        lines.push(`- **${wt.label}** — \`${wt.iri}\``);
    }
    if (matchedActivities.length > 0) {
      lines.push(`### 활동 (activity) ${matchedActivities.length}건`);
      for (const a of matchedActivities.slice(0, 3))
        lines.push(`- **${a.label}** — \`${a.iri}\``);
    }
    lines.push("");
  }

  if (conditionWarnings.length > 0) {
    lines.push(`## ⚠️ 조건 기반 적용성 룰`);
    for (const w of conditionWarnings) lines.push(`- ${w}`);
    lines.push("");
  }

  if (hazards.length > 0) {
    lines.push(`## ⚠️ 식별 위험요인 ${hazards.length}건`);
    for (const h of hazards.slice(0, 10))
      lines.push(`- **${h.label}** [${h.category ?? "?"}] — \`${h.iri}\``);
    lines.push("");
  }

  if (controls.length > 0) {
    lines.push(`## 🛡 통제대책 ${controls.length}건 (ERIC 위계순)`);
    lines.push(`| 위계 | 대책 |`);
    lines.push(`|---|---|`);
    for (const c of controls.slice(0, 15)) {
      lines.push(`| ${ERIC_LABELS[c.ericLevel] ?? c.ericLevel} | ${c.label} |`);
    }
    lines.push("");
  }

  if (legalArticles.length > 0) {
    lines.push(`## 📜 법령근거`);
    for (const a of legalArticles.slice(0, 5)) {
      lines.push(`### ${a.name}`);
      if (a.excerpt) {
        lines.push("```");
        lines.push(a.excerpt);
        lines.push("```");
      }
    }
    lines.push("");
  }

  if (koshaGuides.length > 0) {
    lines.push(`## 📚 KOSHA Guide ${koshaGuides.length}건`);
    for (const g of koshaGuides.slice(0, 10))
      lines.push(`- ${g.guideNo ?? ""} ${g.title ?? "(제목 미상)"} — \`${g.iri}\``);
    lines.push("");
  }

  // A2UI updateComponents — info-card-context 패널을 폼에 push
  const cardId = `work-context-${Date.now()}-card`;
  const colId = `${cardId}-col`;
  const titleId = `${cardId}-title`;
  const summaryId = `${cardId}-summary`;
  const summaryText = [
    hazards.length > 0 ? `위험요인 ${hazards.length}건` : null,
    controls.length > 0 ? `통제대책 ${controls.length}건` : null,
    legalArticles.length > 0 ? `법령근거 ${legalArticles.length}건` : null,
    koshaGuides.length > 0 ? `KOSHA Guide ${koshaGuides.length}건` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const a2uiUpdate = [
    {
      updateComponents: {
        surfaceId: args.surfaceId,
        root: "root",
        components: [
          { id: cardId, component: "Card", child: colId },
          {
            id: colId,
            component: "Column",
            children: [titleId, summaryId],
          },
          {
            id: titleId,
            component: "Text",
            text: `📋 "${args.workName}" 그래프 컨텍스트`,
            usageHint: "h2",
          },
          {
            id: summaryId,
            component: "Text",
            text: summaryText || "(매칭 결과 없음 — workName 키워드 조정 권장)",
            usageHint: "body",
          },
        ],
      },
    },
  ];

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      docId: args.docId,
      workName: args.workName,
      matchedWorktypes: matchedWorktypes.map((w) => ({ iri: w.iri, label: w.label })),
      matchedActivities: matchedActivities.map((a) => ({ iri: a.iri, label: a.label })),
      hazards,
      controls,
      legalArticles,
      koshaGuides,
      conditionWarnings,
      // 결함 #2 — 도메인 경계 시그널 (null 이면 정상 매칭 / object 면 도메인 외 가능성)
      domainBoundary,
      a2uiUpdate,
      nextActions: [
        ...(hazards.length > 0
          ? [
              `suggest_controls_for_hazard({hazard, docId: "${args.docId}"}) — 식별된 hazard 별 통제대책 상세`,
            ]
          : []),
        ...(koshaGuides.length > 0
          ? [`get_kosha_guide_md({guideNo}) — KOSHA Guide 본문 조회`]
          : []),
        ...(legalArticles.length > 0
          ? [`get_safety_law_article({reference}) — 법령 조문 전문 조회`]
          : []),
        `compile_safety_references({workType: "${args.workName}", docType}) — 통합 자료 묶음`,
        `preview_review({docId: "${args.docId}", draft}) — 부분 검토`,
      ],
    },
  };
}

export const analyzeWorkContextTool: ToolDefinition = {
  name: "analyze_work_context",
  title: "작업명 → 그래프 종합 컨텍스트 (위험·통제·법령·KOSHA)",
  description:
    "A2UI 폼에서 사용자가 작업명·작업내용·작업조건을 입력하면 본 도구가 그래프 traversal 로 위험요인·통제대책·법령근거·KOSHA Guide·조건 기반 적용성 룰을 한 번에 조립한다. docId 의 hasHazard / mitigatedBy / legalBasis / guidedBy + workName 매칭 work_type/activity 의 hasHazard / guidedBy 를 합집합. workConditions (depthM·heightM·confinedSpace·hotWork) 기반 §38 §42 §618 등 적용성 룰 발동 자동 안내. ADR 002 Active Graph Authoring Loop 2단계 도구. 결정론적 (LLM 추측 0, 그래프 IRI 기반). 반환 structuredContent.a2uiUpdate 를 viewer 가 updateComponents 로 폼에 push. LLM 후속 도구 추천: suggest_controls_for_hazard / get_kosha_guide_md / get_safety_law_article / compile_safety_references / preview_review.",
  inputSchema,
  handler,
};
