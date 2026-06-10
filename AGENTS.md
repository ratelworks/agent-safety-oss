# AGENTS.md — agent-safety-oss

> Common SSoT for Claude Code, Codex CLI, Cursor, Continue.dev. Read this first.

## Project Context

`agent-safety-oss` is an MCP server that helps Korean construction-site safety managers
and site supervisors draft and review the 19 statutory safety documents (TBM, work plans,
risk assessments, MSDS ledgers, accident reports, …). It bundles core articles from the
Occupational Safety and Health Act family, 1,000+ KOSHA technical guides, official forms,
and a hazard–control knowledge graph, so the LLM cites real sources instead of guessing.

- **Surfaces**: MCP server (stdio, `agent-safety-oss serve`) + CLI (`agent-safety-oss tools|call`) + browser form viewer (`agent-safety-oss viewer`, Google A2UI)
- **The human stays in charge**: the tool drafts and reviews; legal judgement, signing, and submission remain with the safety manager
- **Domain boundary**: construction safety only — no chemical PSM, no healthcare, no manufacturing lines
- **Offline-first**: laws, KOSHA guides, forms, and the graph are bundled; only 7 of the MCP tools call public OpenAPIs (key required)

## Build & Test

```bash
npm install
npm run build            # tsc + ontology asset copy + inventory + docs sync
npm test                 # essence gate + lightweight gate + docs drift + e2e smoke
npm run typecheck        # src + build + scripts
npm run mcp:tools        # list registered MCP tools
npm run mcp:test:graph   # graph reasoning / consistency / effect
npm run audit:strict     # strict graph-health audit
npm run check:oss-hygiene  # public-repo hygiene gate (also runs in prepublishOnly)
```

MCP Inspector UI: `npm run mcp:inspect`. Field-style document review: `npm run mcp:test:field-user`.

## Stack & Conventions

- Runtime: **Node.js >=20.19**, ES Modules, TypeScript `strict`
- MCP: `@modelcontextprotocol/sdk` (stdio transport) · CLI: `commander` · Validation: `zod`
- Graph: `graphology` over JSON-LD 1.1 node files (`src/ontology/graph/nodes/**`)
- Standards: JSON-LD 1.1, RDF/OWL, SKOS, PROV-O, schema.org, ISO 45001; SHACL shapes for node validation
- Comments: Korean (개발 주체가 라텔웍스). User-facing document output is Korean by design (target users are Korean safety managers).
- Constants at the top of the file they belong to

## Critical Rules

1. **The graph is the SSoT.** Tools must read legal/hazard/control facts from graph nodes (IRIs), never hardcode them in code paths (`decisions/005`).
2. **Correct evidence beats coverage.** Do not over-dump hazards or guides into documents; wrong-but-plausible citations are the failure mode this project exists to prevent (`decisions/004`, `006`).
3. **LLM never invents legal bases.** Mandatory-sounding language without a law-grade basis must be caught by `verify_safety_basis`; keep that guardrail intact.
4. **Identity gate for new features**: "does it directly help a safety manager draft one of the 19 statutory documents?" — if no, it likely belongs elsewhere (`docs/IDENTITY.md`, CONTRIBUTING §1).
5. **`prepublishOnly` chain is the release gate** (hygiene → build → essence → verify-all → quality). Never bypass; fix the cause.
6. **Public-data licensing**: KOSHA/MoEL originals follow 공공누리 conditions — some forms ship as download-URL placeholders on purpose; do not bundle restricted binaries.
7. **No PII, no internal-operations vocabulary** in any tracked file — `npm run check:oss-hygiene` blocks publish/merge on violation.

## File Structure

```
src/
├── index.ts / cli.ts / viewer.ts   # MCP server · CLI · A2UI form viewer entries
├── tool-registry.ts                # tool registration (92 tools)
├── tools/                          # one file per MCP tool (kebab-case)
├── ontology/
│   ├── graph/nodes/**              # JSON-LD graph nodes (hazards, controls, activities, …)
│   ├── safety-laws/*.md            # bundled law articles
│   ├── guides/ · forms/ · kras-methods/
│   └── legal-duty-master.json      # docId master (19 docs × variants)
├── lib/ · evidence/ · config/ · resources/
scripts/
├── build/                          # asset copy · inventory · docs sync (INV markers)
├── verify/ · audit/ · test/ · quality/ · sync/
docs/                               # IDENTITY · ARCHITECTURE · DATA_SOURCES · API-SPECS · setup guides
decisions/                          # architecture decision records (001–006)
tests/ux/                           # E2E onboarding regression assets (Playwright)
```

## Docs Are Generated-Synced

Numbers in README/docs (tool counts, law counts, graph sizes) live inside
`<!-- INV:KEY -->value<!-- /INV:KEY -->` markers and are rewritten by `npm run docs:sync`
from the actual bundle. **Never hand-edit the values; edit the source data and re-run sync.**
`npm run docs:check` (CI) fails on drift.

## When to Ask

- Before changing SHACL shapes or graph node schemas — downstream tools and audits depend on them
- Before adding any new network dependency — offline-first is a design contract
- Before adding documents beyond the 19 statutory set — identity-gate decision needed
- Before changing bundled public-data licensing posture (공공누리) — legal review needed

## License & Credit

- License: MIT (`LICENSE`); law texts are non-protected works (저작권법 §7); KOSHA/MoEL materials follow 공공누리 — see `NOTICE.md`
- Provided by: 황룡건설(주) 안전보건기획부 / Developed by: ㈜라텔웍스 (Ratelworks Inc.)
