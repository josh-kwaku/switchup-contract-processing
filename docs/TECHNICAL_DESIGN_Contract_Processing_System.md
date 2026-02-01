# Technical Design Document
## Contract Processing Workflow System

**Version:** 2.0
**Date:** February 1, 2026
**Author:** Joshua Boateng
**Related:** PRD_Contract_Processing_System.md

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Domain Model (Lightweight DDD)](#domain-model-lightweight-ddd)
3. [System Components](#system-components)
4. [Data Schema](#data-schema)
5. [Provider Abstraction Strategy](#provider-abstraction-strategy)
6. [Workflow State Machine](#workflow-state-machine)
7. [Error Handling Strategy](#error-handling-strategy)
8. [API Design](#api-design)
9. [Security & Infrastructure](#security--infrastructure)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (API Request)                   │
│              POST /workflows/ingest                      │
│              { pdfBase64, verticalSlug }                  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              WINDMILL (Orchestrator)                      │
│                                                          │
│  Step 1: Ingest ──→ Step 2: Extract ──→ Step 3: Compare │
│                         │                                │
│                    needsReview?                           │
│                         │                                │
│                   Step 4: Approval                        │
│                                                          │
│  Each step calls the service via HTTP.                   │
│  No business logic in Windmill scripts.                  │
└─────┬──────────────────────────────────────────┬────────┘
      │                                          │
      │  HTTP calls                              │
      ▼                                          ▼
┌─────────────────────────────────────────────────────────┐
│              EXPRESS SERVICE (Domain Logic)               │
│                                                          │
│  /workflows/ingest     → Parse PDF, create workflow      │
│  /workflows/:id/extract → LLM extraction, validation     │
│  /workflows/:id/compare → Tariff comparison              │
│  /workflows/:id/review  → Record review decision         │
│                                                          │
│  Owns: state machine, validation, extraction, storage    │
└─────┬──────────────┬──────────────┬─────────────────────┘
      │              │              │
      ▼              ▼              ▼
┌──────────┐   ┌──────────┐   ┌──────────┐
│ Langfuse │   │  NeonDB  │   │   Groq   │
│ Prompts  │   │PostgreSQL│   │ Llama 3.3│
└──────────┘   └──────────┘   └──────────┘
```

### Separation of Concerns

| Concern | Owned By | Rationale |
|---------|----------|-----------|
| Step sequencing, retries, timeouts | Windmill | Built-in orchestration primitives |
| Human-in-the-loop approval UI | Windmill | Native suspend/resume |
| Triggering (webhook) | Windmill | Built-in webhook support |
| State machine transitions | Service | Testable, single source of truth |
| PDF parsing, LLM extraction | Service | Standard runtime, no sandbox constraints |
| Validation, confidence scoring | Service | Pure logic, unit-testable |
| Database operations | Service | Drizzle ORM, type-safe queries |
| Observability (logging, tracing) | Service | Standard Pino + OpenTelemetry |

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Architecture** | Service + Windmill orchestrator | Domain logic in service, Windmill handles orchestration only (ADR-002) |
| **HTTP Framework** | Express | Widely adopted, familiar, sufficient for workload (ADR-001) |
| **Workflow Engine** | Windmill (orchestrator only) | Suspend/resume for human-in-loop, visual flow editor |
| **Database** | NeonDB (Postgres) | Serverless, branching, auto-scales |
| **Prompt Storage** | Langfuse | Non-technical updates, versioning, tracing |
| **LLM Provider** | Groq (Llama 3.3 70B), model-agnostic adapter | Free tier, Claude-swappable via config (ADR-001) |
| **PDF Parsing** | pdfjs-dist (Mozilla PDF.js) | Actively maintained, reliable extraction |
| **DDD Approach** | Lightweight | Clear boundaries, skip heavy infrastructure for POC |
| **State Management** | Database-backed, service-owned | Survives restarts, testable without Windmill |
| **Prompt Granularity** | Per-vertical (3 prompts) + provider override | Balance of simplicity and flexibility |
| **Confidence Scoring** | LLM score + heuristic adjustments | More robust than LLM self-report alone |

---

## Domain Model (Lightweight DDD)

### Bounded Contexts

```
┌─────────────────────────────────────────────────────────┐
│           CONTRACT PROCESSING CONTEXT                    │
│                                                          │
│  Aggregates:                                             │
│  - ContractWorkflow (root)                               │
│  - ReviewTask                                            │
│                                                          │
│  Value Objects:                                          │
│  - ExtractedData                                         │
│  - ConfidenceScore                                       │
│  - WorkflowState                                         │
│                                                          │
│  Domain Services:                                        │
│  - ExtractionService (orchestrates LLM extraction)       │
│  - ValidationService (schema validation)                 │
│  - ReviewService (human-in-loop)                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              PROVIDER REGISTRY CONTEXT                   │
│                                                          │
│  Aggregates:                                             │
│  - ProviderConfig (root)                                 │
│                                                          │
│  Value Objects:                                          │
│  - Vertical (enum: energy, telco, insurance)             │
│  - ValidationRules                                       │
│                                                          │
│  Domain Services:                                        │
│  - ProviderRegistry (lookup configs)                     │
└─────────────────────────────────────────────────────────┘
```

### Ubiquitous Language

| Term | Definition |
|------|------------|
| **Vertical** | Subscription category (Energy, Telco, Insurance) |
| **Extraction** | LLM-based data parsing from contract PDF |
| **Confidence Score** | 0-100 score indicating extraction certainty |
| **Review Task** | Human approval request for low-confidence extraction |
| **Provider Config** | Schema defining provider-specific validation rules |
| **Workflow State** | Current stage in contract processing pipeline |

---

## System Components

### 1. Express HTTP Service

**Responsibilities:**
- Expose domain logic via REST endpoints
- Zod validation on all request inputs
- Structured error responses (`{ error: { code, message, retryable } }`)
- Request-scoped logging with correlation IDs
- Owns all state transitions, DB operations, and external integrations

**Endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `POST /workflows/ingest` | Receive PDF, parse text, create workflow |
| `POST /workflows/:id/extract` | LLM extraction + validation |
| `POST /workflows/:id/compare` | Tariff comparison |
| `POST /workflows/:id/review` | Record review decision (approve/reject/correct/timeout) |
| `GET /workflows/:id` | Get workflow status |
| `GET /reviews/pending` | List pending review tasks |

---

### 2. Windmill Orchestrator

**Responsibilities:**
- Orchestrate the 4-step flow via HTTP calls to the service
- Manage retries per step (configurable per step)
- Suspend/resume for human approval
- Provide visual flow monitoring

**What Windmill does NOT do:**
- No business logic
- No direct database access
- No LLM calls
- No state management

**Flow Definition (4 steps):**
```
ingest → extract → [needsReview? → approval] → compare → done
```

Each Windmill script is ~10 lines: parse inputs from previous step, call service endpoint, return response.

---

### 3. Langfuse Prompt Management

**Responsibilities:**
- Store prompt templates with variables
- Version control (immutable history)
- Deploy via labels (production, staging, experiment)
- Trace all LLM calls for observability

**Integration Pattern:**
```typescript
const prompt = await langfuse.getPrompt("contract-extraction-energy");
const compiled = prompt.compile({ contract_text: pdfText });
const response = await llmProvider.extract(compiled, prompt.config);
```

**Key Features Used:**
- Prompt versioning
- Variable interpolation (`{{contract_text}}`)
- Model config storage (model, temperature, max_tokens)
- LLM call tracing

---

### 4. NeonDB (PostgreSQL)

**Responsibilities:**
- Store workflow state
- Persist extracted contracts
- Maintain provider registry
- Track review tasks

**Why NeonDB?**
- Serverless (no management overhead)
- Branching (separate dev/test DBs)
- Auto-scaling compute
- PostgreSQL compatibility

**Connection:**
```
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/contracts?sslmode=require
```

---

### 5. LLM Provider (Model-Agnostic)

**Responsibilities:**
- Extract structured data from unstructured text
- Return JSON with confidence score

**Model Selection:**
- **Default:** Groq — Llama 3.3 70B (free tier, fast inference)
- **Swap-ready:** Anthropic Claude via adapter interface (config change only)
- **Configurable via Langfuse prompt config**

**Adapter Interface:**
```typescript
interface LLMProvider {
  extract(prompt: string, contractText: string): Promise<ExtractionResult>;
}
// Implementations: GroqProvider, AnthropicProvider
```

**Retry Strategy:**
- 3 attempts with exponential backoff (1s, 2s, 4s)
- Retry on: 429, 5xx, network timeout
- Retry once on malformed JSON response, then route to human review
- No retry on: 400, 401

---

## Data Schema

### Core Tables

```sql
-- ============================================
-- REFERENCE DATA
-- ============================================

-- Verticals: market categories (energy, telco, insurance)
-- Adding a new vertical = INSERT here + create Langfuse prompt (zero code)
CREATE TABLE verticals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,              -- 'energy', 'telco', 'insurance'
  display_name TEXT NOT NULL,             -- 'Energy', 'Telco', 'Insurance'
  default_prompt_name TEXT NOT NULL,      -- 'contract-extraction-energy'
  base_required_fields TEXT[] NOT NULL,   -- ['provider', 'monthly_rate', 'contract_start']
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Providers: companies within a vertical (Vattenfall, Deutsche Telekom, Allianz)
CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,              -- 'vattenfall', 'deutsche-telekom'
  display_name TEXT NOT NULL,             -- 'Vattenfall', 'Deutsche Telekom'
  vertical_id UUID NOT NULL REFERENCES verticals(id),
  metadata JSONB DEFAULT '{}',           -- website, logo, notes
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Provider Configs: operational processing config per provider+product_type
-- 1:many with providers (e.g., residential vs commercial)
-- NULL langfuse_prompt_name = use vertical default
CREATE TABLE provider_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  product_type TEXT NOT NULL DEFAULT 'default',
  required_fields TEXT[],                -- overrides vertical base_required_fields if set
  validation_rules JSONB,               -- {"monthly_rate": {"min": 20, "max": 500}}
  langfuse_prompt_name TEXT,            -- NULL = use vertical default prompt
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, product_type)
);

-- ============================================
-- WORKFLOW & PROCESSING
-- ============================================

-- Workflows: tracks each contract processing run
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_id UUID NOT NULL REFERENCES verticals(id),
  provider_id UUID REFERENCES providers(id),         -- NULL until LLM identifies provider
  pdf_storage_path TEXT NOT NULL,                     -- path to stored PDF file
  pdf_filename TEXT,                                  -- original filename
  state TEXT NOT NULL DEFAULT 'pending',
  windmill_job_id TEXT,                               -- correlate with Windmill flow run
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contracts: validated extracted data
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  vertical_id UUID NOT NULL REFERENCES verticals(id),
  provider_id UUID REFERENCES providers(id),
  extracted_data JSONB NOT NULL,
  llm_confidence NUMERIC(5,2) NOT NULL,     -- raw LLM self-reported score
  final_confidence NUMERIC(5,2) NOT NULL,   -- after heuristic adjustments
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Review Tasks: human approval queue
-- References contract via FK (no data duplication)
CREATE TABLE review_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  contract_id UUID NOT NULL REFERENCES contracts(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'corrected', 'timed_out')),
  corrected_data JSONB,                    -- only populated if status = 'corrected'
  reviewer_notes TEXT,
  timeout_at TIMESTAMPTZ,                  -- 24h from creation for auto-reject
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUDIT
-- ============================================

-- Workflow State Log: full audit trail of state transitions
CREATE TABLE workflow_state_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  from_state TEXT,                         -- NULL for initial state
  to_state TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',            -- error details, trigger info, etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Indexes

```sql
CREATE INDEX idx_workflows_state ON workflows(state);
CREATE INDEX idx_workflows_vertical ON workflows(vertical_id);
CREATE INDEX idx_review_tasks_pending ON review_tasks(status) WHERE status = 'pending';
CREATE INDEX idx_review_tasks_timeout ON review_tasks(timeout_at) WHERE status = 'pending';
CREATE INDEX idx_provider_configs_provider ON provider_configs(provider_id);
CREATE INDEX idx_providers_vertical ON providers(vertical_id);
CREATE INDEX idx_workflow_state_log_workflow ON workflow_state_log(workflow_id);
CREATE INDEX idx_contracts_workflow ON contracts(workflow_id);
```

### Entity Relationships

```
verticals (1) ──→ (many) providers (1) ──→ (many) provider_configs
                           │
                           ▼
workflows (1) ──→ (1) contracts (1) ──→ (0..1) review_tasks
    │
    └──→ (many) workflow_state_log
```

### Config Lookup Chain

```
1. User provides vertical slug → look up verticals row
2. LLM extracts provider name → look up or create providers row
3. Merge config: vertical base_required_fields + provider_configs overrides
4. Use langfuse_prompt_name from provider_config (if set) or vertical default
5. Validate extracted data against merged config
```

---

## Provider Abstraction Strategy

### Problem
Need to handle Vattenfall (Energy) and Deutsche Telekom (Telco) without duplicating logic.

### Solution: Configuration-Driven Abstraction

**Design Principles:**
1. **Single Responsibility:** Each vertical has dedicated prompt
2. **Open/Closed:** Add providers via config, don't modify core logic
3. **Dependency Inversion:** Code depends on `ProviderConfig` abstraction

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Workflow (Core Logic)                        │
│         [Provider-Agnostic Orchestration]                │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Uses
                     ▼
┌─────────────────────────────────────────────────────────┐
│           ProviderRegistry                               │
│    getConfig(vertical) → ProviderConfig                  │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Returns
                     ▼
┌─────────────────────────────────────────────────────────┐
│           ProviderConfig                                 │
│  - required_fields: string[]                             │
│  - validation_rules: ValidationRules                     │
│  - langfuse_prompt_name: string                          │
└─────────────────────────────────────────────────────────┘
```

### Adding New Provider

```sql
-- Zero code changes needed
INSERT INTO provider_configs (provider_id, vertical, required_fields, langfuse_prompt_name)
VALUES ('allianz', 'insurance',
        ARRAY['provider', 'monthly_premium', 'coverage_type'],
        'contract-extraction-insurance');
```

Then create prompt in Langfuse UI → System automatically handles Insurance contracts.

---

## Workflow State Machine

### States (10 total)

```
┌─────────┐
│ PENDING │
└────┬────┘
     │
     ▼
┌─────────────┐
│ PARSING_PDF │──────────────────────────────────────┐
└──────┬──────┘                                      │
       │ text extracted                              │
       ▼                                             │
┌─────────────┐                                      │
│ EXTRACTING  │──────────────────────────────────────┤
└──────┬──────┘                                      │
       │ JSON parsed                                 │
       ▼                                             │
┌─────────────┐                                      │
│ VALIDATING  │──────────────────────────────────────┤
└──┬───────┬──┘                                      │
   │       │                                         ▼
   │       │ confidence < 80              ┌────────────────┐
   │       │ OR validation failure        │     FAILED     │
   │       ▼                              │  (transient)   │
   │  ┌─────────────────┐                └───┬────────┬───┘
   │  │ REVIEW_REQUIRED │                    │        │
   │  │ (Windmill       │             retry? │    max retries
   │  │  suspend)       │      (back to step │        │
   │  └──┬─────┬────┬──┘        that failed) │        │
   │     │     │    │                        ▼        ▼
   │ approved  │  timeout              ┌──────────────────┐
   │ /corrected│  (24h)               │    REJECTED      │
   │     │  rejected                   │    (terminal)    │
   │     │     │    │                  └──────────────────┘
   │     │     │    ▼
   │     │     │  ┌───────────┐
   │     │     │  │ TIMED_OUT │
   │     │     │  │ (terminal)│
   │     │     │  └───────────┘
   │     │     ▼
   │     │   REJECTED
   │     │
   │  confidence ≥ 80
   │  + valid
   │     │
   ▼     ▼
┌─────────────┐
│  VALIDATED  │ ← convergence point (auto-approve + human-approve)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  COMPARING  │ (mock tariff comparison)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  COMPLETED  │ (terminal)
└─────────────┘
```

### State Definitions

| State | Type | Description | Service Endpoint |
|-------|------|-------------|-----------------|
| `pending` | Initial | Workflow created, queued for processing | `POST /workflows/ingest` |
| `parsing_pdf` | Processing | Extracting text from PDF via pdfjs-dist | `POST /workflows/ingest` |
| `extracting` | Processing | LLM call via Groq for structured extraction | `POST /workflows/:id/extract` |
| `validating` | Processing | Schema validation, confidence scoring, provider lookup | `POST /workflows/:id/extract` |
| `review_required` | Suspended | Waiting for human approve/reject/correct | `POST /workflows/:id/extract` → Windmill suspends |
| `validated` | Processing | Data approved (auto or human), convergence point | `POST /workflows/:id/extract` or `/review` |
| `comparing` | Processing | Mock tariff comparison (demonstrates extensibility) | `POST /workflows/:id/compare` |
| `completed` | Terminal | Successfully processed and stored | `POST /workflows/:id/compare` |
| `rejected` | Terminal | Human rejected OR max retries exceeded | `POST /workflows/:id/review` or retry limit |
| `timed_out` | Terminal | Review expired after 24h with no human action | `POST /workflows/:id/review` (timeout) |
| `failed` | Transient | Error at a processing step, may retry | Any endpoint on error |

### State Transitions

| From | To | Trigger | Condition |
|------|-----|---------|-----------|
| `pending` | `parsing_pdf` | Workflow starts | — |
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
| `comparing` | `failed` | Error | Unexpected error (unlikely in mock) |
| `failed` | *(step that failed)* | Retry | `retry_count < 3`, resumes at failed step |
| `failed` | `rejected` | Max retries exceeded | `retry_count >= 3` |

### Implementation Notes

- **All state transitions logged** in `workflow_state_log` with metadata (error details, trigger info)
- **Each transition validated** — invalid jumps rejected at the service layer
- **Terminal states:** `completed`, `rejected`, `timed_out`
- **Retry targets the failed step:** `workflow_state_log.metadata` stores `failed_at_step`. Windmill's per-step retry calls the same service endpoint again.
- **`validated` is a convergence point:** both auto-approve and human-approve paths merge here
- **`failed` is transient, not terminal:** either retried or moved to `rejected`
- **Service owns all transitions:** Windmill reads the response to decide the next step but never writes state directly

---

## Error Handling Strategy

> Full details in [docs/guidelines/ERROR_HANDLING.md](docs/guidelines/ERROR_HANDLING.md)

### Design Principles

1. **Result types** for expected failures (`Result<T, AppError>`), throw for programming errors
2. **Error codes per workflow step** — centralized in `src/domain/errors.ts`
3. **Retry transient errors only** — permanent errors fail immediately
4. **Route ambiguous failures to human review** — when in doubt, let a human decide
5. **HTTP status codes signal retryability** — 503 = retryable, 400/422 = permanent

### Error → Action Summary

| Step | Transient Errors | Permanent Errors | Validation Errors |
|------|-----------------|------------------|-------------------|
| `ingest` | — | → `failed` (corrupt PDF) | — |
| `extract` | → 503 (LLM 5xx, timeout, 429) → Windmill retries | → 400 (auth error) | Malformed JSON: retry once, then → `review_required` |
| `compare` | → 503 (data source unavailable) | — | — |
| Any step | DB connection error → 503 | — | — |

### HTTP Error Response Format

All errors use the response envelope (see [API_GUIDELINES.md](docs/guidelines/API_GUIDELINES.md)):

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "LLM_API_ERROR",
    "message": "Groq API returned 503",
    "retryable": true
  }
}
```

### Retry Logic

- **Windmill retry config per step:**
  - `ingest`: no retry (corrupt PDF is permanent)
  - `extract`: 3 retries, exponential backoff (LLM failures are transient)
  - `compare`: 1 retry
- **Service tracks:** `workflows.retry_count` + `workflow_state_log.metadata.failed_at_step`
- **Max retries exceeded:** service transitions to `rejected`

### Graceful Degradation

| Failure | Fallback |
|---------|----------|
| Langfuse down | Use cached prompts (5min TTL in memory) |
| LLM API down (Groq) | → 503 → Windmill retries |
| NeonDB connection lost | Retry connection 3x with backoff, then → 503 |
| Malformed LLM JSON | Retry LLM once inline, then → `review_required` with raw text |
| Unknown provider extracted | → `review_required` (human decides if provider should be added) |

---

## API Design

> Full standards in [docs/guidelines/API_GUIDELINES.md](docs/guidelines/API_GUIDELINES.md)

### Response Envelope

All responses use a consistent envelope (adapted from [Relevé API Standards](https://github.com/josh-kwaku/releve)):

```typescript
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: string; retryable?: boolean } | null;
}
```

Business logic outcomes (including `needsReview: true`) return HTTP 200 with `success: true`. Infrastructure errors return HTTP 5xx with `retryable: true` so Windmill retries. See API_GUIDELINES.md for the full status code mapping.

### OpenAPI Documentation

Interactive docs at `/docs` (Swagger UI). Raw spec at `/openapi.json`. Generated via `swagger-jsdoc` annotations on each route.

### Service Endpoints

#### POST /workflows/ingest

Receive a contract PDF, parse it, and create a workflow.

**Request:**
```json
{
  "pdfBase64": "<base64-encoded-pdf>",
  "verticalSlug": "energy",
  "filename": "vattenfall-contract.pdf"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "workflowId": "550e8400-e29b-41d4-a716-446655440000",
    "state": "extracting",
    "pdfText": "Stromvertrag Vattenfall...",
    "verticalId": "...",
    "createdAt": "2026-02-01T10:00:00Z"
  },
  "error": null
}
```

#### POST /workflows/:id/extract

Run LLM extraction and validation on parsed text.

**Request:**
```json
{
  "pdfText": "Stromvertrag Vattenfall...",
  "verticalSlug": "energy"
}
```

**Response (200 OK) — auto-approved:**
```json
{
  "success": true,
  "data": {
    "workflowId": "550e8400-e29b-41d4-a716-446655440000",
    "state": "validated",
    "extractedData": {
      "provider": "Vattenfall",
      "monthly_rate": 89.99,
      "contract_start": "2026-01-01"
    },
    "llmConfidence": 92,
    "finalConfidence": 87,
    "needsReview": false,
    "contractId": "..."
  },
  "error": null
}
```

**Response (200 OK) — needs review:**
```json
{
  "success": true,
  "data": {
    "workflowId": "550e8400-e29b-41d4-a716-446655440000",
    "state": "review_required",
    "extractedData": { ... },
    "finalConfidence": 62,
    "needsReview": true,
    "contractId": "...",
    "reviewTaskId": "..."
  },
  "error": null
}
```

Both are `success: true` — the service processed the request correctly. Windmill reads `data.needsReview` to decide whether to branch to the approval step.

#### POST /workflows/:id/compare

Run tariff comparison (mock for POC).

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "workflowId": "550e8400-e29b-41d4-a716-446655440000",
    "state": "completed",
    "comparison": {
      "currentTariff": "Vattenfall Basis",
      "alternatives": []
    }
  },
  "error": null
}
```

#### POST /workflows/:id/review

Record a human review decision.

**Request:**
```json
{
  "action": "correct",
  "correctedData": { "monthly_rate": 79.99 },
  "notes": "Rate was misread from PDF"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "workflowId": "550e8400-e29b-41d4-a716-446655440000",
    "state": "validated",
    "reviewTask": {
      "id": "...",
      "status": "corrected"
    }
  },
  "error": null
}
```

#### GET /workflows/:id

Get workflow status.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "state": "review_required",
    "vertical": "energy",
    "contract": {
      "provider": "Vattenfall",
      "monthly_rate": 89.99,
      "confidence": 75
    }
  },
  "error": null
}
```

#### GET /reviews/pending

List pending review tasks.

#### Error Response Example (503 — retryable)

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "LLM_API_ERROR",
    "message": "Groq API returned 503",
    "retryable": true
  }
}
```

---

## Security & Infrastructure

### Security Measures

| Layer | Implementation |
|-------|----------------|
| **Secrets** | Environment variables, never in code |
| **Input Validation** | Zod schemas on all API inputs |
| **SQL Injection** | Drizzle ORM parameterized queries |
| **Body Size Limit** | 50MB (Express JSON parser) |
| **Authentication** | Not implemented for POC (production TODO) |

### Environment Configuration

```bash
# .env
DATABASE_URL=postgresql://...@neon.tech/contracts
GROQ_API_KEY=gsk_...
# ANTHROPIC_API_KEY=sk-ant-...  # Optional: enable AnthropicProvider adapter
LLM_PROVIDER=groq                # groq | anthropic
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
PORT=3000
```

### Infrastructure

- **Service:** Express (Node.js), deployed locally or on Cloud Run/ECS
- **Database:** NeonDB (serverless Postgres)
- **Workflow Engine:** Windmill (Docker locally, cloud for prod) — orchestrator only
- **LLM:** Groq API (HTTPS)
- **Prompt Management:** Langfuse Cloud (EU region)

---

## Project Structure

```
switchup/
├── docs/
│   ├── PRD_Contract_Processing_System.md
│   ├── TECHNICAL_DESIGN_Contract_Processing_System.md
│   ├── decisions/                        # ADR-001 through ADR-003
│   └── guidelines/
│       ├── CODE_GUIDELINES.md
│       └── ERROR_HANDLING.md
│
├── db/
│   └── migrations/                       # Drizzle Kit auto-generated
│
├── src/
│   ├── domain/                           # Pure types, zero dependencies
│   │   ├── types.ts                      # Vertical, Provider, Workflow, Contract, ReviewTask
│   │   ├── errors.ts                     # ErrorCode enum, AppError interface
│   │   ├── result.ts                     # Result<T, E> utility (ok, err)
│   │   └── schemas.ts                    # Zod schemas for API inputs
│   │
│   ├── services/                         # Business logic
│   │   ├── extraction/
│   │   │   ├── types.ts
│   │   │   ├── confidence.ts             # Heuristic confidence adjustments
│   │   │   └── index.ts                  # ExtractionService orchestration
│   │   ├── validation/
│   │   │   ├── types.ts
│   │   │   ├── schema-validator.ts
│   │   │   └── index.ts
│   │   ├── review/
│   │   │   ├── types.ts
│   │   │   ├── repository.ts
│   │   │   └── index.ts
│   │   ├── contract/
│   │   │   ├── types.ts
│   │   │   ├── repository.ts
│   │   │   └── index.ts
│   │   ├── workflow/
│   │   │   ├── types.ts
│   │   │   ├── repository.ts
│   │   │   └── index.ts
│   │   └── provider-registry/
│   │       ├── types.ts
│   │       ├── repository.ts
│   │       └── index.ts
│   │
│   ├── infrastructure/                   # External integrations
│   │   ├── db/
│   │   │   ├── schema.ts                 # Drizzle table definitions
│   │   │   └── client.ts                 # NeonDB connection
│   │   ├── langfuse.ts                   # Langfuse client + prompt cache
│   │   ├── llm/
│   │   │   ├── types.ts                  # LLMProvider interface
│   │   │   ├── groq.ts                   # Groq adapter
│   │   │   └── index.ts                  # Factory
│   │   ├── pdf-parser.ts                 # pdfjs-dist wrapper
│   │   ├── pdf-storage.ts               # Local file storage
│   │   └── logger.ts                     # Pino structured logger
│   │
│   └── api/                              # Express HTTP layer
│       ├── app.ts                        # Express app setup
│       ├── server.ts                     # HTTP server entry point
│       ├── routes/
│       │   └── workflow.ts               # All workflow endpoints
│       └── middleware/
│           ├── error-handler.ts          # AppError → HTTP response
│           └── request-logger.ts         # Pino HTTP logging
│
├── f/                                    # Windmill scripts (thin HTTP callers)
│   ├── process_contract/
│   │   ├── ingest.ts                     # ~10 lines: call POST /workflows/ingest
│   │   ├── extract.ts                    # ~10 lines: call POST /workflows/:id/extract
│   │   ├── compare.ts                    # ~10 lines: call POST /workflows/:id/compare
│   │   └── handle_review.ts             # ~10 lines: call POST /workflows/:id/review
│   └── process_contract.flow/
│       └── flow.yaml                     # 4-step Windmill flow definition
│
├── test/
│   ├── fixtures/                         # Synthetic German PDF contracts
│   ├── domain/
│   ├── services/
│   └── api/                              # HTTP endpoint tests
│
├── scripts/
│   ├── migrate.ts
│   ├── seed.ts
│   ├── demo.ts                           # Direct API demo
│   └── demo-windmill.ts                  # Windmill-orchestrated demo
│
├── .env.example
├── docker-compose.yml                    # Windmill local setup
├── package.json
├── tsconfig.json
└── README.md
```

### Layer Dependencies

```
domain/          ← Pure types, zero dependencies. Imported by everything.
    ↑
services/        ← Business logic. Depends on domain/ and infrastructure/.
    ↑
infrastructure/  ← External integrations (DB, Langfuse, Groq, PDF). Depends on domain/.
    ↑
api/             ← Express HTTP layer. Depends on services/ and domain/.
                   Thin: validation, routing, error mapping. No business logic.

f/               ← Windmill scripts. HTTP callers only. No imports from src/.
                   Independent deployment unit.
```

> Full coding standards in [docs/guidelines/CODE_GUIDELINES.md](docs/guidelines/CODE_GUIDELINES.md)

---

## Testing Strategy

### Test Pyramid

```
     ┌─────────────┐
     │ Integration │  ← 10 tests (full HTTP workflow)
     └─────────────┘
   ┌─────────────────┐
   │  Service Tests  │  ← 30 tests (ExtractionService, etc.)
   └─────────────────┘
 ┌─────────────────────┐
 │    Unit Tests       │  ← 50 tests (domain logic)
 └─────────────────────┘
```

### Key Test Scenarios

1. **High-confidence extraction** → Auto-approve → Complete
2. **Low-confidence extraction** → Human review → Approve → Complete
3. **Transient error** → 503 response → Windmill retries → Success
4. **Permanent error** → 400 response → Fail immediately
5. **Add new provider** → System processes correctly
6. **Direct API call** → Same behavior without Windmill

---

## Monitoring & Observability

### Key Metrics

- **Workflow metrics:** Total, completed, failed, avg time
- **Extraction metrics:** Confidence distribution, review rate
- **LLM metrics:** Latency, token usage, error rate (via Langfuse)
- **HTTP metrics:** Request latency, status code distribution, error rate

### Logging

- Structured JSON logs (Pino)
- Log levels: ERROR, WARN, INFO, DEBUG
- Include: `workflowId`, `requestId`, `step`, `vertical`, `state`
- HTTP request/response logging with duration

---

## Open Questions & Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Full DDD vs Lightweight? | **Lightweight** | POC doesn't need heavy infrastructure |
| Local DB vs Cloud? | **NeonDB (cloud)** | Matches SwitchUp stack, zero ops |
| Authentication? | **Skip for POC** | Focus on core functionality first |
| A/B testing prompts? | **Future feature** | Need traffic first |
| Service deployment? | **Local for POC** | Cloud Run/ECS for production |

---

## Success Criteria

Demo succeeds when:
1. ✅ Process Energy, Telco, Insurance with same code
2. ✅ Update prompt in Langfuse → next run uses new version
3. ✅ Low confidence automatically triggers review
4. ✅ Failed workflows retry gracefully (Windmill retries HTTP calls)
5. ✅ Code is clean and interview-ready
6. ✅ Service works both directly (API) and via Windmill orchestration

---
