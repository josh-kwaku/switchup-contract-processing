import { ok, type Result } from '../../domain/result.js';
import type { AppError } from '../../domain/errors.js';
import { logger } from '../../infrastructure/logger.js';
import type { ValidationRules } from '../../domain/types.js';
import { computeFinalConfidence } from '../extraction/confidence.js';
import { validateExtractedData } from './schema-validator.js';
import type { ValidationResult } from './types.js';
import { CONFIDENCE_THRESHOLD } from './types.js';

export type { ValidationResult, ValidationError } from './types.js';
export { CONFIDENCE_THRESHOLD } from './types.js';
export { validateExtractedData } from './schema-validator.js';

const log = logger.child({ module: 'validation' });

export function validateAndScore(
  extractedData: Record<string, unknown>,
  llmConfidence: number,
  requiredFields: string[],
  validationRules?: ValidationRules,
  workflowId?: string,
): Result<ValidationResult, AppError> {
  const ctx = { workflowId, step: 'validating' };

  log.info(ctx, 'Starting validation');

  const validationErrors = validateExtractedData(extractedData, requiredFields, validationRules);

  const { finalConfidence, adjustments } = computeFinalConfidence(
    llmConfidence,
    extractedData,
    requiredFields,
    validationRules,
    workflowId,
  );

  const needsReview = finalConfidence < CONFIDENCE_THRESHOLD || validationErrors.length > 0;

  if (needsReview) {
    log.info(
      { ...ctx, finalConfidence, errorCount: validationErrors.length, needsReview },
      'Validation completed — review required',
    );
  } else {
    log.info({ ...ctx, finalConfidence, needsReview }, 'Validation completed — passed');
  }

  return ok({
    contractData: extractedData,
    finalConfidence,
    needsReview,
    validationErrors,
    confidenceAdjustments: adjustments,
  });
}
