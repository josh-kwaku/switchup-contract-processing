import { eq } from 'drizzle-orm';
import type { Database } from '../../infrastructure/db/client.js';
import { contracts } from '../../infrastructure/db/schema.js';
import type { Contract } from '../../domain/types.js';
import type { CreateContractInput, UpdateContractDataInput } from './types.js';

function toContract(row: typeof contracts.$inferSelect): Contract {
  return {
    id: row.id,
    workflowId: row.workflowId,
    verticalId: row.verticalId,
    providerId: row.providerId,
    extractedData: row.extractedData as Record<string, unknown>,
    llmConfidence: Number(row.llmConfidence),
    finalConfidence: Number(row.finalConfidence),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function insertContract(
  db: Database,
  input: CreateContractInput,
): Promise<Contract> {
  const rows = await db
    .insert(contracts)
    .values({
      workflowId: input.workflowId,
      verticalId: input.verticalId,
      providerId: input.providerId ?? null,
      extractedData: input.extractedData,
      llmConfidence: String(input.llmConfidence),
      finalConfidence: String(input.finalConfidence),
    })
    .returning();

  return toContract(rows[0]);
}

export async function findContractById(
  db: Database,
  id: string,
): Promise<Contract | null> {
  const rows = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, id));

  return rows.length > 0 ? toContract(rows[0]) : null;
}

export async function findContractByWorkflowId(
  db: Database,
  workflowId: string,
): Promise<Contract | null> {
  const rows = await db
    .select()
    .from(contracts)
    .where(eq(contracts.workflowId, workflowId));

  return rows.length > 0 ? toContract(rows[0]) : null;
}

export async function updateContractData(
  db: Database,
  id: string,
  input: UpdateContractDataInput,
): Promise<Contract | null> {
  const rows = await db
    .update(contracts)
    .set({
      extractedData: input.extractedData,
      finalConfidence: String(input.finalConfidence),
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, id))
    .returning();

  return rows.length > 0 ? toContract(rows[0]) : null;
}
