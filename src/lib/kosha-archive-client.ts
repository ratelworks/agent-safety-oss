// 파일 최상단 상수 — KOSHA 산업안전포털 안전보건자료실 Live API 클라이언트
// 비로그인 endpoint 검증 완료 (2026-04-25): 평균 0.298s, rate limit 없음
// 출처: https://portal.kosha.or.kr/archive/cent-archive/master-arch
// 8,976건 카탈로그 (OPS 3,629 / 동영상 803 / 책자 1,133 / 교안 486 / 기타 2,925)

const API_BASE = "https://portal.kosha.or.kr";
const ENDPOINTS = {
  list: `${API_BASE}/api/portal24/bizV/p/VCPDG01007/selectMediaList`,
  fileList: `${API_BASE}/api/portal24/bizA/p/files/getFileList`,
  codes: `${API_BASE}/api/portal24/bizA/p/ACMCA02001/codes`,
} as const;

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  chnlid: "portal24",
  Referer: "https://portal.kosha.or.kr/archive/cent-archive/master-arch",
  "User-Agent":
    "agent-safety-oss/0.1 (+https://github.com/ratelworks/agent-safety-oss)",
};

// shpCd 매핑 — 콘텐츠 형식 코드
export const SHP_CODE_MAP: Record<string, { code: string; ko: string }> = {
  ops: { code: "12", ko: "OPS" },
  video: { code: "02", ko: "동영상" },
  book: { code: "01", ko: "책자" },
  ppt: { code: "07", ko: "교안(PPT)" },
  other: { code: "10", ko: "기타" },
};

// 5개 facet groupId — ACMCA02001/codes 호출용
export const FACET_GROUP_IDS: Record<string, { groupId: string; ko: string }> = {
  ctgr01: { groupId: "CONTS_GNRL_CD", ko: "일반분야" },
  ctgr02: { groupId: "CONTS_MCHN_FXTR_REL_CD", ko: "기계설비" },
  ctgr03: { groupId: "CONTS_JOB_REL_CD", ko: "작업" },
  ctgr04: { groupId: "CONTS_CR_HLTH_REL_CD", ko: "직업건강" },
  ctgr05: { groupId: "CONTS_SPCL_SHP_CD", ko: "특수형태" },
};

// ─── 응답 타입 ───
export interface ArchiveItem {
  contsPblsNo: string; // 발행 번호 (예: "2026-교육총괄실-315")
  medSeq: number; // 시스템 ID
  medName: string; // 제목
  medNote?: string; // 설명
  medKeyword?: string; // 키워드 CSV
  contsRegYmd: string; // 발행일 YYYYMMDD
  contsFbctnShpCd: string; // 형식 코드 (12=OPS 등)
  contsFbctnShpNm: string; // 형식 이름
  contsAtcflNo: string; // 첨부 bundle ID
  thumbPath?: string; // 썸네일 경로
  totHitSum: number; // 조회수
  // 공공누리
  medGonggongnuri?: string; // 유형 코드 (01·02·03·04)
  medGonggongnuriNm?: string; // 유형 이름
  // 페이지네이션 메타 (응답에 포함됨)
  totalCount?: number;
  rnum?: number;
}

export interface ArchiveSearchInput {
  shpCd?: string; // 12 OPS / 02 동영상 / 01 책자 / 07 교안 / 10 기타
  searchValue?: string; // 키워드
  ctgr01?: string; // arrCtgrStr01 (코드)
  ctgr02?: string;
  ctgr03?: string;
  ctgr04?: string;
  ctgr05?: string;
  page?: number;
  rowsPerPage?: number;
}

export interface ArchiveSearchResult {
  total: number; // 응답의 totalCount
  page: number;
  rowsPerPage: number;
  items: ArchiveItem[];
}

export interface ArchiveFileInfo {
  atcflNo: string;
  atcflSeq: number;
  orgnlAtchFileNm: string;
  mimeType?: string | null;
  atcflSz: number; // bytes
  atcflExtnNm: string; // pdf/jpg/...
}

export interface FacetCodeEntry {
  code: string;
  name: string;
}

// ─── 공통 fetch (AbortController 타임아웃) ───
const DEFAULT_TIMEOUT_MS = 30_000;

async function postJson<T>(
  url: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`KOSHA API ${res.status} ${res.statusText} — ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── selectMediaList ───
export async function searchArchive(
  input: ArchiveSearchInput,
): Promise<ArchiveSearchResult> {
  const body = {
    shpCd: input.shpCd ?? "12", // 기본 OPS
    searchCondition: "all",
    searchValue: input.searchValue ?? null,
    ascDesc: "desc",
    ctgr01: input.ctgr01 ? 1 : 0,
    arrCtgrStr01: input.ctgr01 ?? "",
    ctgr02: input.ctgr02 ? 1 : 0,
    arrCtgrStr02: input.ctgr02 ?? "",
    ctgr03: input.ctgr03 ? 1 : 0,
    arrCtgrStr03: input.ctgr03 ?? "",
    ctgr04: input.ctgr04 ? 1 : 0,
    arrCtgrStr04: input.ctgr04 ?? "",
    ctgr05: input.ctgr05 ? 1 : 0,
    arrCtgrStr05: input.ctgr05 ?? "",
    startDt: null,
    endDt: null,
    page: input.page ?? 1,
    rowsPerPage: input.rowsPerPage ?? 10,
  };

  const resp = await postJson<{
    result: string;
    payload: { list: ArchiveItem[] };
  }>(ENDPOINTS.list, body);

  const list = resp.payload?.list ?? [];
  const total = list.length > 0 ? (list[0].totalCount ?? 0) : 0;

  return {
    total,
    page: body.page,
    rowsPerPage: body.rowsPerPage,
    items: list,
  };
}

// ─── getFileList (첨부 bundle 의 파일 목록) ───
export async function getArchiveFiles(
  contsAtcflNo: string,
): Promise<ArchiveFileInfo[]> {
  const resp = await postJson<{
    result: string;
    payload: ArchiveFileInfo[];
  }>(ENDPOINTS.fileList, {
    fileId: contsAtcflNo,
    fileUploadType: "02",
    isDirect: "N",
  });
  return resp.payload ?? [];
}

// ─── ACMCA02001/codes (facet 코드 목록) ───
export async function getFacetCodes(
  groupId: string,
): Promise<FacetCodeEntry[]> {
  const resp = await postJson<{
    result: string;
    payload: { code: string; name: string }[];
  }>(ENDPOINTS.codes, { groupId });
  return (resp.payload ?? []).map((p) => ({ code: p.code, name: p.name }));
}

// 다운로드 URL 조립 (downloadAtchFile)
export function buildDownloadUrl(
  atcflNo: string,
  atcflSeq: number,
  fileName: string,
  mimeType: string = "application/pdf",
): string {
  const enc = encodeURIComponent(fileName);
  return `${API_BASE}/api/portal24/bizA/p/files/downloadAtchFile?atcflNo=${atcflNo}&atcflSeq=${atcflSeq}&isDirect=N&taskSeCd=&fileName=${enc}&mimeType=${mimeType}`;
}
