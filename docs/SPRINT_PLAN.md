# Sprint Plan: SwitchUp Contract Processing System

**Version:** 3.0
**Date:** February 1, 2026
**Author:** Joshua Boateng
**Status:** Ready for implementation

---

## Overview

7 sprints, 31 tasks. Each sprint produces demoable software. Every task is atomic and committable.

**ORM:** Drizzle ORM throughout — TypeScript-first schema definitions, type-safe query builder, NeonDB-native adapter. No raw SQL in application code.

**Key changes from v2 (ADR-002):**
- `src/` deployed as Express HTTP service — service owns all domain logic
- Windmill is pure orchestrator — thin HTTP callers only, no business logic in `f/`
- Flow consolidated from 5 steps to 4: ingest, extract (+ validate), compare, approval
- Sprint 4 rewritten: HTTP API layer (Task 4.2) + thin Windmill scripts (Task 4.3) + flow (Task 4.4)
- Sprints 5-6 updated: review and retry logic communicated via HTTP
- Sprint 7: demo script works both direct-to-service and via Windmill
- See `docs/decisions/ADR-002-windmill-deployment-challenges.md` for full rationale

**Key changes from v1:**
- Drizzle ORM replaces raw SQL (`db/schema.sql` → `src/infrastructure/db/schema.ts`)
- Logger created in Sprint 1 (not Sprint 5)
- PDF storage moved to Sprint 3 (not Sprint 5)
- Sprint 3 split: services (Sprint 3) + Windmill (Sprint 4)
- Langfuse cache built in Task 2.2 (no duplicate task)
- Windmill resources/variables setup in Task 4.1
- Git init in Task 1.1
- NeonDB + Groq account setup in Task 1.1
- Demo video is a manual task, not in sprint plan

---

## Sprint 1: Foundation — Scaffolding, Domain Types, Database

**Goal:** A TypeScript project that compiles, connects to NeonDB via Drizzle, runs migrations, and seeds reference data. All domain types exist and are importable. Logger configured.

**Demo:** `npm run db:migrate && npm run db:seed` → tables created in NeonDB with 3 verticals, sample providers, and configs. `npm run build` → compiles cleanly. `npm test` → domain type tests pass.

### Task 1.1: Initialize TypeScript Project + External Accounts

Create the project scaffolding. Set up external service accounts.

**Deliverables:**
- `package.json` with TypeScript, Zod, Pino, dotenv, drizzle-orm, @neondatabase/serverless
- `tsconfig.json` with strict mode, ES2022 target, path aliases
- `.env.example` with all required env vars (DATABASE_URL, GROQ_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL, LLM_PROVIDER)
- `.gitignore` (node_modules, .env, dist, *.pdf, storage/)
- Empty directory structure: `src/domain/`, `src/services/`, `src/infrastructure/`, `src/workflows/`, `test/`, `db/`
- Initialize git repo with initial commit
- Create NeonDB database (serverless Postgres)
- Create Groq account and obtain API key

**Validation:** `npm install` succeeds. `npx tsc --noEmit` passes. Git initialized. NeonDB connection string works. Groq API key valid.

---

### Task 1.2: Create Domain Types + Logger

Define all core TypeScript types in `src/domain/` (zero external dependencies except Zod). Create the structured logger.

**Deliverables:**
- `src/domain/types.ts` — Interfaces: `Vertical`, `Provider`, `ProviderConfig`, `Workflow`, `Contract`, `ReviewTask`, `WorkflowStateLog`. Union type `WorkflowState` (`'pending' | 'parsing_pdf' | 'extracting' | 'validating' | 'review_required' | 'validated' | 'comparing' | 'completed' | 'rejected' | 'timed_out' | 'failed'`). Union type `ReviewStatus` (`'pending' | 'approved' | 'rejected' | 'corrected' | 'timed_out'`).
- `src/domain/errors.ts` — `ErrorCode` enum with all codes from ERROR_HANDLING.md. `AppError` interface with `code`, `message`, `details?`, `retryable`.
- `src/domain/result.ts` — `Result<T, E>` type, `ok()` and `err()` constructors.
- `src/domain/schemas.ts` — Zod schemas: `processContractInput` (pdfBase64, verticalSlug, filename?), `reviewActionInput` (action, correctedData?, notes?).
- `src/infrastructure/logger.ts` — Pino logger: JSON format, service name `contract-processing`. `createWorkflowLogger(workflowId, vertical?, provider?)` returns child logger with context.

