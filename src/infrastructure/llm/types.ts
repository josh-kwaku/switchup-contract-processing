import type { Result } from '../../domain/result.js';
import type { AppError } from '../../domain/errors.js';

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

export interface LLMProvider {
  chat(
    systemPrompt: string,
    userMessage: string,
    options?: LLMRequestOptions,
  ): Promise<Result<LLMResponse, AppError>>;
}

export interface LLMRequestOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
}

export interface LLMProviderConfig {
  provider: 'groq';
  apiKey: string;
  model?: string;
}
