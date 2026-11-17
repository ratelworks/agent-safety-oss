// ─────────────────────────────────────────────────────────────────────────────
// zip.ts — ZIP 꾸러미를 쓰고 읽는다 (한글 파일과 DocLang 아카이브(.dclx)가 함께 쓴다).
//
// 바깥 꾸러미 없이 Node 내장 zlib 만 쓴다. 같은 입력이면 같은 바이트가 나오도록
// 시각 칸은 고정값을 쓴다. 읽기는 이 도구와 일반 ZIP 도구가 만든 파일(저장·deflate)만 다룬다.
// ─────────────────────────────────────────────────────────────────────────────

import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

// ───── 상수 ─────
const ZIP_VERSION = 20;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
/** 1980-01-01 00:00 — 같은 입력이면 같은 바이트 */
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = (0 << 9) | (1 << 5) | 1;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
/** 끝 기록을 찾을 때 파일 끝에서 거슬러 볼 최대 길이 (끝 기록 22 + 주석 최대 65535) */
const END_SEARCH_MAX = 22 + 0xffff;
/** 풀었을 때 한 항목의 최대 크기 — 압축 폭탄을 막는다 */
const ENTRY_MAX_BYTES = 64 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** 압축하지 않고 넣는다 (한글 파일의 mimetype 처럼 맨 앞에 그대로 두어야 하는 항목) */
  store?: boolean;
}

/** 항목들을 ZIP 바이트로 */
export function zip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.store ? ZIP_METHOD_STORE : ZIP_METHOD_DEFLATE;
    const body = entry.store ? entry.data : deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(ZIP_FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(ZIP_DOS_TIME, 10);
    local.writeUInt16LE(ZIP_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(ZIP_VERSION, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(ZIP_FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(ZIP_DOS_TIME, 12);
    central.writeUInt16LE(ZIP_DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, body);
    centralParts.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

/** ZIP 바이트를 항목 이름 → 내용으로 푼다. ZIP 이 아니거나 읽을 수 없는 방식이면 오류 */
export function unzip(data: Buffer): Map<string, Buffer> {
  // 끝 기록 — 파일 끝에서 거슬러 찾는다
  let endAt = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - END_SEARCH_MAX); i -= 1) {
    if (data.readUInt32LE(i) === SIG_END) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new Error("ZIP 파일이 아닙니다(끝 기록이 없습니다)");
  const count = data.readUInt16LE(endAt + 10);
  let at = data.readUInt32LE(endAt + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== SIG_CENTRAL) throw new Error("ZIP 목록을 읽지 못했습니다");
    const flags = data.readUInt16LE(at + 8);
    const method = data.readUInt16LE(at + 10);
    const compressed = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const localAt = data.readUInt32LE(at + 42);
    const name = data.subarray(at + 46, at + 46 + nameLength).toString(flags & ZIP_FLAG_UTF8 ? "utf8" : "latin1");
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (size > ENTRY_MAX_BYTES) throw new Error(`ZIP 항목이 너무 큽니다: ${name}`);
    if (localAt + 30 > data.length || data.readUInt32LE(localAt) !== SIG_LOCAL) throw new Error(`ZIP 항목을 읽지 못했습니다: ${name}`);
    const bodyAt = localAt + 30 + data.readUInt16LE(localAt + 26) + data.readUInt16LE(localAt + 28);
    const body = data.subarray(bodyAt, bodyAt + compressed);
    let content: Buffer;
    if (method === ZIP_METHOD_STORE) content = Buffer.from(body);
    else if (method === ZIP_METHOD_DEFLATE) content = inflateRawSync(body, { maxOutputLength: ENTRY_MAX_BYTES });
    else throw new Error(`읽을 수 없는 압축 방식입니다(${method}): ${name}`);
    if (content.length !== size) throw new Error(`ZIP 항목의 크기가 맞지 않습니다: ${name}`);
    out.set(name, content);
  }
  return out;
}
