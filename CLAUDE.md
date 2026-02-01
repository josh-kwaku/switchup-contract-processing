# SwitchUp Contract Processing System - Claude Code Context

## Session Protocol

**On session start:**
1. Read `SESSION.md` for previous session context
2. Read `PROGRESS.md` for sprint/milestone status
3. Read `ISSUES.md` for known bugs and tech debt
4. Check `docs/decisions/` for relevant architectural decisions

**On session end:**
1. Update `SESSION.md` (overwrite with current session info)
2. Update `PROGRESS.md` if sprint tasks changed
3. Update `ISSUES.md` with any new bugs or tech debt discovered

**Design discussions:**
- When receiving design feedback, discuss each point with the user before incorporating into plans
- Don't immediately update plans with user feedback — have a conversation first to reason through decisions together

**File creation rules:**
- **NEVER use the scratchpad directory for plan files, documentation, or any project-related content**
- Create decision records directly in `docs/decisions/`
- Only use scratchpad for truly ephemeral files (test outputs, temp data processing)

---

## Project Info

**Project:** SwitchUp Contract Processing System (Portfolio Demo)
**Purpose:** Job application demo for SwitchUp (Berlin) — Senior Fullstack Engineer, Internal AI-Native Platform
**Author:** Joshua Boateng

**GitHub Repository**: TBD (will be created during setup)

---

## Mandatory Standards

**Before planning or implementing ANY code, you MUST read and follow these documents:**

### Code Standards (Always Apply)
- `docs/guidelines/CODE_GUIDELINES.md` — Code style, Result types, layer dependencies, lightweight DDD
- `docs/guidelines/ERROR_HANDLING.md` — Error codes, retry strategy, graceful degradation

### Design Documents (Reference)
- `docs/PRD_Contract_Processing_System.md` — Product requirements
- `docs/TECHNICAL_DESIGN_Contract_Processing_System.md` — Architecture, schema, state machine

### How to Apply
1. **Planning**: Reference guidelines when designing new features
2. **Implementation**: Follow patterns exactly (error handling, logging, layer dependencies)
3. **Review**: Run code-reviewer subagent before considering task complete

**Non-negotiable patterns:**
- All domain types in `src/domain/` must have zero external dependencies
- All errors MUST use Result type (not thrown exceptions for expected errors)
- All logs MUST be structured JSON (Pino) with `workflowId` context
- All Windmill scripts delegate to services (no business logic in scripts)
- All inputs validated with Zod at system boundaries
- All state transitions logged in `workflow_state_log` table

### Code Size Limits

**Before writing code**, consider the structure. For non-trivial features:
1. Identify distinct concerns (validation, DB operations, external calls, orchestration)
2. Plan module structure if multiple concerns exist

**While writing code**, stop and extract if:
- A function exceeds ~50 lines → extract helper functions
- You write "Step 1/2/3" comments → extract each step into a function
- A file exceeds ~200 lines → split into directory with types.ts, index.ts, helpers

See `docs/guidelines/CODE_GUIDELINES.md` → "Module Organization" for full patterns.

---

## Sprint/Task Workflow

**When planning or implementing sprints/tasks, ALWAYS follow the GitHub workflow:**

### 1. GitHub Issues (Required)
- Create GitHub issues for each task before implementation
- Use title format: `[Sprint N] Task X.X: Description`
- Apply labels: `sprint:N`, appropriate category labels
- Reference: `docs/guides/GITHUB_WORKFLOW.md`

### 2. Issue Template
```markdown
**Sprint**: N
**Component**: domain | services | infrastructure | workflows | db
**Plan Reference**: Task X.X in sprint plan

## Description
[What needs to be done]

## Deliverables
- [ ] Item 1
- [ ] Item 2

## Validation
[How to verify completion]
```

### 3. Task Implementation Process (CRITICAL)

**Do NOT breeze through all tasks at once.** For each individual task:

1. **Implement the task** — Write code following all standards
2. **Launch code-reviewer subagent** — After completing the task, invoke:
   ```
   Use the code-reviewer subagent to review this implementation
   ```
   The subagent checks (see `.claude/agents/code-reviewer.md`):
   - Code quality and layer dependencies (CODE_GUIDELINES.md)
   - Error handling and Result types (ERROR_HANDLING.md)
   - Structured logging
   - Security (no secrets, input validation)
   - Type safety
   - State machine compliance
   - Test quality (useful tests only)
