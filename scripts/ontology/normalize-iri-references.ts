// ─────────────────────────────────────────────────────────────────────────────
// normalize-iri-references
//
// 그래프 노드의 legalBasis / appliesTo / penaltyOnMissing / source 필드의
// 자연어 표현을 표준 IRI 로 변환. JSON-LD 표준 (`@type: "@id"`) 위반 해소.
//
// 사용:
//   npx tsx scripts/ontology/normalize-iri-references.ts          # dry-run (변환 미리보기)
//   npx tsx scripts/ontology/normalize-iri-references.ts --apply  # 실제 파일 수정
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const NODES_ROOT = join(REPO_ROOT, "src/ontology/graph/nodes");

// ─── 자연어 → IRI 변환 룰 ───
//
// legalBasis: "법령명 §조" 패턴
const LAW_NAME_MAP: Array<[RegExp, string]> = [
  // 더 구체적인 패턴이 먼저 와야 함 (예: "산안법 시행령" 이 "산안법" 보다 먼저)
  [/^(산업안전보건법\s*시행규칙|산안법\s*시행규칙|시행규칙)\s*$/, "art:산안법시행규칙"],
  [/^(산업안전보건법\s*시행령|산안법\s*시행령|시행령)\s*$/, "art:산안법시행령"],
  [/^(산업안전보건기준에\s*관한\s*규칙|산안기준규칙|기준규칙)\s*$/, "art:기준규칙"],
  [/^(중대재해처벌법\s*시행령|중처법\s*시행령)\s*$/, "art:중처법시행령"],
  [/^(중대재해처벌법|중처법)\s*$/, "art:중처법"],
  [/^(위험성평가\s*고시|고시)\s*$/, "art:위험성평가고시"],
  [/^(산업안전보건법|산안법)\s*$/, "art:산안법"],
];

const ANNEX_LAW_MAP: Array<[RegExp, string]> = [
  [/^(시행규칙|산업안전보건법\s*시행규칙)\s*$/, "annex:산안법시행규칙"],
  [/^(시행령|산업안전보건법\s*시행령)\s*$/, "annex:산안법시행령"],
  [/^(산안기준규칙|기준규칙)\s*$/, "annex:기준규칙"],
  [/^(산업안전보건법|산안법)\s*$/, "annex:산안법"],
];

// appliesTo: 자연어 사업장 묘사 → applicability 노드 매핑
const APPLIES_TO_MAP: Array<[RegExp, string]> = [
  [/5인\s*이상.*사업/, "applic:five_persons_or_more"],
  [/50인\s*이상/, "applic:fifty_persons_or_more"],
  [/50인\s*미만/, "applic:under_50_persons"],
  [/50억\s*이상/, "applic:construction_50bn_plus"],
  [/50억\s*미만/, "applic:construction_under_50bn"],
  [/모든\s*건설공사/, "applic:construction_all"],
  [/굴착\s*작업.*모든\s*사업장|모든\s*사업장.*굴착/, "applic:all_workplace_with_excavation"],
  [/상시평가\s*선택/, "applic:ongoing_assessment_selected"],
  // 가장 일반적인 매칭은 마지막
  [/모든\s*사업장|모든\s*사업|신규\s*사업장|변경\s*사항|도급\s*발생|관리감독자|유해인자|측정\s*대상/, "applic:all_workplace"],
];

interface Conversion {
  file: string;
  field: string;
  before: unknown;
  after: unknown;
}

// ─── 단일 자연어 표현 → IRI 변환 ───
function convertLegalBasis(s: string): string | string[] | null {
  // 복합 표현 분리: " + " · "·" · "," 로 분리
  if (/\s\+\s|·|,/.test(s)) {
    const parts = s.split(/\s\+\s|·|,/).map((p) => p.trim()).filter(Boolean);
    const converted = parts.map((p) => convertLegalBasis(p));
    if (converted.every((c) => c !== null)) {
      // flatten
      const flat: string[] = [];
      for (const c of converted) {
        if (Array.isArray(c)) flat.push(...c);
        else if (c) flat.push(c);
      }
      return flat;
    }
    return null;
  }

  // "법령명 §조[ 항/호/별표]" 파싱
  // 예: "산안법 §38", "시행규칙 §86", "고시 §15 ②", "산안기준규칙 §38 별표 4 제6호 마목"
  const articleMatch = s.match(/^(.+?)\s*§\s*([0-9]+(?:의[0-9]+)?)/);
  if (articleMatch) {
    const lawName = articleMatch[1].trim();
    const articleNum = articleMatch[2];
    for (const [re, prefix] of LAW_NAME_MAP) {
      if (re.test(lawName)) {
        return `${prefix}:${articleNum}`;
      }
    }
  }

  // "법령명 별표 X" 또는 "별표 X호"
  const annexMatch = s.match(/^(.+?)\s*별표\s*([0-9]+(?:호)?)/);
  if (annexMatch) {
    const lawName = annexMatch[1].trim();
    const annexNum = annexMatch[2].replace("호", "");
    for (const [re, prefix] of ANNEX_LAW_MAP) {
      if (re.test(lawName)) {
        return `${prefix}:별표${annexNum}`;
      }
    }
  }

  return null; // 변환 실패
}

