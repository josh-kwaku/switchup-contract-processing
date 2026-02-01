import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractTextFromPdf } from '../src/infrastructure/pdf-parser.js';
import { LangfuseService, createLangfuseClientFromEnv } from '../src/infrastructure/langfuse.js';
import { createLLMProvider } from '../src/infrastructure/llm/index.js';
import { extractContractData } from '../src/services/extraction/index.js';
import { computeFinalConfidence } from '../src/services/extraction/confidence.js';
import { logger } from '../src/infrastructure/logger.js';
import type { Vertical } from '../src/domain/types.js';

const log = logger.child({ module: 'test-extraction' });

const VERTICALS: Record<string, Omit<Vertical, 'id' | 'createdAt' | 'updatedAt'>> = {
  energy: {
    slug: 'energy',
    displayName: 'Energy',
    defaultPromptName: 'contract-extraction-energy',
    baseRequiredFields: ['provider', 'tariff_name', 'monthly_rate', 'contract_start', 'contract_end', 'kwh_price', 'cancellation_period'],
    active: true,
  },
  telco: {
    slug: 'telco',
    displayName: 'Telco',
    defaultPromptName: 'contract-extraction-telco',
    baseRequiredFields: ['provider', 'plan_name', 'monthly_rate', 'contract_start', 'contract_end', 'data_volume', 'cancellation_period'],
    active: true,
  },
  insurance: {
    slug: 'insurance',
    displayName: 'Insurance',
    defaultPromptName: 'contract-extraction-insurance',
    baseRequiredFields: ['provider', 'policy_type', 'monthly_premium', 'contract_start', 'contract_end', 'coverage_amount', 'deductible'],
    active: true,
  },
};

function printUsage(): void {
  console.error('Usage: npm run test:extract -- <pdf-path> <vertical>');
  console.error('  vertical: energy | telco | insurance');
  console.error('Example: npm run test:extract -- ./test/fixtures/vattenfall-energy.pdf energy');
  process.exit(1);
}

async function main(): Promise<void> {
  const [pdfPath, verticalSlug] = process.argv.slice(2);

  if (!pdfPath || !verticalSlug) {
    printUsage();
  }

  const verticalDef = VERTICALS[verticalSlug];
  if (!verticalDef) {
    console.error(`Unknown vertical: ${verticalSlug}`);
    console.error(`Valid verticals: ${Object.keys(VERTICALS).join(', ')}`);
    process.exit(1);
  }

  const vertical: Vertical = {
    id: 'test',
    ...verticalDef,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (!process.env.GROQ_API_KEY) {
    console.error('GROQ_API_KEY environment variable is required');
    process.exit(1);
  }

  const workflowId = `test-${Date.now()}`;
  log.info({ workflowId, pdfPath, vertical: verticalSlug }, 'Starting test extraction');

  // 1. Read PDF file and encode as base64
  const absolutePath = resolve(pdfPath);
  const pdfBuffer = await readFile(absolutePath);
  const pdfBase64 = pdfBuffer.toString('base64');
  log.info({ workflowId, sizeBytes: pdfBuffer.length }, 'PDF loaded');

  // 2. Parse PDF text
  const textResult = await extractTextFromPdf(pdfBase64, workflowId);
  if (!textResult.ok) {
    log.error({ workflowId, errorCode: textResult.error.code, retryable: textResult.error.retryable }, 'PDF parsing failed');
    process.exit(1);
  }
  log.info({ workflowId, textLength: textResult.value.length }, 'PDF text extracted');

  // 3. Initialize dependencies
  const langfuse = new LangfuseService(createLangfuseClientFromEnv());
  const llm = createLLMProvider({
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
  });

  // 4. Run extraction
  const extractionResult = await extractContractData(
    { langfuse, llm, promptLabel: process.env.LANGFUSE_PROMPT_LABEL ?? 'production' },
    textResult.value,
    vertical,
    undefined,
    workflowId,
  );

  if (!extractionResult.ok) {
    log.error({ workflowId, errorCode: extractionResult.error.code, retryable: extractionResult.error.retryable }, 'Extraction failed');
    process.exit(1);
  }

  // 5. Compute final confidence
  const confidence = computeFinalConfidence(
    extractionResult.value.llmConfidence,
    extractionResult.value.extractedData,
    vertical.baseRequiredFields,
    undefined,
    workflowId,
  );

  // 6. Output result
  const output = {
    vertical: verticalSlug,
    model: extractionResult.value.model,
    latencyMs: extractionResult.value.latencyMs,
    llmConfidence: extractionResult.value.llmConfidence,
    finalConfidence: confidence.finalConfidence,
    adjustments: confidence.adjustments,
    extractedData: extractionResult.value.extractedData,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  log.error({ error }, 'Unhandled error');
  console.error(error);
  process.exit(1);
});
