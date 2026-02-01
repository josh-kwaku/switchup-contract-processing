# Current Session

**Date**: 2026-02-01
**Focus**: Sprint 4 — Task 4.2 committed, API simplification refactor

---

## Accomplished

### Task 4.2: Express HTTP API Layer (Committed)

Built the full HTTP API layer with singleton DI pattern (Relevé-style):

**Architecture (simplified from previous session):**
- Infrastructure singletons: `getDb()`, `getLangfuse()`, `getLlm()` — lazy init with env var validation
- Repositories import `getDb()` directly — no `db` parameter threading
- Services import singletons directly — no deps/db params
- Routes import service functions directly — no `Services` interface, no `buildServices()`
- OpenAPI spec in standalone YAML, Swagger UI at `/docs`
- Ingest service encapsulates PDF storage + parsing

**Key files:**
- `src/api/app.ts` — Express setup, mounts router (8 lines)
- `src/api/server.ts` — Entry point, warms Langfuse cache
- `src/api/routes/workflow.ts` — 6 endpoints, direct service imports
- `src/api/middleware/error-handler.ts` — AppError → HTTP status + envelope
- `src/api/middleware/request-logger.ts` — Pino request logging
- `src/api/openapi/` — Spec + Swagger UI setup
- `src/services/ingest/` — PDF ingest orchestration

**Endpoints:** POST /workflows/ingest, POST /workflows/:id/extract, POST /workflows/:id/compare, POST /workflows/:id/review, GET /workflows/:id, GET /reviews/pending, GET /health, GET /docs, GET /openapi.json

**Also fixed:**
- Added `VERTICAL_NOT_FOUND` error code (was using `PROVIDER_NOT_FOUND` for verticals)
- Structured logging: `details` field instead of `error` in contract/review services
- JSDoc `@throws` on all singleton getters
- Excluded stale workflow scripts from tsconfig/eslint (TD-002)

---

## Previous Sessions (carried forward)
- Sprint 1 complete (Tasks 1.1–1.6): project scaffolding, domain types, logger, Drizzle schema, DB client, migrations, seed, ESLint, pre-commit, provider registry service
- Sprint 2 complete (Tasks 2.1–2.7): PDF parser, Langfuse module, Langfuse prompts, Groq LLM provider, extraction service, confidence scoring, end-to-end extraction script
- Sprint 3 complete (Tasks 3.1–3.4): PDF storage module, workflow state transition service, contract and review task services, validation service
- Sprint 4 partially complete: Task 4.1 done (Windmill env), Task 4.2 done (committed)
- Design phase complete: PRD, technical design, schema, state machine, error handling, guidelines, subagent, ADRs
- Sprint plan finalized (v3): 7 sprints, 31 tasks
- GitHub repo created with issues and project board

---

## Next Steps

- Task 4.3: Rewrite Windmill scripts as thin HTTP callers
- Task 4.4: Create 4-step flow YAML + deploy, clean up stale code (TD-001, TD-002)

---

## Reference

- Sprint plan: `docs/SPRINT_PLAN.md`
- GitHub repo: https://github.com/josh-kwaku/switchup-contract-processing
- Project board: https://github.com/users/josh-kwaku/projects/3
