import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '../../src/domain/result.js';
import { createAppError, ErrorCode } from '../../src/domain/errors.js';
import type { Vertical } from '../../src/domain/types.js';
import type { LLMResponse } from '../../src/infrastructure/llm/types.js';

// Mock infrastructure singletons before importing the module under test
vi.mock('../../src/infrastructure/langfuse.js', () => {
  const getPrompt = vi.fn().mockResolvedValue(ok({
    name: 'contract-extraction-energy',
    prompt: 'Extract from {{contract_text}} for {{vertical}}',
    config: {},
  }));
  const traceGeneration = vi.fn();
  const warmCache = vi.fn();
  return {
    getLangfuse: () => ({ getPrompt, traceGeneration, warmCache }),
    // expose for test assertions
    __mocks: { getPrompt, traceGeneration },
  };
});

const mockChat = vi.fn();
vi.mock('../../src/infrastructure/llm/index.js', () => ({
  getLlm: () => ({ chat: mockChat }),
}));

// Now import the module under test (after mocks are set up)
const { extractContractData } = await import('../../src/services/extraction/index.js');
const langfuseMocks = (await import('../../src/infrastructure/langfuse.js') as unknown as { __mocks: { getPrompt: ReturnType<typeof vi.fn>; traceGeneration: ReturnType<typeof vi.fn> } }).__mocks;

const testVertical: Vertical = {
  id: 'v1',
  slug: 'energy',
  displayName: 'Energy',
  defaultPromptName: 'contract-extraction-energy',
  baseRequiredFields: ['provider', 'monthly_rate'],
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const validJson = JSON.stringify({
  provider: 'Vattenfall',
  monthly_rate: 29.99,
  confidence: 85,
});

function makeLlmResponse(content: string): LLMResponse {
  return {
    content,
    model: 'llama-3.3-70b-versatile',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    latencyMs: 200,
  };
}

describe('extractContractData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue(ok(makeLlmResponse(validJson)));
  });

  it('returns ExtractionResult on valid JSON response', async () => {
    const result = await extractContractData('pdf text here', testVertical);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extractedData).toEqual({
      provider: 'Vattenfall',
      monthly_rate: 29.99,
      confidence: 85,
    });
    expect(result.value.llmConfidence).toBe(85);
    expect(result.value.model).toBe('llama-3.3-70b-versatile');
    expect(langfuseMocks.traceGeneration).toHaveBeenCalled();
  });

  it('retries once on malformed JSON and succeeds on second attempt', async () => {
    mockChat
      .mockResolvedValueOnce(ok(makeLlmResponse('not json {')))
      .mockResolvedValueOnce(ok(makeLlmResponse(validJson)));

    const result = await extractContractData('pdf text', testVertical);

    expect(result.ok).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it('returns LLM_MALFORMED_RESPONSE when both attempts return bad JSON', async () => {
    mockChat
      .mockResolvedValueOnce(ok(makeLlmResponse('bad json 1')))
      .mockResolvedValueOnce(ok(makeLlmResponse('bad json 2')));

    const result = await extractContractData('pdf text', testVertical);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCode.LLM_MALFORMED_RESPONSE);
    expect(result.error.details).toBe('bad json 2');
  });

  it('returns error when Langfuse prompt fetch fails', async () => {
    langfuseMocks.getPrompt.mockResolvedValueOnce(
      err(createAppError(ErrorCode.LANGFUSE_UNAVAILABLE, 'down', true)),
    );

    const result = await extractContractData('pdf text', testVertical);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCode.LANGFUSE_UNAVAILABLE);
  });
});
