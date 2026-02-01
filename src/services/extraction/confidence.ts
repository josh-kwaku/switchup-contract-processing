import { logger } from '../../infrastructure/logger.js';
import type { ConfidenceAdjustment, ConfidenceResult, ValidationRules } from './types.js';

const log = logger.child({ module: 'confidence' });

const PENALTIES = {
  MISSING_FIELD: 15,
  EMPTY_FIELD: 10,
  OUT_OF_RANGE: 10,
  VERTICAL_MISMATCH: 30,
} as const;

export function computeFinalConfidence(
  llmScore: number,
  extractedData: Record<string, unknown>,
  requiredFields: string[],
  validationRules?: ValidationRules,
  workflowId?: string,
): ConfidenceResult {
  const adjustments: ConfidenceAdjustment[] = [];

  // Vertical mismatch check
  if (extractedData.vertical_match === false) {
    adjustments.push({ reason: 'vertical_mismatch', penalty: PENALTIES.VERTICAL_MISMATCH });
  }

  // Required field checks
  for (const field of requiredFields) {
    if (!(field in extractedData)) {
      adjustments.push({ reason: 'missing_field', penalty: PENALTIES.MISSING_FIELD, field });
    } else if (extractedData[field] === null || extractedData[field] === '' || extractedData[field] === undefined) {
      adjustments.push({ reason: 'empty_field', penalty: PENALTIES.EMPTY_FIELD, field });
    }
  }

  // Validation rule checks (min/max range)
  if (validationRules) {
    for (const [field, rule] of Object.entries(validationRules)) {
      const value = extractedData[field];
      if (typeof value !== 'number') continue;

      if (rule.min !== undefined && value < rule.min) {
        adjustments.push({ reason: 'out_of_range', penalty: PENALTIES.OUT_OF_RANGE, field });
      } else if (rule.max !== undefined && value > rule.max) {
        adjustments.push({ reason: 'out_of_range', penalty: PENALTIES.OUT_OF_RANGE, field });
      }
    }
  }

  const totalPenalty = adjustments.reduce((sum, a) => sum + a.penalty, 0);
  const finalConfidence = Math.max(0, Math.min(100, llmScore - totalPenalty));

  if (adjustments.length > 0) {
    log.debug(
      { workflowId, step: 'validating', llmScore, finalConfidence, adjustmentCount: adjustments.length, totalPenalty },
      'Confidence adjusted',
    );
  }

  return { finalConfidence, adjustments };
}
