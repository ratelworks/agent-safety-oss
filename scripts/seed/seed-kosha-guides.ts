#!/usr/bin/env tsx
/**
 * seed-kosha-guides.ts
 *
 * KOSHA Live API (data.go.kr 15144147) 실측 메타 시드.
 *
 * P16 — 환각 정정: 이전 31개 시드(C-39-2021/G-141-2019 등)는 모두
 * KOSHA 공식 카탈로그에 존재하지 않는 가공 번호였음. KOSHA Live API
 * 1039건을 검증하여 도메인 핵심 30개로 재시드.
 *
 * verificationStatus: "kosha_live_verified" — relay /api/kosha-guides 호출로
 * techGdlnNo + techGdlnNm 일치 확인.
 */

import { writeFile, readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const GUIDES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents", "guides");
const ACTIVITIES_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "activities");
const DOCUMENTS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

interface GuideSeed {
  guideNo: string; // 실 KOSHA techGdlnNo (예: "C-103-2014")
  title: string;   // 실 KOSHA techGdlnNm
  category: "construction" | "electric" | "machine" | "chemical" | "health" | "general";
  activities: string[]; // 관련 Activity IRI
  documents: string[];  // 관련 Document IRI (work-plan-excavation 등)
}

// KOSHA Live API 1039건 검증된 핵심 30개 (2026-04-26 fetch)
const GUIDES: GuideSeed[] = [
  // ── 굴착·토공·흙막이·발파·옹벽 (work_plan_excavation 핵심) ──
  { guideNo: "C-103-2014", title: "굴착공사 계측관리 기술지침",
    category: "construction",
    activities: ["activity:excavation_2m_plus"],
    documents: ["doc:ad_hoc/work_plan_excavation"] },
  { guideNo: "D-C-1-2025", title: "흙막이공사에 대한 기술지원규정",
    category: "construction",
    activities: ["activity:excavation_2m_plus"],
    documents: ["doc:ad_hoc/work_plan_excavation"] },
  { guideNo: "D-C-5-2025", title: "굴착면 안전기울기 기준에 관한 기술지원규정",
    category: "construction",
    activities: ["activity:excavation_2m_plus"],
    documents: ["doc:ad_hoc/work_plan_excavation"] },
  { guideNo: "D-C-11-2026", title: "굴착 및 토공 안전작업에 관한 기술지원규정",
    category: "construction",
    activities: ["activity:excavation_2m_plus"],
    documents: ["doc:ad_hoc/work_plan_excavation"] },
  { guideNo: "G-29-2011", title: "굴착작업시 지하 매설물 위험방지를 위한 기술지침",
    category: "general",
    activities: ["activity:excavation_2m_plus"],
    documents: ["doc:ad_hoc/work_plan_excavation"] },
  { guideNo: "D-C-4-2025", title: "굴착기 안전보건작업 기술지원규정",
    category: "construction",
    activities: ["activity:excavation_2m_plus"],
    documents: [] },
  { guideNo: "D-C-6-2025", title: "발파공사 기술지원규정",
    category: "construction",
    activities: [],
    documents: [] },
  { guideNo: "C-68-2012", title: "블록식 보강토 옹벽 공사 안전보건작업 지침",
    category: "construction",
    activities: [],
    documents: [] },
  { guideNo: "C-78-2016", title: "옹벽(콘크리트 옹벽)공사의 안전보건작업지침",
    category: "construction",
    activities: [],
    documents: [] },

  // ── 추락·방호·작업발판·비계·해체 ──
  { guideNo: "A-G-1-2025", title: "추락방호망 설치 기술지원규정(수직형 추락방망 설치 기술지원규정 포함)",
    category: "general",
    activities: ["activity:bridge_5m_30m"],
    documents: [] },
  { guideNo: "A-G-4-2025", title: "이동식 사다리의 사용에 관한 기술지원규정",
    category: "general",
    activities: [],
    documents: [] },
  { guideNo: "C-49-2012", title: "안전대 사용지침",
    category: "construction",
    activities: [],
    documents: [] },
  { guideNo: "D-C-7-2026", title: "비계 구조 및 안전작업에 관한 기술지원규정",
    category: "construction",
    activities: [],
    documents: ["doc:ad_hoc/work_plan"] },
  { guideNo: "D-C-8-2026", title: "작업발판 일체형 거푸집(갱폼, 시스템폼, 슬립폼) 안전작업에 관한 기술지원규정",
    category: "construction",
    activities: [],
    documents: [] },
  { guideNo: "D-C-9-2026", title: "거푸집 및 동바리 안전작업에 관한 기술지원규정",
    category: "construction",
    activities: [],
    documents: ["doc:ad_hoc/work_plan"] },
  { guideNo: "D-C-15-2026", title: "콘크리트공사(단순 슬래브 포함) 안전작업에 관한 기술지원규정",
    category: "construction",
    activities: [],
    documents: [] },
  { guideNo: "C-47-2023", title: "해체공사 안전보건작업 기술지침",
    category: "construction",
    activities: ["activity:demolition"],
    documents: [] },

  // ── 양중·크레인 ──
  { guideNo: "B-M-7-2025", title: "양중기 일반 안전에 관한 기술지원규정",
    category: "machine",
    activities: ["activity:tower_crane"],
    documents: [] },
  { guideNo: "B-M-8-2025", title: "이동식 크레인 안전보건작업 기술지원규정",
    category: "machine",
    activities: ["activity:tower_crane"],
    documents: [] },
  { guideNo: "D-C-10-2026", title: "건설장비(이동식크레인, 항타기 및 항발기, 타워크레인) 작업계획서 작성에 관한 기술지원규정",
    category: "construction",
    activities: ["activity:tower_crane"],
    documents: [] },
  { guideNo: "M-82-2011", title: "타워크레인의 설치.조립.해체작업에 관한 기술지침",
    category: "machine",
    activities: ["activity:tower_crane"],
    documents: [] },
  { guideNo: "M-91-2012", title: "타워크레인의 지지.고정 및 운전에 관한 기술지침",
    category: "machine",
    activities: ["activity:tower_crane"],
    documents: [] },

  // ── 전기 ──
  { guideNo: "B-E-7-2025", title: "건설현장의 전기설비 설치 및 관리에 관한 기술지원규정",
    category: "electric",
    activities: ["activity:electric_work_50v_plus"],
    documents: [] },
  { guideNo: "B-E-10-2026", title: "정전전로 및 그 인근에서의 전기작업에 관한 기술지원규정",
    category: "electric",
    activities: ["activity:electric_work_50v_plus"],
    documents: [] },
  { guideNo: "B-E-11-2026", title: "충전전로 및 그 인근에서의 전기작업에 관한 기술지원규정",
    category: "electric",
    activities: ["activity:electric_work_50v_plus"],
    documents: [] },
  { guideNo: "B-E-12-2026", title: "전기작업안전에 관한 기술지원규정",
    category: "electric",
    activities: ["activity:electric_work_50v_plus"],
    documents: [] },
  { guideNo: "B-E-14-2026", title: "감전방지용 누전차단기 설치에 관한 기술지원규정",
    category: "electric",
    activities: ["activity:electric_work_50v_plus"],
    documents: [] },

  // ── 화기·용접 ──
  { guideNo: "A-G-14-2026", title: "용접·용단 작업 시 화재예방에 관한 기술지원규정",
    category: "general",
    activities: [],
    documents: ["doc:ad_hoc/work_permit"] },
  { guideNo: "C-108-2017", title: "건설현장 용접용단 안전보건작업 기술지침",
    category: "construction",
    activities: [],
    documents: ["doc:ad_hoc/work_permit"] },

  // ── 밀폐공간 ──
  { guideNo: "E-G-18-2026", title: "밀폐공간 작업프로그램 수립 및 시행에 관한 기술지원규정",
    category: "health",
    activities: [],
    documents: ["doc:ad_hoc/work_permit"] },
  { guideNo: "X-68-2015", title: "밀폐공간 위험관리에 관한 기술지침",
    category: "chemical",
    activities: [],
    documents: ["doc:ad_hoc/work_permit"] },

  // ── 위험성평가 ──
  { guideNo: "C-C-21-2026", title: "위험성평가 실시를 위한 우선순위 결정에 관한 기술지원규정",
    category: "general",
    activities: ["activity:risk_assessment_general"],
    documents: ["doc:annual/regular_risk_assessment", "doc:monthly/monthly_risk_assessment", "doc:ad_hoc/ad_hoc_risk_assessment", "doc:ad_hoc/initial_risk_assessment"] },
  { guideNo: "C-C-67-2026", title: "작업위험성평가에 관한 기술지원규정",
    category: "general",
    activities: ["activity:risk_assessment_general"],
    documents: ["doc:ad_hoc/ad_hoc_risk_assessment", "doc:ad_hoc/initial_risk_assessment"] },

  // ── MSDS·화학물질 ──
  { guideNo: "C-C-29-2026", title: "경고표지를 이용한 화학물질 관리에 관한 기술지원규정",
    category: "chemical",
    activities: [],
    documents: ["doc:continuous/msds_register"] },
  { guideNo: "H-102-2014", title: "사업장 화학물질 관리 프로그램 작성 시행지침",
    category: "health",
    activities: [],
    documents: ["doc:continuous/msds_register"] },

  // ── 보호구 ──
  { guideNo: "A-G-12-2026", title: "개인보호구의 사용 및 관리에 관한 기술지원규정",
    category: "general",
    activities: [],
    documents: ["doc:monthly/ppe_register"] },
  { guideNo: "E-G-19-2026", title: "호흡보호구의 선정·사용 및 관리에 관한 기술지원규정",
    category: "general",
    activities: [],
    documents: ["doc:monthly/ppe_register"] },

  // ── 안전보건관리체계 / 중처법 ──
  { guideNo: "A-R-1-2026", title: "자율안전보건관리체계 구축 및 운영에 관한 기술지원규정",
    category: "general",
    activities: [],
    documents: ["doc:semi_annual/severe_accident_compliance"] },

  // ── 보건·작업환경 ──
  { guideNo: "E-G-1-2025", title: "근골격계질환 예방에 관한 기술지원규정",
    category: "health",
    activities: [],
    documents: ["doc:semi_annual/work_environment_measurement"] },
  { guideNo: "E-M-1-2025", title: "청력보존프로그램의 수립·시행에 관한 기술지원규정",
    category: "health",
    activities: [],
    documents: ["doc:semi_annual/work_environment_measurement"] },
  { guideNo: "E-M-2-2025", title: "소음성난청으로 진단된 근로자의 의학적 관리를 위한 기술지원규정",
    category: "health",
    activities: [],
    documents: ["doc:semi_annual/work_environment_measurement"] },
  { guideNo: "E-G-22-2026", title: "고열작업환경에 관한 기술지원규정",
    category: "health",
    activities: [],
    documents: ["doc:semi_annual/work_environment_measurement"] },
  { guideNo: "W-17-2015", title: "한랭작업환경 관리 지침",
    category: "health",
    activities: [],
    documents: ["doc:semi_annual/work_environment_measurement"] },

  // ── 작업계획서 (work_plan 일반) ──
  // C-104-2017 환각 → D-C-7-2026 비계 가이드로 대체
  // C-118-2018 환각 → D-C-9-2026 거푸집동바리 가이드로 대체 (이미 위 시드 documents 추가)
  // (별도 항목 추가 불필요 — D-C-7/D-C-9 정의에 documents: ["doc:ad_hoc/work_plan"] 추가는 별도 갱신)
];

