import type { Result } from '../../domain/result.js';
import type { AppError } from '../../domain/errors.js';
import { ok } from '../../domain/result.js';
import { logger } from '../../infrastructure/logger.js';
import { storePdf } from '../../infrastructure/pdf-storage.js';
import { extractTextFromPdf } from '../../infrastructure/pdf-parser.js';
import * as workflowService from '../workflow/index.js';
import { IngestInput, IngestResult } from './types.js';

export async function ingestPdf(
  input: IngestInput,
): Promise<Result<IngestResult, AppError>> {
  const { pdfBase64, workflowId, filename } = input;

  const storeResult = await storePdf(pdfBase64, workflowId, filename);
  if (!storeResult.ok) return storeResult;

  const updateResult = await workflowService.updatePdfStoragePath(workflowId, storeResult.value.path);
  if (!updateResult.ok) return updateResult;

  const t1 = await workflowService.transitionState(workflowId, 'parsing_pdf');
  if (!t1.ok) return t1;

  const parseResult = await extractTextFromPdf(pdfBase64, workflowId);
  if (!parseResult.ok) {
    await workflowService.failWorkflow(workflowId, parseResult.error.code, parseResult.error.message, 'parsing_pdf');
    return parseResult;
  }

  const t2 = await workflowService.transitionState(workflowId, 'extracting');
  if (!t2.ok) return t2;

  logger.info({ workflowId, step: 'ingest' }, 'PDF ingested and parsed');
  return ok({ pdfStoragePath: storeResult.value.path, pdfText: parseResult.value });
}
