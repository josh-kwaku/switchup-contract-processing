import type { LangfuseService } from '../../infrastructure/langfuse.js';
import type { LLMProvider } from '../../infrastructure/llm/types.js';

export type {
  ValidationRule,
  ValidationRules,
  ConfidenceAdjustment,
  ConfidenceResult,
} from '../../domain/types.js';

export interface ExtractionResult {
  extractedData: Record<string, unknown>;
  llmConfidence: number;
  rawResponse: string;
  model: string;
  latencyMs: number;
}

export interface ExtractionDeps {
  langfuse: LangfuseService;
  llm: LLMProvider;
  promptLabel: string;
}