3. **Apply fixes** — Address issues identified by the review subagent
4. **Present summary** — Provide the user with:
   - A detailed description of what was implemented
   - Files created/modified
   - Any notable decisions or trade-offs
5. **Wait for approval** — Only proceed to the next task when the user explicitly approves

---

## Code Review Subagent

A custom subagent is configured at `.claude/agents/code-reviewer.md` for automated code reviews.

### Invocation
```
Use the code-reviewer subagent to review this implementation
```

Or for specific files:
```
Use the code-reviewer subagent to review src/services/extraction/index.ts
```

### What It Checks
| Category | Standards Reference |
|----------|---------------------|
| Code Quality & Layers | `docs/guidelines/CODE_GUIDELINES.md` |
| Error Handling | `docs/guidelines/ERROR_HANDLING.md` |
| Logging | Structured JSON with workflowId |
| Security | No secrets, input validation |
| Type Safety | Result types, union types for states |
| State Machine | Valid transitions only |
| Provider Abstraction | Zero-code extensibility |
| Test Quality | Useful tests only |

### Output Format
- **Critical Issues** — Must fix before proceeding
- **Warnings** — Should fix
- **Suggestions** — Nice to have
- **Tests to Remove** — Superfluous tests

The subagent is read-only (cannot modify files) and uses the `sonnet` model.

---

## Logging Requirements

**All new functions must include structured logging:**

### Log Levels
| Level | When to Use |
|-------|-------------|
| `info` | State transitions, starting/completing operations |
| `debug` | Detailed processing steps, intermediate values |
| `warn` | Recoverable issues (cached prompt, retry attempt) |
| `error` | Failures, exceptions |

### Required Context
Always include relevant context fields:
- `workflowId` (primary correlation key)
- `vertical`, `provider` (when available)
- `step` (current workflow step)
- `errorCode`, `retryable` (on errors)

### Pattern
```typescript
logger.info({ workflowId, vertical: 'energy', step: 'extracting' }, 'Starting LLM extraction');
logger.error({ workflowId, errorCode: 'LLM_API_ERROR', retryable: true, attempt: 2 }, 'LLM call failed');
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Workflow Engine** | Windmill.dev (Flow-based, Docker local) |
| **LLM** | Groq (Llama 3.3 70B) via model-agnostic adapter |
| **Prompt Management** | Langfuse (OpenAI-compatible tracing with Groq) |
| **Database** | NeonDB (serverless Postgres) |
| **PDF Parsing** | pdfjs-dist (Mozilla PDF.js) |
| **Validation** | Zod |
| **Logging** | Pino |

---

## Project Structure

```
switchup/
├── CLAUDE.md              # This file
├── SESSION.md             # Current session tracking
├── PROGRESS.md            # Sprint/milestone tracking
├── ISSUES.md              # Bugs and tech debt
├── .claude/agents/        # Code review subagent
├── docs/
│   ├── guidelines/        # CODE_GUIDELINES.md, ERROR_HANDLING.md
│   ├── decisions/         # Architecture Decision Records
│   ├── guides/            # GITHUB_WORKFLOW.md
│   └── *.md               # PRD, Technical Design, Context
├── db/                    # schema.sql, seed.sql
├── src/
│   ├── domain/            # Pure types, zero dependencies
│   ├── services/          # Business logic
│   ├── infrastructure/    # External integrations
│   └── workflows/         # Windmill flow + scripts
├── test/
├── docker-compose.yml
└── README.md
```

---

## Key Design Decisions

| Decision | Choice | Reference |
|----------|--------|-----------|
| LLM Provider | Groq (Llama 3.3 70B), model-agnostic adapter | docs/decisions/ADR-001 |
| Prompt Granularity | Per-vertical (3 prompts) + provider override | docs/decisions/ADR-001 |
| Confidence Scoring | LLM score + heuristic adjustments | docs/decisions/ADR-001 |
| State Machine | Fine-grained (10 states), maps 1:1 to Windmill Flow steps | Technical Design |
| Unknown Provider | Route to human review | Technical Design |
| Review Timeout | 24h → `timed_out` terminal state (distinct from `rejected`) | Technical Design |
| Retry Strategy | Retry at specific failed step, not entire pipeline | Technical Design |
| PDF Input | Base64 in request body, stored as file reference | Technical Design |