**Validation:** Unit tests in `test/domain/` verify:
- WorkflowState union accepts valid states, rejects invalid
- Zod schemas accept valid input, reject malformed
- Result ok/err constructors work
- All error codes defined and unique
- Logger outputs structured JSON with expected fields

---

### Task 1.3: Create Drizzle Schema Definitions

Define the full database schema for all 7 tables using Drizzle ORM's TypeScript DSL.

**Deliverables:**
- `src/infrastructure/db/schema.ts` — Drizzle table definitions for:
  - `verticals` (id, slug, display_name, default_prompt_name, base_required_fields, active, created_at)
  - `providers` (id, slug, display_name, vertical_id FK, metadata, active, created_at)
  - `provider_configs` (id, provider_id FK, product_type, required_fields, validation_rules, langfuse_prompt_name, active, created_at, UNIQUE(provider_id, product_type))
  - `workflows` (id, vertical_id FK, provider_id FK nullable, pdf_storage_path, pdf_filename, state with CHECK, windmill_job_id, retry_count, error_message, created_at, updated_at)
  - `contracts` (id, workflow_id FK, vertical_id FK, provider_id FK, extracted_data JSONB, llm_confidence, final_confidence, created_at)
  - `review_tasks` (id, workflow_id FK, contract_id FK, status with CHECK, corrected_data, reviewer_notes, timeout_at, reviewed_at, created_at)
  - `workflow_state_log` (id, workflow_id FK, from_state, to_state, metadata JSONB, created_at)
- All indexes (state, vertical, pending reviews, timeout, provider configs, etc.)
- All FK constraints

**Validation:** Schema file compiles. Drizzle-inferred types align with domain types.

---

### Task 1.4: Create Database Infrastructure + Drizzle Config

Set up Drizzle ORM configuration and the NeonDB connection module.

**Deliverables:**
- `drizzle.config.ts` — Drizzle Kit config: schema path, migrations output directory, NeonDB connection
- `src/infrastructure/db/client.ts` — Drizzle client using `@neondatabase/serverless` (neon-http adapter). Connection retry logic (3 attempts, exponential backoff). Structured logging on connect/disconnect/error.
- Dev dependency: `drizzle-kit`

**Validation:** Integration test:
- Connects to NeonDB via Drizzle
- Runs a simple query successfully
- Handles connection failure gracefully (returns Result error)

---

### Task 1.5: Create Migration Runner + Seed Script

Scripts to apply Drizzle migrations and seed reference data.

**Deliverables:**
- `db/migrations/` directory for Drizzle Kit auto-generated migrations
- `scripts/migrate.ts` — Runs `drizzle-kit push` or `drizzle-kit migrate` (idempotent). Logs each table.
- `scripts/seed.ts` — Uses Drizzle insert operations (upsert pattern):
  - 3 verticals (energy, telco, insurance) with default prompt names and base required fields
  - 3–4 providers (Vattenfall, E.ON for energy; Deutsche Telekom for telco; Allianz for insurance)
  - Provider configs with validation rules per provider (e.g., monthly_rate min/max)
- `package.json` scripts: `db:migrate`, `db:seed`, `db:reset` (migrate + seed)

**Validation:** `npm run db:reset` → all tables created, seed data inserted. `SELECT count(*) FROM verticals` returns 3. Run again → no errors (idempotent).

---

### Task 1.6: Create Provider Registry Service

Implement the config lookup chain: vertical → provider → merged config. All queries via Drizzle.

**Deliverables:**
- `src/services/provider-registry/types.ts` — `MergedConfig` interface (resolved prompt name, merged required fields, merged validation rules)
- `src/services/provider-registry/index.ts` — Functions:
  - `getVertical(slug)`: `Result<Vertical, AppError>`
  - `findProvider(name, verticalId)`: `Result<Provider | null, AppError>`
  - `getMergedConfig(verticalId, providerId?)`: `Result<MergedConfig, AppError>`
