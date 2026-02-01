import { processContractInput } from '../../domain/schemas.js';
import { getVertical } from '../../services/provider-registry/index.js';
import { createWorkflow, updatePdfStoragePath } from '../../services/workflow/index.js';
import { storePdf } from '../../infrastructure/pdf-storage.js';
import { logger } from '../../infrastructure/logger.js';
import { getDb, parseInput } from '../scripts/shared.js';

const log = logger.child({ module: 'trigger:process-contract' });

interface Output {
  workflowId: string;
  verticalSlug: string;
  pdfBase64: string;
}

export async function main(raw: unknown): Promise<Output> {
  const input = parseInput(processContractInput, raw);
  const db = getDb();

  log.info({ vertical: input.verticalSlug, filename: input.filename }, 'Processing contract request');

  const verticalResult = await getVertical(db, input.verticalSlug);
  if (!verticalResult.ok) {
    throw new Error(`[${verticalResult.error.code}] ${verticalResult.error.message}`);
  }
  const vertical = verticalResult.value;

  // Create workflow first to get ID for PDF storage path
  const workflowResult = await createWorkflow(db, {
    verticalId: vertical.id,
    pdfStoragePath: '', // updated after storage
    pdfFilename: input.filename,
  });
  if (!workflowResult.ok) {
    throw new Error(`[${workflowResult.error.code}] ${workflowResult.error.message}`);
  }
  const workflow = workflowResult.value;

  const storageResult = await storePdf(input.pdfBase64, workflow.id, input.filename);
  if (!storageResult.ok) {
    throw new Error(`[${storageResult.error.code}] ${storageResult.error.message}`);
  }

  const pathUpdateResult = await updatePdfStoragePath(db, workflow.id, storageResult.value.path);
  if (!pathUpdateResult.ok) {
    throw new Error(`[${pathUpdateResult.error.code}] ${pathUpdateResult.error.message}`);
  }

  log.info(
    { workflowId: workflow.id, storagePath: storageResult.value.path, sizeBytes: storageResult.value.sizeBytes },
    'Contract workflow created',
  );

  return {
    workflowId: workflow.id,
    verticalSlug: input.verticalSlug,
    pdfBase64: input.pdfBase64,
  };
}
