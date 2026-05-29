/**
 * assemble_doc_context
 *
 * docId 하나로 그래프를 traversal 하여 법정문서 작성에 필요한 모든 컨텍스트를 결정론적으로 조립한다.
 * LLM 추측 없이 그래프에서 직접 도출:
 *   - Document 메타 (마스터 SSoT 라이프사이클 8 키 포함)
 *   - 법령근거 → Article 노드 본문
 *   - 위험요인 → Hazard 노드 (category·description)
 *   - 통제수단 → Control 노드 (controlLevel·ericLevel)
 *   - 공식 양식 → Annex 노드 (annexNumber·annexKind)
 *   - 연계 문서 → 다른 Document 노드 (제목·docId·cycle)
 *   - 라이프사이클 (제출처·마감·전자제출·다음 작성일)
 *
 * 이 도구가 동작한다는 것이 그래프가 "법정문서 작동에 충분"하다는 검증.
 */
import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import { findDoc } from "../lib/master-loader.js";
import { graphRepository } from "../lib/graph-repository.js";

// v1.3.0 P0-3 (외부 평가): 자체 nodeCache·locateNodesDir·loadJsonldRecursive 제거.
// graphRepository SSoT 사용 — get-measures-by-risk, field-safety-briefing 등과
// 같은 graph view 보장 (도구별 결과 일관성).
function getNode(iri: string): any | undefined {
  return graphRepository.getNode(iri);
}

interface AssembledContext {
  document: {
    docId: string;
    title: string;
    iri: string;
    description?: string;
    category: string;
    cycle: string | null;
    iso45001Class: string | null;
    purpose: string | null;
    completenessScore: number; // 0-7
  };
  legalBasis: Array<{
    iri: string;
    found: boolean;
    articleNumber?: string;
    title?: string;
    description?: string;
    legislationIdentifier?: string;
    excerpt?: string;
  }>;
  legalBasisExternal: string[];
  hazards: Array<{
    iri: string;
    found: boolean;
    label?: string;
    category?: string;
    description?: string;
    iso45001Class?: string;
  }>;
  controls: Array<{
    iri: string;
    found: boolean;
    via?: "direct";
    label?: string;
    controlLevel?: string;
    ericLevel?: string;
  }>;
  // 2-hop indirect controls (doc → hasHazard → mitigatedBy)
  // LLM 이 hazard 경유 traversal 사슬을 직접 볼 수 있도록 분리 노출.
  controlsViaHazards: Array<{
    iri: string;
    found: boolean;
    via: "hazard";
    viaHazard?: string;
    label?: string;
    controlLevel?: string;
    ericLevel?: string;
  }>;
  annex: {
    iri: string | null;
    found: boolean;
    annexNumber?: string;
    annexKind?: string;
    title?: string;
  };
  relatedDocs: Array<{
    iri: string;
    found: boolean;
    docId?: string;
    title?: string;
    cycle?: string;
  }>;
  // v1.5.0: KOSHA Guide 자동 노출 (guidedBy edge traversal)
  // 안전관리자가 작성 시점에 어떤 KOSHA 기술지원규정을 참고해야 하는지 LLM 이 즉시 발견 가능.
  koshaGuides: Array<{
    iri: string;
    found: boolean;
    guideNo?: string;
    title?: string;
    category?: string;
    publishedBy?: string;
    bodyAvailable?: boolean; // get_kosha_guide_md 로 본문 조회 가능 여부
  }>;
  lifecycle: {
    submitTo: string | null;
    submitDeadline: string | null;
    electronicSubmission: any;
    retention: string | null;
    nextDueRule: string | null;
    penaltyOnMissing: string;
  };
  requiredFields: Array<{
    key: string;
    label: string;
    inputGuide?: string;
    examples?: string[];
    source?: string;
  }>;
  meta: {
    totalReferences: number;
    resolvedReferences: number;
    unresolvedRefs: string[];
  };
}

