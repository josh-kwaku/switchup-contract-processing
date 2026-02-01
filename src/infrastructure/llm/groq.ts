import Groq from 'groq-sdk';
import { ok, err } from '../../domain/result.js';
import { createAppError, ErrorCode } from '../../domain/errors.js';
import { logger } from '../logger.js';
import type { Result } from '../../domain/result.js';
import type { AppError } from '../../domain/errors.js';
import type { LLMProvider, LLMResponse, LLMRequestOptions } from './types.js';

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_MAX_TOKENS = 4096;

const log = logger.child({ module: 'llm-groq' });

export interface GroqClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        temperature?: number;
        max_tokens?: number;
        response_format?: { type: 'json_object' | 'text' };
      }): Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
        model: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      }>;
    };
  };
}

export class GroqProvider implements LLMProvider {
  private readonly client: GroqClient;
  private readonly model: string;

  constructor(client: GroqClient, model?: string) {
    this.client = client;
    this.model = model ?? DEFAULT_MODEL;
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    options?: LLMRequestOptions,
  ): Promise<Result<LLMResponse, AppError>> {
    const startTime = Date.now();
    const ctx = { model: this.model };

    log.debug(ctx, 'Calling Groq chat completion');

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: options?.temperature ?? 0.1,
        max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(options?.responseFormat === 'json' && {
          response_format: { type: 'json_object' },
        }),
      });

      const latencyMs = Date.now() - startTime;
      const content = response.choices[0]?.message?.content;

      if (!content) {
        log.error({ ...ctx, latencyMs, errorCode: ErrorCode.LLM_MALFORMED_RESPONSE, retryable: false }, 'Groq returned empty response');
        return err(
          createAppError(
            ErrorCode.LLM_MALFORMED_RESPONSE,
            'Groq returned empty response content',
            false,
          ),
        );
      }

      const usage = response.usage;
      const result: LLMResponse = {
        content,
        model: response.model,
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
        latencyMs,
      };

      log.info(
        {
          ...ctx,
          latencyMs,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        },
        'Groq chat completion succeeded',
      );

      return ok(result);
    } catch (cause) {
      const latencyMs = Date.now() - startTime;
      return this.mapError(cause, latencyMs);
    }
  }

  private mapError(cause: unknown, latencyMs: number): Result<never, AppError> {
    const details = cause instanceof Error ? cause.message : String(cause);
    const status = this.extractStatus(cause);
    const ctx = { model: this.model, latencyMs, status, details };

    if (status === 401) {
      log.error({ ...ctx, errorCode: ErrorCode.LLM_AUTH_ERROR, retryable: false }, 'Groq authentication failed');
      return err(createAppError(ErrorCode.LLM_AUTH_ERROR, 'Groq API authentication failed', false, details));
    }

    if (status === 429) {
      log.warn({ ...ctx, errorCode: ErrorCode.LLM_RATE_LIMITED, retryable: true }, 'Groq rate limited');
      return err(createAppError(ErrorCode.LLM_RATE_LIMITED, 'Groq API rate limited', true, details));
    }

    if (status !== undefined && status >= 500) {
      log.error({ ...ctx, errorCode: ErrorCode.LLM_API_ERROR, retryable: true }, 'Groq server error');
      return err(createAppError(ErrorCode.LLM_API_ERROR, `Groq API returned ${status}`, true, details));
    }

    log.error({ ...ctx, errorCode: ErrorCode.LLM_API_ERROR, retryable: true }, 'Groq API call failed');
    return err(createAppError(ErrorCode.LLM_API_ERROR, 'Groq API call failed', true, details));
  }

  private extractStatus(cause: unknown): number | undefined {
    if (
      cause !== null &&
      typeof cause === 'object' &&
      'status' in cause &&
      typeof (cause as { status: unknown }).status === 'number'
    ) {
      return (cause as { status: number }).status;
    }
    return undefined;
  }
}

export function createGroqClientFromEnv(): GroqClient {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY must be set');
  }
  return new Groq({ apiKey });
}