- All functions use Drizzle query builder, return Result types

**Validation:** Unit tests with mocked DB:
- `getVertical('energy')` returns energy vertical
- `getVertical('nonexistent')` returns err
- `getMergedConfig` with provider config returns merged result (provider overrides vertical defaults)
- `getMergedConfig` without provider config returns vertical defaults
- Null `langfuse_prompt_name` falls back to vertical default

---

## Sprint 2: PDF Parsing + LLM Extraction Pipeline

**Goal:** Feed a PDF into the system, get structured extracted data back with a confidence score. Langfuse prompt management working with cache fallback. End-to-end from PDF bytes to JSON output.

**Demo:** Run a script: sample PDF → extract text → fetch prompt from Langfuse → call Groq → structured JSON with provider name, fields, and confidence score.

### Task 2.1: Create PDF Parser Infrastructure Module

Implement the pdfjs-dist wrapper for text extraction.

**Deliverables:**
- `src/infrastructure/pdf-parser.ts` — `extractTextFromPdf(pdfBase64: string)`: `Result<string, AppError>`
  - Decodes base64 → Buffer → pdfjs-dist document → concatenated page text
  - Errors: corrupt PDF → `PDF_PARSE_FAILED`, empty text → `PDF_EMPTY`, oversized → `PDF_TOO_LARGE` (default 10MB)
  - Structured logging: page count, text length

**Validation:** Unit tests:
- Valid PDF fixture → extracted text returned
- Corrupt data → `PDF_PARSE_FAILED`
- Empty PDF → `PDF_EMPTY`

---

### Task 2.2: Create Langfuse Infrastructure Module

Implement the Langfuse client with prompt cache (5-minute TTL) and graceful degradation.

**Deliverables:**
- `src/infrastructure/langfuse.ts` — Functions:
  - `getPrompt(name, label?)`: `Result<CompiledPrompt, AppError>` — fetch with cache. On Langfuse error: return stale cache if available, else `LANGFUSE_UNAVAILABLE`.
  - `traceGeneration(params)`: void — trace LLM calls for observability
  - `warmCache()`: pre-fetches all 3 vertical prompts on startup
- In-memory cache with 5-minute TTL
- Warning-level log when stale cache is used

**Validation:**
- Integration test: fetch a real prompt from Langfuse
- Unit test: cache hit returns cached; Langfuse failure returns stale cache with warning; no cache + Langfuse down → `LANGFUSE_UNAVAILABLE`

---

### Task 2.3: Set Up Langfuse Account and Create Prompts

Create the Langfuse account and define the 3 vertical-specific extraction prompts.

**Deliverables:**
- Langfuse account (cloud, EU region)
- 3 prompts:
  - `contract-extraction-energy` — extracts: provider, tariff_name, monthly_rate, annual_consumption_kwh, contract_start, contract_end, notice_period
  - `contract-extraction-telco` — extracts: provider, plan_name, monthly_rate, data_volume_gb, contract_duration_months, notice_period
  - `contract-extraction-insurance` — extracts: provider, policy_type, monthly_premium, coverage_amount, deductible, contract_start
- Each returns JSON with fields + `confidence` (0–100) + `vertical_match` (boolean)
- Variables: `{{contract_text}}`, `{{vertical}}`
- Label: `production`

**Validation:** Test each prompt in Langfuse playground with sample German contract text.

---

### Task 2.4: Create LLM Provider Infrastructure — Groq Adapter

Implement the model-agnostic LLM provider interface and the Groq implementation.

**Deliverables:**
- `src/infrastructure/llm/types.ts` — `LLMProvider` interface, `LLMResponse` type
- `src/infrastructure/llm/groq.ts` — `GroqProvider` class. Uses Groq SDK. Error mapping: 5xx → `LLM_API_ERROR`, 429 → `LLM_RATE_LIMITED`, 401 → `LLM_AUTH_ERROR`. Structured logging: model, latency, token usage.
- `src/infrastructure/llm/index.ts` — Factory `createLLMProvider(config)` → `GroqProvider` (or future `AnthropicProvider` based on `LLM_PROVIDER` env var)

