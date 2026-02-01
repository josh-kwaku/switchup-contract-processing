import { eq, and, lt } from 'drizzle-orm';
import type { Database } from '../../infrastructure/db/client.js';
import { reviewTasks } from '../../infrastructure/db/schema.js';
import type { ReviewTask, ReviewStatus } from '../../domain/types.js';
import type { CreateReviewTaskInput } from './types.js';

function toReviewTask(row: typeof reviewTasks.$inferSelect): ReviewTask {
  return {
    id: row.id,
    workflowId: row.workflowId,
    contractId: row.contractId,
    status: row.status as ReviewStatus,
    correctedData: row.correctedData as Record<string, unknown> | null,
    reviewerNotes: row.reviewerNotes,
    timeoutAt: row.timeoutAt,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function insertReviewTask(
  db: Database,
  input: CreateReviewTaskInput,
): Promise<ReviewTask> {
  const rows = await db
    .insert(reviewTasks)
    .values({
      workflowId: input.workflowId,
      contractId: input.contractId,
      status: 'pending',
      timeoutAt: input.timeoutAt,
    })
    .returning();

  return toReviewTask(rows[0]);
}

export async function findReviewTaskById(
  db: Database,
  id: string,
): Promise<ReviewTask | null> {
  const rows = await db
    .select()
    .from(reviewTasks)
    .where(eq(reviewTasks.id, id));

  return rows.length > 0 ? toReviewTask(rows[0]) : null;
}

export async function findPendingReviewTasks(
  db: Database,
): Promise<ReviewTask[]> {
  const rows = await db
    .select()
    .from(reviewTasks)
    .where(eq(reviewTasks.status, 'pending'));

  return rows.map(toReviewTask);
}

export async function findTimedOutReviewTasks(
  db: Database,
  now: Date,
): Promise<ReviewTask[]> {
  const rows = await db
    .select()
    .from(reviewTasks)
    .where(
      and(
        eq(reviewTasks.status, 'pending'),
        lt(reviewTasks.timeoutAt, now),
      ),
    );

  return rows.map(toReviewTask);
}

export async function updateReviewTaskStatus(
  db: Database,
  id: string,
  status: ReviewStatus,
  data?: {
    correctedData?: Record<string, unknown>;
    reviewerNotes?: string;
  },
): Promise<ReviewTask | null> {
  const rows = await db
    .update(reviewTasks)
    .set({
      status,
      correctedData: data?.correctedData ?? undefined,
      reviewerNotes: data?.reviewerNotes ?? undefined,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reviewTasks.id, id))
    .returning();

  return rows.length > 0 ? toReviewTask(rows[0]) : null;
}
