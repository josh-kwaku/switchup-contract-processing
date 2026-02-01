import { type ZodSchema, ZodError } from 'zod';
import { createDatabase, type Database } from '../../infrastructure/db/client.js';
import { failWorkflow } from '../../services/workflow/index.js';
import { logger } from '../../infrastructure/logger.js';
import type { WorkflowState } from '../../domain/types.js';
import type { AppError } from '../../domain/errors.js';

const log = logger.child({ module: 'workflow-scripts' });

export function getDb(): Database {
  return createDatabase();
}

export async function handleStepError(
  db: Database,
  workflowId: string,
  failedAtStep: WorkflowState,
  error: AppError,
): Promise<never> {
  log.error(
    { workflowId, step: failedAtStep, errorCode: error.code, retryable: error.retryable },
    `Workflow step failed: ${error.message}`,
  );

  await failWorkflow(db, workflowId, error.code, error.message, failedAtStep);

  throw new Error(`[${error.code}] ${error.message}`);
}

export function parseInput<T>(schema: ZodSchema<T>, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid script input: ${details}`);
    }
    throw error;
  }
}
