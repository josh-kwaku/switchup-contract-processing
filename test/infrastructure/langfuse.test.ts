import { describe, it, expect, vi, afterEach } from 'vitest';
import { LangfuseService, type LangfuseClient, type CompiledPrompt } from '../../src/infrastructure/langfuse.js';

function createMockClient(overrides?: Partial<LangfuseClient>): LangfuseClient {
  return {
    getPrompt: vi.fn(),
    trace: vi.fn().mockReturnValue({ generation: vi.fn() }),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

const fakePromptResponse = {
  name: 'contract-extraction-energy',
  prompt: 'Extract fields from {{contract_text}} for {{vertical}}',
  config: { temperature: 0.1 },
};

describe('LangfuseService.getPrompt', () => {
  it('fetches prompt from Langfuse and caches it', async () => {
    const client = createMockClient();
    vi.mocked(client.getPrompt).mockResolvedValue(fakePromptResponse);
    const service = new LangfuseService(client);

    const result = await service.getPrompt('contract-extraction-energy', 'production');
    expect(result.ok).toBe(true);

    const prompt = (result as { ok: true; value: CompiledPrompt }).value;
    expect(prompt.name).toBe('contract-extraction-energy');
    expect(prompt.prompt).toContain('{{contract_text}}');

    // Second call uses cache
    const result2 = await service.getPrompt('contract-extraction-energy', 'production');
    expect(result2.ok).toBe(true);
    expect(client.getPrompt).toHaveBeenCalledTimes(1);
  });

  it('returns stale cache when Langfuse is unavailable', async () => {
    const client = createMockClient();
    vi.mocked(client.getPrompt).mockResolvedValueOnce(fakePromptResponse);
    const service = new LangfuseService(client);

    await service.getPrompt('contract-extraction-energy');

    // Expire the cache
    vi.useFakeTimers();
    vi.advanceTimersByTime(6 * 60 * 1000);

    vi.mocked(client.getPrompt).mockRejectedValueOnce(new Error('Langfuse 503'));

    const result = await service.getPrompt('contract-extraction-energy');
    expect(result.ok).toBe(true);

    const prompt = (result as { ok: true; value: CompiledPrompt }).value;
    expect(prompt.name).toBe('contract-extraction-energy');
  });

  it('returns LANGFUSE_UNAVAILABLE when no cache and Langfuse is down', async () => {
    const client = createMockClient();
    vi.mocked(client.getPrompt).mockRejectedValueOnce(new Error('Connection refused'));
    const service = new LangfuseService(client);

    const result = await service.getPrompt('contract-extraction-energy');
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe('LANGFUSE_UNAVAILABLE');
      expect(result.error.retryable).toBe(true);
    }
  });
});
