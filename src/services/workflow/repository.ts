import { eq } from 'drizzle-orm';
import { getDb } from '../../infrastructure/db/client.js';
import { workflows, workflowStateLog } from '../../infrastructure/db/schema.js';
import type { Workflow, WorkflowState } from '../../domain/types.js';

function toWorkflow(row: typeof workflows.$inferSelect): Workflow {
  return {
    id: row.id,
    verticalId: row.verticalId,
    providerId: row.providerId,
    pdfStoragePath: row.pdfStoragePath,
    pdfFilename: row.pdfFilename,
    state: row.state as WorkflowState,
    windmillJobId: row.windmillJobId,
    retryCount: row.retryCount,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function insertWorkflow(
  input: {
    verticalId: string;
    pdfStoragePath: string;
    pdfFilename?: string;
  },
): Promise<Workflow> {
  const rows = await getDb()
    .insert(workflows)
    .values({
      verticalId: input.verticalId,
      pdfStoragePath: input.pdfStoragePath,
      pdfFilename: input.pdfFilename ?? null,
      state: 'pending',
      retryCount: 0,
    })
    .returning();

  return toWorkflow(rows[0]);
}

export async function findWorkflowById(
  id: string,
): Promise<Workflow | null> {
  const rows = await getDb()
    .select()
    .from(workflows)
    .where(eq(workflows.id, id));

  return rows.length > 0 ? toWorkflow(rows[0]) : null;
}

export async function updateWorkflowState(
  id: string,
  state: WorkflowState,
  errorMessage?: string,
): Promise<Workflow> {
  const rows = await getDb()
    .update(workflows)
    .set({
      state,
      errorMessage: errorMessage ?? null,
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, id))
    .returning();

  return toWorkflow(rows[0]);
}

export async function updatePdfStoragePath(
  id: string,
  pdfStoragePath: string,
): Promise<Workflow> {
  const rows = await getDb()
    .update(workflows)
    .set({
      pdfStoragePath,
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, id))
    .returning();

  return toWorkflow(rows[0]);
}

export async function incrementRetryCount(
  id: string,
): Promise<Workflow | null> {
  const current = await findWorkflowById(id);
  if (!current) {
    return null;
  }

  const rows = await getDb()
    .update(workflows)
    .set({
      retryCount: current.retryCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, id))
    .returning();

  return toWorkflow(rows[0]);
}

export async function insertStateLog(
  entry: {
    workflowId: string;
    fromState: WorkflowState | null;
    toState: WorkflowState;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await getDb().insert(workflowStateLog).values({
    workflowId: entry.workflowId,
    fromState: entry.fromState,
    toState: entry.toState,
    metadata: entry.metadata ?? {},
  });
}
