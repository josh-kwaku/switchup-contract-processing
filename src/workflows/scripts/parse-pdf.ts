import { z } from 'zod';
import { transitionState } from '../../services/workflow/index.js';
import { extractTextFromPdf } from '../../infrastructure/pdf-parser.js';
import { logger } from '../../infrastructure/logger.js';
import { getDb, handleStepError, parseInput } from './shared.js';

const log = logger.child({ module: 'script:parse-pdf' });

const inputSchema = z.object({
  pdfBase64: z.string().min(1),
  workflowId: z.string().uuid(),
});

interface Output {
  pdfText: string;
  workflowId: string;
}

export async function main(raw: unknown): Promise<Output> {
  const { pdfBase64, workflowId } = parseInput(inputSchema, raw);
  const db = getDb();

  log.info({ workflowId, step: 'parsing_pdf' }, 'Starting PDF parsing step');

  const toParsingResult = await transitionState(db, workflowId, 'parsing_pdf');
  if (!toParsingResult.ok) {
    return handleStepError(db, workflowId, 'parsing_pdf', toParsingResult.error);
  }

  const textResult = await extractTextFromPdf(pdfBase64, workflowId);
  if (!textResult.ok) {
    return handleStepError(db, workflowId, 'parsing_pdf', textResult.error);
  }

  const toExtractingResult = await transitionState(db, workflowId, 'extracting');
  if (!toExtractingResult.ok) {
    return handleStepError(db, workflowId, 'parsing_pdf', toExtractingResult.error);
  }

  log.info({ workflowId, textLength: textResult.value.length }, 'PDF parsing complete');

  return { pdfText: textResult.value, workflowId };
}
