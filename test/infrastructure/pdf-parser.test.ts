import { describe, it, expect } from 'vitest';
import { extractTextFromPdf } from '../../src/infrastructure/pdf-parser.js';

// Minimal valid PDF with text "Hello World"
function createTestPdf(text: string): string {
  const content = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
4 0 obj<</Length ${12 + text.length}>>
stream
BT /F1 12 Tf (${text}) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000306 00000 n
0000000240 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
${371 + text.length}
%%EOF`;
  return Buffer.from(content).toString('base64');
}

// Minimal valid PDF with no text content
function createEmptyPdf(): string {
  const content = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj
4 0 obj<</Length 0>>
stream

endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000232 00000 n
trailer<</Size 5/Root 1 0 R>>
startxref
289
%%EOF`;
  return Buffer.from(content).toString('base64');
}

describe('extractTextFromPdf', () => {
  it('extracts text from a valid PDF', async () => {
    const base64 = createTestPdf('Hello World');
    const result = await extractTextFromPdf(base64);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('Hello World');
    }
  });

  it('returns PDF_PARSE_FAILED for corrupt data', async () => {
    const corrupt = Buffer.from('not a pdf at all').toString('base64');
    const result = await extractTextFromPdf(corrupt);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PDF_PARSE_FAILED');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('returns PDF_EMPTY for a PDF with no text', async () => {
    const base64 = createEmptyPdf();
    const result = await extractTextFromPdf(base64);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PDF_EMPTY');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('returns PDF_TOO_LARGE for oversized input', async () => {
    // 11MB of base64 data
    const large = Buffer.alloc(11 * 1024 * 1024, 0).toString('base64');
    const result = await extractTextFromPdf(large);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PDF_TOO_LARGE');
      expect(result.error.retryable).toBe(false);
    }
  });

});
