import { neon } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

export type Database = NeonHttpDatabase<typeof schema>;

function getConnectionUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
}

export function createDatabase(): Database {
  const sql = neon(getConnectionUrl());
  return drizzle(sql, { schema });
}

let instance: Database | null = null;

/** @throws {Error} If DATABASE_URL is not set */
export function getDb(): Database {
  if (!instance) instance = createDatabase();
  return instance;
}
