import { neon } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { logger } from '../logger.js';
import { createAppError } from '../../domain/errors.js';
import { ok, err, type Result } from '../../domain/result.js';
import type { AppError } from '../../domain/errors.js';
import * as schema from './schema.js';

export type Database = NeonHttpDatabase<typeof schema>;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function getConnectionUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayWithJitter(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * base * 0.5;
  return base + jitter;
}

export function createDatabase(): Database {
  const sql = neon(getConnectionUrl());
  return drizzle(sql, { schema });
}

export async function createDatabaseWithRetry(): Promise<Result<Database, AppError>> {
  let lastError = '';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const db = createDatabase();
      await db.execute('SELECT 1');

      logger.info({ attempt: attempt + 1 }, 'Database connection established');
      return ok(db);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn(
        { attempt: attempt + 1, maxRetries: MAX_RETRIES, error: lastError },
        'Database connection attempt failed',
      );

      if (attempt < MAX_RETRIES - 1) {
        const delay = delayWithJitter(attempt);
        await sleep(delay);
      }
    }
  }

  logger.error(
    { maxRetries: MAX_RETRIES, lastError },
    'Database connection failed after all retries',
  );
  return err(
    createAppError('DB_CONNECTION_ERROR', `Failed to connect after ${MAX_RETRIES} attempts`, true, lastError),
  );
}
