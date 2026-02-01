# ADR-003: Workflow State Machine Design

**Date**: 2026-02-01
**Status**: Accepted
**Context**: Designing the state machine for contract processing workflows, balancing observability with implementation complexity.

---

## Decision

### Fine-Grained States (10 total)

Each state maps to a logical processing phase. The service owns all state transitions — Windmill orchestrates the step sequence but does not manage state directly.

| State | Type | Service Endpoint |
|-------|------|-----------------|
| `pending` | Initial | `POST /workflows/ingest` (entry) |
| `parsing_pdf` | Processing | `POST /workflows/ingest` |
| `extracting` | Processing | `POST /workflows/:id/extract` |
| `validating` | Processing | `POST /workflows/:id/extract` |
| `review_required` | Suspended | `POST /workflows/:id/extract` (triggers Windmill suspend) |
| `validated` | Processing | `POST /workflows/:id/extract` or `POST /workflows/:id/review` |
| `comparing` | Processing | `POST /workflows/:id/compare` |
| `completed` | Terminal | `POST /workflows/:id/compare` |
| `rejected` | Terminal | `POST /workflows/:id/review` or max retries |
| `timed_out` | Terminal | `POST /workflows/:id/review` (timeout) |
| `failed` | Transient | Any endpoint on error |

### Key Design Choices

**1. `validated` as convergence point:**
Both auto-approve (`validating → validated`) and human-approve (`review_required → validated`) paths merge here. Downstream steps don't need to know whether a human was involved.

**2. `failed` is transient, not terminal:**
A workflow in `failed` either gets retried (back to the specific step that failed) or moves to `rejected` (if max retries exceeded).

**3. Smart retry targets the failed step:**
If the LLM fails at `extracting`, we retry from `extracting` — not from `parsing_pdf`. `workflow_state_log.metadata.failed_at_step` tracks where to resume. Windmill's per-step retry configuration handles this: each step independently retries its HTTP call.

**4. Three distinct terminal states:**
- `completed` — successfully processed
- `rejected` — human rejected OR max retries exceeded
- `timed_out` — 24h review timeout, no human action (distinct so we can identify and re-process)

**5. Validation failures always route to human:**
Not retry. If the data doesn't match the schema, retrying the same LLM call is unlikely to help. Let a human decide.

**6. Service owns state, Windmill owns sequencing:**
The service manages all state transitions in the database and logs them to `workflow_state_log`. Windmill decides which endpoint to call next based on the response (e.g., `needsReview: true` → approval step, else → compare). This separation means state logic is testable without Windmill.

---

## State Transitions

| From | To | Trigger | Condition |
|------|-----|---------|-----------|
| `pending` | `parsing_pdf` | Ingest endpoint called | — |
| `parsing_pdf` | `extracting` | PDF text extracted successfully | — |
| `parsing_pdf` | `failed` | Error | Corrupt PDF, parse error |
| `extracting` | `validating` | LLM returns parseable JSON | — |
| `extracting` | `failed` | Error | LLM API error, malformed JSON after 1 retry |
| `validating` | `validated` | Passes validation | `final_confidence >= 80` AND all required fields valid |
| `validating` | `review_required` | Needs human | `final_confidence < 80` OR validation failure |
| `validating` | `failed` | Error | Provider lookup failure, DB error |
| `review_required` | `validated` | Human approves or corrects | Review task status = approved/corrected |
| `review_required` | `rejected` | Human rejects | Review task status = rejected |
| `review_required` | `timed_out` | 24h elapsed | No human action within timeout window |
| `validated` | `comparing` | Proceed to comparison | — |
| `comparing` | `completed` | Comparison done | — |
| `comparing` | `failed` | Error | Unexpected error |
| `failed` | *(step that failed)* | Retry | `retry_count < 3`, resumes at failed step |
| `failed` | `rejected` | Max retries exceeded | `retry_count >= 3` |

---

## Consequences

### Positive
- Every processing step has its own state → precise debugging via `workflow_state_log`
- Smart retry avoids re-parsing PDFs unnecessarily
- `validated` convergence simplifies downstream logic
- State logic is fully testable without Windmill
- Windmill flow visualization reflects step progress

### Negative
- 10 states + 16 transitions is more complex than a minimal design
- `failed_at_step` metadata requires careful tracking
- More state transition validation logic to implement

---

## Alternatives Considered

### Coarse States (5 states) with Sub-Status
- States: `pending`, `processing`, `review_required`, `completed`, `rejected`
- Sub-step tracked in `workflow_state_log.metadata`
- Pros: Simpler state machine, fewer transitions
- Cons: Less observable from the workflow table alone
- Why rejected: Fine-grained states provide better debugging and demo experience

### Always Retry from Beginning
- On any failure, restart from `parsing_pdf`
- Pros: No `failed_at_step` tracking needed
- Cons: Wastes work re-parsing PDFs, slower recovery
- Why rejected: Smart retry is more efficient and demonstrates production-ready thinking

### No `validated` State (Direct to `comparing`)
- `validating` and `review_required` go directly to `comparing`
- Pros: One fewer state
- Cons: `comparing` needs to handle both paths, loses clean convergence point
- Why rejected: `validated` as convergence point is cleaner architecture
