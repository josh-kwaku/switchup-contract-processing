import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { ok, err, type Result } from '../domain/result.js';
import { createAppError, ErrorCode, type AppError } from '../domain/errors.js';
import type { StoredPdf } from '../domain/types.js';
import { logger } from './logger.js';

const DEFAULT_STORAGE_DIR = join(process.cwd(), 'storage', 'pdfs');

export async function storePdf(
  pdfBase64: string,
  workflowId: string,
  filename?: string,
  storageDir: string = DEFAULT_STORAGE_DIR,
): Promise<Result<StoredPdf, AppError>> {
  const log = logger.child({ workflowId, step: 'storing_pdf' });

  let buffer: Buffer;
  try {
    buffer = Buffer.from(pdfBase64, 'base64');
  } catch {
    log.error({ errorCode: ErrorCode.FILE_STORAGE_ERROR, retryable: false }, 'Invalid base64 input for storage');
    return err(createAppError(ErrorCode.FILE_STORAGE_ERROR, 'Invalid base64 input', false));
  }

  const safeName = filename
    ? filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_')
    : 'contract.pdf';
  const filePath = join(storageDir, workflowId, safeName);

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : String(cause);
    log.error({ errorCode: ErrorCode.FILE_STORAGE_ERROR, retryable: true, details }, 'Failed to write PDF to storage');
    return err(createAppError(ErrorCode.FILE_STORAGE_ERROR, 'Failed to store PDF file', true, details));
  }

  log.info({ path: filePath, sizeBytes: buffer.length }, 'PDF stored');
  return ok({ path: filePath, sizeBytes: buffer.length });
}

export async function getPdf(
  storagePath: string,
  workflowId?: string,
): Promise<Result<Buffer, AppError>> {
  const log = workflowId
    ? logger.child({ workflowId, step: 'retrieving_pdf' })
    : logger.child({ step: 'retrieving_pdf' });

  try {
    const data = await readFile(storagePath);
    log.debug({ path: storagePath, sizeBytes: data.length }, 'PDF retrieved');
    return ok(data);
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : String(cause);
    log.error({ errorCode: ErrorCode.FILE_NOT_FOUND, retryable: false, path: storagePath, details }, 'PDF file not found');
    return err(createAppError(ErrorCode.FILE_NOT_FOUND, 'PDF file not found at storage path', false, details));
  }
}
