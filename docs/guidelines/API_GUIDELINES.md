# API Guidelines

Standards for the Express HTTP service layer. Adapted from [Relevé API Documentation Standards](https://github.com/josh-kwaku/releve).

---

## Response Envelope

All API responses (except health endpoints) use a consistent envelope:

```typescript
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: string;
    retryable?: boolean;
  } | null;
}
```

### Success Response

```json
{
  "success": true,
  "data": {
    "workflowId": "550e8400-...",
    "state": "extracting"
  },
  "error": null
}
```

### Business Logic Error (HTTP 200)

Use HTTP 200 with `success: false` for expected domain errors — validation failures, low confidence, unknown provider. These are not server errors; they are normal outcomes the caller should handle.

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Extracted data missing required fields",
    "details": "Missing: monthly_rate, contract_start"
  }
}
```

### Infrastructure Error (HTTP 4xx/5xx)

Use HTTP status codes for infrastructure-level failures that the caller (Windmill) should react to with retries or abort.

```json
// HTTP 503 — Windmill should retry
{
  "success": false,
  "data": null,
  "error": {
    "code": "LLM_API_ERROR",
    "message": "Groq API returned 503",
    "retryable": true
  }
}

// HTTP 400 — Windmill should not retry
{
  "success": false,
  "data": null,
  "error": {
    "code": "PDF_PARSE_FAILED",
    "message": "PDF is corrupt or unreadable",
    "retryable": false
  }
}
```

### HTTP Status Code Usage

| Scenario | HTTP Status | `success` | `retryable` |
|----------|-------------|-----------|-------------|
| Request succeeded | 200 / 201 | `true` | — |
| Business logic outcome (review required, validation failed) | 200 | `true` | — |
| Malformed request (bad JSON, missing fields) | 422 | `false` | `false` |
| Resource not found | 404 | `false` | `false` |
| Permanent processing error (corrupt PDF, auth error) | 400 | `false` | `false` |
| Transient error (LLM down, DB timeout) | 503 | `false` | `true` |
| Unexpected server error | 500 | `false` | `false` |

**Key distinction for Windmill integration:** Windmill retry config triggers on HTTP 5xx. Business logic outcomes (including `needsReview: true`) return HTTP 200 so Windmill proceeds to the next step or branches — it does not retry.

---

## OpenAPI Documentation

All endpoints are documented with OpenAPI 3.x via `swagger-jsdoc`.

### Setup

```typescript
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SwitchUp Contract Processing API',
      version: '1.0.0',
      description: 'Contract processing service with LLM extraction and human-in-the-loop review.',
    },
    tags: [
      { name: 'workflows', description: 'Contract processing workflow operations' },
      { name: 'reviews', description: 'Human review operations' },
      { name: 'health', description: 'Health check endpoints' },
    ],
  },
  apis: ['./src/api/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);

// In app setup
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/openapi.json', (req, res) => res.json(swaggerSpec));
```

### Route Documentation Pattern

```typescript
/**
 * @openapi
 * /workflows/ingest:
 *   post:
 *     tags: [workflows]
 *     summary: Ingest a contract PDF
 *     operationId: ingestWorkflow
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/IngestRequest'
 *     responses:
 *       201:
 *         description: Workflow created, PDF parsed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/IngestResponse'
 *       400:
 *         description: Invalid PDF
 *       422:
 *         description: Invalid request body
 */
```

### Accessing Documentation

| Endpoint | Description |
|----------|-------------|
| `/docs` | Swagger UI (interactive) |
| `/openapi.json` | Raw OpenAPI spec |

---

## Request Validation

All request bodies validated with Zod at the route handler level. Validation errors return 422 with field-level details.

```typescript
// Zod schema
const ingestRequestSchema = z.object({
  pdfBase64: z.string().min(1),
  verticalSlug: z.enum(['energy', 'telco', 'insurance']),
  filename: z.string().optional(),
});

// Validation error response (422)
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": "verticalSlug: Expected 'energy' | 'telco' | 'insurance', received 'crypto'"
  }
}
```

---

## Endpoint Design

### Naming Conventions

- Resource-based paths: `/workflows`, `/reviews`
- Actions as sub-resources: `/workflows/:id/extract`, `/workflows/:id/review`
- Use `kebab-case` for multi-word paths (not needed currently)

### Standard Patterns

- `POST` for all processing endpoints (not idempotent — state changes on each call)
- `GET` for status queries
- Always return the current workflow state in responses so the caller knows what happened

### Response Must Include State

Every endpoint that modifies a workflow must return the resulting `state`. This is what Windmill uses to decide the next step.

```typescript
// Windmill script reads response.data.needsReview to branch
const result = await fetch(`${SERVICE_URL}/workflows/${id}/extract`, { ... });
const { data } = await result.json();
if (data.needsReview) {
  // → approval step
} else {
  // → compare step
}
```

---

## Error Handler Middleware

Maps `AppError` (from Result types) to the envelope format:

```typescript
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (isAppError(err)) {
    const status = mapErrorToStatus(err.code);
    return res.status(status).json({
      success: false,
      data: null,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        retryable: err.retryable,
      },
    });
  }

  // Unexpected errors
  logger.error({ err }, 'Unhandled error');
  return res.status(500).json({
    success: false,
    data: null,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      retryable: false,
    },
  });
}
```

### Error Code → HTTP Status Mapping

| Error Code Pattern | HTTP Status |
|-------------------|-------------|
| `PDF_PARSE_FAILED`, `PDF_EMPTY`, `PDF_TOO_LARGE` | 400 |
| `LLM_AUTH_ERROR` | 400 |
| `WORKFLOW_NOT_FOUND`, `CONTRACT_NOT_FOUND` | 404 |
| `INVALID_STATE_TRANSITION` | 409 |
| `VALIDATION_ERROR` | 422 |
| `LLM_API_ERROR`, `LLM_RATE_LIMITED`, `DB_CONNECTION_ERROR`, `LANGFUSE_UNAVAILABLE` | 503 |
| Everything else | 500 |

---

## Checklist

Before merging API changes:

- [ ] All endpoints have OpenAPI annotations (`@openapi`)
- [ ] All endpoints return the response envelope (`{ success, data, error }`)
- [ ] All request bodies validated with Zod
- [ ] All error responses include `code`, `message`, and `retryable` (for 5xx)
- [ ] `/docs` renders correctly in Swagger UI
- [ ] `/openapi.json` is valid
