# Error Handling Guidelines

Error handling strategy for the SwitchUp Contract Processing System.

---

## Principles

1. **Result types for expected failures** — validation errors, missing resources, API failures
2. **Throw for programming errors** — invariant violations, unhandled switch cases
3. **Errors classified per workflow step** — each step has its own error codes and actions
4. **Retry transient errors only** — permanent errors fail immediately
5. **Route ambiguous failures to human review** — when in doubt, let a human decide

---

## Result Type

All domain and service functions return `Result<T, AppError>` for expected failures:

```typescript
// src/domain/result.ts
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

```typescript
// src/domain/errors.ts
export interface AppError {
  code: ErrorCode;
  message: string;
  details?: string;
  retryable: boolean;
}
```

### When to use Result types (expected failures)

- PDF parsing failures
- LLM API errors
- Validation failures
- Provider not found
- Database connection issues

### When to throw (programming errors)

- Invariant violations ("this should never happen")
- Exhaustive switch with unhandled case
- Assertions that indicate bugs in the code

### Boundaries with external code

- Catch exceptions from pdfjs-dist, Groq SDK, pg client at integration points
- Convert to `Result<T, AppError>` for expected failures
- Let programming errors propagate as exceptions

---

## Error Codes

### PDF Parsing Errors

| Code | Description | Retryable |
|------|-------------|-----------|
| `PDF_PARSE_FAILED` | Corrupt or unreadable PDF | No |
| `PDF_EMPTY` | PDF has no extractable text | No |
| `PDF_TOO_LARGE` | Exceeds size limit | No |

### LLM Extraction Errors

| Code | Description | Retryable |
|------|-------------|-----------|
| `LLM_API_ERROR` | Groq/Claude API returned 5xx or timeout | Yes |
| `LLM_RATE_LIMITED` | 429 from API | Yes (longer backoff) |
| `LLM_MALFORMED_RESPONSE` | Response isn't valid JSON | Once (then human review) |
| `LLM_AUTH_ERROR` | 401 — bad API key | No |

### Validation Errors

| Code | Description | Retryable |
|------|-------------|-----------|
| `VALIDATION_MISSING_FIELDS` | Required fields not in extraction | No (→ human review) |
| `VALIDATION_INVALID_VALUES` | Values outside expected ranges | No (→ human review) |
| `VALIDATION_VERTICAL_MISMATCH` | LLM says content doesn't match stated vertical | No (→ human review) |

### Provider Errors

| Code | Description | Retryable |
|------|-------------|-----------|
| `PROVIDER_NOT_FOUND` | Extracted provider not in registry | No (→ human review) |
| `PROVIDER_CONFIG_MISSING` | Provider exists but no active config | No (→ use vertical defaults) |

### Review Errors

| Code | Description | Retryable |
|------|-------------|-----------|
| `REVIEW_TIMED_OUT` | 24h elapsed with no human action | No (terminal) |
| `REVIEW_REJECTED` | Human rejected the extraction | No (terminal) |

### Infrastructure Errors

| Code | Description | Retryable |
|------|-------------|-----------|
| `DB_CONNECTION_ERROR` | NeonDB unreachable | Yes |
| `LANGFUSE_UNAVAILABLE` | Can't fetch prompt (use cache fallback) | Yes (with cache fallback) |

---

## Error → Action Mapping Per Step

| Workflow Step | Error Code | Action |
|--------------|-----------|--------|
| `parsing_pdf` | `PDF_PARSE_FAILED` | → `failed` → `rejected` (permanent) |
| `parsing_pdf` | `PDF_EMPTY` | → `failed` → `rejected` (permanent) |
| `parsing_pdf` | `PDF_TOO_LARGE` | → `failed` → `rejected` (permanent) |
| `extracting` | `LLM_API_ERROR` | → `failed` → retry `extracting` |
| `extracting` | `LLM_RATE_LIMITED` | → `failed` → retry with longer backoff |
| `extracting` | `LLM_MALFORMED_RESPONSE` | → retry once inline, then → `review_required` |
| `extracting` | `LLM_AUTH_ERROR` | → `failed` → `rejected` (permanent) |
| `validating` | `VALIDATION_*` | → `review_required` |
| `validating` | `PROVIDER_NOT_FOUND` | → `review_required` |
| `validating` | `PROVIDER_CONFIG_MISSING` | → proceed with vertical defaults |
| Any step | `DB_CONNECTION_ERROR` | → `failed` → retry same step |
| Any step | `LANGFUSE_UNAVAILABLE` | → use cached prompt, continue |

---

## Retry Strategy

### Per-Workflow Retry

- **Max attempts:** 3 per workflow
- **Backoff:** Exponential (1s, 2s, 4s) with jitter
- **Retry target:** The specific step that failed (not the entire pipeline)
- **Tracking:** `workflows.retry_count` + `workflow_state_log.metadata.failed_at_step`

### Retry Conditions

Only retry on transient errors:
- LLM API 5xx, timeout, rate limit
- Database connection lost
- Network errors

Never retry on:
- PDF parse failures (the PDF won't change)
- Auth errors (the key won't fix itself)
- Validation failures (same data, same result)

### LLM Malformed JSON — Special Case

When the LLM returns invalid JSON:
1. **First attempt:** Retry the LLM call once (same prompt, new request)
2. **Second failure:** Route to `review_required` with the raw LLM text attached
3. This does NOT count against the workflow's `retry_count`

---

## Graceful Degradation

| Failure | Fallback |
|---------|----------|
| Langfuse down | Use cached prompt (5min TTL in memory) |
| LLM API down | → `failed` state, queue for retry |
| NeonDB connection lost | Retry connection 3x with backoff, then → `failed` |
| Unknown provider extracted | → `review_required` (human decides if provider should be added) |

---

## Error Response Format

Consistent error structure across the system:

```typescript
interface AppError {
  code: string;       // e.g., "LLM_API_ERROR"
  message: string;    // Human-readable: "LLM API returned 500"
  details?: string;   // Additional context: response body, stack trace for unexpected errors
  retryable: boolean; // Whether the system should retry
}
```

### Logging Errors

All errors are logged with structured context:

```typescript
logger.error({
  workflowId,
  step: 'extracting',
  errorCode: 'LLM_API_ERROR',
  retryable: true,
  attempt: 2,
  details: 'Groq API returned 503',
}, 'Workflow step failed');
```

---

## State Transition on Error

Every error triggers a state transition logged in `workflow_state_log`:

```typescript
// workflow_state_log entry
{
  workflow_id: '...',
  from_state: 'extracting',
  to_state: 'failed',
  metadata: {
    error_code: 'LLM_API_ERROR',
    error_message: 'Groq API returned 503',
    failed_at_step: 'extracting',
    retry_count: 1,
  }
}
```

On retry:
```typescript
{
  workflow_id: '...',
  from_state: 'failed',
  to_state: 'extracting',  // back to the step that failed
  metadata: {
    retry_attempt: 2,
    triggered_by: 'auto_retry',
  }
}
```
