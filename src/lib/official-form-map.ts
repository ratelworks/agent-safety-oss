/**
 * official-form-map.ts — 법정 서식 원본 파일과 칸 지도(src/ontology/forms/official/forms.json)를 읽는다
 *
 * 서식 원본은 법제처 국가법령정보센터에서 받은 파일이다. 구형 HWP 서식은 한 번 HWPX 로 바꿔 넣었다(source.converted).
 * 칸 지도는 표 순번(본문의 표를 문서 순서대로 — 칸 안의 표 포함 — 0 부터)·행·열 → 문서 칸(field key)이다.
 * 채우기는 official-form.ts.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── 상수 ────────────────────────────────────────────────────────────
/** src/lib 또는 build/lib 에서 ontology/forms/official (빌드는 src/ontology/forms 를 build/ontology/forms 로 복사한다) */
const FORMS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ontology", "forms", "official");
const MAP_FILE = "forms.json";

// ── 칸 지도 형식 ────────────────────────────────────────────────────
export interface FormSource {
  law: string;
  form: string;
  /** 법제처 서식 내려받기 주소 */
  url: string;
  fetched: string;
  /** 받은 원본(HWP)의 SHA-256 */
  sha256: string;
  /** 구형 HWP 를 HWPX 로 바꿔 넣었으면 그 기록 */
  converted?: string;
}
/** 입력값 조건 — in: 값이 이 가운데 하나 / has: 값에 이 글이 들어 있음 / notHas: 값에 이 글이 하나도 없음. 값이 비면 맞지 않는다 */
export interface When {
  key: string;
  in?: string[];
  has?: string[];
  notHas?: string[];
}
/**
 * 한 칸 — template 의 {칸 이름} 자리에 값을 넣는다. {이름|부분}: Y·M·D·date·dow(요일)·h(시)·min(분)·time,
 * num(값의 첫 숫자), million(금액을 백만원 단위로 — 원·억·만원·백만원 표기를 읽고, 단위가 없으면 1천만 이상은 원으로 본다), bare(앞뒤 괄호를 뗀 값), dN(숫자만 남긴 값의 N번째 글자), after:글(값에서 그 글 뒤 ":" 다음부터 "/"·"]"·"," 앞까지 — "외국인 [국적: 베트남 / …]" 의 "베트남").
 * 칸을 바꾸는 방법 (하나만)
 *   - 기본: 칸 글자를 template 으로 바꾼다(첫 문단 모양)
 *   - append: 칸에 인쇄된 항목 이름을 두고 그 아래 문단으로 값을 적는다(시행규칙 별지처럼 이름과 값이 한 칸인 서식)
 *   - after: 칸 글자에서 이 글 뒤의 첫 빈칸 자리에 값을 넣는다("국적:        " "공사금액    백만원")
 */
export interface CellSpec {
  table: number;
  row: number;
  col: number;
  template: string;
  when?: When;
  append?: boolean;
  after?: string;
}
/**
 * 체크 칸 — 칸의 "[  ]이름"(bracket-before)·"이름 [  ]"(bracket-after)·"이름□"(box-after) 표시를 고른다.
 * mode "options"(기본): 값에 든 이름의 칸을 고른다. 맞는 이름이 없으면 other 칸을 고르고 그 뒤 [ ] 안에 값을 적는다.
 * mode "yes": 칸에 표시가 하나뿐 — 값이 긍정(비어 있지 않고 부정어가 아님)이면 고른다.
 * aliases: 칸 이름 → 값에 그 칸을 뜻하는 다른 말 ("내국인": ["한국", "대한민국"]).
 * fallback: 값에 어느 칸 이름도 없을 때 고를 칸 ("외국인" — 국적 칸에 나라 이름만 적은 경우).
 * yesWords: mode yes 에서 고를 긍정 낱말 ("사망", "요청", "동의") — 표시(√)·예·네 등은 기본으로 본다. 부정도 긍정도 아니면 고르지 않고 알린다.
 */
export interface CheckSpec {
  table: number;
  row: number;
  col: number;
  field: string;
  style?: "bracket-before" | "bracket-after" | "box-after";
  mode?: "options" | "yes";
  other?: string;
  aliases?: Record<string, string[]>;
  fallback?: string;
  yesWords?: string[];
}
export interface RowCell {
  offset?: number;
  col: number;
  template: string;
  when?: When;
}
/** 입력 줄을 받는 빈 줄 — 위에서부터 채우고, 모자라면 줄을 늘린다(입력을 버리지 않는다) */
export interface RowsSpec {
  field: string;
  table: number;
  firstRow: number;
  lastRow: number;
  step?: number;
  cells: RowCell[];
}
export interface FormMap {
  file: string;
  source: FormSource;
  /** 같은 문서 종류에 서식이 둘 이상이면(일반·건설업) 이 조건이 맞는 것을 쓴다 — 조건 없는 것이 기본 */
  when?: When;
  cells?: CellSpec[];
  checks?: CheckSpec[];
  rows?: RowsSpec[];
}

let mapsCache: Record<string, FormMap[]> | null = null;

function maps(): Record<string, FormMap[]> {
  if (!mapsCache) {
    const raw = JSON.parse(readFileSync(join(FORMS_DIR, MAP_FILE), "utf8")) as { forms: Record<string, FormMap | FormMap[]> };
    mapsCache = Object.fromEntries(Object.entries(raw.forms).map(([docId, m]) => [docId, Array.isArray(m) ? m : [m]]));
  }
  return mapsCache;
}

/** 이 문서 종류의 서식 원본 칸 지도 전부 (일반·건설업처럼 둘 이상일 수 있다) */
export function officialFormMaps(docId: string): FormMap[] {
  return maps()[docId] ?? [];
}

/** 법정 서식 원본이 있는 문서 종류 */
export function officialFormDocIds(): string[] {
  return Object.keys(maps());
}

/** 서식 원본 파일의 경로 */
export function officialFormPath(map: FormMap): string {
  return join(FORMS_DIR, map.file);
}