**Validation:** Integration test calling Groq. Unit tests:
- Successful extraction → parsed JSON
- 429 → `LLM_RATE_LIMITED` (retryable: true)
- 500 → `LLM_API_ERROR` (retryable: true)
- 401 → `LLM_AUTH_ERROR` (retryable: false)
- Malformed JSON → `LLM_MALFORMED_RESPONSE`

---

### Task 2.5: Create Extraction Service

Orchestrate the full extraction pipeline: fetch prompt → call LLM → parse response → handle malformed JSON retry.

**Deliverables:**
- `src/services/extraction/types.ts` — `ExtractionResult`: `{ extractedData, llmConfidence, rawResponse, model, latencyMs }`
- `src/services/extraction/index.ts` — `extractContractData(pdfText, vertical, providerHint?)`: `Result<ExtractionResult, AppError>`
  - Fetches prompt from Langfuse (with cache fallback)
  - Calls LLM provider
  - Parses JSON response
  - Malformed JSON: retries once (does NOT count against workflow retry_count), then `LLM_MALFORMED_RESPONSE`
  - Traces call to Langfuse

**Validation:** Unit tests with mocked LLM and Langfuse:
- Valid response → ExtractionResult
- First call bad JSON, second succeeds → ExtractionResult
- Both calls bad JSON → `LLM_MALFORMED_RESPONSE`
- Langfuse unavailable → cached prompt used, extraction succeeds

---

### Task 2.6: Create Confidence Scoring Module

Heuristic confidence adjustments on top of LLM self-reported score.

**Deliverables:**
- `src/services/extraction/confidence.ts` — `computeFinalConfidence(llmScore, extractedData, requiredFields, validationRules?)`: `{ finalConfidence, adjustments }`
  - Missing required field: −15 per field
  - Empty/null required field: −10 per field
  - Value out of range: −10 per violation
  - `vertical_match === false`: −30
  - Floor at 0, cap at 100

**Validation:** Unit tests:
- All fields present → `finalConfidence === llmScore`
- One missing → `llmScore − 15`
- Vertical mismatch → `llmScore − 30`
- Multiple issues stack
- Floor: llmScore=20, 3 missing → `finalConfidence === 0`

---

### Task 2.7: Create End-to-End Extraction Script

Runnable script demonstrating the full Sprint 2 pipeline.

**Deliverables:**
- `scripts/test-extraction.ts` — CLI: PDF path + vertical slug → extract text → LLM extraction → confidence scoring → print JSON
- `package.json` script: `test:extract`

**Validation:** `npm run test:extract -- ./test/fixtures/vattenfall-energy.pdf energy` → structured JSON output.

---

## Sprint 3: Core Services — Workflow State Machine, Validation, Contracts

**Goal:** All service-layer logic implemented: workflow state machine, contract persistence, review task management, validation, PDF storage. All database operations use Drizzle.

**Demo:** Unit tests pass for all services. State machine enforces valid transitions.

### Task 3.1: Create PDF Storage Module

Save uploaded PDFs so reviewers can reference the original document.

**Deliverables:**
- `src/infrastructure/pdf-storage.ts` — Functions:
  - `storePdf(pdfBase64, workflowId, filename?)`: `Result<string, AppError>` — saves to `./storage/pdfs/{workflowId}/{filename}`, returns path
  - `getPdf(storagePath)`: `Result<Buffer, AppError>`
- `storage/` in `.gitignore`

**Validation:**
- Store a PDF → file exists at returned path
- Retrieve → contents match original

**Note**
In a production app, the pdfs will be stored in an object storage. But for the purposes of this demo, we keep them in the project folder.

---

### Task 3.2: Create Workflow State Transition Service

Implement the state machine: validate transitions, update DB via Drizzle, log to audit table.

**Deliverables:**
- `src/services/workflow/types.ts` — `StateTransition` type, valid transitions map (from → allowed to states)
- `src/services/workflow/index.ts` — Functions:
  - `createWorkflow(verticalId, pdfStoragePath, pdfFilename?)`: `Result<Workflow, AppError>` — inserts via Drizzle, state=`pending`
  - `transitionState(workflowId, toState, metadata?)`: `Result<Workflow, AppError>` — validates, updates workflow.state + updated_at via Drizzle, inserts `workflow_state_log`
  - `getWorkflow(workflowId)`: `Result<Workflow, AppError>`
  - `failWorkflow(workflowId, errorCode, errorMessage, failedAtStep)`: `Result<Workflow, AppError>` — transitions to `failed`, increments retry_count
