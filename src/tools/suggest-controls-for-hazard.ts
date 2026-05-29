/**
 * suggest_controls_for_hazard
 *
 * Active Graph Authoring Loop (decision 002) — 위험요인 입력 시 통제대책 추천.
 *
 * 사용자가 A2UI 폼에서 위험요인 (hazard) 필드를 입력하고 "통제대책 추천" 버튼을 클릭하면,
 * LLM 이 본 도구를 호출하여 그래프 traversal 로 ERIC-PP 위계별 통제대책을 추천받는다.
 *
 * 흐름 (결정론적, LLM 추측 0):
 *   1. hazard 입력값 (IRI 또는 한국어 라벨) → graph node 매칭
 *      - IRI 직접 (hazard:fall_from_height) → 정확 매칭
 *      - 라벨 매칭 (label/slug 부분 일치)
 *   2. hazard 노드 mitigatedBy → control 노드들
 *   3. ERIC-PP 위계 (ericLevel 1-5) 정렬, 위계별 cap
 *   4. control 노드의 sourceRefs (KOSHA Guide·법령 출처) 동시 조립
 *   5. docId 가 주어지면 해당 문서에 이미 매핑된 control 과 비교 (직접/간접 표시)
 *
 * 반환:
 *   - content: Markdown 위계별 표
 *   - structuredContent.a2uiUpdate: viewer 가 적용 가능한 updateComponents JSONL
 *   - nextActions: LLM 후속 도구 추천
 */
import { z } from "zod";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { graphRepository } from "../lib/graph-repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
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
  throw new Error("hazards dir not found");
})();

