export type { LLMProvider, LLMResponse, LLMRequestOptions, LLMProviderConfig } from './types.js';
export { GroqProvider, createGroqClientFromEnv } from './groq.js';
export type { GroqClient } from './groq.js';

import Groq from 'groq-sdk';
import { GroqProvider } from './groq.js';
import type { LLMProvider, LLMProviderConfig } from './types.js';

export function createLLMProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'groq':
      return new GroqProvider(new Groq({ apiKey: config.apiKey }), config.model);
    default:
      throw new Error(`Unsupported LLM provider: ${String(config.provider)}`);
  }
}

let instance: LLMProvider | null = null;

/** @throws {Error} If GROQ_API_KEY is not set or LLM_PROVIDER is unsupported */
export function getLlm(): LLMProvider {
  if (!instance) {
    const provider = process.env.LLM_PROVIDER ?? 'groq';
    if (provider !== 'groq') {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY environment variable is not set');
    }
    instance = createLLMProvider({ provider: 'groq', apiKey });
  }
  return instance;
}
