# Architecture

`agent-safety-oss` is a stdio MCP server that exposes a lightweight Korean construction-safety ontology graph to LLM agents.

The architecture is optimized for safety managers and site managers, not for a large enterprise platform. The local runtime must be small, inspectable, and usable through existing MCP clients.

## Ontology Stack Position

This repository is not the AgentHQ Core ontology. It is the reference implementation of the Safety domain pack under the AgentHQ ontology stack.

```text
L0 AgentHQ Ontology Constitution
  └─ L1 AgentHQ Core
       └─ L2 construction-common
            └─ L3 safety domain pack
                 └─ L4 agent-safety-oss
                      └─ L5 Agent_* product runtime
```

Rules:

- Upstream layers define constitution, common contracts, and reusable construction identifiers.
- This repository implements safety-specific graph nodes, MCP tools, document workflows, evidence, and field actions.
- Safety-specific laws, documents, hazards, controls, and review rules stay in the safety domain pack.
- Reusable implementation patterns may be promoted upward only after they are stripped of safety-domain knowledge.

## Runtime Path

```text
MCP Client
  Claude Desktop / OpenAI Codex CLI / MCP Inspector
        |
        | stdio JSON-RPC
        v
src/cli.ts
  command: serve / tools / call
        |
        v
src/index.ts
  McpServer registration
        |
        v
src/tool-registry.ts
  <!-- INV:TOOLS_TOTAL -->92<!-- /INV:TOOLS_TOTAL --> ToolDefinitions
        |
        +--> src/tools/**
        |      search, guide, document generation, review, site profile,
        |      photo evidence, safety issue, corrective action, report
        |
        +--> src/resources/**
        |      graph context, skeleton, operational profile resources
        |
        +--> src/lib/**
               graph loader, local storage, validators, KOSHA API client
```

## Layer Model

### Semantic Layer

Defines what exists and how it is linked.

- Object types (operational graph, per `src/ontology/operational/profile.jsonld` — **13개**): Site, Project, Contractor, WorkerRole, Equipment, WorkActivity, Hazard, Control, LegalDuty, SafetyDocument, Evidence, Incident, LegalArticle
- Link types (operational graph — **8개**): hasHazard, mitigatedBy, legalBasis, guidedBy, relatedDocs, annexReference, evidences, resolves

> 의미 모델 (`docs/IDENTITY.md` §6/§7) 은 13객체 + SafetyReport (14번째 별개) + 14관계로 표현되며, operational graph 의 LegalDuty/Incident 가 의미 모델의 SafetyIssue/CorrectiveAction/SafetyReport 로 매핑된다. 두 추상화 (operational graph 의 운영 정의 vs IDENTITY 의 의미 모델) 는 별개의 SSoT 다.
- Files:
  - `src/ontology/graph/context.jsonld`
  - `src/ontology/graph/nodes/**`
  - `src/ontology/skeleton/skeleton.jsonld`
  - `src/ontology/operational/profile.jsonld`

### Kinetic Layer

Turns graph objects into executable work.

Representative actions:

- `assess_my_obligations`
- `assemble_doc_context`
- `generate_safety_document`
- `review_safety_document`
- `verify_safety_basis`
- `get_measures_by_risk`
- `field_safety_briefing`
- `upload_photo_evidence`
- `register_safety_issue`
- `record_corrective_action`
- `complete_action`
- `generate_safety_report`

Each action must preserve lineage: law, guide, graph node, evidence, and local storage references are returned in structured content where possible.

### Dynamic Layer

The LLM and harness interpret natural language and compose tool calls.

The LLM may:

- Ask for missing required fields.
- Choose the next MCP tool.
- Summarize graph results for a safety manager or site manager.
- Draft text from returned facts.

The LLM must not:

- Invent statutory basis.
- Mark a missing required field as complete.
- Replace human approval, signing, or legal responsibility.

## Data Stores

### Static repository graph

```text
src/ontology/legal-duty-master.json       <!-- INV:DOCID_MASTER -->94<!-- /INV:DOCID_MASTER --> legal-duty docIds
src/ontology/forms/forms-map.json         <!-- INV:FORMS_TOTAL -->132<!-- /INV:FORMS_TOTAL --> formIds
src/ontology/forms/auto/*.md              <!-- INV:FORMS_MD -->94<!-- /INV:FORMS_MD --> generated markdown forms
src/ontology/guides/*.json                <!-- INV:DOCUMENTS_TOTAL -->19<!-- /INV:DOCUMENTS_TOTAL --> full guides
src/ontology/safety-laws/*.md             <!-- INV:LAW_BUNDLE_COUNT -->8<!-- /INV:LAW_BUNDLE_COUNT --> bundled statute MDs (산안법·시행령·시행규칙·기준규칙·중처법·중처법 시행령·위험성평가 고시·건진법 §62 영역)
src/ontology/graph/nodes/**               graph nodes and edges
src/ontology/operational/profile.jsonld   operational profile
```

