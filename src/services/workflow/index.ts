import type { Database } from '../../infrastructure/db/client.js';
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
  incrementRetryCount,
  insertStateLog,
} from './repository.js';

export type { CreateWorkflowInput, TransitionMetadata } from './types.js';
export { isTerminalState } from './types.js';

const MAX_RETRIES = 3;

export async function createWorkflow(
  db: Database,
  input: CreateWorkflowInput,
): Promise<Result<Workflow, AppError>> {
  try {
    const workflow = await insertWorkflow(db, input);

    await insertStateLog(db, {
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
  db: Database,
  workflowId: string,
): Promise<Result<Workflow, AppError>> {
  try {
    const workflow = await findWorkflowById(db, workflowId);

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

function isValidTransition(from: WorkflowState, to: WorkflowState): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.has(to);
}

export async function transitionState(
  db: Database,
  workflowId: string,
  toState: WorkflowState,
  metadata?: TransitionMetadata,
): Promise<Result<Workflow, AppError>> {
  try {
    const workflow = await findWorkflowById(db, workflowId);

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
    const updated = await updateWorkflowState(db, workflowId, toState, errorMsg);

    await insertStateLog(db, {
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
  db: Database,
  workflowId: string,
  errorCode: string,
  errorMessage: string,
  failedAtStep: WorkflowState,
): Promise<Result<Workflow, AppError>> {
  const transitionResult = await transitionState(db, workflowId, 'failed', {
    errorCode,
    errorMessage,
    failedAtStep,
  });

  if (!transitionResult.ok) {
    return transitionResult;
  }

  try {
    const updated = await incrementRetryCount(db, workflowId);

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
      return transitionState(db, workflowId, 'rejected', {
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
