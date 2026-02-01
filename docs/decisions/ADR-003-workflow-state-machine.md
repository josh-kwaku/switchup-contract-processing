# ADR-003: Workflow State Machine Design

**Date**: 2026-02-01
**Status**: Accepted
**Context**: Designing the state machine for contract processing workflows, balancing observability with implementation complexity.

---

## Decision

### Fine-Grained States (10 total)

Each state maps 1:1 to a Windmill Flow step, making the Flow visualization a live representation of the state machine.

| State | Type | Windmill Step |
|-------|------|--------------|
| `pending` | Initial | Trigger |
| `parsing_pdf` | Processing | Step 1 |
| `extracting` | Processing | Step 2 |
| `validating` | Processing | Step 3 |
| `review_required` | Suspended | Step 4 (Windmill suspend) |
| `validated` | Processing | Step 5 (convergence) |
| `comparing` | Processing | Step 6 (mock tariff) |
| `completed` | Terminal | End (success) |
| `rejected` | Terminal | End (rejected) |
| `timed_out` | Terminal | End (timeout) |
| `failed` | Transient | Error handler |

### Key Design Choices

**1. `validated` as convergence point:**
Both auto-approve (`validating → validated`) and human-approve (`review_required → validated`) paths merge here. Downstream steps don't need to know whether a human was involved.

**2. `failed` is transient, not terminal:**
A workflow in `failed` either gets retried (back to the specific step that failed) or moves to `rejected` (if max retries exceeded).

**3. Smart retry targets the failed step:**
If the LLM fails at `extracting`, we retry from `extracting` — not from `parsing_pdf`. `workflow_state_log.metadata.failed_at_step` tracks where to resume.

**4. Three distinct terminal states:**
- `completed` — successfully processed
- `rejected` — human rejected OR max retries exceeded
- `timed_out` — 24h review timeout, no human action (distinct so we can identify and re-process)

**5. Validation failures always route to human:**
Not retry. If the data doesn't match the schema, retrying the same LLM call is unlikely to help. Let a human decide.

---

## Consequences

### Positive
- Windmill Flow DAG directly mirrors the state machine (great for demo)
- Every processing step has its own state → precise debugging via `workflow_state_log`
- Smart retry avoids re-parsing PDFs unnecessarily
- `validated` convergence simplifies downstream logic

### Negative
- 10 states + 16 transitions is more complex than the original 4-state design
- `failed_at_step` metadata requires careful tracking
- More state transition validation logic to implement

---

## Alternatives Considered

### Coarse States (5 states) with Sub-Status
- States: `pending`, `processing`, `review_required`, `completed`, `rejected`
- Sub-step tracked in `workflow_state_log.metadata`
- Pros: Simpler state machine, fewer transitions
- Cons: Less observable from the workflow table alone, Windmill Flow visualization less meaningful
- Why rejected: Fine-grained states make a more impressive demo and better debugging experience

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
