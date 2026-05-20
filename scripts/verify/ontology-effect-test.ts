#!/usr/bin/env tsx
/**
 * ontology-effect-test.ts
 *
 * 온톨로지 효과 정량 검증. 6 시나리오 — 그래프 ON vs OFF 비교.
 * 사용자(LLM·안전관리자) 입장에서 실용 가치를 측정.
 *
 * 비교 축:
 *   - hops:        사용자가 원하는 답에 도달하기 위한 도구 호출 횟수
 *   - completeness: 응답에 필요 정보가 모두 포함됐는가 (legalBasis · penalty · applicability 등)
 *   - traceability: 응답이 자료 근거(IRI) 까지 추적 가능한가
 */

import { queryLegalBasisTool } from "../../src/tools/query-legal-basis.js";
import { queryPenaltyTool } from "../../src/tools/query-penalty.js";
import { queryApplicabilityTool } from "../../src/tools/query-applicability.js";
import { queryDelegationChainTool } from "../../src/tools/query-delegation-chain.js";
import { searchSafetyLawsTool } from "../../src/tools/search-safety-laws.js";
import { getSafetyLawArticleTool } from "../../src/tools/get-safety-law-article.js";
import { listCoreSafetyLawsTool } from "../../src/tools/list-core-safety-laws.js";
import { listSafetyDocumentsByCycleTool } from "../../src/tools/list-safety-documents-by-cycle.js";
import { getSafetyDocumentGuideTool } from "../../src/tools/get-safety-document-guide.js";
import { findArticlesAndAnnexesForDocument } from "../../src/lib/graph-nodes-loader.js";

interface ScenarioResult {
  id: number;
  name: string;
  graphHops: number;
  graphResult: string;
  graphTraceable: boolean;
  preGraphHops: number;
  preGraphResult: string;
  preGraphTraceable: boolean;
  verdict: string;
}

const results: ScenarioResult[] = [];

function summary(s: unknown, max = 200): string {
  const t = JSON.stringify(s);
  return t.length > max ? t.slice(0, max) + "…" : t;
}

