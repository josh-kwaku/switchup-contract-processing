import type { LangfuseService } from '../../infrastructure/langfuse.js';
import type { LLMProvider } from '../../infrastructure/llm/types.js';

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

export interface ValidationRule {
  min?: number;
  max?: number;
}

export type ValidationRules = Record<string, ValidationRule>;

export interface ConfidenceAdjustment {
  reason: string;
  penalty: number;
  field?: string;
}

export interface ConfidenceResult {
  finalConfidence: number;
  adjustments: ConfidenceAdjustment[];
}
