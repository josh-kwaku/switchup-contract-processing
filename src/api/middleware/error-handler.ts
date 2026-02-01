import type { Request, Response, NextFunction } from 'express';
import type { AppError } from '../../domain/errors.js';
import { logger } from '../../infrastructure/logger.js';

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: string; retryable?: boolean } | null;
}

export function successResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

export function errorResponse(code: string, message: string, details?: string, retryable?: boolean): ApiResponse<null> {
  return { success: false, data: null, error: { code, message, details, retryable } };
}

function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'retryable' in value
  );
}

function mapErrorCodeToStatus(code: string): number {
  switch (code) {
    case 'PDF_PARSE_FAILED':
    case 'PDF_EMPTY':
    case 'PDF_TOO_LARGE':
    case 'LLM_AUTH_ERROR':
      return 400;

    case 'WORKFLOW_NOT_FOUND':
    case 'CONTRACT_NOT_FOUND':
    case 'REVIEW_NOT_FOUND':
    case 'VERTICAL_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return 404;

    case 'INVALID_STATE_TRANSITION':
    case 'REVIEW_ALREADY_RESOLVED':
      return 409;

    case 'VALIDATION_ERROR':
      return 422;

    case 'LLM_API_ERROR':
    case 'LLM_RATE_LIMITED':
    case 'DB_CONNECTION_ERROR':
    case 'LANGFUSE_UNAVAILABLE':
      return 503;

    default:
      return 500;
  }
}

export function sendAppError(res: Response, appError: AppError): void {
  const status = mapErrorCodeToStatus(appError.code);
  res.status(status).json(errorResponse(appError.code, appError.message, appError.details, appError.retryable));
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (isAppError(err)) {
    const status = mapErrorCodeToStatus(err.code);
    res.status(status).json(errorResponse(err.code, err.message, err.details, err.retryable));
    return;
  }

  logger.error({ err: err.message }, 'Unhandled error');
  res.status(500).json(errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', undefined, false));
}
