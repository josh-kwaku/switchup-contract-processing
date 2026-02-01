import { ok, err, type Result } from '../../domain/result.js';
import { createAppError, type AppError } from '../../domain/errors.js';
import { logger } from '../../infrastructure/logger.js';
import type { Workflow, WorkflowState } from '../../domain/types.js';
import type { CreateWorkflowInput, TransitionMetadata } from './types.js';
import { VALID_TRANSITIONS } from './types.js';
import {
  insertWorkflow,
  findWorkflowById,
  updateWorkflowState,
  updatePdfStoragePath as updatePdfStoragePathRepo,
  incrementRetryCount,
  insertStateLog,
} from './repository.js';

export type { CreateWorkflowInput, TransitionMetadata } from './types.js';
export { isTerminalState } from './types.js';

const MAX_RETRIES = 3;

export async function createWorkflow(
  input: CreateWorkflowInput,
): Promise<Result<Workflow, AppError>> {
  try {
    const workflow = await insertWorkflow(input);

    await insertStateLog({
      workflowId: workflow.id,
      fromState: null,
      toState: 'pending',
    });

    logger.info({ workflowId: workflow.id, verticalId: input.verticalId }, 'Workflow created');
    return ok(workflow);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ verticalId: input.verticalId, error: message }, 'Failed to create workflow');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to create workflow', true, message),
    );
  }
}

export async function getWorkflow(
  workflowId: string,
): Promise<Result<Workflow, AppError>> {
  try {
    const workflow = await findWorkflowById(workflowId);

    if (!workflow) {
      return err(
        createAppError('WORKFLOW_NOT_FOUND', `Workflow '${workflowId}' not found`, false),
      );
    }

    return ok(workflow);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, error: message }, 'Failed to fetch workflow');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to fetch workflow', true, message),
    );
  }
}

export async function updatePdfStoragePath(
  workflowId: string,
  pdfStoragePath: string,
): Promise<Result<Workflow, AppError>> {
  try {
    const updated = await updatePdfStoragePathRepo(workflowId, pdfStoragePath);
    logger.debug({ workflowId, pdfStoragePath }, 'Updated workflow PDF storage path');
    return ok(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, error: message }, 'Failed to update PDF storage path');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to update PDF storage path', true, message),
    );
  }
}

function isValidTransition(from: WorkflowState, to: WorkflowState): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.has(to);
}

export async function transitionState(
  workflowId: string,
  toState: WorkflowState,
  metadata?: TransitionMetadata,
): Promise<Result<Workflow, AppError>> {
  try {
    const workflow = await findWorkflowById(workflowId);

    if (!workflow) {
      return err(
        createAppError('WORKFLOW_NOT_FOUND', `Workflow '${workflowId}' not found`, false),
      );
    }

    if (!isValidTransition(workflow.state, toState)) {
      logger.warn(
        { workflowId, fromState: workflow.state, toState },
        'Invalid state transition attempted',
      );
      return err(
        createAppError(
          'INVALID_STATE_TRANSITION',
          `Cannot transition from '${workflow.state}' to '${toState}'`,
          false,
        ),
      );
    }

    const errorMsg = toState === 'failed' ? metadata?.errorMessage : undefined;
    const updated = await updateWorkflowState(workflowId, toState, errorMsg);

    await insertStateLog({
      workflowId,
      fromState: workflow.state,
      toState,
      metadata: metadata as Record<string, unknown>,
    });

    logger.info(
      { workflowId, fromState: workflow.state, toState },
      'Workflow state transition',
    );

    return ok(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, toState, error: message }, 'Failed to transition workflow state');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to transition workflow state', true, message),
    );
  }
}

export async function failWorkflow(
  workflowId: string,
  errorCode: string,
  errorMessage: string,
  failedAtStep: WorkflowState,
): Promise<Result<Workflow, AppError>> {
  const transitionResult = await transitionState(workflowId, 'failed', {
    errorCode,
    errorMessage,
    failedAtStep,
  });

  if (!transitionResult.ok) {
    return transitionResult;
  }

  try {
    const updated = await incrementRetryCount(workflowId);

    if (!updated) {
      return err(
        createAppError('WORKFLOW_NOT_FOUND', `Workflow '${workflowId}' not found`, false),
      );
    }

    if (updated.retryCount >= MAX_RETRIES) {
      logger.warn(
        { workflowId, retryCount: updated.retryCount, maxRetries: MAX_RETRIES },
        'Max retries exceeded, rejecting workflow',
      );
      return transitionState(workflowId, 'rejected', {
        triggeredBy: 'max_retries_exceeded',
        retryCount: updated.retryCount,
      });
    }

    return ok(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, error: message }, 'Failed to increment retry count');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to update retry count', true, message),
    );
  }
}