const inputSchema = z.object({
  docId: z.string().describe("법정문서 docId (예: daily_tbm, industrial_accident_report)"),
  includeArticleBody: z.boolean().default(false).describe("Article 본문 전체 포함 (기본 false — 발췌만)"),
});


function computeScore(doc: any): number {
  let s = 0;
  if (doc.legalBasis || doc.legalBasisExternal) s++;
  if (doc.hasHazard) s++;
  if (doc.mitigatedBy) s++;
  if (doc.annexReference) s++;
  if (doc.guidedBy) s++;
  if (doc.relatedDocs) s++;
  if (doc.iso45001Class) s++;
  return s;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const args = inputSchema.parse(rawInput);
  // v1.3.0 P0-3: graphRepository SSoT 사용 — 자체 readdirSync 제거
  await graphRepository.ensureBuilt();

  // 1. Document 노드 — graphRepository 단일 SSoT
  const docNode: any = graphRepository.getDocument(args.docId);
  if (!docNode) {
    return {
      content: [{ type: "text", text: `[NOT_FOUND] docId="${args.docId}" 노드 없음` }],
      isError: true,
      structuredContent: { docId: args.docId, found: false },
    };
  }

  const masterDoc = findDoc(args.docId);
  const unresolved: string[] = [];

  // 2. legalBasis Article 노드 traversal
  const legalBasisIris = asArray<string>(docNode.legalBasis);
  const legalBasis = legalBasisIris.map((iri) => {
    const n = getNode(iri);
    if (!n) {
      unresolved.push(iri);
      return { iri, found: false };
    }
    return {
      iri,
      found: true,
      articleNumber: n.articleNumber,
      title: n.title,
      description: args.includeArticleBody ? n.description : undefined,
      legislationIdentifier: n.legislationIdentifier,
      // excerpt 는 includeArticleBody=false 인 환경에서도 LLM 이 빠르게 훑을 수 있도록 500자 발췌만.
      // 본문 전체는 description 에 includeArticleBody=true 일 때만 들어간다.
      excerpt: typeof n.description === "string" ? n.description.slice(0, 500) : undefined,
    };
  });

  // 3. Hazard — description 자르지 않고 전체 보존 (viewer/LLM 이 알아서 잘라쓰도록)
  const hazardIris = asArray<string>(docNode.hasHazard);
  const hazards = hazardIris.map((iri) => {
    const n = getNode(iri);
    if (!n) {
      unresolved.push(iri);
      return { iri, found: false };
    }
    return {
      iri,
      found: true,
      label: n.label,
      category: n.category,
      description: typeof n.description === "string" ? n.description : undefined,
      iso45001Class: n.iso45001Class,
    };
  });

  // 4. Direct Control (1-hop: doc → mitigatedBy)
  const directControlIris = asArray<string>(docNode.mitigatedBy);
  const controls = directControlIris.map((iri) => {
    const n = getNode(iri);
    if (!n) {
      unresolved.push(iri);
      return { iri, found: false, via: "direct" as const };
    }
    return {
      iri,
      found: true,
      via: "direct" as const,
      label: n.label ?? n.title,
      controlLevel: n.controlLevel,
      ericLevel: n.ericLevel,
    };
  });

  // 4b. Controls via Hazards (2-hop: doc → hasHazard → mitigatedBy)
  // 직접 control 외에, 연결된 hazard 가 가리키는 control 도 노출. LLM 이 의미적 사슬 따라가도록.
  const seenControl = new Set(directControlIris);
  const controlsViaHazards: Array<{
    iri: string;
    found: boolean;
    via: "hazard";
    viaHazard?: string;
    label?: string;
    controlLevel?: string;
    ericLevel?: string;
  }> = [];
  for (const hzIri of hazardIris) {
    const hzNode = getNode(hzIri);
    const hzControlIris = asArray<string>(hzNode?.mitigatedBy);
    for (const cIri of hzControlIris) {
      if (seenControl.has(cIri)) continue;
      seenControl.add(cIri);
      const cn = getNode(cIri);
      if (!cn) {
        unresolved.push(cIri);
        controlsViaHazards.push({ iri: cIri, found: false, via: "hazard", viaHazard: hzIri });
        continue;
      }
      controlsViaHazards.push({
        iri: cIri,
        found: true,
        via: "hazard",
        viaHazard: hzIri,
        label: cn.label ?? cn.title,
        controlLevel: cn.controlLevel,
        ericLevel: cn.ericLevel,
      });
    }
  }

  // 5. Annex (양식)
  const annexIris = asArray<string>(docNode.annexReference);
  const annexIri = annexIris[0] ?? null;
  const annexNode = annexIri ? getNode(annexIri) : null;
  if (annexIri && !annexNode) unresolved.push(annexIri);
  const annex = {
    iri: annexIri,
    found: !!annexNode,
    annexNumber: annexNode?.annexNumber,
    annexKind: annexNode?.annexKind,
    title: annexNode?.title,
  };

  // 6. relatedDocs
  const relatedIris = asArray<string>(docNode.relatedDocs);
  const relatedDocs = relatedIris.map((iri) => {
    const n = getNode(iri);
    if (!n) {
      unresolved.push(iri);
      return { iri, found: false };
    }
    return {
      iri,
      found: true,
      docId: n.docId,
      title: n.title,
      cycle: n.cycle,
    };
  });

  // 6-2. KOSHA Guide traversal (v1.5.0 — guidedBy edge SSoT)
  // 작성 시점에 어떤 KOSHA 기술지원규정을 참고해야 하는지 LLM 이 즉시 발견.
  // 본문 조회 가능 여부 (bodyAvailable) 명시 → LLM 이 get_kosha_guide_md 호출 우선순위 결정 가능.
  const guidedByIris = asArray<string>(docNode.guidedBy);
  const koshaGuides = guidedByIris
    .filter((iri) => typeof iri === "string" && iri.startsWith("doc:kosha_guide/"))
    .map((iri) => {
      const g = getNode(iri);
      if (!g) {
        unresolved.push(iri);
        return { iri, found: false };
      }
      const meta = (g._meta ?? {}) as Record<string, any>;
      return {
        iri,
        found: true,
        guideNo: meta.guideNo,
        title: g.title,
        category: meta.guideCategory,
        publishedBy: meta.publishedBy,
        bodyAvailable: true, // 1,039 본문 100% 보유 (v1.4.2)
      };
    });

  // 7. 작성 항목 — requiredFields + sections.fields 통합 (폼 전체와 동일)
  const allFields: Array<{ key: string; label: string; inputGuide?: string; examples?: string[]; source?: string; section?: string }> = [];
  if (Array.isArray(docNode.requiredFields)) {
    for (const f of docNode.requiredFields) {
      if (f && typeof f === "object" && (f.key || f.label)) {
        allFields.push({
          key: f.key,
          label: f.label,
          inputGuide: f.inputGuide,
          examples: f.examples,
          source: f.source,
        });
      }
    }
  }
  if (Array.isArray(docNode.sections)) {
    for (const sec of docNode.sections) {
      const fields = Array.isArray(sec?.fields) ? sec.fields : [];
      for (const f of fields) {
        if (f && typeof f === "object" && (f.key || f.label)) {
          allFields.push({
            key: f.key,
            label: f.label,
            inputGuide: f.inputGuide,
            examples: f.examples,
            source: f.source,
            section: sec.title,
          });
        }
      }
    }
  }
  // 중복 제거 (label 기준)
  const seen = new Set<string>();
  const requiredFields = allFields.filter((f) => {
    const k = f.label || f.key;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 8. 라이프사이클 (마스터 SSoT)
  const lifecycle = {
    submitTo: masterDoc?.submitTo ?? null,
    submitDeadline: masterDoc?.submitDeadline ?? null,
    electronicSubmission: masterDoc?.electronicSubmission ?? null,
    retention: masterDoc?.retention ?? null,
    nextDueRule: masterDoc?.nextDueRule ?? null,
    penaltyOnMissing: masterDoc?.penaltyOnMissing ?? "(미정의)",
  };

  const ctx: AssembledContext = {
    document: {
      docId: docNode.docId,
      title: docNode.title,
      iri: docNode["@id"],
      description: docNode.description,
      category: masterDoc?.category ?? "(unknown)",
      cycle: docNode.cycle ?? null,
      iso45001Class: docNode.iso45001Class ?? null,
      purpose: masterDoc?.purpose ?? null,
      completenessScore: computeScore(docNode),
    },
    legalBasis,
    legalBasisExternal: asArray<string>(docNode.legalBasisExternal),
    hazards,
    controls, // 1-hop direct controls (doc → mitigatedBy)
    controlsViaHazards, // 2-hop indirect controls (doc → hasHazard → mitigatedBy)
    annex,
    relatedDocs,
    koshaGuides,
    lifecycle,
    requiredFields,
    meta: {
      totalReferences: legalBasis.length + hazards.length + controls.length + controlsViaHazards.length + (annexIri ? 1 : 0) + relatedDocs.length + koshaGuides.length,
      // decision 005: koshaGuides 가 totalReferences 에는 포함되는데 resolved 에 누락되어
      // "33/47 ✅" 같은 모순(14건=koshaGuides 누락) 발생 → resolved 에도 합산.
      resolvedReferences:
        legalBasis.filter((x) => x.found).length +
        hazards.filter((x) => x.found).length +
        controls.filter((x) => x.found).length +
        controlsViaHazards.filter((x) => x.found).length +
        (annex.found ? 1 : 0) +
        relatedDocs.filter((x) => x.found).length +
        koshaGuides.filter((x) => x.found).length,
      unresolvedRefs: unresolved,
    },
  };

  // 텍스트 출력
  const lines: string[] = [];
  lines.push(`# ${ctx.document.title}`);
  lines.push("");
  lines.push(`> ${ctx.document.purpose ?? "(목적 미정의)"}`);
  lines.push("");
  lines.push(`**docId**: \`${ctx.document.docId}\` · **그래프 점수**: ${ctx.document.completenessScore}/7 · **카테고리**: ${ctx.document.category}`);
  lines.push(`**ISO 45001**: ${ctx.document.iso45001Class ?? "(미매핑)"} · **주기**: ${ctx.document.cycle ?? "?"}`);
  lines.push("");

  if (ctx.legalBasis.length > 0 || ctx.legalBasisExternal.length > 0) {
    lines.push(`## 📜 법령근거 (${ctx.legalBasis.length + ctx.legalBasisExternal.length})`);
    lines.push("");
    for (const a of ctx.legalBasis) {
      if (!a.found) {
        lines.push(`- ❌ \`${a.iri}\` (그래프 미존재)`);
      } else {
        lines.push(`- ✅ **${a.legislationIdentifier} §${a.articleNumber} ${a.title}**`);
        if (a.excerpt) lines.push(`  > ${a.excerpt}`);
      }
    }
    for (const e of ctx.legalBasisExternal) {
      lines.push(`- 🔗 \`${e}\` (외부 인용)`);
    }
    lines.push("");
  }

  if (ctx.hazards.length > 0) {
    lines.push(`## ⚠️ 위험요인 (${ctx.hazards.length})`);
    lines.push("");
    for (const h of ctx.hazards) {
      if (!h.found) lines.push(`- ❌ \`${h.iri}\` (미존재)`);
      else lines.push(`- **${h.label}** [${h.category}] — \`${h.iri}\``);
    }
    lines.push("");
  }

  if (ctx.controls.length > 0) {
    lines.push(`## 🛡 통제수단 (${ctx.controls.length})`);
    lines.push("");
    for (const c of ctx.controls) {
      if (!c.found) lines.push(`- ❌ \`${c.iri}\` (미존재)`);
      else lines.push(`- **${c.label}** [${c.controlLevel ?? c.ericLevel ?? "?"}] — \`${c.iri}\``);
    }
    lines.push("");
  }

  if (ctx.annex.iri) {
    lines.push(`## 📄 공식 양식`);
    lines.push("");
    if (ctx.annex.found) {
      lines.push(`- ${ctx.annex.annexKind} 제${ctx.annex.annexNumber}호 — ${ctx.annex.title}`);
      lines.push(`  - IRI: \`${ctx.annex.iri}\``);
    } else {
      lines.push(`- ❌ \`${ctx.annex.iri}\` (미존재)`);
    }
    lines.push("");
  }

  if (ctx.relatedDocs.length > 0) {
    lines.push(`## 🔗 연계 문서 (${ctx.relatedDocs.length})`);
    lines.push("");
    for (const r of ctx.relatedDocs.slice(0, 10)) {
      if (!r.found) lines.push(`- ❌ \`${r.iri}\``);
      else lines.push(`- ${r.title} (\`${r.docId}\`, ${r.cycle ?? "?"})`);
    }
    lines.push("");
  }

  lines.push(`## 📤 라이프사이클 (제출·보관)`);
  lines.push("");
  lines.push(`- **제출처**: ${ctx.lifecycle.submitTo ?? "?"}`);
  lines.push(`- **마감**: ${ctx.lifecycle.submitDeadline ?? "?"}`);
  if (ctx.lifecycle.electronicSubmission?.available) {
    lines.push(`- **전자제출**: ✅ ${ctx.lifecycle.electronicSubmission.url}`);
  }
  lines.push(`- **보관**: ${ctx.lifecycle.retention ?? "?"}`);
  lines.push(`- **다음 작성**: ${ctx.lifecycle.nextDueRule ?? "?"}`);
  lines.push(`- **위반 처벌**: ${ctx.lifecycle.penaltyOnMissing}`);
  lines.push("");

  if (ctx.requiredFields.length > 0) {
    lines.push(`## 📝 작성 필드 (${ctx.requiredFields.length})`);
    lines.push("");
    for (const f of ctx.requiredFields.slice(0, 8)) {
      lines.push(`- **${f.label}** (\`${f.key}\`)`);
      if (f.inputGuide) lines.push(`  - 가이드: ${f.inputGuide}`);
      if (f.examples?.length) lines.push(`  - 예: ${f.examples.slice(0, 2).join(" / ")}`);
    }
    if (ctx.requiredFields.length > 8) lines.push(`  ... 외 ${ctx.requiredFields.length - 8}개 필드`);
    lines.push("");
  }

  lines.push("---");
  lines.push(`> 그래프 traversal 결과: ${ctx.meta.resolvedReferences}/${ctx.meta.totalReferences} 참조 해결 ${ctx.meta.unresolvedRefs.length === 0 ? "✅" : "⚠️ " + ctx.meta.unresolvedRefs.length + "건 미해결"}`);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: ctx as unknown as Record<string, unknown>,
  };
}

export const assembleDocContextTool: ToolDefinition = {
  name: "assemble_doc_context",
  title: "법정문서 그래프 컨텍스트 조립",
  description:
    "docId 하나로 그래프를 traversal 하여 작성에 필요한 모든 컨텍스트(법령근거·위험·통제·양식·연계문서·라이프사이클·필드)를 결정론적으로 조립한다. LLM 추측 없이 그래프에서 직접 도출. 그래프 무결성 검증 도구이자 법정문서 작성 지원의 핵심.",
  inputSchema,
  handler,
};
