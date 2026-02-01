# ADR-002: Database Schema Design

**Date**: 2026-02-01
**Status**: Accepted
**Context**: Designing the database schema to support provider-agnostic contract processing with human-in-the-loop review.

---

## Decision

### 7 Tables Across 3 Layers

**Reference Data:**
- `verticals` — Market categories (energy, telco, insurance). Adding a vertical = INSERT + Langfuse prompt.
- `providers` — Companies within verticals (Vattenfall, Deutsche Telekom). Identity and metadata.
- `provider_configs` — Operational processing config per provider+product_type. 1:many with providers.

**Workflow & Processing:**
- `workflows` — Tracks each contract processing run. Links to vertical and (optionally) provider.
- `contracts` — Validated extracted data with dual confidence scores (llm + final).
- `review_tasks` — Human approval queue. References contracts via FK (no data duplication).

**Audit:**
- `workflow_state_log` — Full audit trail of every state transition with metadata.

### Key Schema Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Verticals as a table | Not hardcoded CHECK constraints | "Add vertical via config" is truly zero-code |
| Providers separate from configs | 3-table split | Clean domain model: identity vs operational config |
| Provider configs 1:many | UNIQUE(provider_id, product_type) | Supports residential vs commercial differentiation |
| Dual confidence scores | `llm_confidence` + `final_confidence` | Observability into heuristic adjustments |
| Review tasks via FK | No data duplication | `contract_id` FK instead of copying `extracted_data` |
| `timed_out` status | Distinct from `rejected` | Distinguishes "nobody looked" from "human said no" |
| `workflow.provider_id` nullable | Provider unknown at creation | Populated after LLM identifies the provider |
| `windmill_job_id` on workflows | Correlate DB state with Windmill | Needed for suspend/resume pattern |

---

## Consequences

### Positive
- Zero-code extensibility for verticals and providers
- Clean separation of reference data, operational data, and audit
- Full audit trail for debugging and demo
- No data duplication between contracts and review tasks

### Negative
- 7 tables is more than the original 4 — more joins, more migration SQL
- `verticals` table adds a level of indirection for what's currently 3 rows
- Provider configs 1:many adds complexity for a POC that only needs 1:1

---

## Alternatives Considered

### Merge Providers into Provider Configs (2 tables instead of 3)
- Pros: Simpler, fewer joins
- Cons: Mixes identity (provider name, metadata) with operational config
- Why rejected: Clean domain model is a better interview talking point

### Hardcoded Verticals (CHECK constraint)
- Pros: Simpler, no extra table
- Cons: Adding a vertical requires a schema migration
- Why rejected: Contradicts the "zero-code extensibility" goal

### Store extracted_data on review_tasks (duplication)
- Pros: Review tasks are self-contained, easier to query
- Cons: Data sync issues, wasted storage
- Why rejected: FK reference is cleaner and review_tasks can join to contracts