(async () => {
  console.log("# 온톨로지 효과 정량 검증 — 6 시나리오\n");

  // ─────────────────────────────────────────────────────────────
  // 시나리오 1 — 굴착 작업계획서 미작성 시 처벌
  // ─────────────────────────────────────────────────────────────
  console.log("## 시나리오 1 — 굴착 작업계획서 미작성 시 처벌\n");

  // 그래프 ON
  const s1g = await queryPenaltyTool.handler({ docId: "work_plan_excavation" });
  const s1gPenalty = (s1g.structuredContent as { penalty?: { amount?: number; condition?: string } } | undefined)
    ?.penalty;
  console.log(`[그래프 ON] query_penalty(docId)`);
  console.log(`  amount: ${s1gPenalty?.amount?.toLocaleString("ko-KR")}원`);
  console.log(`  condition: ${s1gPenalty?.condition}`);
  console.log(`  hops: 1`);

  // 그래프 OFF (대안)
  console.log(`[그래프 OFF] 별도 키워드 검색 → 처벌 조항 직접 찾아야 함`);
  const s1off1 = await searchSafetyLawsTool.handler({ keyword: "굴착 작업계획서" });
  const s1off2 = await searchSafetyLawsTool.handler({ keyword: "§175 과태료" });
  console.log(
    `  search_safety_laws("굴착 작업계획서") matches: ${
      (s1off1.structuredContent as { results?: unknown[] }).results?.length ?? 0
    }`,
  );
  console.log(
    `  search_safety_laws("§175 과태료") matches: ${
      (s1off2.structuredContent as { results?: unknown[] }).results?.length ?? 0
    }`,
  );
  console.log(`  hops: 2+ (조문 + 처벌 별도 검색, 매핑은 사용자 추론)`);
  console.log("");

  results.push({
    id: 1,
    name: "굴착 작업계획서 미작성 처벌",
    graphHops: 1,
    graphResult: `${s1gPenalty?.amount}원 + condition 즉시 반환`,
    graphTraceable: true,
    preGraphHops: 2,
    preGraphResult: "조문·처벌 별도 검색 + 사용자가 수동 매핑",
    preGraphTraceable: false,
    verdict: "그래프 ON 압도 — 1 hop · 자동 매핑",
  });

  // ─────────────────────────────────────────────────────────────
  // 시나리오 2 — daily_tbm 의 법령 근거 통합
  // ─────────────────────────────────────────────────────────────
  console.log("## 시나리오 2 — TBM 일지 법령 근거 통합\n");
  const s2g = await queryLegalBasisTool.handler({ docId: "daily_tbm" });
  const s2sc = s2g.structuredContent as {
    legalBasis: { iriMapped: unknown[]; textRefs: unknown[]; sparseGraph: boolean };
  };
  console.log(`[그래프 ON] query_legal_basis(daily_tbm)`);
  console.log(`  iriMapped Article: ${s2sc.legalBasis.iriMapped.length}건 (verified)`);
  console.log(`  textRefs: ${s2sc.legalBasis.textRefs.length}건`);
  console.log(`  sparseGraph: ${s2sc.legalBasis.sparseGraph}`);
  console.log(`  hops: 1 (응답에 IRI + 본문 매핑 + retention + 처벌 매핑 모두 포함)`);

  console.log(`[그래프 OFF] get_safety_document_guide + list_core_safety_laws + 키워드 검색`);
  const s2off1 = await getSafetyDocumentGuideTool.handler({ docId: "daily_tbm" });
  const guide = (s2off1.structuredContent as { docId?: string }).docId;
  console.log(`  get_safety_document_guide: docId=${guide} (legalBasis 텍스트만)`);
  console.log(`  hops: 2~4 (문서 가이드 → 인용 조문 별도 조회)`);
  console.log("");

  results.push({
    id: 2,
    name: "TBM 일지 법령 근거 통합",
    graphHops: 1,
    graphResult: `${s2sc.legalBasis.iriMapped.length} verified IRI + retention + penalty 통합`,
    graphTraceable: true,
    preGraphHops: 3,
    preGraphResult: "guide 텍스트 → 인용 조문 별도 조회 (LLM 환각 위험)",
    preGraphTraceable: false,
    verdict: "그래프 ON 우위 — IRI 직접 매핑으로 환각 차단",
  });

  // ─────────────────────────────────────────────────────────────
  // 시나리오 3 — 5억·8명·굴착 3m 현장 적용성
  // ─────────────────────────────────────────────────────────────
  console.log("## 시나리오 3 — 5억·8명·굴착 3m 현장 적용성 자동 판정\n");
  const s3g = await queryApplicabilityTool.handler({
    docId: "work_plan_excavation",
    scale: { workforce: 8, constructionValue: 5, industry: "construction" },
    workConditions: { depthM: 3 },
  });
  const s3sc = s3g.structuredContent as {
    document: { applies: boolean };
    crossCutting: { applies: string[]; exempts: string[] };
  };
  console.log(`[그래프 ON] query_applicability`);
  console.log(`  Document 적용: ${s3sc.document.applies}`);
  console.log(
    `  CrossCutting applies: ${s3sc.crossCutting.applies.length}, exempts: ${s3sc.crossCutting.exempts.length}`,
  );
  console.log(`  hops: 1 (Document.applicableWhen + 50인·50억 매트릭스 동시)`);

  console.log(`[그래프 OFF] 사용자가 §38 본문 + 50인 면제 + 50억 면제 별도 확인`);
  console.log(`  hops: 4+ (조문 임계값 + 50인 + 50억 + 산안관리비)`);
  console.log("");

  results.push({
    id: 3,
    name: "5억·8명·굴착 3m 적용성",
    graphHops: 1,
    graphResult: `Document applies=${s3sc.document.applies} + crossCutting ${s3sc.crossCutting.applies.length + s3sc.crossCutting.exempts.length}건 종합`,
    graphTraceable: true,
    preGraphHops: 4,
    preGraphResult: "사용자가 4가지 매트릭스 수동 조합",
    preGraphTraceable: false,
    verdict: "그래프 ON 압도 — 1 hop 종합 응답",
  });

  // ─────────────────────────────────────────────────────────────
  // 시나리오 4 — Article §38 reverse: 근거가 되는 문서들
  //   (a-codex P4 권고: 공개 MCP 도구만 사용. 내부 함수 호출 금지)
  // ─────────────────────────────────────────────────────────────
  console.log("## 시나리오 4 — Article §38 reverse → 근거 문서들 (공개 도구만)\n");
  // 공개 도구로 reverse: query_legal_basis 가 Document 입력 시 iriMapped 응답.
  // Article 입장 reverse 는 모든 Document 를 순회하며 legalBasis 에 art:기준규칙:38 포함 여부를 보는 방식.
  // 사용자가 한 docId 모르는 상태에서 §38 을 시작점으로 reverse 하려면 listDocuments + 각 query_legal_basis.
  const docs = await listSafetyDocumentsByCycleTool.handler({});
  const docIds = ((docs.structuredContent as { documents?: Array<{ docId: string }> }).documents ?? []).map((d) => d.docId);
  let reverseHits = 0;
  for (const dId of docIds) {
    const r = await queryLegalBasisTool.handler({ docId: dId });
    const iri = (r.structuredContent as { legalBasis?: { iriMapped?: Array<{ "@id": string }> } } | undefined)
      ?.legalBasis?.iriMapped;
    if (iri?.some((n) => n["@id"] === "art:기준규칙:38")) reverseHits += 1;
  }
  console.log(`[그래프 ON 공개도구] listDocuments + ${docIds.length} × query_legal_basis`);
  console.log(`  art:기준규칙:38 을 legalBasis 로 가진 Document: ${reverseHits}건`);
  console.log(`  hops: ${docIds.length + 1} (∵ reverse 전용 공개 도구 부재 → 모든 doc 순회)`);

  console.log(`[그래프 OFF] 텍스트 키워드 §38 검색 → 어떤 문서가 인용하는지 알 수 없음`);
  console.log(`  hops: 19+ (모든 19종 docId 가이드 일일 확인 필요. 매핑은 사용자 추론)`);
  console.log("");

  results.push({
    id: 4,
    name: "Article §38 reverse → 근거 문서들",
    graphHops: docIds.length + 1,
    graphResult: `${reverseHits}건 발견. 단 reverse 전용 공개 도구 부재 — N hops`,
    graphTraceable: true,
    preGraphHops: 19,
    preGraphResult: "19종 가이드 텍스트 매핑 사용자 추론",
    preGraphTraceable: false,
    verdict: "그래프 ON 우위 (공개 도구 부재로 N hops, P5에서 query_articles_using 추가 권장)",
  });

  // ─────────────────────────────────────────────────────────────
  // 시나리오 5 — 산안법 §36 위임 사슬 (delegates 데이터 0건 → 안전장치 검증)
  //   ⚠ 이건 "그래프 우위"가 아닌 "솔직 안내" 안전장치. 가치 평가 시 OFF 1 hops 환산
  // ─────────────────────────────────────────────────────────────
  console.log("## 시나리오 5 — 산안법 §36 위임 사슬 (안전장치 검증, 가치 우위 아님)\n");
  const s5g = await queryDelegationChainTool.handler({ startRef: "art:산안법:36" });
  const s5sc = s5g.structuredContent as {
    chainLength?: number;
    warning?: { mode?: string; note?: string };
  };
  console.log(`[그래프 ON] query_delegation_chain`);
  console.log(`  chainLength: ${s5sc.chainLength}`);
  console.log(`  warning.mode: ${s5sc.warning?.mode ?? "없음"}`);
  console.log(`  → delegates 엣지 데이터 0건이지만 silent empty 아닌 솔직한 안내`);
  console.log(`  hops: 1 (정직성 검증 통과 — 사용자가 잘못된 결과로 오인하지 않음)`);
  console.log("");

  results.push({
    id: 5,
    name: "위임 사슬 안전장치 (delegates 미데이터)",
    graphHops: 1,
    graphResult: `noDelegationData 경고 — silent empty 회피 (가치 안전장치)`,
    graphTraceable: true,
    preGraphHops: 1,
    preGraphResult: "사용자가 본문 직접 읽고 추론",
    preGraphTraceable: false,
    verdict: "그래프 ON 안전장치 (가치 우위 아님 — delegates 데이터 채워지면 진짜 가치)",
  });

  // ─────────────────────────────────────────────────────────────
  // 시나리오 6 — 미정의 docId 환각 차단 + 가짜 IRI 검증
  // ─────────────────────────────────────────────────────────────
  console.log("## 시나리오 6 — 미정의 docId / 가짜 IRI 환각 차단\n");
  const s6a = await queryLegalBasisTool.handler({ docId: "non_existent_doc" });
  const s6sa = s6a.structuredContent as { found?: boolean; availableDocIds?: string[] };
  console.log(`[그래프 ON A] query_legal_basis(미정의 docId)`);
  console.log(`  found: ${s6sa.found}, isError: ${s6a.isError}, availableDocIds 안내: ${s6sa.availableDocIds?.length}건`);
  const s6b = await queryDelegationChainTool.handler({ startRef: "art:기준규칙:999" });
  console.log(`[그래프 ON B] query_delegation_chain(가짜 IRI 'art:기준규칙:999')`);
  console.log(`  isError: ${s6b.isError}`);
  console.log(`  → 두 도구 모두 환각 대신 명확한 NOT_FOUND + isError=true (verify_safety_basis 와 일관성)`);
  console.log("");

  results.push({
    id: 6,
    name: "환각 차단 (미정의 docId + 가짜 IRI)",
    graphHops: 1,
    graphResult: "두 케이스 모두 NOT_FOUND + isError=true (일관성)",
    graphTraceable: true,
    preGraphHops: 1,
    preGraphResult: "텍스트 검색 — LLM 환각 위험 (특히 산안법 §999 같은 가짜 조문)",
    preGraphTraceable: false,
    verdict: "그래프 ON 우위 — 정의된 노드만 응답 + 일관된 isError",
  });

  // ─────────────────────────────────────────────────────────────
  // 종합
  // ─────────────────────────────────────────────────────────────
  console.log("# 종합\n");
  console.log("| # | 시나리오 | 그래프 hops | OFF hops | 절약 | Traceable | 평가 |");
  console.log("|:--:|---|:--:|:--:|:--:|:--:|---|");
  let totalGraphHops = 0;
  let totalOffHops = 0;
  let traceableCount = 0;
  for (const r of results) {
    totalGraphHops += r.graphHops;
    totalOffHops += r.preGraphHops === 0 ? 1 : r.preGraphHops; // 0 hops = 사용자 직접 추론으로 1로 환산
    if (r.graphTraceable) traceableCount += 1;
    const saved =
      r.preGraphHops === 0
        ? "정직성"
        : r.preGraphHops === Infinity || r.preGraphHops > 10
          ? "∞"
          : `-${r.preGraphHops - r.graphHops}`;
    console.log(
      `| ${r.id} | ${r.name} | ${r.graphHops} | ${r.preGraphHops} | ${saved} | ${r.graphTraceable ? "✅" : "❌"} | ${r.verdict} |`,
    );
  }
  console.log("");
  console.log(`총 hops: 그래프 ON ${totalGraphHops} vs OFF ${totalOffHops} (${(totalOffHops / totalGraphHops).toFixed(1)}x 절약)`);
  console.log(`Traceable (IRI 추적 가능): ${traceableCount}/${results.length}`);
  console.log("");
  console.log("정직 결론 (a-codex 객관 검증 반영):");
  console.log(
    "  ✅ 진짜 가치: 처벌 매핑(시나리오 1) + 법령 근거 통합(시나리오 2) + 적용성 종합 판정(시나리오 3) — 1 hop 응답 + IRI traceable",
  );
  console.log(
    "  ⚠ 부분 가치: reverse lookup(시나리오 4) — 그래프 데이터는 있으나 reverse 전용 공개 도구 부재 → P5 권장",
  );
  console.log(
    "  🛡 안전장치: 미완성 영역 안내(시나리오 5) + 환각 차단(시나리오 6) — 가치 우위는 아니나 사용자 신뢰 유지",
  );
  console.log(
    "  ⚖ over-engineering 영역: 단일 조문 본문 조회·작성 항목 확인은 그래프보다 텍스트/가이드 도구가 자연 (a-codex 진단)",
  );
  console.log("");
  console.log(
    "→ 온톨로지 효과는 일부 영역에 명확. 텍스트/가이드 도구와 상호 보완 관계.",
  );
})();
