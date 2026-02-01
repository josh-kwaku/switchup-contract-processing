# Code Guidelines

Coding standards for the SwitchUp Contract Processing System.
Adapted from Releve service standards for TypeScript + lightweight DDD.

---

## Guiding Principles

### Simplicity Over Complexity

Choose the simplest solution that works. Avoid premature abstraction, over-configuration, and designing for hypothetical future requirements.

- Write code that's easy to read and delete, not just easy to extend
- Three similar lines of code is often better than a premature abstraction
- Add complexity only when the current task demands it

### Lightweight DDD

We use DDD concepts for structure and clarity, not heavy infrastructure:

- **Bounded contexts** define module boundaries (Contract Processing, Provider Registry)
- **Domain types** live in `src/domain/` with zero external dependencies
- **Domain services** orchestrate business logic in `src/services/`
- **Infrastructure** wraps all external integrations in `src/infrastructure/`
- We skip: aggregates with full lifecycle, repository pattern, domain events, event sourcing

---

## Architecture

### Layer Dependencies

```
domain/          ← Pure types, zero dependencies. Imported by everything.
    ↑
services/        ← Business logic. Depends on domain/ and infrastructure/.
    ↑
infrastructure/  ← External integrations (DB, Langfuse, Groq, PDF). Depends on domain/.
    ↑
workflows/       ← Windmill scripts. Orchestrate services. Depends on services/ + infrastructure/.
```

**Rules:**
- `domain/` NEVER imports from `services/`, `infrastructure/`, or `workflows/`
- `services/` NEVER imports from `workflows/`
- `infrastructure/` NEVER imports from `services/` or `workflows/`
- `workflows/scripts/` are the entry points — they wire everything together

### Windmill Scripts as Controllers

Windmill scripts play the role of controllers/routes. They handle Windmill-specific concerns only:

- Receive input from the previous Flow step
- Call the appropriate service
- Return output for the next step
- Handle state transitions

**Do not** put business logic, database queries, or complex transformations in Windmill scripts.

```typescript
// GOOD — Windmill script delegates to service
export async function main(pdfBase64: string, verticalSlug: string) {
  const pdfText = await parsePdf(pdfBase64);
  const vertical = await getVertical(verticalSlug);
  const result = await extractionService.extract(pdfText, vertical);
  return result;
}

// BAD — Business logic in Windmill script
export async function main(pdfBase64: string, verticalSlug: string) {
  const pdf = Buffer.from(pdfBase64, 'base64');
  const doc = await pdfjs.getDocument(pdf).promise;
  // 50 lines of extraction logic...
}
```

### Request Validation

Use Zod schemas for all input validation at system boundaries:

- Windmill script inputs (contract upload)
- Review task actions (approve/reject/correct)
- Provider config creation

```typescript
const processContractInput = z.object({
  pdfBase64: z.string().min(1),
  verticalSlug: z.string(),
  filename: z.string().optional(),
});
```

### Service Layer for Database Access

All database operations go through services or dedicated repository functions. Windmill scripts never import the database module directly.

```
Windmill Script → Service → Database
                    ↓
               Business Logic
```

---

## Module Organization

### When to Split a Function

A function should do one thing. If you find yourself writing comments like `// Step 1:`, that's a signal to extract.

**Signs a function needs splitting:**
- "Step" or "phase" comments separating blocks of code
- Function exceeds ~50 lines
- Multiple levels of abstraction (validation + DB + external calls)
- Hard to name what the function does in 3-4 words

### Service Directory Structure

```
src/services/feature-name/
    types.ts           # Interfaces, type definitions
    repository.ts      # Drizzle queries, row-to-domain mapping
    index.ts           # Business logic, Result wrapping, public exports
    helper.ts          # Internal helpers (optional)
```

**What goes where:**

| File | Contents |
|------|----------|
| `types.ts` | Input/output interfaces, constants |
| `repository.ts` | Database queries via Drizzle, row-to-domain type mapping. No Result types, no logging — just data access. |
| `index.ts` | Business logic, Result wrapping, error handling, logging, re-exports |
| `helper.ts` | Internal helpers, extracted logic |

Each service owns its own repository — no shared repository files.

---

## Code Style

### Prefer Functions Over Classes

Use plain functions and modules. Only use classes when OOP genuinely simplifies the problem.

**When functions are better:**
- Stateless operations (most of our domain logic)
- Simple transformations
- Service functions

