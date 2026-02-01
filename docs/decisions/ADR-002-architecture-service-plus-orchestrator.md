# ADR-002: Architecture — Service Layer + Windmill Orchestrator

**Date**: 2026-02-01
**Status**: Accepted
**Context**: Integrating the TypeScript service layer with Windmill revealed a fundamental impedance mismatch. This ADR documents the architectural decision to separate domain logic (service) from orchestration (Windmill).

---

## Problem

Windmill's Bun runtime executes scripts in isolation. Scripts can only import npm packages and other workspace scripts — not from external project source (`src/`). This led to:

1. **Duplicated logic** — ~250 lines of DB schema, state machine, validation copied into Windmill scripts
2. **Runtime incompatibilities** — `pdfjs-dist` and `pdf-parse` both failed in Windmill's Bun bundler
3. **Split observability** — logs scattered across Windmill job UI and external tools
4. **Divergence risk** — bug fixes in `src/` had to be manually replicated in `f/`

Windmill's "Codebases & Bundles" feature solves the import problem but is Enterprise-only, Beta, and TypeScript-only.

---

## Decision

**Deploy `src/` as an independent Express HTTP service. Windmill scripts are thin HTTP callers (~10 lines each) that handle orchestration only.**

### What Windmill Does
1. **Triggers** — webhook receives contract processing request
2. **Orchestration** — step sequencing, retries, timeouts, branching
3. **Human-in-the-loop** — approval step UI with suspend/resume

### What the Service Does
Everything else: PDF parsing, LLM extraction, validation, state management, DB operations, tariff comparison.

### Flow Design (4 Steps)

Steps were consolidated based on the principle that a Windmill step boundary is only justified by **retry granularity**, **distinct failure modes**, or **branching decisions**.

| Step | Windmill Script | Service Endpoint | Why Separate? |
|------|----------------|-----------------|---------------|
| 1. Ingest | `ingest.ts` | `POST /workflows/ingest` | Entry point, fast, deterministic. Corrupt PDFs aren't retriable. |
| 2. Extract + Validate | `extract.ts` | `POST /workflows/:id/extract` | LLM calls are slow, costly, non-deterministic. Retriable. Validation is pure logic over extraction output — no reason for its own step. |
| 3. Compare | `compare.ts` | `POST /workflows/:id/compare` | Independent data source, own failure mode. |
| 4. Approval | Windmill native | `POST /workflows/:id/review` | Async, unbounded duration, human-driven. |

### Architecture

```
Windmill (orchestrator)              Service (domain logic)
┌─────────────────────┐              ┌──────────────────────────────┐
│                      │              │                              │
│ 1. ingest.ts         │── HTTP ──→  │ POST /workflows/ingest       │
│    (receive + parse) │              │ (receive PDF, parse, persist)│
│                      │              │                              │
│ 2. extract.ts        │── HTTP ──→  │ POST /workflows/:id/extract  │
│    (LLM + validate)  │              │ (extract via LLM, validate)  │
│                      │              │                              │
│ 3. compare.ts        │── HTTP ──→  │ POST /workflows/:id/compare  │
│    (tariff compare)  │              │ (compare against tariffs)    │
│                      │              │                              │
│ 4. approval step     │── HTTP ──→  │ POST /workflows/:id/review   │
│    (human review UI) │              │ (record approval/rejection)  │
│                      │              │                              │
└─────────────────────┘              └──────────────────────────────┘
                                     │
                                     ├── src/domain/
                                     ├── src/services/
                                     ├── src/infrastructure/
                                     └── src/api/
```

---

## Rationale

### 1. Observability
With domain logic in an independent service: standard structured logging (Pino), OpenTelemetry tracing, domain-level metrics. With logic inside Windmill: observability split between Windmill's per-job UI and external tools with no unified view.

### 2. Testability
A service with a clean API boundary is testable with standard tooling. Logic inside Windmill scripts can only be tested by running Windmill.

### 3. Portability
If the orchestration layer changes (different workflow engine, direct API calls, batch processing), business logic is untouched. No-code/low-code platforms are strongest as glue layers — embedding core logic creates coupling that becomes painful as requirements evolve.

### 4. Single Source of Truth
Eliminates code duplication entirely. No copied `lib.ts`, no `pdfjs-dist` vs `unpdf` divergence, no manual replication of bug fixes.

### 5. Team Scalability
Backend engineers work on the service using standard patterns. Windmill flows can be maintained by anyone who understands orchestration — they don't need to understand domain logic.

### 6. Multiple Entry Points
The service can be called directly (API, demo script, CLI) or via Windmill. Both paths exercise the same logic.

---

## Consequences

### Positive
- Single source of truth for all domain logic
- Standard observability stack
- Testable without Windmill running
- Windmill scripts are trivially simple (~10 lines)
- Service can be called from multiple entry points
- Orchestration layer is swappable

### Negative
- Extra deployment target (Express service)
- Network hop per step (~5-20ms, negligible for LLM-heavy pipeline)
- Two systems to monitor (Windmill + service)

---

## Alternatives Considered

### Windmill-First (all logic in `f/`)
- Lose testability, observability control, and portability
- Code tied to Windmill runtime constraints

### Dual Architecture (canonical `src/` + duplicated `f/`)
- Permanent duplication and divergence risk
- Every bug fix applied twice

### Enterprise Codebase Bundling
- Enterprise-only, Beta, TypeScript-only
- Deepens vendor lock-in for a feature that may change

### Custom esbuild Step
- Bundles `src/` into self-contained `f/` scripts automatically
- Still runs domain logic inside Windmill workers — doesn't solve observability or testability

### Different Workflow Engine (Temporal, Inngest)
- Eliminates import restrictions
- Loses Windmill's visual flow editor and built-in approval UIs