- Invalid transitions return err

**Validation:** Unit tests:
- `createWorkflow` → state `pending`
- pending → parsing_pdf → succeeds, log entry created
- pending → completed → rejects
- `failWorkflow` increments retry_count
- retry_count >= 3 → transitions to `rejected`

---

### Task 3.3: Create Contract and Review Task Services

Database operations for contracts and review tasks, all via Drizzle.

**Deliverables:**
- `src/services/contract/index.ts`:
  - `createContract(workflowId, verticalId, providerId, extractedData, llmConfidence, finalConfidence)`: `Result<Contract, AppError>`
  - `getContract(contractId)`: `Result<Contract, AppError>`
  - `updateContractData(contractId, correctedData)`: `Result<Contract, AppError>`
- `src/services/review/types.ts` — Review task types
- `src/services/review/index.ts`:
  - `createReviewTask(workflowId, contractId, timeoutHours?)`: `Result<ReviewTask, AppError>` — status=`pending`, timeout_at = now + hours
  - `getPendingReviews()`: `Result<ReviewTask[], AppError>`
  - `approveReview(reviewTaskId, notes?)`: `Result<ReviewTask, AppError>`
  - `rejectReview(reviewTaskId, notes?)`: `Result<ReviewTask, AppError>`
  - `correctReview(reviewTaskId, correctedData, notes?)`: `Result<ReviewTask, AppError>`
  - `getTimedOutReviews()`: `Result<ReviewTask[], AppError>`

**Validation:** Unit tests with mocked DB:
- Create contract → returns with ID
- Create review → status `pending`, timeout_at set
- Approve → status `approved`, reviewed_at set
- Correct → corrected_data stored, contract updated

---

### Task 3.4: Create Validation Service

Schema validation of extracted data against merged config.

**Deliverables:**
- `src/services/validation/types.ts` — `ValidationResult`, `ValidationError`
- `src/services/validation/schema-validator.ts` — `validateExtractedData(extractedData, mergedConfig)`: `ValidationResult`
- `src/services/validation/index.ts` — `validateAndScore(extractedData, llmConfidence, mergedConfig)`: `Result<{ contractData, finalConfidence, needsReview, validationErrors }, AppError>`
  - Runs validation → confidence scoring → determines review: `finalConfidence < 80` OR validation errors

**Validation:** Unit tests:
- All valid, confidence=90 → `needsReview: false`
- Missing required field → `needsReview: true`
- Confidence=75 → `needsReview: true`

---

## Sprint 4: HTTP Service + Windmill Orchestration

**Goal:** `src/` deployed as an Express HTTP service. Windmill scripts are thin HTTP callers orchestrating the 4-step flow. Happy path works end-to-end. No business logic in Windmill.

**Architecture decision:** ADR-002 — Windmill as pure orchestrator, service owns all domain logic. See `docs/decisions/ADR-002-windmill-deployment-challenges.md`.

**Demo:** `npm run dev` starts service. Trigger Windmill flow → HTTP calls to service → states progress in Windmill UI → verify transitions in `workflow_state_log`.

### Task 4.1: Set Up Windmill Local Environment + Resources ✅ (Complete)

Configure Docker Compose, wmill CLI, and Windmill resources/variables.

**Deliverables:**
- `docker-compose.yml` — Windmill services (server, workers, database). Port 8000.
- Install and configure `wmill` CLI. Create workspace. Set up `wmill` sync for local dev.
- Configure Windmill resources/variables: SERVICE_URL, AUTH_TOKEN
- Document in `docs/guides/WINDMILL_SETUP.md`

**Validation:** `docker-compose up` → Windmill UI at localhost:8000. `wmill workspace` connected. Resources accessible from test script.

---

### Task 4.2: Create Express HTTP API Layer

