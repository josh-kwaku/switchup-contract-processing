# SwitchUp Contract Processing System

AI-powered contract processing pipeline with multi-vertical support, human-in-the-loop review, and workflow orchestration. Built as a portfolio demo for SwitchUp (Berlin) — Senior Fullstack Engineer, Internal AI-Native Platform.

## What It Does

Processes German utility contracts (Energy, Telco, Insurance) through a unified pipeline:

1. **Ingest** — Upload PDF, parse text, store document
2. **Extract** — LLM extracts structured data (provider, rates, contract terms)
3. **Validate** — Schema validation + confidence scoring against provider-specific rules
4. **Review** — Low confidence (<80%) or unknown providers route to human review
5. **Compare** — Mock tariff comparison (extensibility demo)

Each vertical uses the same pipeline with different prompts and validation rules — no code changes needed to add a new vertical.

## Architecture

```
PDF Upload
    |
    v
[Windmill Flow]  ─── orchestrates ───>  [Express Service]  ─── delegates ───>  [Domain Services]
  (thin HTTP          step sequencing       API layer            business logic
   callers)           suspend/resume        validation           state machine
                      error handling        routing              DB operations
    |                                          |
    v                                          v
[Langfuse]                                 [NeonDB]
  prompt mgmt                               Postgres
  LLM tracing                               Drizzle ORM
    |
    v
[Groq API]
  Llama 3.3 70B
```

**Key pattern:** Windmill is a pure orchestrator — all business logic lives in `src/`. Windmill scripts are thin HTTP callers (~15 lines each) that delegate to the Express service. See [ADR-002](docs/decisions/ADR-002-architecture-service-plus-orchestrator.md).

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict mode) |
| Workflow Engine | Windmill.dev |
| LLM | Groq (Llama 3.3 70B) via model-agnostic adapter |
| Prompt Management | Langfuse (with 5-min cache + stale fallback) |
| Database | NeonDB (serverless Postgres) |
| ORM | Drizzle |
| PDF Parsing | pdfjs-dist (Mozilla PDF.js) |
| Validation | Zod |
| Logging | Pino (structured JSON) |
| HTTP | Express |

## Setup

### Prerequisites

- Node.js >= 20
- Docker + Docker Compose (for Windmill)
- NeonDB account (free tier)
- Groq API key (free tier)
- Langfuse account (free tier)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in: DATABASE_URL, GROQ_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
```

### 3. Set up database

```bash
npm run db:migrate
npm run db:seed
```

This creates 7 tables and seeds 3 verticals (energy, telco, insurance) with providers and configs.

### 4. Start the service

```bash
npm run dev          # Development (tsx --watch)
npm run build && npm start  # Production
```

### 5. Start Windmill (optional — for flow orchestration)

```bash
docker compose up -d
```

Then sync scripts and deploy the flow:

```bash
wmill sync push --yes
wmill flow push f/process-contract.flow f/process_contract/flow
```

See [Windmill Setup Guide](docs/guides/WINDMILL_SETUP.md) for details.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/workflows/ingest` | Upload PDF, create workflow |
| POST | `/workflows/:id/extract` | Run LLM extraction + validation |
| POST | `/workflows/:id/compare` | Run tariff comparison (mock) |
| POST | `/workflows/:id/review` | Submit review decision (approve/reject/correct/timeout) |
| POST | `/workflows/:id/retry` | Retry from failed step |
| GET | `/workflows/:id` | Get workflow status + contract data |
| GET | `/reviews/pending` | List pending review tasks |

## Demo Walkthrough

### Happy path (high confidence)

```bash
# 1. Ingest a Vattenfall energy contract
curl -X POST http://localhost:3000/workflows/ingest \
  -H 'Content-Type: application/json' \
  -d "{\"pdfBase64\": \"$(base64 -w0 test/fixtures/vattenfall-energy.pdf)\", \"verticalSlug\": \"energy\"}"

# 2. Extract (use workflowId and pdfText from response)
curl -X POST http://localhost:3000/workflows/<workflowId>/extract \
  -H 'Content-Type: application/json' \
  -d '{"pdfText": "<pdfText from step 1>", "verticalSlug": "energy"}'

# 3. Compare tariffs
curl -X POST http://localhost:3000/workflows/<workflowId>/compare
```

### Review path (low confidence)

Use `test/fixtures/low-confidence-energy.pdf` — unknown provider with missing fields triggers human review at the extract step. Approve, reject, or correct via the review endpoint.

### Via Windmill

Trigger the `process-contract` flow in the Windmill UI with `pdfBase64` and `verticalSlug`. The flow runs all steps automatically, suspending for human review when needed.

## Project Structure

```
src/
  domain/       Pure types, Result type, Zod schemas (zero dependencies)
  services/     Business logic: workflow, extraction, validation, review, contract
  infrastructure/  External integrations: DB, PDF parser, Langfuse, LLM
  api/          Express routes + middleware

f/              Windmill scripts (thin HTTP callers) + flow YAML
db/             Migrations
test/           Fixtures + tests
docs/           PRD, technical design, guidelines, ADRs
```

## Design Decisions

| Decision | Summary |
|----------|---------|
| [ADR-001](docs/decisions/ADR-001-technical-stack.md) | Groq + Langfuse + per-vertical prompts |
| [ADR-002](docs/decisions/ADR-002-architecture-service-plus-orchestrator.md) | Service + orchestrator split (Express owns logic, Windmill orchestrates) |
| [ADR-003](docs/decisions/ADR-003-workflow-state-machine.md) | 10-state workflow machine with retry from failed step |

## State Machine

```
pending → parsing_pdf → extracting → validating → validated → comparing → completed
                                        |
                                        v
                                  review_required → validated (approve/correct)
                                        |              |
                                        v              v
                                    rejected       timed_out

Any processing state → failed → (retry back to failed step, or rejected after 3 retries)
```

## Author

Joshua Boateng — [GitHub](https://github.com/josh-kwaku)
