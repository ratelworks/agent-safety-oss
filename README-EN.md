# agent-safety-oss

> An OSS MCP server that gives AI Agents (**Claude Desktop / OpenAI Codex CLI**) **safety-management domain expertise** by providing Korean construction-safety **statutes, KOSHA Guides, and other public data as an ontology graph**.
>
> Helps safety managers and site managers draft **19 statutory safety documents** (TBM logs, work plans, risk assessments, MSDS registers, accident reports, etc.) accurately and quickly. Bundles **8 statute MDs** (OSH Act/Decree/Rule, Safety Rules, SAPA, SAPA Decree, Risk Assessment Notice, CTPA §62 area) + **1,039 KOSHA Guides** + other public data (Law Information Center, KOSHA, MOEL, MOLIT) unified in a single ontology graph. Provides forms, fill-in guides, statute body excerpts, and review at the moment of drafting. **The safety manager remains the author; the MCP is a co-pilot.**
>
> [Korean README](./README.md) · [Identity](./docs/IDENTITY.md) · [Operational Ontology](./docs/OPERATIONAL-ONTOLOGY.md) · [Claude Desktop Setup](./docs/SETUP_CLAUDE_DESKTOP.md) · [Codex CLI Setup](./docs/SETUP_CODEX.md) · [Quality Report](./docs/QUALITY-REPORT.md)

## Current Status

| Item | Current code |
|---|---:|
| Package version | **1.3.1** (2026-05-20) |
| MCP tools | **88** (offline-first, single API key for 6 KOSHA Live tools) |
| Statutory documents | **19** (TBM, work plans, risk assessments, MSDS, accident reports, etc.) |
| Legal-duty document master | 94 docIds |
| Full guides | 19 |
| Form index | 132 formIds (HWP 14 / PDF 23 / XLSX 1 / MD 94) |
| Operational graph | 3,336 nodes / 29,642 edges |
| Core activity/hazard/control nodes | WorkActivity 41 / Hazard 38 / Control 45 |
| Bundled statutes | **8 MDs**: OSH Act, OSH Decree, OSH Rule, Safety Rules, SAPA, SAPA Decree, Risk Assessment Notice, CTPA §62 area |
| Bundled KOSHA Guides | **1,039 bodies** (offline, keyless, kordoc-extracted) |
| Verification | `ontology:operational` 38/38, `mcp:test:graph` pass, `audit:strict` pass |
| Field scenarios | 4/4 scenarios, 29/29 steps, quality average 8.65/10 |

## Target Users

### Safety Managers

- Check daily, weekly, monthly, and ad-hoc legal-duty documents by cycle.
- Draft TBM logs, risk assessments, work plans, permits, and MSDS registers with graph-backed evidence.
- Separate statutory obligations from KOSHA recommendations and reference materials.
- Review LLM-generated documents for hallucinated citations and missing required fields.
- Keep photos, safety issues, corrective actions, reports, and document archives in local storage.

### Site Managers

- Ask in plain language what must be done for today's work.
- Get TBM topics, PPE, hazards, controls, and permit needs without searching through folders.
- Follow incident-response duties in chronological order when an accident occurs.
- Keep a minimum legal-document workflow running when safety duties are handled by one person.
- Preserve handover continuity through the local site profile, drafts, evidence, and action records.

## Workflow

```text
1. Register the site
   register_site / register_project / register_person / register_equipment

2. Check duties
   assess_my_obligations / list_safety_documents_by_cycle / list_upcoming_duties

3. Assemble graph context
   assemble_doc_context / get_safety_document_guide / get_safety_law_article

4. Generate and review documents
   generate_safety_document / review_safety_document / verify_safety_basis

5. Record daily field operations
   upload_photo_evidence / register_safety_issue / record_corrective_action / complete_action

6. Report and retain
   generate_safety_report / archive_safety_document / get_retention_status
```

## Example Prompts

```text
Create today's TBM for 4F balcony formwork lifting.
Include fall risk, falling objects, signaler placement, and required PPE.
```

```text
This is a KRW 3B construction site with 12 regular workers.
List the safety documents due this month and their retention periods.
```

```text
We use Thinner 600 for painting work.
Draft an MSDS register with statutory basis and required PPE.
```

## Ontology Layers

| Layer | Role | Code/data |
|---|---|---|
| Semantic Layer | Defines objects and links: Site, Project, Activity, Hazard, Control, LegalArticle, SafetyDocument, Evidence | `src/ontology/graph/**`, `src/ontology/operational/profile.jsonld` |
| Kinetic Layer | Turns graph objects into executable MCP actions | `src/tools/**`, `src/resources/**`, `src/tool-registry.ts` |
| Dynamic Layer | Lets the LLM and harness interpret user intent and compose tool calls | Claude Desktop, OpenAI Codex CLI |

