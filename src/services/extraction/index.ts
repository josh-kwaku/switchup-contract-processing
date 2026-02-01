import { ok, err, type Result } from '../../domain/result.js';
import { createAppError, ErrorCode, type AppError } from '../../domain/errors.js';
import { logger } from '../../infrastructure/logger.js';
import { getLangfuse } from '../../infrastructure/langfuse.js';
import { getLlm } from '../../infrastructure/llm/index.js';
import type { LLMProvider } from '../../infrastructure/llm/types.js';
import type { Vertical } from '../../domain/types.js';
import type { ExtractionResult } from './types.js';

export type { ExtractionResult } from './types.js';

const log = logger.child({ module: 'extraction' });
const PROMPT_LABEL = 'production';

export async function extractContractData(
  pdfText: string,
  vertical: Vertical,
  providerHint?: string,
  workflowId?: string,
): Promise<Result<ExtractionResult, AppError>> {
  const ctx = { workflowId, vertical: vertical.slug, providerHint, step: 'extracting' };

  log.info(ctx, 'Starting contract extraction');

  const langfuse = getLangfuse();
  const llm = getLlm();

  const promptResult = await langfuse.getPrompt(
    vertical.defaultPromptName,
    PROMPT_LABEL,
    workflowId,
  );
  if (!promptResult.ok) return promptResult;

  const systemPrompt = promptResult.value.prompt
    .replace('{{contract_text}}', pdfText)
    .replace('{{vertical}}', vertical.slug);

  const llmResult = await callLlm(llm, systemPrompt, pdfText, ctx);
  if (!llmResult.ok) return llmResult;

  const { response, parsed } = llmResult.value;

  const confidence = typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 100
    ? parsed.confidence
    : 0;
  const result: ExtractionResult = {
    extractedData: parsed,
    llmConfidence: confidence,
    rawResponse: response.content,
    model: response.model,
    latencyMs: response.latencyMs,
  };

  langfuse.traceGeneration({
    traceId: workflowId ?? crypto.randomUUID(),
    name: `extraction-${vertical.slug}`,
    model: response.model,
    input: systemPrompt,
    output: response.content,
    promptName: promptResult.value.name,
    startTime: new Date(Date.now() - response.latencyMs),
    endTime: new Date(),
    metadata: { vertical: vertical.slug, providerHint },
  });

  log.info({ ...ctx, model: response.model, latencyMs: response.latencyMs, confidence }, 'Extraction completed');

  return ok(result);
}

async function callLlm(
  llm: LLMProvider,
  systemPrompt: string,
  pdfText: string,
  ctx: Record<string, unknown>,
): Promise<Result<{ response: { content: string; model: string; latencyMs: number }; parsed: Record<string, unknown> }, AppError>> {
  const chatResult = await llm.chat(systemPrompt, pdfText, { responseFormat: 'json' });
  if (!chatResult.ok) return chatResult;

  const parsed = tryParseJson(chatResult.value.content);
  if (parsed) {
    return ok({ response: chatResult.value, parsed });
  }

  log.warn({ ...ctx, errorCode: ErrorCode.LLM_MALFORMED_RESPONSE }, 'LLM returned malformed JSON, retrying once');

  const retryResult = await llm.chat(systemPrompt, pdfText, { responseFormat: 'json' });
  if (!retryResult.ok) return retryResult;

  const retryParsed = tryParseJson(retryResult.value.content);
  if (retryParsed) {
    return ok({ response: retryResult.value, parsed: retryParsed });
  }

  log.error({ ...ctx, errorCode: ErrorCode.LLM_MALFORMED_RESPONSE, retryable: false }, 'LLM returned malformed JSON on both attempts');
  return err(
    createAppError(
      ErrorCode.LLM_MALFORMED_RESPONSE,
      'LLM returned invalid JSON on both attempts',
      false,
      retryResult.value.content,
    ),
  );
}

function tryParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
