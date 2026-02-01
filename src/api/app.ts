import express from 'express';
import { setupOpenAPI } from './openapi/index.js';
import { workflowRouter } from './routes/workflow.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';

export function createApp(): express.Express {
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use(requestLogger);

  setupOpenAPI(app);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(workflowRouter);

  app.use(errorHandler);

  return app;
}
