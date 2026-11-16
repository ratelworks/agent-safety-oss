/**
 * storage.ts — 호스트 저장 주입 모드의 공개 계약 (엔진 중립)
 *
 * 이 엔진을 다른 서비스(호스트) 안에서 쓸 때, 호스트가 요청마다 넘기는 저장·파일·시계·추적의 모양이다.
 * 단독 사용(MCP 서버·CLI·브라우저 폼)은 이 계약을 쓰지 않고 지금까지의 로컬 저장(`~/.agent-safety-oss/`)을 그대로 쓴다.
 *
 * 저장 인터페이스는 종류(kind)·id 로 값을 읽고 쓰는 네 가지(get/list/put/remove)뿐이다.
 * 엔진은 한 번의 도구 실행에서 먼저 읽고, 메모리에서 계산한 뒤, 마지막에 한 번에 쓴다 — 저장 인터페이스에 "쓴 뒤 읽기"를 보내지 않는다.
 *
 * 의존성 0 — 타입과 메모리 저장(시험·예시용)만 있다.
 */

/** 엔진이 쓰는 저장 종류(호스트는 이 이름 그대로 받는다) */
export const SAFETY_STORAGE_KINDS = [
  "profile", //          회사 프로필 — 사업장·현장에 속하지 않은 인력·장비 (id: "company")
  "project_profile", //  현장별 프로필 — 현장 정보와 그 현장의 인력·장비·수급업체 (id: 현장 식별자)
  "draft", //            작성 중 양식 입력값 (id: 문서 종류)
  "document", //         보관 문서의 기록 — 본문 바이트는 결과의 files 로 호스트에 넘긴다
  "photo", //            사진 증빙 기록 — 사진 바이트는 호스트 파일 자리에 있다
  "issue", //            안전 이슈
  "action", //           개선조치
  "report", //           운영 보고서
  "activity", //         활동 기록 (쓰기 작업마다 한 줄)
] as const;
export type SafetyStorageKind = (typeof SAFETY_STORAGE_KINDS)[number];

/** 회사 프로필 기록의 id */
export const COMPANY_PROFILE_ID = "company";

/** list 가 돌려주는 한 건 */
export interface SafetyStorageRecord {
  id: string;
  value: unknown;
}

/**
 * 호스트가 주는 저장 인터페이스 — 회사 하나로 고정된 인스턴스.
 * put·remove 는 값을 바로 쓰든 모아 두었다가 쓰든 호스트 마음이다(Promise 를 돌려줘도 된다).
 * 엔진은 한 번의 도구 실행에서 put·remove 를 모두 마지막에 보내며, 그 뒤에는 같은 실행에서 get·list 를 부르지 않는다.
 */
export interface SafetyStorage {
  get(kind: string, id: string): Promise<unknown | undefined>;
  list(kind: string): Promise<SafetyStorageRecord[]>;
  put(kind: string, id: string, value: unknown): void | Promise<void>;
  remove(kind: string, id: string): void | Promise<void>;
}

/** 호스트 파일 자리에서 읽은 파일 */
export interface SafetyFileIn {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** 입력의 파일 칸(사진의 filePath 등)에 들어온 참조를 호스트 파일 자리에서 읽는다 — 엔진은 로컬 경로를 열지 않는다 */
export interface SafetyFileReader {
  read(ref: string): Promise<SafetyFileIn>;
}

/** 엔진이 낸 파일(보관 문서·한글 파일·보고서 본문) — 저장은 호스트가 한다 */
export interface SafetyFileOut {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  /** 문서 종류(양식 docId 또는 safety_report) */
  documentKind: string;
  /** 바이트의 SHA-256 (같은 내용을 다시 내면 같은 값 — 호스트가 중복 저장을 피할 때 쓴다) */
  sha256: string;
}

/** 시계 — 같은 시각을 주면 같은 식별자·기록이 나온다 */
export interface SafetyClock {
  now(): Date;
}

/** 안전한 추적 이벤트: 이름과 숫자·참거짓 값만(글은 싣지 않는다 — 개인정보가 섞이지 않게) */
export interface SafetyTraceEvent {
  name: string;
  values?: Readonly<Record<string, number | boolean>>;
}

/** 요청 범위 — 회사는 저장 인스턴스가 정하고, 현장은 여기서 정한다 */
export interface SafetyScope {
  /** 현장(공사) 식별자. 주면 그 현장의 기록만 읽고 쓴다. 생략하면 회사 범위 */
  projectId?: string;
}

/** 실행이 저장 인터페이스로 보낸 쓰기 한 건 */
export interface SafetyWriteRef {
  kind: string;
  id: string;
  op: "put" | "remove";
}

/**
 * 메모리 저장 — 시험·예시용 참조 구현. 회사마다 하나씩 만든다.
 * 실제 호스트는 자기 저장소(데이터베이스·문서 저장소)로 같은 모양을 구현한다.
 */
export function createMemorySafetyStorage(): SafetyStorage & { snapshot(): Record<string, Record<string, unknown>> } {
  const data = new Map<string, Map<string, unknown>>();
  const bucket = (kind: string): Map<string, unknown> => {
    let found = data.get(kind);
    if (!found) {
      found = new Map();
      data.set(kind, found);
    }
    return found;
  };
  const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));
  return {
    async get(kind, id) {
      return copy(bucket(kind).get(id));
    },
    async list(kind) {
      return [...bucket(kind).entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, value]) => ({ id, value: copy(value) }));
    },
    put(kind, id, value) {
      bucket(kind).set(id, copy(value));
    },
    remove(kind, id) {
      bucket(kind).delete(id);
    },
    snapshot() {
      const out: Record<string, Record<string, unknown>> = {};
      for (const [kind, records] of data) {
        if (records.size === 0) continue;
        out[kind] = Object.fromEntries([...records.entries()].map(([id, value]) => [id, copy(value)]));
      }
      return out;
    },
  };
}