Expose the existing service layer as HTTP endpoints. Express app with Zod request validation, response envelope, OpenAPI docs, and request-scoped logging. Must follow `docs/guidelines/API_GUIDELINES.md`.

**Deliverables:**
- `src/api/app.ts` — Express app setup: JSON body parser (50MB limit for PDFs), request ID middleware, Swagger UI at `/docs`, OpenAPI spec at `/openapi.json`, error handler
- `src/api/middleware/error-handler.ts` — Maps `AppError` to HTTP status codes + response envelope (`{ success, data, error }`). Business logic outcomes → 200 with `success: true`. Transient errors → 503 with `retryable: true`. Permanent errors → 400/422.
- `src/api/middleware/request-logger.ts` — Pino HTTP request logging (method, path, status, duration)
- `src/api/routes/workflow.ts` — Four processing endpoints + two query endpoints, all with OpenAPI annotations:
  - `POST /workflows/ingest` — Accepts `{ pdfBase64, verticalSlug, filename? }`. Validates with Zod. Looks up vertical. Stores PDF. Creates workflow. Parses PDF. Returns envelope with `{ workflowId, pdfText, state }`.
  - `POST /workflows/:id/extract` — Fetches prompt, calls LLM, validates extraction, creates contract. Returns envelope with `{ extractedData, finalConfidence, needsReview, contractId }`.
  - `POST /workflows/:id/compare` — Runs tariff comparison (mock). Returns envelope with `{ comparison }`.
  - `POST /workflows/:id/review` — Accepts `{ action, correctedData?, notes? }`. Updates review task and contract. Returns envelope with `{ reviewTask, state }`.
  - `GET /workflows/:id` — Get workflow status.
  - `GET /reviews/pending` — List pending review tasks.
- `src/api/server.ts` — HTTP server entry point. `package.json` scripts: `dev` (ts-node + watch), `start` (compiled)
- No authentication for this POC (noted as production TODO)

**Validation:**
- `npm run dev` → server starts on configured port
- `curl POST /workflows/ingest` with base64 PDF → returns workflowId
- `curl POST /workflows/:id/extract` → returns extracted data with confidence
- Error cases return structured JSON with appropriate status codes

---

### Task 4.3: Create Thin Windmill Scripts

Rewrite `f/` scripts as thin HTTP callers (~10 lines each). Delete all duplicated service logic.

**Deliverables:**
- `f/process_contract/ingest.ts` — Calls `POST /workflows/ingest`, returns response
- `f/process_contract/extract.ts` — Calls `POST /workflows/:id/extract`, returns response including `needsReview` flag
- `f/process_contract/compare.ts` — Calls `POST /workflows/:id/compare`, returns response
- `f/process_contract/handle_review.ts` — Calls `POST /workflows/:id/review` with approval result
- Delete: `lib.ts`, `trigger.ts`, `parse_pdf.ts`, `extract_data.ts`, `validate_data.ts`, `compare_tariffs.ts` (old duplicated scripts)
- Windmill variables reduced to: `SERVICE_URL`, `AUTH_TOKEN`

**Validation:** Each script is ≤15 lines. No business logic. No direct DB or LLM calls.

---

### Task 4.4: Create Windmill Flow Definition + Deploy

Wire the 4-step flow and deploy to local Windmill.

**Deliverables:**
- `f/process_contract.flow/flow.yaml` — 4-step flow:
  1. `ingest` — receive + parse
  2. `extract` — LLM extraction + validation, branches on `needsReview`
  3. `compare` — tariff comparison (skipped if `needsReview`)
  4. Approval step (conditional, only when `needsReview=true`)
- Deploy scripts and flow via `wmill` CLI
- Remove `src/workflows/scripts/` and `src/workflows/triggers/` (canonical scripts no longer needed — service owns the logic, Windmill scripts live in `f/`)

**Validation:** Trigger flow with high-confidence PDF → `workflow_state_log` shows: pending → parsing_pdf → extracting → validating → validated → comparing → completed. All state transitions made by the service, not Windmill scripts.

---

## Sprint 5: Human-in-the-Loop Review

**Goal:** Low-confidence extractions pause for human review. Approve/reject/correct via Windmill approval UI. 24-hour timeout. Review decisions sent to the service via HTTP.

