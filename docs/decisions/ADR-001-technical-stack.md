# ADR-001: Technical Stack Decisions

**Date**: 2026-02-01
**Status**: Accepted
**Context**: Choosing LLM provider, PDF parsing, prompt granularity, confidence scoring, HTTP framework, and orchestration approach for the contract processing system.

---

## Decisions

### 1. LLM Provider: Groq (Llama 3.3 70B) with Model-Agnostic Adapter

**Decision:** Use Groq as the default LLM provider, with an adapter interface that makes swapping to Anthropic Claude a config change.

**Rationale:**
- Groq's free tier eliminates API cost during development
- Llama 3.3 70B handles structured extraction well
- Model-agnostic design strengthens the abstraction story (SwitchUp's philosophy: "nothing is sacred")
- `LLM_PROVIDER` env var switches between Groq and Anthropic

**Trade-off:** SwitchUp uses Claude. Using Groq is less aligned with their stack, but the adapter pattern demonstrates the same provider-agnostic thinking they need for their business.

### 2. PDF Parsing: pdfjs-dist (Mozilla PDF.js)

**Decision:** Use pdfjs-dist for text extraction from PDFs, then send text to the LLM.

**Rationale:**
- Actively maintained (Mozilla), industry standard
- Groq doesn't support direct PDF input (unlike Claude)
- Text extraction + LLM is more debuggable (can inspect extracted text)
- pdf-parse was considered but is unmaintained (last update 2020)

### 3. Prompt Granularity: Per-Vertical with Provider Override

**Decision:** 3 prompts (one per vertical: energy, telco, insurance). Provider configs can optionally override with a custom prompt name.

**Rationale:**
- Inter-vertical variation is large (completely different fields and terminology)
- Intra-vertical variation (Vattenfall vs E.ON) is mostly structural — the LLM handles this well
- 3 prompts vs 50+ keeps Langfuse manageable
- Provider-specific validation (required fields, value ranges) lives in DB config, not prompts
- `provider_configs.langfuse_prompt_name` is nullable — NULL means use vertical default

### 4. Confidence Scoring: LLM Score + Heuristic Adjustments

**Decision:** LLM provides a self-reported confidence score (0-100). Heuristics adjust it downward for missing fields, format mismatches, or out-of-range values.

**Rationale:**
- LLMs are notoriously bad at self-calibrating confidence
- Heuristics catch obvious issues the LLM might miss (e.g., claiming 95% confidence while missing required fields)
- Stored as `llm_confidence` (raw) and `final_confidence` (adjusted) for observability
- Threshold: `final_confidence >= 80` → auto-approve, else → human review

### 5. PDF Input: Base64 in Request Body

**Decision:** Accept PDF as base64-encoded string in the JSON request body. Store as a file reference after saving to disk.

**Rationale:**
- No file storage infrastructure needed (no S3)
- Works identically locally and in cloud
- Easy to test with curl/Postman
- 33% size overhead acceptable for contract PDFs (typically <1MB)

### 6. HTTP Framework: Express

**Decision:** Use Express as the HTTP framework for the service layer.

**Rationale:**
- Widely adopted, well-documented, large ecosystem
- Familiar to most Node.js/TypeScript developers
- Sufficient for the request volume of a contract processing service
- Middleware pattern maps cleanly to cross-cutting concerns (error handling, logging, validation)

### 7. Architecture: Service Layer + Windmill as Orchestrator

**Decision:** Deploy the service layer as an independent Express HTTP service. Windmill scripts are thin HTTP callers that handle orchestration only (step sequencing, retries, human-in-the-loop).

**Rationale:**
- Windmill's Bun runtime cannot import from external project source (Enterprise-only feature)
- Embedding domain logic in Windmill scripts caused duplication, runtime incompatibilities, and split observability
- An independent service gives standard observability (structured logging, OpenTelemetry), testability, and portability
- Windmill stays in its sweet spot: triggering, orchestration, retries, approval UIs
- If the orchestration layer changes, business logic is untouched
- See ADR-002 for detailed architectural rationale

---

## Consequences

### Positive
- Zero API cost during development (Groq free tier)
- Model-agnostic architecture demonstrates SwitchUp's provider abstraction challenge
- Simple, debuggable PDF pipeline
- Configurable prompt management without prompt explosion
- Standard observability and testability via independent service
- Windmill handles orchestration without constraining service design

### Negative
- Groq's Llama 3.3 may be less accurate than Claude for German contract extraction
- Text extraction loses PDF layout information (tables, columns)
- Base64 input has 33% size overhead and ~10MB practical limit
- Extra deployment target (service + Windmill)
- Network hop per orchestration step (~5-20ms, negligible for this pipeline)

---

## Alternatives Considered

### Claude Direct PDF Input
- Pros: Handles complex layouts, no text extraction step, matches SwitchUp's stack
- Cons: No free tier, higher token cost
- Why rejected: Budget constraint (no Anthropic free credits available)

### pdf-parse
- Pros: Simpler API, widely used
- Cons: Unmaintained since 2020, potential security issues
- Why rejected: pdfjs-dist is actively maintained and more reliable

### Per-Provider Prompts
- Pros: Maximum flexibility per provider
- Cons: 50+ prompts to manage, most would be near-identical within a vertical
- Why rejected: Provider variation within a vertical is mostly structural, not semantic

### Domain Logic Inside Windmill Scripts
- Pros: Single deployment target, no HTTP overhead
- Cons: Import isolation (Enterprise-only bundling), runtime incompatibilities, duplicated code, split observability
- Why rejected: Fights the platform; see ADR-002 for full analysis

### Fastify / Hono
- Pros: Better performance benchmarks, lighter weight
- Cons: Smaller ecosystem, less familiar to most teams
- Why rejected: Express is sufficient for this workload and more widely understood
