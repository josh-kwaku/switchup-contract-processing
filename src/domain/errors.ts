export const ErrorCode = {
  // PDF Parsing
  PDF_PARSE_FAILED: 'PDF_PARSE_FAILED',
  PDF_EMPTY: 'PDF_EMPTY',
  PDF_TOO_LARGE: 'PDF_TOO_LARGE',

  // LLM Extraction
  LLM_API_ERROR: 'LLM_API_ERROR',
  LLM_RATE_LIMITED: 'LLM_RATE_LIMITED',
  LLM_MALFORMED_RESPONSE: 'LLM_MALFORMED_RESPONSE',
  LLM_AUTH_ERROR: 'LLM_AUTH_ERROR',

  // Validation
  VALIDATION_MISSING_FIELDS: 'VALIDATION_MISSING_FIELDS',
  VALIDATION_INVALID_VALUES: 'VALIDATION_INVALID_VALUES',
  VALIDATION_VERTICAL_MISMATCH: 'VALIDATION_VERTICAL_MISMATCH',

  // Provider
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  PROVIDER_CONFIG_MISSING: 'PROVIDER_CONFIG_MISSING',

  // Review
  REVIEW_TIMED_OUT: 'REVIEW_TIMED_OUT',
  REVIEW_REJECTED: 'REVIEW_REJECTED',

  // File Storage
  FILE_STORAGE_ERROR: 'FILE_STORAGE_ERROR',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',

  // Infrastructure
  DB_CONNECTION_ERROR: 'DB_CONNECTION_ERROR',
  LANGFUSE_UNAVAILABLE: 'LANGFUSE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: string;
  retryable: boolean;
}

export function createAppError(
  code: ErrorCode,
  message: string,
  retryable: boolean,
  details?: string,
): AppError {
  return { code, message, retryable, details };
}
