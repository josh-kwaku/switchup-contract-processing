import { z } from 'zod';
import { transitionState } from '../../services/workflow/index.js';
import { validateAndScore, type ValidationResult } from '../../services/validation/index.js';
import { createContract } from '../../services/contract/index.js';
import { createReviewTask, computeTimeoutAt } from '../../services/review/index.js';
import { logger } from '../../infrastructure/logger.js';
import { getDb, handleStepError, parseInput } from './shared.js';

const log = logger.child({ module: 'script:validate-data' });

const extractionResultSchema = z.object({
  extractedData: z.record(z.string(), z.unknown()),
  llmConfidence: z.number(),
  rawResponse: z.string(),
  model: z.string(),
  latencyMs: z.number(),
});

const inputSchema = z.object({
  extractionResult: extractionResultSchema,
  workflowId: z.string().uuid(),
  verticalId: z.string().uuid(),
  requiredFields: z.array(z.string()),
});

interface Output {
  validationResult: ValidationResult;
  contractId: string;
  needsReview: boolean;
  workflowId: string;
}

export async function main(raw: unknown): Promise<Output> {
  const { extractionResult, workflowId, verticalId, requiredFields } = parseInput(inputSchema, raw);
  const db = getDb();

  log.info({ workflowId, step: 'validating' }, 'Starting validation step');

  const toValidatingResult = await transitionState(db, workflowId, 'validating');
  if (!toValidatingResult.ok) {
    return handleStepError(db, workflowId, 'validating', toValidatingResult.error);
  }

  const validationResult = validateAndScore(
    extractionResult.extractedData,
    extractionResult.llmConfidence,
    requiredFields,
    undefined,
    workflowId,
  );

  if (!validationResult.ok) {
    return handleStepError(db, workflowId, 'validating', validationResult.error);
  }

  const contractResult = await createContract(db, {
    workflowId,
    verticalId,
    extractedData: extractionResult.extractedData,
    llmConfidence: extractionResult.llmConfidence,
    finalConfidence: validationResult.value.finalConfidence,
  });

  if (!contractResult.ok) {
    return handleStepError(db, workflowId, 'validating', contractResult.error);
  }

  const { needsReview } = validationResult.value;
  const contractId = contractResult.value.id;

  if (needsReview) {
    const toReviewResult = await transitionState(db, workflowId, 'review_required');
    if (!toReviewResult.ok) {
      return handleStepError(db, workflowId, 'validating', toReviewResult.error);
    }

    const reviewResult = await createReviewTask(db, {
      workflowId,
      contractId,
      timeoutAt: computeTimeoutAt(),
    });

    if (!reviewResult.ok) {
      return handleStepError(db, workflowId, 'review_required', reviewResult.error);
    }

    log.info({ workflowId, contractId, step: 'review_required', confidence: validationResult.value.finalConfidence }, 'Review required');
  } else {
    const toValidatedResult = await transitionState(db, workflowId, 'validated');
    if (!toValidatedResult.ok) {
      return handleStepError(db, workflowId, 'validating', toValidatedResult.error);
    }

    log.info({ workflowId, contractId, step: 'validated', confidence: validationResult.value.finalConfidence }, 'Validation passed');
  }

  return {
    validationResult: validationResult.value,
    contractId,
    needsReview,
    workflowId,
  };
}
