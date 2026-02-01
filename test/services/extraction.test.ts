import { describe, it, expect, vi } from 'vitest';
import { extractContractData, type ExtractionDeps } from '../../src/services/extraction/index.js';
import { ok, err } from '../../src/domain/result.js';
import { createAppError, ErrorCode } from '../../src/domain/errors.js';
import type { Vertical } from '../../src/domain/types.js';
import type { LLMResponse } from '../../src/infrastructure/llm/types.js';

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

function createMockDeps(overrides?: Partial<ExtractionDeps>): ExtractionDeps {
  return {
    langfuse: {
      getPrompt: vi.fn().mockResolvedValue(ok({
        name: 'contract-extraction-energy',
        prompt: 'Extract from {{contract_text}} for {{vertical}}',
        config: {},
      })),
      traceGeneration: vi.fn(),
      warmCache: vi.fn(),
    } as unknown as ExtractionDeps['langfuse'],
    llm: {
      chat: vi.fn().mockResolvedValue(ok(makeLlmResponse(validJson))),
    },
    promptLabel: 'production',
    ...overrides,
  };
}

describe('extractContractData', () => {
  it('returns ExtractionResult on valid JSON response', async () => {
    const deps = createMockDeps();

    const result = await extractContractData(deps, 'pdf text here', testVertical);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extractedData).toEqual({
      provider: 'Vattenfall',
      monthly_rate: 29.99,
      confidence: 85,
    });
    expect(result.value.llmConfidence).toBe(85);
    expect(result.value.model).toBe('llama-3.3-70b-versatile');
    expect(deps.langfuse.traceGeneration).toHaveBeenCalled();
  });

  it('retries once on malformed JSON and succeeds on second attempt', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(ok(makeLlmResponse('not json {')))
      .mockResolvedValueOnce(ok(makeLlmResponse(validJson)));

    const deps = createMockDeps({ llm: { chat } });

    const result = await extractContractData(deps, 'pdf text', testVertical);

    expect(result.ok).toBe(true);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('returns LLM_MALFORMED_RESPONSE when both attempts return bad JSON', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(ok(makeLlmResponse('bad json 1')))
      .mockResolvedValueOnce(ok(makeLlmResponse('bad json 2')));

    const deps = createMockDeps({ llm: { chat } });

    const result = await extractContractData(deps, 'pdf text', testVertical);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCode.LLM_MALFORMED_RESPONSE);
    expect(result.error.details).toBe('bad json 2');
  });

  it('returns error when Langfuse prompt fetch fails', async () => {
    const langfuse = {
      getPrompt: vi.fn().mockResolvedValue(
        err(createAppError(ErrorCode.LANGFUSE_UNAVAILABLE, 'down', true)),
      ),
      traceGeneration: vi.fn(),
      warmCache: vi.fn(),
    } as unknown as ExtractionDeps['langfuse'];

    const deps = createMockDeps({ langfuse });

    const result = await extractContractData(deps, 'pdf text', testVertical);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCode.LANGFUSE_UNAVAILABLE);
  });
});
