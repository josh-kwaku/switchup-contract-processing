import 'dotenv/config';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { createDatabase } from '../src/infrastructure/db/client.js';
import { logger } from '../src/infrastructure/logger.js';

async function main() {
  logger.info('Starting database migration');

  const db = createDatabase();

  try {
    await migrate(db, { migrationsFolder: './db/migrations' });
    logger.info('Migrations applied successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, step: 'migration' }, 'Migration failed');
    process.exit(1);
  }
}

main();
