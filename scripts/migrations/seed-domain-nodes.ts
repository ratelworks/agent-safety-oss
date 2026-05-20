#!/usr/bin/env tsx
/**
 * seed-domain-nodes.ts
 *
 * 도메인 노드 일괄 시드 — Activity / Applicability / Hazard / Control.
 * 별표 4 13종 + 위험성평가 추론에 필요한 핵심 노드.
 *
 * 가이드라인 준수:
 *   - schema.org Legislation 친화 (jurisdiction, legalForce 의미는 조문에서 상속)
 *   - ERIC-PP 6단계 위계 (Eliminate / Replace / Isolation / Engineering / Administrative / PPE)
 */

import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");

interface SeedNode {
  dir: string;
  filename: string;
  node: Record<string, unknown>;
}

const seeds: SeedNode[] = [];

// ─── Activity 16종 (별표 4 13종 + 추가 3) ───
const activities = [
  { id: "tower_crane", title: "타워크레인 설치·조립·해체", category: "lifting", annexNo: "1" },
  { id: "vehicle_cargo", title: "차량계 하역운반기계 사용", category: "vehicle", annexNo: "2" },
  { id: "vehicle_construction", title: "차량계 건설기계 사용", category: "vehicle", annexNo: "3" },
  { id: "chemical_facility", title: "화학설비 사용", category: "chemical", annexNo: "4" },
  { id: "electric_work_50v_plus", title: "전기작업 (50V 또는 250VA 초과)", category: "electric", annexNo: "5" },
  { id: "excavation_2m_plus", title: "굴착작업 (높이 2m 이상)", category: "excavation", annexNo: "6", threshold: { depthGteM: 2 } },
  { id: "tunnel_excavation", title: "터널굴착작업", category: "excavation", annexNo: "7" },
  { id: "bridge_5m_30m", title: "교량 설치·해체·변경 (5m/30m 이상)", category: "structure", annexNo: "8" },
  { id: "quarry", title: "채석작업", category: "excavation", annexNo: "9" },
  { id: "demolition", title: "구축물·건축물 해체작업", category: "structure", annexNo: "10" },
  { id: "heavy_lifting", title: "중량물 취급작업", category: "lifting", annexNo: "11" },
  { id: "railway_maintenance", title: "궤도·관련설비 보수·점검", category: "railway", annexNo: "12" },
  { id: "railway_shunting", title: "입환작업", category: "railway", annexNo: "13" },
  { id: "risk_assessment_general", title: "위험성평가 전반 (모든 사업장)", category: "management" },
  { id: "tbm_daily", title: "TBM 작업 전 안전점검회의", category: "management" },
  { id: "safety_education", title: "근로자 안전보건교육", category: "management" },
];
for (const a of activities) {
  seeds.push({
    dir: "activities",
    filename: `${a.id}.jsonld`,
    node: {
      "@context": "../../context.jsonld",
      "@id": `activity:${a.id}`,
      "@type": "Activity",
      title: a.title,
      category: a.category,
      ...(a.annexNo ? { annexReference: `annex:기준규칙:별표4-${a.annexNo}호` } : {}),
      ...(a.threshold ? { threshold: a.threshold } : {}),
      verificationStatus: "verified",
      jurisdiction: "KR",
      _meta: {
        publishedBy: "라텔웍스 + 황룡건설(주)",
        sourceUrl: "https://www.law.go.kr/법령/산업안전보건기준에관한규칙/별표4",
        fetchedAt: "2026-04-26",
        licenseHint: "저작권법 §7 비보호 (자유 인용)",
      },
    },
  });
}

// ─── Applicability 노드 — 50인/50억/업종 매트릭스 ───
const applicabilities = [
  { id: "all_workplace", title: "모든 사업장", condition: "사업장 규모 무관" },
  { id: "all_workplace_with_excavation", title: "굴착작업이 있는 모든 사업장", condition: "굴착면 높이 2m 이상 굴착작업 시" },
  { id: "five_persons_or_more", title: "5인 이상 사업장 (중처법 적용)", condition: "상시 근로자 5인 이상", threshold: { workforceGte: 5 } },
  { id: "fifty_persons_or_more", title: "50인 이상 사업장 (안전관리자 선임)", condition: "상시 근로자 50인 이상", threshold: { workforceGte: 50 } },
  { id: "under_50_persons", title: "50인 미만 사업장 (일부 면제)", condition: "상시 근로자 50인 미만", threshold: { workforceLt: 50 } },
  { id: "construction_50bn_plus", title: "50억 이상 건설공사 (안전보건대장)", condition: "공사금액 50억 이상", threshold: { constructionValueGte: 50, industry: "construction" } },
  { id: "construction_under_50bn", title: "50억 미만 건설공사 (일부 면제)", condition: "공사금액 50억 미만", threshold: { constructionValueLt: 50, industry: "construction" } },
  { id: "construction_all", title: "모든 건설공사 (산업안전보건관리비)", condition: "건설업 업종, 공사금액 무관", threshold: { industry: "construction" } },
  { id: "ongoing_assessment_selected", title: "상시평가 선택 사업장", condition: "위험성평가 고시 §15 ④ 선택" },
];
for (const a of applicabilities) {
  seeds.push({
    dir: "applicabilities",
    filename: `${a.id}.jsonld`,
    node: {
      "@context": "../../context.jsonld",
      "@id": `applic:${a.id}`,
      "@type": "Applicability",
      title: a.title,
      condition: a.condition,
      ...(a.threshold ? { threshold: a.threshold } : {}),
      verificationStatus: "verified",
      jurisdiction: "KR",
      _meta: {
        publishedBy: "라텔웍스 + 황룡건설(주)",
        fetchedAt: "2026-04-26",
        licenseHint: "공공자료 (출처 표기 시 활용)",
      },
    },
  });
}

