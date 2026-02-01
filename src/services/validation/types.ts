import type { ConfidenceAdjustment } from '../../domain/types.js';

export interface ValidationError {
  field: string;
  code: 'missing_field' | 'empty_field' | 'out_of_range' | 'vertical_mismatch';
  message: string;
}

export interface ValidationResult {
  contractData: Record<string, unknown>;
  finalConfidence: number;
  needsReview: boolean;
  validationErrors: ValidationError[];
  confidenceAdjustments: ConfidenceAdjustment[];
}

export const CONFIDENCE_THRESHOLD = 80;
