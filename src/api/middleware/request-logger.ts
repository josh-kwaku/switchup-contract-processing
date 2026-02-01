import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../infrastructure/logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](
      { method: req.method, path: req.path, statusCode: res.statusCode, durationMs: duration },
      'HTTP request',
    );
  });

  next();
}