### Local user storage

```text
~/.agent-safety-oss/
  profile.jsonld
  drafts/
  documents/
  photos/
  issues/
  actions/
  reports/
  traces/
```

Local directories are created with `0o700` permissions and files with `0o600`.

## Tool Groups

| Group | Purpose |
|---|---|
| Search and lookup | KOSHA archive, KOSHA Guide, MSDS, safety materials, PPE certification, local statute search |
| Obligation lifecycle | applicability, upcoming duties, submission, retention, incident workflow |
| Document workflow | guide, graph context, generation, export, review, hallucination check |
| Field cycle | photo evidence, safety issue, corrective action, safety report |
| Profile | site, project, person, equipment, contractor registration |
| Forms and UI | official forms, draft save/load/archive, A2UI form rendering |

## Graph Node Categories (명명 정합)

P1-5 — `safety://graph/{category}` 의 카테고리 의미를 명확히:

| Category | 노드 수 | 역할 | IRI 패턴 |
|---|---|---|---|
| `documents` | 1,135 (재귀: 1단계 96 + guides/ <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META -->) | <!-- INV:DOCUMENTS_TOTAL -->19<!-- /INV:DOCUMENTS_TOTAL -->종 법정 문서 + KOSHA Guide <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> (`guides/` 하위) | `doc:annual/...`, `doc:kosha_guide/{code}` |
| `documents/guides/` | <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> | **KOSHA Guide canonical 노드 위치** (메타. 본문 <!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY -->) | `doc:kosha_guide/{code}` |
| `kosha_guides` | 2 | 레거시 원천 메타 1건 + Manual 절 1건 (v1.3.x 에서 documents/guides·manuals 로 이동 예정) | `doc:kosha_guide/Z-26-2022`, `kosha:P-94:4.2.1.4` |
| `articles` | 1,306 | 법령 조문 (산안법·기준규칙·중처법·건진법 등) | `art:{law}:{num}` |
| `annexes` | 227 | 별표·서식 | `annex:{law}:{num}` |
| `manuals` | 8 | KOSHA Guide 절 단위 또는 외부 매뉴얼 | `kosha:{guide}:{section}` |
| `chapters` | 55 | 법령 편/장/절 | `chapter:{law}:{num}장` |

**원칙** (재귀 로딩 + 명명 정합):
- KOSHA Guide <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META -->건 (메타) / <!-- INV:KOSHA_BODY -->1,039<!-- /INV:KOSHA_BODY -->건 (본문, 미수집 <!-- INV:KOSHA_FAILURES -->0<!-- /INV:KOSHA_FAILURES -->건 — `_FAILURES.json`) 의 canonical 위치는 `documents/guides/`
- `kosha_guides/` 폴더는 잔존 2건만 (v1.3.x 정리 예정)
- Resource `safety://graph/documents` 가 1,135 전체 (guides <!-- INV:KOSHA_META -->1,039<!-- /INV:KOSHA_META --> 포함) 노출
- Resource `safety://graph/kosha_guides` 는 잔존 2건만 (오해 방지 안내 필요)

## Evidence Model

```ts
basisType = law | regulation | kosha_guide | accident_case | safety_material | msds | statistics | ppe_certification
legalWeight = mandatory | recommended | reference
```

Standard mapping:

| basis type | legal weight |
|---|---|
| law, regulation | mandatory |
| kosha_guide | recommended |
| accident_case, safety_material, msds, statistics, ppe_certification | reference |

`verify_safety_basis` blocks unsupported mandatory claims with a hallucination marker when claims use words such as "의무", "반드시", "금지", or "위반" without valid statutory evidence.

## Validation Gates

```bash
npm run typecheck
npm run build
npm run ontology:operational
npm run mcp:test:graph
npm run audit:strict
npx tsx scripts/test/field-test-workflows.ts
npx tsx scripts/quality/field-test-quality-eval.ts
```

Current observed gates:

- Operational profile: 38/38 pass
- Graph reasoning: 5/5 pass, recall 100%, precision 100%
- Graph consistency: ISO 45001 category consistency 100%
- Strict graph audit: pass
- Field workflows: 4 scenarios, 29/29 steps
- Field quality: 8.65/10 average

## Extension Rule

When adding a feature:

1. Add or reuse graph nodes and edges first.
2. Add a tool only if the action is meaningful for safety managers or site managers.
3. Return structured content with IRI lineage.
4. Add or update a validation script.
5. Update README and the relevant docs if the user-facing workflow changes.