function convertAppliesTo(s: string): string | null {
  for (const [re, iri] of APPLIES_TO_MAP) {
    if (re.test(s)) return iri;
  }
  return null;
}

function convertPenalty(s: string): string | null {
  // "penalty:산안법:175 (5천만원 이하 과태료)" → "penalty:산안법:175"
  const m = s.match(/^(penalty:[^\s(]+)/);
  return m ? m[1] : null;
}

// ─── 노드 순회 + 변환 ───
function processNode(filePath: string, node: any, conversions: Conversion[]): boolean {
  let changed = false;

  function processField(fieldName: string, converter: (s: string) => string | string[] | null) {
    const val = node[fieldName];
    if (val === undefined) return;
    const isArr = Array.isArray(val);
    const items = isArr ? val : [val];
    const converted: string[] = [];
    let anyChanged = false;
    for (const item of items) {
      if (typeof item !== "string") {
        converted.push(item as any);
        continue;
      }
      // 이미 표준 IRI 면 그대로
      if (/^[a-z]+:[^,()\s][^\s]*$/.test(item)) {
        converted.push(item);
        continue;
      }
      const result = converter(item);
      if (result === null) {
        converted.push(item); // 변환 실패 → 원본 유지
        continue;
      }
      anyChanged = true;
      if (Array.isArray(result)) converted.push(...result);
      else converted.push(result);
    }
    if (anyChanged) {
      const before = node[fieldName];
      // 단일 IRI 결과는 단일로, 다중은 배열로
      const newVal = converted.length === 1 && !isArr ? converted[0] : Array.from(new Set(converted));
      node[fieldName] = newVal;
      conversions.push({ file: filePath, field: fieldName, before, after: newVal });
      changed = true;
    }
  }

  processField("legalBasis", convertLegalBasis);
  processField("appliesTo", convertAppliesTo);
  processField("penaltyOnMissing", convertPenalty);

  // 중첩 객체 (reviewRules 등) 도 처리
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("@") || k === "_meta") continue;
    if (typeof v === "object" && v !== null) {
      const nested = processNestedObject(filePath, v, conversions);
      if (nested) changed = true;
    }
  }

  return changed;
}

function processNestedObject(filePath: string, obj: any, conversions: Conversion[]): boolean {
  if (Array.isArray(obj)) {
    let any = false;
    obj.forEach((item) => {
      if (typeof item === "object" && item !== null) {
        if (processNestedObject(filePath, item, conversions)) any = true;
      }
    });
    return any;
  }
  if (typeof obj !== "object" || obj === null) return false;

  let changed = false;
  for (const fieldName of ["legalBasis", "appliesTo", "penaltyOnMissing", "source", "sourceLaw"]) {
    const val = obj[fieldName];
    if (typeof val !== "string") continue;
    if (/^[a-z]+:[^,()\s][^\s]*$/.test(val)) continue;

    let result: string | string[] | null = null;
    if (fieldName === "legalBasis" || fieldName === "source" || fieldName === "sourceLaw") {
      result = convertLegalBasis(val);
    } else if (fieldName === "appliesTo") {
      result = convertAppliesTo(val);
    } else if (fieldName === "penaltyOnMissing") {
      result = convertPenalty(val);
    }
    if (result === null) continue;

    const before = obj[fieldName];
    obj[fieldName] = Array.isArray(result) && result.length === 1 ? result[0] : result;
    conversions.push({ file: filePath, field: fieldName, before, after: obj[fieldName] });
    changed = true;
  }

  for (const v of Object.values(obj)) {
    if (typeof v === "object" && v !== null) {
      if (processNestedObject(filePath, v, conversions)) changed = true;
    }
  }
  return changed;
}

// ─── 메인 ───
function main() {
  const apply = process.argv.includes("--apply");
  const conversions: Conversion[] = [];
  const changedFiles: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".jsonld")) {
        const raw = readFileSync(full, "utf8");
        let node;
        try {
          node = JSON.parse(raw);
        } catch {
          continue;
        }
        const before = JSON.stringify(node);
        if (processNode(full, node, conversions)) {
          changedFiles.push(full);
          if (apply) {
            // JSON 들여쓰기 2칸 + 끝 줄바꿈 (기존 파일 컨벤션)
            writeFileSync(full, JSON.stringify(node, null, 2) + "\n");
          }
        }
      }
    }
  }
  walk(NODES_ROOT);

  console.log(`\n=== ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`변환 적용 파일: ${changedFiles.length}`);
  console.log(`총 변환 건수: ${conversions.length}\n`);

  // 변환 미리보기 (최대 30건)
  for (const c of conversions.slice(0, 30)) {
    console.log(`${relative(REPO_ROOT, c.file)} :: ${c.field}`);
    console.log(`  before: ${JSON.stringify(c.before)}`);
    console.log(`  after:  ${JSON.stringify(c.after)}`);
  }
  if (conversions.length > 30) {
    console.log(`\n... ${conversions.length - 30}건 더 (dry-run 결과 일부만 표시)`);
  }

  if (!apply) {
    console.log(`\n적용하려면: npx tsx scripts/ontology/normalize-iri-references.ts --apply`);
  }
}

main();
