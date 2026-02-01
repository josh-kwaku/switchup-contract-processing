import { Langfuse } from 'langfuse';
import { ok, err, type Result } from '../domain/result.js';
import { createAppError, ErrorCode, type AppError } from '../domain/errors.js';
import { logger } from './logger.js';

export interface CompiledPrompt {
  name: string;
  prompt: string;
  config: Record<string, unknown>;
}

export interface TraceGenerationParams {
  traceId: string;
  name: string;
  model: string;
  input: string;
  output: string;
  promptName?: string;
  promptVersion?: number;
  startTime: Date;
  endTime: Date;
  metadata?: Record<string, unknown>;
}

interface TraceObject {
  generation(params: {
    name: string;
    model: string;
    input: string;
    output: string;
    startTime: Date;
    endTime: Date;
    metadata?: Record<string, unknown>;
  }): void;
}

export interface LangfuseClient {
  getPrompt(name: string, version?: number, options?: { label?: string; type?: string }): Promise<{ name: string; prompt: string; config?: unknown }>;
  trace(params: { id: string; name: string; metadata?: Record<string, unknown> }): TraceObject;
}

interface CacheEntry {
  prompt: CompiledPrompt;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const log = logger.child({ module: 'langfuse' });

export class LangfuseService {
  private readonly client: LangfuseClient;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(client: LangfuseClient) {
    this.client = client;
  }

  async getPrompt(
    name: string,
    label?: string,
    workflowId?: string,
  ): Promise<Result<CompiledPrompt, AppError>> {
    const ctx = { promptName: name, label, workflowId };
    const key = this.cacheKey(name, label);
    const cached = this.cache.get(key);

    if (cached && this.isFresh(cached)) {
      log.debug({ ...ctx, cacheAgeMs: Date.now() - cached.fetchedAt }, 'Returning cached prompt');
      return ok(cached.prompt);
    }

    try {
      const fetched = await this.client.getPrompt(name, undefined, {
        label,
        type: 'text',
      });

      const compiled: CompiledPrompt = {
        name: fetched.name,
        prompt: fetched.prompt,
        config: typeof fetched.config === 'object' && fetched.config !== null
          ? (fetched.config as Record<string, unknown>)
          : {},
      };

      this.cache.set(key, { prompt: compiled, fetchedAt: Date.now() });
      log.info(ctx, 'Fetched prompt from Langfuse');
      return ok(compiled);
    } catch (cause) {
      const details = cause instanceof Error ? cause.message : String(cause);

      if (cached) {
        log.warn(
          { ...ctx, staleForMs: Date.now() - cached.fetchedAt, details },
          'Langfuse unavailable, returning stale cached prompt',
        );
        return ok(cached.prompt);
      }

      log.error(
        { ...ctx, errorCode: ErrorCode.LANGFUSE_UNAVAILABLE, retryable: true, details },
        'Langfuse unavailable and no cached prompt',
      );
      return err(
        createAppError(
          ErrorCode.LANGFUSE_UNAVAILABLE,
          'Cannot fetch prompt from Langfuse and no cached version available',
          true,
          details,
        ),
      );
    }
  }

  /** Fire-and-forget: tracing failures are logged but never block the pipeline */
  traceGeneration(params: TraceGenerationParams): void {
    try {
      const trace = this.client.trace({
        id: params.traceId,
        name: params.name,
        metadata: params.metadata,
      });

      trace.generation({
        name: params.name,
        model: params.model,
        input: params.input,
        output: params.output,
        startTime: params.startTime,
        endTime: params.endTime,
        metadata: {
          promptName: params.promptName,
          promptVersion: params.promptVersion,
          ...params.metadata,
        },
      });

      log.debug({ traceId: params.traceId, model: params.model }, 'Traced LLM generation');
    } catch (cause) {
      const details = cause instanceof Error ? cause.message : String(cause);
      log.warn({ traceId: params.traceId, details }, 'Failed to trace generation (non-blocking)');
    }
  }

  async warmCache(promptNames: string[], label?: string): Promise<void> {
    log.info({ prompts: promptNames }, 'Warming prompt cache');

    const results = await Promise.allSettled(
      promptNames.map((name) => this.getPrompt(name, label)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
    const failed = results.length - succeeded;

    log.info({ succeeded, failed, total: results.length }, 'Prompt cache warm-up complete');
  }

  private cacheKey(name: string, label?: string): string {
    return label ? `${name}:${label}` : name;
  }

  private isFresh(entry: CacheEntry): boolean {
    return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
  }
}

/** @throws {Error} If LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY are not set */
export function createLangfuseClientFromEnv(): LangfuseClient {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    throw new Error('LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set');
  }
  return new Langfuse({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
  });
}
