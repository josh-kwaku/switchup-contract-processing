import { createRequire } from 'node:module';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import { ok, err, type Result } from '../domain/result.js';
import { createAppError, ErrorCode, type AppError } from '../domain/errors.js';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);
const STANDARD_FONT_DATA_URL = join(
  require.resolve('pdfjs-dist/package.json'),
  '../standard_fonts/',
);

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export async function extractTextFromPdf(
  pdfBase64: string,
  workflowId?: string,
): Promise<Result<string, AppError>> {
  const log = workflowId
    ? logger.child({ workflowId, step: 'parsing_pdf' })
    : logger.child({ step: 'parsing_pdf' });

  let buffer: Buffer;
  try {
    buffer = Buffer.from(pdfBase64, 'base64');
  } catch {
    log.error({ errorCode: ErrorCode.PDF_PARSE_FAILED, retryable: false }, 'Invalid base64 input');
    return err(
      createAppError(ErrorCode.PDF_PARSE_FAILED, 'Invalid base64 input', false),
    );
  }

  if (buffer.length > MAX_PDF_SIZE_BYTES) {
    log.error(
      { errorCode: ErrorCode.PDF_TOO_LARGE, retryable: false, sizeBytes: buffer.length },
      'PDF exceeds size limit',
    );
    return err(
      createAppError(
        ErrorCode.PDF_TOO_LARGE,
        `PDF size ${buffer.length} bytes exceeds ${MAX_PDF_SIZE_BYTES} byte limit`,
        false,
      ),
    );
  }

  let pdf;
  try {
    pdf = await getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
    }).promise;
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : String(cause);
    log.error({ errorCode: ErrorCode.PDF_PARSE_FAILED, retryable: false, details }, 'Failed to parse PDF');
    return err(
      createAppError(ErrorCode.PDF_PARSE_FAILED, 'Failed to parse PDF document', false, details),
    );
  }

  const textParts: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter((item): item is TextItem => 'str' in item)
        .map((item) => item.str)
        .join(' ');
      textParts.push(pageText);
    }
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : String(cause);
    log.error({ errorCode: ErrorCode.PDF_PARSE_FAILED, retryable: false, details }, 'Failed to extract text from PDF');
    return err(
      createAppError(ErrorCode.PDF_PARSE_FAILED, 'Failed to extract text from PDF', false, details),
    );
  }

  const text = textParts.join('\n').trim();

  if (text.length === 0) {
    log.error({ errorCode: ErrorCode.PDF_EMPTY, retryable: false, pageCount: pdf.numPages }, 'PDF contains no text');
    return err(
      createAppError(ErrorCode.PDF_EMPTY, 'PDF contains no extractable text', false),
    );
  }

  log.info({ pageCount: pdf.numPages, textLength: text.length }, 'PDF text extracted');
  return ok(text);
}
