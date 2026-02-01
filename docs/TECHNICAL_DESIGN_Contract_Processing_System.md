# Technical Design Document
## Contract Processing Workflow System

**Version:** 1.0  
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
│                    CLIENT (API Request)                  │
│              POST /api/contracts/process                 │
│              { pdf_url, vertical }                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              WINDMILL WORKFLOW ENGINE                    │
│                                                          │
│  Extract PDF → Fetch Prompt → LLM Extract →            │
│  Confidence Check → [Human Review?] → Validate →        │
│  Store → Complete                                        │
│                                                          │
└─────┬──────────────┬──────────────┬─────────────────────┘
      │              │              │
      ▼              ▼              ▼
┌──────────┐   ┌──────────┐   ┌──────────┐
│ Langfuse │   │  NeonDB  │   │ Anthropic│
│ Prompts  │   │PostgreSQL│   │  Claude  │
└──────────┘   └──────────┘   └──────────┘
```

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Workflow Engine** | Windmill (Flow-based, Docker local) | Native suspend/resume for human-in-loop |
| **Database** | NeonDB (Postgres) | Serverless, branching, auto-scales |
| **Prompt Storage** | Langfuse | Non-technical updates, versioning, tracing |
| **LLM Provider** | Groq (Llama 3.3 70B), model-agnostic adapter | Free tier, Claude-swappable via config |
| **PDF Parsing** | pdfjs-dist (Mozilla PDF.js) | Actively maintained, reliable extraction |
| **DDD Approach** | Lightweight | Clear boundaries, skip heavy infrastructure for POC |
| **State Management** | Database-backed | Survives restarts, enables debugging |
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

### 1. Windmill Workflow Engine

**Responsibilities:**
- Orchestrate multi-step contract processing
- Manage workflow state transitions
- Suspend/resume for human approval
- Retry failed steps

**Why Windmill?**
- Built-in human-in-loop primitives (`suspend()`)
- TypeScript-native
- Low-latency execution
- Local development friendly

---

### 2. Langfuse Prompt Management

**Responsibilities:**
- Store prompt templates with variables
- Version control (immutable history)
- Deploy via labels (production, staging, experiment)
- Trace all LLM calls for observability

**Integration Pattern:**
```typescript
const prompt = await langfuse.getPrompt("contract-extraction-energy");
const compiled = prompt.compile({ contract_text: pdfText });
const response = await claude.call(compiled, prompt.config);
```

**Key Features Used:**
- Prompt versioning
- Variable interpolation (`{{contract_text}}`)
- Model config storage (model, temperature, max_tokens)
- LLM call tracing

---

### 3. NeonDB (PostgreSQL)

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

### 4. LLM Provider (Model-Agnostic)

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
│              Workflow (Core Logic)                       │
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

| State | Type | Description | Windmill Flow Step |
|-------|------|-------------|-------------------|
| `pending` | Initial | Workflow created, queued for processing | Trigger |
| `parsing_pdf` | Processing | Extracting text from PDF via pdfjs-dist | Step 1: Parse PDF |
| `extracting` | Processing | LLM call via Groq (or Claude) for structured extraction | Step 2: LLM Extract |
| `validating` | Processing | Schema validation, confidence scoring (LLM + heuristic), provider lookup | Step 3: Validate |
| `review_required` | Suspended | Windmill suspend — waiting for human approve/reject/correct | Step 4: Approval |
| `validated` | Processing | Data approved (auto or human), convergence point before downstream steps | Step 5: Transition |
| `comparing` | Processing | Mock tariff comparison step (demonstrates extensibility) | Step 6: Compare |
| `completed` | Terminal | Successfully processed and stored | End (success) |
| `rejected` | Terminal | Human rejected OR max retries exceeded | End (rejected) |
| `timed_out` | Terminal | Review expired after 24h with no human action | End (timed out) |
| `failed` | Transient | Error occurred at a processing step, may retry | Error handler |

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
- **Each transition validated** — invalid jumps rejected at the application layer
- **Terminal states:** `completed`, `rejected`, `timed_out`
- **Retry targets the failed step:** `workflow_state_log.metadata` stores `failed_at_step` so retry logic resumes at the correct point (e.g., `failed` → `extracting`, not back to `parsing_pdf`)
- **`validated` is a convergence point:** both auto-approve (`validating → validated`) and human-approve (`review_required → validated`) paths merge here, so downstream steps don't need to know whether a human was involved
- **`failed` is transient, not terminal:** a workflow in `failed` either gets retried or moves to `rejected`

---

## Error Handling Strategy

> Full details in [docs/guidelines/ERROR_HANDLING.md](docs/guidelines/ERROR_HANDLING.md)

### Design Principles

1. **Result types** for expected failures (`Result<T, AppError>`), throw for programming errors
2. **Error codes per workflow step** — centralized in `src/domain/errors.ts`
3. **Retry transient errors only** — permanent errors fail immediately
4. **Route ambiguous failures to human review** — when in doubt, let a human decide
5. **No circuit breaker** for POC — each workflow is independent

### Error → Action Summary

| Step | Transient Errors | Permanent Errors | Validation Errors |
|------|-----------------|------------------|-------------------|
| `parsing_pdf` | — | → `rejected` (corrupt PDF) | — |
| `extracting` | → retry (LLM 5xx, timeout, 429) | → `rejected` (auth error) | Malformed JSON: retry once, then → `review_required` |
| `validating` | — | — | All validation failures → `review_required` |
| Any step | DB connection error → retry same step | — | — |

### Retry Logic

- **Max Attempts:** 3 per workflow
- **Backoff:** Exponential (1s, 2s, 4s) + jitter
- **Retry Target:** The specific step that failed (not the entire pipeline)
- **Tracking:** `workflows.retry_count` + `workflow_state_log.metadata.failed_at_step`

### Graceful Degradation

| Failure | Fallback |
|---------|----------|
| Langfuse down | Use cached prompts (5min TTL in memory) |
| LLM API down (Groq/Claude) | → `failed` state, queue for retry |
| NeonDB connection lost | Retry connection 3x with backoff, then → `failed` |
| Malformed LLM JSON | Retry LLM once inline, then → `review_required` with raw text |
| Unknown provider extracted | → `review_required` (human decides if provider should be added) |

---

## API Design

### Endpoints

```
POST   /api/contracts/process      # Initiate workflow
GET    /api/workflows/:id          # Get workflow status
GET    /api/reviews/pending        # List pending reviews
POST   /api/reviews/:id/approve    # Approve review
POST   /api/reviews/:id/reject     # Reject review
```

### Example: Initiate Workflow

**Request:**
```http
POST /api/contracts/process
Content-Type: application/json

