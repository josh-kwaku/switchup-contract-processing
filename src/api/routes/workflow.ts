import { Router, type Request, type Response } from 'express';
import { processContractInput, extractRequestInput, reviewActionInput } from '../../domain/schemas.js';
import type { ValidationRules } from '../../domain/types.js';
import { successResponse, errorResponse, sendAppError } from '../middleware/error-handler.js';
import * as workflowService from '../../services/workflow/index.js';
import * as providerRegistry from '../../services/provider-registry/index.js';
import * as extractionService from '../../services/extraction/index.js';
import * as validationService from '../../services/validation/index.js';
import * as contractService from '../../services/contract/index.js';
import * as reviewService from '../../services/review/index.js';
import * as ingestService from '../../services/ingest/index.js';
import { logger } from '../../infrastructure/logger.js';

function paramString(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

const router = Router();

router.post('/workflows/ingest', async (req: Request, res: Response) => {
  const parsed = processContractInput.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.status(422).json(errorResponse('VALIDATION_ERROR', 'Invalid request body', details));
    return;
  }

  const { pdfBase64, verticalSlug, filename } = parsed.data;

  const verticalResult = await providerRegistry.getVertical(verticalSlug);
  if (!verticalResult.ok) return sendAppError(res, verticalResult.error);

  const vertical = verticalResult.value;

  const wfResult = await workflowService.createWorkflow({
    verticalId: vertical.id,
    pdfStoragePath: '',
    pdfFilename: filename,
  });
  if (!wfResult.ok) return sendAppError(res, wfResult.error);

  const workflow = wfResult.value;

  const ingestResult = await ingestService.ingestPdf({
    pdfBase64,
    workflowId: workflow.id,
    filename,
  });
  if (!ingestResult.ok) return sendAppError(res, ingestResult.error);

  res.status(201).json(successResponse({
    workflowId: workflow.id,
    state: 'extracting',
    pdfText: ingestResult.value.pdfText,
    verticalId: vertical.id,
    createdAt: workflow.createdAt,
  }));
});

router.post('/workflows/:id/extract', async (req: Request, res: Response) => {
  const workflowId = paramString(req.params.id);

  const parsed = extractRequestInput.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.status(422).json(errorResponse('VALIDATION_ERROR', 'Invalid request body', details));
    return;
  }

  const { pdfText, verticalSlug } = parsed.data;

  const wfResult = await workflowService.getWorkflow(workflowId);
  if (!wfResult.ok) return sendAppError(res, wfResult.error);

  const verticalResult = await providerRegistry.getVertical(verticalSlug);
  if (!verticalResult.ok) return sendAppError(res, verticalResult.error);
  const vertical = verticalResult.value;

  const extractResult = await extractionService.extractContractData(pdfText, vertical, undefined, workflowId);

  if (!extractResult.ok) {
    await workflowService.failWorkflow(workflowId, extractResult.error.code, extractResult.error.message, 'extracting');
    return sendAppError(res, extractResult.error);
  }

  const t1 = await workflowService.transitionState(workflowId, 'validating');
  if (!t1.ok) return sendAppError(res, t1.error);

  const extraction = extractResult.value;
  const providerName = typeof extraction.extractedData.provider === 'string'
    ? extraction.extractedData.provider.toLowerCase().replace(/\s+/g, '-')
    : undefined;

  let providerId: string | undefined;
  if (providerName) {
    const provResult = await providerRegistry.findProvider(providerName, vertical.id);
    if (provResult.ok && provResult.value) {
      providerId = provResult.value.id;
    }
  }

  const configResult = await providerRegistry.getMergedConfig(vertical.id, providerId);
  if (!configResult.ok) return sendAppError(res, configResult.error);

  const config = configResult.value;
  const valResult = validationService.validateAndScore(
    extraction.extractedData,
    extraction.llmConfidence,
    config.requiredFields,
    config.validationRules as ValidationRules | undefined,
    workflowId,
  );
  if (!valResult.ok) return sendAppError(res, valResult.error);

  const validation = valResult.value;

  const contractResult = await contractService.createContract({
    workflowId,
    verticalId: vertical.id,
    providerId,
    extractedData: validation.contractData,
    llmConfidence: extraction.llmConfidence,
    finalConfidence: validation.finalConfidence,
  });
  if (!contractResult.ok) return sendAppError(res, contractResult.error);

  const contract = contractResult.value;

  if (validation.needsReview) {
    const t2 = await workflowService.transitionState(workflowId, 'review_required');
    if (!t2.ok) return sendAppError(res, t2.error);

    const reviewResult = await reviewService.createReviewTask({
      workflowId,
      contractId: contract.id,
      timeoutAt: reviewService.computeTimeoutAt(),
    });
    if (!reviewResult.ok) return sendAppError(res, reviewResult.error);

    res.json(successResponse({
      workflowId,
      state: 'review_required',
      extractedData: validation.contractData,
      llmConfidence: extraction.llmConfidence,
      finalConfidence: validation.finalConfidence,
      needsReview: true,
      contractId: contract.id,
      reviewTaskId: reviewResult.value.id,
    }));
    return;
  }

  const t2 = await workflowService.transitionState(workflowId, 'validated');
  if (!t2.ok) return sendAppError(res, t2.error);

  res.json(successResponse({
    workflowId,
    state: 'validated',
    extractedData: validation.contractData,
    llmConfidence: extraction.llmConfidence,
    finalConfidence: validation.finalConfidence,
    needsReview: false,
    contractId: contract.id,
  }));
});

