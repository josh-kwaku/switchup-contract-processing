import { z } from 'zod';
import { getVertical } from '../../services/provider-registry/index.js';
import { extractContractData, type ExtractionResult } from '../../services/extraction/index.js';
import { LangfuseService, createLangfuseClientFromEnv } from '../../infrastructure/langfuse.js';
import { createLLMProvider } from '../../infrastructure/llm/index.js';
import { logger } from '../../infrastructure/logger.js';
import { createAppError } from '../../domain/errors.js';
import { getDb, handleStepError, parseInput } from './shared.js';

const log = logger.child({ module: 'script:extract-data' });

const inputSchema = z.object({
  pdfText: z.string().min(1),
  workflowId: z.string().uuid(),
  verticalSlug: z.string().min(1),
});

interface Output {
  extractionResult: ExtractionResult;
  workflowId: string;
  verticalId: string;
  requiredFields: string[];
}

export async function main(raw: unknown): Promise<Output> {
  const { pdfText, workflowId, verticalSlug } = parseInput(inputSchema, raw);
  const db = getDb();

  log.info({ workflowId, vertical: verticalSlug, step: 'extracting' }, 'Starting extraction step');

  const verticalResult = await getVertical(db, verticalSlug);
  if (!verticalResult.ok) {
    return handleStepError(db, workflowId, 'extracting', verticalResult.error);
  }
  const vertical = verticalResult.value;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return handleStepError(
      db, workflowId, 'extracting',
      createAppError('LLM_API_ERROR', 'GROQ_API_KEY not configured', false),
    );
  }

  const langfuse = new LangfuseService(createLangfuseClientFromEnv());
  const llm = createLLMProvider({ provider: 'groq', apiKey });
  const promptLabel = process.env.LANGFUSE_PROMPT_LABEL ?? 'production';

  const extractionResult = await extractContractData(
    { langfuse, llm, promptLabel },
    pdfText,
    vertical,
    undefined,
    workflowId,
  );

  if (!extractionResult.ok) {
    return handleStepError(db, workflowId, 'extracting', extractionResult.error);
  }

  log.info(
    { workflowId, llmConfidence: extractionResult.value.llmConfidence, model: extractionResult.value.model },
    'Extraction complete',
  );

  return {
    extractionResult: extractionResult.value,
    workflowId,
    verticalId: vertical.id,
    requiredFields: vertical.baseRequiredFields,
  };
}
