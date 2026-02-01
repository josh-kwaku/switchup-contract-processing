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
