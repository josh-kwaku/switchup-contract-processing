import { eq } from 'drizzle-orm';
import type { Database } from '../../infrastructure/db/client.js';
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
  db: Database,
  input: {
    verticalId: string;
    pdfStoragePath: string;
    pdfFilename?: string;
  },
): Promise<Workflow> {
  const rows = await db
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
  db: Database,
  id: string,
): Promise<Workflow | null> {
  const rows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id));

  return rows.length > 0 ? toWorkflow(rows[0]) : null;
}

export async function updateWorkflowState(
  db: Database,
  id: string,
  state: WorkflowState,
  errorMessage?: string,
): Promise<Workflow> {
  const rows = await db
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
  db: Database,
  id: string,
  pdfStoragePath: string,
): Promise<Workflow> {
  const rows = await db
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
  db: Database,
  id: string,
): Promise<Workflow | null> {
  const current = await findWorkflowById(db, id);
  if (!current) {
    return null;
  }

  const rows = await db
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
  db: Database,
  entry: {
    workflowId: string;
    fromState: WorkflowState | null;
    toState: WorkflowState;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(workflowStateLog).values({
    workflowId: entry.workflowId,
    fromState: entry.fromState,
    toState: entry.toState,
    metadata: entry.metadata ?? {},
  });
}