{
  "pdf_url": "s3://contracts/vattenfall-123.pdf",
  "vertical": "energy"
}
```

**Response (202 Accepted):**
```json
{
  "workflow_id": "550e8400-e29b-41d4-a716-446655440000",
  "state": "pending",
  "created_at": "2026-02-01T10:00:00Z"
}
```

### Example: Get Status

**Request:**
```http
GET /api/workflows/550e8400-e29b-41d4-a716-446655440000
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "state": "review_required",
  "vertical": "energy",
  "contract": {
    "provider": "Vattenfall",
    "monthly_rate": 89.99,
    "confidence": 75
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
| **SQL Injection** | Parameterized queries only |
| **Rate Limiting** | 100 req/15min per IP |
| **Authentication** | JWT tokens (future: V2) |

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
```

### Infrastructure

- **Database:** NeonDB (serverless Postgres)
- **Workflow Engine:** Windmill (Docker locally, cloud for prod)
- **LLM:** Anthropic Claude API (HTTPS)
- **Prompt Management:** Langfuse Cloud (EU region)

---

## Project Structure

```
switchup/
├── docs/
│   ├── PRD_Contract_Processing_System.md
│   ├── TECHNICAL_DESIGN_Contract_Processing_System.md
│   ├── CONTEXT_FOR_CLAUDE_CODE.md
│   └── guidelines/
│       ├── CODE_GUIDELINES.md          # Coding standards (adapted from Relevé)
│       └── ERROR_HANDLING.md           # Error codes, Result types, retry policy
│
├── db/
│   ├── schema.sql                      # Full DDL (all 7 tables + indexes)
│   └── seed.sql                        # Verticals + sample providers + configs
│
├── src/
│   ├── domain/                         # Domain types & value objects (zero dependencies)
│   │   ├── types.ts                    # Vertical, Provider, Workflow, Contract, ReviewTask
│   │   ├── errors.ts                   # ErrorCode enum, AppError interface
│   │   └── result.ts                   # Result<T, E> utility (ok, err)
│   │
│   ├── services/                       # Domain services (business logic)
│   │   ├── extraction/
│   │   │   ├── types.ts                # ExtractionResult, ConfidenceScore
│   │   │   ├── llm-provider.ts         # LLMProvider interface + GroqProvider
│   │   │   ├── confidence.ts           # Heuristic confidence adjustments
│   │   │   └── index.ts               # ExtractionService orchestration
│   │   ├── validation/
│   │   │   ├── types.ts
│   │   │   ├── schema-validator.ts     # Validate extracted data vs merged config
│   │   │   └── index.ts
│   │   ├── review/
│   │   │   ├── types.ts
│   │   │   └── index.ts               # Create review task, handle approval
│   │   └── provider-registry/
│   │       ├── types.ts
│   │       └── index.ts               # Config lookup + merge chain
│   │
│   ├── infrastructure/                 # External integrations (swappable, mockable)
│   │   ├── database.ts                 # NeonDB connection + query helpers
│   │   ├── langfuse.ts                 # Langfuse client + prompt cache (5min TTL)
│   │   ├── groq.ts                     # Groq API client
│   │   └── pdf-parser.ts              # pdfjs-dist wrapper
│   │
│   └── workflows/                      # Windmill flow + scripts
│       ├── process-contract.flow.yaml  # Windmill Flow definition (DAG)
│       ├── scripts/
│       │   ├── parse-pdf.ts            # Step 1: PARSING_PDF
│       │   ├── extract-data.ts         # Step 2: EXTRACTING
│       │   ├── validate-data.ts        # Step 3: VALIDATING
│       │   ├── compare-tariffs.ts      # Step 6: COMPARING (mock)
│       │   └── update-state.ts         # Shared: state transition helper
│       └── triggers/
│           └── process-contract.ts     # Webhook trigger entry point
│
├── test/
│   ├── fixtures/                       # Synthetic German PDF contracts
│   │   ├── vattenfall-energy.pdf
│   │   ├── telekom-telco.pdf
│   │   └── allianz-insurance.pdf
│   ├── domain/
│   ├── services/
│   └── workflows/
│
├── .env.example
├── docker-compose.yml                  # Windmill local setup
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
workflows/       ← Windmill scripts. Orchestrate services. Entry points.
```

> Full coding standards in [docs/guidelines/CODE_GUIDELINES.md](docs/guidelines/CODE_GUIDELINES.md)

---

## Testing Strategy

### Test Pyramid

```
     ┌─────────────┐
     │ Integration │  ← 10 tests (full workflow)
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
3. **Transient error** → Retry → Success
4. **Permanent error** → Fail immediately
5. **Add new provider** → System processes correctly

---

## Monitoring & Observability

### Key Metrics

- **Workflow metrics:** Total, completed, failed, avg time
- **Extraction metrics:** Confidence distribution, review rate
- **LLM metrics:** Latency, token usage, error rate (via Langfuse)
- **System metrics:** API latency, DB query time

### Logging

- Structured JSON logs (pino)
- Log levels: ERROR, WARN, INFO, DEBUG
- Include: workflow_id, vertical, state, timestamp

---

## Open Questions & Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Full DDD vs Lightweight? | **Lightweight** | POC doesn't need heavy infrastructure |
| Local DB vs Cloud? | **NeonDB (cloud)** | Matches SwitchUp stack, zero ops |
| Authentication? | **Skip V1, add V2** | Focus on core functionality first |
| A/B testing prompts? | **V2 feature** | Need traffic first |

---

## Next Steps

1. **Setup** (Day 1):
   - Create NeonDB database
   - Setup Windmill locally
   - Create Langfuse account
   - Initialize project structure

2. **Core Development** (Day 2-3):
   - Implement extraction service
   - Build workflow orchestration
   - Add human review logic
   - Create provider configs

3. **Polish** (Day 4):
   - Error handling
   - Testing
   - Documentation
   - Demo preparation

---

## Success Criteria

Demo succeeds when:
1. ✅ Process Energy, Telco, Insurance with same code
2. ✅ Update prompt in Langfuse → next run uses new version
3. ✅ Low confidence automatically triggers review
4. ✅ Failed workflows retry gracefully
5. ✅ Code is clean and interview-ready

---