**Demo:** Low-confidence PDF → flow pauses → approve in Windmill → service records decision → flow resumes → completes. Also: review timeout → `timed_out`.

### Task 5.1: Implement Review Suspend/Resume

Add the human-in-the-loop branch. The extract step returns `needsReview=true`, Windmill suspends, and on resume sends the decision to the service.

**Deliverables:**
- Update extract endpoint — When `needsReview=true`: service transitions to `review_required`, creates review task, response includes `needsReview: true` and `reviewTaskId`
- Update flow YAML — Branch after extract step: if `needsReview`, go to Windmill approval step; else go to compare
- Approval step configured with Windmill's native suspend/resume
- `f/process_contract/handle_review.ts` — On resume, calls `POST /workflows/:id/review` with the reviewer's decision

**Validation:** Trigger with low-confidence PDF:
- Flow pauses at approval step
- Review task in DB with status=`pending`
- Approve → flow resumes → completes
- Transitions: → review_required → validated → comparing → completed

---

### Task 5.2: Implement Review Corrections

Handle reviewer corrections to extracted data.

**Deliverables:**
- Update `POST /workflows/:id/review` endpoint — When action=`correct` with `correctedData`:
  - Store `corrected_data` on review task
  - Update `contract.extracted_data`
  - Set `finalConfidence = 100` (human-verified)
  - Transition to `validated`

**Validation:**
- Low-confidence → review → correct with new data → completes
- Contract in DB has updated extracted_data
- Review task: status=`corrected`, corrected_data populated

---

### Task 5.3: Implement Review Timeout

24-hour auto-reject for unreviewed tasks (configurable, shortened for testing).

**Deliverables:**
- Configure Windmill approval step timeout (24h production, 30s testing)
- On timeout, Windmill calls `POST /workflows/:id/review` with action=`timeout`
- Service transitions workflow to `timed_out`, updates review task

**Validation:** Set timeout 30s. Trigger low-confidence → don't approve → after 30s: `timed_out`.

---

## Sprint 6: Error Handling, Retry Logic, Resilience

**Goal:** Graceful failure handling. Windmill retries at failed step via HTTP. Service returns structured errors with `retryable` flag. Langfuse cache fallback verified end-to-end.

**Demo:** LLM failure → Windmill retries extract step → succeeds. Langfuse down → cached prompt. `workflow_state_log` with retry history.

### Task 6.1: Implement Retry Logic

Error handling via HTTP status codes and Windmill retry configuration.

**Deliverables:**
- Service error responses include `retryable` flag and error code
- HTTP status mapping: transient errors → 503 (retryable), permanent errors → 400/422 (not retryable)
- Windmill flow retry configuration per step:
  - `ingest`: no retry (corrupt PDF is permanent)
  - `extract`: 3 retries, exponential backoff (LLM failures are transient)
  - `compare`: 1 retry
- Service increments `retry_count` on each failed attempt
- retry_count >= 3 → service transitions to `rejected`

**Validation:**
- Simulate LLM failure (503) → Windmill retries → second call succeeds → workflow completes
- Simulate 3 consecutive failures → workflow `rejected`
- `workflow_state_log` shows retry transitions

---

### Task 6.2: Verify Langfuse Cache Fallback End-to-End

Ensure cache works within the service (cache built in Task 2.2).

**Deliverables:**
- Verify Langfuse prompt cache warms on service startup
- Verify stale cache used when Langfuse unavailable (warning log emitted)
- Verify no cache + Langfuse down → `LANGFUSE_UNAVAILABLE` → 503 response

**Validation:** Run flows with Langfuse available and unavailable. Check service logs.

---

### Task 6.3: Add Comprehensive Structured Logging

Audit all modules for consistent structured logging. Add request-level correlation.

**Deliverables:**
- Audit all service modules: entry/exit logging, error logging with codes, timing for LLM/DB
- All logs include `workflowId`, `step`, `requestId` context
- HTTP request/response logging with duration
- No sensitive data in logs (no PDF content, no API keys)

**Validation:** Full workflow via Windmill → capture service logs:
- Every state transition: INFO log
- Every error: ERROR with errorCode, retryable
- `workflowId` and `requestId` in every line
- No secrets or PDF content