let HAZARD_INDEX_CACHE: Array<Record<string, any>> | null = null;
function loadHazardIndex(): Array<Record<string, any>> {
  if (HAZARD_INDEX_CACHE) return HAZARD_INDEX_CACHE;
  const out: Array<Record<string, any>> = [];
  for (const f of readdirSync(HAZARDS_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    try {
      const n = JSON.parse(readFileSync(join(HAZARDS_DIR, f), "utf8"));
      out.push(n);
    } catch {}
  }
  HAZARD_INDEX_CACHE = out;
  return out;
}

const inputSchema = z.object({
  hazard: z
    .string()
    .describe("위험요인 입력값 — IRI (hazard:fall_from_height) 또는 한국어 라벨 ('추락', '굴착 사면 붕괴')"),
  docId: z
    .string()
    .optional()
    .describe("문서 docId (있으면 해당 문서의 직접 매핑 control 과 일반 추천 control 을 구분 표시)"),
  surfaceId: z
    .string()
    .default("safety-form")
    .describe("A2UI surface ID — a2uiUpdate 메시지에서 사용"),
  maxControls: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(12)
    .describe("표시할 통제대책 최대 개수 (ERIC 위계별 cap 적용)"),
});

type Input = z.infer<typeof inputSchema>;

interface HazardNode {
  iri: string;
  label: string;
  category?: string;
  description?: string;
  mitigatedBy: string[];
}

interface ControlInfo {
  iri: string;
  slug?: string;
  label: string;
  description?: string;
  ericLevel: number;
  ericLabel: string;
  controlLevel?: string;
  sourceRefs?: string[];
  isDirectForDoc?: boolean;
}

const ERIC_LEVEL_LABELS: Record<number, string> = {
  1: "1. 제거 (Elimination)",
  2: "2. 대체 (Substitution)",
  3: "3. 공학적 통제 (Engineering)",
  4: "4. 관리적 통제 (Administrative)",
  5: "5. 보호구 (PPE)",
};

// ERIC 위계별 cap — 상위 위계는 적게, 관리·공학은 많이
const TIER_CAP: Record<number, number> = { 1: 2, 2: 2, 3: 4, 4: 4, 5: 2 };

function findHazards(input: string): HazardNode[] {
  // 1) IRI 직접 매칭
  if (input.startsWith("hazard:")) {
    const node = graphRepository.getNode(input) as Record<string, any> | undefined;
    if (node) {
      return [
        {
          iri: input,
          label: String(node.label ?? input),
          category: node.category,
          description: node.description,
          mitigatedBy: node.mitigatedBy ?? [],
        },
      ];
    }
    return [];
  }
  // 2) 라벨/슬러그 부분 매칭 — hazards 디렉토리 스캔
  const out: HazardNode[] = [];
  const lower = input.toLowerCase();
  for (const n of loadHazardIndex()) {
    const iri = String(n["@id"] ?? "");
    if (!iri.startsWith("hazard:")) continue;
    const label = String(n.label ?? "");
    const slug = String(n.slug ?? "");
    if (
      (label && (label.includes(input) || input.includes(label))) ||
      (slug && slug.toLowerCase().includes(lower)) ||
      iri.toLowerCase().includes(lower)
    ) {
      out.push({
        iri,
        label,
        category: n.category,
        description: n.description,
        mitigatedBy: n.mitigatedBy ?? [],
      });
    }
  }
  // 우선순위: 정확 라벨 일치 > 부분 일치
  out.sort((a, b) => {
    const aExact = a.label === input ? 0 : 1;
    const bExact = b.label === input ? 0 : 1;
    return aExact - bExact;
  });
  return out;
}

function loadControls(hazards: HazardNode[], docControlIris: Set<string>): ControlInfo[] {
  const seen = new Set<string>();
  const controls: ControlInfo[] = [];
  for (const h of hazards) {
    for (const cIri of h.mitigatedBy) {
      if (seen.has(cIri)) continue;
      seen.add(cIri);
      const cNode = graphRepository.getNode(cIri) as Record<string, any> | undefined;
      if (!cNode) continue;
      const ericLevel = Number(cNode.ericLevel ?? 4);
      controls.push({
        iri: cIri,
        slug: cNode.slug,
        label: String(cNode.label ?? cNode.title ?? cIri),
        description: cNode.description,
        ericLevel,
        ericLabel: ERIC_LEVEL_LABELS[ericLevel] ?? `${ericLevel}. 기타`,
        controlLevel: cNode.controlLevel,
        sourceRefs: cNode.sourceRefs ?? [],
        isDirectForDoc: docControlIris.has(cIri),
      });
    }
  }
  return controls;
}

function selectByTierCap(controls: ControlInfo[], maxTotal: number): ControlInfo[] {
  const sorted = [...controls].sort((a, b) => {
    // 직접 매핑 우선 + ericLevel 오름차순
    if (a.isDirectForDoc && !b.isDirectForDoc) return -1;
    if (!a.isDirectForDoc && b.isDirectForDoc) return 1;
    return a.ericLevel - b.ericLevel;
  });
  const tierUsed: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const selected: ControlInfo[] = [];
  for (const c of sorted) {
    if (selected.length >= maxTotal) break;
    const cap = TIER_CAP[c.ericLevel] ?? 3;
    if ((tierUsed[c.ericLevel] ?? 0) >= cap) continue;
    selected.push(c);
    tierUsed[c.ericLevel] = (tierUsed[c.ericLevel] ?? 0) + 1;
  }
  return selected;
}

function buildA2UIUpdate(
  surfaceId: string,
  hazardLabel: string,
  controls: ControlInfo[],
): Array<Record<string, unknown>> {
  const cardId = `controls-${Date.now()}-card`;
  const colId = `${cardId}-col`;
  const titleId = `${cardId}-title`;
  const rows = controls.map((c, i) => ({
    id: `${cardId}-row-${i}`,
    component: "Text",
    text: `[${c.ericLabel}] ${c.label}${c.isDirectForDoc ? " ⭐" : ""}`,
    usageHint: "body",
  }));
  return [
    {
      updateComponents: {
        surfaceId,
        root: "root",
        components: [
          { id: cardId, component: "Card", child: colId },
          {
            id: colId,
            component: "Column",
            children: [titleId, ...rows.map((r) => r.id)],
          },
          {
            id: titleId,
            component: "Text",
            text: `🛡 "${hazardLabel}" 통제대책 추천 (ERIC-PP 위계)`,
            usageHint: "h2",
          },
          ...rows,
        ],
      },
    },
  ];
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args: Input = inputSchema.parse(rawInput);
  await graphRepository.ensureBuilt();

  // 결함 #1 (2026-05-22) — 빈 입력 silent fail 방지
  if (!args.hazard || args.hazard.trim().length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "[INVALID_INPUT] hazard 입력이 비어있습니다. IRI (예: 'hazard:fall_from_height') 또는 한국어 라벨 (예: '추락', '굴착 사면 붕괴') 을 입력하세요.",
        },
      ],
      isError: true,
      structuredContent: {
        hazard: args.hazard,
        matched: 0,
        controls: [],
        error: "empty_hazard",
        nextActions: [
          "analyze_work_context({docId, workName}) — 작업명 기반 hazard 자동 식별",
          "render_a2ui_form({docId}) 의 info-card.graphContext.hazards 에서 IRI 추출",
        ],
      },
    };
  }

  const hazards = findHazards(args.hazard);
  if (hazards.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `[NOT_FOUND] hazard="${args.hazard}" 그래프 매칭 노드 없음. IRI 또는 한국어 라벨 (예: '추락', '굴착 사면 붕괴') 확인.`,
        },
      ],
      structuredContent: {
        hazard: args.hazard,
        matched: 0,
        controls: [],
        nextActions: [
          "search_safety_materials({keyword}) 로 위험요인 키워드 검색",
          "get_measures_by_risk({hazardLabel}) — 폴백 매칭 도구",
        ],
      },
    };
  }

  // 문서 직접 매핑 control 수집
  const docControlIris = new Set<string>();
  if (args.docId) {
    const docNode = graphRepository.getDocument(args.docId) as Record<string, any> | undefined;
    if (docNode?.mitigatedBy) {
      for (const c of docNode.mitigatedBy) docControlIris.add(c);
    }
  }

  const allControls = loadControls(hazards, docControlIris);
  const selected = selectByTierCap(allControls, args.maxControls);

  // Markdown 조립
  const lines: string[] = [];
  lines.push(`# 🛡 통제대책 추천 — "${args.hazard}"`);
  lines.push("");
  lines.push(`> ERIC-PP 5계층 (제거 > 대체 > 공학 > 관리 > 보호구). ISO 45001:2018 §8.1.2.`);
  lines.push("");

  if (hazards.length === 1) {
    lines.push(`## 매칭 위험요인`);
    lines.push(`- **${hazards[0].label}** [${hazards[0].category ?? "?"}] — \`${hazards[0].iri}\``);
    if (hazards[0].description) lines.push(`  > ${hazards[0].description}`);
    lines.push("");
  } else {
    lines.push(`## 매칭 위험요인 ${hazards.length}건`);
    for (const h of hazards.slice(0, 5)) {
      lines.push(`- **${h.label}** [${h.category ?? "?"}] — \`${h.iri}\``);
    }
    lines.push("");
  }

  lines.push(`## 추천 통제대책 (총 ${allControls.length}개 중 위계별 ${selected.length}개 표시)`);
  lines.push("");
  if (selected.length === 0) {
    lines.push(`> (그래프 매핑된 control 없음 — hazard 노드의 mitigatedBy 보강 필요)`);
  } else {
    lines.push(`| 위계 | 대책 | 매핑 |`);
    lines.push(`|---|---|:---:|`);
    for (const c of selected) {
      const directMark = c.isDirectForDoc ? "직접 ⭐" : "—";
      lines.push(`| ${c.ericLabel} | ${c.label} | ${directMark} |`);
    }
  }
  lines.push("");

  if (selected.some((c) => c.sourceRefs && c.sourceRefs.length > 0)) {
    lines.push(`## 출처 IRI`);
    for (const c of selected) {
      if (c.sourceRefs && c.sourceRefs.length > 0) {
        lines.push(`- **${c.label}**: ${c.sourceRefs.slice(0, 3).join(" · ")}`);
      }
    }
    lines.push("");
  }

  const hazardLabel = hazards[0]?.label ?? args.hazard;
  const a2uiUpdate = buildA2UIUpdate(args.surfaceId, hazardLabel, selected);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      hazard: args.hazard,
      docId: args.docId,
      matchedHazards: hazards.map((h) => ({ iri: h.iri, label: h.label, category: h.category })),
      controls: selected,
      totalControlsAvailable: allControls.length,
      a2uiUpdate,
      nextActions: [
        "사용자가 입력 필드에 추천 control 의 label 을 채우도록 안내 (LLM 이 updateDataModel 로 자동 채우기 가능)",
        `get_ppe_by_task — 보호구 (PPE) 위계 통제대책일 때 구체적 보호구 추가`,
        `get_kosha_guide_md — 통제대책 관련 KOSHA Guide 본문 조회`,
        `preview_review({docId, draft}) — 위험·통제 작성 후 부분 검토`,
      ],
    },
  };
}

export const suggestControlsForHazardTool: ToolDefinition = {
  name: "suggest_controls_for_hazard",
  title: "위험요인 → 통제대책 추천 (ERIC-PP 위계)",
  description:
    "A2UI 폼에서 위험요인 (hazard) 입력 후 본 도구 호출 → 그래프 mitigatedBy traversal 로 ERIC-PP 위계 (제거·대체·공학·관리·PPE) 정렬 통제대책 추천. docId 입력 시 해당 문서에 이미 직접 매핑된 control 을 우선 표시. decision 002 Active Graph Authoring Loop 2단계 도구. 결정론적 (그래프 IRI 기반, LLM 추측 0). 반환 structuredContent.a2uiUpdate 를 viewer 가 updateComponents 로 폼에 push 가능. LLM 후속 도구 추천: get_ppe_by_task / get_kosha_guide_md / preview_review.",
  inputSchema,
  handler,
};