The LLM does not invent statutory basis. Laws, hazards, controls, and document links come from graph traversal and tool outputs. Human users remain responsible for final review, approval, signing, and submission.

## Install

> **Current status**: not yet published to npm registry (`npm view agent-safety-oss` returns E404). Use the "From source" path below. The npm command will work after publishing a future release.

```bash
# After npm publish
npm install -g agent-safety-oss
agent-safety-oss tools
agent-safety-oss serve
```

From source (current path):

```bash
git clone https://github.com/ratelworks/agent-safety-oss.git
cd agent-safety-oss
npm install
npm run build
node build/cli.js tools
node build/cli.js serve
```

Node.js 20.19 or newer is required.

## MCP host setup (Claude Desktop · Codex CLI)

> Claude Desktop and OpenAI Codex CLI are the two supported MCP hosts.

### Claude Desktop (JSON)

Add to your config (`claude_desktop_config.json` on macOS at `~/Library/Application Support/Claude/` or on Windows at `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "agent-safety-oss": {
      "command": "npx",
      "args": ["-y", "agent-safety-oss", "serve"]
    }
  }
}
```

For a local source checkout, use `node /absolute/path/to/agent-safety-oss/build/cli.js serve`.

### OpenAI Codex CLI (TOML)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.agent-safety-oss]
command = "npx"
args = ["-y", "agent-safety-oss", "serve"]
```

Restart Codex CLI and run `codex mcp list` to verify registration. Full guide: [docs/SETUP_CODEX.md](./docs/SETUP_CODEX.md).

`AGENTHQ_API_KEY` is optional and only needed for 공공 OpenAPI searches. Bundled statutes, graph traversal, document generation, review, and local field-cycle tools work without a key.

## Key Tool Groups

| Work | Representative tools |
|---|---|
| Obligation assessment | `assess_my_obligations`, `query_applicability`, `list_upcoming_duties` |
| Cycle-based documents | `list_safety_documents_by_cycle`, `get_safety_document_guide` |
| Document drafting | `assemble_doc_context`, `generate_safety_document`, `export_drafted_document` |
| Review and hallucination gates | `review_safety_document`, `verify_safety_basis` |
| Hazards and controls | `analyze_construction_work_risks`, `get_measures_by_risk`, `get_ppe_by_task`, `generate_tbm_topics` |
| Statutes | `search_safety_laws`, `get_safety_law_article`, `query_legal_basis`, `query_penalty` |
| Field cycle | `upload_photo_evidence`, `register_safety_issue`, `record_corrective_action`, `complete_action`, `generate_safety_report` |

Run `npm run mcp:tools` for the full catalog.

## A2UI Form — Browser Preview

`render_a2ui_form` emits a [Google A2UI](https://github.com/google/a2ui) v0.9 JSONL that you can preview directly in a browser. Useful for showing the safety manager how the auto-generated form (with blanks, placeholders, and statutory citations) actually looks before submitting.

```bash
npm install
npm run build
npm run mcp:demo:viewer
# → http://localhost:5174 starts automatically
```

Pick a form type (TBM log, excavation work plan, periodic risk assessment, etc.) and the page renders with blanks, examples, and statutory references already populated.

For a static-only preview (paste JSONL into a textarea, no server), see [`a2ui-demo/README.md`](./a2ui-demo/README.md).

## Verification

```bash
npm run typecheck
npm run build
npm run ontology:operational
npm run mcp:test:graph
npm run audit:strict
npx tsx scripts/test/field-test-workflows.ts
npx tsx scripts/quality/field-test-quality-eval.ts
```

Recent verification:

- Operational ontology: 38/38 pass
- Graph reasoning: 5/5 queries, recall 100%, precision 100%
- ISO 45001 category consistency: 100%
- Field workflow: 4/4 scenarios, 29/29 steps
- Generated document quality: 8.65/10 average

## Provider · Developer

- **Provider**: 황룡건설(주) Safety & Health Planning Dept. — domain validation, on-site requirements, and scenarios
- **Developer**: Ratelworks Inc. — MCP server design/implementation, OSS maintenance, public safety data accessibility. <alphamale@ratelworks.co.kr>

## Awards & Recognition

- **2025.07** — 2025 AI·Smart Industrial Safety Tech Best Practice Contest **Grand Prize** (Minister of Employment and Labor) · 황룡건설(주), dev: Ratelworks Inc.
- **2025.09** — 2025 Risk Assessment Best Practice Showcase **Excellence Prize** (Daejeon Regional Labor Office Director) · 황룡건설(주), dev: Ratelworks Inc.
- **2026.01** — Side Impact 2025 AI Track **Winner** (Brian Impact Foundation) · Ratelworks Inc.

## Data and Licensing

- Code: MIT
- Statutory text: non-copyrightable public material under Korean Copyright Act Article 7
- KOSHA and MOEL public materials: follow each KOGL/public-data condition

See [NOTICE.md](./NOTICE.md) for attribution and reuse details.
