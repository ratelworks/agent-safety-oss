/**
 * admin-rules-list.ts — 수록한 행정규칙(고시·지침) 목록
 *
 * 동기화(sync-admin-rules.ts)와 판본 점검(check-law-editions.ts)이 같은 목록을 쓴다.
 * id 는 법제처 행정규칙일련번호 — 개정되면 새 번호가 생기므로, 판본 점검이 현행 번호와 다르다고 알리면 여기를 바꾸고 동기화한다.
 */

export interface AdminRule {
  /** 조문 IRI·파일명에 쓰는 짧은 이름 (art:{actKey}:{조}) */
  actKey: string;
  /** 법제처 행정규칙일련번호 */
  id: string;
  /** 법령 노드 IRI 와 파일명 (act:{actSlug}) */
  actSlug: string;
  /** 문서에서 부르는 다른 이름 */
  alternativeNames: string[];
}

/** 수록 대상 — 건설현장 작업에 직접 적용되는 고용노동부 고시 */
export const ADMRULS: AdminRule[] = [
  { actKey: "위험성평가-고시", id: "2100000288038", actSlug: "사업장위험성평가에관한지침", alternativeNames: ["위험성평가 고시"] },
  { actKey: "가설공사-지침", id: "2100000186031", actSlug: "가설공사표준안전작업지침", alternativeNames: ["가설공사 표준안전 작업지침"] },
  { actKey: "굴착공사-지침", id: "2100000226002", actSlug: "굴착공사표준안전작업지침", alternativeNames: ["굴착공사 표준안전 작업지침"] },
  { actKey: "발파-지침", id: "2100000226042", actSlug: "발파표준안전작업지침", alternativeNames: ["발파 표준안전 작업지침"] },
  { actKey: "철골공사-지침", id: "2100000186037", actSlug: "철골공사표준안전작업지침", alternativeNames: ["철골공사 표준안전 작업지침"] },
  { actKey: "추락재해방지-지침", id: "2100000186039", actSlug: "추락재해방지표준안전작업지침", alternativeNames: ["추락재해방지 표준안전 작업지침"] },
  { actKey: "콘크리트공사-지침", id: "2100000268994", actSlug: "콘크리트공사표준안전작업지침", alternativeNames: ["콘크리트공사 표준안전 작업지침"] },
  { actKey: "터널공사NATM-지침", id: "2100000226004", actSlug: "터널공사표준안전작업지침NATM공법", alternativeNames: ["터널공사 표준안전 작업지침", "터널공사 표준안전 작업지침-NATM공법"] },
  { actKey: "해체공사-지침", id: "2100000186047", actSlug: "해체공사표준안전작업지침", alternativeNames: ["해체공사 표준안전 작업지침"] },
  { actKey: "운반하역-지침", id: "2100000186124", actSlug: "운반하역표준안전작업지침", alternativeNames: ["운반하역 표준안전 작업지침"] },
  { actKey: "산안비-기준", id: "2100000254546", actSlug: "건설업산업안전보건관리비계상및사용기준", alternativeNames: ["산업안전보건관리비 계상 및 사용기준", "산안비 계상기준"] },
  { actKey: "안전보건대장-고시", id: "2100000243390", actSlug: "건설공사안전보건대장의작성등에관한고시", alternativeNames: ["건설공사 안전보건대장 고시"] },
  { actKey: "실적평가-기준", id: "2100000228660", actSlug: "건설업체의산업재해예방활동실적평가기준", alternativeNames: ["건설업체 산업재해예방활동 실적 평가기준"] },
  { actKey: "자체심사업체-고시", id: "2100000186090", actSlug: "유해위험방지계획서자체심사및확인업체지정대상건설업체고시", alternativeNames: ["유해·위험방지계획서 자체심사 및 확인업체 고시"] },
  { actKey: "지도사평가-고시", id: "2100000186089", actSlug: "건설업유해위험방지계획서중지도사가평가확인할수있는대상건설공사의범위및지도사의요건", alternativeNames: ["지도사 평가·확인 대상 건설공사 고시"] },
  { actKey: "전문기관관리-규정", id: "2100000251782", actSlug: "안전보건관리전문기관및건설재해예방전문지도기관관리규정", alternativeNames: ["건설재해예방전문지도기관 관리규정"] },
  { actKey: "교육-규정", id: "2100000269024", actSlug: "안전보건교육규정", alternativeNames: ["안전보건교육규정", "안전보건교육 규정"] },
  { actKey: "클린사업장-규정", id: "2100000286788", actSlug: "산업재해예방시설자금융자금지원사업및클린사업장조성지원사업운영규정", alternativeNames: ["클린사업장 조성지원사업 운영규정", "산업재해예방시설자금 융자금 지원사업 운영규정"] },
  { actKey: "감독관집무-규정", id: "2100000246934", actSlug: "근로감독관집무규정산업안전보건", alternativeNames: ["근로감독관 집무규정(산업안전보건)", "근로감독관 집무규정"] },
  { actKey: "방호장치인증-고시", id: "2100000199056", actSlug: "방호장치안전인증고시", alternativeNames: ["방호장치 안전인증 고시", "방호장치안전인증고시"] },
  { actKey: "보호구인증-고시", id: "2100000232806", actSlug: "보호구안전인증고시", alternativeNames: ["보호구 안전인증 고시", "보호구안전인증고시"] },
  { actKey: "인증절차-고시", id: "2100000214148", actSlug: "안전인증자율안전확인신고의절차에관한고시", alternativeNames: ["안전인증·자율안전확인신고의 절차에 관한 고시"] },
  { actKey: "기계인증-고시", id: "2100000228814", actSlug: "위험기계기구안전인증고시", alternativeNames: ["위험기계·기구 안전인증 고시", "위험기계기구 안전인증 고시"] },
  { actKey: "방호장치자율-고시", id: "2100000214150", actSlug: "방호장치자율안전기준고시", alternativeNames: ["방호장치 자율안전기준 고시"] },
  { actKey: "보호구자율-고시", id: "2100000186078", actSlug: "보호구자율안전확인고시", alternativeNames: ["보호구 자율안전확인 고시"] },
  { actKey: "건강진단-기준", id: "2100000271410", actSlug: "근로자건강진단실시기준", alternativeNames: ["근로자 건강진단 실시기준"] },
  { actKey: "MSDS-기준", id: "2100000278320", actSlug: "화학물질의분류표시및물질안전보건자료에관한기준", alternativeNames: ["화학물질의 분류·표시 및 물질안전보건자료에 관한 기준", "물질안전보건자료 기준", "MSDS 기준"] },
  { actKey: "벌목-지침", id: "2100000262610", actSlug: "벌목표준안전작업지침", alternativeNames: ["벌목 표준안전 작업지침"] },
  { actKey: "예정가격-기준", id: "2100000284228", actSlug: "계약예규예정가격작성기준", alternativeNames: ["(계약예규) 예정가격작성기준", "예정가격작성기준", "예정가격 작성기준"] },
  { actKey: "업무위탁-고시", id: "2100000218739", actSlug: "업무위탁기관의지정등에관한고시", alternativeNames: ["업무위탁기관의 지정 등에 관한 고시"] },
];
