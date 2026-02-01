import pino from 'pino';

export const logger = pino({
  name: 'contract-processing',
  level: process.env.LOG_LEVEL ?? 'info',
});

export function createWorkflowLogger(
  workflowId: string,
  vertical?: string,
  provider?: string,
) {
  return logger.child({
    workflowId,
    ...(vertical !== undefined && { vertical }),
    ...(provider !== undefined && { provider }),
  });
}
