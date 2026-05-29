#!/usr/bin/env tsx
/**
 * seed-msds-ghs.ts (v0.14 근본정정 #1)
 *
 * MSDS 등록부 GHS 16항목 완전 시드.
 * 교차 검증 외부 평가 27% → 80%+ 목표.
 *
 * GHS 16개 섹션 (UN GHS Rev. 9 + 한국 산안법 §110 + 화학물질관리법):
 *   1. 화학제품과 회사에 관한 정보
 *   2. 유해성·위험성
 *   3. 구성성분의 명칭 및 함유량
 *   4. 응급조치 요령
 *   5. 폭발·화재 시 대처방법
 *   6. 누출 사고 시 대처방법
 *   7. 취급 및 저장방법
 *   8. 노출방지 및 개인보호구
 *   9. 물리화학적 특성
 *   10. 안정성 및 반응성
 *   11. 독성에 관한 정보
 *   12. 환경에 미치는 영향
 *   13. 폐기 시 주의사항
 *   14. 운송에 필요한 정보
 *   15. 법적 규제현황
 *   16. 그 밖의 참고사항 (작성자·작성일·개정·출처)
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DOCS_DIR = resolve(ROOT, "src", "ontology", "graph", "nodes", "documents");

const MSDS_GHS_SECTIONS = [
  {
    title: "1. 화학제품과 회사에 관한 정보",
    legalSource: "GHS 1 + 산안법 §110 ① 1호",
    fields: [
      { key: "productName", label: "제품명·물질명", required: true },
      { key: "intendedUse", label: "사용 용도·제한", required: true },
      { key: "manufacturer", label: "제조·수입자 회사명·주소", required: true },
      { key: "emergencyPhone", label: "응급 연락처 (24시간)", required: true },
    ],
  },
  {
    title: "2. 유해성·위험성",
    legalSource: "GHS 2 + 산안법 §110 ① 2호",
    fields: [
      { key: "ghsClassification", label: "GHS 분류 (급성독성·피부부식·심각한 눈손상 등)", required: true },
      { key: "ghsPictogram", label: "GHS 그림문자 (해골·불꽃·부식 등)", required: true },
      { key: "signalWord", label: "신호어 (위험·경고)", required: true },
      { key: "hazardStatement", label: "유해·위험문구 (H-code)", required: true },
      { key: "precautionaryStatement", label: "예방조치 문구 (P-code)", required: true },
    ],
  },
  {
    title: "3. 구성성분의 명칭 및 함유량",
    legalSource: "GHS 3 + 산안법 §110",
    fields: [
      { key: "casNo", label: "CAS No.·KE No.·UN No.", required: true },
      { key: "composition", label: "성분명·함유량 (중량%)", required: true },
      { key: "impurities", label: "불순물·안정제 (있으면)", required: false },
    ],
  },
  {
    title: "4. 응급조치 요령",
    legalSource: "GHS 4",
    fields: [
      { key: "firstAidEye", label: "눈 접촉 시", required: true },
      { key: "firstAidSkin", label: "피부 접촉 시", required: true },
      { key: "firstAidInhalation", label: "흡입 시", required: true },
      { key: "firstAidIngestion", label: "섭취 시", required: true },
      { key: "firstAidNote", label: "의사·응급요원에 전달할 정보", required: true },
    ],
  },
  {
    title: "5. 폭발·화재 시 대처방법",
    legalSource: "GHS 5",
    fields: [
      { key: "extinguishingMedia", label: "적합한 소화제·금지된 소화제", required: true },
      { key: "fireHazards", label: "화재·폭발 시 특수 위험성", required: true },
      { key: "firefighterEquipment", label: "소방관용 보호장비", required: true },
    ],
  },
  {
    title: "6. 누출 사고 시 대처방법",
    legalSource: "GHS 6",
    fields: [
      { key: "personalPrecautions", label: "인체 보호조치·보호구·비상절차", required: true },
      { key: "environmentalPrecautions", label: "환경 보호조치 (배수로·하천 차단)", required: true },
      { key: "containment", label: "정화·중화 방법", required: true },
    ],
  },
  {
    title: "7. 취급 및 저장방법",
    legalSource: "GHS 7 + 산안법 §110 ① 4호",
    fields: [
      { key: "handling", label: "안전한 취급 요령·정전기·환기", required: true },
      { key: "storage", label: "안전한 저장방법·금지물질·온도", required: true },
    ],
  },
  {
    title: "8. 노출방지 및 개인보호구",
    legalSource: "GHS 8 + 산안기준규칙",
    fields: [
      { key: "exposureLimit", label: "노출기준 (TLV·STEL·천장값 등)", required: true },
      { key: "engineeringControl", label: "공학적 관리 (LEV·국소배기·환기)", required: true },
      { key: "respiratoryPpe", label: "호흡보호구", required: true },
      { key: "skinPpe", label: "보호장갑·방호복·보안경", required: true },
    ],
  },
  {
    title: "9. 물리화학적 특성",
    legalSource: "GHS 9",
    fields: [
      { key: "appearance", label: "외관 (상태·색)", required: true },
      { key: "odor", label: "냄새·냄새 역치", required: false },
      { key: "physicalProps", label: "pH·녹는점·끓는점·인화점·증기압·밀도", required: true },
      { key: "solubility", label: "용해도 (물·기타 용매)", required: false },
    ],
  },
  {
    title: "10. 안정성 및 반응성",
    legalSource: "GHS 10",
    fields: [
      { key: "chemicalStability", label: "화학적 안정성", required: true },
      { key: "reactivityHazards", label: "위험 반응 가능성·조건 (열·충격·습기 등)", required: true },
      { key: "incompatibleMaterials", label: "피해야 할 물질·조건", required: true },
      { key: "decompositionProducts", label: "분해 시 발생 유해물질", required: true },
    ],
  },
  {
    title: "11. 독성에 관한 정보",
    legalSource: "GHS 11",
    fields: [
      { key: "acuteToxicity", label: "급성 독성 (LD50·LC50)", required: true },
      { key: "chronicToxicity", label: "만성 독성 (발암성·생식독성·표적장기)", required: true },
      { key: "exposureRoute", label: "노출 경로별 영향 (흡입·피부·경구)", required: true },
    ],
  },
  {
    title: "12. 환경에 미치는 영향",
    legalSource: "GHS 12",
    fields: [
      { key: "ecotoxicity", label: "수생/육상 생태독성", required: true },
      { key: "persistence", label: "잔류성·분해성", required: true },
      { key: "bioaccumulation", label: "생물농축성", required: true },
      { key: "soilMobility", label: "토양 이동성", required: false },
    ],
  },
  {
    title: "13. 폐기 시 주의사항",
    legalSource: "GHS 13 + 폐기물관리법",
    fields: [
      { key: "wasteDisposal", label: "폐기 방법·법적 분류 (지정폐기물 여부)", required: true },
      { key: "containerDisposal", label: "오염된 용기·포장 처리", required: true },
    ],
  },
  {
    title: "14. 운송에 필요한 정보",
    legalSource: "GHS 14 + 위험물안전관리법",
    fields: [
      { key: "unNumber", label: "UN 번호·UN 운송명", required: true },
      { key: "transportClass", label: "운송 위험 등급 (Class·Packing Group)", required: true },
      { key: "transportPrecautions", label: "운송 시 특별 주의사항", required: true },
    ],
  },
  {
    title: "15. 법적 규제현황",
    legalSource: "GHS 15 + 한국 법령",
    fields: [
      { key: "domesticLaws", label: "국내 적용 법령 (산안법·화학물질관리법·위험물안전관리법)", required: true },
      { key: "internationalLaws", label: "국제 협약 (스톡홀름·로테르담·바젤)", required: false },
      { key: "regulatedAs", label: "유독물·금지물질·허가물질·관찰물질 분류", required: true },
    ],
  },
  {
    title: "16. 그 밖의 참고사항",
    legalSource: "GHS 16 + 산안법 §110 ② (개정 시 갱신)",
    fields: [
      { key: "preparedBy", label: "작성자·소속·연락처", required: true },
      { key: "preparedDate", label: "최초 작성일", required: true },
      { key: "revisedDate", label: "최근 개정일·개정 내용", required: true },
      { key: "references", label: "참고문헌·인용 자료", required: false },
    ],
  },
  // 기존 한국 게시·교육 섹션 (산안법 §114·115 보존)
  {
    title: "한국 게시·교육 (산안법 §114·115)",
    legalSource: "산안법 §114 (게시) + §115 (교육)",
    fields: [
      { key: "postedLocation", label: "MSDS 게시 위치 (작업장 잘 보이는 곳)", required: true },
      { key: "trainingDate", label: "근로자 MSDS 교육 일자·이수자", required: true },
      { key: "warningLabel", label: "경고표지 부착 (용기·포장 GHS 라벨)", required: true },
    ],
  },
];

(async () => {
  const path = resolve(DOCS_DIR, "msds-register.jsonld");
  const node = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
    _meta?: Record<string, unknown>;
  };
  node.sections = MSDS_GHS_SECTIONS;
  // requiredFields 도 갱신
  node.requiredFields = MSDS_GHS_SECTIONS.flatMap((s) =>
    s.fields.map((f) => ({ key: f.key, label: f.label, source: s.legalSource ?? "GHS" })),
  );
  // legalBasis 화학물질관리법·위험물·폐기물 추가
  const lb = (node.legalBasis as string[] | undefined) ?? [];
  for (const newLb of ["art:화학물질관리법:18", "art:위험물안전관리법:5", "art:폐기물관리법:18"]) {
    if (!lb.includes(newLb)) lb.push(newLb);
  }
  node.legalBasis = lb;

  const meta = (node._meta ?? {}) as Record<string, unknown>;
  meta.standard = "UN GHS Rev.9 + 한국 산안법 §110·114·115 + 화학물질관리법";
  meta.coreSectionsAddedAt = "2026-04-27";
  meta.documentCategory = "register";
  node._meta = meta;

  await writeFile(path, JSON.stringify(node, null, 2) + "\n", "utf8");
  const fieldCount = MSDS_GHS_SECTIONS.reduce((s, sec) => s + sec.fields.length, 0);
  console.log(`✓ msds_register: GHS ${MSDS_GHS_SECTIONS.length}섹션 ${fieldCount} 필드`);
  console.log(`  이전: 3섹션 12필드 → 이후: ${MSDS_GHS_SECTIONS.length}섹션 ${fieldCount}필드`);
})();
