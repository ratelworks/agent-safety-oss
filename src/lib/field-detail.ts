/**
 * field-detail.ts — 표 형태로 들어온 칸 값(목록의 행들)을 상세 표로 펼친다
 *
 * 재해자 명단·화학물질 목록·위험성평가 행처럼 칸 값이 객체 목록이면 열 순서·열 이름을 정해 표로 싣는다.
 * Markdown 본문과 정본(DocLang)이 같은 규칙을 쓴다.
 */

// ── 상수 ────────────────────────────────────────────────────────────
export const DETAIL_COLUMN_ORDER: Record<string, string[]> = {
  victimList: [
    "name",
    "birthDate",
    "nationality",
    "employer",
    "occupation",
    "employmentType",
    "accidentType",
    "injurySeverity",
    "hospital",
  ],
  chemicalList: [
    "productName",
    "casNumber",
    "manufacturer",
    "monthlyVolume",
    "storageLocation",
    "msdsValidUntil",
    "exposureLimit",
    "mainHazard",
    "requiredPPE",
    "note",
  ],
  riskRows: [
    "task",
    "hazard",
    "currentRisk",
    "control",
    "residualRisk",
    "owner",
    "due",
  ],
};

export const DETAIL_COLUMN_LABELS: Record<string, string> = {
  name: "성명",
  birthDate: "생년월일",
  nationality: "국적",
  employer: "소속",
  occupation: "직종",
  employmentType: "고용형태",
  accidentType: "재해유형",
  injurySeverity: "상해정도",
  hospital: "병원",
  productName: "제품명",
  casNumber: "CAS/구성",
  manufacturer: "제조사",
  monthlyVolume: "취급량",
  storageLocation: "비치위치",
  msdsValidUntil: "MSDS 유효기한",
  exposureLimit: "노출기준",
  mainHazard: "주요 유해성",
  requiredPPE: "필수 보호구",
  note: "비고",
  task: "작업",
  hazard: "위험요인",
  currentRisk: "현재위험도",
  control: "감소대책",
  residualRisk: "잔여위험도",
  owner: "책임자",
  due: "기한",
  // 사람 명단 (참석자·이수자·채용자·작업자)
  signed: "서명",
  hireDate: "채용일",
  language: "언어",
  hours: "시간",
  workType: "작업 종류",
  exposure: "노출",
  // 집행·점검·측정·지급 목록
  month: "월",
  item: "항목",
  amount: "금액",
  evidence: "증빙",
  balance: "잔액",
  date: "일자",
  duties: "수행 직무",
  level: "측정값",
  limit: "기준",
  eval: "평가",
  evaluation: "평가",
  hazardName: "유해인자",
  exposedWorkers: "노출 근로자 수",
  measureHours: "측정 시간",
  exposureLevel: "노출 수준",
  id: "번호",
  type: "종류",
  model: "모델",
  size: "치수",
  qty: "수량",
};
/** 참·거짓 값의 표기 — 서명처럼 손으로 채울 칸은 거짓이면 비워 둔다 */
const BOOLEAN_TEXT = { true: "예", false: "아니오" } as const;
const BLANK_WHEN_FALSE = new Set(["signed"]);

/** 객체 목록 값이면 상세 표(열 이름·행)를, 아니면 null */
export function fieldDetailTable(fieldKey: string, value: unknown): { headers: string[]; rows: unknown[][] } | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((item) => item && typeof item === "object" && !Array.isArray(item))) return null;
  const objectRows = value as Array<Record<string, unknown>>;
  const preferred = DETAIL_COLUMN_ORDER[fieldKey] ?? [];
  const discovered = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));
  const columns = [...preferred.filter((key) => discovered.includes(key)), ...discovered.filter((key) => !preferred.includes(key))];
  if (columns.length === 0) return null;
  return {
    headers: columns.map((key) => DETAIL_COLUMN_LABELS[key] ?? key),
    rows: objectRows.map((row) => columns.map((key) => cellValue(key, row[key]))),
  };
}

/** 칸 값 — 참·거짓은 글자로(서명 칸의 거짓은 빈 칸), 나머지는 그대로 */
function cellValue(key: string, value: unknown): unknown {
  if (typeof value !== "boolean") return value;
  if (!value && BLANK_WHEN_FALSE.has(key)) return "";
  return BOOLEAN_TEXT[value ? "true" : "false"];
}