interface JsonNode {
  "@id": string;
  guidedBy?: string[];
  [k: string]: unknown;
}

(async () => {
  // Step 1 — 환각 31 메타 모두 삭제
  const existing = await readdir(GUIDES_DIR);
  const { unlink } = await import("node:fs/promises");
  let deleted = 0;
  for (const f of existing) {
    if (f.endsWith(".jsonld")) {
      await unlink(resolve(GUIDES_DIR, f));
      deleted += 1;
    }
  }
  console.log(`[guides.purge] 환각 ${deleted} 개 삭제`);

  // Step 2 — KOSHA Live 검증된 30개 시드
  let written = 0;
  for (const g of GUIDES) {
    const slug = g.guideNo.toLowerCase().replace(/[^a-z0-9-]/g, "_");
    const node = {
      "@context": "../../../context.jsonld",
      "@id": `doc:kosha_guide/${g.guideNo}`,
      "@type": "Document",
      docId: `kosha_guide_${slug}`,
      title: g.title,
      cycle: "cyc:reference",
      verificationStatus: "kosha_live_verified",
      jurisdiction: "KR",
      _meta: {
        publishedBy: "한국산업안전보건공단 (KOSHA)",
        sourceApi: "data.go.kr 15144147 (KOSHA Guide 조회 서비스)",
        sourceUrl: "https://www.kosha.or.kr/kosha/data/guideExp.do",
        guideNo: g.guideNo,
        guideCategory: g.category,
        fetchedAt: "2026-04-26",
        verifiedAt: "2026-04-26",
        verifiedBy: "agent-safety-relay /api/kosha-guides 1039건 매칭",
        licenseHint: "공공자료 (출처 표기 시 활용)",
        note: "메타 노드. 본문은 v1.1.19+ 번들 도구 get_kosha_guide_md(techGdlnNo) 또는 sourceUrl 직접 참조.",
      },
    };
    await writeFile(resolve(GUIDES_DIR, `${slug}.jsonld`), JSON.stringify(node, null, 2) + "\n", "utf8");
    written += 1;
  }
  console.log(`[guides.seed] KOSHA Live 검증 ${written} 개 시드`);

  // Step 3 — Activity guidedBy 엣지 갱신
  const guidesByActivity = new Map<string, string[]>();
  for (const g of GUIDES) {
    for (const a of g.activities) {
      if (!guidesByActivity.has(a)) guidesByActivity.set(a, []);
      guidesByActivity.get(a)!.push(`doc:kosha_guide/${g.guideNo}`);
    }
  }
  let actUpdated = 0;
  for (const f of await readdir(ACTIVITIES_DIR)) {
    if (!f.endsWith(".jsonld")) continue;
    const path = resolve(ACTIVITIES_DIR, f);
    const node = JSON.parse(await readFile(path, "utf8")) as JsonNode;
    // 환각 guidedBy 모두 제거 → 실 데이터로 재구성
    node.guidedBy = guidesByActivity.get(node["@id"]) ?? [];
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
    actUpdated += 1;
  }
  console.log(`[activities.guidedBy] ${actUpdated} 개 Activity guidedBy 재구성`);

  // Step 4 — Document(work-plan-excavation 등) guidedBy 엣지 갱신
  const guidesByDocument = new Map<string, string[]>();
  for (const g of GUIDES) {
    for (const d of g.documents) {
      if (!guidesByDocument.has(d)) guidesByDocument.set(d, []);
      guidesByDocument.get(d)!.push(`doc:kosha_guide/${g.guideNo}`);
    }
  }
  // 검증된 KOSHA Guide IRI 화이트리스트 (환각 참조 자동 제거용)
  const validGuideIris = new Set(GUIDES.map((g) => `doc:kosha_guide/${g.guideNo}`));

  let docUpdated = 0;
  async function walkDocs(dir: string): Promise<void> {
    for (const f of await readdir(dir)) {
      const path = resolve(dir, f);
      const { stat } = await import("node:fs/promises");
      const st = await stat(path);
      if (st.isDirectory()) {
        if (f === "guides") continue; // KOSHA Guide 자체는 skip
        await walkDocs(path);
        continue;
      }
      if (!f.endsWith(".jsonld")) continue;
      const node = JSON.parse(await readFile(path, "utf8")) as JsonNode;
      const newGuides = guidesByDocument.get(node["@id"]) ?? [];
      const cur = node.guidedBy ?? [];
      // 기존 guidedBy 중 실 KOSHA 화이트리스트에 없는 환각 참조는 제거
      const cleaned = cur.filter((iri) => validGuideIris.has(iri));
      const merged = Array.from(new Set([...cleaned, ...newGuides]));
      const changed =
        merged.length !== cur.length ||
        merged.some((iri, i) => iri !== cur[i]);
      if (changed) {
        node.guidedBy = merged;
        await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
        docUpdated += 1;
      }
    }
  }
  await walkDocs(DOCUMENTS_DIR);
  console.log(`[documents.guidedBy] ${docUpdated} 개 Document guidedBy 갱신 (환각 제거 + 실 매핑 추가)`);
})();