**When classes may be appropriate:**
- Managing stateful connections (database client)
- Infrastructure services with injected clients and internal state (e.g., `LangfuseService` with cache + client)
- The LLM provider adapter interface (implemented as classes for polymorphism)

```typescript
// GOOD — Functions
export function computeFinalConfidence(
  llmScore: number,
  extractedData: Record<string, unknown>,
  requiredFields: string[]
): number {
  // ...
}

// GOOD — Class for polymorphic adapter
export class GroqProvider implements LLMProvider {
  async extract(prompt: string, text: string): Promise<ExtractionResult> {
    // ...
  }
}
```

**Note**: Types, interfaces, and Zod schemas are fine — these define structure, not behavior.

### Favor Dependency Injection

Modules that depend on external clients (Langfuse, LLM providers, database) must accept dependencies as parameters rather than constructing them internally or using module-level singletons.

**Why:**
- Tests inject mocks directly — no `vi.mock()`, no `_resetForTesting()` hacks
- Each instance owns its own state — no shared mutable globals
- Callers control lifecycle and configuration

**Pattern:** Use a factory function that accepts dependencies and returns a service object.

```typescript
// GOOD — Factory with injected dependency
export function createLangfuseService(client: LangfuseClient): LangfuseService {
  const cache = new Map();
  return {
    getPrompt(name) { /* uses client and cache */ },
  };
}

// BAD — Module-level singleton with test-only reset
let client: Langfuse | null = null;
function getClient() { /* lazy init from env vars */ }
export function _resetForTesting() { client = null; } // never do this
```

Provide a convenience factory (e.g., `createLangfuseClientFromEnv()`) for production wiring, separate from the service logic.

**Exception:** The Pino logger singleton (`src/infrastructure/logger.ts`) is exempt. Loggers are passive observability — not business logic — and injecting them into every function adds noise for little testability gain. Use `LOG_LEVEL=silent` in tests to suppress output.

### Keep Functions Focused

Orchestration functions (like `processContract`) may be longer because they coordinate multiple steps — that's fine as long as each step is a clear function call.

### No Useless Comments

Comments should explain *why*, not *what*. If you need a comment to explain what code does, the code should probably be refactored.

**Never use banner/separator comments** like `// ========`, `// ------`, or `// *** SECTION ***`. Use whitespace and module structure to organize code instead.

```typescript
// BAD
// Get the vertical from the database
const vertical = await getVertical(slug);

// BAD — banner comment
// ============================================
// REFERENCE DATA
// ============================================

// GOOD
// Fall back to vertical defaults when provider has no custom config
const config = providerConfig ?? verticalDefaults;
```

---

## Logging

### Structured Logging with Pino

Use pino for structured JSON logs with consistent fields.

**Standard fields:**
- `timestamp` (automatic)
- `level` (info, error, etc.)
- `service`: `"contract-processing"`
- `workflowId` (when available — primary correlation key)
- `vertical`, `provider` (when available)

**Log levels:**
- `DEBUG`: Function entry/exit, detailed flow
- `INFO`: Important events, successful operations, state transitions
- `WARN`: Recoverable issues (cached prompt used, retry attempt)
- `ERROR`: Failures, exceptions

```typescript
logger.info({ workflowId, vertical: 'energy' }, 'Starting contract extraction');
logger.warn({ workflowId, attempt: 2 }, 'LLM call failed, retrying');
logger.error({ workflowId, errorCode: 'LLM_MALFORMED_RESPONSE' }, 'Extraction failed');
```

### State Transition Logging

Every workflow state transition gets an INFO log + a `workflow_state_log` DB entry:

```typescript
logger.info({
  workflowId,
  fromState: 'extracting',
  toState: 'validating',
}, 'Workflow state transition');
```

---

## Summary Checklist

Before submitting code, verify:

- [ ] Windmill scripts only orchestrate (no business logic)
- [ ] Input validation uses Zod schemas at boundaries
- [ ] Database access goes through services only
- [ ] Functions used instead of classes (unless polymorphism needed)
- [ ] External dependencies injected via factory functions (no module-level singletons)
- [ ] Functions do one thing and have clear, specific names
- [ ] Logs are structured (JSON) with workflowId context
- [ ] Error codes defined centrally and used consistently
- [ ] Internal functions return Result types, not exceptions
- [ ] Domain types have zero external dependencies