// ─── Hazard 12종 (핵심 위험요인) ───
const hazards = [
  { id: "fall_from_height", title: "추락 (고소작업)", category: "physical", severity: "high" },
  { id: "fall_object", title: "낙하·비래", category: "physical", severity: "high" },
  { id: "electric_shock", title: "감전", category: "electric", severity: "high" },
  { id: "crushing", title: "협착·끼임", category: "mechanical", severity: "high" },
  { id: "cave_in", title: "굴착·구조물 붕괴", category: "structural", severity: "high" },
  { id: "fire_explosion", title: "화재·폭발", category: "thermal", severity: "high" },
  { id: "asphyxiation", title: "질식 (밀폐공간)", category: "atmospheric", severity: "high" },
  { id: "struck_by", title: "맞음·부딪힘", category: "mechanical", severity: "medium" },
  { id: "machine_entanglement", title: "기계 말림·감김", category: "mechanical", severity: "high" },
  { id: "chemical_exposure", title: "화학물질 노출", category: "chemical", severity: "high" },
  { id: "noise_vibration", title: "소음·진동 노출", category: "physical", severity: "medium" },
  { id: "msd_repetitive", title: "근골격계 (반복 동작)", category: "ergonomic", severity: "medium" },
];
for (const h of hazards) {
  seeds.push({
    dir: "hazards",
    filename: `${h.id}.jsonld`,
    node: {
      "@context": "../../context.jsonld",
      "@id": `hazard:${h.id}`,
      "@type": "Hazard",
      title: h.title,
      category: h.category,
      severity: h.severity,
      verificationStatus: "verified",
      jurisdiction: "KR",
      _meta: {
        publishedBy: "라텔웍스 + 황룡건설(주) (KOSHA Guide 분류 참조)",
        fetchedAt: "2026-04-26",
        licenseHint: "공공자료 (출처 표기 시 활용)",
      },
    },
  });
}

// ─── Control 노드 — ERIC-PP 6단계 위계 ───
const controls = [
  { id: "eric_eliminate", title: "Eliminate (제거)", controlLevel: 1, description: "위험요인 자체를 제거 — 작업 폐지·자동화" },
  { id: "eric_substitute", title: "Substitute (대체)", controlLevel: 2, description: "위험성 낮은 물질·방법으로 대체" },
  { id: "eric_isolation", title: "Isolation (격리)", controlLevel: 3, description: "위험원과 작업자 물리적 분리 — 차단막·원격 제어" },
  { id: "eric_engineering", title: "Engineering Control (공학적 통제)", controlLevel: 4, description: "환기·차폐·인터록 등 공학적 설계" },
  { id: "eric_administrative", title: "Administrative Control (관리적 통제)", controlLevel: 5, description: "절차서·교육·작업허가·작업시간 제한" },
  { id: "eric_ppe", title: "PPE (개인보호구)", controlLevel: 6, description: "최후 수단 — 안전대·안전모·보호장갑 등" },
];
for (const c of controls) {
  seeds.push({
    dir: "controls",
    filename: `${c.id}.jsonld`,
    node: {
      "@context": "../../context.jsonld",
      "@id": `control:${c.id}`,
      "@type": "Control",
      title: c.title,
      controlLevel: c.controlLevel,
      description: c.description,
      verificationStatus: "verified",
      jurisdiction: "KR",
      _meta: {
        publishedBy: "라텔웍스 + 황룡건설(주) (ERIC-PP 표준)",
        sourceStandard: "ISO 45001 + KOSHA KRAS",
        fetchedAt: "2026-04-26",
        licenseHint: "공공자료 (출처 표기 시 활용)",
      },
    },
  });
}

// 저장
(async () => {
  let count = 0;
  for (const s of seeds) {
    const path = resolve(NODES, s.dir, s.filename);
    await writeFile(path, JSON.stringify(s.node, null, 2) + "\n", "utf8");
    count += 1;
  }
  console.log(`[done] ${count} 개 노드 시드 완료`);
  console.log(`  Activities: ${activities.length}, Applicabilities: ${applicabilities.length}, Hazards: ${hazards.length}, Controls: ${controls.length}`);
})();
