import 'dotenv/config';
import { createApp } from './app.js';
import { getLangfuse } from '../infrastructure/langfuse.js';
import { logger } from '../infrastructure/logger.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main(): Promise<void> {
  await getLangfuse().warmCache([
    'contract-extraction-energy',
    'contract-extraction-telco',
    'contract-extraction-insurance',
  ], 'production');

  const app = createApp();

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'SwitchUp Contract Processing API started');
  });
}

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'Failed to start server');
  process.exit(1);
});
