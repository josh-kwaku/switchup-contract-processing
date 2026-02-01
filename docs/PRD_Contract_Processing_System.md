# Product Requirements Document
## Contract Processing Workflow System

**Version:** 1.0  
**Date:** February 1, 2026  
**Author:** Joshua Boateng  
**Purpose:** SwitchUp Application Portfolio Demo

---

## Executive Summary

Build a proof-of-concept workflow orchestration system demonstrating provider-agnostic contract processing with human-in-the-loop decision making. Showcases handling multiple subscription verticals (Energy, Telco, Insurance) using unified architecture.

---

## Problem Statement

SwitchUp's three core challenges:

1. **Abstraction Layer**: System agnostic to Provider (Vattenfall vs Deutsche Telekom) and Market (Energy vs Telco)
2. **Robustness vs Configurability**: Highly configurable workflows that remain robust at scale
3. **Human-in-the-Loop**: AI initiates tasks, humans intervene only when confidence drops

---

## Goals & Success Metrics

### Goals
- Single codebase processes 3+ verticals
- Prompts updatable without code deployment
- Automatic human review routing when confidence < 80%
- Graceful failure handling with retry logic

### Success Metrics
- Add new vertical via configuration only (no code changes)
- Prompt updates live in < 1 minute
- 95%+ automatic approval rate for high-confidence extractions
- Zero data loss on workflow failures

---

## Functional Requirements

### FR1: Multi-Vertical Processing
System processes Energy, Telco, and Insurance contracts using vertical-specific prompts.

**Acceptance Criteria:**
- Single API endpoint with `vertical` parameter
- Routing to appropriate prompt based on vertical
- Add new vertical by creating prompt (zero code)

### FR2: LLM Data Extraction
Extract structured data from PDFs with confidence scoring.

**Acceptance Criteria:**
- Extracts all required fields per vertical
- Returns 0-100 confidence score
- Handles malformed PDFs gracefully
- Max 3 retry attempts on transient failures

### FR3: Human-in-the-Loop
Low-confidence extractions route to human review.

**Acceptance Criteria:**
- Confidence < 80% triggers review
- Workflow pauses until human decision
- Human can approve/reject/correct
- 24-hour timeout → auto-reject

### FR4: Centralized Prompt Management
Prompts stored in Langfuse for versioning and non-technical updates.

**Acceptance Criteria:**
- Runtime prompt fetching from Langfuse
- Variable interpolation support
- Version control with labels (production, staging)
- Model config stored with prompt

### FR5: Provider Configuration Registry
Provider configs in database, not hardcoded.

**Acceptance Criteria:**
- Each provider has config entry
- System validates against provider schema
- Add provider by inserting DB row
- Config changes without code deployment

### FR6: Workflow State Persistence
Workflow state survives restarts.

**Acceptance Criteria:**
- Unique ID per workflow run
- State transitions logged
- Query workflow status by ID
- Retry from last checkpoint on failure

---

## Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | < 10s extraction (p95), 100 contracts/hour |
| **Reliability** | Retry on transient failures, graceful degradation |
| **Observability** | LLM call tracing, workflow state logging |
| **Security** | Encrypted secrets, authenticated API, parameterized queries |

---

## Technical Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Language** | TypeScript | Type safety, team familiarity |
| **Workflow Engine** | Windmill.dev (Docker local, Flow-based) | Human-in-loop primitives, TypeScript support |
| **LLM** | Groq (Llama 3.3 70B) via model-agnostic adapter | Free tier, fast inference. Architecture supports Claude swap via config. |
| **Prompt Mgmt** | Langfuse | Versioning, observability, tracing (OpenAI-compatible with Groq) |
| **Database** | NeonDB (Postgres) | Serverless, branching, auto-scaling |
| **PDF Parsing** | pdfjs-dist (Mozilla PDF.js) | Actively maintained, reliable text extraction |

---

## User Stories

### Story 1: Ops Reviews Low-Confidence Extraction
**As** operations team member  
**I want** to review only uncertain AI extractions  
**So that** I don't waste time on obvious cases

### Story 2: PM Updates Extraction Logic
**As** product manager  
**I want** to update prompts without engineering  
**So that** I can iterate quickly

### Story 3: Engineer Adds New Market
**As** engineer  
**I want** to add Insurance with minimal code  
**So that** we scale efficiently

---

## Out of Scope (V1)

- Real-time reviewer notifications
- Mobile review interface
- Actual provider API integration
- Multi-language support
- OCR for scanned PDFs
- Batch processing UI

---

## Timeline

**Total: 6-8 hours using Claude Code**

| Phase | Duration | Deliverables |
|-------|----------|-------------|
| Setup | 1 hour | Windmill + Langfuse + NeonDB |
| Core Extraction | 2 hours | PDF parsing, LLM, prompts |
| Human-in-Loop | 1.5 hours | Review workflow, state |
| Provider Configs | 1 hour | Schema, validation |
| Error Handling | 1 hour | Retries, degradation |
| Documentation | 1.5 hours | README, diagrams |

---

## Success Criteria

Demo succeeds if:
1. ✅ Single codebase → 3 verticals
2. ✅ PM updates prompt in UI → live instantly
3. ✅ Human review only when confidence < 80%
4. ✅ Workflow auto-retries on failure
5. ✅ Clean, documented, interview-ready code

---

## Open Questions

| Question | Answer |
|----------|--------|
| Human review timeout? | 24 hours → auto-reject |
| Partial extractions? | Always route to human if required field missing |
| A/B test prompts? | V2 feature |
| Langfuse downtime? | SDK caches prompts, use stale cache |
| LLM provider? | Groq (Llama 3.3 70B) via model-agnostic adapter. Claude swap = config change. |
| PDF input method? | Base64 in request body |
| Confidence scoring? | LLM self-reported score + heuristic adjustments (missing fields, format issues lower score) |
| Prompt granularity? | Per-vertical (3 prompts), provider_configs can override with custom prompt |
| Human review UI? | Windmill built-in approval flow |
| Demo format? | Async repo review + video recording, explicitly framed for SwitchUp |
| Bad LLM JSON? | Retry once, then route to human review with raw text |
| Post-processing? | Mock tariff comparison step to show extensibility |
| API layer? | Windmill-native, optional Express layer if time permits |
| Test data? | Synthetic German contract PDFs |
| Dev workflow? | Local repo + wmill CLI sync to Windmill |

---

## Appendix: Example Flow

```
User uploads Energy contract PDF
    ↓
System extracts text
    ↓
Fetches "contract-extraction-energy" prompt from Langfuse
    ↓
Calls Claude API with retry logic
    ↓
Parses response: { provider: "Vattenfall", rate: 89.99, confidence: 75 }
    ↓
Confidence < 80 → Creates review task
    ↓
Workflow pauses
    ↓
Human approves with correction: rate = 91.99
    ↓
Validates against Vattenfall schema
    ↓
Stores in NeonDB
    ↓
Status: COMPLETED
```
