import { describe, it, expect, vi } from 'vitest';
import { GroqProvider, type GroqClient } from '../../src/infrastructure/llm/index.js';

function createMockClient(overrides?: Partial<GroqClient>): GroqClient {
  return {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    ...overrides,
  };
}

const successResponse = {
  choices: [{ message: { content: '{"provider":"Vattenfall","monthly_rate":29.99}' } }],
  model: 'llama-3.3-70b-versatile',
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

describe('GroqProvider.chat', () => {
  it('returns parsed LLM response on success', async () => {
    const client = createMockClient();
    vi.mocked(client.chat.completions.create).mockResolvedValue(successResponse);
    const provider = new GroqProvider(client);

    const result = await provider.chat('system prompt', 'user message');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toContain('Vattenfall');
      expect(result.value.model).toBe('llama-3.3-70b-versatile');
      expect(result.value.usage.totalTokens).toBe(150);
      expect(result.value.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns LLM_MALFORMED_RESPONSE on empty content', async () => {
    const client = createMockClient();
    vi.mocked(client.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: null } }],
      model: 'llama-3.3-70b-versatile',
      usage: undefined,
    });
    const provider = new GroqProvider(client);

    const result = await provider.chat('system', 'user');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_MALFORMED_RESPONSE');
    }
  });

  it('maps 429 to LLM_RATE_LIMITED (retryable)', async () => {
    const client = createMockClient();
    vi.mocked(client.chat.completions.create).mockRejectedValue(
      Object.assign(new Error('Rate limited'), { status: 429 }),
    );
    const provider = new GroqProvider(client);

    const result = await provider.chat('system', 'user');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_RATE_LIMITED');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('maps 500 to LLM_API_ERROR (retryable)', async () => {
    const client = createMockClient();
    vi.mocked(client.chat.completions.create).mockRejectedValue(
      Object.assign(new Error('Server error'), { status: 500 }),
    );
    const provider = new GroqProvider(client);

    const result = await provider.chat('system', 'user');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_API_ERROR');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('maps 401 to LLM_AUTH_ERROR (not retryable)', async () => {
    const client = createMockClient();
    vi.mocked(client.chat.completions.create).mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 }),
    );
    const provider = new GroqProvider(client);

    const result = await provider.chat('system', 'user');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_AUTH_ERROR');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('passes json response_format when requested', async () => {
    const client = createMockClient();
    vi.mocked(client.chat.completions.create).mockResolvedValue(successResponse);
    const provider = new GroqProvider(client);

    await provider.chat('system', 'user', { responseFormat: 'json' });

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      }),
    );
  });
});