router.post('/workflows/:id/compare', async (req: Request, res: Response) => {
  const workflowId = paramString(req.params.id);

  const wfResult = await workflowService.getWorkflow(workflowId);
  if (!wfResult.ok) return sendAppError(res, wfResult.error);

  const t1 = await workflowService.transitionState(workflowId, 'comparing');
  if (!t1.ok) return sendAppError(res, t1.error);

  const contractResult = await contractService.getContractByWorkflowId(workflowId);
  if (!contractResult.ok) return sendAppError(res, contractResult.error);

  const contract = contractResult.value;
  const providerName = typeof contract.extractedData.provider === 'string'
    ? contract.extractedData.provider
    : 'Unknown';

  const comparison = {
    currentTariff: `${providerName} Current Plan`,
    monthlyRate: contract.extractedData.monthly_rate ?? null,
    alternatives: [
      { provider: 'SwitchUp Best', estimatedSavings: '15%', monthlyRate: null },
    ],
  };

  const t2 = await workflowService.transitionState(workflowId, 'completed');
  if (!t2.ok) return sendAppError(res, t2.error);

  res.json(successResponse({
    workflowId,
    state: 'completed',
    comparison,
  }));
});

router.post('/workflows/:id/review', async (req: Request, res: Response) => {
  const workflowId = paramString(req.params.id);

  const parsed = reviewActionInput.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.status(422).json(errorResponse('VALIDATION_ERROR', 'Invalid request body', details));
    return;
  }

  const wfResult = await workflowService.getWorkflow(workflowId);
  if (!wfResult.ok) return sendAppError(res, wfResult.error);

  if (wfResult.value.state !== 'review_required') {
    res.status(409).json(errorResponse(
      'INVALID_STATE_TRANSITION',
      `Workflow is in state '${wfResult.value.state}', not 'review_required'`,
    ));
    return;
  }

  const pendingResult = await reviewService.getPendingReviews();
  if (!pendingResult.ok) return sendAppError(res, pendingResult.error);

  const reviewTask = pendingResult.value.find((t) => t.workflowId === workflowId);
  if (!reviewTask) {
    res.status(404).json(errorResponse('REVIEW_NOT_FOUND', `No pending review found for workflow '${workflowId}'`));
    return;
  }

  const { action } = parsed.data;
  let reviewResult;

  logger.info({ workflowId, reviewTaskId: reviewTask.id, action }, 'Processing review action');

  switch (action) {
    case 'approve':
      reviewResult = await reviewService.approveReview(reviewTask.id, parsed.data.notes);
      break;

    case 'reject':
      reviewResult = await reviewService.rejectReview(reviewTask.id, parsed.data.notes);
      break;

    case 'correct': {
      // Update contract data first — if this fails, we avoid marking
      // the review as corrected with stale contract data.
      const updateResult = await contractService.updateContractData(reviewTask.contractId, {
        extractedData: parsed.data.correctedData,
        finalConfidence: 100,
      });
      if (!updateResult.ok) return sendAppError(res, updateResult.error);

      reviewResult = await reviewService.correctReview(reviewTask.id, {
        correctedData: parsed.data.correctedData,
        reviewerNotes: parsed.data.notes,
      });
      break;
    }

    case 'timeout':
      reviewResult = await reviewService.timeoutReview(reviewTask.id);
      break;
  }

  if (!reviewResult.ok) return sendAppError(res, reviewResult.error);

  // Terminal actions: reject and timeout
  if (action === 'reject' || action === 'timeout') {
    const targetState = action === 'reject' ? 'rejected' as const : 'timed_out' as const;
    const t = await workflowService.transitionState(workflowId, targetState, { triggeredBy: 'human_review' });
    if (!t.ok) return sendAppError(res, t.error);

    res.json(successResponse({
      workflowId,
      state: targetState,
      reviewTask: { id: reviewTask.id, status: reviewResult.value.status },
    }));
    return;
  }

  const t = await workflowService.transitionState(workflowId, 'validated', { triggeredBy: 'human_review' });
  if (!t.ok) return sendAppError(res, t.error);

  res.json(successResponse({
    workflowId,
    state: 'validated',
    reviewTask: { id: reviewTask.id, status: reviewResult.value.status },
  }));
});

router.get('/workflows/:id', async (req: Request, res: Response) => {
  const wfResult = await workflowService.getWorkflow(paramString(req.params.id));
  if (!wfResult.ok) return sendAppError(res, wfResult.error);

  const workflow = wfResult.value;
  const contractResult = await contractService.getContractByWorkflowId(workflow.id);

  res.json(successResponse({
    id: workflow.id,
    state: workflow.state,
    verticalId: workflow.verticalId,
    providerId: workflow.providerId,
    retryCount: workflow.retryCount,
    errorMessage: workflow.errorMessage,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    contract: contractResult.ok
      ? {
          id: contractResult.value.id,
          extractedData: contractResult.value.extractedData,
          llmConfidence: contractResult.value.llmConfidence,
          finalConfidence: contractResult.value.finalConfidence,
        }
      : null,
  }));
});

router.get('/reviews/pending', async (_req: Request, res: Response) => {
  const result = await reviewService.getPendingReviews();
  if (!result.ok) return sendAppError(res, result.error);

  res.json(successResponse({ reviews: result.value }));
});

export { router as workflowRouter };
