#!/usr/bin/env tsx
/**
 * test-law-coverage.ts — 고시·인용 법령 수록 회귀 시험
 *
 *   1. 인용 법령 목록(scripts/sync/cited-laws.json)의 조문이 전부 노드로 있고, 법제처 원문 출처를 갖췄다
 *   2. 인용 법령 노드는 "인용된 조문만 수록"이라고 밝힌다 (법령 전체가 있는 것처럼 보이지 않게)
 *   3. 고시·규정 수집 목록(sync-admin-rules.ts)의 법령마다 법령 노드와 조문 노드가 있다
 *   4. 조문 조회 도구가 고시 조문·인용 조문을 찾고, 가운뎃점 표기(· / ㆍ)가 달라도 같은 법령으로 찾는다
 *   5. 4법 부칙 — 원문 건수대로 있고, 가리키는 조문이 모두 있고, 옛 번호·다른 법령·부칙 자신의 조를 잇지 않는다
 *   6. 공단 연관 자료 — 「만화로 보는 산업안전보건기준에 관한 규칙」 원본에서 읽은 QR 이 모두 있고, 자료 노드가 그 QR 의 조문을 가리킨다
 *
 * 사용: tsx scripts/test/test-law-coverage.ts
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSafetyLawArticleTool } from "../../src/tools/get-safety-law-article.js";
import { extractRefs, amendedSegment, loadArticleNumbers } from "../sync/sync-supplements.js";

// ── 상수 ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const NODES = resolve(ROOT, "src", "ontology", "graph", "nodes");
const ARTICLES = resolve(NODES, "articles");
const ACTS = resolve(NODES, "acts");
const CITED_LIST = resolve(ROOT, "scripts", "sync", "cited-laws.json");
const ADMIN_SYNC = resolve(ROOT, "scripts", "sync", "sync-admin-rules.ts");
const CITED_NOTE_MARK = "인용하는 조문만";
const SUPPLEMENTS = resolve(NODES, "supplements");
const MEDIA = resolve(NODES, "kosha-media");
const COMIC_QR = resolve(ROOT, "scripts", "sync", "kosha-comic-qr.json");
const MEDIA_STATUS = resolve(ROOT, "scripts", "sync", "kosha-media-status.json");
/** 원본 PDF(2026판 웹용)에서 읽은 QR 수 — 판이 바뀌면 함께 바꾼다 */
const COMIC_QR_COUNT = 1044;
/** 법제처 현행판의 부칙 수 (부칙단위) — 판본을 바꾸면 함께 바꾼다 */
const SUPPLEMENT_UNITS: Record<string, number> = { 산안법: 15, 산안법시행령: 22, 산안법시행규칙: 15, 기준규칙: 31 };
/** 부칙 문장 → 이어야 하는 조문 (원문에서 가져온 사례) — [법령키, 문장, 기대 조문 주소] */
const SUPPLEMENT_REF_CASES: [string, string, string[]][] = [
  // 범위의 가운데 조문은 잇고, 그 뒤에 생긴 가지 조문(제112조의2)은 잇지 않는다
  ["산안법", "다만, 제14조 및 제175조제4항제2호의 개정규정은 … 시행하고, 제110조부터 제116조까지의 개정규정은", ["14", "175", "110", "111", "112", "113", "114", "115", "116"]],
  // 양 끝이 같은 조의 가지 조문이면 가운데 가지 조문도 잇는다
  ["기준규칙", "다만, 제221조의2부터 제221조의4까지의 개정규정은 2023년 7월 1일부터 시행하며", ["221의2", "221의3", "221의4"]],
  // "종전의 제N조" 와 그 나열(괄호 안 포함)은 개정 전 옛 번호라 잇지 않는다
  ["산안법", "이 법 시행 전에 종전의 제15조의3(종전의 제16조제3항, 제30조의2제3항, 제34조의5제4항, 제36조제10항, 제42조제10항 및 제43조제11항에 따라 준용되는 경우를 포함한다)을 위반한 행위", []],
  // 괄호 한정구가 옛 번호 나열을 끊지 않는다
  ["산안법", "제110조부터 제116조까지의 개정규정 시행일 전까지 종전의 제11조제2항제4호, 제41조, 제63조(제41조에 관한 부분에 한정한다), 제65조제2항제12호, 제72조제4항제3호(제41조에 관한 부분에 한정한다) 및 제2호에 따른다", ["110", "111", "112", "113", "114", "115", "116"]],
  // "종전의 법(설명) 제N조" 도 옛 조문
  ["산안법시행규칙", "1. 종전의 법(법률 제16272호로 개정되기 전의 것을 말한다. 이하 제2호에서 같다) 제41조제1항 또는 제6항에 따라", []],
  // "부칙 제N조" 는 부칙 자신, 그 뒤의 지금 조문은 잇는다
  ["산안법시행령", "부칙 제2조제3항에 따라 제77조제1항제2호의 개정규정이 적용되기 전까지는", ["77"]],
  // 시행령 부칙의 "법 제N조" 는 산업안전보건법
  ["산안법시행령", "제86조, 별표 35 제4호러목(법 제35조제5호에 관한 부분으로 한정한다) 및 트목부터 지목까지의 개정규정은", ["86", "산안법:35"]],
  // 「법령명」(설명) 제N조 · "같은 규칙 제N조" 는 이 법령 지금 조문이 아니다
  ["산안법시행규칙", "「산업안전보건법 시행규칙」(고용노동부령 제18호로 개정되기 전의 것을 말한다) 제124조제1항을 따른다.", []],
  ["기준규칙", "종전 규칙에 따라 설치된 피뢰침은 같은 규칙 제357조의 개정규정에 따라 설치된 피뢰침으로 본다.", []],
];
const LAW_SOURCE_HOST = "https://www.law.go.kr/";
/** 조회 도구로 찾을 수 있어야 하는 조문 — [입력, 결과 머리에 있어야 하는 글] */
const LOOKUPS: [string, string][] = [
  ["안전보건교육규정 제2조", "고용노동부고시"],
  ["보호구 안전인증 고시 제3조", "보호구 안전인증 고시"],
  ["건축법 제2조", "# 건축법 §2"],
  ["기상법 제13조의2", "§13의2"],
  // 법제처 원문은 "ㆍ"(U+318D), 입력은 "·"(U+00B7)
  ["유해·위험작업의 취업 제한에 관한 규칙 제3조", "취업 제한에 관한 규칙 §3"],
];

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

