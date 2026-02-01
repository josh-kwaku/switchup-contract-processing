import type { Database } from '../../infrastructure/db/client.js';
import { ok, err, type Result } from '../../domain/result.js';
import { createAppError, type AppError } from '../../domain/errors.js';
import { logger } from '../../infrastructure/logger.js';
import type { ReviewTask } from '../../domain/types.js';
import type { CreateReviewTaskInput, ReviewCorrectionInput } from './types.js';
import {
  insertReviewTask,
  findReviewTaskById,
  findPendingReviewTasks,
  findTimedOutReviewTasks,
  updateReviewTaskStatus,
} from './repository.js';

export type { CreateReviewTaskInput, ReviewCorrectionInput } from './types.js';

const REVIEW_TIMEOUT_HOURS = 24;

export function computeTimeoutAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + REVIEW_TIMEOUT_HOURS * 60 * 60 * 1000);
}

export async function createReviewTask(
  db: Database,
  input: CreateReviewTaskInput,
): Promise<Result<ReviewTask, AppError>> {
  try {
    const task = await insertReviewTask(db, input);

    logger.info(
      { workflowId: input.workflowId, reviewTaskId: task.id, timeoutAt: input.timeoutAt.toISOString() },
      'Review task created',
    );
    return ok(task);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId: input.workflowId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, error: message }, 'Failed to create review task');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to create review task', true, message),
    );
  }
}

export async function getPendingReviews(
  db: Database,
): Promise<Result<ReviewTask[], AppError>> {
  try {
    const tasks = await findPendingReviewTasks(db);
    return ok(tasks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ errorCode: 'DB_CONNECTION_ERROR', retryable: true, error: message }, 'Failed to fetch pending reviews');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to fetch pending reviews', true, message),
    );
  }
}

export async function getTimedOutReviews(
  db: Database,
  now: Date = new Date(),
): Promise<Result<ReviewTask[], AppError>> {
  try {
    const tasks = await findTimedOutReviewTasks(db, now);
    return ok(tasks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ errorCode: 'DB_CONNECTION_ERROR', retryable: true, error: message }, 'Failed to fetch timed out reviews');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to fetch timed out reviews', true, message),
    );
  }
}

async function resolveReviewTask(
  db: Database,
  reviewTaskId: string,
): Promise<Result<ReviewTask, AppError>> {
  let task: ReviewTask | null;
  try {
    task = await findReviewTaskById(db, reviewTaskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ reviewTaskId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, error: message }, 'Failed to fetch review task');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to fetch review task', true, message),
    );
  }

  if (!task) {
    return err(
      createAppError('REVIEW_NOT_FOUND', `Review task '${reviewTaskId}' not found`, false),
    );
  }

  if (task.status !== 'pending') {
    return err(
      createAppError(
        'REVIEW_ALREADY_RESOLVED',
        `Review task '${reviewTaskId}' already resolved with status '${task.status}'`,
        false,
      ),
    );
  }

  return ok(task);
}

export async function approveReview(
  db: Database,
  reviewTaskId: string,
  reviewerNotes?: string,
): Promise<Result<ReviewTask, AppError>> {
  try {
    const check = await resolveReviewTask(db, reviewTaskId);
    if (!check.ok) return check;

    const updated = await updateReviewTaskStatus(db, reviewTaskId, 'approved', { reviewerNotes });

    if (!updated) {
      return err(createAppError('REVIEW_NOT_FOUND', `Review task '${reviewTaskId}' not found`, false));
    }

    logger.info(
      { workflowId: check.value.workflowId, reviewTaskId },
      'Review task approved',
    );
    return ok(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ reviewTaskId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, error: message }, 'Failed to approve review');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to approve review', true, message),
    );
  }
}

export async function rejectReview(
  db: Database,
  reviewTaskId: string,
  reviewerNotes?: string,
): Promise<Result<ReviewTask, AppError>> {
  try {
    const check = await resolveReviewTask(db, reviewTaskId);
    if (!check.ok) return check;

    const updated = await updateReviewTaskStatus(db, reviewTaskId, 'rejected', { reviewerNotes });

    if (!updated) {
      return err(createAppError('REVIEW_NOT_FOUND', `Review task '${reviewTaskId}' not found`, false));
    }

    logger.info(
      { workflowId: check.value.workflowId, reviewTaskId },
      'Review task rejected',
    );
    return ok(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ reviewTaskId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, error: message }, 'Failed to reject review');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to reject review', true, message),
    );
  }
}

export async function correctReview(
  db: Database,
  reviewTaskId: string,
  input: ReviewCorrectionInput,
): Promise<Result<ReviewTask, AppError>> {
  try {
    const check = await resolveReviewTask(db, reviewTaskId);
    if (!check.ok) return check;

    const updated = await updateReviewTaskStatus(db, reviewTaskId, 'corrected', {
      correctedData: input.correctedData,
      reviewerNotes: input.reviewerNotes,
    });

    if (!updated) {
      return err(createAppError('REVIEW_NOT_FOUND', `Review task '${reviewTaskId}' not found`, false));
    }

    logger.info(
      { workflowId: check.value.workflowId, reviewTaskId },
      'Review task corrected',
    );
    return ok(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ reviewTaskId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, error: message }, 'Failed to correct review');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to correct review', true, message),
    );
  }
}

export async function timeoutReview(
  db: Database,
  reviewTaskId: string,
): Promise<Result<ReviewTask, AppError>> {
  try {
    const check = await resolveReviewTask(db, reviewTaskId);
    if (!check.ok) return check;

    const updated = await updateReviewTaskStatus(db, reviewTaskId, 'timed_out');

    if (!updated) {
      return err(createAppError('REVIEW_NOT_FOUND', `Review task '${reviewTaskId}' not found`, false));
    }

    logger.info(
      { workflowId: check.value.workflowId, reviewTaskId },
      'Review task timed out',
    );
    return ok(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ reviewTaskId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, error: message }, 'Failed to timeout review');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to timeout review', true, message),
    );
  }
}