---

## Sprint 7: Demo Preparation — Test Data, Scripts, README

**Goal:** Synthetic German PDFs. Full demo scenarios. README. GitHub repo.

**Demo:** 3 scenarios (one per vertical): auto-approve, human review, timeout.

### Task 7.1: Create Synthetic German Contract PDFs

**Deliverables:**
- `test/fixtures/vattenfall-energy.pdf` — German energy contract (Grundpreis, Arbeitspreis, Vertragslaufzeit, Kündigungsfrist)
- `test/fixtures/telekom-telco.pdf` — German mobile contract
- `test/fixtures/allianz-insurance.pdf` — German insurance policy
- `scripts/generate-test-pdfs.ts` — Generates PDFs programmatically

**Validation:** Each PDF opens in viewer. Each extracts correctly through pipeline.

---

### Task 7.2: Create End-to-End Demo Script

**Deliverables:**
- `scripts/demo.ts` — Calls the service API directly (no Windmill dependency for basic demo). 3 scenarios:
  1. **Auto-approve (Energy):** High-confidence Vattenfall → ingest → extract → compare → completed
  2. **Human review (Telco):** Low-confidence Telekom → ingest → extract → review_required (pauses)
  3. **Unknown provider (Insurance):** Routes to review
- `scripts/demo-windmill.ts` — Triggers via Windmill webhook to show orchestration
- `package.json` scripts: `demo`, `demo:windmill`

**Validation:** `npm run demo` → scenario 1 completes end-to-end via HTTP. `npm run demo:windmill` → same flow visible in Windmill UI.

---

### Task 7.3: Write README

**Deliverables:**
- `README.md`:
  - Project overview and motivation
  - Architecture diagram (service + Windmill orchestrator)
  - Quick start (prerequisites, setup, run service, run Windmill)
  - Demo walkthrough (3 scenarios, both direct API and Windmill)
  - Key design decisions (links to ADRs, especially ADR-002)
  - Provider abstraction (how to add vertical/provider)
  - Tech stack with rationale
  - Project structure

**Validation:** Clone → follow README → run demo successfully.

---

### Task 7.4: Create GitHub Repository and Push

**Deliverables:**
- Create GitHub repo (public)
- Push with meaningful commit history (not one giant commit)
- Verify README renders on GitHub

**Validation:** Repo visible with clean history and readable README.

---

## Task Summary

| Sprint | Name | Tasks | Running Total |
|--------|------|-------|---------------|
| 1 | Foundation | 6 | 6 |
| 2 | PDF + LLM Extraction | 7 | 13 |
| 3 | Core Services | 4 | 17 |
| 4 | HTTP Service + Windmill Orchestration | 4 | 21 |
| 5 | Human-in-the-Loop | 3 | 24 |
| 6 | Error Handling + Resilience | 3 | 27 |
| 7 | Demo Preparation | 4 | 31 |

---

## Cross-Cutting Concerns

Addressed within specific tasks, not as separate tasks:

| Concern | Where Addressed |
|---------|----------------|
| Structured logging | Task 1.2 (logger created), Task 6.3 (audit all modules) |
| Drizzle ORM | Task 1.3 (schema), Task 1.4 (client), all service tasks |
| Result types | Task 1.2 (type defined), all service tasks |
| Langfuse cache | Task 2.2 (built with cache + fallback), Task 6.2 (e2e verification) |
| PDF storage | Task 3.1 (module), Task 4.2 (ingest endpoint stores PDF) |
| Windmill resources | Task 4.1 (setup) |
| wmill CLI sync | Task 4.1 (setup) |
| Express API | Task 4.2 (app, routes, middleware) |
| Response envelope | Task 4.2 (API_GUIDELINES.md: `{ success, data, error }`) |
| OpenAPI docs | Task 4.2 (swagger-jsdoc + Swagger UI at `/docs`) |
| HTTP error mapping | Task 4.2 (error handler), Task 6.1 (retry status codes) |
| Git init | Task 1.1 |
| NeonDB + Groq accounts | Task 1.1 |
| Demo video | Manual task for author — not in sprint plan |