interface CitedLaw {
  name: string;
  key: string;
  type: string;
  articles: string[];
  complete?: boolean;
}

async function main(): Promise<void> {
  const files = new Set(await readdir(ARTICLES));
  const laws = JSON.parse(await readFile(CITED_LIST, "utf-8")) as CitedLaw[];

  // 1. 인용 법령 조문 — 노드가 있고, 법제처 출처·판본 표지·본문이 있다
  const missing: string[] = [];
  const unsourced: string[] = [];
  let articleCount = 0;
  for (const law of laws) {
    for (const num of law.articles) {
      articleCount += 1;
      const [main, branch] = num.split("의");
      const head = `제${main}조${branch ? `의${branch}` : ""}`;
      const file = `${law.key}-§${num}.jsonld`;
      if (!files.has(file)) {
        missing.push(`${law.key} ${head}`);
        continue;
      }
      const node = JSON.parse(await readFile(resolve(ARTICLES, file), "utf-8")) as {
        verificationStatus?: string;
        description?: string;
        _meta?: { sourceUrl?: string; lawServiceMST?: string };
      };
      const ok =
        node.verificationStatus === "verified" &&
        (node._meta?.sourceUrl ?? "").startsWith(LAW_SOURCE_HOST) &&
        Boolean(node._meta?.lawServiceMST) &&
        (node.description ?? "").startsWith(head);
      if (!ok) unsourced.push(`${law.key} ${head}`);
    }
  }
  check(`인용 법령 ${laws.length}종의 조문 ${articleCount}개가 모두 노드로 있다`, missing.length === 0, missing.slice(0, 5).join(", "));
  check("인용 조문은 모두 법제처 원문 출처·판본 표지를 갖추고 본문이 그 조문으로 시작한다", unsourced.length === 0, unsourced.slice(0, 5).join(", "));

  // 2. 인용 법령의 법령 노드는 "인용된 조문만 수록"이라고 밝힌다
  const acts = await Promise.all(
    (await readdir(ACTS)).filter((f) => f.endsWith(".jsonld")).map(async (f) => JSON.parse(await readFile(resolve(ACTS, f), "utf-8")) as Record<string, unknown>),
  );
  const unmarked: string[] = [];
  const searchHidden: string[] = [];
  for (const law of laws) {
    // 전체 조문을 실은 법령은 인용 표지 대신 검색에 나와야 한다
    if (law.complete) {
      for (const num of law.articles) {
        const node = JSON.parse(await readFile(resolve(ARTICLES, `${law.key}-§${num}.jsonld`), "utf-8")) as { userVisible?: boolean };
        if (node.userVisible === false) searchHidden.push(`${law.key} 제${num}조`);
      }
      continue;
    }
    const act = acts.find((a) => Array.isArray(a.hasArticle) && (a.hasArticle as string[]).includes(`art:${law.key}:${law.articles[0]}`));
    if (!act) {
      unmarked.push(`${law.key}(법령 노드 없음)`);
      continue;
    }
    // 이미 있던 법령 노드(건설기술 진흥법 등)는 다른 조문도 가지므로, 새로 만든 노드만 표지를 요구한다
    const meta = JSON.stringify(act._meta ?? {});
    const ownArticles = (act.hasArticle as string[]).every((iri) => iri.startsWith(`art:${law.key}:`));
    if (ownArticles && (act.hasArticle as string[]).length === law.articles.length && !meta.includes(CITED_NOTE_MARK)) unmarked.push(law.key);
  }
  check("인용 법령의 법령 노드는 인용된 조문만 수록했다고 밝힌다", unmarked.length === 0, unmarked.slice(0, 5).join(", "));
  check("전체 조문을 실은 법령(취업제한규칙 등)은 현장 브리핑·조문 검색에서 빠지지 않는다", searchHidden.length === 0, searchHidden.slice(0, 3).join(", "));

  // 3. 고시·규정 수집 목록의 법령마다 법령 노드와 조문이 있다
  const adminSrc = await readFile(ADMIN_SYNC, "utf-8");
  const adminKeys = [...adminSrc.matchAll(/\{ actKey: "([^"]+)", id: "(\d+)", actSlug: "([^"]+)"/g)].map((m) => ({ key: m[1], slug: m[3] }));
  const emptyAdmin: string[] = [];
  for (const { key, slug } of adminKeys) {
    const hasAct = acts.some((a) => a["@id"] === `act:${slug}`);
    const hasArticle = [...files].some((f) => f.startsWith(`${key}-§`));
    if (!hasAct || !hasArticle) emptyAdmin.push(key);
  }
  check(`고시·규정 수집 목록 ${adminKeys.length}종 모두 법령 노드와 조문이 있다`, adminKeys.length > 0 && emptyAdmin.length === 0, emptyAdmin.join(", "));

  // 4. 조회 도구 — 고시 조문·인용 조문·가운뎃점 표기 차이
  for (const [ref, expected] of LOOKUPS) {
    const text = (await getSafetyLawArticleTool.handler({ ref })).content[0]?.text ?? "";
    const head = text.split("\n").slice(0, 4).join("\n");
    check(`조문 조회: ${ref}`, !head.includes("조회 실패") && head.includes(expected), head.split("\n")[0]);
  }

  // 5. 4법 부칙
  const supplements = await Promise.all(
    (await readdir(SUPPLEMENTS)).filter((f) => f.endsWith(".jsonld")).map(async (f) => JSON.parse(await readFile(resolve(SUPPLEMENTS, f), "utf-8")) as Record<string, any>),
  );
  const units = new Map<string, Set<string>>();
  for (const s of supplements) {
    const law = String(s["@id"]).split(":")[1];
    units.set(law, (units.get(law) ?? new Set()).add(s._meta?.promulgationNo));
  }
  const unitMismatch = Object.entries(SUPPLEMENT_UNITS).filter(([law, n]) => (units.get(law)?.size ?? 0) !== n);
  check("4법 부칙 수가 법제처 현행판과 같다", unitMismatch.length === 0, unitMismatch.map(([law, n]) => `${law} ${units.get(law)?.size ?? 0}/${n}`).join(", "));
  const allIds = new Set([...files].map((f) => f.match(/^(.+)-§(.+)\.jsonld$/)).filter(Boolean).map((m) => `art:${m![1]}:${m![2]}`));
  const dangling = supplements.flatMap((s) => (s.references ?? []).filter((r: string) => !allIds.has(r)).map((r: string) => `${s["@id"]}→${r}`));
  check("부칙이 가리키는 조문은 모두 있는 조문이다", dangling.length === 0, dangling.slice(0, 3).join(", "));
  const noSource = supplements.filter((s) => !(s._meta?.sourceUrl ?? "").startsWith(LAW_SOURCE_HOST) || !s.description || !s.supplementKind);
  check("부칙 노드는 모두 원문·출처·성격을 갖췄다", noSource.length === 0, noSource.slice(0, 3).map((s) => s["@id"]).join(", "));
  const numbers = await loadArticleNumbers();
  for (const [law, text, expected] of SUPPLEMENT_REF_CASES) {
    const want = expected.map((e) => (e.includes(":") ? `art:${e}` : `art:${law}:${e}`)).sort();
    const got = extractRefs(text, law, numbers).refs.sort();
    check(`부칙 연결: ${text.slice(0, 40)}…`, JSON.stringify(got) === JSON.stringify(want), `기대 ${want.join(",") || "없음"} / 결과 ${got.join(",") || "없음"}`);
  }
  // 다른 법령이 이 법령을 고친 부칙 — 이 법령 문단만, 따옴표 속 고치는 문구는 빼고
  const amendLines = ["제4조(다른 법령의 개정) ①부터 ⑩까지 생략", "⑪ 산업안전보건법 시행령 일부를 다음과 같이 개정한다.", '제97조제2항 중 "간호사"를 "「간호법」에 따른 간호사"로 한다.', '별표 10 제2호가목3) 중 "「의료법」 제78조"를 "「간호법」 제5조"로 한다.', "⑫ 다른 법 시행령 일부를 다음과 같이 개정한다.", "제5조 중 …"];
  const amended = extractRefs(amendedSegment(amendLines, "산업안전보건법 시행령").join("\n"), "산안법시행령", numbers).refs;
  check("다른 법령이 고친 부칙은 이 법령 문단의 조문만 잇는다", JSON.stringify(amended) === JSON.stringify(["art:산안법시행령:97"]), amended.join(","));
  // 조회 결과에 부칙이 붙는다
  // 법령 본문 파일로 찾는 표기(§)와 조문 노드로 찾는 표기(제N조) 둘 다
  for (const ref of ["산안법 §110", "산안법 제110조"]) {
    const withSupp = (await getSafetyLawArticleTool.handler({ ref })).content[0]?.text ?? "";
    check(`조문 조회에 그 조문을 언급한 부칙이 붙는다 (${ref})`, withSupp.includes("## 이 조문에 관한 부칙") && withSupp.includes("부칙 <제16272호"), withSupp.includes("이 조문에 관한 부칙") ? "있음" : "없음");
  }

  // 6. 공단 연관 자료
  const comic = JSON.parse(await readFile(COMIC_QR, "utf-8")) as { occurrences: { article: string | null; url: string }[] };
  check(`원본에서 읽은 QR 이 ${COMIC_QR_COUNT}개다`, comic.occurrences.length === COMIC_QR_COUNT, `${comic.occurrences.length}개`);
  const noArticleNode = comic.occurrences.filter((o) => o.article && !files.has(`기준규칙-§${o.article}.jsonld`)).map((o) => o.article);
  check("QR 을 붙인 조문은 모두 있는 안전보건규칙 조문이다", noArticleNode.length === 0, [...new Set(noArticleNode)].slice(0, 5).join(", "));
  const media = await Promise.all(
    (await readdir(MEDIA)).filter((f) => f.endsWith(".jsonld")).map(async (f) => JSON.parse(await readFile(resolve(MEDIA, f), "utf-8")) as Record<string, any>),
  );
  const badMedia = media.filter((m) => !m.title || !String(m._meta?.sourceUrl ?? "").startsWith("https://portal.kosha.or.kr/") || (m.relatedArticles ?? []).some((a: string) => !allIds.has(a)));
  check(`공단 자료 노드 ${media.length}개 모두 제목·공단 자료실 주소가 있고 가리키는 조문이 있다`, media.length > 0 && badMedia.length === 0, badMedia.slice(0, 3).map((m) => m["@id"]).join(", "));
  const linkedArticles = new Set(media.flatMap((m) => m.relatedArticles ?? []));
  // 자료실에서 내려간 자료의 QR 만 실린 조문은 이을 자료가 없다
  const goneUrls = new Set(
    (JSON.parse(await readFile(MEDIA_STATUS, "utf-8")) as { unavailable: { qrUrls: string[] }[] }).unavailable.flatMap((u) => u.qrUrls),
  );
  const qrArticles = new Set(comic.occurrences.filter((o) => o.article && !goneUrls.has(o.url)).map((o) => `art:기준규칙:${o.article}`));
  const notLinked = [...qrArticles].filter((a) => !linkedArticles.has(a));
  check("QR 이 실린 조문은 모두 공단 자료 노드와 이어졌다", notLinked.length === 0, notLinked.slice(0, 5).join(", "));
  const withMedia = (await getSafetyLawArticleTool.handler({ ref: "산안기준규칙 §3" })).content[0]?.text ?? "";
  check("조문 조회에 그 조문 옆 QR 의 공단 자료가 붙는다", withMedia.includes("## 공단 연관 자료") && withMedia.includes("portal.kosha.or.kr"), withMedia.includes("공단 연관 자료") ? "있음" : "없음");

  if (failed > 0) {
    console.error(`\n❌ ${failed}개 실패`);
    process.exit(1);
  }
  console.log("\n✅ 전체 통과");
}

void main();
