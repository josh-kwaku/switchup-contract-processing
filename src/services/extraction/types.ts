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
