import { z } from 'zod';
import { transitionState } from '../../services/workflow/index.js';
import { logger } from '../../infrastructure/logger.js';
import { getDb, handleStepError, parseInput } from './shared.js';

const log = logger.child({ module: 'script:compare-tariffs' });

const inputSchema = z.object({
  workflowId: z.string().uuid(),
  contractId: z.string().uuid(),
});

interface TariffComparison {
  potentialSavingsEur: number;
  recommendation: string;
  comparedAt: string;
}

interface Output {
  comparison: TariffComparison;
  workflowId: string;
}

export async function main(raw: unknown): Promise<Output> {
  const { workflowId, contractId } = parseInput(inputSchema, raw);
  const db = getDb();

  log.info({ workflowId, contractId, step: 'comparing' }, 'Starting tariff comparison step');

  const toComparingResult = await transitionState(db, workflowId, 'comparing');
  if (!toComparingResult.ok) {
    return handleStepError(db, workflowId, 'comparing', toComparingResult.error);
  }

  // Mock tariff comparison — demonstrates extensibility point
  const comparison: TariffComparison = {
    potentialSavingsEur: Math.round(Math.random() * 200 + 50),
    recommendation: 'Switch to SwitchUp Green Tariff for lower rates',
    comparedAt: new Date().toISOString(),
  };

  log.info(
    { workflowId, potentialSavings: comparison.potentialSavingsEur },
    'Tariff comparison complete (mock)',
  );

  const toCompletedResult = await transitionState(db, workflowId, 'completed');
  if (!toCompletedResult.ok) {
    return handleStepError(db, workflowId, 'comparing', toCompletedResult.error);
  }

  log.info({ workflowId, step: 'completed' }, 'Workflow completed');

  return { comparison, workflowId };
}
