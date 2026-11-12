#!/usr/bin/env tsx
/**
 * test-field-questions.ts — 현장 말투 질문에 정답 조문이 나오는지 잰다
 *
 * 무엇을 재나
 *   fixtures/field-questions.json 의 질문을 도구에 그대로 넣고, 돌아온 글에
 *   그 상황에서 반드시 나와야 하는 안전보건규칙 조문이 들어 있는지 센다.
 *   응답이 길어졌는지가 아니라, 맞는 조문이 빠지지 않는지를 본다.
 *   통과 기준(--min)은 "한 도구의 답 하나에 정답이 다 나온 질문" 비율이다 — 여러 도구에 나뉘어 나온 것은 세지 않는다.
 *
 * 사용
 *   tsx scripts/test/test-field-questions.ts                 현재 빌드
 *   tsx scripts/test/test-field-questions.ts --root <폴더>   다른 빌드 (전후 비교)
 *   tsx scripts/test/test-field-questions.ts --min 60        질문 적중률(%)이 이보다 낮으면 exit 1
 *   tsx scripts/test/test-field-questions.ts --verbose       빠진 조문을 질문별로 출력
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const FIXTURE = resolve(__dirname, "fixtures", "field-questions.json");
/** 질문을 자연어로 받는 도구와 그 입력 이름 */
const TOOLS: { name: string; flag: string; label: string }[] = [
  { name: "field_safety_briefing", flag: "--workOrTopic", label: "현장 브리핑" },
  { name: "analyze_construction_work_risks", flag: "--workType", label: "작업 위험 분석" },
  { name: "generate_tbm_topics", flag: "--activityLabel", label: "TBM 주제" },
];
/** 안전보건규칙을 가리키는 이름 — 번호만 같은 다른 법의 조문은 세지 않는다 */
const RULE_NAME = "(?:산업안전보건기준에\\s*관한\\s*규칙|안전보건규칙|산안기준규칙|기준규칙)";
const CONCURRENCY = 6;
const MAX_BUFFER = 64 * 1024 * 1024;

const run = promisify(execFile);

interface Question {
  id: string;
  question: string;
  expect: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** "619의2" → 글 안에 그 조문이 있는가 ("규칙 이름 + 제N조/§N" 또는 조문 주소) */
function hasArticle(text: string, ref: string): boolean {
  const [num, sub] = ref.split("의");
  const tail = sub ? `\\s*의\\s*${sub}(?!\\d)` : "(?!\\s*의\\s*\\d)(?!\\d)";
  const named = new RegExp(`${RULE_NAME}\\s*(?:제\\s*${num}\\s*조|§\\s*${num})${tail}`);
  const iri = new RegExp(`art:기준규칙:${num}${sub ? `의${sub}(?!\\d)` : "(?![\\d의])"}`);
  return named.test(text) || iri.test(text);
}

async function callTool(root: string, tool: string, flag: string, value: string): Promise<string> {
  try {
    const { stdout } = await run("node", ["build/cli.js", "call", tool, flag, value], { cwd: root, maxBuffer: MAX_BUFFER });
    const parsed = JSON.parse(stdout.slice(stdout.indexOf("{"))) as { content?: { text?: string }[] };
    return parsed.content?.[0]?.text ?? "";
  } catch {
    return "";
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main(): Promise<void> {
  const root = resolve(arg("--root") ?? REPO);
  const min = arg("--min") ? Number(arg("--min")) : undefined;
  const verbose = process.argv.includes("--verbose");
  const { questions } = JSON.parse(await readFile(FIXTURE, "utf-8")) as { questions: Question[] };

  const answers = await mapLimit(questions, CONCURRENCY, async (q) => {
    const texts: string[] = [];
    for (const t of TOOLS) texts.push(await callTool(root, t.name, t.flag, q.question));
    return texts;
  });

  console.log(`빌드: ${root}`);
  console.log(`질문 ${questions.length}개 · 정답 조문 ${questions.reduce((n, q) => n + q.expect.length, 0)}개\n`);

  const columns = [...TOOLS.map((t) => t.label), "세 도구를 합쳐"];
  /** 한 도구의 답 하나에 정답이 다 나온 질문 */
  let singleToolHits = 0;
  const articleHits = columns.map(() => 0);
  const questionHits = columns.map(() => 0);
  const bytes = TOOLS.map(() => 0);
  const missed: string[] = [];

  questions.forEach((q, qi) => {
    const texts = [...answers[qi], answers[qi].join("\n")];
    const single = answers[qi].some((text) => q.expect.every((ref) => hasArticle(text, ref)));
    if (single) singleToolHits += 1;
    texts.forEach((text, ci) => {
      const found = q.expect.filter((ref) => hasArticle(text, ref));
      articleHits[ci] += found.length;
      if (found.length === q.expect.length) questionHits[ci] += 1;
      if (ci < TOOLS.length) bytes[ci] += Buffer.byteLength(text, "utf-8");
      if (ci === columns.length - 1 && !single) {
        const absent = q.expect.filter((r) => !found.includes(r)).map((r) => `제${r}조`);
        missed.push(`${q.id} ${q.question} — ${absent.length ? `어느 도구에도 없음: ${absent.join(", ")}` : "정답이 여러 도구에 나뉘어 나옴"}`);
      }
    });
  });

  const totalArticles = questions.reduce((n, q) => n + q.expect.length, 0);
  columns.forEach((label, ci) => {
    const size = ci < TOOLS.length ? ` · 응답 ${Math.round(bytes[ci] / 1024)}KB` : "";
    console.log(
      `${label}: 정답 조문 ${articleHits[ci]}/${totalArticles} · 정답이 다 나온 질문 ${questionHits[ci]}/${questions.length}${size}`,
    );
  });

  if (verbose || min !== undefined) {
    console.log(`\n한 도구의 답에 정답이 다 나오지 않은 질문 ${missed.length}개`);
    for (const line of missed) console.log(`  ${line}`);
  }

  console.log(`\n한 도구의 답 하나에 정답이 다 나온 질문: ${singleToolHits}/${questions.length}`);
  const rate = (singleToolHits / questions.length) * 100;
  if (min !== undefined && rate < min) {
    console.error(`\n❌ 질문 적중률 ${rate.toFixed(1)}% < 기준 ${min}%`);
    process.exit(1);
  }
}

void main();
